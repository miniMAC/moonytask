mod drive;
mod merge;
mod oauth;

use crate::db::{self, Db};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use tauri::{AppHandle, Emitter, Manager, State};

static SYNC_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
/// Epoch dell'ultima modifica locale non ancora sincronizzata (0 = pulito).
static DIRTY_SINCE: AtomicI64 = AtomicI64::new(0);

const DEBOUNCE_SECS: i64 = 20;
const PERIODIC_SECS: u64 = 15 * 60;

/// Segnala che i dati locali sono cambiati: la sync partirà poco dopo.
pub fn mark_dirty() {
    DIRTY_SINCE.store(db::now_secs(), Ordering::SeqCst);
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub configured: bool,
    pub connected: bool,
    pub email: Option<String>,
    pub last_sync: Option<i64>,
    pub last_error: Option<String>,
    pub in_progress: bool,
}

/// Credenziali OAuth incorporate in fase di build. Il file reale è locale/secret;
/// build.rs usa il template vuoto nelle build che non configurano Google Drive.
const EMBEDDED_CREDENTIALS: &str =
    include_str!(concat!(env!("OUT_DIR"), "/google_credentials.json"));

#[derive(serde::Deserialize)]
struct EmbeddedCreds {
    client_id: String,
    client_secret: String,
}

fn credentials(app: &AppHandle) -> Option<(String, String)> {
    if let Ok(c) = serde_json::from_str::<EmbeddedCreds>(EMBEDDED_CREDENTIALS) {
        if !c.client_id.is_empty() && !c.client_secret.is_empty() {
            return Some((c.client_id, c.client_secret));
        }
    }
    // fallback: credenziali salvate nelle impostazioni
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap();
    let id = db::get_setting(&conn, "google_client_id")?;
    let secret = db::get_setting(&conn, "google_client_secret")?;
    if id.is_empty() || secret.is_empty() {
        return None;
    }
    Some((id, secret))
}

/// Returns the access token belonging to the Google account already connected
/// to Drive. Master uses it only to establish a short backend identity session.
pub(crate) fn identity_access_token(app: &AppHandle) -> Result<String, String> {
    let (client_id, client_secret) = credentials(app).ok_or("not_configured")?;
    oauth::valid_access_token(app, &client_id, &client_secret)
}

fn status(app: &AppHandle) -> SyncStatus {
    let configured = credentials(app).is_some();
    let connected = oauth::load_tokens(app).is_some();
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap();
    SyncStatus {
        configured,
        connected,
        email: db::get_setting(&conn, "google_email").filter(|v| !v.is_empty()),
        last_sync: db::get_setting(&conn, "sync_last_ts").and_then(|v| v.parse().ok()),
        last_error: db::get_setting(&conn, "sync_last_error").filter(|v| !v.is_empty()),
        in_progress: SYNC_IN_PROGRESS.load(Ordering::SeqCst),
    }
}

fn emit_status(app: &AppHandle) {
    let _ = app.emit("sync_state", status(app));
}

fn perform_sync(app: &AppHandle) -> Result<(), String> {
    let (client_id, client_secret) = credentials(app).ok_or("not_configured")?;
    let token = oauth::valid_access_token(app, &client_id, &client_secret)?;

    let file_id = drive::find_file(&token)?;
    let mut remote: merge::Snapshot = match &file_id {
        Some(id) => serde_json::from_str(&drive::download(&token, id)?)
            .map_err(|e| format!("bad_remote_snapshot: {e}"))?,
        None => merge::Snapshot::default(),
    };

    // migrazione dal file col vecchio nome (TinyTime): i suoi dati entrano nel
    // merge e, a upload riuscito, il file viene eliminato da Drive
    let legacy_id = drive::find_legacy_file(&token)?;
    if let Some(id) = &legacy_id {
        let legacy: merge::Snapshot = serde_json::from_str(&drive::download(&token, id)?)
            .map_err(|e| format!("bad_legacy_snapshot: {e}"))?;
        remote = merge::merge(remote, legacy);
    }

    let db = app.state::<Db>();
    let merged = {
        let mut conn = db.0.lock().unwrap();
        let local = merge::load_local(&conn)?;
        let merged = merge::merge(local, remote);
        merge::apply(&mut conn, &merged)?;
        merged
    };

    let body = serde_json::to_string(&merged).map_err(|e| e.to_string())?;
    drive::upload(&token, file_id.as_deref(), &body)?;
    if let Some(id) = &legacy_id {
        let _ = drive::delete_file(&token, id);
    }

    {
        let conn = db.0.lock().unwrap();
        let _ = db::set_setting(&conn, "sync_last_ts", &db::now_secs().to_string());
        let _ = db::set_setting(&conn, "sync_last_error", "");
    }
    let _ = app.emit("data_changed", ());
    Ok(())
}

fn run_sync_mode(app: &AppHandle, publish_after_success: bool) -> Result<(), String> {
    if SYNC_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return Err("sync_in_progress".into());
    }
    emit_status(app);
    let result = perform_sync(app);
    if let Err(e) = &result {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        let _ = db::set_setting(&conn, "sync_last_error", e);
    }
    SYNC_IN_PROGRESS.store(false, Ordering::SeqCst);
    emit_status(app);
    if result.is_ok() && publish_after_success {
        crate::master::request_publication(app);
    }
    result
}

fn run_sync(app: &AppHandle) {
    let _ = run_sync_mode(app, true);
}

/// Used exactly once after a publication `412`. It refreshes the local Drive
/// snapshot without scheduling a second publication loop; the caller retries
/// the upload once with the new backend revision.
pub(crate) fn sync_for_master_retry(app: &AppHandle) -> Result<(), String> {
    if !ready(app) {
        return Err("not_connected".into());
    }
    run_sync_mode(app, false)
}

fn ready(app: &AppHandle) -> bool {
    credentials(app).is_some() && oauth::load_tokens(app).is_some()
}

/// Sync in background, fire-and-forget. No-op se non configurato o non connesso.
pub fn request_sync(app: &AppHandle) {
    if !ready(app) {
        return;
    }
    DIRTY_SINCE.store(0, Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || run_sync(&app));
}

/// Sync bloccante usata alla chiusura dell'app (best effort, con timeout di rete).
pub fn sync_before_exit(app: &AppHandle) {
    if ready(app) {
        run_sync(app);
    }
}

/// Thread di auto-sync: a ogni modifica (debounce 20s) e comunque ogni 15 minuti.
pub fn spawn_auto_sync(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_periodic = std::time::Instant::now();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(10));
            let dirty = DIRTY_SINCE.load(Ordering::SeqCst);
            let due_debounce = dirty > 0 && db::now_secs() - dirty >= DEBOUNCE_SECS;
            let due_periodic = last_periodic.elapsed().as_secs() >= PERIODIC_SECS;
            if !(due_debounce || due_periodic) {
                continue;
            }
            if ready(&app) {
                DIRTY_SINCE.store(0, Ordering::SeqCst);
                last_periodic = std::time::Instant::now();
                run_sync(&app);
            } else {
                // niente credenziali/login: inutile ritentare a raffica
                DIRTY_SINCE.store(0, Ordering::SeqCst);
                last_periodic = std::time::Instant::now();
            }
        }
    });
}

// ---------- commands ----------

#[tauri::command]
pub fn sync_status(app: AppHandle) -> SyncStatus {
    status(&app)
}

#[tauri::command]
pub fn sync_set_credentials(
    app: AppHandle,
    db: State<Db>,
    client_id: String,
    client_secret: String,
) -> Result<(), String> {
    {
        let conn = db.0.lock().unwrap();
        db::set_setting(&conn, "google_client_id", client_id.trim()).map_err(|e| e.to_string())?;
        db::set_setting(&conn, "google_client_secret", client_secret.trim())
            .map_err(|e| e.to_string())?;
    }
    emit_status(&app);
    Ok(())
}

#[tauri::command]
pub fn sync_login(app: AppHandle, email: Option<String>) -> Result<SyncStatus, String> {
    let (client_id, client_secret) = credentials(&app).ok_or("not_configured")?;
    let login = oauth::login(&app, &client_id, &client_secret, email.as_deref());
    // un login fallito deve comparire nella UI, non sparire nel nulla
    let (_tokens, id_email) = match login {
        Ok(v) => v,
        Err(e) => {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let _ = db::set_setting(&conn, "sync_last_error", &e);
            drop(conn);
            emit_status(&app);
            return Err(e);
        }
    };
    {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        // preferisce l'email verificata dall'id_token, altrimenti quella digitata
        if let Some(email) = id_email.as_ref().or(email.as_ref()) {
            let _ = db::set_setting(&conn, "google_email", email);
        }
        let _ = db::set_setting(&conn, "sync_last_error", "");
    }
    emit_status(&app);
    request_sync(&app);
    Ok(status(&app))
}

#[tauri::command]
pub fn sync_logout(app: AppHandle, db: State<Db>) -> Result<(), String> {
    oauth::clear_tokens(&app);
    crate::master::clear_device_token(&app);
    {
        let conn = db.0.lock().unwrap();
        let _ = db::set_setting(&conn, "google_email", "");
        let _ = db::set_setting(&conn, "sync_last_error", "");
    }
    emit_status(&app);
    Ok(())
}

#[tauri::command]
pub fn sync_now(app: AppHandle) -> Result<SyncStatus, String> {
    run_sync(&app);
    let s = status(&app);
    match &s.last_error {
        Some(e) => Err(e.clone()),
        None => Ok(s),
    }
}
