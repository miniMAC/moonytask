use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct Db(pub Mutex<Connection>);

pub fn setting_value(app: &AppHandle, key: &str) -> Option<String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().ok()?;
    get_setting(&conn, key)
}

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn init(app: &AppHandle) -> Result<Connection, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let db_path = dir.join("moonytask.db");
    migrate_legacy_db(&db_path)?;
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            folder_id TEXT NOT NULL,
            name TEXT NOT NULL,
            hourly_rate REAL NOT NULL DEFAULT 0,
            rate_profile_id TEXT,
            color TEXT,
            archived INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS time_entries (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            ended_at INTEGER NOT NULL,
            duration_secs INTEGER NOT NULL,
            note TEXT,
            updated_at INTEGER NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_entries_started ON time_entries(started_at);
        CREATE INDEX IF NOT EXISTS idx_entries_project ON time_entries(project_id);
        CREATE TABLE IF NOT EXISTS project_payments (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            paid_at INTEGER NOT NULL,
            paid_through_at INTEGER NOT NULL,
            note TEXT,
            updated_at INTEGER NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_payments_project ON project_payments(project_id);
        CREATE TABLE IF NOT EXISTS watched_apps (
            id TEXT PRIMARY KEY,
            bundle_id TEXT NOT NULL,
            app_name TEXT NOT NULL,
            project_id TEXT,
            remind_after_secs INTEGER NOT NULL DEFAULT 60,
            enabled INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )?;
    // migrazione additiva: colore delle cartelle (ignora l'errore se già presente)
    let _ = conn.execute("ALTER TABLE folders ADD COLUMN color TEXT", []);
    let _ = conn.execute("ALTER TABLE projects ADD COLUMN rate_profile_id TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE projects ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE watched_apps ADD COLUMN remind_after_secs INTEGER NOT NULL DEFAULT 60",
        [],
    );
    Ok(conn)
}

fn migrate_legacy_db(db_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let Some((legacy_dir, legacy_db_name, legacy_db)) = newest_legacy_db()? else {
        return Ok(());
    };

    if db_path.exists() && db_has_user_data(db_path)? {
        return Ok(());
    }

    if db_path.exists() {
        backup_existing_db(db_path)?;
    }

    std::fs::copy(&legacy_db, db_path)?;
    for suffix in ["-wal", "-shm"] {
        let legacy_sidecar = legacy_dir.join(format!("{legacy_db_name}{suffix}"));
        if legacy_sidecar.exists() {
            let new_sidecar = db_sidecar_path(db_path, suffix);
            std::fs::copy(legacy_sidecar, new_sidecar)?;
        }
    }
    Ok(())
}

fn newest_legacy_db() -> Result<Option<(PathBuf, String, PathBuf)>, Box<dyn std::error::Error>> {
    let Some(home) = std::env::var_os("HOME") else {
        return Ok(None);
    };

    let app_support = PathBuf::from(home)
        .join("Library")
        .join("Application Support");
    let mut newest: Option<(PathBuf, String, PathBuf, SystemTime)> = None;
    for legacy_base in ["tinytime", "tinytask"] {
        let legacy_dir = app_support.join(format!("com.minimamente.{legacy_base}"));
        let legacy_db_name = format!("{legacy_base}.db");
        let legacy_db = legacy_dir.join(&legacy_db_name);
        if !legacy_db.exists() {
            continue;
        }

        let modified = legacy_db.metadata()?.modified().unwrap_or(UNIX_EPOCH);
        if newest
            .as_ref()
            .map(|(_, _, _, previous)| modified > *previous)
            .unwrap_or(true)
        {
            newest = Some((legacy_dir, legacy_db_name, legacy_db, modified));
        }
    }

    Ok(newest.map(|(dir, name, db, _)| (dir, name, db)))
}

fn db_has_user_data(db_path: &Path) -> Result<bool, Box<dyn std::error::Error>> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    for table in [
        "folders",
        "projects",
        "time_entries",
        "project_payments",
        "watched_apps",
    ] {
        if table_row_count(&conn, table)? > 0 {
            return Ok(true);
        }
    }
    Ok(false)
}

fn table_row_count(conn: &Connection, table: &str) -> rusqlite::Result<i64> {
    let exists = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get::<_, i64>(0),
    )?;
    if exists == 0 {
        return Ok(0);
    }

    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get(0)
    })
}

fn backup_existing_db(db_path: &Path) -> std::io::Result<()> {
    let timestamp = now_secs();
    for path in [
        db_path.to_path_buf(),
        db_sidecar_path(db_path, "-wal"),
        db_sidecar_path(db_path, "-shm"),
    ] {
        if !path.exists() {
            continue;
        }

        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let backup_path =
            path.with_file_name(format!("{file_name}.backup-before-legacy-{timestamp}"));
        std::fs::rename(path, backup_path)?;
    }
    Ok(())
}

fn db_sidecar_path(db_path: &Path, suffix: &str) -> PathBuf {
    let file_name = db_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("moonytask.db");
    db_path.with_file_name(format!("{file_name}{suffix}"))
}

// ---------- models ----------

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub position: i64,
    #[serde(default)]
    pub color: Option<String>,
    pub updated_at: i64,
    pub deleted: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub folder_id: String,
    pub name: String,
    pub hourly_rate: f64,
    #[serde(default)]
    pub rate_profile_id: Option<String>,
    pub color: Option<String>,
    pub archived: i64,
    #[serde(default)]
    pub position: i64,
    pub updated_at: i64,
    pub deleted: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntry {
    pub id: String,
    pub project_id: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_secs: i64,
    pub note: Option<String>,
    pub updated_at: i64,
    pub deleted: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPayment {
    pub id: String,
    pub project_id: String,
    pub paid_at: i64,
    pub paid_through_at: i64,
    pub note: Option<String>,
    pub updated_at: i64,
    pub deleted: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatchedApp {
    pub id: String,
    pub bundle_id: String,
    pub app_name: String,
    pub project_id: Option<String>,
    #[serde(default = "default_remind_after_secs")]
    pub remind_after_secs: i64,
    pub enabled: i64,
    pub updated_at: i64,
    pub deleted: i64,
}

fn default_remind_after_secs() -> i64 {
    60
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingRow {
    pub key: String,
    pub value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportData {
    pub exported_at: i64,
    pub folders: Vec<Folder>,
    pub projects: Vec<Project>,
    pub time_entries: Vec<TimeEntry>,
    pub project_payments: Vec<ProjectPayment>,
    pub watched_apps: Vec<WatchedApp>,
    pub settings: Vec<SettingRow>,
}

// ---------- helpers ----------

pub fn insert_time_entry(
    conn: &Connection,
    project_id: &str,
    started_at: i64,
    ended_at: i64,
) -> rusqlite::Result<TimeEntry> {
    let entry = TimeEntry {
        id: new_id(),
        project_id: project_id.to_string(),
        started_at,
        ended_at,
        duration_secs: ended_at - started_at,
        note: None,
        updated_at: now_secs(),
        deleted: 0,
    };
    conn.execute(
        "INSERT INTO time_entries (id, project_id, started_at, ended_at, duration_secs, note, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, 0)",
        rusqlite::params![
            &entry.id,
            &entry.project_id,
            entry.started_at,
            entry.ended_at,
            entry.duration_secs,
            entry.updated_at
        ],
    )?;
    crate::sync::mark_dirty();
    Ok(entry)
}

/// Se l'impostazione "auto_merge_daily" è attiva, somma l'entry appena chiusa
/// alle altre dello stesso progetto registrate nello stesso giorno (ora locale)
/// in un'unica voce. Ritorna l'entry unificata (o quella originale se non c'è
/// nulla da unire o l'operazione fallisce).
pub fn maybe_merge_daily(conn: &mut Connection, entry: TimeEntry) -> TimeEntry {
    if get_setting(conn, "auto_merge_daily").as_deref() != Some("1") {
        return entry;
    }
    match merge_entry_into_day(conn, &entry) {
        Ok(Some(merged)) => merged,
        _ => entry,
    }
}

fn local_day_key(ts: i64) -> String {
    use chrono::TimeZone;
    chrono::Local
        .timestamp_opt(ts, 0)
        .single()
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

fn merge_entry_into_day(
    conn: &mut Connection,
    entry: &TimeEntry,
) -> Result<Option<TimeEntry>, String> {
    let day = local_day_key(entry.started_at);
    if day.is_empty() {
        return Ok(None);
    }

    // finestra larga attorno all'entry, poi filtro esatto sul giorno locale
    let group = {
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, started_at, ended_at, duration_secs, note, updated_at, deleted
                 FROM time_entries
                 WHERE deleted = 0 AND project_id = ?1 AND started_at BETWEEN ?2 AND ?3
                 ORDER BY started_at",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map(
                rusqlite::params![
                    entry.project_id,
                    entry.started_at - 2 * 86_400,
                    entry.started_at + 2 * 86_400
                ],
                |r| {
                    Ok(TimeEntry {
                        id: r.get(0)?,
                        project_id: r.get(1)?,
                        started_at: r.get(2)?,
                        ended_at: r.get(3)?,
                        duration_secs: r.get(4)?,
                        note: r.get(5)?,
                        updated_at: r.get(6)?,
                        deleted: r.get(7)?,
                    })
                },
            )
            .map_err(err)?
            .filter_map(Result::ok)
            .filter(|e| local_day_key(e.started_at) == day)
            .collect::<Vec<_>>();
        rows
    };
    if group.len() < 2 {
        return Ok(None);
    }

    let started_at = group.iter().map(|e| e.started_at).min().unwrap_or(0);
    let ended_at = group.iter().map(|e| e.ended_at).max().unwrap_or(started_at);
    let duration_secs = group.iter().map(|e| e.duration_secs).sum::<i64>();
    let notes = group
        .iter()
        .filter_map(|e| e.note.as_deref())
        .map(str::trim)
        .filter(|note| !note.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    let now = now_secs();
    let merged = TimeEntry {
        id: new_id(),
        project_id: entry.project_id.clone(),
        started_at,
        ended_at,
        duration_secs,
        note: if notes.is_empty() {
            None
        } else {
            Some(notes.join("\n"))
        },
        updated_at: now,
        deleted: 0,
    };

    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        "INSERT INTO time_entries (id, project_id, started_at, ended_at, duration_secs, note, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
        rusqlite::params![
            &merged.id,
            &merged.project_id,
            merged.started_at,
            merged.ended_at,
            merged.duration_secs,
            &merged.note,
            merged.updated_at
        ],
    )
    .map_err(err)?;
    for old in &group {
        tx.execute(
            "UPDATE time_entries SET deleted = 1, updated_at = ?2 WHERE id = ?1",
            rusqlite::params![old.id, now],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    crate::sync::mark_dirty();
    Ok(Some(merged))
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
        r.get(0)
    })
    .ok()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---------- commands: folders ----------

#[tauri::command]
pub fn folders_list(db: State<Db>) -> Result<Vec<Folder>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, name, position, color, updated_at, deleted FROM folders WHERE deleted = 0 ORDER BY position, name")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Folder {
                id: r.get(0)?,
                name: r.get(1)?,
                position: r.get(2)?,
                color: r.get(3)?,
                updated_at: r.get(4)?,
                deleted: r.get(5)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub fn folder_create(
    app: AppHandle,
    db: State<Db>,
    name: String,
    color: Option<String>,
) -> Result<Folder, String> {
    let conn = db.0.lock().unwrap();
    let f = Folder {
        id: new_id(),
        name,
        position: conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM folders",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0),
        color,
        updated_at: now_secs(),
        deleted: 0,
    };
    conn.execute(
        "INSERT INTO folders (id, name, position, color, updated_at, deleted) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
        rusqlite::params![f.id, f.name, f.position, f.color, f.updated_at],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
    let _ = app.emit("data_changed", ());
    Ok(f)
}

#[tauri::command]
pub fn folder_update(
    app: AppHandle,
    db: State<Db>,
    id: String,
    name: String,
    color: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE folders SET name = ?2, color = ?3, updated_at = ?4 WHERE id = ?1",
        rusqlite::params![id, name, color, now_secs()],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
    let _ = app.emit("data_changed", ());
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTotal {
    pub project_id: String,
    pub total_secs: i64,
    pub last_used: i64,
}

#[tauri::command]
pub fn project_totals(db: State<Db>) -> Result<Vec<ProjectTotal>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT project_id, SUM(duration_secs), MAX(ended_at)
             FROM time_entries WHERE deleted = 0 GROUP BY project_id",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ProjectTotal {
                project_id: r.get(0)?,
                total_secs: r.get(1)?,
                last_used: r.get(2)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub fn folder_delete(app: AppHandle, db: State<Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE folder_id = ?1 AND deleted = 0",
            [&id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if count > 0 {
        return Err("folder_not_empty".into());
    }
    conn.execute(
        "UPDATE folders SET deleted = 1, updated_at = ?2 WHERE id = ?1",
        rusqlite::params![id, now_secs()],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
    let _ = app.emit("data_changed", ());
    Ok(())
}

// ---------- commands: projects ----------

#[tauri::command]
pub fn projects_list(db: State<Db>) -> Result<Vec<Project>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, folder_id, name, hourly_rate, rate_profile_id, color, archived, position, updated_at, deleted FROM projects WHERE deleted = 0 ORDER BY position, name")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Project {
                id: r.get(0)?,
                folder_id: r.get(1)?,
                name: r.get(2)?,
                hourly_rate: r.get(3)?,
                rate_profile_id: r.get(4)?,
                color: r.get(5)?,
                archived: r.get(6)?,
                position: r.get(7)?,
                updated_at: r.get(8)?,
                deleted: r.get(9)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub fn project_create(
    app: AppHandle,
    db: State<Db>,
    folder_id: String,
    name: String,
    hourly_rate: f64,
    rate_profile_id: Option<String>,
    color: Option<String>,
) -> Result<Project, String> {
    let conn = db.0.lock().unwrap();
    let position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM projects WHERE folder_id = ?1 AND deleted = 0",
            rusqlite::params![folder_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let p = Project {
        id: new_id(),
        folder_id,
        name,
        hourly_rate,
        rate_profile_id,
        color,
        archived: 0,
        position,
        updated_at: now_secs(),
        deleted: 0,
    };
    conn.execute(
        "INSERT INTO projects (id, folder_id, name, hourly_rate, rate_profile_id, color, archived, position, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, 0)",
        rusqlite::params![
            p.id,
            p.folder_id,
            p.name,
            p.hourly_rate,
            p.rate_profile_id,
            p.color,
            p.position,
            p.updated_at
        ],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
    let _ = app.emit("data_changed", ());
    Ok(p)
}

#[tauri::command]
pub fn project_update(
    app: AppHandle,
    db: State<Db>,
    id: String,
    folder_id: String,
    name: String,
    hourly_rate: f64,
    rate_profile_id: Option<String>,
    color: Option<String>,
    archived: i64,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE projects SET folder_id = ?2, name = ?3, hourly_rate = ?4, rate_profile_id = ?5, color = ?6, archived = ?7, updated_at = ?8 WHERE id = ?1",
        rusqlite::params![
            id,
            folder_id,
            name,
            hourly_rate,
            rate_profile_id,
            color,
            archived,
            now_secs()
        ],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
    use tauri::Emitter;
    let _ = app.emit("data_changed", ());
    Ok(())
}

#[tauri::command]
pub fn folders_reorder(app: AppHandle, db: State<Db>, ids: Vec<String>) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let now = now_secs();
    for (index, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE folders SET position = ?2, updated_at = ?3 WHERE id = ?1",
            rusqlite::params![id, index as i64, now],
        )
        .map_err(err)?;
    }
    crate::sync::mark_dirty();
    let _ = app.emit("data_changed", ());
    Ok(())
}

/// Riordina (ed eventualmente sposta) i progetti dentro una cartella:
/// `ids` è l'elenco completo e ordinato dei progetti che la cartella deve contenere.
#[tauri::command]
pub fn projects_reorder(
    app: AppHandle,
    db: State<Db>,
    folder_id: String,
    ids: Vec<String>,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let now = now_secs();
    for (index, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE projects SET folder_id = ?2, position = ?3, updated_at = ?4 WHERE id = ?1",
            rusqlite::params![id, folder_id, index as i64, now],
        )
        .map_err(err)?;
    }
    crate::sync::mark_dirty();
    let _ = app.emit("data_changed", ());
    Ok(())
}

#[tauri::command]
pub fn project_delete(app: AppHandle, db: State<Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE projects SET deleted = 1, updated_at = ?2 WHERE id = ?1",
        rusqlite::params![id, now_secs()],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
    let _ = app.emit("data_changed", ());
    Ok(())
}

// ---------- commands: time entries ----------

#[tauri::command]
pub fn entries_range(db: State<Db>, from: i64, to: i64) -> Result<Vec<TimeEntry>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT e.id, e.project_id, e.started_at, e.ended_at, e.duration_secs, e.note, e.updated_at, e.deleted
             FROM time_entries e
             JOIN projects p ON p.id = e.project_id AND p.deleted = 0
             WHERE e.deleted = 0 AND e.started_at >= ?1 AND e.started_at < ?2
             ORDER BY e.started_at DESC",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([from, to], |r| {
            Ok(TimeEntry {
                id: r.get(0)?,
                project_id: r.get(1)?,
                started_at: r.get(2)?,
                ended_at: r.get(3)?,
                duration_secs: r.get(4)?,
                note: r.get(5)?,
                updated_at: r.get(6)?,
                deleted: r.get(7)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub fn entry_delete(db: State<Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE time_entries SET deleted = 1, updated_at = ?2 WHERE id = ?1",
        rusqlite::params![id, now_secs()],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
    Ok(())
}

#[tauri::command]
pub fn entry_update_note(db: State<Db>, id: String, note: Option<String>) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let clean_note = note.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    conn.execute(
        "UPDATE time_entries SET note = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, clean_note, now_secs()],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
    Ok(())
}

#[tauri::command]
pub fn entries_merge(db: State<Db>, ids: Vec<String>) -> Result<TimeEntry, String> {
    let mut unique_ids = Vec::new();
    let mut seen = HashSet::new();
    for id in ids {
        if seen.insert(id.clone()) {
            unique_ids.push(id);
        }
    }
    if unique_ids.len() < 2 {
        return Err("not_enough_entries".into());
    }

    let mut conn = db.0.lock().unwrap();
    let entries = {
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, started_at, ended_at, duration_secs, note, updated_at, deleted
                 FROM time_entries
                 WHERE deleted = 0 AND id = ?1",
            )
            .map_err(err)?;
        let mut entries = Vec::new();
        for id in &unique_ids {
            let entry = stmt
                .query_row([id], |r| {
                    Ok(TimeEntry {
                        id: r.get(0)?,
                        project_id: r.get(1)?,
                        started_at: r.get(2)?,
                        ended_at: r.get(3)?,
                        duration_secs: r.get(4)?,
                        note: r.get(5)?,
                        updated_at: r.get(6)?,
                        deleted: r.get(7)?,
                    })
                })
                .map_err(|_| "entry_not_found".to_string())?;
            entries.push(entry);
        }
        entries
    };

    let project_id = entries[0].project_id.clone();
    if entries.iter().any(|entry| entry.project_id != project_id) {
        return Err("entries_must_share_project".into());
    }

    let started_at = entries
        .iter()
        .map(|entry| entry.started_at)
        .min()
        .unwrap_or(0);
    let ended_at = entries
        .iter()
        .map(|entry| entry.ended_at)
        .max()
        .unwrap_or(started_at);
    let duration_secs = entries.iter().map(|entry| entry.duration_secs).sum::<i64>();
    let notes = entries
        .iter()
        .filter_map(|entry| entry.note.as_deref())
        .map(str::trim)
        .filter(|note| !note.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    let now = now_secs();
    let merged = TimeEntry {
        id: new_id(),
        project_id,
        started_at,
        ended_at,
        duration_secs,
        note: if notes.is_empty() {
            None
        } else {
            Some(notes.join("\n"))
        },
        updated_at: now,
        deleted: 0,
    };

    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        "INSERT INTO time_entries (id, project_id, started_at, ended_at, duration_secs, note, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
        rusqlite::params![
            &merged.id,
            &merged.project_id,
            merged.started_at,
            merged.ended_at,
            merged.duration_secs,
            &merged.note,
            merged.updated_at
        ],
    )
    .map_err(err)?;
    for id in &unique_ids {
        tx.execute(
            "UPDATE time_entries SET deleted = 1, updated_at = ?2 WHERE id = ?1",
            rusqlite::params![id, now],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    crate::sync::mark_dirty();
    Ok(merged)
}

#[tauri::command]
pub fn entry_add_manual(
    db: State<Db>,
    project_id: String,
    started_at: i64,
    duration_secs: i64,
    note: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO time_entries (id, project_id, started_at, ended_at, duration_secs, note, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
        rusqlite::params![
            new_id(),
            project_id,
            started_at,
            started_at + duration_secs,
            duration_secs,
            note,
            now_secs()
        ],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
    Ok(())
}

// ---------- commands: project payments ----------

#[tauri::command]
pub fn project_payments_list(
    db: State<Db>,
    project_id: String,
) -> Result<Vec<ProjectPayment>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, paid_at, paid_through_at, note, updated_at, deleted
             FROM project_payments
             WHERE deleted = 0 AND project_id = ?1
             ORDER BY paid_through_at DESC, paid_at DESC",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([project_id], |r| {
            Ok(ProjectPayment {
                id: r.get(0)?,
                project_id: r.get(1)?,
                paid_at: r.get(2)?,
                paid_through_at: r.get(3)?,
                note: r.get(4)?,
                updated_at: r.get(5)?,
                deleted: r.get(6)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub fn project_payment_create(
    db: State<Db>,
    project_id: String,
    paid_at: i64,
    paid_through_at: i64,
    note: Option<String>,
) -> Result<ProjectPayment, String> {
    let conn = db.0.lock().unwrap();
    let payment = ProjectPayment {
        id: new_id(),
        project_id,
        paid_at,
        paid_through_at,
        note: note.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }),
        updated_at: now_secs(),
        deleted: 0,
    };
    conn.execute(
        "INSERT INTO project_payments (id, project_id, paid_at, paid_through_at, note, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
        rusqlite::params![
            &payment.id,
            &payment.project_id,
            payment.paid_at,
            payment.paid_through_at,
            &payment.note,
            payment.updated_at
        ],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
    Ok(payment)
}

#[tauri::command]
pub fn project_payment_delete(db: State<Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE project_payments SET deleted = 1, updated_at = ?2 WHERE id = ?1",
        rusqlite::params![id, now_secs()],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
    Ok(())
}

// ---------- commands: export ----------

#[tauri::command]
pub fn data_export(app: AppHandle, db: State<Db>, format: String) -> Result<String, String> {
    let format = format.to_lowercase();
    if format != "json" && format != "csv" {
        return Err("unsupported_export_format".into());
    }

    let data = {
        let conn = db.0.lock().unwrap();
        export_data_inner(&conn).map_err(err)?
    };

    let contents = if format == "json" {
        serde_json::to_string_pretty(&data).map_err(err)?
    } else {
        export_data_csv(&data)
    };

    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(err)?;
    std::fs::create_dir_all(&dir).map_err(err)?;

    let path = dir.join(format!("moonytask-export-{}.{}", data.exported_at, format));
    std::fs::write(&path, contents).map_err(err)?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn project_export(
    app: AppHandle,
    db: State<Db>,
    project_id: String,
    format: String,
) -> Result<String, String> {
    let format = format.to_lowercase();
    if format != "json" && format != "csv" {
        return Err("unsupported_export_format".into());
    }

    let (data, export_dir) = {
        let conn = db.0.lock().unwrap();
        (
            project_export_data_inner(&conn, &project_id).map_err(err)?,
            get_setting(&conn, "pdf_export_dir"),
        )
    };

    let contents = if format == "json" {
        serde_json::to_string_pretty(&data).map_err(err)?
    } else {
        export_data_csv(&data)
    };

    let dir = resolve_export_dir(&app, export_dir)?;
    std::fs::create_dir_all(&dir).map_err(err)?;

    let project_name = data
        .projects
        .first()
        .map(|project| safe_file_stem(&project.name))
        .unwrap_or_else(|| "project".into());
    let path = dir.join(format!(
        "moonytask-{}-{}.{}",
        project_name, data.exported_at, format
    ));
    std::fs::write(&path, contents).map_err(err)?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn report_export_pdf(
    app: AppHandle,
    db: State<Db>,
    from: i64,
    to: i64,
    folder_id: String,
    project_id: String,
    currency: String,
    locale: String,
) -> Result<String, String> {
    if project_id == "all" {
        return Err("project_required".into());
    }

    let (data, export_dir, totals_only) = {
        let conn = db.0.lock().unwrap();
        (
            export_data_inner(&conn).map_err(err)?,
            get_setting(&conn, "pdf_export_dir"),
            get_setting(&conn, "pdf_totals_only")
                .map(|v| v == "1")
                .unwrap_or(false),
        )
    };
    let project_by_id = data
        .projects
        .iter()
        .filter(|project| project.deleted == 0)
        .map(|project| (project.id.as_str(), project))
        .collect::<HashMap<_, _>>();
    let Some(selected_project) = project_by_id.get(project_id.as_str()) else {
        return Err("project_not_found".into());
    };
    if folder_id != "all" && selected_project.folder_id != folder_id {
        return Err("project_not_in_folder".into());
    }

    let allowed_project = |project: &Project| project.deleted == 0 && project.id == project_id;
    let cost = |entry: &TimeEntry| {
        project_by_id
            .get(entry.project_id.as_str())
            .map(|project| (project.hourly_rate * entry.duration_secs as f64) / 3600.0)
            .unwrap_or(0.0)
    };

    let period_entries = data
        .time_entries
        .iter()
        .filter(|entry| {
            entry.deleted == 0
                && entry.started_at >= from
                && entry.started_at < to
                && project_by_id
                    .get(entry.project_id.as_str())
                    .map(|project| allowed_project(project))
                    .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    let all_entries = data
        .time_entries
        .iter()
        .filter(|entry| {
            entry.deleted == 0
                && project_by_id
                    .get(entry.project_id.as_str())
                    .map(|project| allowed_project(project))
                    .unwrap_or(false)
        })
        .collect::<Vec<_>>();

    let period_secs = period_entries
        .iter()
        .map(|entry| entry.duration_secs)
        .sum::<i64>();
    let period_money = period_entries.iter().map(|entry| cost(entry)).sum::<f64>();
    let total_money = all_entries.iter().map(|entry| cost(entry)).sum::<f64>();
    let days = period_entries
        .iter()
        .map(|entry| epoch_day_key(entry.started_at))
        .collect::<HashSet<_>>()
        .len();

    let mut by_day: BTreeMap<String, (i64, f64)> = BTreeMap::new();
    for entry in &period_entries {
        let row = by_day
            .entry(epoch_day_key(entry.started_at))
            .or_insert((0, 0.0));
        row.0 += entry.duration_secs;
        row.1 += cost(entry);
    }

    let project_label = selected_project.name.clone();
    let en = locale.to_lowercase().starts_with("en");
    let all_time = from <= 0;

    let mut meta = vec![if all_time {
        if en {
            "Period: all time".into()
        } else {
            "Periodo: tutto".to_string()
        }
    } else {
        format!(
            "{}: {} - {}",
            if en { "Period" } else { "Periodo" },
            format_epoch_date(from),
            format_epoch_date(to.saturating_sub(1))
        )
    }];
    meta.push(String::new());
    meta.push(format!(
        "{}: {}",
        match (en, all_time) {
            (true, true) => "Total time",
            (true, false) => "Period time",
            (false, true) => "Tempo totale",
            (false, false) => "Tempo periodo",
        },
        fmt_pdf_duration(period_secs)
    ));
    meta.push(format!(
        "{}: {}",
        match (en, all_time) {
            (true, true) => "Total cost",
            (true, false) => "Period cost",
            (false, true) => "Costo totale",
            (false, false) => "Costo periodo",
        },
        fmt_pdf_money(period_money, &currency, &locale)
    ));
    if !all_time {
        meta.push(format!(
            "{}: {}",
            if en {
                "Total cost since start"
            } else {
                "Costo totale dall'inizio"
            },
            fmt_pdf_money(total_money, &currency, &locale)
        ));
    }
    meta.push(format!(
        "{}: {days}",
        if en { "Days worked" } else { "Giorni lavorati" }
    ));

    let table = if by_day.is_empty() {
        meta.push(String::new());
        meta.push(if en {
            "No data in the selected period.".into()
        } else {
            "Nessun dato nel periodo selezionato.".to_string()
        });
        None
    } else {
        let headers: Vec<String> = if en {
            if totals_only {
                vec!["Day".into(), "Time".into()]
            } else {
                vec!["Day".into(), "Time".into(), "Cost".into()]
            }
        } else if totals_only {
            vec!["Giorno".into(), "Tempo".into()]
        } else {
            vec!["Giorno".into(), "Tempo".into(), "Costo".into()]
        };
        let rows: Vec<Vec<String>> = by_day
            .iter()
            .rev()
            .map(|(day, (secs, money))| {
                if totals_only {
                    vec![day.clone(), fmt_pdf_duration(*secs)]
                } else {
                    vec![
                        day.clone(),
                        fmt_pdf_duration(*secs),
                        fmt_pdf_money(*money, &currency, &locale),
                    ]
                }
            })
            .collect();
        Some((headers, rows))
    };

    let dir = resolve_export_dir(&app, export_dir)?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.join(format!(
        "moonytask-{}-report-{}.pdf",
        safe_file_stem(&project_label),
        now_secs()
    ));
    write_report_pdf(&path, &project_label, &meta, table).map_err(err)?;
    Ok(path.to_string_lossy().to_string())
}

/// Cartella dove salvare gli export: impostazione dell'app se presente, altrimenti Downloads.
fn resolve_export_dir(
    app: &AppHandle,
    export_dir: Option<String>,
) -> Result<std::path::PathBuf, String> {
    export_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(expand_user_path)
        .transpose()
        .map_err(err)?
        .map(Ok)
        .unwrap_or_else(|| {
            app.path()
                .download_dir()
                .or_else(|_| app.path().app_data_dir())
        })
        .map_err(err)
}

fn expand_user_path(value: &str) -> Result<std::path::PathBuf, std::io::Error> {
    if value == "~" {
        return std::env::var_os("HOME")
            .map(std::path::PathBuf::from)
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "home_not_found"));
    }
    if let Some(rest) = value.strip_prefix("~/") {
        let Some(home) = std::env::var_os("HOME") else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "home_not_found",
            ));
        };
        return Ok(std::path::PathBuf::from(home).join(rest));
    }
    Ok(std::path::PathBuf::from(value))
}

fn write_report_pdf(
    path: &std::path::Path,
    title: &str,
    meta: &[String],
    table: Option<(Vec<String>, Vec<Vec<String>>)>,
) -> std::io::Result<()> {
    const LEFT: f64 = 54.0;
    const RIGHT: f64 = 541.0;
    const TOP: f64 = 788.0;
    const BOTTOM: f64 = 60.0;
    const ROW_H: f64 = 22.0;

    fn put_text(buf: &mut String, x: f64, y: f64, size: f64, bold: bool, s: &str) {
        buf.push_str(&format!(
            "BT /{} {} Tf {:.1} {:.1} Td ({}) Tj ET\n",
            if bold { "F2" } else { "F1" },
            size,
            x,
            y,
            pdf_escape(s)
        ));
    }

    /// Disegna una riga di tabella (bordi cella + testo) con il lato alto a y_top.
    fn put_row(
        buf: &mut String,
        y_top: f64,
        cells: &[String],
        widths: &[f64],
        bold: bool,
        fill: bool,
    ) {
        let total: f64 = widths.iter().sum();
        if fill {
            buf.push_str(&format!(
                "0.93 g {:.1} {:.1} {:.1} {:.1} re f 0 g\n",
                LEFT,
                y_top - ROW_H,
                total,
                ROW_H
            ));
        }
        let mut x = LEFT;
        for (i, cell) in cells.iter().enumerate() {
            let w = widths[i.min(widths.len() - 1)];
            buf.push_str(&format!(
                "0.75 G 0.7 w {:.1} {:.1} {:.1} {:.1} re S\n",
                x,
                y_top - ROW_H,
                w,
                ROW_H
            ));
            put_text(buf, x + 8.0, y_top - ROW_H + 7.0, 10.5, bold, cell);
            x += w;
        }
    }

    let mut pages: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut y = TOP;

    put_text(&mut cur, LEFT, y, 18.0, true, title);
    y -= 32.0;
    for line in meta {
        if line.is_empty() {
            y -= 8.0;
            continue;
        }
        put_text(&mut cur, LEFT, y, 11.0, false, line);
        y -= 16.0;
    }
    y -= 10.0;

    if let Some((headers, rows)) = table {
        let total = RIGHT - LEFT;
        let widths: Vec<f64> = if headers.len() == 3 {
            vec![total * 0.42, total * 0.28, total * 0.30]
        } else {
            vec![total / headers.len().max(1) as f64; headers.len().max(1)]
        };

        put_row(&mut cur, y, &headers, &widths, true, true);
        y -= ROW_H;
        for row in &rows {
            if y - ROW_H < BOTTOM {
                pages.push(std::mem::take(&mut cur));
                y = TOP;
                put_row(&mut cur, y, &headers, &widths, true, true);
                y -= ROW_H;
            }
            put_row(&mut cur, y, row, &widths, false, false);
            y -= ROW_H;
        }
    }
    pages.push(cur);

    // struttura PDF: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, poi coppie pagina/contenuto
    let mut objects = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        String::new(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>".to_string(),
    ];
    let mut kids = Vec::new();
    for (idx, stream) in pages.iter().enumerate() {
        let page_id = 5 + idx * 2;
        let content_id = page_id + 1;
        kids.push(format!("{page_id} 0 R"));
        objects.push(format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {content_id} 0 R >>"
        ));
        objects.push(format!(
            "<< /Length {} >>\nstream\n{}\nendstream",
            stream.as_bytes().len(),
            stream
        ));
    }
    objects[1] = format!(
        "<< /Type /Pages /Count {} /Kids [{}] >>",
        pages.len(),
        kids.join(" ")
    );

    let mut out = String::from("%PDF-1.4\n");
    let mut offsets = Vec::with_capacity(objects.len());
    for (idx, object) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.push_str(&format!("{} 0 obj\n{}\nendobj\n", idx + 1, object));
    }
    let xref_start = out.len();
    out.push_str(&format!(
        "xref\n0 {}\n0000000000 65535 f \n",
        objects.len() + 1
    ));
    for offset in offsets {
        out.push_str(&format!("{offset:010} 00000 n \n"));
    }
    out.push_str(&format!(
        "trailer << /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
        objects.len() + 1,
        xref_start
    ));
    std::fs::write(path, out)
}

fn pdf_escape(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '\\' => "\\\\".to_string(),
            '(' => "\\(".to_string(),
            ')' => "\\)".to_string(),
            '\n' | '\r' => " ".to_string(),
            ch if ch.is_ascii() => ch.to_string(),
            ch => ch.to_string(),
        })
        .collect()
}

fn fmt_pdf_duration(secs: i64) -> String {
    let hours = secs / 3600;
    let minutes = (secs % 3600) / 60;
    if hours > 0 {
        format!("{hours}h {minutes}m")
    } else {
        format!("{minutes}m")
    }
}

fn fmt_pdf_money(value: f64, currency: &str, locale: &str) -> String {
    let amount = format!("{value:.2}");
    if locale.starts_with("it") {
        format!("{} {}", amount.replace('.', ","), currency)
    } else {
        format!("{currency} {amount}")
    }
}

fn epoch_day_key(ts: i64) -> String {
    format_epoch_date(ts)
}

fn format_epoch_date(ts: i64) -> String {
    let days = ts.div_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    (y + if m <= 2 { 1 } else { 0 }, m, d)
}

fn export_data_inner(conn: &Connection) -> rusqlite::Result<ExportData> {
    Ok(ExportData {
        exported_at: now_secs(),
        folders: query_folders_all(conn)?,
        projects: query_projects_all(conn)?,
        time_entries: query_entries_all(conn)?,
        project_payments: query_project_payments_all(conn)?,
        watched_apps: query_watched_all(conn)?,
        settings: query_settings_all(conn)?,
    })
}

fn project_export_data_inner(conn: &Connection, project_id: &str) -> rusqlite::Result<ExportData> {
    let all = export_data_inner(conn)?;
    let Some(project) = all
        .projects
        .iter()
        .find(|project| project.id == project_id && project.deleted == 0)
        .cloned()
    else {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    };

    let folder = all
        .folders
        .into_iter()
        .find(|folder| folder.id == project.folder_id);
    let time_entries = all
        .time_entries
        .into_iter()
        .filter(|entry| entry.project_id == project.id && entry.deleted == 0)
        .collect();
    let watched_apps = all
        .watched_apps
        .into_iter()
        .filter(|app| app.project_id.as_deref() == Some(project.id.as_str()) && app.deleted == 0)
        .collect();
    let project_payments = all
        .project_payments
        .into_iter()
        .filter(|payment| payment.project_id == project.id && payment.deleted == 0)
        .collect();

    Ok(ExportData {
        exported_at: all.exported_at,
        folders: folder.into_iter().collect(),
        projects: vec![project],
        time_entries,
        project_payments,
        watched_apps,
        settings: Vec::new(),
    })
}

fn query_folders_all(conn: &Connection) -> rusqlite::Result<Vec<Folder>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, position, color, updated_at, deleted
         FROM folders ORDER BY deleted, position, name",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Folder {
                id: r.get(0)?,
                name: r.get(1)?,
                position: r.get(2)?,
                color: r.get(3)?,
                updated_at: r.get(4)?,
                deleted: r.get(5)?,
            })
        })?
        .collect();
    rows
}

fn query_projects_all(conn: &Connection) -> rusqlite::Result<Vec<Project>> {
    let mut stmt = conn.prepare(
        "SELECT id, folder_id, name, hourly_rate, rate_profile_id, color, archived, position, updated_at, deleted
         FROM projects ORDER BY deleted, position, name",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Project {
                id: r.get(0)?,
                folder_id: r.get(1)?,
                name: r.get(2)?,
                hourly_rate: r.get(3)?,
                rate_profile_id: r.get(4)?,
                color: r.get(5)?,
                archived: r.get(6)?,
                position: r.get(7)?,
                updated_at: r.get(8)?,
                deleted: r.get(9)?,
            })
        })?
        .collect();
    rows
}

fn query_entries_all(conn: &Connection) -> rusqlite::Result<Vec<TimeEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, started_at, ended_at, duration_secs, note, updated_at, deleted
         FROM time_entries ORDER BY started_at DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(TimeEntry {
                id: r.get(0)?,
                project_id: r.get(1)?,
                started_at: r.get(2)?,
                ended_at: r.get(3)?,
                duration_secs: r.get(4)?,
                note: r.get(5)?,
                updated_at: r.get(6)?,
                deleted: r.get(7)?,
            })
        })?
        .collect();
    rows
}

fn query_project_payments_all(conn: &Connection) -> rusqlite::Result<Vec<ProjectPayment>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, paid_at, paid_through_at, note, updated_at, deleted
         FROM project_payments ORDER BY deleted, paid_through_at DESC, paid_at DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ProjectPayment {
                id: r.get(0)?,
                project_id: r.get(1)?,
                paid_at: r.get(2)?,
                paid_through_at: r.get(3)?,
                note: r.get(4)?,
                updated_at: r.get(5)?,
                deleted: r.get(6)?,
            })
        })?
        .collect();
    rows
}

fn query_watched_all(conn: &Connection) -> rusqlite::Result<Vec<WatchedApp>> {
    let mut stmt = conn.prepare(
        "SELECT id, bundle_id, app_name, project_id, remind_after_secs, enabled, updated_at, deleted
         FROM watched_apps ORDER BY deleted, app_name",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(WatchedApp {
                id: r.get(0)?,
                bundle_id: r.get(1)?,
                app_name: r.get(2)?,
                project_id: r.get(3)?,
                remind_after_secs: r.get(4)?,
                enabled: r.get(5)?,
                updated_at: r.get(6)?,
                deleted: r.get(7)?,
            })
        })?
        .collect();
    rows
}

fn query_settings_all(conn: &Connection) -> rusqlite::Result<Vec<SettingRow>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SettingRow {
                key: r.get(0)?,
                value: r.get(1)?,
            })
        })?
        .collect();
    rows
}

fn export_data_csv(data: &ExportData) -> String {
    let mut out = String::new();
    writeln!(
        out,
        "record_type,id,folder_id,folder_name,project_id,project_name,name,color,hourly_rate,rate_profile_id,archived,position,started_at,ended_at,duration_secs,note,bundle_id,app_name,enabled,remind_after_secs,paid_at,paid_through_at,setting_key,setting_value,updated_at,deleted"
    )
    .unwrap();

    let folder_by_id = data
        .folders
        .iter()
        .map(|f| (f.id.as_str(), f))
        .collect::<std::collections::HashMap<_, _>>();
    let project_by_id = data
        .projects
        .iter()
        .map(|p| (p.id.as_str(), p))
        .collect::<std::collections::HashMap<_, _>>();

    for f in &data.folders {
        csv_row(
            &mut out,
            &[
                "folder",
                &f.id,
                "",
                "",
                "",
                "",
                &f.name,
                f.color.as_deref().unwrap_or(""),
                "",
                "",
                "",
                &f.position.to_string(),
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                &f.updated_at.to_string(),
                &f.deleted.to_string(),
            ],
        );
    }

    for p in &data.projects {
        let folder_name = folder_by_id
            .get(p.folder_id.as_str())
            .map(|f| f.name.as_str())
            .unwrap_or("");
        csv_row(
            &mut out,
            &[
                "project",
                &p.id,
                &p.folder_id,
                folder_name,
                "",
                "",
                &p.name,
                p.color.as_deref().unwrap_or(""),
                &p.hourly_rate.to_string(),
                p.rate_profile_id.as_deref().unwrap_or(""),
                &p.archived.to_string(),
                &p.position.to_string(),
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                &p.updated_at.to_string(),
                &p.deleted.to_string(),
            ],
        );
    }

    for e in &data.time_entries {
        let project = project_by_id.get(e.project_id.as_str());
        let folder_id = project.map(|p| p.folder_id.as_str()).unwrap_or("");
        let folder_name = folder_by_id
            .get(folder_id)
            .map(|f| f.name.as_str())
            .unwrap_or("");
        let project_name = project.map(|p| p.name.as_str()).unwrap_or("");
        csv_row(
            &mut out,
            &[
                "time_entry",
                &e.id,
                folder_id,
                folder_name,
                &e.project_id,
                project_name,
                "",
                "",
                "",
                "",
                "",
                "",
                &e.started_at.to_string(),
                &e.ended_at.to_string(),
                &e.duration_secs.to_string(),
                e.note.as_deref().unwrap_or(""),
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                &e.updated_at.to_string(),
                &e.deleted.to_string(),
            ],
        );
    }

    for payment in &data.project_payments {
        let project = project_by_id.get(payment.project_id.as_str());
        let folder_id = project.map(|p| p.folder_id.as_str()).unwrap_or("");
        let folder_name = folder_by_id
            .get(folder_id)
            .map(|f| f.name.as_str())
            .unwrap_or("");
        let project_name = project.map(|p| p.name.as_str()).unwrap_or("");
        csv_row(
            &mut out,
            &[
                "project_payment",
                &payment.id,
                folder_id,
                folder_name,
                &payment.project_id,
                project_name,
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                payment.note.as_deref().unwrap_or(""),
                "",
                "",
                "",
                "",
                &payment.paid_at.to_string(),
                &payment.paid_through_at.to_string(),
                "",
                "",
                &payment.updated_at.to_string(),
                &payment.deleted.to_string(),
            ],
        );
    }

    for w in &data.watched_apps {
        let project_name = w
            .project_id
            .as_deref()
            .and_then(|id| project_by_id.get(id))
            .map(|p| p.name.as_str())
            .unwrap_or("");
        csv_row(
            &mut out,
            &[
                "watched_app",
                &w.id,
                "",
                "",
                w.project_id.as_deref().unwrap_or(""),
                project_name,
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                &w.bundle_id,
                &w.app_name,
                &w.enabled.to_string(),
                &w.remind_after_secs.to_string(),
                "",
                "",
                "",
                "",
                &w.updated_at.to_string(),
                &w.deleted.to_string(),
            ],
        );
    }

    for s in &data.settings {
        csv_row(
            &mut out,
            &[
                "setting", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
                "", "", "", &s.key, &s.value, "", "",
            ],
        );
    }

    out
}

fn csv_row(out: &mut String, fields: &[&str]) {
    for (idx, field) in fields.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        csv_field(out, field);
    }
    out.push('\n');
}

fn csv_field(out: &mut String, value: &str) {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        out.push('"');
        for ch in value.chars() {
            if ch == '"' {
                out.push('"');
            }
            out.push(ch);
        }
        out.push('"');
    } else {
        out.push_str(value);
    }
}

fn safe_file_stem(value: &str) -> String {
    let slug = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    if slug.is_empty() {
        "project".into()
    } else {
        slug
    }
}

// ---------- commands: watched apps ----------

#[tauri::command]
pub fn watched_list(db: State<Db>) -> Result<Vec<WatchedApp>, String> {
    let conn = db.0.lock().unwrap();
    watched_list_inner(&conn).map_err(err)
}

pub fn watched_list_inner(conn: &Connection) -> rusqlite::Result<Vec<WatchedApp>> {
    let mut stmt = conn.prepare(
        "SELECT id, bundle_id, app_name, project_id, remind_after_secs, enabled, updated_at, deleted
         FROM watched_apps WHERE deleted = 0 ORDER BY app_name",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(WatchedApp {
                id: r.get(0)?,
                bundle_id: r.get(1)?,
                app_name: r.get(2)?,
                project_id: r.get(3)?,
                remind_after_secs: r.get(4)?,
                enabled: r.get(5)?,
                updated_at: r.get(6)?,
                deleted: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn watched_add(
    db: State<Db>,
    bundle_id: String,
    app_name: String,
    project_id: Option<String>,
    remind_after_secs: Option<i64>,
) -> Result<WatchedApp, String> {
    let conn = db.0.lock().unwrap();
    // riattiva l'eventuale riga soft-deleted per lo stesso bundle id
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM watched_apps WHERE bundle_id = ?1",
            [&bundle_id],
            |r| r.get(0),
        )
        .ok();
    let w = WatchedApp {
        id: existing.unwrap_or_else(new_id),
        bundle_id,
        app_name,
        project_id,
        remind_after_secs: remind_after_secs.unwrap_or_else(default_remind_after_secs),
        enabled: 1,
        updated_at: now_secs(),
        deleted: 0,
    };
    conn.execute(
        "INSERT INTO watched_apps (id, bundle_id, app_name, project_id, remind_after_secs, enabled, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, 0)
         ON CONFLICT(id) DO UPDATE SET bundle_id = excluded.bundle_id, app_name = excluded.app_name,
            project_id = excluded.project_id, remind_after_secs = excluded.remind_after_secs,
            enabled = 1, updated_at = excluded.updated_at, deleted = 0",
        rusqlite::params![
            w.id,
            w.bundle_id,
            w.app_name,
            w.project_id,
            w.remind_after_secs,
            w.updated_at
        ],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
    Ok(w)
}

#[tauri::command]
pub fn watched_update(
    db: State<Db>,
    id: String,
    enabled: i64,
    project_id: Option<String>,
    remind_after_secs: i64,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let remind_after_secs = remind_after_secs.clamp(10, 24 * 60 * 60);
    conn.execute(
        "UPDATE watched_apps SET enabled = ?2, project_id = ?3, remind_after_secs = ?4, updated_at = ?5 WHERE id = ?1",
        rusqlite::params![id, enabled, project_id, remind_after_secs, now_secs()],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
    Ok(())
}

#[tauri::command]
pub fn watched_remove(db: State<Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE watched_apps SET deleted = 1, updated_at = ?2 WHERE id = ?1",
        rusqlite::params![id, now_secs()],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
    Ok(())
}

#[tauri::command]
pub fn watcher_snooze(db: State<Db>, bundle_id: String, until_epoch: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let key = format!("watch_snooze_until:{bundle_id}");
    set_setting(&conn, &key, &until_epoch.to_string()).map_err(err)?;
    Ok(())
}

// ---------- commands: settings ----------

#[tauri::command]
pub fn settings_get(db: State<Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().unwrap();
    Ok(get_setting(&conn, &key))
}

#[tauri::command]
pub fn select_pdf_export_dir(current: Option<String>) -> Result<Option<String>, String> {
    select_folder_dialog(current.as_deref())
}

#[tauri::command]
pub fn settings_set(
    app: tauri::AppHandle,
    db: State<Db>,
    key: String,
    value: String,
) -> Result<(), String> {
    {
        let conn = db.0.lock().unwrap();
        set_setting(&conn, &key, &value).map_err(err)?;
    }
    use tauri::Emitter;
    let _ = app.emit("setting_changed", (key, value));
    Ok(())
}

#[cfg(target_os = "macos")]
fn select_folder_dialog(current: Option<&str>) -> Result<Option<String>, String> {
    let default_location = current
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| expand_user_path(value).ok())
        .filter(|path| path.is_dir())
        .map(|path| {
            format!(
                " default location (POSIX file \"{}\")",
                escape_applescript_string(&path.to_string_lossy())
            )
        })
        .unwrap_or_default();

    let script = format!(
        "set pickedFolder to choose folder with prompt \"Scegli la cartella per salvare i PDF\"{}\nPOSIX path of pickedFolder",
        default_location
    );
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(err)?;

    if output.status.success() {
        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let value = if selected == "/" {
            selected
        } else {
            selected.trim_end_matches('/').to_string()
        };
        return Ok((!value.is_empty()).then_some(value));
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("User canceled") || stderr.contains("annullato") {
        return Ok(None);
    }
    Err(stderr.trim().to_string())
}

#[cfg(not(target_os = "macos"))]
fn select_folder_dialog(_current: Option<&str>) -> Result<Option<String>, String> {
    Err("folder_dialog_not_supported".into())
}

fn escape_applescript_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', " ")
        .replace('\r', " ")
}

#[cfg(test)]
mod tests {
    #[test]
    fn report_pdf_renders() {
        let path = std::env::temp_dir().join("moonytask-test-report.pdf");
        let meta = vec![
            "Periodo: tutto".to_string(),
            String::new(),
            "Tempo totale: 12h 30m".to_string(),
            "Costo totale: 512,35 EUR".to_string(),
            "Giorni lavorati: 6".to_string(),
        ];
        let rows: Vec<Vec<String>> = (0..40)
            .map(|i| {
                vec![
                    format!("2026-07-{:02}", (i % 28) + 1),
                    "1h 05m".to_string(),
                    "27,08 EUR".to_string(),
                ]
            })
            .collect();
        super::write_report_pdf(
            &path,
            "App mobile",
            &meta,
            Some((vec!["Giorno".into(), "Tempo".into(), "Costo".into()], rows)),
        )
        .unwrap();
        assert!(path.metadata().unwrap().len() > 500);
    }
}
