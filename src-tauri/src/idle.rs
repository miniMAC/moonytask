use crate::timer::{Timer, TimerStatus};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const POLL_SECS: u64 = 15;
/// Dopo questo tempo senza input il timer chiede cosa fare del tempo trascorso.
const IDLE_THRESHOLD_SECS: i64 = 10 * 60;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdlePrompt {
    /// Momento (epoch) in cui è iniziata l'inattività.
    pub idle_start_epoch: i64,
    pub idle_secs: i64,
}

/// Thread che osserva l'inattività dell'utente mentre il timer corre: dopo 10
/// minuti senza mouse/tastiera apre la finestra principale e chiede se tenere
/// il tempo nella sessione o fermare il timer all'inizio dell'inattività.
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        // una sola richiesta per periodo di inattività: si riarma quando
        // l'utente torna attivo o il timer non è in esecuzione
        let mut prompted = false;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(POLL_SECS));

            let running = {
                let timer = app.state::<Timer>();
                let t = timer.0.lock().unwrap();
                t.status == TimerStatus::Running
            };
            if !running {
                prompted = false;
                continue;
            }

            let Some(idle) = idle_secs() else { continue };
            if idle < IDLE_THRESHOLD_SECS {
                prompted = false;
                continue;
            }
            if prompted {
                continue;
            }
            prompted = true;

            crate::tray::show_main_window(&app);
            let _ = app.emit(
                "idle_detected",
                IdlePrompt {
                    idle_start_epoch: crate::db::now_secs() - idle,
                    idle_secs: idle,
                },
            );
        }
    });
}

/// Secondi trascorsi dall'ultimo input dell'utente; `None` se non rilevabile
/// (in quel caso il controllo resta semplicemente disattivato).
#[cfg(target_os = "macos")]
fn idle_secs() -> Option<i64> {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state_id: u32, event_type: u32) -> f64;
    }
    // kCGEventSourceStateCombinedSessionState = 0, kCGAnyInputEventType = !0
    let secs = unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) };
    secs.is_finite().then_some(secs as i64)
}

#[cfg(target_os = "windows")]
fn idle_secs() -> Option<i64> {
    #[repr(C)]
    struct LastInputInfo {
        cb_size: u32,
        dw_time: u32,
    }
    #[link(name = "user32")]
    extern "system" {
        fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetTickCount() -> u32;
    }
    let mut info = LastInputInfo {
        cb_size: std::mem::size_of::<LastInputInfo>() as u32,
        dw_time: 0,
    };
    unsafe {
        if GetLastInputInfo(&mut info) == 0 {
            return None;
        }
        Some((GetTickCount().wrapping_sub(info.dw_time) / 1000) as i64)
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn idle_secs() -> Option<i64> {
    // xprintidle riporta i millisecondi di inattività (solo X11/XWayland)
    let out = std::process::Command::new("xprintidle").output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<i64>()
        .ok()
        .map(|ms| ms / 1000)
}
