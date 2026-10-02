mod camera;
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
    time::Duration,
};
use tauri::{menu::CheckMenuItem, AppHandle, Emitter, Manager, RunEvent, WindowEvent, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Argumento usado pela inicialização automática para abrir só na bandeja.
const HIDDEN_ARG: &str = "--hidden";

pub struct AppState {
    pub settings: Mutex<Settings>,
    config_path: PathBuf,
    dirty: AtomicBool,
    /// A luz foi acesa pela câmera e deve apagar quando a câmera desligar.
    camera_turned_on: AtomicBool,
    pub hide_generation: AtomicU64,
    pub tray_toggle: Mutex<Option<CheckMenuItem<Wry>>>,
}

fn current(app: &AppHandle) -> Settings {
    app.state::<AppState>().settings.lock().unwrap().clone()
}

/// Propaga uma mudança de configuração para sobreposições, bandeja, janelas e disco.
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

/// Liga/desliga por ação do usuário (bandeja ou atalho).
pub fn toggle(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.camera_turned_on.store(false, Ordering::SeqCst);
    let on = !state.settings.lock().unwrap().enabled;
    set_enabled_internal(app, on);
}

pub fn show_settings(app: &AppHandle) {
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
        eprintln!("não foi possível salvar as configurações: {e}");
    }
}

fn register_hotkey(app: &AppHandle, old: &str, new: &str) -> Result<(), String> {
    let shortcut = if new.is_empty() {
        None
    } else {
        Some(
            new.parse::<Shortcut>()
                .map_err(|_| format!("\"{new}\" não é um atalho válido."))?,
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
        "Esse atalho já está em uso por outro programa. Escolha outra combinação.".to_string()
    })
}

// ---------------------------------------------------------------- comandos

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorInfo {
    id: String,
    label: String,
    primary: bool,
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
            let number = if digits.is_empty() { (i + 1).to_string() } else { digits };
            let is_primary = primary.as_deref() == Some(id.as_str());
            let size = m.size();
            Some(MonitorInfo {
                label: format!(
                    "Tela {number} · {}×{}{}",
                    size.width,
                    size.height,
                    if is_primary { " (principal)" } else { "" }
                ),
                id,
                primary: is_primary,
            })
        })
        .collect()
}

/// Atualiza aparência, monitor e automações. `enabled`, `hotkey` e `autostart`
/// têm comandos próprios porque podem falhar ou mudar fora desta janela.
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
        result.map_err(|e| format!("Não foi possível alterar a inicialização automática: {e}"))?;
    }
    app.state::<AppState>().settings.lock().unwrap().autostart = enabled;
    changed(&app);
    Ok(current(&app))
}

// ------------------------------------------------------- tarefa de fundo

/// A cada segundo: acompanha a câmera, mantém as sobreposições no lugar
/// (monitores trocados, DPI, outras janelas "sempre no topo") e salva no disco.
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

// ------------------------------------------------------------------- app

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hidden = std::env::args().any(|a| a == HIDDEN_ARG);

    let app = tauri::Builder::default()
        // Precisa ser o primeiro plugin: uma segunda instância só abre as configurações.
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
                tray_toggle: Mutex::new(None),
            });

            if let Err(e) = register_hotkey(&handle, "", &hotkey) {
                eprintln!("{e}");
            }
            tray::create(&handle)?;
            overlay::sync(&handle);
            if !hidden {
                show_settings(&handle);
            }
            thread::spawn(move || background(handle));
            Ok(())
        })
        .on_window_event(|window, event| {
            // Fechar as configurações só esconde a janela; o app continua na bandeja.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "settings" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            list_monitors,
            update_settings,
            set_enabled,
            set_hotkey,
            set_autostart
        ])
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Ringlight");

    app.run(|_app, event| {
        // Sem janelas visíveis o app continua vivo na bandeja; só sai pelo menu.
        if let RunEvent::ExitRequested { api, code, .. } = event {
            if code.is_none() {
                api.prevent_exit();
            }
        }
    });
}
