mod camera;
mod flyout;
mod i18n;
mod overlay;
mod settings;
mod tray;
mod win;

use serde::Serialize;
use settings::Settings;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Argument passed by start-with-Windows so the app opens in the tray only.
const HIDDEN_ARG: &str = "--hidden";

pub struct AppState {
    pub settings: Mutex<Settings>,
    config_path: PathBuf,
    dirty: AtomicBool,
    /// The camera turned the light on, so it should turn it off again.
    camera_turned_on: AtomicBool,
    pub hide_generation: AtomicU64,
    pub tray_items: Mutex<Option<tray::TrayItems>>,
    /// When the tray panel was last hidden (see `flyout::REOPEN_GUARD`).
    pub flyout_hidden_at: Mutex<Option<Instant>>,
    /// The panel's content height (logical px) and the tray icon it opened
    /// from, so it can be resized in place.
    pub flyout_height: Mutex<f64>,
    pub flyout_icon: Mutex<Option<tauri::Rect>>,
}

fn current(app: &AppHandle) -> Settings {
    app.state::<AppState>().settings.lock().unwrap().clone()
}

fn text(app: &AppHandle) -> &'static i18n::Text {
    i18n::resolve(&current(app).language).text()
}

/// Propagates a settings change to the overlays, tray, windows and disk.
fn changed(app: &AppHandle) {
    app.state::<AppState>().dirty.store(true, Ordering::SeqCst);
    overlay::request_sync(app);
    tray::refresh(app);
    let _ = app.emit("settings-changed", current(app));
}

fn set_enabled_internal(app: &AppHandle, on: bool) {
    app.state::<AppState>().settings.lock().unwrap().enabled = on;
    changed(app);
}

/// Turns the light on/off on user request (tray or shortcut).
pub fn toggle(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.camera_turned_on.store(false, Ordering::SeqCst);
    let on = !state.settings.lock().unwrap().enabled;
    set_enabled_internal(app, on);
}

pub fn show_settings(app: &AppHandle) {
    flyout::hide(app);
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn quit(app: &AppHandle) {
    save_now(app);
    app.exit(0);
}

fn save_now(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.dirty.store(false, Ordering::SeqCst);
    let s = state.settings.lock().unwrap().clone();
    if let Err(e) = settings::save(&state.config_path, &s) {
        eprintln!("couldn't save settings: {e}");
    }
}

fn register_hotkey(app: &AppHandle, old: &str, new: &str) -> Result<(), String> {
    let text = text(app);
    let shortcut = if new.is_empty() {
        None
    } else {
        Some(
            new.parse::<Shortcut>()
                .map_err(|_| text.hotkey_invalid.replace("{}", new))?,
        )
    };
    let gs = app.global_shortcut();
    if !old.is_empty() {
        let _ = gs.unregister(old);
    }
    let Some(shortcut) = shortcut else {
        return Ok(());
    };
    gs.register(shortcut).map_err(|_| {
        if !old.is_empty() {
            let _ = gs.register(old);
        }
        text.hotkey_in_use.to_string()
    })
}

// ---------------------------------------------------------------- commands

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    /// Language detected from Windows, used when the setting is "auto".
    system_language: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorInfo {
    id: String,
    /// Windows display number (the N in `\\.\DISPLAYN`).
    number: String,
    width: u32,
    height: u32,
    primary: bool,
}

#[tauri::command]
async fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        system_language: i18n::system().code(),
    }
}

#[tauri::command]
async fn open_settings(app: AppHandle) {
    show_settings(&app);
}

#[tauri::command]
async fn hide_flyout(app: AppHandle) {
    flyout::hide(&app);
}

#[tauri::command]
async fn resize_flyout(app: AppHandle, height: f64) {
    flyout::resize(&app, height);
}

#[tauri::command]
async fn get_settings(app: AppHandle) -> Settings {
    current(&app)
}

#[tauri::command]
async fn list_monitors(app: AppHandle) -> Vec<MonitorInfo> {
    let primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|m| m.name().cloned());
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .filter_map(|(i, m)| {
            let id = m.name()?.clone();
            let digits: String = id.chars().filter(char::is_ascii_digit).collect();
            let size = m.size();
            Some(MonitorInfo {
                number: if digits.is_empty() { (i + 1).to_string() } else { digits },
                width: size.width,
                height: size.height,
                primary: primary.as_deref() == Some(id.as_str()),
                id,
            })
        })
        .collect()
}

/// Updates appearance, display, language and automations. `enabled`, `hotkey`
/// and `autostart` have their own commands because they can fail or change
/// outside the settings window.
#[tauri::command]
async fn update_settings(app: AppHandle, settings: Settings) -> Settings {
    let mut next = settings;
    {
        let state = app.state::<AppState>();
        let mut cur = state.settings.lock().unwrap();
        next.enabled = cur.enabled;
        next.hotkey = cur.hotkey.clone();
        next.autostart = cur.autostart;
        next.sanitize();
        if *cur == next {
            return next;
        }
        *cur = next.clone();
    }
    changed(&app);
    next
}

#[tauri::command]
async fn set_enabled(app: AppHandle, enabled: bool) -> Settings {
    app.state::<AppState>()
        .camera_turned_on
        .store(false, Ordering::SeqCst);
    set_enabled_internal(&app, enabled);
    current(&app)
}

#[tauri::command]
async fn set_hotkey(app: AppHandle, hotkey: String) -> Result<Settings, String> {
    let hotkey = hotkey.trim().to_string();
    let old = current(&app).hotkey;
    register_hotkey(&app, &old, &hotkey)?;
    app.state::<AppState>().settings.lock().unwrap().hotkey = hotkey;
    changed(&app);
    Ok(current(&app))
}

#[tauri::command]
async fn set_autostart(app: AppHandle, enabled: bool) -> Result<Settings, String> {
    let launcher = app.autolaunch();
    if launcher.is_enabled().unwrap_or(!enabled) != enabled {
        let result = if enabled { launcher.enable() } else { launcher.disable() };
        result.map_err(|e| text(&app).autostart_failed.replace("{}", &e.to_string()))?;
    }
    app.state::<AppState>().settings.lock().unwrap().autostart = enabled;
    changed(&app);
    Ok(current(&app))
}

// ---------------------------------------------------------- background task

/// Every second: follows the camera, keeps the overlays in place (monitor
/// changes, DPI, other always-on-top windows) and saves settings to disk.
fn background(app: AppHandle) {
    let mut camera_was = camera::in_use();
    loop {
        thread::sleep(Duration::from_secs(1));
        let state = app.state::<AppState>();
        let (enabled, auto_camera) = {
            let s = state.settings.lock().unwrap();
            (s.enabled, s.auto_camera)
        };

        let camera = camera::in_use();
        if camera != camera_was {
            camera_was = camera;
            if auto_camera && camera && !enabled {
                state.camera_turned_on.store(true, Ordering::SeqCst);
                set_enabled_internal(&app, true);
            } else if !camera && state.camera_turned_on.swap(false, Ordering::SeqCst) && enabled {
                set_enabled_internal(&app, false);
            }
        }

        if enabled {
            overlay::request_sync(&app);
        }
        if state.dirty.load(Ordering::SeqCst) {
            save_now(&app);
        }
    }
}

// --------------------------------------------------------------------- app

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hidden = std::env::args().any(|a| a == HIDDEN_ARG);

    let app = tauri::Builder::default()
        // Must be the first plugin: a second instance just opens the settings.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_settings(app)
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_ARG]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle(app);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let handle = app.handle().clone();
            let config_path = app.path().app_config_dir()?.join("settings.json");
            let first_run = !config_path.exists();

            let mut s = settings::load(&config_path);
            s.enabled = !hidden;
            s.autostart = app.autolaunch().is_enabled().unwrap_or(false);
            let hotkey = s.hotkey.clone();

            app.manage(AppState {
                settings: Mutex::new(s),
                config_path,
                dirty: AtomicBool::new(first_run),
                camera_turned_on: AtomicBool::new(false),
                hide_generation: AtomicU64::new(0),
                tray_items: Mutex::new(None),
                flyout_hidden_at: Mutex::new(None),
                flyout_height: Mutex::new(flyout::INITIAL_HEIGHT),
                flyout_icon: Mutex::new(None),
            });

            if let Err(e) = register_hotkey(&handle, "", &hotkey) {
                eprintln!("{e}");
            }
            tray::create(&handle)?;
            flyout::create(&handle)?;
            overlay::sync(&handle);
            if !hidden {
                show_settings(&handle);
            }
            thread::spawn(move || background(handle));
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            // Closing the settings only hides the window; the app stays in the tray.
            ("settings", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.hide();
            }
            // The light goes under the settings window while it's in use
            // (see `overlay::sync`), so restack as soon as focus changes.
            ("settings", WindowEvent::Focused(_)) => overlay::request_sync(window.app_handle()),
            // The tray panel closes like a Windows flyout: as soon as it loses focus.
            (flyout::LABEL, WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                flyout::hide(window.app_handle());
            }
            (flyout::LABEL, WindowEvent::Focused(false)) => flyout::hide(window.app_handle()),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            open_settings,
            hide_flyout,
            resize_flyout,
            get_settings,
            list_monitors,
            update_settings,
            set_enabled,
            set_hotkey,
            set_autostart
        ])
        .build(tauri::generate_context!())
        .expect("error while starting Ringlight");

    app.run(|_app, event| {
        // With no visible window the app keeps running in the tray; only the menu quits.
        if let RunEvent::ExitRequested { api, code, .. } = event {
            if code.is_none() {
                api.prevent_exit();
            }
        }
    });
}
