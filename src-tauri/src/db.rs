use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fmt::Write as _;
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
        "ALTER TABLE watched_apps ADD COLUMN remind_after_secs INTEGER NOT NULL DEFAULT 60",
        [],
    );
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
    #[serde(default)]
    pub rate_profile_id: Option<String>,
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
    pub watched_apps: Vec<WatchedApp>,
    pub settings: Vec<SettingRow>,
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
pub fn folder_create(db: State<Db>, name: String, color: Option<String>) -> Result<Folder, String> {
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
        .prepare("SELECT id, folder_id, name, hourly_rate, rate_profile_id, color, archived, updated_at, deleted FROM projects WHERE deleted = 0 ORDER BY name")
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
                updated_at: r.get(7)?,
                deleted: r.get(8)?,
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
    rate_profile_id: Option<String>,
    color: Option<String>,
) -> Result<Project, String> {
    let conn = db.0.lock().unwrap();
    let p = Project {
        id: new_id(),
        folder_id,
        name,
        hourly_rate,
        rate_profile_id,
        color,
        archived: 0,
        updated_at: now_secs(),
        deleted: 0,
    };
    conn.execute(
        "INSERT INTO projects (id, folder_id, name, hourly_rate, rate_profile_id, color, archived, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, 0)",
        rusqlite::params![
            p.id,
            p.folder_id,
            p.name,
            p.hourly_rate,
            p.rate_profile_id,
            p.color,
            p.updated_at
        ],
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

    let path = dir.join(format!("tinytime-export-{}.{}", data.exported_at, format));
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

    let data = {
        let conn = db.0.lock().unwrap();
        project_export_data_inner(&conn, &project_id).map_err(err)?
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

    let project_name = data
        .projects
        .first()
        .map(|project| safe_file_stem(&project.name))
        .unwrap_or_else(|| "project".into());
    let path = dir.join(format!(
        "tinytime-{}-{}.{}",
        project_name, data.exported_at, format
    ));
    std::fs::write(&path, contents).map_err(err)?;

    Ok(path.to_string_lossy().to_string())
}

fn export_data_inner(conn: &Connection) -> rusqlite::Result<ExportData> {
    Ok(ExportData {
        exported_at: now_secs(),
        folders: query_folders_all(conn)?,
        projects: query_projects_all(conn)?,
        time_entries: query_entries_all(conn)?,
        watched_apps: query_watched_all(conn)?,
        settings: query_settings_all(conn)?,
    })
}

fn project_export_data_inner(
    conn: &Connection,
    project_id: &str,
) -> rusqlite::Result<ExportData> {
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
        .filter(|app| {
            app.project_id.as_deref() == Some(project.id.as_str()) && app.deleted == 0
        })
        .collect();

    Ok(ExportData {
        exported_at: all.exported_at,
        folders: folder.into_iter().collect(),
        projects: vec![project],
        time_entries,
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
        "SELECT id, folder_id, name, hourly_rate, rate_profile_id, color, archived, updated_at, deleted
         FROM projects ORDER BY deleted, name",
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
                updated_at: r.get(7)?,
                deleted: r.get(8)?,
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
        "record_type,id,folder_id,folder_name,project_id,project_name,name,color,hourly_rate,rate_profile_id,archived,position,started_at,ended_at,duration_secs,note,bundle_id,app_name,enabled,remind_after_secs,setting_key,setting_value,updated_at,deleted"
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
                &e.updated_at.to_string(),
                &e.deleted.to_string(),
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
                &w.updated_at.to_string(),
                &w.deleted.to_string(),
            ],
        );
    }

    for s in &data.settings {
        csv_row(
            &mut out,
            &[
                "setting", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
                "", "", &s.key, &s.value, "", "",
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
