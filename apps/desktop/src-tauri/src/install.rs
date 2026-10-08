//! Installs the agent and CLI bundled in the app as a system service, like
//! Tailscale's app does: one download, one admin prompt. `meshguard-agent
//! install` copies both binaries to /usr/local/bin and registers the service.

use std::{path::PathBuf, process::Command};

use tauri::{AppHandle, Manager};

fn bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("bin"));
    }
    if let Ok(dir) = std::env::var("MESHGUARD_BIN_DIR") {
        candidates.push(PathBuf::from(dir));
    }
    // `tauri dev`: the folder scripts/build-desktop-bins.sh fills.
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin"));
    candidates
        .into_iter()
        .find(|d| d.join("meshguard-agent").is_file())
        .ok_or_else(|| "this build of MeshGuard has no agent bundled (run scripts/build-desktop-bins.sh)".to_string())
}

fn ids() -> Result<(String, String), String> {
    let id = |flag: &str| -> Result<String, String> {
        let out = Command::new("id").arg(flag).output().map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    };
    Ok((id("-u")?, id("-g")?))
}

/// Runs `meshguard-agent <verb> ...` as root, asking the user for permission.
fn privileged(agent: &str, args: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let quoted = format!("'{}' {args}", agent.replace('\'', r"'\''"));
        let script = format!(
            "do shell script \"{}\" with administrator privileges",
            quoted.replace('\\', "\\\\").replace('"', "\\\"")
        );
        let out = Command::new("osascript").args(["-e", &script]).output().map_err(|e| e.to_string())?;
        if out.status.success() {
            return Ok(());
        }
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(if err.contains("-128") {
            "cancelled".into()
        } else {
            err.trim().to_string()
        });
    }
    #[cfg(target_os = "linux")]
    {
        let out = Command::new("sh")
            .args(["-c", &format!("pkexec '{}' {args}", agent.replace('\'', r"'\''"))])
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            return Ok(());
        }
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    #[allow(unreachable_code)]
    {
        let _ = (agent, args);
        Err("installing the agent isn't supported on this platform yet".into())
    }
}

/// Installs (or updates) the agent service. The current user owns the socket,
/// so neither this app nor `meshguard` needs sudo afterwards.
pub fn install(app: &AppHandle) -> Result<(), String> {
    let agent = bin_dir(app)?.join("meshguard-agent");
    let (uid, gid) = ids()?;
    privileged(&agent.to_string_lossy(), &format!("install -socket-owner {uid}:{gid}"))
}

pub fn uninstall(app: &AppHandle) -> Result<(), String> {
    let agent = bin_dir(app)?.join("meshguard-agent");
    privileged(&agent.to_string_lossy(), "uninstall")
}
