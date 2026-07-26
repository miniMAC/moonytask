use serde::Deserialize;

const FILE_NAME: &str = "moonytask-data.json";
pub const REAUTHORIZATION_REQUIRED: &str = "google_reauthorization_required";
// nome usato dalle build precedenti al rebranding TinyTime → MoonyTask:
// se esiste ancora va letto (migrazione) e poi eliminato
const LEGACY_FILE_NAME: &str = "tinytime-data.json";

#[derive(Deserialize)]
struct FileList {
    files: Vec<DriveFile>,
}

#[derive(Deserialize)]
struct DriveFile {
    id: String,
}

#[derive(Deserialize)]
struct About {
    user: DriveUser,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveUser {
    email_address: String,
}

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap()
}

fn checked_response(
    response: reqwest::blocking::Response,
    operation: &str,
) -> Result<reqwest::blocking::Response, String> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }

    let body = response.text().unwrap_or_default();
    if requires_reauthorization(status, &body) {
        return Err(REAUTHORIZATION_REQUIRED.into());
    }

    let detail = google_error_summary(&body)
        .map(|summary| format!(": {summary}"))
        .unwrap_or_default();
    Err(format!(
        "{operation}: HTTP {} {}{detail}",
        status.as_u16(),
        status.canonical_reason().unwrap_or("Google Drive error")
    ))
}

fn requires_reauthorization(status: reqwest::StatusCode, body: &str) -> bool {
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return true;
    }
    if status != reqwest::StatusCode::FORBIDDEN {
        return false;
    }

    let normalized = body.to_ascii_lowercase();
    [
        "access_token_scope_insufficient",
        "insufficientpermissions",
        "insufficient permission",
        "insufficient authentication scopes",
        "invalid credentials",
        "\"reason\":\"autherror\"",
        "\"reason\": \"autherror\"",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

fn google_error_summary(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let error = value.get("error")?;
    let message = error.get("message").and_then(|value| value.as_str());
    let reason = error
        .get("details")
        .and_then(|value| value.as_array())
        .and_then(|details| {
            details.iter().find_map(|detail| {
                detail
                    .get("reason")
                    .and_then(|value| value.as_str())
                    .filter(|reason| !reason.is_empty())
            })
        })
        .or_else(|| {
            error
                .get("errors")
                .and_then(|value| value.as_array())
                .and_then(|errors| {
                    errors
                        .iter()
                        .find_map(|item| item.get("reason").and_then(|value| value.as_str()))
                })
        })
        .or_else(|| error.get("status").and_then(|value| value.as_str()));

    match (reason, message) {
        (Some(reason), Some(message)) => Some(format!("{reason}: {message}")),
        (Some(reason), None) => Some(reason.to_string()),
        (None, Some(message)) => Some(message.to_string()),
        (None, None) => None,
    }
}

pub fn find_file(token: &str) -> Result<Option<String>, String> {
    find_by_name(token, FILE_NAME)
}

pub fn account_email(token: &str) -> Result<String, String> {
    let response = client()
        .get("https://www.googleapis.com/drive/v3/about")
        .query(&[("fields", "user(emailAddress)")])
        .bearer_auth(token)
        .send()
        .map_err(|error| error.to_string())?;
    let about: About = checked_response(response, "drive_account_failed")?
        .json()
        .map_err(|error| error.to_string())?;
    let email = about.user.email_address.trim().to_ascii_lowercase();
    if email.is_empty() {
        return Err("google_email_unavailable".into());
    }
    Ok(email)
}

pub fn find_legacy_file(token: &str) -> Result<Option<String>, String> {
    find_by_name(token, LEGACY_FILE_NAME)
}

fn find_by_name(token: &str, name: &str) -> Result<Option<String>, String> {
    let response = client()
        .get("https://www.googleapis.com/drive/v3/files")
        .query(&[
            ("spaces", "appDataFolder"),
            ("q", &format!("name = '{name}'")),
            ("fields", "files(id)"),
        ])
        .bearer_auth(token)
        .send()
        .map_err(|e| e.to_string())?;
    let resp: FileList = checked_response(response, "drive_list_failed")?
        .json()
        .map_err(|e| e.to_string())?;
    Ok(resp.files.into_iter().next().map(|f| f.id))
}

pub fn delete_file(token: &str, file_id: &str) -> Result<(), String> {
    let response = client()
        .delete(format!(
            "https://www.googleapis.com/drive/v3/files/{file_id}"
        ))
        .bearer_auth(token)
        .send()
        .map_err(|e| e.to_string())?;
    checked_response(response, "drive_delete_failed")?;
    Ok(())
}

pub fn download(token: &str, file_id: &str) -> Result<String, String> {
    let response = client()
        .get(format!(
            "https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
        ))
        .bearer_auth(token)
        .send()
        .map_err(|e| e.to_string())?;
    checked_response(response, "drive_download_failed")?
        .text()
        .map_err(|e| e.to_string())
}

pub fn upload(token: &str, file_id: Option<&str>, body: &str) -> Result<String, String> {
    match file_id {
        Some(id) => {
            let response = client()
                .patch(format!(
                    "https://www.googleapis.com/upload/drive/v3/files/{id}?uploadType=media"
                ))
                .bearer_auth(token)
                .header("Content-Type", "application/json")
                .body(body.to_string())
                .send()
                .map_err(|e| e.to_string())?;
            checked_response(response, "drive_update_failed")?;
            Ok(id.to_string())
        }
        None => {
            let boundary = "moonytask_boundary_7f3a";
            let metadata = format!("{{\"name\":\"{FILE_NAME}\",\"parents\":[\"appDataFolder\"]}}");
            let multipart = format!(
                "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/json\r\n\r\n{body}\r\n--{boundary}--"
            );
            let response = client()
                .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")
                .bearer_auth(token)
                .header(
                    "Content-Type",
                    format!("multipart/related; boundary={boundary}"),
                )
                .body(multipart)
                .send()
                .map_err(|e| e.to_string())?;
            let resp: DriveFile = checked_response(response, "drive_create_failed")?
                .json()
                .map_err(|e| e.to_string())?;
            Ok(resp.id)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insufficient_scope_requires_reauthorization() {
        let body = r#"{
          "error": {
            "code": 403,
            "message": "Request had insufficient authentication scopes.",
            "status": "PERMISSION_DENIED",
            "details": [{
              "reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
              "domain": "googleapis.com"
            }]
          }
        }"#;

        assert!(requires_reauthorization(
            reqwest::StatusCode::FORBIDDEN,
            body
        ));
    }

    #[test]
    fn api_configuration_error_does_not_discard_the_account() {
        let body = r#"{
          "error": {
            "code": 403,
            "message": "Google Drive API has not been used in project 123 before.",
            "status": "PERMISSION_DENIED",
            "errors": [{ "reason": "accessNotConfigured" }]
          }
        }"#;

        assert!(!requires_reauthorization(
            reqwest::StatusCode::FORBIDDEN,
            body
        ));
        assert_eq!(
            google_error_summary(body).as_deref(),
            Some("accessNotConfigured: Google Drive API has not been used in project 123 before.")
        );
    }

    #[test]
    fn unauthorized_always_requires_reauthorization() {
        assert!(requires_reauthorization(
            reqwest::StatusCode::UNAUTHORIZED,
            ""
        ));
    }
}
