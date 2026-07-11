use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

struct Texts {
    available_title: String,
    available_body: String,
    install: String,
    later: String,
    installed_body: String,
    restart: String,
    uptodate_body: String,
    error_title: String,
}

fn texts(app: &AppHandle) -> Texts {
    let lang = {
        let db = app.state::<crate::db::Db>();
        let conn = db.0.lock().unwrap();
        crate::db::get_setting(&conn, "language").unwrap_or_else(|| "it".into())
    };
    if lang == "en" {
        Texts {
            available_title: "Update available".into(),
            available_body: "MoonyTask {version} is available. Install it now?".into(),
            install: "Install".into(),
            later: "Later".into(),
            installed_body: "Update installed. Restart MoonyTask now to use the new version?"
                .into(),
            restart: "Restart".into(),
            uptodate_body: "No updates available. You already have the latest version.".into(),
            error_title: "Update failed".into(),
        }
    } else {
        Texts {
            available_title: "Aggiornamento disponibile".into(),
            available_body: "È disponibile MoonyTask {version}. Vuoi installarlo ora?".into(),
            install: "Installa".into(),
            later: "Più tardi".into(),
            installed_body:
                "Aggiornamento installato. Riavviare MoonyTask ora per usare la nuova versione?"
                    .into(),
            restart: "Riavvia".into(),
            uptodate_body: "Nessun aggiornamento disponibile. Hai già l'ultima versione.".into(),
            error_title: "Aggiornamento non riuscito".into(),
        }
    }
}

fn error_dialog(app: &AppHandle, t: &Texts, detail: &str) {
    let message = if detail.contains("404") {
        format!(
            "{}\n\nAggiornamento non riuscito: il pacchetto non è stato trovato sul server (404). Controlla che il file `latest.json` punti all'URL corretto e che l'artifact sia caricato in /downloads/.",
            detail
        )
    } else {
        detail.to_string()
    };

    app.dialog()
        .message(&message)
        .title(&t.error_title)
        .kind(MessageDialogKind::Error)
        .blocking_show();
}

/// Controllo manuale (voce di menu): mostra sempre l'esito all'utente.
pub fn check_interactive(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { check(app, true).await });
}

/// Controllo silenzioso all'avvio: parla solo se c'è un aggiornamento.
pub fn spawn_startup_check(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        tauri::async_runtime::block_on(check(app, false));
    });
}

async fn check(app: AppHandle, interactive: bool) {
    let t = texts(&app);
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => {
            if interactive {
                error_dialog(&app, &t, &err.to_string());
            }
            return;
        }
    };
    match updater.check().await {
        Ok(Some(update)) => {
            let body = t.available_body.replace("{version}", &update.version);
            let install = app
                .dialog()
                .message(body)
                .title(&t.available_title)
                .kind(MessageDialogKind::Info)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    t.install.clone(),
                    t.later.clone(),
                ))
                .blocking_show();
            if !install {
                return;
            }
            match update.download_and_install(|_, _| {}, || {}).await {
                Ok(()) => {
                    let restart = app
                        .dialog()
                        .message(&t.installed_body)
                        .title(&t.available_title)
                        .kind(MessageDialogKind::Info)
                        .buttons(MessageDialogButtons::OkCancelCustom(
                            t.restart.clone(),
                            t.later.clone(),
                        ))
                        .blocking_show();
                    if restart {
                        app.restart();
                    }
                }
                Err(err) => error_dialog(&app, &t, &err.to_string()),
            }
        }
        Ok(None) => {
            if interactive {
                app.dialog()
                    .message(&t.uptodate_body)
                    .title("MoonyTask")
                    .kind(MessageDialogKind::Info)
                    .blocking_show();
            }
        }
        Err(err) => {
            if interactive {
                error_dialog(&app, &t, &err.to_string());
            }
        }
    }
}
