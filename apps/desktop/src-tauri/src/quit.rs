//! Quitting the app doesn't have to stop the network: the agent is a system
//! service. While connected, ask whether to leave it running, like Tailscale's
//! "Quit (Leave VPN Active)".

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager};

use crate::{agent::AgentState, commands, AppState};

static ASKING: AtomicBool = AtomicBool::new(false);

enum Choice {
    Keep,
    Disconnect,
    Cancel,
}

fn connected(app: &AppHandle) -> bool {
    match app.state::<AppState>().last() {
        AgentState::Running { status } => matches!(status["state"].as_str(), Some("connected" | "enrolled")),
        _ => false,
    }
}

#[cfg(target_os = "macos")]
fn ask() -> Choice {
    let script = r#"button returned of (display dialog "MeshGuard is connected. Keep it running in the background after you quit?" with title "Quit MeshGuard" with icon note buttons {"Cancel", "Disconnect & Quit", "Keep Running"} default button "Keep Running" cancel button "Cancel")"#;
    match std::process::Command::new("osascript").args(["-e", script]).output() {
        Ok(out) if out.status.success() => match String::from_utf8_lossy(&out.stdout).trim() {
            "Disconnect & Quit" => Choice::Disconnect,
            _ => Choice::Keep,
        },
        Ok(_) => Choice::Cancel,
        // Can't ask: quit without touching the connection.
        Err(_) => Choice::Keep,
    }
}

#[cfg(not(target_os = "macos"))]
fn ask() -> Choice {
    Choice::Keep
}

/// Every user-initiated quit (tray, ⌘Q, Dock) lands here.
pub fn request(app: &AppHandle) {
    if !connected(app) {
        app.exit(0);
        return;
    }
    if ASKING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let choice = ask();
        ASKING.store(false, Ordering::SeqCst);
        match choice {
            Choice::Cancel => return,
            Choice::Disconnect => {
                let _ = tauri::async_runtime::block_on(commands::set_connected(app.clone(), false));
            }
            Choice::Keep => {}
        }
        app.exit(0);
    });
}
