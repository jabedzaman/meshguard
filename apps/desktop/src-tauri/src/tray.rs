//! The tray / menu-bar icon: a glanceable status and the few things you do
//! all day (connect, disconnect, open the window).

use serde_json::Value;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};

use crate::{agent::AgentState, settings::Display, show_window, AppState};

pub const TRAY_ID: &str = "main";

/// Headline for the tooltip and the first menu line.
pub fn title(state: &AgentState) -> String {
    match state {
        AgentState::NotInstalled => "MeshGuard: not set up".into(),
        AgentState::NotRunning => "MeshGuard: agent not running".into(),
        AgentState::Denied { .. } => "MeshGuard: access denied".into(),
        AgentState::Running { status } => match status["state"].as_str() {
            Some("connected") => format!("Connected as {}", status["device"]["name"].as_str().unwrap_or("this device")),
            Some("down") => "Disconnected".into(),
            Some("enrolled") => status["problem"]
                .as_str()
                .map(|p| format!("Connecting: {p}"))
                .unwrap_or_else(|| "Connecting…".into()),
            _ => "Not signed in".into(),
        },
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let menu = menu(app, &state.last())?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("MeshGuard")
        .icon_as_template(true)
        .on_menu_event(|app, event| crate::on_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            // The menu opens on click on macOS; elsewhere a click opens the window.
            if cfg!(not(target_os = "macos")) {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    show_window(tray.app_handle());
                }
            }
        })
        .show_menu_on_left_click(cfg!(target_os = "macos"));
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    sync_visibility(app);
    Ok(())
}

pub fn sync_visibility(app: &AppHandle) {
    let display = app.state::<AppState>().settings.get().display;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(display != Display::WindowOnly);
    }
}

pub fn refresh(app: &AppHandle, state: &AgentState) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let _ = tray.set_tooltip(Some(title(state)));
    if let Ok(menu) = menu(app, state) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn menu(app: &AppHandle, state: &AgentState) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(app, "title", title(state), false, None::<&str>)?)?;

    if let AgentState::Running { status } = state {
        if let Some(net) = status["network"]["name"].as_str() {
            let ip = status["device"]["meshIpv4"].as_str().unwrap_or("");
            menu.append(&MenuItem::with_id(app, "network", format!("{net}  {ip}"), false, None::<&str>)?)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        match status["state"].as_str() {
            Some("connected") | Some("enrolled") => {
                menu.append(&MenuItem::with_id(app, "disconnect", "Disconnect", true, None::<&str>)?)?
            }
            Some("down") => menu.append(&MenuItem::with_id(app, "connect", "Connect", true, None::<&str>)?)?,
            _ => menu.append(&MenuItem::with_id(app, "open", "Sign in…", true, None::<&str>)?)?,
        }
        if let Some(peers) = status["peers"].as_array().filter(|p| !p.is_empty()) {
            menu.append(&peers_menu(app, peers)?)?;
        }
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "open", "Open MeshGuard", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quit MeshGuard", true, Some("CmdOrCtrl+Q"))?)?;
    Ok(menu)
}

fn peers_menu(app: &AppHandle, peers: &[Value]) -> tauri::Result<Submenu<Wry>> {
    let sub = Submenu::with_id(app, "peers", format!("Devices ({})", peers.len()), true)?;
    for (i, p) in peers.iter().enumerate().take(20) {
        let label = format!("{}  {}", p["name"].as_str().unwrap_or("?"), p["meshIpv4"].as_str().unwrap_or(""));
        sub.append(&MenuItem::with_id(app, format!("peer-{i}"), label, false, None::<&str>)?)?;
    }
    Ok(sub)
}
