use serde::Deserialize;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

const PLUGIN_IDENTIFIER: &str = "com.minimamente.moonytask";

pub struct GoogleAuth<R: Runtime>(PluginHandle<R>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleAuthToken {
    pub access_token: String,
    pub email: Option<String>,
    pub expires_in_secs: i64,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("google-auth")
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "GoogleAuthPlugin")?;
            app.manage(GoogleAuth(handle));
            Ok(())
        })
        .build()
}

pub fn authorize(app: &AppHandle, interactive: bool) -> Result<GoogleAuthToken, String> {
    app.state::<GoogleAuth<tauri::Wry>>()
        .0
        .run_mobile_plugin(
            "authorize",
            serde_json::json!({ "interactive": interactive }),
        )
        .map_err(|error| error.to_string())
}
