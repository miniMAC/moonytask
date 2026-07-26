use crate::db::{self, Db};
use reqwest::blocking::{Client, Response};
use reqwest::StatusCode;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const API_URL: &str = match option_env!("MOONYTASK_API_URL") {
    Some(value) => value,
    None => "https://api.moonytask.com",
};
const PUBLICATION_POLL_SECS: u64 = 5;
const MAX_RETRY_SECS: i64 = 15 * 60;
#[cfg(desktop)]
const KEYRING_SERVICE: &str = "com.minimamente.moonytask";
#[cfg(desktop)]
const KEYRING_USER: &str = "master_device";
#[cfg(mobile)]
const DEVICE_TOKEN_SETTING: &str = "master_device_token";

static PUBLICATION_PENDING: AtomicBool = AtomicBool::new(false);
static PUBLICATION_WORKER_STARTED: AtomicBool = AtomicBool::new(false);
static RETRY_ATTEMPT: AtomicU32 = AtomicU32::new(0);
static NEXT_RETRY_AT: AtomicI64 = AtomicI64::new(0);
static APP_SESSION_CACHE: Mutex<Option<AppSessionResponse>> = Mutex::new(None);

#[derive(Debug)]
struct MasterError {
    status: Option<u16>,
    code: String,
    message: String,
}

impl std::fmt::Display for MasterError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl From<reqwest::Error> for MasterError {
    fn from(error: reqwest::Error) -> Self {
        Self {
            status: error.status().map(|status| status.as_u16()),
            code: "network_error".into(),
            message: error.to_string(),
        }
    }
}

#[derive(Deserialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Deserialize)]
struct ErrorBody {
    code: String,
    message: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSessionResponse {
    token: String,
    expires_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivateResponse {
    device_token: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MasterFolderSelection {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub updated_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MasterRequestStatus {
    pub id: String,
    #[serde(rename = "type")]
    pub request_type: String,
    pub status: String,
    pub rejection_reason: Option<String>,
    pub requested_at: i64,
    pub resolved_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MasterLicenseStatus {
    pub id: String,
    pub status: String,
    pub starts_at: i64,
    pub expires_at: i64,
    pub code: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MasterApiStatus {
    pub enabled: bool,
    pub updated_at: Option<i64>,
    pub waiting_for_app: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MasterPublicationStatus {
    pub etag: Option<String>,
    pub size_bytes: Option<i64>,
    pub generated_at: Option<i64>,
    pub last_upload: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MasterAccount {
    pub email: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MasterAssociationAccount {
    pub email: String,
    pub display_name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MasterAssociationStatus {
    pub id: String,
    pub status: String,
    pub requested_at: i64,
    pub approved_at: Option<i64>,
    pub master: MasterAssociationAccount,
    pub master_license_active: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MasterStatus {
    pub account: MasterAccount,
    #[serde(default = "standard_role")]
    pub role: String,
    #[serde(default)]
    pub can_publish: bool,
    #[serde(default)]
    pub association: Option<MasterAssociationStatus>,
    pub request: Option<MasterRequestStatus>,
    pub license: Option<MasterLicenseStatus>,
    pub api: MasterApiStatus,
    pub selected_folders: Vec<MasterFolderSelection>,
    pub publication: MasterPublicationStatus,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub device_activated: bool,
}

fn standard_role() -> String {
    "standard".into()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublishedFolderV1 {
    pub id: String,
    pub name: String,
    pub position: i64,
    pub color: Option<String>,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublishedProjectV1 {
    pub id: String,
    pub folder_id: String,
    pub name: String,
    pub hourly_rate: f64,
    pub rate_profile_id: Option<String>,
    pub color: Option<String>,
    pub archived: bool,
    pub position: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublishedRateProfileV1 {
    pub id: String,
    pub name: String,
    pub payment_type: String,
    pub hourly_rate: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublishedTimeEntryV1 {
    pub id: String,
    pub project_id: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_secs: i64,
    pub note: Option<String>,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublishedProjectPaymentV1 {
    pub id: String,
    pub project_id: String,
    pub paid_at: i64,
    pub paid_through_at: i64,
    pub note: Option<String>,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublishedSnapshotV1 {
    pub schema_version: i64,
    pub generated_at: i64,
    pub currency: String,
    pub folders: Vec<PublishedFolderV1>,
    pub projects: Vec<PublishedProjectV1>,
    pub rate_profiles: Vec<PublishedRateProfileV1>,
    pub time_entries: Vec<PublishedTimeEntryV1>,
    pub project_payments: Vec<PublishedProjectPaymentV1>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MasterAssociationSummary {
    pub id: String,
    pub member_account_id: String,
    pub email: String,
    pub display_name: Option<String>,
    pub status: String,
    pub requested_at: i64,
    pub approved_at: Option<i64>,
    pub selected_folder_count: i64,
    pub last_upload: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MasterAssociationsResponse {
    associations: Vec<MasterAssociationSummary>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MasterSharedMember {
    pub association_id: String,
    pub account: MasterAssociationAccount,
    pub publication: MasterPublicationStatus,
    pub snapshot: Option<PublishedSnapshotV1>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MasterSharedData {
    pub members: Vec<MasterSharedMember>,
}

fn http_client() -> Result<Client, MasterError> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(MasterError::from)
}

fn endpoint(path: &str) -> String {
    format!("{}{}", API_URL.trim_end_matches('/'), path)
}

fn parse_response<T: for<'de> Deserialize<'de>>(response: Response) -> Result<T, MasterError> {
    let status = response.status();
    let body = response.text().map_err(MasterError::from)?;
    if status.is_success() {
        return serde_json::from_str(&body).map_err(|error| MasterError {
            status: Some(status.as_u16()),
            code: "invalid_server_response".into(),
            message: error.to_string(),
        });
    }
    let error = serde_json::from_str::<ErrorEnvelope>(&body).ok();
    Err(MasterError {
        status: Some(status.as_u16()),
        code: error
            .as_ref()
            .map(|value| value.error.code.clone())
            .unwrap_or_else(|| "server_error".into()),
        message: error
            .map(|value| value.error.message)
            .unwrap_or_else(|| format!("HTTP {}", status.as_u16())),
    })
}

fn request_app_session(app: &AppHandle) -> Result<AppSessionResponse, MasterError> {
    // The access token is obtained from the existing Drive connection and is
    // sent only to Google's verifier endpoint through the MoonyTask Worker.
    // It is never persisted by the Master subsystem.
    let google_access_token =
        crate::sync::identity_access_token(app).map_err(|message| MasterError {
            status: None,
            code: "google_drive_required".into(),
            message,
        })?;
    let response = http_client()?
        .post(endpoint("/v1/app/session"))
        .json(&serde_json::json!({ "googleAccessToken": google_access_token }))
        .send()
        .map_err(MasterError::from)?;
    parse_response::<AppSessionResponse>(response)
}

fn app_session(app: &AppHandle) -> Result<String, MasterError> {
    if let Ok(cache) = APP_SESSION_CACHE.lock() {
        if let Some(session) = cache
            .as_ref()
            .filter(|session| session.expires_at > db::now_secs() + 30)
        {
            return Ok(session.token.clone());
        }
    }
    let session = request_app_session(app)?;
    let token = session.token.clone();
    if let Ok(mut cache) = APP_SESSION_CACHE.lock() {
        *cache = Some(session);
    }
    Ok(token)
}

fn fresh_app_session(app: &AppHandle) -> Result<String, MasterError> {
    let session = request_app_session(app)?;
    let token = session.token.clone();
    if let Ok(mut cache) = APP_SESSION_CACHE.lock() {
        *cache = Some(session);
    }
    Ok(token)
}

#[cfg(desktop)]
fn load_device_token(_app: &AppHandle) -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .ok()?
        .get_password()
        .ok()
        .filter(|token| !token.is_empty())
}

#[cfg(desktop)]
fn save_device_token(_app: &AppHandle, token: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|error| error.to_string())?
        .set_password(token)
        .map_err(|error| error.to_string())
}

#[cfg(desktop)]
pub fn clear_device_token(_app: &AppHandle) {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        let _ = entry.delete_credential();
    }
}

#[cfg(mobile)]
fn load_device_token(app: &AppHandle) -> Option<String> {
    let database = app.state::<Db>();
    let connection = database.0.lock().ok()?;
    db::get_setting(&connection, DEVICE_TOKEN_SETTING).filter(|token| !token.is_empty())
}

#[cfg(mobile)]
fn save_device_token(app: &AppHandle, token: &str) -> Result<(), String> {
    let database = app.state::<Db>();
    let connection = database.0.lock().map_err(|error| error.to_string())?;
    db::set_setting(&connection, DEVICE_TOKEN_SETTING, token).map_err(|error| error.to_string())
}

#[cfg(mobile)]
pub fn clear_device_token(app: &AppHandle) {
    let database = app.state::<Db>();
    if let Ok(connection) = database.0.lock() {
        let _ = db::set_setting(&connection, DEVICE_TOKEN_SETTING, "");
    };
}

fn status_with_token(app: &AppHandle, token: &str) -> Result<MasterStatus, MasterError> {
    let response = http_client()?
        .get(endpoint("/v1/master/status"))
        .bearer_auth(token)
        .send()
        .map_err(MasterError::from)?;
    let mut status = parse_response::<MasterStatus>(response)?;
    status.device_activated = token.starts_with("mtd_");
    // Keep existing licensed installations working during a backend-first
    // rolling deployment where older status responses do not yet include the
    // role/canPublish fields.
    if status.role == "standard" && status.license.is_some() {
        status.role = "master".into();
    }
    if status.role == "master"
        && matches!(
            status
                .license
                .as_ref()
                .map(|license| license.status.as_str()),
            Some("active")
        )
    {
        status.can_publish = true;
    }
    cache_status(app, &status);
    if matches!(
        local_last_error(app).as_deref(),
        Some(error)
            if error.starts_with("invalid_google_token:")
                || error.starts_with("rate_limited:")
    ) {
        set_last_error(app, None);
    }
    status.last_error = local_last_error(app);
    Ok(status)
}

fn load_status(app: &AppHandle) -> Result<MasterStatus, MasterError> {
    if let Some(token) = load_device_token(app) {
        match status_with_token(app, &token) {
            Ok(status) => return Ok(status),
            Err(error) if error.status == Some(StatusCode::UNAUTHORIZED.as_u16()) => {
                clear_device_token(app);
            }
            Err(error) => return Err(error),
        };
    }
    status_with_token(app, &app_session(app)?)
}

fn authenticated_token(app: &AppHandle) -> Result<String, MasterError> {
    load_device_token(app)
        .map(Ok)
        .unwrap_or_else(|| app_session(app))
}

fn master_engaged(app: &AppHandle) -> bool {
    let database = app.state::<Db>();
    let connection = match database.0.lock() {
        Ok(connection) => connection,
        Err(_) => return false,
    };
    db::get_setting(&connection, "master_engaged").as_deref() == Some("1")
}

fn cache_status(app: &AppHandle, status: &MasterStatus) {
    let ids = status
        .selected_folders
        .iter()
        .map(|folder| folder.id.as_str())
        .collect::<Vec<_>>();
    let database = app.state::<Db>();
    if let Ok(connection) = database.0.lock() {
        if let Ok(value) = serde_json::to_string(&ids) {
            let _ = db::set_setting(&connection, "master_selected_folder_ids", &value);
        }
        let _ = db::set_setting(
            &connection,
            "master_api_enabled",
            if status.api.enabled { "1" } else { "0" },
        );
    };
}

fn local_last_error(app: &AppHandle) -> Option<String> {
    let database = app.state::<Db>();
    let connection = database.0.lock().ok()?;
    db::get_setting(&connection, "master_last_error").filter(|value| !value.is_empty())
}

fn set_last_error(app: &AppHandle, error: Option<&str>) {
    let database = app.state::<Db>();
    if let Ok(connection) = database.0.lock() {
        let _ = db::set_setting(&connection, "master_last_error", error.unwrap_or(""));
    };
}

fn cached_snapshot_etag(app: &AppHandle) -> Option<String> {
    let database = app.state::<Db>();
    let connection = database.0.lock().ok()?;
    db::get_setting(&connection, "master_snapshot_etag").filter(|value| !value.is_empty())
}

fn set_cached_snapshot_etag(app: &AppHandle, etag: Option<&str>) {
    let database = app.state::<Db>();
    if let Ok(connection) = database.0.lock() {
        let _ = db::set_setting(&connection, "master_snapshot_etag", etag.unwrap_or(""));
    };
}

fn request_master(app: &AppHandle, request_type: &str) -> Result<MasterStatus, MasterError> {
    if request_type != "initial" && request_type != "renewal" {
        return Err(MasterError {
            status: None,
            code: "invalid_request_type".into(),
            message: "Request type must be initial or renewal.".into(),
        });
    }
    let token = load_device_token(app)
        .map(Ok)
        .unwrap_or_else(|| app_session(app))?;
    let response = http_client()?
        .post(endpoint("/v1/master/requests"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "type": request_type }))
        .send()
        .map_err(MasterError::from)?;
    let _: serde_json::Value = parse_response(response)?;
    status_with_token(app, &token)
}

fn activate_master(app: &AppHandle, code: &str) -> Result<MasterStatus, MasterError> {
    // Always create a fresh app session here so activation proves the current
    // Drive identity even if an old device token exists locally.
    let session = fresh_app_session(app)?;
    let response = http_client()?
        .post(endpoint("/v1/master/activate"))
        .bearer_auth(&session)
        .json(&serde_json::json!({
            "code": code.trim(),
            "deviceLabel": device_label()
        }))
        .send()
        .map_err(MasterError::from)?;
    let activated = parse_response::<ActivateResponse>(response)?;
    save_device_token(app, &activated.device_token).map_err(|message| MasterError {
        status: None,
        code: "secure_storage_failed".into(),
        message,
    })?;
    status_with_token(app, &activated.device_token)
}

fn device_label() -> &'static str {
    #[cfg(target_os = "android")]
    {
        "Android"
    }
    #[cfg(target_os = "macos")]
    {
        "macOS"
    }
    #[cfg(target_os = "windows")]
    {
        "Windows"
    }
    #[cfg(target_os = "linux")]
    {
        "Linux"
    }
    #[cfg(not(any(
        target_os = "android",
        target_os = "macos",
        target_os = "windows",
        target_os = "linux"
    )))]
    {
        "MoonyTask device"
    }
}

fn set_remote_folders(
    app: &AppHandle,
    folders: Vec<MasterFolderSelection>,
) -> Result<MasterStatus, MasterError> {
    let token = authenticated_token(app)?;
    let response = http_client()?
        .put(endpoint("/v1/master/folders"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "folders": folders }))
        .send()
        .map_err(MasterError::from)?;
    let _: serde_json::Value = parse_response(response)?;
    let status = status_with_token(app, &token)?;
    request_publication(app);
    Ok(status)
}

fn request_association(app: &AppHandle, master_email: &str) -> Result<MasterStatus, MasterError> {
    let token = app_session(app)?;
    let response = http_client()?
        .post(endpoint("/v1/master/association-requests"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "masterEmail": master_email.trim() }))
        .send()
        .map_err(MasterError::from)?;
    let _: serde_json::Value = parse_response(response)?;
    status_with_token(app, &token)
}

fn list_associations(app: &AppHandle) -> Result<Vec<MasterAssociationSummary>, MasterError> {
    let token = authenticated_token(app)?;
    let response = http_client()?
        .get(endpoint("/v1/master/associations"))
        .bearer_auth(token)
        .send()
        .map_err(MasterError::from)?;
    parse_response::<MasterAssociationsResponse>(response).map(|result| result.associations)
}

fn update_association(
    app: &AppHandle,
    association_id: &str,
    action: &str,
) -> Result<Vec<MasterAssociationSummary>, MasterError> {
    if action != "approve" && action != "remove" {
        return Err(MasterError {
            status: None,
            code: "invalid_association_action".into(),
            message: "Association action is invalid.".into(),
        });
    }
    let token = authenticated_token(app)?;
    let request = http_client()?
        .request(
            if action == "approve" {
                reqwest::Method::POST
            } else {
                reqwest::Method::DELETE
            },
            endpoint(&format!(
                "/v1/master/associations/{}/{}",
                association_id, action
            )),
        )
        .bearer_auth(&token);
    let response = request.send().map_err(MasterError::from)?;
    let _: serde_json::Value = parse_response(response)?;
    let response = http_client()?
        .get(endpoint("/v1/master/associations"))
        .bearer_auth(token)
        .send()
        .map_err(MasterError::from)?;
    parse_response::<MasterAssociationsResponse>(response).map(|result| result.associations)
}

fn load_shared_data(app: &AppHandle) -> Result<MasterSharedData, MasterError> {
    let token = authenticated_token(app)?;
    let response = http_client()?
        .get(endpoint("/v1/master/shared-data"))
        .bearer_auth(token)
        .send()
        .map_err(MasterError::from)?;
    parse_response(response)
}

pub fn build_published_snapshot(
    connection: &Connection,
    selected_folder_ids: &[String],
) -> Result<PublishedSnapshotV1, String> {
    let selected = selected_folder_ids.iter().cloned().collect::<HashSet<_>>();
    let mut folders = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, name, position, color, updated_at
                 FROM folders WHERE deleted = 0 ORDER BY position, name",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(PublishedFolderV1 {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    position: row.get(2)?,
                    color: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            let folder = row.map_err(|error| error.to_string())?;
            if selected.contains(&folder.id) {
                folders.push(folder);
            }
        }
    }
    let published_folder_ids = folders
        .iter()
        .map(|folder| folder.id.clone())
        .collect::<HashSet<_>>();

    let mut projects = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, folder_id, name, hourly_rate, rate_profile_id, color,
                        archived, position, updated_at
                 FROM projects WHERE deleted = 0 ORDER BY position, name",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(PublishedProjectV1 {
                    id: row.get(0)?,
                    folder_id: row.get(1)?,
                    name: row.get(2)?,
                    hourly_rate: row.get(3)?,
                    rate_profile_id: row.get(4)?,
                    color: row.get(5)?,
                    archived: row.get::<_, i64>(6)? != 0,
                    position: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            let project = row.map_err(|error| error.to_string())?;
            if published_folder_ids.contains(&project.folder_id) {
                projects.push(project);
            }
        }
    }

    let available_rate_profiles = db::get_setting(connection, "rate_profiles")
        .and_then(|raw| serde_json::from_str::<Vec<PublishedRateProfileV1>>(&raw).ok())
        .unwrap_or_default();
    let available_rate_ids = available_rate_profiles
        .iter()
        .map(|profile| profile.id.as_str())
        .collect::<HashSet<_>>();
    for project in &mut projects {
        if project
            .rate_profile_id
            .as_ref()
            .is_some_and(|profile_id| !available_rate_ids.contains(profile_id.as_str()))
        {
            project.rate_profile_id = None;
        }
    }

    let project_ids = projects
        .iter()
        .map(|project| project.id.clone())
        .collect::<HashSet<_>>();
    let referenced_rate_ids = projects
        .iter()
        .filter_map(|project| project.rate_profile_id.clone())
        .collect::<HashSet<_>>();
    let rate_profiles = available_rate_profiles
        .into_iter()
        .filter(|profile| referenced_rate_ids.contains(&profile.id))
        .collect::<Vec<_>>();

    let mut time_entries = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, project_id, started_at, ended_at, duration_secs, note, updated_at
                 FROM time_entries WHERE deleted = 0 ORDER BY started_at",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(PublishedTimeEntryV1 {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    started_at: row.get(2)?,
                    ended_at: row.get(3)?,
                    duration_secs: row.get(4)?,
                    note: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            let entry = row.map_err(|error| error.to_string())?;
            if project_ids.contains(&entry.project_id) {
                time_entries.push(entry);
            }
        }
    }

    let mut project_payments = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, project_id, paid_at, paid_through_at, note, updated_at
                 FROM project_payments WHERE deleted = 0 ORDER BY paid_at",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(PublishedProjectPaymentV1 {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    paid_at: row.get(2)?,
                    paid_through_at: row.get(3)?,
                    note: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            let payment = row.map_err(|error| error.to_string())?;
            if project_ids.contains(&payment.project_id) {
                project_payments.push(payment);
            }
        }
    }

    Ok(PublishedSnapshotV1 {
        schema_version: 1,
        generated_at: db::now_secs(),
        currency: db::get_setting(connection, "currency")
            .filter(|currency| !currency.is_empty())
            .unwrap_or_else(|| "EUR".into()),
        folders,
        projects,
        rate_profiles,
        time_entries,
        project_payments,
    })
}

fn publish_once(app: &AppHandle) -> Result<(), MasterError> {
    let token = authenticated_token(app)?;
    let status = status_with_token(app, &token)?;
    if !status.api.enabled {
        return Ok(());
    }
    if !status_allows_publication(&status, token.starts_with("mtd_")) {
        return Ok(());
    }

    let selected = status
        .selected_folders
        .iter()
        .map(|folder| folder.id.clone())
        .collect::<Vec<_>>();
    let snapshot = {
        let database = app.state::<Db>();
        let connection = database.0.lock().map_err(|error| MasterError {
            status: None,
            code: "database_error".into(),
            message: error.to_string(),
        })?;
        build_published_snapshot(&connection, &selected).map_err(|message| MasterError {
            status: None,
            code: "snapshot_build_failed".into(),
            message,
        })?
    };
    let body = serde_json::to_string(&snapshot).map_err(|error| MasterError {
        status: None,
        code: "snapshot_build_failed".into(),
        message: error.to_string(),
    })?;
    // Use the device's last successful revision, not the just-fetched server
    // revision. A stale device therefore receives 412 instead of overwriting a
    // newer snapshot. The conflict path performs Drive sync and reconciles once.
    let cached_etag = cached_snapshot_etag(app);
    let if_match = cached_etag.as_deref().unwrap_or("*");
    let response = http_client()?
        .put(endpoint("/v1/master/snapshot"))
        .bearer_auth(&token)
        .header("Content-Type", "application/json")
        .header("If-Match", if_match)
        .body(body)
        .send()
        .map_err(MasterError::from)?;
    let value = parse_response::<serde_json::Value>(response)?;
    if let Some(etag) = value.get("etag").and_then(|etag| etag.as_str()) {
        set_cached_snapshot_etag(app, Some(etag));
        let database = app.state::<Db>();
        if let Ok(connection) = database.0.lock() {
            let _ = db::set_setting(
                &connection,
                "master_last_upload",
                &db::now_secs().to_string(),
            );
        };
    }
    Ok(())
}

fn publish_with_conflict_retry(app: &AppHandle) -> Result<(), MasterError> {
    with_precondition_retry(
        || publish_once(app),
        || {
            crate::sync::sync_for_master_retry(app).map_err(|message| MasterError {
                status: None,
                code: "drive_resync_failed".into(),
                message,
            })?;
            let token = authenticated_token(app)?;
            let status = status_with_token(app, &token)?;
            set_cached_snapshot_etag(app, status.publication.etag.as_deref());
            Ok(())
        },
    )
}

fn status_allows_publication(status: &MasterStatus, has_device_token: bool) -> bool {
    status.can_publish
        && (status.role == "member"
            || (status.role == "master"
                && has_device_token
                && license_allows_publication(
                    status
                        .license
                        .as_ref()
                        .map(|license| license.status.as_str()),
                )))
}

fn license_allows_publication(status: Option<&str>) -> bool {
    matches!(status, Some("active"))
}

fn with_precondition_retry<P, S>(mut publish: P, mut sync: S) -> Result<(), MasterError>
where
    P: FnMut() -> Result<(), MasterError>,
    S: FnMut() -> Result<(), MasterError>,
{
    match publish() {
        Err(error) if error.status == Some(StatusCode::PRECONDITION_FAILED.as_u16()) => {
            sync()?;
            publish()
        }
        result => result,
    }
}

fn retry_delay_secs(attempt: u32) -> i64 {
    (2_i64.pow(attempt.min(10) + 1)).min(MAX_RETRY_SECS)
}

pub fn request_publication(_app: &AppHandle) {
    PUBLICATION_PENDING.store(true, Ordering::SeqCst);
    NEXT_RETRY_AT.store(0, Ordering::SeqCst);
}

pub fn spawn_publication_worker(app: AppHandle) {
    if PUBLICATION_WORKER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(PUBLICATION_POLL_SECS));
        if !PUBLICATION_PENDING.load(Ordering::SeqCst)
            || db::now_secs() < NEXT_RETRY_AT.load(Ordering::SeqCst)
        {
            continue;
        }
        if !master_engaged(&app) {
            PUBLICATION_PENDING.store(false, Ordering::SeqCst);
            continue;
        }
        match publish_with_conflict_retry(&app) {
            Ok(()) => {
                PUBLICATION_PENDING.store(false, Ordering::SeqCst);
                RETRY_ATTEMPT.store(0, Ordering::SeqCst);
                NEXT_RETRY_AT.store(0, Ordering::SeqCst);
                set_last_error(&app, None);
            }
            Err(error) => {
                let attempt = RETRY_ATTEMPT.fetch_add(1, Ordering::SeqCst);
                let delay = retry_delay_secs(attempt);
                NEXT_RETRY_AT.store(db::now_secs() + delay, Ordering::SeqCst);
                set_last_error(&app, Some(&error.to_string()));
            }
        }
    });
}

#[tauri::command]
pub async fn master_status(app: AppHandle) -> Result<MasterStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        load_status(&app).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn master_request(app: AppHandle, request_type: String) -> Result<MasterStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        request_master(&app, &request_type).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn master_association_request(
    app: AppHandle,
    master_email: String,
) -> Result<MasterStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        request_association(&app, &master_email).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn master_associations(app: AppHandle) -> Result<Vec<MasterAssociationSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        list_associations(&app).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn master_association_approve(
    app: AppHandle,
    association_id: String,
) -> Result<Vec<MasterAssociationSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        update_association(&app, &association_id, "approve").map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn master_association_remove(
    app: AppHandle,
    association_id: String,
) -> Result<Vec<MasterAssociationSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        update_association(&app, &association_id, "remove").map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn master_shared_data(app: AppHandle) -> Result<MasterSharedData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        load_shared_data(&app).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn master_activate(app: AppHandle, code: String) -> Result<MasterStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        activate_master(&app, &code).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn master_set_folders(
    app: AppHandle,
    folders: Vec<MasterFolderSelection>,
) -> Result<MasterStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_remote_folders(&app, folders).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn master_publish_now(app: AppHandle) -> Result<(), String> {
    if !master_engaged(&app) {
        return Err("master_not_enabled".into());
    }
    request_publication(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE folders (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL,
                    color TEXT, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL
                 );
                 CREATE TABLE projects (
                    id TEXT PRIMARY KEY, folder_id TEXT NOT NULL, name TEXT NOT NULL,
                    hourly_rate REAL NOT NULL, rate_profile_id TEXT, color TEXT,
                    archived INTEGER NOT NULL, position INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL
                 );
                 CREATE TABLE time_entries (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, started_at INTEGER NOT NULL,
                    ended_at INTEGER NOT NULL, duration_secs INTEGER NOT NULL, note TEXT,
                    updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL
                 );
                 CREATE TABLE project_payments (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, paid_at INTEGER NOT NULL,
                    paid_through_at INTEGER NOT NULL, note TEXT, updated_at INTEGER NOT NULL,
                    deleted INTEGER NOT NULL
                 );
                 CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 INSERT INTO folders VALUES ('f1', 'One', 0, NULL, 10, 0);
                 INSERT INTO folders VALUES ('f2', 'Two', 1, '#fff', 11, 0);
                 INSERT INTO folders VALUES ('deleted-folder', 'Deleted', 2, NULL, 12, 1);
                 INSERT INTO projects VALUES ('p1', 'f1', 'Active', 50, 'r1', NULL, 0, 0, 20, 0);
                 INSERT INTO projects VALUES ('p2', 'f1', 'Archived', 80, 'r2', NULL, 1, 1, 21, 0);
                 INSERT INTO projects VALUES ('p3', 'f2', 'Other folder', 90, NULL, NULL, 0, 0, 22, 0);
                 INSERT INTO projects VALUES ('orphan-profile', 'f1', 'Orphan profile', 75, 'missing-rate-profile', NULL, 0, 2, 23, 0);
                 INSERT INTO projects VALUES ('deleted-project', 'f1', 'Deleted', 10, NULL, NULL, 0, 2, 23, 1);
                 INSERT INTO time_entries VALUES ('e1', 'p1', 100, 200, 100, 'note', 30, 0);
                 INSERT INTO time_entries VALUES ('e2', 'p2', 200, 300, 100, NULL, 31, 0);
                 INSERT INTO time_entries VALUES ('e3', 'p3', 300, 400, 100, 'other', 32, 0);
                 INSERT INTO time_entries VALUES ('deleted-entry', 'p1', 400, 500, 100, 'deleted', 33, 1);
                 INSERT INTO project_payments VALUES ('pay1', 'p1', 500, 400, 'paid', 40, 0);
                 INSERT INTO project_payments VALUES ('pay2', 'p3', 600, 500, NULL, 41, 0);
                 INSERT INTO project_payments VALUES ('deleted-pay', 'p1', 700, 600, NULL, 42, 1);
                 INSERT INTO settings VALUES ('currency', 'USD');
                 INSERT INTO settings VALUES (
                   'rate_profiles',
                   '[{\"id\":\"r1\",\"name\":\"One\",\"paymentType\":\"hourly\",\"hourlyRate\":50},{\"id\":\"r2\",\"name\":\"Two\",\"paymentType\":\"fixed\",\"hourlyRate\":80},{\"id\":\"unused\",\"name\":\"Unused\",\"paymentType\":\"retainer\",\"hourlyRate\":100}]'
                 );
                 INSERT INTO settings VALUES ('google_oauth_tokens', 'secret');
                 INSERT INTO settings VALUES ('master_device_token', 'secret-device');",
            )
            .unwrap();
        connection
    }

    #[test]
    fn one_folder_contains_only_related_complete_data() {
        let snapshot = build_published_snapshot(&database(), &["f1".into()]).unwrap();
        assert_eq!(snapshot.folders.len(), 1);
        assert_eq!(snapshot.projects.len(), 3);
        assert!(snapshot.projects.iter().any(|project| project.archived));
        assert!(snapshot
            .projects
            .iter()
            .find(|project| project.id == "orphan-profile")
            .unwrap()
            .rate_profile_id
            .is_none());
        assert_eq!(snapshot.time_entries.len(), 2);
        assert_eq!(snapshot.project_payments.len(), 1);
        assert_eq!(snapshot.rate_profiles.len(), 2);
        assert_eq!(snapshot.currency, "USD");

        let json = serde_json::to_string(&snapshot).unwrap();
        for excluded in [
            "Other folder",
            "deleted-folder",
            "deleted-project",
            "deleted-entry",
            "deleted-pay",
            "Unused",
            "google_oauth_tokens",
            "master_device_token",
            "secret-device",
            "watched_apps",
            "missing-rate-profile",
            "settings",
        ] {
            assert!(
                !json.contains(excluded),
                "unexpected field/value: {excluded}"
            );
        }
        assert!(json.contains("\"note\":\"note\""));
        assert!(json.contains("\"hourlyRate\":50.0"));
        assert!(json.contains("\"paidThroughAt\":400"));
    }

    #[test]
    fn multiple_folders_include_the_union_without_deleted_rows() {
        let snapshot = build_published_snapshot(&database(), &["f1".into(), "f2".into()]).unwrap();
        assert_eq!(snapshot.folders.len(), 2);
        assert_eq!(snapshot.projects.len(), 4);
        assert_eq!(snapshot.time_entries.len(), 3);
        assert_eq!(snapshot.project_payments.len(), 2);
        assert_eq!(snapshot.rate_profiles.len(), 2);
    }

    #[test]
    fn offline_retry_delay_is_exponential_and_capped() {
        assert_eq!(retry_delay_secs(0), 2);
        assert_eq!(retry_delay_secs(1), 4);
        assert_eq!(retry_delay_secs(5), 64);
        assert_eq!(retry_delay_secs(20), MAX_RETRY_SECS.min(2048));
    }

    #[test]
    fn precondition_failure_runs_one_drive_sync_and_one_retry() {
        let publications = Cell::new(0);
        let syncs = Cell::new(0);
        let result = with_precondition_retry(
            || {
                let attempt = publications.get();
                publications.set(attempt + 1);
                if attempt == 0 {
                    Err(MasterError {
                        status: Some(412),
                        code: "stale_snapshot".into(),
                        message: "stale".into(),
                    })
                } else {
                    Ok(())
                }
            },
            || {
                syncs.set(syncs.get() + 1);
                Ok(())
            },
        );
        assert!(result.is_ok());
        assert_eq!(publications.get(), 2);
        assert_eq!(syncs.get(), 1);
    }

    #[test]
    fn expired_and_revoked_licenses_never_publish() {
        assert!(license_allows_publication(Some("active")));
        assert!(!license_allows_publication(Some("expired")));
        assert!(!license_allows_publication(Some("revoked")));
        assert!(!license_allows_publication(None));
    }
}
