#[cfg(not(target_os = "android"))]
use base64::Engine;
#[cfg(not(target_os = "android"))]
use rand::Rng;
use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "android"))]
use sha2::{Digest, Sha256};
use tauri::AppHandle;

#[cfg(not(target_os = "android"))]
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
#[cfg(not(target_os = "android"))]
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
#[cfg(not(target_os = "android"))]
const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata openid email";
#[cfg(desktop)]
const KEYRING_SERVICE: &str = "com.minimamente.moonytask";
#[cfg(desktop)]
const KEYRING_USER: &str = "google_oauth";
#[cfg(mobile)]
const TOKENS_SETTING: &str = "google_oauth_tokens";

#[derive(Serialize, Deserialize, Clone)]
pub struct StoredTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

#[cfg(not(target_os = "android"))]
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
    id_token: Option<String>,
    scope: Option<String>,
}

#[cfg(not(target_os = "android"))]
fn checked_token_response(
    response: reqwest::blocking::Response,
    operation: &str,
    invalid_grant_requires_reauthorization: bool,
) -> Result<reqwest::blocking::Response, String> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }

    let body = response.text().unwrap_or_default();
    if invalid_grant_requires_reauthorization && is_invalid_grant(status, &body) {
        return Err(crate::sync::drive::REAUTHORIZATION_REQUIRED.into());
    }

    let detail = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| {
            let code = value.get("error").and_then(|value| value.as_str())?;
            let description = value
                .get("error_description")
                .and_then(|value| value.as_str());
            Some(match description {
                Some(description) => format!(": {code}: {description}"),
                None => format!(": {code}"),
            })
        })
        .unwrap_or_default();
    Err(format!(
        "{operation}: HTTP {} {}{detail}",
        status.as_u16(),
        status.canonical_reason().unwrap_or("Google OAuth error")
    ))
}

#[cfg(not(target_os = "android"))]
fn is_invalid_grant(status: reqwest::StatusCode, body: &str) -> bool {
    status == reqwest::StatusCode::BAD_REQUEST && body.contains("\"invalid_grant\"")
}

// su desktop i token vivono nel keychain; su mobile nel db SQLite,
// che su Android/iOS sta già nella sandbox privata dell'app
#[cfg(desktop)]
pub fn load_tokens(_app: &AppHandle) -> Option<StoredTokens> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?;
    let raw = entry.get_password().ok()?;
    serde_json::from_str(&raw).ok()
}

#[cfg(desktop)]
pub fn save_tokens(_app: &AppHandle, tokens: &StoredTokens) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
    entry
        .set_password(&serde_json::to_string(tokens).unwrap())
        .map_err(|e| e.to_string())
}

#[cfg(desktop)]
pub fn clear_tokens(_app: &AppHandle) {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        let _ = entry.delete_credential();
    }
}

#[cfg(mobile)]
pub fn load_tokens(app: &AppHandle) -> Option<StoredTokens> {
    use tauri::Manager;
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap();
    let raw = crate::db::get_setting(&conn, TOKENS_SETTING)?;
    serde_json::from_str(&raw).ok()
}

#[cfg(mobile)]
pub fn save_tokens(app: &AppHandle, tokens: &StoredTokens) -> Result<(), String> {
    use tauri::Manager;
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap();
    crate::db::set_setting(
        &conn,
        TOKENS_SETTING,
        &serde_json::to_string(tokens).unwrap(),
    )
    .map_err(|e| e.to_string())
}

#[cfg(mobile)]
pub fn clear_tokens(app: &AppHandle) {
    use tauri::Manager;
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap();
    let _ = crate::db::set_setting(&conn, TOKENS_SETTING, "");
}

#[cfg(not(target_os = "android"))]
fn random_verifier() -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..64)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

#[cfg(not(target_os = "android"))]
fn email_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    let json: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    json.get("email")?.as_str().map(|s| s.to_string())
}

/// Esegue il flusso OAuth completo: apre il browser, attende il redirect sul
/// listener di loopback, scambia il code. `login_hint` pre-seleziona l'account
/// Google nel browser. Ritorna (tokens, email).
#[cfg(not(target_os = "android"))]
pub fn login(
    app: &AppHandle,
    client_id: &str,
    client_secret: &str,
    login_hint: Option<&str>,
) -> Result<(StoredTokens, Option<String>), String> {
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server.server_addr().to_ip().ok_or("no addr")?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let verifier = random_verifier();
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(Sha256::digest(verifier.as_bytes()));
    let state: String = random_verifier()[..16].to_string();

    let mut url = format!(
        "{AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&state={}&access_type=offline&prompt=consent",
        urlencoding::encode(client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(SCOPE),
        challenge,
        state,
    );
    if let Some(hint) = login_hint.filter(|h| !h.trim().is_empty()) {
        url.push_str(&format!("&login_hint={}", urlencoding::encode(hint.trim())));
    }

    open_browser(app, &url)?;

    // attende il redirect (max 3 minuti)
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
    let code = loop {
        let remaining = deadline
            .checked_duration_since(std::time::Instant::now())
            .ok_or("login_timeout")?;
        let Some(req) = server.recv_timeout(remaining).map_err(|e| e.to_string())? else {
            return Err("login_timeout".into());
        };
        let raw_url = req.url().to_string();
        let query: std::collections::HashMap<String, String> = raw_url
            .splitn(2, '?')
            .nth(1)
            .unwrap_or("")
            .split('&')
            .filter_map(|kv| {
                let mut it = kv.splitn(2, '=');
                Some((
                    it.next()?.to_string(),
                    urlencoding::decode(it.next()?).ok()?.to_string(),
                ))
            })
            .collect();

        if query.get("state").map(|s| s.as_str()) != Some(state.as_str()) {
            let _ = req.respond(html_response("Invalid request"));
            continue;
        }
        if let Some(err) = query.get("error") {
            let _ = req.respond(html_response("Login annullato / Login cancelled"));
            return Err(format!("oauth_error: {err}"));
        }
        if let Some(code) = query.get("code") {
            let _ = req.respond(html_response(
                "MoonyTask è connesso! Puoi chiudere questa finestra. / MoonyTask is connected! You can close this window.",
            ));
            break code.clone();
        }
        let _ = req.respond(html_response("Waiting for login..."));
    };

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap();
    let response = client
        .post(TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", &code),
            ("code_verifier", &verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", &redirect_uri),
        ])
        .send()
        .map_err(|e| e.to_string())?;
    let resp: TokenResponse = checked_token_response(response, "token_exchange_failed", false)?
        .json()
        .map_err(|e| e.to_string())?;

    let email = resp.id_token.as_deref().and_then(email_from_id_token);
    if resp.scope.as_deref().is_some_and(|scopes| {
        !scopes
            .split_ascii_whitespace()
            .any(|scope| scope == "https://www.googleapis.com/auth/drive.appdata")
    }) {
        return Err(crate::sync::drive::REAUTHORIZATION_REQUIRED.into());
    }

    let tokens = StoredTokens {
        access_token: resp.access_token,
        refresh_token: resp.refresh_token.ok_or("no_refresh_token")?,
        expires_at: crate::db::now_secs() + resp.expires_in - 60,
    };
    Ok((tokens, email))
}

/// Su Android il callback loopback non è supportato da Google. Usa invece
/// Google Identity Services, che restituisce direttamente un access token per
/// Drive e riporta l'utente nell'Activity dell'app.
#[cfg(target_os = "android")]
pub fn login(
    app: &AppHandle,
    _client_id: &str,
    _client_secret: &str,
    login_hint: Option<&str>,
) -> Result<(StoredTokens, Option<String>), String> {
    let auth = crate::android_google_auth::authorize(app, true)?;
    let tokens = StoredTokens {
        access_token: auth.access_token,
        refresh_token: String::new(),
        expires_at: crate::db::now_secs() + auth.expires_in_secs.saturating_sub(60),
    };
    let email = auth.email.or_else(|| {
        login_hint
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    });
    Ok((tokens, email))
}

/// Ritorna un access token valido, rinfrescandolo se scaduto.
#[cfg(not(target_os = "android"))]
pub fn valid_access_token(
    app: &AppHandle,
    client_id: &str,
    client_secret: &str,
) -> Result<String, String> {
    let tokens = load_tokens(app).ok_or("not_connected")?;
    if tokens.expires_at > crate::db::now_secs() {
        return Ok(tokens.access_token);
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap();
    let response = client
        .post(TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", tokens.refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .map_err(|e| e.to_string())?;
    let response = match checked_token_response(response, "token_refresh_failed", true) {
        Ok(response) => response,
        Err(error) => {
            if error == crate::sync::drive::REAUTHORIZATION_REQUIRED {
                clear_tokens(app);
            }
            return Err(error);
        }
    };
    let resp: TokenResponse = response.json().map_err(|e| e.to_string())?;

    let new_tokens = StoredTokens {
        access_token: resp.access_token.clone(),
        refresh_token: tokens.refresh_token,
        expires_at: crate::db::now_secs() + resp.expires_in - 60,
    };
    save_tokens(app, &new_tokens)?;
    Ok(resp.access_token)
}

/// Google Play Services rinnova il token Android senza aprire schermate se
/// l'autorizzazione è ancora valida. Se è stata revocata, elimina la sessione
/// locale così la UI può proporre nuovamente il pulsante di accesso.
#[cfg(target_os = "android")]
pub fn valid_access_token(
    app: &AppHandle,
    _client_id: &str,
    _client_secret: &str,
) -> Result<String, String> {
    if let Some(tokens) = load_tokens(app) {
        if tokens.expires_at > crate::db::now_secs() {
            return Ok(tokens.access_token);
        }
    } else {
        return Err("not_connected".into());
    }

    let auth = match crate::android_google_auth::authorize(app, false) {
        Ok(auth) => auth,
        Err(error) => {
            clear_tokens(app);
            return Err(error);
        }
    };
    let tokens = StoredTokens {
        access_token: auth.access_token,
        refresh_token: String::new(),
        expires_at: crate::db::now_secs() + auth.expires_in_secs.saturating_sub(60),
    };
    let access_token = tokens.access_token.clone();
    save_tokens(app, &tokens)?;
    Ok(access_token)
}

#[cfg(not(target_os = "android"))]
fn html_response(msg: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let body = format!(
        "<html><body style=\"font-family:sans-serif;text-align:center;padding-top:4em\"><h2>{msg}</h2></body></html>"
    );
    tiny_http::Response::from_data(body.into_bytes()).with_header(
        tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
            .unwrap(),
    )
}

// il plugin opener apre il browser di sistema su tutte le piattaforme,
// Android incluso (dove `open` non esiste)
#[cfg(not(target_os = "android"))]
fn open_browser(app: &AppHandle, url: &str) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<String>)
        .map_err(|e| e.to_string())
}

#[cfg(all(test, not(target_os = "android")))]
mod tests {
    use super::*;

    #[test]
    fn revoked_refresh_token_requires_reauthorization() {
        let revoked = r#"{"error":"invalid_grant","error_description":"Token has been revoked."}"#;
        let unrelated =
            r#"{"error":"invalid_client","error_description":"The OAuth client was not found."}"#;

        assert!(is_invalid_grant(reqwest::StatusCode::BAD_REQUEST, revoked));
        assert!(!is_invalid_grant(
            reqwest::StatusCode::BAD_REQUEST,
            unrelated
        ));
        assert!(!is_invalid_grant(
            reqwest::StatusCode::UNAUTHORIZED,
            revoked
        ));
    }
}
