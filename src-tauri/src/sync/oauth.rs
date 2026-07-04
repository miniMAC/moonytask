use base64::Engine;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata openid email";
const KEYRING_SERVICE: &str = "com.minimamente.tinytime";
const KEYRING_USER: &str = "google_oauth";

#[derive(Serialize, Deserialize, Clone)]
pub struct StoredTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
    id_token: Option<String>,
}

pub fn load_tokens() -> Option<StoredTokens> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?;
    let raw = entry.get_password().ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn save_tokens(tokens: &StoredTokens) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
    entry
        .set_password(&serde_json::to_string(tokens).unwrap())
        .map_err(|e| e.to_string())
}

pub fn clear_tokens() {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        let _ = entry.delete_credential();
    }
}

fn random_verifier() -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..64)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

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
pub fn login(
    client_id: &str,
    client_secret: &str,
    login_hint: Option<&str>,
) -> Result<(StoredTokens, Option<String>), String> {
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or("no addr")?
        .port();
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

    open_browser(&url)?;

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
                "TinyTime è connesso! Puoi chiudere questa finestra. / TinyTime is connected! You can close this window.",
            ));
            break code.clone();
        }
        let _ = req.respond(html_response("Waiting for login..."));
    };

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap();
    let resp: TokenResponse = client
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
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| format!("token_exchange_failed: {e}"))?
        .json()
        .map_err(|e| e.to_string())?;

    let email = resp.id_token.as_deref().and_then(email_from_id_token);
    let tokens = StoredTokens {
        access_token: resp.access_token,
        refresh_token: resp.refresh_token.ok_or("no_refresh_token")?,
        expires_at: crate::db::now_secs() + resp.expires_in - 60,
    };
    save_tokens(&tokens)?;
    Ok((tokens, email))
}

/// Ritorna un access token valido, rinfrescandolo se scaduto.
pub fn valid_access_token(client_id: &str, client_secret: &str) -> Result<String, String> {
    let tokens = load_tokens().ok_or("not_connected")?;
    if tokens.expires_at > crate::db::now_secs() {
        return Ok(tokens.access_token);
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap();
    let resp: TokenResponse = client
        .post(TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", tokens.refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| format!("token_refresh_failed: {e}"))?
        .json()
        .map_err(|e| e.to_string())?;

    let new_tokens = StoredTokens {
        access_token: resp.access_token.clone(),
        refresh_token: tokens.refresh_token,
        expires_at: crate::db::now_secs() + resp.expires_in - 60,
    };
    save_tokens(&new_tokens)?;
    Ok(resp.access_token)
}

fn html_response(msg: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let body = format!(
        "<html><body style=\"font-family:sans-serif;text-align:center;padding-top:4em\"><h2>{msg}</h2></body></html>"
    );
    tiny_http::Response::from_data(body.into_bytes()).with_header(
        tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
            .unwrap(),
    )
}

fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("unsupported platform".into())
    }
}
