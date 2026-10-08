//! Browser sign-in: the same device-login flow as `meshguard login`. The
//! control plane gives a URL; a signed-in user approves this device for a
//! network there; the poll then returns an enrollment token for the agent.

use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::json;

/// Bumped to cancel a login in progress.
pub static GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Start {
    secret: String,
    user_code: String,
    verification_url: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub user_code: String,
    pub verification_url: String,
    pub expires_in: u64,
}

pub struct Login {
    pub pending: Pending,
    secret: String,
    interval: Duration,
    generation: u64,
}

fn hostname() -> String {
    let out = std::process::Command::new("hostname").output().ok();
    let name = out.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
    name.split('.').next().unwrap_or("").to_string()
}

pub async fn start(server: &str) -> Result<Login, String> {
    let server = server.trim_end_matches('/');
    let res = reqwest::Client::new()
        .post(format!("{server}/v1/device-logins"))
        .json(&json!({ "hostname": hostname(), "platform": std::env::consts::OS }))
        .send()
        .await
        .map_err(|e| format!("can't reach {server}: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("the control plane refused the login ({})", res.status()));
    }
    let s: Start = res.json().await.map_err(|e| e.to_string())?;
    Ok(Login {
        pending: Pending {
            user_code: s.user_code,
            verification_url: s.verification_url,
            expires_in: s.expires_in,
        },
        secret: s.secret,
        interval: Duration::from_secs(s.interval.max(2)),
        generation: GENERATION.fetch_add(1, Ordering::SeqCst) + 1,
    })
}

/// Waits for approval and returns the enrollment token.
pub async fn wait(server: &str, login: Login) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Poll {
        status: String,
        token: Option<String>,
    }
    let server = server.trim_end_matches('/');
    let client = reqwest::Client::new();
    let deadline = tokio_deadline(login.pending.expires_in);
    while std::time::Instant::now() < deadline {
        tokio::time::sleep(login.interval).await;
        if GENERATION.load(Ordering::SeqCst) != login.generation {
            return Err("cancelled".into());
        }
        let res = match client
            .post(format!("{server}/v1/device-logins/poll"))
            .json(&json!({ "secret": login.secret }))
            .send()
            .await
        {
            Ok(r) => r,
            Err(_) => continue, // network blip: keep waiting
        };
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            return Err("the login was denied or expired".into());
        }
        if let Ok(poll) = res.json::<Poll>().await {
            if poll.status == "approved" {
                if let Some(token) = poll.token {
                    return Ok(token);
                }
            }
        }
    }
    Err("the login expired".into())
}

fn tokio_deadline(secs: u64) -> std::time::Instant {
    std::time::Instant::now() + Duration::from_secs(secs)
}

pub fn cancel() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}
