//! Ícone na bandeja do sistema, desenhado com a cor atual da luz.

use crate::{show_settings, toggle, AppState};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const TRAY_ID: &str = "main";

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let s = app.state::<AppState>().settings.lock().unwrap().clone();

    let toggle_item = CheckMenuItem::with_id(app, "toggle", "Ringlight ligada", true, s.enabled, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Configurações…", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle_item,
            &settings_item,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(ring_icon(s.rgb(), s.enabled))
        .tooltip(tooltip(s.enabled))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => toggle(app),
            "settings" => show_settings(app),
            "quit" => crate::quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_settings(tray.app_handle());
            }
        })
        .build(app)?;

    *app.state::<AppState>().tray_toggle.lock().unwrap() = Some(toggle_item);
    Ok(())
}

pub fn refresh(app: &AppHandle) {
    let state = app.state::<AppState>();
    let s = state.settings.lock().unwrap().clone();
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_icon(Some(ring_icon(s.rgb(), s.enabled)));
        let _ = tray.set_tooltip(Some(tooltip(s.enabled)));
    }
    let item = state.tray_toggle.lock().unwrap().clone();
    if let Some(item) = item {
        let _ = item.set_checked(s.enabled);
    }
}

fn tooltip(enabled: bool) -> &'static str {
    if enabled {
        "Ringlight — ligada"
    } else {
        "Ringlight — desligada"
    }
}

/// Anel 32×32 com antisserrilhado: preenchido com a cor da luz quando ligada,
/// fino e cinza quando desligada. Um contorno escuro discreto mantém o anel
/// visível em barras de tarefas claras.
fn ring_icon(rgb: [u8; 3], on: bool) -> Image<'static> {
    const N: u32 = 32;
    let c = N as f32 / 2.0;
    let (outer, inner) = if on { (15.0_f32, 8.0_f32) } else { (14.0, 10.5) };
    let edge_color = [40.0_f32, 40.0, 40.0];
    let fill = if on {
        rgb.map(f32::from)
    } else {
        [140.0, 140.0, 140.0]
    };

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
            // 1 nas bordas do anel, 0 no miolo.
            let edge = (d - (outer - 1.2)).max((inner + 1.2) - d).clamp(0.0, 1.0);
            let k = if on { edge * 0.55 } else { 0.0 };
            let i = ((y * N + x) * 4) as usize;
            for ch in 0..3 {
                px[i + ch] = (fill[ch] * (1.0 - k) + edge_color[ch] * k).round() as u8;
            }
            px[i + 3] = (coverage * 255.0).round() as u8;
        }
    }
    Image::new_owned(px, N, N)
}
