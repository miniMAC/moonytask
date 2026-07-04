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
    let hours = total / 3600;
    let minutes = (total % 3600) / 60;
    let seconds = total % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("00:{minutes:02}:{seconds:02}")
    }
}

// colori del badge nella menu bar (RGB)
const BADGE_GREEN: [u8; 3] = [50, 215, 75];
const BADGE_AMBER: [u8; 3] = [255, 214, 10];
// altezza del badge in pixel: 18pt @2x per schermi retina
const BADGE_HEIGHT: usize = 36;

/// Font monospace di sistema usato per disegnare il tempo nella menu bar.
fn badge_font() -> Option<&'static fontdue::Font> {
    static FONT: std::sync::OnceLock<Option<fontdue::Font>> = std::sync::OnceLock::new();
    FONT.get_or_init(|| {
        // Menlo.ttc indice 1 = Menlo Bold (0 = Regular)
        let candidates: [(&str, u32); 3] = [
            ("/System/Library/Fonts/Menlo.ttc", 1),
            ("/System/Library/Fonts/Menlo.ttc", 0),
            ("/System/Library/Fonts/Monaco.ttf", 0),
        ];
        for (path, index) in candidates {
            let Ok(bytes) = std::fs::read(path) else {
                continue;
            };
            let settings = fontdue::FontSettings {
                collection_index: index,
                ..fontdue::FontSettings::default()
            };
            if let Ok(font) = fontdue::Font::from_bytes(bytes, settings) {
                if font.lookup_glyph_index('0') != 0 {
                    return Some(font);
                }
            }
        }
        None
    })
    .as_ref()
}

/// Disegna "● H:MM:SS" (verde) o "⏸ H:MM:SS" (ambra) come immagine per la tray.
fn timer_badge(status: TimerStatus, time: &str) -> Option<Image<'static>> {
    let font = badge_font()?;
    let color = if status == TimerStatus::Paused {
        BADGE_AMBER
    } else {
        BADGE_GREEN
    };

    let h = BADGE_HEIGHT;
    let px = 26.0f32;
    let baseline = 27i32;
    let pad = 2usize;
    let sym_w = 11usize;
    let gap = 8usize;

    let text_w: f32 = time.chars().map(|c| font.metrics(c, px).advance_width).sum();
    let w = pad + sym_w + gap + text_w.ceil() as usize + pad;

    let mut buf = vec![0u8; w * h * 4];
    let mut put = |x: i32, y: i32, coverage: f32| {
        if x < 0 || y < 0 || x >= w as i32 || y >= h as i32 {
            return;
        }
        let alpha = (coverage.clamp(0.0, 1.0) * 255.0).round() as u8;
        let idx = (y as usize * w + x as usize) * 4;
        if alpha > buf[idx + 3] {
            buf[idx] = color[0];
            buf[idx + 1] = color[1];
            buf[idx + 2] = color[2];
            buf[idx + 3] = alpha;
        }
    };

    // simbolo a sinistra: pallino pieno (running) o barre di pausa (paused)
    let center_y = 18.0f32;
    if status == TimerStatus::Paused {
        for y in 11..25 {
            for x in 0..4 {
                put((pad + x) as i32, y, 1.0);
                put((pad + 7 + x) as i32, y, 1.0);
            }
        }
    } else {
        let cx = pad as f32 + sym_w as f32 / 2.0;
        let r = 5.5f32;
        for y in 0..h as i32 {
            for x in 0..(pad + sym_w + 2) as i32 {
                let dx = x as f32 + 0.5 - cx;
                let dy = y as f32 + 0.5 - center_y;
                let dist = (dx * dx + dy * dy).sqrt();
                put(x, y, r - dist + 0.5);
            }
        }
    }

    // testo del tempo
    let mut cursor = (pad + sym_w + gap) as f32;
    for c in time.chars() {
        let (metrics, bitmap) = font.rasterize(c, px);
        let gx = cursor.round() as i32 + metrics.xmin;
        let gy = baseline - metrics.height as i32 - metrics.ymin;
        for row in 0..metrics.height {
            for col in 0..metrics.width {
                let coverage = bitmap[row * metrics.width + col] as f32 / 255.0;
                put(gx + col as i32, gy + row as i32, coverage);
            }
        }
        cursor += metrics.advance_width;
    }

    Some(Image::new_owned(buf, w as u32, h as u32))
}

fn labels(app: &AppHandle) -> (String, String, String, String, String) {
    let lang = {
        let db = app.state::<crate::db::Db>();
        let conn = db.0.lock().unwrap();
        crate::db::get_setting(&conn, "language").unwrap_or_else(|| "it".into())
    };
    if lang == "en" {
        (
            "Open MoonyTask".into(),
            "Pause".into(),
            "Resume".into(),
            "Stop".into(),
            "Quit".into(),
        )
    } else {
        (
            "Apri MoonyTask".into(),
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
    match snap.status {
        TimerStatus::Idle => {
            // nessun timer: solo l'icona template (bianca su barra scura), senza testo
            let _ = tray.set_icon_with_as_template(Some(tray_icon(app)), true);
            let _ = tray.set_title(None::<&str>);
            let _ = tray.set_tooltip(None::<&str>);
        }
        _ => {
            let time = fmt_hms(snap.elapsed_secs);
            if let Some(badge) = timer_badge(snap.status, &time) {
                // timer attivo: badge colorato (verde/ambra) al posto dell'icona
                let _ = tray.set_icon_with_as_template(Some(badge), false);
                let _ = tray.set_title(None::<&str>);
            } else {
                // fallback se il font di sistema non è disponibile
                let mark = if snap.status == TimerStatus::Paused {
                    "⏸"
                } else {
                    "🟢"
                };
                let _ = tray.set_icon_with_as_template(Some(tray_icon(app)), true);
                let _ = tray.set_title(Some(format!("{mark} {time}")));
            }
            let _ = tray.set_tooltip(snap.project_name.as_deref());
        }
    }

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


