use crate::keychain;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use url::Url;

pub fn validate_server_url(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Server URL cannot be empty".to_string());
    }

    let parsed = Url::parse(trimmed).map_err(|e| format!("Invalid URL: {}", e))?;

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Server URL must not contain credentials".to_string());
    }
    if parsed.query().is_some() {
        return Err("Server URL must not contain query parameters".to_string());
    }
    if parsed.fragment().is_some() {
        return Err("Server URL must not contain a fragment".to_string());
    }

    let path = parsed.path();
    if path != "/" && !path.is_empty() {
        return Err("Server URL must not contain a path".to_string());
    }

    let scheme = parsed.scheme();
    if scheme == "https" {
        return Ok(parsed.origin().ascii_serialization());
    }

    if scheme == "http" {
        #[cfg(debug_assertions)]
        {
            if let Some(host) = parsed.host_str() {
                if host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]" {
                    return Ok(parsed.origin().ascii_serialization());
                }
            }
            return Err(
                "HTTP is only allowed for localhost, 127.0.0.1, or ::1 in debug mode".to_string(),
            );
        }
        #[cfg(not(debug_assertions))]
        {
            return Err("Only HTTPS is allowed in release mode".to_string());
        }
    }

    Err("Only HTTP/HTTPS protocols are supported".to_string())
}

pub fn validate_verification_url(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Verification URL cannot be empty".to_string());
    }

    let parsed = Url::parse(trimmed).map_err(|e| format!("Invalid URL: {}", e))?;

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Verification URL must not contain credentials".to_string());
    }

    let scheme = parsed.scheme();
    if scheme == "https" {
        return Ok(parsed.to_string());
    }

    if scheme == "http" {
        #[cfg(debug_assertions)]
        {
            if let Some(host) = parsed.host_str() {
                if host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]" {
                    return Ok(parsed.to_string());
                }
            }
            return Err(
                "HTTP is only allowed for localhost, 127.0.0.1, or ::1 in debug mode".to_string(),
            );
        }
        #[cfg(not(debug_assertions))]
        {
            return Err("Only HTTPS is allowed in release mode".to_string());
        }
    }

    Err("Only HTTP/HTTPS protocols are supported".to_string())
}

pub fn endpoint_url(server_url: &str, path: &str) -> Result<Url, String> {
    let canonical = validate_server_url(server_url)?;
    let base =
        Url::parse(&format!("{}/", canonical)).map_err(|e| format!("Invalid base URL: {}", e))?;
    let path_clean = path.trim_start_matches('/');
    base.join(path_clean)
        .map_err(|e| format!("Failed to build endpoint URL: {}", e))
}

pub fn handle_rest_auth_status(status: StatusCode, server_url: &str) -> Result<(), String> {
    if status == StatusCode::UNAUTHORIZED {
        let canonical = validate_server_url(server_url).unwrap_or_else(|_| server_url.to_string());
        let _ = keychain::delete_token(&canonical);
        return Err(format!("UNAUTHENTICATED:{}", canonical));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSummary {
    pub id: i64,
    pub username: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelSummary {
    pub id: i64,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNotificationItem {
    pub id: i64,
    pub issue_id: Option<i64>,
    #[serde(rename = "type")]
    pub notification_type: String,
    pub message: String,
    pub read_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopIssueItem {
    pub id: i64,
    pub title: String,
    pub state: String,
    pub body_excerpt: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
    pub relation_reasons: Vec<String>,
    pub assignees: Vec<UserSummary>,
    pub labels: Vec<LabelSummary>,
    pub additional_label_count: i64,
    pub unread_count: i64,
    pub subscribed: bool,
    pub muted: bool,
    pub latest_notification: Option<DesktopNotificationItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopOverviewSections {
    pub assigned_open: Vec<DesktopIssueItem>,
    pub followed_open: Vec<DesktopIssueItem>,
    pub recently_closed: Vec<DesktopIssueItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopOverviewTotals {
    pub assigned_open: i64,
    pub followed_open: i64,
    pub recently_closed: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopOverviewData {
    pub generated_at: String,
    pub unread_count: i64,
    pub sections: DesktopOverviewSections,
    pub totals: DesktopOverviewTotals,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPreferenceData {
    pub system_notifications_enabled: bool,
    pub assignment_notifications_enabled: bool,
    pub mention_notifications_enabled: bool,
    pub status_notifications_enabled: bool,
    pub assignee_notifications_enabled: bool,
    pub comment_notifications_enabled: bool,
    pub do_not_disturb_enabled: bool,
    pub do_not_disturb_start: Option<String>,
    pub do_not_disturb_end: Option<String>,
    pub time_zone: String,
    pub recently_closed_days: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDesktopPreferencePayload {
    pub system_notifications_enabled: Option<bool>,
    pub assignment_notifications_enabled: Option<bool>,
    pub mention_notifications_enabled: Option<bool>,
    pub status_notifications_enabled: Option<bool>,
    pub assignee_notifications_enabled: Option<bool>,
    pub comment_notifications_enabled: Option<bool>,
    pub do_not_disturb_enabled: Option<bool>,
    pub do_not_disturb_start: Option<String>,
    pub do_not_disturb_end: Option<String>,
    pub time_zone: Option<String>,
    pub recently_closed_days: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueNotificationMuteListResponse {
    pub issue_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendPairingCreateResponse {
    pub pairing_id: String,
    pub device_secret: String,
    pub user_code: String,
    pub verification_url: String,
    pub expires_at: String,
    pub poll_interval_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicPairingCreateResponse {
    pub pairing_id: String,
    pub user_code: String,
    pub expires_at: String,
    pub poll_interval_seconds: u64,
}

#[derive(Debug, Clone)]
pub struct PairingSession {
    pub pairing_id: String,
    pub device_secret: String,
    pub server_url: String,
    pub verification_url: String,
    pub expires_at: String,
}

pub struct PairingStateManager {
    current: Mutex<Option<PairingSession>>,
}

impl PairingStateManager {
    pub fn new() -> Self {
        Self {
            current: Mutex::new(None),
        }
    }

    pub fn set(&self, session: PairingSession) {
        *self.current.lock().unwrap() = Some(session);
    }

    pub fn get(&self) -> Option<PairingSession> {
        self.current.lock().unwrap().clone()
    }

    pub fn clear_if_current(&self, pairing_id: &str) -> bool {
        let mut guard = self.current.lock().unwrap();
        if let Some(session) = &*guard {
            if session.pairing_id == pairing_id {
                *guard = None;
                return true;
            }
        }
        false
    }

    pub fn finalize_if_current<F, R>(&self, pairing_id: &str, f: F) -> Result<R, String>
    where
        F: FnOnce() -> Result<R, String>,
    {
        let mut guard = self.current.lock().unwrap();
        match &*guard {
            Some(session) if session.pairing_id == pairing_id => {
                let res = f()?;
                *guard = None;
                Ok(res)
            }
            _ => Err(
                "PAIRING_STALE_SESSION: Pairing session has been superseded or cancelled"
                    .to_string(),
            ),
        }
    }

    pub fn clear_all(&self) {
        *self.current.lock().unwrap() = None;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopApiTokenInfo {
    pub id: i64,
    pub name: String,
    pub prefix: String,
    pub kind: String,
    pub device_name: Option<String>,
    pub expires_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "status", rename_all = "UPPERCASE")]
pub(crate) enum PairingExchangeResponseRaw {
    Pending {
        #[serde(rename = "expiresAt")]
        expires_at: String,
        #[serde(rename = "retryAfterSeconds")]
        retry_after_seconds: u64,
    },
    Authorized {
        token: String,
        #[serde(rename = "apiToken")]
        api_token: DesktopApiTokenInfo,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "UPPERCASE")]
pub enum PairingExchangeResult {
    Pending {
        #[serde(rename = "expiresAt")]
        expires_at: String,
        #[serde(rename = "retryAfterSeconds")]
        retry_after_seconds: u64,
    },
    Authorized {
        #[serde(rename = "apiToken")]
        api_token: DesktopApiTokenInfo,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueStateUpdateResult {
    pub id: i64,
    pub state: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicUserInfo {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub email: Option<String>,
    pub role: String,
    pub roles: Option<Vec<String>>,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthMeResponse {
    pub user: PublicUserInfo,
}

pub struct ApiHttpClient {
    client: Client,
}

impl ApiHttpClient {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { client }
    }

    fn auth_headers(&self, server_url: &str) -> Result<HeaderMap, String> {
        let canonical = validate_server_url(server_url).unwrap_or_else(|_| server_url.to_string());
        let token = keychain::get_token(&canonical)?
            .ok_or_else(|| format!("UNAUTHENTICATED:{}", canonical))?;
        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", token))
                .map_err(|e| format!("Invalid authorization header: {}", e))?,
        );
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        Ok(headers)
    }

    pub async fn create_pairing(
        &self,
        server_url: &str,
        device_name: &str,
    ) -> Result<BackendPairingCreateResponse, String> {
        let url = endpoint_url(server_url, "api/desktop/pairings")?;
        let payload = serde_json::json!({ "deviceName": device_name });

        let resp = self
            .client
            .post(url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?;

        let status = resp.status();
        if !status.is_success() {
            let err_text = resp.text().await.unwrap_or_default();
            return Err(format!("Server returned error {}: {}", status, err_text));
        }

        resp.json::<BackendPairingCreateResponse>()
            .await
            .map_err(|e| format!("Failed to parse pairing response: {}", e))
    }

    pub(crate) async fn exchange_pairing_raw(
        &self,
        server_url: &str,
        pairing_id: &str,
        device_secret: &str,
    ) -> Result<PairingExchangeResponseRaw, String> {
        let path = format!("api/desktop/pairings/{}/exchange", pairing_id);
        let url = endpoint_url(server_url, &path)?;
        let payload = serde_json::json!({ "deviceSecret": device_secret });

        let resp = self
            .client
            .post(url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?;

        let status = resp.status();
        if status == StatusCode::ACCEPTED || status.is_success() {
            resp.json::<PairingExchangeResponseRaw>()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))
        } else {
            let err_text = resp.text().await.unwrap_or_default();
            Err(format!("Exchange failed ({status}): {err_text}"))
        }
    }

    pub async fn revoke_token_with_raw_secret(
        &self,
        server_url: &str,
        token_id: i64,
        raw_token: &str,
    ) -> Result<(), String> {
        let path = format!("api/auth/api-tokens/{}", token_id);
        let url = endpoint_url(server_url, &path)?;
        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", raw_token))
                .map_err(|e| format!("Invalid authorization header: {}", e))?,
        );
        let resp = self
            .client
            .delete(url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| format!("Network error during token revocation: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Token revocation returned status {}",
                resp.status()
            ));
        }
        Ok(())
    }

    pub async fn get_current_user(&self, server_url: &str) -> Result<PublicUserInfo, String> {
        let headers = self.auth_headers(server_url)?;
        let url = endpoint_url(server_url, "api/auth/me")?;

        let resp = self
            .client
            .get(url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?;

        let status = resp.status();
        handle_rest_auth_status(status, server_url)?;

        if !status.is_success() {
            return Err(format!("Server returned {}", status));
        }

        let data = resp
            .json::<AuthMeResponse>()
            .await
            .map_err(|e| format!("Failed to parse user info: {}", e))?;

        Ok(data.user)
    }

    pub async fn get_overview(
        &self,
        server_url: &str,
        closed_days: Option<i64>,
    ) -> Result<DesktopOverviewData, String> {
        let headers = self.auth_headers(server_url)?;
        let mut url = endpoint_url(server_url, "api/desktop/overview")?;
        if let Some(days) = closed_days {
            url.query_pairs_mut()
                .append_pair("closedDays", &days.to_string());
        }

        let resp = self
            .client
            .get(url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?;

        let status = resp.status();
        handle_rest_auth_status(status, server_url)?;

        if !status.is_success() {
            let err_text = resp.text().await.unwrap_or_default();
            return Err(format!("Server returned {}: {}", status, err_text));
        }

        resp.json::<DesktopOverviewData>()
            .await
            .map_err(|e| format!("Failed to parse overview response: {}", e))
    }

    pub async fn get_notification_mutes(&self, server_url: &str) -> Result<Vec<i64>, String> {
        let headers = self.auth_headers(server_url)?;
        let url = endpoint_url(server_url, "api/desktop/notification-mutes")?;

        let resp = self
            .client
            .get(url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?;

        let status = resp.status();
        handle_rest_auth_status(status, server_url)?;

        if !status.is_success() {
            let err_text = resp.text().await.unwrap_or_default();
            return Err(format!("Server returned {}: {}", status, err_text));
        }

        let data = resp
            .json::<IssueNotificationMuteListResponse>()
            .await
            .map_err(|e| format!("Failed to parse notification mutes: {}", e))?;

        Ok(data.issue_ids)
    }

    pub async fn update_issue_state(
        &self,
        server_url: &str,
        issue_id: i64,
        state: &str,
        updated_at: &str,
    ) -> Result<IssueStateUpdateResult, String> {
        let headers = self.auth_headers(server_url)?;
        let path = format!("api/issues/{}", issue_id);
        let url = endpoint_url(server_url, &path)?;
        let payload = serde_json::json!({
            "state": state,
            "updatedAt": updated_at,
        });

        let resp = self
            .client
            .patch(url)
            .headers(headers)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?;

        let status = resp.status();
        handle_rest_auth_status(status, server_url)?;

        if status == StatusCode::CONFLICT {
            return Err("STALE_UPDATE".to_string());
        }

        if !status.is_success() {
            let err_text = resp.text().await.unwrap_or_default();
            return Err(format!("Failed to update issue: {}", err_text));
        }

        resp.json::<IssueStateUpdateResult>()
            .await
            .map_err(|e| format!("Failed to parse issue update response: {}", e))
    }

    pub async fn set_issue_subscription(
        &self,
        server_url: &str,
        issue_id: i64,
        subscribed: bool,
    ) -> Result<(), String> {
        let headers = self.auth_headers(server_url)?;
        let path = format!("api/issues/{}/subscription", issue_id);
        let url = endpoint_url(server_url, &path)?;
        let payload = serde_json::json!({ "subscribed": subscribed });

        let resp = self
            .client
            .put(url)
            .headers(headers)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?;

        let status = resp.status();
        handle_rest_auth_status(status, server_url)?;

        if !status.is_success() {
            return Err(format!("Server returned {}", status));
        }

        Ok(())
    }

    pub async fn set_issue_mute(
        &self,
        server_url: &str,
        issue_id: i64,
        muted: bool,
    ) -> Result<(), String> {
        let headers = self.auth_headers(server_url)?;
        let path = format!("api/issues/{}/notification-mute", issue_id);
        let url = endpoint_url(server_url, &path)?;

        let resp = if muted {
            self.client.put(url).headers(headers).send().await
        } else {
            self.client.delete(url).headers(headers).send().await
        }
        .map_err(|e| format!("Network error: {}", e))?;

        let status = resp.status();
        handle_rest_auth_status(status, server_url)?;

        if !status.is_success() {
            return Err(format!("Server returned {}", status));
        }

        Ok(())
    }

    pub async fn mark_issue_notifications_read(
        &self,
        server_url: &str,
        issue_id: i64,
    ) -> Result<(), String> {
        let headers = self.auth_headers(server_url)?;
        let path = format!("api/issues/{}/notifications/read", issue_id);
        let url = endpoint_url(server_url, &path)?;

        let resp = self
            .client
            .patch(url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?;

        let status = resp.status();
        handle_rest_auth_status(status, server_url)?;

        if !status.is_success() {
            return Err(format!("Server returned {}", status));
        }

        Ok(())
    }

    pub async fn get_desktop_preferences(
        &self,
        server_url: &str,
    ) -> Result<DesktopPreferenceData, String> {
        let headers = self.auth_headers(server_url)?;
        let url = endpoint_url(server_url, "api/desktop/preferences")?;

        let resp = self
            .client
            .get(url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?;

        let status = resp.status();
        handle_rest_auth_status(status, server_url)?;

        if !status.is_success() {
            return Err(format!("Server returned {}", status));
        }

        resp.json::<DesktopPreferenceData>()
            .await
            .map_err(|e| format!("Failed to parse preferences: {}", e))
    }

    pub async fn update_desktop_preferences(
        &self,
        server_url: &str,
        payload: UpdateDesktopPreferencePayload,
    ) -> Result<DesktopPreferenceData, String> {
        let headers = self.auth_headers(server_url)?;
        let url = endpoint_url(server_url, "api/desktop/preferences")?;

        let resp = self
            .client
            .patch(url)
            .headers(headers)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?;

        let status = resp.status();
        handle_rest_auth_status(status, server_url)?;

        if !status.is_success() {
            let err_text = resp.text().await.unwrap_or_default();
            return Err(format!("Server returned {}: {}", status, err_text));
        }

        resp.json::<DesktopPreferenceData>()
            .await
            .map_err(|e| format!("Failed to parse preferences: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_server_url_valid() {
        assert_eq!(
            validate_server_url("https://issueflow.example.com").unwrap(),
            "https://issueflow.example.com"
        );
        assert_eq!(
            validate_server_url("https://issueflow.example.com/").unwrap(),
            "https://issueflow.example.com"
        );
        assert_eq!(
            validate_server_url("https://issueflow.example.com:8443").unwrap(),
            "https://issueflow.example.com:8443"
        );
        assert_eq!(
            validate_server_url("https://IssueFlow.Example.COM:443/").unwrap(),
            "https://issueflow.example.com"
        );
        assert_eq!(
            validate_server_url("https://example.com/foo/..").unwrap(),
            "https://example.com"
        );
        #[cfg(debug_assertions)]
        {
            assert_eq!(
                validate_server_url("http://localhost:3101").unwrap(),
                "http://localhost:3101"
            );
            assert_eq!(
                validate_server_url("http://localhost:80/").unwrap(),
                "http://localhost"
            );
            assert_eq!(
                validate_server_url("http://127.0.0.1:3101/").unwrap(),
                "http://127.0.0.1:3101"
            );
            assert_eq!(
                validate_server_url("http://127.0.0.1:80/./").unwrap(),
                "http://127.0.0.1"
            );
            assert_eq!(
                validate_server_url("http://[::1]:3101").unwrap(),
                "http://[::1]:3101"
            );
            // Remote HTTP must be rejected even in debug mode
            assert!(validate_server_url("http://remote.example.com").is_err());
            assert!(validate_server_url("http://192.168.1.10:3101").is_err());
        }
    }

    #[test]
    fn test_validate_server_url_reject_credentials_query_fragment_path() {
        assert!(validate_server_url("https://user:pass@example.com").is_err());
        assert!(validate_server_url("https://user@example.com").is_err());
        assert!(validate_server_url("https://example.com?query=1").is_err());
        assert!(validate_server_url("https://example.com#hash").is_err());
        assert!(validate_server_url("https://example.com/subpath").is_err());
        assert!(validate_server_url("ftp://example.com").is_err());
        assert!(validate_server_url("ws://example.com").is_err());
        assert!(validate_server_url("wss://example.com").is_err());
        assert!(validate_server_url("javascript:alert(1)").is_err());
        assert!(validate_server_url("").is_err());
        assert!(validate_server_url("   ").is_err());
    }

    #[test]
    fn test_validate_verification_url() {
        assert!(
            validate_verification_url("https://example.com/desktop/authorize?code=123").is_ok()
        );
        assert_eq!(
            validate_verification_url("https://EXAMPLE.com:443/desktop/authorize?code=123")
                .unwrap(),
            "https://example.com/desktop/authorize?code=123"
        );
        assert!(
            validate_verification_url("https://user:pass@example.com/desktop/authorize").is_err()
        );
        assert!(validate_verification_url("javascript:alert(1)").is_err());
        assert!(validate_verification_url("ftp://example.com").is_err());
    }

    #[test]
    fn test_endpoint_url() {
        let u1 =
            endpoint_url("https://IssueFlow.Example.COM:443/", "api/desktop/overview").unwrap();
        assert_eq!(
            u1.as_str(),
            "https://issueflow.example.com/api/desktop/overview"
        );

        let u2 = endpoint_url("https://example.com:8443", "/api/issues/42").unwrap();
        assert_eq!(u2.as_str(), "https://example.com:8443/api/issues/42");
    }

    #[test]
    fn test_handle_rest_auth_status_401_vs_403() {
        let server_url = "https://issueflow.example.com";
        // 401 UNAUTHORIZED -> Returns UNAUTHENTICATED error with origin and deletes token
        let res_401 = handle_rest_auth_status(StatusCode::UNAUTHORIZED, server_url);
        assert!(res_401.is_err());
        assert_eq!(
            res_401.unwrap_err(),
            "UNAUTHENTICATED:https://issueflow.example.com"
        );

        // 403 FORBIDDEN is a business permission error, must NOT trigger UNAUTHENTICATED or delete token
        let res_403 = handle_rest_auth_status(StatusCode::FORBIDDEN, server_url);
        assert!(res_403.is_ok());

        // 200 OK -> Ok(())
        let res_200 = handle_rest_auth_status(StatusCode::OK, server_url);
        assert!(res_200.is_ok());
    }
}
