//! Quick panel that pops up next to the tray icon on a single click.

use crate::{win, AppState};
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const LABEL: &str = "flyout";
/// Panel size in logical px (scaled by the monitor's DPI when shown).
const WIDTH: f64 = 340.0;
const HEIGHT: f64 = 192.0;
/// Gap between the panel and the taskbar / screen edge, logical px.
const MARGIN: f64 = 12.0;
/// Clicking the tray icon while the panel is open first steals its focus,
/// which hides it; the click that follows must not reopen it.
const REOPEN_GUARD: Duration = Duration::from_millis(350);

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("flyout.html".into()))
        .title("Ringlight")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .focused(false)
        .build()?;
    Ok(())
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

pub fn is_visible(app: &AppHandle) -> bool {
    window(app).is_some_and(|w| w.is_visible().unwrap_or(false))
}

/// Single click on the tray icon: open the panel, or close it if it's open.
pub fn toggle(app: &AppHandle, icon: Rect) {
    let Some(w) = window(app) else { return };
    if w.is_visible().unwrap_or(false) {
        hide(app);
        return;
    }
    let state = app.state::<AppState>();
    let recently_hidden = state
        .flyout_hidden_at
        .lock()
        .unwrap()
        .is_some_and(|t| t.elapsed() < REOPEN_GUARD);
    if recently_hidden {
        return;
    }

    place(app, &w, icon);
    let hide_from_capture = state.settings.lock().unwrap().hide_from_capture;
    let _ = w.set_content_protected(hide_from_capture);
    let _ = w.show();
    let _ = w.set_focus();
    // Keep it above the ring overlays, which are also always on top.
    win::raise(&w);
    let _ = w.emit("flyout-shown", ());
}

pub fn hide(app: &AppHandle) {
    let Some(w) = window(app) else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        *app.state::<AppState>().flyout_hidden_at.lock().unwrap() = Some(Instant::now());
    }
}

/// Puts the panel next to the tray icon, against whichever edge the taskbar
/// is on, inside the monitor's work area.
fn place(app: &AppHandle, w: &WebviewWindow, icon: Rect) {
    let pos = icon.position.to_physical::<f64>(1.0);
    let size = icon.size.to_physical::<f64>(1.0);
    let (cx, cy) = (pos.x + size.width / 2.0, pos.y + size.height / 2.0);
    let Some(m) = app
        .monitor_from_point(cx, cy)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())
    else {
        return;
    };

    let scale = m.scale_factor();
    let (fw, fh, gap) = (WIDTH * scale, HEIGHT * scale, MARGIN * scale);
    let wa = m.work_area();
    let (left, top) = (wa.position.x as f64, wa.position.y as f64);
    let (right, bottom) = (left + wa.size.width as f64, top + wa.size.height as f64);
    let (mx, my) = (m.position().x as f64, m.position().y as f64);
    let mright = mx + m.size().width as f64;

    let clamp_x = |x: f64| x.clamp(left + gap, (right - fw - gap).max(left + gap));
    let clamp_y = |y: f64| y.clamp(top + gap, (bottom - fh - gap).max(top + gap));
    let (x, y) = if left > mx {
        (left + gap, clamp_y(cy - fh / 2.0)) // taskbar on the left
    } else if right < mright {
        (right - fw - gap, clamp_y(cy - fh / 2.0)) // taskbar on the right
    } else if top > my {
        (clamp_x(cx - fw / 2.0), top + gap) // taskbar at the top
    } else {
        (clamp_x(cx - fw / 2.0), bottom - fh - gap) // taskbar at the bottom
    };

    let _ = w.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    // After the move, so a DPI change between monitors doesn't resize it.
    let _ = w.set_size(PhysicalSize::new(fw.round() as u32, fh.round() as u32));
}
