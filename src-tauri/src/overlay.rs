//! Transparent windows that draw the ring light around the edge of each monitor.

use crate::{flyout, win, AppState};
use std::{sync::atomic::Ordering, thread, time::Duration};
use tauri::{AppHandle, Manager, Monitor, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const PREFIX: &str = "overlay-";
/// Fade-out time in overlay.html before the window is hidden.
const FADE: Duration = Duration::from_millis(350);

fn label_for(m: &Monitor) -> String {
    let name = m.name().map(String::as_str).unwrap_or("default");
    let id: String = name.chars().filter(char::is_ascii_alphanumeric).collect();
    format!("{PREFIX}{id}")
}

fn overlays(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(PREFIX))
        .map(|(_, w)| w)
        .collect()
}

fn targets(app: &AppHandle, monitor: &str) -> Vec<Monitor> {
    let all = app.available_monitors().unwrap_or_default();
    let primary = || {
        app.primary_monitor()
            .ok()
            .flatten()
            .or_else(|| all.first().cloned())
    };
    match monitor {
        "all" => all.clone(),
        "primary" => primary().into_iter().collect(),
        name => match all.iter().find(|m| m.name().is_some_and(|n| n == name)) {
            Some(m) => vec![m.clone()],
            // Monitor unplugged: fall back to the primary one.
            None => primary().into_iter().collect(),
        },
    }
}

/// Creates, repositions, shows or hides the overlays to match the settings.
/// Must run on the main thread; from other threads use [`request_sync`].
pub fn sync(app: &AppHandle) {
    let state = app.state::<AppState>();
    let s = state.settings.lock().unwrap().clone();
    let targets = targets(app, &s.monitor);
    let wanted: Vec<String> = targets.iter().map(label_for).collect();

    for w in overlays(app) {
        if !wanted.iter().any(|l| l == w.label()) {
            let _ = w.destroy();
        }
    }

    if s.enabled {
        // Cancels a pending hide from a turn-off just before.
        state.hide_generation.fetch_add(1, Ordering::SeqCst);
    }

    // While the user works in the settings window (and asked for it), the
    // light slides under that window instead of covering it. The window
    // itself stays a regular one, so it never floats over other programs.
    let settings = app.get_webview_window("settings");
    let below = settings
        .as_ref()
        .filter(|w| s.settings_on_top && win::is_foreground(w));

    for (m, label) in targets.iter().zip(&wanted) {
        let w = match app.get_webview_window(label) {
            Some(w) => w,
            None => match create(app, label) {
                Ok(w) => w,
                Err(e) => {
                    eprintln!("failed to create overlay {label}: {e}");
                    continue;
                }
            },
        };
        place(&w, m, s.avoid_taskbar);
        let _ = w.set_content_protected(s.hide_from_capture);
        if s.enabled {
            win::show(&w, below);
        }
    }

    if s.enabled {
        // The tray panel is always on top, above the light.
        if let Some(panel) = app.get_webview_window(flyout::LABEL) {
            if panel.is_visible().unwrap_or(false) {
                win::raise(&panel);
            }
        }
    } else {
        schedule_hide(app);
    }
}

pub fn request_sync(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || sync(&handle));
}

fn create(app: &AppHandle, label: &str) -> tauri::Result<WebviewWindow> {
    let w = WebviewWindowBuilder::new(app, label, WebviewUrl::App("overlay.html".into()))
        .title("Ringlight")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(false)
        .focusable(false)
        .visible(false)
        .build()?;
    w.set_ignore_cursor_events(true)?;
    win::enforce(&w);
    Ok(w)
}

/// Covers the whole monitor, or only its work area (everything but the
/// taskbar) when `avoid_taskbar` is set.
fn place(w: &WebviewWindow, m: &Monitor, avoid_taskbar: bool) {
    let (pos, size) = if avoid_taskbar {
        (m.work_area().position, m.work_area().size)
    } else {
        (*m.position(), *m.size())
    };
    if w.outer_position().ok() != Some(pos) {
        let _ = w.set_position(pos);
    }
    // Moving to a monitor with a different DPI makes Windows resize the window,
    // so the size is checked again after the position.
    if w.inner_size().ok() != Some(size) {
        let _ = w.set_size(size);
    }
}

fn schedule_hide(app: &AppHandle) {
    if !overlays(app).iter().any(win::is_visible) {
        return;
    }
    let generation = app
        .state::<AppState>()
        .hide_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(FADE);
        let state = app.state::<AppState>();
        let still_off = !state.settings.lock().unwrap().enabled;
        if still_off && state.hide_generation.load(Ordering::SeqCst) == generation {
            for w in overlays(&app) {
                win::hide(&w);
            }
        }
    });
}
