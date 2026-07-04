use serde::Deserialize;

const FILE_NAME: &str = "tinytime-data.json";

#[derive(Deserialize)]
struct FileList {
    files: Vec<DriveFile>,
}

#[derive(Deserialize)]
struct DriveFile {
    id: String,
}

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap()
}

pub fn find_file(token: &str) -> Result<Option<String>, String> {
    let resp: FileList = client()
        .get("https://www.googleapis.com/drive/v3/files")
        .query(&[
            ("spaces", "appDataFolder"),
            ("q", &format!("name = '{FILE_NAME}'")),
            ("fields", "files(id)"),
        ])
        .bearer_auth(token)
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| format!("drive_list_failed: {e}"))?
        .json()
        .map_err(|e| e.to_string())?;
    Ok(resp.files.into_iter().next().map(|f| f.id))
}

pub fn download(token: &str, file_id: &str) -> Result<String, String> {
    client()
        .get(format!(
            "https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
        ))
        .bearer_auth(token)
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| format!("drive_download_failed: {e}"))?
        .text()
        .map_err(|e| e.to_string())
}

pub fn upload(token: &str, file_id: Option<&str>, body: &str) -> Result<String, String> {
    match file_id {
        Some(id) => {
            client()
                .patch(format!(
                    "https://www.googleapis.com/upload/drive/v3/files/{id}?uploadType=media"
                ))
                .bearer_auth(token)
                .header("Content-Type", "application/json")
                .body(body.to_string())
                .send()
                .map_err(|e| e.to_string())?
                .error_for_status()
                .map_err(|e| format!("drive_update_failed: {e}"))?;
            Ok(id.to_string())
        }
        None => {
            let boundary = "tinytime_boundary_7f3a";
            let metadata = format!("{{\"name\":\"{FILE_NAME}\",\"parents\":[\"appDataFolder\"]}}");
            let multipart = format!(
                "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/json\r\n\r\n{body}\r\n--{boundary}--"
            );
            let resp: DriveFile = client()
                .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")
                .bearer_auth(token)
                .header(
                    "Content-Type",
                    format!("multipart/related; boundary={boundary}"),
                )
                .body(multipart)
                .send()
                .map_err(|e| e.to_string())?
                .error_for_status()
                .map_err(|e| format!("drive_create_failed: {e}"))?
                .json()
                .map_err(|e| e.to_string())?;
            Ok(resp.id)
        }
    }
}
