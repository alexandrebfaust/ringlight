//! Janelas transparentes que desenham a ringlight na borda de cada monitor.

use crate::{win, AppState};
use std::{sync::atomic::Ordering, thread, time::Duration};
use tauri::{AppHandle, Manager, Monitor, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const PREFIX: &str = "overlay-";
/// Tempo do fade-out em overlay.html antes de esconder a janela.
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
            // Monitor desconectado: cai para o principal.
            None => primary().into_iter().collect(),
        },
    }
}

/// Cria, reposiciona, mostra ou esconde as sobreposições conforme as configurações.
/// Tem que rodar na thread principal; de outras threads use [`request_sync`].
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
        // Cancela um esconder pendente de um desligar logo antes.
        state.hide_generation.fetch_add(1, Ordering::SeqCst);
    }

    for (m, label) in targets.iter().zip(&wanted) {
        let w = match app.get_webview_window(label) {
            Some(w) => w,
            None => match create(app, label) {
                Ok(w) => w,
                Err(e) => {
                    eprintln!("falha ao criar a sobreposição {label}: {e}");
                    continue;
                }
            },
        };
        place(&w, m);
        let _ = w.set_content_protected(s.hide_from_capture);
        if s.enabled {
            win::show(&w);
        }
    }

    if !s.enabled {
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

fn place(w: &WebviewWindow, m: &Monitor) {
    let (pos, size) = (*m.position(), *m.size());
    if w.outer_position().ok() != Some(pos) {
        let _ = w.set_position(pos);
    }
    // Ao trocar de monitor com outro DPI o Windows redimensiona a janela,
    // então o tamanho é conferido de novo depois da posição.
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
