use crate::db::{Folder, FolderCollapseState, Project, ProjectPayment, TimeEntry, WatchedApp};
use rusqlite::{Connection, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Snapshot {
    #[serde(default)]
    pub folders: Vec<Folder>,
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub time_entries: Vec<TimeEntry>,
    #[serde(default)]
    pub project_payments: Vec<ProjectPayment>,
    #[serde(default)]
    pub watched_apps: Vec<WatchedApp>,
    #[serde(default)]
    pub folder_collapse_states: Vec<FolderCollapseState>,
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
        .prepare("SELECT id, folder_id, name, hourly_rate, rate_profile_id, color, archived, position, updated_at, deleted FROM projects")
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
                position: r.get(7)?,
                updated_at: r.get(8)?,
                deleted: r.get(9)?,
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
        .prepare("SELECT id, project_id, paid_at, paid_through_at, note, updated_at, deleted FROM project_payments")
        .map_err(err)?;
    snap.project_payments = stmt
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

    let mut stmt = conn
        .prepare(
            "SELECT folder_id, collapsed, updated_at
             FROM folder_collapse_states",
        )
        .map_err(err)?;
    snap.folder_collapse_states = stmt
        .query_map([], |r| {
            Ok(FolderCollapseState {
                folder_id: r.get(0)?,
                collapsed: r.get::<_, i64>(1)? != 0,
                updated_at: r.get(2)?,
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
    for row in local.into_iter().chain(remote) {
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
        project_payments: merge_rows(local.project_payments, remote.project_payments, |r| {
            (r.id.clone(), r.updated_at)
        }),
        watched_apps: merge_rows(local.watched_apps, remote.watched_apps, |r| {
            (r.id.clone(), r.updated_at)
        }),
        folder_collapse_states: merge_rows(
            local.folder_collapse_states,
            remote.folder_collapse_states,
            |r| (r.folder_id.clone(), r.updated_at),
        ),
    }
}

fn write_rows(tx: &Transaction<'_>, snap: &Snapshot) -> Result<(), String> {
    let err = |e: rusqlite::Error| e.to_string();
    for f in &snap.folders {
        tx.execute(
            "INSERT OR REPLACE INTO folders (id, name, position, color, updated_at, deleted) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![f.id, f.name, f.position, f.color, f.updated_at, f.deleted],
        )
        .map_err(err)?;
    }
    for p in &snap.projects {
        tx.execute(
            "INSERT OR REPLACE INTO projects (id, folder_id, name, hourly_rate, rate_profile_id, color, archived, position, updated_at, deleted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![p.id, p.folder_id, p.name, p.hourly_rate, p.rate_profile_id, p.color, p.archived, p.position, p.updated_at, p.deleted],
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
    for payment in &snap.project_payments {
        tx.execute(
            "INSERT OR REPLACE INTO project_payments (id, project_id, paid_at, paid_through_at, note, updated_at, deleted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                payment.id,
                payment.project_id,
                payment.paid_at,
                payment.paid_through_at,
                payment.note,
                payment.updated_at,
                payment.deleted
            ],
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
    for state in &snap.folder_collapse_states {
        tx.execute(
            "INSERT OR REPLACE INTO folder_collapse_states (folder_id, collapsed, updated_at)
             VALUES (?1, ?2, ?3)",
            rusqlite::params![
                state.folder_id,
                i64::from(state.collapsed),
                state.updated_at
            ],
        )
        .map_err(err)?;
    }
    Ok(())
}

/// Scrive lo snapshot merged nel DB locale.
pub fn apply(conn: &mut Connection, snap: &Snapshot) -> Result<(), String> {
    let err = |e: rusqlite::Error| e.to_string();
    let tx = conn.transaction().map_err(err)?;
    write_rows(&tx, snap)?;
    tx.commit().map_err(err)
}

/// Sostituisce atomicamente l'intero dataset sincronizzato. Le impostazioni e le
/// cache degli altri account restano nel DB.
pub fn replace_in_transaction(tx: &Transaction<'_>, snap: &Snapshot) -> Result<(), String> {
    tx.execute_batch(
        "DELETE FROM folder_collapse_states;
         DELETE FROM watched_apps;
         DELETE FROM project_payments;
         DELETE FROM time_entries;
         DELETE FROM projects;
         DELETE FROM folders;",
    )
    .map_err(|error| error.to_string())?;
    write_rows(tx, snap)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_collapse_state_uses_last_write_wins() {
        let local = Snapshot {
            folder_collapse_states: vec![FolderCollapseState {
                folder_id: "folder-1".into(),
                collapsed: false,
                updated_at: 100,
            }],
            ..Snapshot::default()
        };
        let remote = Snapshot {
            folder_collapse_states: vec![FolderCollapseState {
                folder_id: "folder-1".into(),
                collapsed: true,
                updated_at: 200,
            }],
            ..Snapshot::default()
        };

        let merged = merge(local, remote);

        assert_eq!(merged.folder_collapse_states.len(), 1);
        assert!(merged.folder_collapse_states[0].collapsed);
        assert_eq!(merged.folder_collapse_states[0].updated_at, 200);
    }

    #[test]
    fn old_snapshots_default_to_no_folder_collapse_state() {
        let snapshot: Snapshot = serde_json::from_str("{}").unwrap();
        assert!(snapshot.folder_collapse_states.is_empty());
    }
}
