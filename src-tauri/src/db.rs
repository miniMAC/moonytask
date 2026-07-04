use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

pub struct Db(pub Mutex<Connection>);

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
    let conn = Connection::open(dir.join("tinytime.db"))?;
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
        CREATE TABLE IF NOT EXISTS watched_apps (
            id TEXT PRIMARY KEY,
            bundle_id TEXT NOT NULL,
            app_name TEXT NOT NULL,
            project_id TEXT,
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
    Ok(conn)
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
    pub color: Option<String>,
    pub archived: i64,
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
pub struct WatchedApp {
    pub id: String,
    pub bundle_id: String,
    pub app_name: String,
    pub project_id: Option<String>,
    pub enabled: i64,
    pub updated_at: i64,
    pub deleted: i64,
}

// ---------- helpers ----------

pub fn insert_time_entry(
    conn: &Connection,
    project_id: &str,
    started_at: i64,
    ended_at: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO time_entries (id, project_id, started_at, ended_at, duration_secs, note, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, 0)",
        rusqlite::params![
            new_id(),
            project_id,
            started_at,
            ended_at,
            ended_at - started_at,
            now_secs()
        ],
    )?;
    crate::sync::mark_dirty();
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [key],
        |r| r.get(0),
    )
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
pub fn folder_create(db: State<Db>, name: String, color: Option<String>) -> Result<Folder, String> {
    let conn = db.0.lock().unwrap();
    let f = Folder {
        id: new_id(),
        name,
        position: conn
            .query_row("SELECT COALESCE(MAX(position), -1) + 1 FROM folders", [], |r| r.get(0))
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
    Ok(f)
}

#[tauri::command]
pub fn folder_update(
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
pub fn folder_delete(db: State<Db>, id: String) -> Result<(), String> {
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
    Ok(())
}

// ---------- commands: projects ----------

#[tauri::command]
pub fn projects_list(db: State<Db>) -> Result<Vec<Project>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, folder_id, name, hourly_rate, color, archived, updated_at, deleted FROM projects WHERE deleted = 0 ORDER BY name")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Project {
                id: r.get(0)?,
                folder_id: r.get(1)?,
                name: r.get(2)?,
                hourly_rate: r.get(3)?,
                color: r.get(4)?,
                archived: r.get(5)?,
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
pub fn project_create(
    db: State<Db>,
    folder_id: String,
    name: String,
    hourly_rate: f64,
    color: Option<String>,
) -> Result<Project, String> {
    let conn = db.0.lock().unwrap();
    let p = Project {
        id: new_id(),
        folder_id,
        name,
        hourly_rate,
        color,
        archived: 0,
        updated_at: now_secs(),
        deleted: 0,
    };
    conn.execute(
        "INSERT INTO projects (id, folder_id, name, hourly_rate, color, archived, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, 0)",
        rusqlite::params![p.id, p.folder_id, p.name, p.hourly_rate, p.color, p.updated_at],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
    Ok(p)
}

#[tauri::command]
pub fn project_update(
    db: State<Db>,
    id: String,
    folder_id: String,
    name: String,
    hourly_rate: f64,
    color: Option<String>,
    archived: i64,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE projects SET folder_id = ?2, name = ?3, hourly_rate = ?4, color = ?5, archived = ?6, updated_at = ?7 WHERE id = ?1",
        rusqlite::params![id, folder_id, name, hourly_rate, color, archived, now_secs()],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
    Ok(())
}

#[tauri::command]
pub fn project_delete(db: State<Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE projects SET deleted = 1, updated_at = ?2 WHERE id = ?1",
        rusqlite::params![id, now_secs()],
    )
    .map_err(err)?;
    crate::sync::mark_dirty();
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

// ---------- commands: watched apps ----------

#[tauri::command]
pub fn watched_list(db: State<Db>) -> Result<Vec<WatchedApp>, String> {
    let conn = db.0.lock().unwrap();
    watched_list_inner(&conn).map_err(err)
}

pub fn watched_list_inner(conn: &Connection) -> rusqlite::Result<Vec<WatchedApp>> {
    let mut stmt = conn.prepare(
        "SELECT id, bundle_id, app_name, project_id, enabled, updated_at, deleted
         FROM watched_apps WHERE deleted = 0 ORDER BY app_name",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(WatchedApp {
                id: r.get(0)?,
                bundle_id: r.get(1)?,
                app_name: r.get(2)?,
                project_id: r.get(3)?,
                enabled: r.get(4)?,
                updated_at: r.get(5)?,
                deleted: r.get(6)?,
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
        enabled: 1,
        updated_at: now_secs(),
        deleted: 0,
    };
    conn.execute(
        "INSERT INTO watched_apps (id, bundle_id, app_name, project_id, enabled, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, 0)
         ON CONFLICT(id) DO UPDATE SET bundle_id = excluded.bundle_id, app_name = excluded.app_name,
            project_id = excluded.project_id, enabled = 1, updated_at = excluded.updated_at, deleted = 0",
        rusqlite::params![w.id, w.bundle_id, w.app_name, w.project_id, w.updated_at],
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
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE watched_apps SET enabled = ?2, project_id = ?3, updated_at = ?4 WHERE id = ?1",
        rusqlite::params![id, enabled, project_id, now_secs()],
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

// ---------- commands: settings ----------

#[tauri::command]
pub fn settings_get(db: State<Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().unwrap();
    Ok(get_setting(&conn, &key))
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
