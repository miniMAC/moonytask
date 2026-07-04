use crate::db::{self, Db};
use crate::timer::{Timer, TimerStatus};
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager};

const POLL_SECS: u64 = 5;
const DEFAULT_COOLDOWN_SECS: i64 = 15 * 60;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchSuggestion {
    pub bundle_id: String,
    pub app_name: String,
    pub project_id: Option<String>,
}

/// Thread che osserva l'app in primo piano: se è nella watch list, il timer è
/// fermo e l'uso continuativo supera la soglia configurata, mostra il popover.
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut current_bundle: Option<String> = None;
        let mut continuous_secs: i64 = 0;
        let mut last_notified: HashMap<String, i64> = HashMap::new();

        loop {
            std::thread::sleep(std::time::Duration::from_secs(POLL_SECS));

            let notifications_enabled = {
                let db = app.state::<Db>();
                let conn = db.0.lock().unwrap();
                db::get_setting(&conn, "watch_notifications")
                    .map(|v| v == "1")
                    .unwrap_or(true)
            };
            if !notifications_enabled {
                current_bundle = None;
                continuous_secs = 0;
                continue;
            }

            let timer_idle = {
                let timer = app.state::<Timer>();
                let t = timer.0.lock().unwrap();
                t.status == TimerStatus::Idle
            };

            let Some((bundle, _name)) = crate::apps::frontmost_app() else {
                current_bundle = None;
                continuous_secs = 0;
                continue;
            };

            if current_bundle.as_deref() == Some(bundle.as_str()) {
                continuous_secs += POLL_SECS as i64;
            } else {
                current_bundle = Some(bundle.clone());
                continuous_secs = 0;
            }

            if !timer_idle {
                continue;
            }

            let watched = {
                let db = app.state::<Db>();
                let conn = db.0.lock().unwrap();
                db::watched_list_inner(&conn).unwrap_or_default()
            };
            let Some(w) = watched
                .iter()
                .find(|w| w.enabled == 1 && w.bundle_id == bundle)
            else {
                continue;
            };

            if continuous_secs < w.remind_after_secs {
                continue;
            }

            let now = db::now_secs();
            let snoozed_until = {
                let db = app.state::<Db>();
                let conn = db.0.lock().unwrap();
                db::get_setting(&conn, &format!("watch_snooze_until:{bundle}"))
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(0)
            };
            if now < snoozed_until {
                continue;
            }
            let resumed_from_snooze = snoozed_until > 0
                && last_notified
                    .get(&bundle)
                    .map(|last| *last < snoozed_until)
                    .unwrap_or(false);

            let cooldown = {
                let db = app.state::<Db>();
                let conn = db.0.lock().unwrap();
                db::get_setting(&conn, "watch_cooldown_secs")
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(DEFAULT_COOLDOWN_SECS)
            };
            if !resumed_from_snooze
                && last_notified
                    .get(&bundle)
                    .map(|t| now - t < cooldown)
                    .unwrap_or(false)
            {
                continue;
            }
            last_notified.insert(bundle.clone(), now);

            crate::tray::show_popover(&app);
            let _ = app.emit(
                "watcher_reminder",
                WatchSuggestion {
                    bundle_id: w.bundle_id.clone(),
                    app_name: w.app_name.clone(),
                    project_id: w.project_id.clone(),
                },
            );
        }
    });
}
