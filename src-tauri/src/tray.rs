use crate::timer::{TimerSnapshot, TimerStatus};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow,
};
use tauri_plugin_positioner::{Position as TrayPosition, WindowExt};

const TRAY_ID: &str = "main-tray";

fn fmt_hms(total: i64) -> String {
    format!(
        "{:02}:{:02}:{:02}",
        total / 3600,
        (total % 3600) / 60,
        total % 60
    )
}

fn labels(app: &AppHandle) -> (String, String, String, String, String) {
    let lang = {
        let db = app.state::<crate::db::Db>();
        let conn = db.0.lock().unwrap();
        crate::db::get_setting(&conn, "language").unwrap_or_else(|| "it".into())
    };
    if lang == "en" {
        (
            "Open TinyTime".into(),
            "Pause".into(),
            "Resume".into(),
            "Stop".into(),
            "Quit".into(),
        )
    } else {
        (
            "Apri TinyTime".into(),
            "Pausa".into(),
            "Riprendi".into(),
            "Stop".into(),
            "Esci".into(),
        )
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let (open, pause, _resume, stop, quit) = labels(app);
    let open_i = MenuItem::with_id(app, "open", &open, true, None::<&str>)?;
    let pause_i = MenuItem::with_id(app, "pause_resume", &pause, false, None::<&str>)?;
    let stop_i = MenuItem::with_id(app, "stop", &stop, false, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", &quit, true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open_i,
            &PredefinedMenuItem::separator(app)?,
            &pause_i,
            &stop_i,
            &PredefinedMenuItem::separator(app)?,
            &quit_i,
        ],
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_icon(app))
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_popover(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            match id {
                "open" => show_main_window(app),
                "pause_resume" => {
                    let status = {
                        let timer = app.state::<crate::timer::Timer>();
                        let t = timer.0.lock().unwrap();
                        t.status
                    };
                    match status {
                        TimerStatus::Running => {
                            let _ =
                                crate::timer::timer_pause(app.clone(), app.state(), app.state());
                        }
                        TimerStatus::Paused => {
                            let _ = crate::timer::timer_resume(app.clone(), app.state());
                        }
                        TimerStatus::Idle => {}
                    }
                }
                "stop" => {
                    let _ = crate::timer::timer_stop(app.clone(), app.state(), app.state());
                }
                "quit" => {
                    show_main_window(app);
                    let _ = app.emit("quit_requested", ());
                }
                _ => {}
            }
        })
        .build(app)?;

    // memorizza gli item per aggiornarli dopo
    app.manage(TrayMenuItems {
        pause: pause_i,
        stop: stop_i,
    });
    Ok(())
}

fn tray_icon(_app: &AppHandle) -> Image<'static> {
    Image::from_bytes(include_bytes!("../icons/tray/32x32.png")).expect("valid tray icon")
}

pub struct TrayMenuItems {
    pause: MenuItem<tauri::Wry>,
    stop: MenuItem<tauri::Wry>,
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        fit_main_window_to_monitor(&win);
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

pub fn fit_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        fit_main_window_to_monitor(&win);
    }
}

fn fit_main_window_to_monitor(win: &WebviewWindow) {
    let monitor = win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };

    let size = monitor.size();
    let position = monitor.position();
    let max_width = size.width.saturating_sub(80).max(860);
    let max_height = size.height.saturating_sub(80).max(560);
    let width = ((size.width as f64) * 0.6).round() as u32;
    let height = ((size.height as f64) * 0.6).round() as u32;
    let width = width.max(1100).min(max_width);
    let height = height.max(720).min(max_height);

    let x = position.x + ((size.width.saturating_sub(width) / 2) as i32);
    let y = position.y + ((size.height.saturating_sub(height) / 2) as i32);

    let _ = win.set_size(Size::Physical(PhysicalSize { width, height }));
    let _ = win.set_position(Position::Physical(PhysicalPosition { x, y }));
}

/// Mostra/nasconde il popover ancorato all'icona nella menu bar.
pub fn toggle_popover(app: &AppHandle) {
    let Some(win) = app.get_webview_window("popover") else {
        return;
    };
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
    } else {
        fit_popover_to_monitor(&win);
        let _ = win
            .as_ref()
            .window()
            .move_window(TrayPosition::TrayBottomCenter);
        let _ = win.show();
        let _ = win.set_focus();
    }
}

pub fn show_popover(app: &AppHandle) {
    let Some(win) = app.get_webview_window("popover") else {
        return;
    };
    fit_popover_to_monitor(&win);
    let _ = win
        .as_ref()
        .window()
        .move_window(TrayPosition::TrayBottomCenter);
    let _ = win.show();
    let _ = win.set_focus();
}

fn fit_popover_to_monitor(win: &WebviewWindow) {
    let monitor = win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };

    let size = monitor.size();
    let max_width = size.width.saturating_sub(40).max(560);
    let max_height = size.height.saturating_sub(60).max(500);
    let width = 700.min(max_width);
    let height = (((size.height as f64) * 0.5).round() as u32)
        .max(620)
        .min(max_height);

    let _ = win.set_size(Size::Physical(PhysicalSize { width, height }));
}

#[tauri::command]
pub fn open_main(app: AppHandle) {
    if let Some(pop) = app.get_webview_window("popover") {
        let _ = pop.hide();
    }
    show_main_window(&app);
}

#[tauri::command]
pub fn hide_popover(app: AppHandle) {
    if let Some(pop) = app.get_webview_window("popover") {
        let _ = pop.hide();
    }
}

#[tauri::command]
pub fn quit_now(app: AppHandle) {
    app.exit(0);
}

/// Aggiorna titolo tray e voci di menu in base allo stato del timer.
pub fn refresh(app: &AppHandle, snap: &TimerSnapshot) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let title = match snap.status {
        TimerStatus::Idle => None,
        _ => {
            let name = snap.project_name.clone().unwrap_or_default();
            let pause_mark = if snap.status == TimerStatus::Paused {
                "⏸ "
            } else {
                ""
            };
            Some(format!(
                "{}{} · {}",
                pause_mark,
                fmt_hms(snap.elapsed_secs),
                name
            ))
        }
    };
    let _ = tray.set_title(title.as_deref());

    if let Some(items) = app.try_state::<TrayMenuItems>() {
        let (_open, pause, resume, _stop, _quit) = labels(app);
        match snap.status {
            TimerStatus::Idle => {
                let _ = items.pause.set_enabled(false);
                let _ = items.stop.set_enabled(false);
                let _ = items.pause.set_text(&pause);
            }
            TimerStatus::Running => {
                let _ = items.pause.set_enabled(true);
                let _ = items.stop.set_enabled(true);
                let _ = items.pause.set_text(&pause);
            }
            TimerStatus::Paused => {
                let _ = items.pause.set_enabled(true);
                let _ = items.stop.set_enabled(true);
                let _ = items.pause.set_text(&resume);
            }
        }
    }
}
