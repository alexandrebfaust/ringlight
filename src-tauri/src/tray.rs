//! System tray icon, drawn live with the current light colors.

use crate::{flyout, i18n, settings::parse_hex, settings::Settings, show_settings, toggle, AppState};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};

const TRAY_ID: &str = "main";

pub struct TrayItems {
    toggle: CheckMenuItem<Wry>,
    settings: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let s = app.state::<AppState>().settings.lock().unwrap().clone();
    let text = i18n::resolve(&s.language).text();

    let items = TrayItems {
        toggle: CheckMenuItem::with_id(app, "toggle", text.tray_toggle, true, s.enabled, None::<&str>)?,
        settings: MenuItem::with_id(app, "settings", text.tray_settings, true, None::<&str>)?,
        quit: MenuItem::with_id(app, "quit", text.tray_quit, true, None::<&str>)?,
    };
    let menu = Menu::with_items(
        app,
        &[
            &items.toggle,
            &items.settings,
            &PredefinedMenuItem::separator(app)?,
            &items.quit,
        ],
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(ring_icon(&s))
        .tooltip(tooltip(&s))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => toggle(app),
            "settings" => show_settings(app),
            "quit" => crate::quit(app),
            _ => {}
        })
        // One click: quick panel. Double click: the full settings window.
        // (A double click also delivers the first click, which opens the
        // panel; the double click then replaces it with the settings.)
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } => flyout::toggle(tray.app_handle(), rect),
            TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => show_settings(tray.app_handle()),
            _ => {}
        })
        .build(app)?;

    *app.state::<AppState>().tray_items.lock().unwrap() = Some(items);
    Ok(())
}

pub fn refresh(app: &AppHandle) {
    let state = app.state::<AppState>();
    let s = state.settings.lock().unwrap().clone();
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_icon(Some(ring_icon(&s)));
        let _ = tray.set_tooltip(Some(tooltip(&s)));
    }
    let text = i18n::resolve(&s.language).text();
    let items = state.tray_items.lock().unwrap();
    if let Some(items) = items.as_ref() {
        let _ = items.toggle.set_checked(s.enabled);
        let _ = items.toggle.set_text(text.tray_toggle);
        let _ = items.settings.set_text(text.tray_settings);
        let _ = items.quit.set_text(text.tray_quit);
    }
}

fn tooltip(s: &Settings) -> &'static str {
    let text = i18n::resolve(&s.language).text();
    if s.enabled {
        text.tooltip_on
    } else {
        text.tooltip_off
    }
}

fn hex(c: &str) -> [f32; 3] {
    parse_hex(c).unwrap_or([255, 255, 255]).map(f32::from)
}

fn lerp(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [0, 1, 2].map(|i| a[i] + (b[i] - a[i]) * t)
}

/// Light color at position `t` around the ring (0 = top, clockwise, 0..1),
/// or `None` where that part of the ring is off.
fn color_at(s: &Settings, t: f32) -> Option<[f32; 3]> {
    match s.color_mode.as_str() {
        "linear" | "conic" => {
            // The icon wraps the stops around the ring; close enough for 32 px.
            let n = s.gradient.len();
            let pos = t * n as f32;
            let i = (pos.floor() as usize) % n;
            Some(lerp(hex(&s.gradient[i]), hex(&s.gradient[(i + 1) % n]), pos.fract()))
        }
        "sides" => {
            let side = &s.sides[((t + 0.125) * 4.0) as usize % 4];
            side.on.then(|| hex(&side.color))
        }
        _ => Some(hex(&s.color)),
    }
}

/// 32×32 anti-aliased ring: thick and colored when on, thin and gray when off.
/// A faint dark outline keeps it visible on light taskbars.
fn ring_icon(s: &Settings) -> Image<'static> {
    const N: u32 = 32;
    let c = N as f32 / 2.0;
    let (outer, inner) = if s.enabled { (15.0_f32, 8.0_f32) } else { (14.0, 10.5) };
    let edge_color = [40.0_f32, 40.0, 40.0];

    let mut px = vec![0u8; (N * N * 4) as usize];
    for y in 0..N {
        for x in 0..N {
            let dx = x as f32 + 0.5 - c;
            let dy = y as f32 + 0.5 - c;
            let d = (dx * dx + dy * dy).sqrt();
            let coverage = (outer - d + 0.5).clamp(0.0, 1.0) * (d - inner + 0.5).clamp(0.0, 1.0);
            if coverage <= 0.0 {
                continue;
            }
            let fill = if s.enabled {
                // atan2(dx, -dy): 0 at the top, growing clockwise.
                let t = (dx.atan2(-dy) / std::f32::consts::TAU).rem_euclid(1.0);
                match color_at(s, t) {
                    Some(col) => col,
                    None => continue,
                }
            } else {
                [140.0, 140.0, 140.0]
            };
            // 1 at the ring edges, 0 in the middle.
            let edge = (d - (outer - 1.2)).max((inner + 1.2) - d).clamp(0.0, 1.0);
            let k = if s.enabled { edge * 0.55 } else { 0.0 };
            let i = ((y * N + x) * 4) as usize;
            for ch in 0..3 {
                px[i + ch] = (fill[ch] * (1.0 - k) + edge_color[ch] * k).round() as u8;
            }
            px[i + 3] = (coverage * 255.0).round() as u8;
        }
    }
    Image::new_owned(px, N, N)
}
