//! App preferences, saved as JSON in the app config directory.

use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Where MeshGuard shows up on the desktop.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Display {
    /// Menu-bar / tray icon plus a window and Dock icon.
    TrayAndWindow,
    /// Tray icon only; no Dock icon. The window opens from the tray.
    TrayOnly,
    /// A regular app window; no tray icon.
    WindowOnly,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub display: Display,
    pub launch_at_login: bool,
    /// At launch, stay in the tray instead of opening the window.
    pub start_hidden: bool,
    /// Closing the window keeps the app running in the tray.
    pub close_to_tray: bool,
    /// Control plane used for sign-in.
    pub server: String,
    /// Agent socket; empty for the default (`$MESHGUARD_SOCKET` or the system path).
    pub socket: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            display: Display::TrayAndWindow,
            launch_at_login: false,
            start_hidden: false,
            close_to_tray: true,
            server: std::env::var("MESHGUARD_SERVER")
                .unwrap_or_else(|_| "http://localhost:4000".into()),
            socket: String::new(),
        }
    }
}

pub struct Store {
    path: PathBuf,
    current: Mutex<Settings>,
}

impl Store {
    pub fn load(app: &AppHandle) -> Self {
        let dir = app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from("."));
        let path = dir.join("settings.json");
        let current = fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Self { path, current: Mutex::new(current) }
    }

    pub fn get(&self) -> Settings {
        self.current.lock().unwrap().clone()
    }

    pub fn set(&self, next: Settings) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let data = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
        fs::write(&self.path, data).map_err(|e| e.to_string())?;
        *self.current.lock().unwrap() = next;
        Ok(())
    }
}
