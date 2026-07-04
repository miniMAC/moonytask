use crate::db::{self, Db};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TimerStatus {
    Idle,
    Running,
    Paused,
}

pub struct TimerState {
    pub status: TimerStatus,
    pub project_id: Option<String>,
    pub segment_start: Option<i64>,
    pub accumulated: i64,
}

impl TimerState {
    pub fn new() -> Self {
        Self {
            status: TimerStatus::Idle,
            project_id: None,
            segment_start: None,
            accumulated: 0,
        }
    }

    pub fn elapsed(&self) -> i64 {
        let running = self.segment_start.map(|s| db::now_secs() - s).unwrap_or(0);
        self.accumulated + running
    }
}

pub struct Timer(pub Mutex<TimerState>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerSnapshot {
    pub status: TimerStatus,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub elapsed_secs: i64,
}

pub fn snapshot(app: &AppHandle) -> TimerSnapshot {
    let timer = app.state::<Timer>();
    let db = app.state::<Db>();
    let t = timer.0.lock().unwrap();
    let name = t.project_id.as_ref().and_then(|pid| {
        let conn = db.0.lock().unwrap();
        conn.query_row("SELECT name FROM projects WHERE id = ?1", [pid], |r| {
            r.get::<_, String>(0)
        })
        .ok()
    });
    TimerSnapshot {
        status: t.status,
        project_id: t.project_id.clone(),
        project_name: name,
        elapsed_secs: t.elapsed(),
    }
}

pub fn emit_state(app: &AppHandle) {
    let snap = snapshot(app);
    let _ = app.emit("timer_state", &snap);
    crate::tray::refresh(app, &snap);
}

/// Sotto questa durata un segmento è considerato un avvio accidentale e scartato.
const MIN_SEGMENT_SECS: i64 = 15;

/// Chiude il segmento corrente scrivendolo su DB. Da chiamare con i lock già presi.
/// I segmenti più corti di 15 secondi non vengono registrati (né mostrati nel totale).
fn close_segment(conn: &rusqlite::Connection, t: &mut TimerState) -> Option<db::TimeEntry> {
    if let (Some(start), Some(pid)) = (t.segment_start, t.project_id.clone()) {
        let now = db::now_secs();
        t.segment_start = None;
        let duration = now - start;
        if duration >= MIN_SEGMENT_SECS {
            t.accumulated += duration;
            return db::insert_time_entry(conn, &pid, start, now).ok();
        }
        return None;
    }
    None
}

fn emit_note_required(app: &AppHandle, entry: Option<db::TimeEntry>) {
    let Some(entry) = entry else { return };
    crate::tray::show_main_window(app);
    let _ = app.emit("entry_note_required", entry);
}

#[tauri::command]
pub fn timer_start(
    app: AppHandle,
    timer: State<Timer>,
    db: State<Db>,
    project_id: String,
) -> Result<(), String> {
    let mut note_entry = None;
    {
        let mut t = timer.0.lock().unwrap();
        let conn = db.0.lock().unwrap();
        if t.status != TimerStatus::Idle {
            note_entry = close_segment(&conn, &mut t);
        }
        t.status = TimerStatus::Running;
        t.project_id = Some(project_id);
        t.segment_start = Some(db::now_secs());
        t.accumulated = 0;
    }
    emit_state(&app);
    emit_note_required(&app, note_entry);
    Ok(())
}

#[tauri::command]
pub fn timer_pause(app: AppHandle, timer: State<Timer>, db: State<Db>) -> Result<(), String> {
    let note_entry;
    {
        let mut t = timer.0.lock().unwrap();
        if t.status != TimerStatus::Running {
            return Ok(());
        }
        let conn = db.0.lock().unwrap();
        note_entry = close_segment(&conn, &mut t);
        t.status = TimerStatus::Paused;
    }
    emit_state(&app);
    emit_note_required(&app, note_entry);
    Ok(())
}

#[tauri::command]
pub fn timer_resume(app: AppHandle, timer: State<Timer>) -> Result<(), String> {
    {
        let mut t = timer.0.lock().unwrap();
        if t.status != TimerStatus::Paused {
            return Ok(());
        }
        t.status = TimerStatus::Running;
        t.segment_start = Some(db::now_secs());
    }
    emit_state(&app);
    Ok(())
}

#[tauri::command]
pub fn timer_stop(
    app: AppHandle,
    timer: State<Timer>,
    db: State<Db>,
) -> Result<Option<db::TimeEntry>, String> {
    let note_entry;
    {
        let mut t = timer.0.lock().unwrap();
        if t.status == TimerStatus::Idle {
            return Ok(None);
        }
        let conn = db.0.lock().unwrap();
        note_entry = close_segment(&conn, &mut t);
        *t = TimerState::new();
    }
    emit_state(&app);
    emit_note_required(&app, note_entry.clone());
    crate::sync::request_sync(&app);
    Ok(note_entry)
}

#[tauri::command]
pub fn timer_get_state(app: AppHandle) -> TimerSnapshot {
    snapshot(&app)
}

/// Thread che ogni secondo aggiorna frontend e tray mentre il timer corre.
pub fn spawn_tick_thread(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
        let running = {
            let timer = app.state::<Timer>();
            let t = timer.0.lock().unwrap();
            t.status == TimerStatus::Running
        };
        if running {
            emit_state(&app);
        }
    });
}
