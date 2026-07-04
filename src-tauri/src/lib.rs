mod apps;
mod db;
mod sync;
mod timer;
mod tray;
mod watcher;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_positioner::init())
        .setup(|app| {
            let handle = app.handle().clone();

            let conn = db::init(&handle)?;
            app.manage(db::Db(Mutex::new(conn)));
            app.manage(timer::Timer(Mutex::new(timer::TimerState::new())));

            tray::setup(&handle)?;
            tray::fit_main_window(&handle);
            timer::spawn_tick_thread(handle.clone());
            watcher::spawn(handle.clone());
            sync::spawn_auto_sync(handle.clone());
            sync::request_sync(&handle);

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                // chiudere la finestra non termina l'app: resta nella menu bar
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                // il popover si nasconde quando perde il focus
                tauri::WindowEvent::Focused(false) if window.label() == "popover" => {
                    let _ = window.hide();
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            db::folders_list,
            db::folder_create,
            db::folder_update,
            db::folder_delete,
            db::project_totals,
            db::projects_list,
            db::project_create,
            db::project_update,
            db::project_delete,
            db::entries_range,
            db::entry_delete,
            db::entry_update_note,
            db::entries_merge,
            db::entry_add_manual,
            db::project_payments_list,
            db::project_payment_create,
            db::project_payment_delete,
            db::data_export,
            db::project_export,
            db::report_export_pdf,
            db::watched_list,
            db::watched_add,
            db::watched_update,
            db::watched_remove,
            db::watcher_snooze,
            db::settings_get,
            db::settings_set,
            timer::timer_start,
            timer::timer_pause,
            timer::timer_resume,
            timer::timer_stop,
            timer::timer_get_state,
            apps::apps_installed,
            tray::open_main,
            tray::hide_popover,
            tray::quit_now,
            sync::sync_status,
            sync::sync_set_credentials,
            sync::sync_login,
            sync::sync_logout,
            sync::sync_now,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // prima di uscire fa un'ultima sync (best effort, con timeout di rete)
            if let tauri::RunEvent::ExitRequested { code, api, .. } = &event {
                use std::sync::atomic::{AtomicBool, Ordering};
                static EXIT_SYNC_DONE: AtomicBool = AtomicBool::new(false);
                if !EXIT_SYNC_DONE.swap(true, Ordering::SeqCst) {
                    api.prevent_exit();
                    let handle = app_handle.clone();
                    let code = code.unwrap_or(0);
                    std::thread::spawn(move || {
                        sync::sync_before_exit(&handle);
                        handle.exit(code);
                    });
                }
            }
        });
}
