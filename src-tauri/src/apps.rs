use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub bundle_id: String,
    pub name: String,
}

#[cfg(target_os = "macos")]
fn read_app_bundle(path: &Path) -> Option<InstalledApp> {
    let info = path.join("Contents/Info.plist");
    let value = plist::Value::from_file(&info).ok()?;
    let dict = value.as_dictionary()?;
    let bundle_id = dict.get("CFBundleIdentifier")?.as_string()?.to_string();
    let name = dict
        .get("CFBundleDisplayName")
        .and_then(|v| v.as_string())
        .or_else(|| dict.get("CFBundleName").and_then(|v| v.as_string()))
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            path.file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default()
        });
    Some(InstalledApp { bundle_id, name })
}

#[cfg(target_os = "macos")]
fn scan_dir(dir: &Path, out: &mut BTreeMap<String, InstalledApp>, depth: u8) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "app").unwrap_or(false) {
            if let Some(app) = read_app_bundle(&path) {
                out.entry(app.bundle_id.clone()).or_insert(app);
            }
        } else if depth > 0 && path.is_dir() {
            scan_dir(&path, out, depth - 1);
        }
    }
}

#[tauri::command]
pub fn apps_installed() -> Result<Vec<InstalledApp>, String> {
    #[cfg(target_os = "macos")]
    {
        let mut out: BTreeMap<String, InstalledApp> = BTreeMap::new();
        let home = std::env::var("HOME").unwrap_or_default();
        for dir in [
            "/Applications".to_string(),
            "/System/Applications".to_string(),
            format!("{home}/Applications"),
        ] {
            scan_dir(Path::new(&dir), &mut out, 1);
        }
        let mut apps: Vec<InstalledApp> = out.into_values().collect();
        apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(apps)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}

/// Ritorna (bundle_id, nome) dell'app attualmente in primo piano.
#[cfg(target_os = "macos")]
pub fn frontmost_app() -> Option<(String, String)> {
    use objc2_app_kit::NSWorkspace;
    unsafe {
        let ws = NSWorkspace::sharedWorkspace();
        let app = ws.frontmostApplication()?;
        let bundle_id = app.bundleIdentifier().map(|s| s.to_string())?;
        let name = app
            .localizedName()
            .map(|s| s.to_string())
            .unwrap_or_else(|| bundle_id.clone());
        Some((bundle_id, name))
    }
}

#[cfg(not(target_os = "macos"))]
pub fn frontmost_app() -> Option<(String, String)> {
    None
}
