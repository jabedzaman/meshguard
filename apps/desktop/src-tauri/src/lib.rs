mod agent;
mod commands;
mod install;
mod login;
mod settings;
mod tray;

use std::{
    sync::{mpsc, Mutex},
    time::Duration,
};

use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

use agent::AgentState;
use settings::Display;

pub struct AppState {
    pub settings: settings::Store,
    last: Mutex<AgentState>,
    wake: Mutex<mpsc::Sender<()>>,
}

impl AppState {
    pub fn last(&self) -> AgentState {
        self.last.lock().unwrap().clone()
    }
}

/// Asks the poller to check the agent now instead of at its next tick.
pub fn poll_now(app: &AppHandle) {
    let _ = app.state::<AppState>().wake.lock().unwrap().send(());
}

pub fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Applies the display mode: the Dock icon and the tray icon.
pub fn apply_display(app: &AppHandle) {
    let display = app.state::<AppState>().settings.get().display;
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(match display {
        Display::TrayOnly => tauri::ActivationPolicy::Accessory,
        _ => tauri::ActivationPolicy::Regular,
    });
    tray::sync_visibility(app);
}

pub fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => show_window(app),
        "settings" => {
            show_window(app);
            let _ = app.emit("navigate", "settings");
        }
        "connect" | "disconnect" => {
            let app = app.clone();
            let connect = id == "connect";
            tauri::async_runtime::spawn(async move {
                let _ = commands::set_connected(app, connect).await;
            });
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

fn spawn_poller(app: AppHandle, wake: mpsc::Receiver<()>) {
    std::thread::spawn(move || loop {
        let state = app.state::<AppState>();
        let socket = agent::socket_path(&state.settings.get().socket);
        let next = agent::state(&socket);

        let changed = {
            let mut last = state.last.lock().unwrap();
            let changed = *last != next;
            *last = next.clone();
            changed
        };
        if changed {
            tray::refresh(&app, &next);
            let _ = app.emit("agent-state", &next);
        }
        // Wait for the next tick, or an early nudge after an action.
        let _ = wake.recv_timeout(Duration::from_secs(2));
        while wake.try_recv().is_ok() {}
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_window(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .invoke_handler(tauri::generate_handler![
            commands::agent_state,
            commands::set_connected,
            commands::logout,
            commands::update_prefs,
            commands::join_with_token,
            commands::login_start,
            commands::login_cancel,
            commands::install_agent,
            commands::uninstall_agent,
            commands::get_settings,
            commands::set_settings,
            commands::quit,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let (wake_tx, wake_rx) = mpsc::channel();
            app.manage(AppState {
                settings: settings::Store::load(&handle),
                last: Mutex::new(AgentState::NotRunning),
                wake: Mutex::new(wake_tx),
            });

            apply_display(&handle);
            tray::build(&handle)?;
            spawn_poller(handle.clone(), wake_rx);

            // Started by the login item: stay out of the way if asked to.
            let background = std::env::args().any(|a| a == "--background");
            let settings = handle.state::<AppState>().settings.get();
            let hide = settings.display == Display::TrayOnly || (background && settings.start_hidden);
            if !hide {
                show_window(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let settings = window.app_handle().state::<AppState>().settings.get();
                if settings.close_to_tray || settings.display == Display::TrayOnly {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        // Clicking the Dock icon with no window open brings it back.
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { has_visible_windows: false, .. } = event {
            show_window(app);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}
