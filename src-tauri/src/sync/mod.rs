mod drive;
pub(crate) mod merge;
mod oauth;

use crate::db::{self, Db};
use rusqlite::OptionalExtension;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use tauri::{AppHandle, Emitter, Manager, State};

static SYNC_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
/// Epoch dell'ultima modifica locale non ancora sincronizzata (0 = pulito).
static DIRTY_SINCE: AtomicI64 = AtomicI64::new(0);
/// Revisione monotona per non perdere modifiche arrivate durante una sync.
static DIRTY_REVISION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

const DEBOUNCE_SECS: i64 = 20;
const PERIODIC_SECS: u64 = 15 * 60;
const ACTIVE_DATASET_OWNER_SETTING: &str = "sync_active_dataset_owner";
const LOCAL_DATASET_OWNER: &str = "__local__";

/// Segnala che i dati locali sono cambiati: la sync partirà poco dopo.
pub fn mark_dirty() {
    DIRTY_SINCE.store(db::now_secs(), Ordering::SeqCst);
    DIRTY_REVISION.fetch_add(1, Ordering::SeqCst);
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
#[cfg(not(target_os = "android"))]
const EMBEDDED_CREDENTIALS: &str =
    include_str!(concat!(env!("OUT_DIR"), "/google_credentials.json"));

#[cfg(not(target_os = "android"))]
#[derive(serde::Deserialize)]
struct EmbeddedCreds {
    client_id: String,
    client_secret: String,
}

#[cfg(not(target_os = "android"))]
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

// Google Identity Services identifica l'app Android tramite package name e
// certificato registrati in Google Cloud; non usa client secret incorporati.
#[cfg(target_os = "android")]
fn credentials(_app: &AppHandle) -> Option<(String, String)> {
    Some((String::new(), String::new()))
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

struct RemoteDataset {
    file_id: Option<String>,
    legacy_id: Option<String>,
    snapshot: merge::Snapshot,
}

fn load_remote_dataset(token: &str) -> Result<RemoteDataset, String> {
    let file_id = drive::find_file(token)?;
    let mut snapshot: merge::Snapshot = match &file_id {
        Some(id) => serde_json::from_str(&drive::download(token, id)?)
            .map_err(|e| format!("bad_remote_snapshot: {e}"))?,
        None => merge::Snapshot::default(),
    };

    // migrazione dal file col vecchio nome (TinyTime): i suoi dati entrano nel
    // merge e, a upload riuscito, il file viene eliminato da Drive
    let legacy_id = drive::find_legacy_file(token)?;
    if let Some(id) = &legacy_id {
        let legacy: merge::Snapshot = serde_json::from_str(&drive::download(token, id)?)
            .map_err(|e| format!("bad_legacy_snapshot: {e}"))?;
        snapshot = merge::merge(snapshot, legacy);
    }

    Ok(RemoteDataset {
        file_id,
        legacy_id,
        snapshot,
    })
}

fn normalized_owner(email: &str) -> String {
    email.trim().to_ascii_lowercase()
}

fn active_dataset_owner(conn: &rusqlite::Connection) -> String {
    db::get_setting(conn, ACTIVE_DATASET_OWNER_SETTING)
        .filter(|owner| !owner.is_empty())
        .or_else(|| {
            db::get_setting(conn, "google_email")
                .filter(|email| !email.is_empty())
                .map(|email| normalized_owner(&email))
        })
        .unwrap_or_else(|| LOCAL_DATASET_OWNER.into())
}

fn cache_snapshot(
    conn: &rusqlite::Connection,
    owner: &str,
    snapshot: &merge::Snapshot,
) -> Result<(), String> {
    let json = serde_json::to_string(snapshot).map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO account_datasets (owner, snapshot_json, saved_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(owner) DO UPDATE SET
           snapshot_json = excluded.snapshot_json,
           saved_at = excluded.saved_at",
        rusqlite::params![owner, json, db::now_secs()],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn cached_snapshot(
    conn: &rusqlite::Connection,
    owner: &str,
) -> Result<Option<merge::Snapshot>, String> {
    let json = conn
        .query_row(
            "SELECT snapshot_json FROM account_datasets WHERE owner = ?1",
            [owner],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    json.map(|json| {
        serde_json::from_str(&json).map_err(|error| format!("bad_cached_snapshot: {error}"))
    })
    .transpose()
}

fn switch_account_dataset_in_db(
    conn: &mut rusqlite::Connection,
    target_email: &str,
    remote: &merge::Snapshot,
) -> Result<bool, String> {
    let target_owner = normalized_owner(target_email);
    if target_owner.is_empty() {
        return Err("google_email_unavailable".into());
    }

    let current_owner = active_dataset_owner(conn);
    if current_owner == target_owner {
        return Ok(false);
    }

    let current = merge::load_local(conn)?;
    let target_cached = cached_snapshot(conn, &target_owner)?.unwrap_or_default();
    let target = merge::merge(target_cached, remote.clone());
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    cache_snapshot(&tx, &current_owner, &current)?;
    merge::replace_in_transaction(&tx, &target)?;
    db::set_setting(&tx, ACTIVE_DATASET_OWNER_SETTING, &target_owner)
        .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(true)
}

fn switch_account_dataset(
    app: &AppHandle,
    target_email: &str,
    remote: &merge::Snapshot,
) -> Result<(), String> {
    let db = app.state::<Db>();
    let mut conn = db.0.lock().unwrap();
    let changed = switch_account_dataset_in_db(&mut conn, target_email, remote)?;
    drop(conn);
    if changed {
        let _ = app.emit("data_changed", ());
    }
    Ok(())
}

fn perform_sync(app: &AppHandle) -> Result<(), String> {
    let (client_id, client_secret) = credentials(app).ok_or("not_configured")?;
    let token = oauth::valid_access_token(app, &client_id, &client_secret)?;
    let remote_dataset = load_remote_dataset(&token)?;
    let RemoteDataset {
        file_id,
        legacy_id,
        snapshot: remote,
    } = remote_dataset;

    let db = app.state::<Db>();
    let merged = {
        let mut conn = db.0.lock().unwrap();
        let local = merge::load_local(&conn)?;
        let merged = merge::merge(local, remote);
        merge::apply(&mut conn, &merged)?;
        let owner = active_dataset_owner(&conn);
        db::set_setting(&conn, ACTIVE_DATASET_OWNER_SETTING, &owner)
            .map_err(|error| error.to_string())?;
        cache_snapshot(&conn, &owner, &merged)?;
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
        let needs_reauthorization = e == drive::REAUTHORIZATION_REQUIRED;
        if needs_reauthorization {
            // Su mobile anche i token OAuth e Master vivono nel DB: vanno
            // eliminati prima di acquisire qui lo stesso mutex.
            oauth::clear_tokens(app);
            crate::master::clear_device_token(app);
        }
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        if needs_reauthorization {
            let _ = db::set_setting(&conn, "google_email", "");
        }
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
    let revision = DIRTY_REVISION.load(Ordering::SeqCst);
    if run_sync_mode(app, true).is_ok() && DIRTY_REVISION.load(Ordering::SeqCst) == revision {
        DIRTY_SINCE.store(0, Ordering::SeqCst);
    }
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
    let (tokens, _id_email) = match login {
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

    // Non basta che Google abbia emesso un token: prima di mostrare l'account
    // come connesso leggiamo davvero il dataset Drive dell'account selezionato.
    let remote_dataset = match load_remote_dataset(&tokens.access_token) {
        Ok(dataset) => dataset,
        Err(e) => {
            oauth::clear_tokens(&app);
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let _ = db::set_setting(&conn, "sync_last_error", &e);
            drop(conn);
            emit_status(&app);
            return Err(e);
        }
    };
    // L'email digitata è soltanto un login_hint: il proprietario del dataset
    // viene sempre letto dal token Drive effettivamente concesso da Google.
    let verified_email = match drive::account_email(&tokens.access_token) {
        Ok(email) => email,
        Err(e) => {
            oauth::clear_tokens(&app);
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let _ = db::set_setting(&conn, "sync_last_error", &e);
            drop(conn);
            emit_status(&app);
            return Err(e);
        }
    };
    if verified_email.is_empty() {
        oauth::clear_tokens(&app);
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        let _ = db::set_setting(&conn, "sync_last_error", "google_email_unavailable");
        drop(conn);
        emit_status(&app);
        return Err("google_email_unavailable".into());
    }
    if let Err(e) = oauth::save_tokens(&app, &tokens) {
        oauth::clear_tokens(&app);
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        let _ = db::set_setting(&conn, "sync_last_error", &e);
        drop(conn);
        emit_status(&app);
        return Err(e);
    }
    if let Err(e) = switch_account_dataset(&app, &verified_email, &remote_dataset.snapshot) {
        oauth::clear_tokens(&app);
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        let _ = db::set_setting(&conn, "sync_last_error", &e);
        drop(conn);
        emit_status(&app);
        return Err(e);
    }
    // Anche le sessioni API Master sono legate all'identità Google: non
    // devono sopravvivere al passaggio a un account diverso.
    crate::master::prepare_google_identity(&app, &verified_email);

    {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        let _ = db::set_setting(&conn, "google_email", &verified_email);
        let _ = db::set_setting(&conn, ACTIVE_DATASET_OWNER_SETTING, &verified_email);
        let _ = db::set_setting(&conn, "sync_last_error", "");
    }
    emit_status(&app);
    request_sync(&app);
    Ok(status(&app))
}

#[tauri::command]
pub fn sync_logout(app: AppHandle, db: State<Db>) -> Result<(), String> {
    // Prova a pubblicare le ultime modifiche sull'account corretto prima di
    // rimuovere il token. La cache locale per account resta comunque il
    // fallback se la rete non è disponibile.
    if ready(&app) {
        let _ = run_sync_mode(&app, false);
    }
    {
        let conn = db.0.lock().unwrap();
        let owner = active_dataset_owner(&conn);
        let snapshot = merge::load_local(&conn)?;
        cache_snapshot(&conn, &owner, &snapshot)?;
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Folder;
    use rusqlite::Connection;

    fn account_database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE folders (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL,
                color TEXT, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL
             );
             CREATE TABLE projects (
                id TEXT PRIMARY KEY, folder_id TEXT NOT NULL, name TEXT NOT NULL,
                hourly_rate REAL NOT NULL, rate_profile_id TEXT, color TEXT,
                archived INTEGER NOT NULL, position INTEGER NOT NULL,
                updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL
             );
             CREATE TABLE time_entries (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, started_at INTEGER NOT NULL,
                ended_at INTEGER NOT NULL, duration_secs INTEGER NOT NULL, note TEXT,
                updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL
             );
             CREATE TABLE project_payments (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, paid_at INTEGER NOT NULL,
                paid_through_at INTEGER NOT NULL, note TEXT, updated_at INTEGER NOT NULL,
                deleted INTEGER NOT NULL
             );
             CREATE TABLE watched_apps (
                id TEXT PRIMARY KEY, bundle_id TEXT NOT NULL, app_name TEXT NOT NULL,
                project_id TEXT, remind_after_secs INTEGER NOT NULL, enabled INTEGER NOT NULL,
                updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL
             );
             CREATE TABLE folder_collapse_states (
                folder_id TEXT PRIMARY KEY, collapsed INTEGER NOT NULL, updated_at INTEGER NOT NULL
             );
             CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE account_datasets (
                owner TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, saved_at INTEGER NOT NULL
             );",
        )
        .unwrap();
        conn
    }

    fn folder(id: &str, name: &str, updated_at: i64) -> Folder {
        Folder {
            id: id.into(),
            name: name.into(),
            position: 0,
            color: None,
            updated_at,
            deleted: 0,
        }
    }

    #[test]
    fn switching_accounts_never_merges_their_folders() {
        let mut conn = account_database();
        conn.execute(
            "INSERT INTO folders (id, name, position, color, updated_at, deleted)
             VALUES ('folder-a', 'Account A', 0, NULL, 10, 0)",
            [],
        )
        .unwrap();
        db::set_setting(&conn, ACTIVE_DATASET_OWNER_SETTING, "account-a@example.com").unwrap();

        let remote_b = merge::Snapshot {
            folders: vec![folder("folder-b", "Account B", 20)],
            ..merge::Snapshot::default()
        };
        assert!(
            switch_account_dataset_in_db(&mut conn, "ACCOUNT-B@example.com", &remote_b).unwrap()
        );
        assert_eq!(
            conn.query_row("SELECT GROUP_CONCAT(id) FROM folders", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
            "folder-b"
        );

        assert!(switch_account_dataset_in_db(
            &mut conn,
            "account-a@example.com",
            &merge::Snapshot::default()
        )
        .unwrap());
        assert_eq!(
            conn.query_row("SELECT GROUP_CONCAT(id) FROM folders", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
            "folder-a"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM account_datasets", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            2
        );
    }
}
