use crate::db::{Folder, Project, TimeEntry, WatchedApp};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Default)]
pub struct Snapshot {
    pub folders: Vec<Folder>,
    pub projects: Vec<Project>,
    pub time_entries: Vec<TimeEntry>,
    pub watched_apps: Vec<WatchedApp>,
}

/// Legge tutte le righe (incluse quelle soft-deleted: servono come tombstone).
pub fn load_local(conn: &Connection) -> Result<Snapshot, String> {
    let err = |e: rusqlite::Error| e.to_string();
    let mut snap = Snapshot::default();

    let mut stmt = conn
        .prepare("SELECT id, name, position, color, updated_at, deleted FROM folders")
        .map_err(err)?;
    snap.folders = stmt
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
        .collect::<Result<_, _>>()
        .map_err(err)?;

    let mut stmt = conn
        .prepare("SELECT id, folder_id, name, hourly_rate, rate_profile_id, color, archived, updated_at, deleted FROM projects")
        .map_err(err)?;
    snap.projects = stmt
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
        .collect::<Result<_, _>>()
        .map_err(err)?;

    let mut stmt = conn
        .prepare("SELECT id, project_id, started_at, ended_at, duration_secs, note, updated_at, deleted FROM time_entries")
        .map_err(err)?;
    snap.time_entries = stmt
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
        })
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;

    let mut stmt = conn
        .prepare("SELECT id, bundle_id, app_name, project_id, remind_after_secs, enabled, updated_at, deleted FROM watched_apps")
        .map_err(err)?;
    snap.watched_apps = stmt
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
        })
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;

    Ok(snap)
}

fn merge_rows<T, F>(local: Vec<T>, remote: Vec<T>, key: F) -> Vec<T>
where
    F: Fn(&T) -> (String, i64),
{
    let mut by_id: HashMap<String, T> = HashMap::new();
    for row in local.into_iter().chain(remote.into_iter()) {
        let (id, updated_at) = key(&row);
        match by_id.get(&id) {
            Some(existing) if key(existing).1 >= updated_at => {}
            _ => {
                by_id.insert(id, row);
            }
        }
    }
    by_id.into_values().collect()
}

/// Merge last-write-wins per record.
pub fn merge(local: Snapshot, remote: Snapshot) -> Snapshot {
    Snapshot {
        folders: merge_rows(local.folders, remote.folders, |r| {
            (r.id.clone(), r.updated_at)
        }),
        projects: merge_rows(local.projects, remote.projects, |r| {
            (r.id.clone(), r.updated_at)
        }),
        time_entries: merge_rows(local.time_entries, remote.time_entries, |r| {
            (r.id.clone(), r.updated_at)
        }),
        watched_apps: merge_rows(local.watched_apps, remote.watched_apps, |r| {
            (r.id.clone(), r.updated_at)
        }),
    }
}

/// Scrive lo snapshot merged nel DB locale.
pub fn apply(conn: &mut Connection, snap: &Snapshot) -> Result<(), String> {
    let err = |e: rusqlite::Error| e.to_string();
    let tx = conn.transaction().map_err(err)?;
    for f in &snap.folders {
        tx.execute(
            "INSERT OR REPLACE INTO folders (id, name, position, color, updated_at, deleted) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![f.id, f.name, f.position, f.color, f.updated_at, f.deleted],
        )
        .map_err(err)?;
    }
    for p in &snap.projects {
        tx.execute(
            "INSERT OR REPLACE INTO projects (id, folder_id, name, hourly_rate, rate_profile_id, color, archived, updated_at, deleted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![p.id, p.folder_id, p.name, p.hourly_rate, p.rate_profile_id, p.color, p.archived, p.updated_at, p.deleted],
        )
        .map_err(err)?;
    }
    for e in &snap.time_entries {
        tx.execute(
            "INSERT OR REPLACE INTO time_entries (id, project_id, started_at, ended_at, duration_secs, note, updated_at, deleted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![e.id, e.project_id, e.started_at, e.ended_at, e.duration_secs, e.note, e.updated_at, e.deleted],
        )
        .map_err(err)?;
    }
    for w in &snap.watched_apps {
        tx.execute(
            "INSERT OR REPLACE INTO watched_apps (id, bundle_id, app_name, project_id, remind_after_secs, enabled, updated_at, deleted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![w.id, w.bundle_id, w.app_name, w.project_id, w.remind_after_secs, w.enabled, w.updated_at, w.deleted],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)
}
