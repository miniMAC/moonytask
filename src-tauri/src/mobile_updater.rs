use semver::Version;
use serde::Deserialize;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

const UPDATE_MANIFEST_URL: &str = "https://moonytask.com/downloads/latest.json";

#[derive(Deserialize)]
struct UpdateManifest {
    version: Version,
    notes: Option<String>,
    mobile: Option<MobileDownloads>,
}

#[derive(Deserialize)]
struct MobileDownloads {
    android: Option<MobileDownload>,
    ios: Option<MobileDownload>,
}

#[derive(Deserialize)]
struct MobileDownload {
    url: String,
}

struct Texts {
    title: &'static str,
    body: &'static str,
    download: &'static str,
    later: &'static str,
    error_title: &'static str,
    error_body: &'static str,
}

fn texts(app: &AppHandle) -> Texts {
    let lang = {
        let db = app.state::<crate::db::Db>();
        let conn = db.0.lock().unwrap();
        crate::db::get_setting(&conn, "language").unwrap_or_else(|| "it".into())
    };

    if lang == "en" {
        Texts {
            title: "Update available",
            body: "MoonyTask {version} is available. Download it now?",
            download: "Download",
            later: "Later",
            error_title: "Download failed",
            error_body: "The download page could not be opened.",
        }
    } else {
        Texts {
            title: "Aggiornamento disponibile",
            body: "È disponibile MoonyTask {version}. Vuoi scaricarlo ora?",
            download: "Scarica",
            later: "Più tardi",
            error_title: "Download non riuscito",
            error_body: "Non è stato possibile aprire la pagina di download.",
        }
    }
}

/// Controlla il manifest non appena l'app mobile viene aperta.
/// Su mobile Tauri non può installare l'update in-app: il link HTTPS viene
/// aperto nel browser/store di sistema e l'installazione resta sotto il
/// controllo dell'utente e del sistema operativo.
pub fn spawn_startup_check(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || check(app));
}

fn check(app: AppHandle) {
    let manifest = match fetch_manifest() {
        Ok(manifest) => manifest,
        Err(_) => return, // il controllo all'avvio resta silenzioso senza rete
    };

    if manifest.version <= app.package_info().version {
        return;
    }

    let Some(download) = platform_download(&manifest) else {
        return;
    };
    if !download.url.starts_with("https://") {
        return;
    }

    let t = texts(&app);
    let version = manifest.version.to_string();
    let mut body = t.body.replace("{version}", &version);
    if let Some(notes) = manifest
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
    {
        body.push_str("\n\n");
        body.push_str(notes);
    }

    let accepted = app
        .dialog()
        .message(body)
        .title(t.title)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            t.download.into(),
            t.later.into(),
        ))
        .blocking_show();

    if accepted
        && app
            .opener()
            .open_url(download.url.clone(), None::<&str>)
            .is_err()
    {
        app.dialog()
            .message(t.error_body)
            .title(t.error_title)
            .kind(MessageDialogKind::Error)
            .blocking_show();
    }
}

fn fetch_manifest() -> Result<UpdateManifest, reqwest::Error> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("MoonyTask mobile updater")
        .build()?
        .get(UPDATE_MANIFEST_URL)
        .send()?
        .error_for_status()?
        .json()
}

fn platform_download(manifest: &UpdateManifest) -> Option<&MobileDownload> {
    let mobile = manifest.mobile.as_ref()?;

    #[cfg(target_os = "android")]
    return mobile.android.as_ref();

    #[cfg(target_os = "ios")]
    return mobile.ios.as_ref();

    #[allow(unreachable_code)]
    None
}
