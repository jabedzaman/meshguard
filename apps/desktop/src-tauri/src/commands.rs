//! Commands the web UI calls.

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::{
    agent::{self, AgentState},
    install, login,
    settings::Settings,
    AppState,
};

type Res<T> = Result<T, String>;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_state(state: State<'_, AppState>) -> AgentState {
    state.last()
}

/// Sends an API call to the agent, then publishes the new state at once.
async fn call(app: &AppHandle, method: &'static str, path: &'static str, body: Option<Value>) -> Res<Value> {
    let socket = agent::socket_path(&app.state::<AppState>().settings.get().socket);
    let out = blocking(move || agent::request(&socket, method, path, body.as_ref())).await?;
    crate::poll_now(app);
    out.map_err(|f| f.message())
}

#[tauri::command]
pub async fn set_connected(app: AppHandle, connected: bool) -> Res<()> {
    // /v1/up decodes a JSON body (an empty one is "invalid request body").
    let (path, body) = if connected { ("/v1/up", Some(json!({}))) } else { ("/v1/down", None) };
    call(&app, "POST", path, body).await.map(|_| ())
}

#[tauri::command]
pub async fn logout(app: AppHandle, force: bool) -> Res<()> {
    call(&app, "POST", "/v1/logout", Some(json!({ "force": force }))).await.map(|_| ())
}

#[tauri::command]
pub async fn update_prefs(app: AppHandle, update: Value) -> Res<Value> {
    call(&app, "PATCH", "/v1/prefs", Some(update)).await
}

#[tauri::command]
pub async fn join_with_token(app: AppHandle, token: String) -> Res<()> {
    let server = app.state::<AppState>().settings.get().server;
    call(&app, "POST", "/v1/up", Some(json!({ "token": token, "server": server })))
        .await
        .map(|_| ())
}

/// Starts a browser sign-in. Returns the code to show; "login-finished" fires
/// when it ends, carrying an error message or null.
#[tauri::command]
pub async fn login_start(app: AppHandle) -> Res<login::Pending> {
    let server = app.state::<AppState>().settings.get().server;
    let started = login::start(&server).await?;
    let pending = started.pending.clone();
    let _ = tauri_plugin_opener::open_url(&pending.verification_url, None::<&str>);

    tauri::async_runtime::spawn(async move {
        let result = match login::wait(&server, started).await {
            Ok(token) => call(&app, "POST", "/v1/up", Some(json!({ "token": token, "server": server })))
                .await
                .map(|_| ()),
            Err(e) => Err(e),
        };
        let _ = app.emit("login-finished", result.err());
    });
    Ok(pending)
}

#[tauri::command]
pub fn login_cancel() {
    login::cancel();
}

#[tauri::command]
pub async fn install_agent(app: AppHandle) -> Res<()> {
    let handle = app.clone();
    let out = blocking(move || install::install(&handle)).await?;
    crate::poll_now(&app);
    out
}

#[tauri::command]
pub async fn uninstall_agent(app: AppHandle) -> Res<()> {
    let handle = app.clone();
    let out = blocking(move || install::uninstall(&handle)).await?;
    crate::poll_now(&app);
    out
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.get()
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Res<Settings> {
    let state = app.state::<AppState>();
    let before = state.settings.get();
    state.settings.set(settings.clone())?;

    if settings.launch_at_login != before.launch_at_login {
        let auto = app.autolaunch();
        let result = if settings.launch_at_login { auto.enable() } else { auto.disable() };
        result.map_err(|e| e.to_string())?;
    }
    crate::apply_display(&app);
    crate::poll_now(&app);
    Ok(settings)
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}
