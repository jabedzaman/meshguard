//! Client for the agent's local API: HTTP over its Unix socket (docs/cli.md).
//! Speaks HTTP/1.0 so the reply is never chunked and ends when the agent closes.

use std::{
    io::{Read, Write},
    path::Path,
    time::Duration,
};

use serde::Serialize;
use serde_json::Value;

pub const DEFAULT_SOCKET: &str = "/var/run/meshguard/agent.sock";
pub const SERVICE_PLIST: &str = "/Library/LaunchDaemons/dev.jabed.meshguard.agent.plist";

pub fn socket_path(configured: &str) -> String {
    if !configured.is_empty() {
        return configured.to_string();
    }
    std::env::var("MESHGUARD_SOCKET").unwrap_or_else(|_| DEFAULT_SOCKET.to_string())
}

/// How the desktop app sees the agent.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentState {
    /// No service and no socket: needs installing.
    NotInstalled,
    /// Installed but not answering.
    NotRunning,
    /// Answering, but refuses this user.
    Denied { message: String },
    Running { status: Value },
}

pub enum Failure {
    /// The agent answered with an error.
    Api(String),
    Missing,
    Denied(String),
    Other(String),
}

impl Failure {
    pub fn message(&self) -> String {
        match self {
            Failure::Api(m) | Failure::Denied(m) | Failure::Other(m) => m.clone(),
            Failure::Missing => "the MeshGuard agent isn't running".into(),
        }
    }
}

pub fn request(socket: &str, method: &str, path: &str, body: Option<&Value>) -> Result<Value, Failure> {
    use std::os::unix::net::UnixStream;

    let mut stream = UnixStream::connect(socket).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => Failure::Missing,
        std::io::ErrorKind::PermissionDenied => {
            Failure::Denied("this user may not control the agent: reinstall it from MeshGuard".into())
        }
        _ => Failure::Other(e.to_string()),
    })?;
    // Enrolling talks to the control plane (30s on the agent's side).
    let timeout = Some(Duration::from_secs(40));
    let _ = stream.set_read_timeout(timeout);
    let _ = stream.set_write_timeout(timeout);

    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let head = format!(
        "{method} {path} HTTP/1.0\r\nHost: agent\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
        payload.len()
    );
    stream
        .write_all(head.as_bytes())
        .and_then(|_| stream.write_all(payload.as_bytes()))
        .map_err(|e| Failure::Other(e.to_string()))?;

    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).map_err(|e| Failure::Other(e.to_string()))?;

    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| Failure::Other("malformed reply from the agent".into()))?;
    let status: u16 = std::str::from_utf8(&raw[..split])
        .ok()
        .and_then(|h| h.split_whitespace().nth(1))
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| Failure::Other("malformed reply from the agent".into()))?;
    let body: Value = serde_json::from_slice(&raw[split + 4..]).unwrap_or(Value::Null);

    match status {
        200..=299 => Ok(body),
        403 => Err(Failure::Denied(error_message(&body, "the agent refused this user"))),
        404 => Err(Failure::Api("the agent is older than this app: reinstall it".into())),
        _ => Err(Failure::Api(error_message(&body, "the agent returned an error"))),
    }
}

fn error_message(body: &Value, fallback: &str) -> String {
    body.get("message").and_then(Value::as_str).unwrap_or(fallback).to_string()
}

pub fn state(socket: &str) -> AgentState {
    match request(socket, "GET", "/v1/status", None) {
        Ok(status) => AgentState::Running { status },
        Err(Failure::Denied(message)) => AgentState::Denied { message },
        Err(Failure::Missing) if !installed(socket) => AgentState::NotInstalled,
        Err(_) => AgentState::NotRunning,
    }
}

fn installed(socket: &str) -> bool {
    Path::new(SERVICE_PLIST).exists() || Path::new("/etc/systemd/system/meshguard-agent.service").exists() || Path::new(socket).exists()
}
