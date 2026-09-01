use crate::http::ApiHttpClient;
use crate::keychain;
use crate::notifications::NotificationManager;
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::time::sleep;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

const BACKOFF_STEPS: [u64; 5] = [1, 2, 5, 10, 30];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RealtimeIncomingEvent {
    #[serde(rename = "hello")]
    Hello {
        #[serde(rename = "protocolVersion")]
        protocol_version: i64,
        #[serde(rename = "serverTime")]
        server_time: String,
    },
    #[serde(rename = "issue.changed")]
    IssueChanged {
        #[serde(rename = "issueId")]
        issue_id: i64,
        #[serde(rename = "updatedAt")]
        updated_at: String,
        #[serde(rename = "actorId")]
        actor_id: i64,
    },
    #[serde(rename = "notification.created")]
    NotificationCreated { notification: serde_json::Value },
    #[serde(rename = "notification.read")]
    NotificationRead {
        #[serde(rename = "issueId")]
        issue_id: Option<i64>,
        #[serde(rename = "notificationIds")]
        notification_ids: Vec<i64>,
        #[serde(rename = "readAt")]
        read_at: String,
    },
    #[serde(rename = "subscription.changed")]
    SubscriptionChanged {
        #[serde(rename = "issueId")]
        issue_id: i64,
        subscribed: bool,
    },
    #[serde(rename = "notification-mute.changed")]
    NotificationMuteChanged {
        #[serde(rename = "issueId")]
        issue_id: i64,
        muted: bool,
    },
    #[serde(rename = "preferences.changed")]
    PreferencesChanged {
        #[serde(rename = "updatedAt")]
        updated_at: String,
    },
    #[serde(rename = "ping")]
    Ping {
        #[serde(rename = "sentAt")]
        sent_at: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeStatusEnvelope {
    pub origin: String,
    pub user_id: Option<i64>,
    pub generation: u64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeEventEnvelope {
    pub origin: String,
    pub user_id: i64,
    pub generation: u64,
    pub event: serde_json::Value,
}

pub struct RealtimeManager {
    app: AppHandle,
    notification_manager: Arc<NotificationManager>,
    http_client: Arc<ApiHttpClient>,
    task_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
    generation: Arc<AtomicU64>,
    current_status: Arc<std::sync::Mutex<RealtimeStatusEnvelope>>,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum HandshakeErrorClassification {
    Unauthenticated,
    NetworkError,
}

pub fn classify_handshake_status(status_code: u16) -> HandshakeErrorClassification {
    if status_code == 401 {
        HandshakeErrorClassification::Unauthenticated
    } else {
        HandshakeErrorClassification::NetworkError
    }
}

pub fn is_unauth_error<T>(res: &Result<T, String>) -> bool {
    res.as_ref()
        .err()
        .map(|e| e == "UNAUTHENTICATED" || e.starts_with("UNAUTHENTICATED"))
        .unwrap_or(false)
}

impl RealtimeManager {
    pub fn new(
        app: AppHandle,
        notification_manager: Arc<NotificationManager>,
        http_client: Arc<ApiHttpClient>,
    ) -> Self {
        Self {
            app,
            notification_manager,
            http_client,
            task_handle: Mutex::new(None),
            generation: Arc::new(AtomicU64::new(0)),
            current_status: Arc::new(std::sync::Mutex::new(RealtimeStatusEnvelope {
                origin: "".to_string(),
                user_id: None,
                generation: 0,
                status: "disconnected".to_string(),
            })),
        }
    }

    pub fn emit_and_update_status(&self, envelope: RealtimeStatusEnvelope) {
        {
            let mut guard = self.current_status.lock().unwrap();
            *guard = envelope.clone();
        }
        let _ = self.app.emit("realtime:status", envelope);
    }

    pub fn get_status(&self) -> RealtimeStatusEnvelope {
        self.current_status.lock().unwrap().clone()
    }

    pub async fn start(&self, server_url: &str) {
        let mut handle_guard = self.task_handle.lock().await;
        if let Some(existing) = handle_guard.take() {
            existing.abort();
        }

        let current_gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let gen_tracker = self.generation.clone();

        self.notification_manager.set_not_ready();

        let app_handle = self.app.clone();
        let notif_mgr = self.notification_manager.clone();
        let client_ref = self.http_client.clone();
        let target_url = match crate::http::validate_server_url(server_url) {
            Ok(u) => u,
            Err(e) => {
                eprintln!("Invalid server URL for realtime: {}", e);
                self.emit_and_update_status(RealtimeStatusEnvelope {
                    origin: server_url.to_string(),
                    user_id: None,
                    generation: current_gen,
                    status: "unauthenticated".to_string(),
                });
                return;
            }
        };

        let status_tracker = self.current_status.clone();

        let handle = tokio::spawn(async move {
            let update_status = {
                let app_handle = app_handle.clone();
                let status_tracker = status_tracker.clone();
                move |env: RealtimeStatusEnvelope| {
                    {
                        let mut guard = status_tracker.lock().unwrap();
                        *guard = env.clone();
                    }
                    let _ = app_handle.emit("realtime:status", env);
                }
            };

            let mut backoff_idx = 0;

            loop {
                // If generation has moved on, terminate immediately
                if gen_tracker.load(Ordering::SeqCst) != current_gen {
                    break;
                }

                let token = match keychain::get_token(&target_url) {
                    Ok(Some(t)) => t,
                    Ok(None) => {
                        if gen_tracker.load(Ordering::SeqCst) == current_gen {
                            update_status(RealtimeStatusEnvelope {
                                origin: target_url.clone(),
                                user_id: None,
                                generation: current_gen,
                                status: "unauthenticated".to_string(),
                            });
                        }
                        break;
                    }
                    Err(e) => {
                        eprintln!("Keychain error reading token for {}: {}", target_url, e);
                        if gen_tracker.load(Ordering::SeqCst) == current_gen {
                            update_status(RealtimeStatusEnvelope {
                                origin: target_url.clone(),
                                user_id: None,
                                generation: current_gen,
                                status: "disconnected".to_string(),
                            });
                        }
                        let base_secs = BACKOFF_STEPS[backoff_idx.min(BACKOFF_STEPS.len() - 1)];
                        let jitter_ms = rand::thread_rng().gen_range(100..800);
                        if backoff_idx < BACKOFF_STEPS.len() - 1 {
                            backoff_idx += 1;
                        }
                        sleep(Duration::from_millis(base_secs * 1000 + jitter_ms)).await;
                        continue;
                    }
                };

                let ws_url = match convert_to_ws_url(&target_url) {
                    Ok(u) => u,
                    Err(_) => break,
                };

                if gen_tracker.load(Ordering::SeqCst) == current_gen {
                    update_status(RealtimeStatusEnvelope {
                        origin: target_url.clone(),
                        user_id: None,
                        generation: current_gen,
                        status: "connecting".to_string(),
                    });
                }

                match connect_websocket(&ws_url, &token).await {
                    Ok((mut ws_stream, _)) => {
                        if gen_tracker.load(Ordering::SeqCst) != current_gen {
                            break;
                        }

                        // Readiness requirement: Before reading business messages or emitting 'connected',
                        // must successfully fetch current user, preferences, and mute set
                        let user_res = client_ref.get_current_user(&target_url).await;
                        let prefs_res = client_ref.get_desktop_preferences(&target_url).await;
                        let mutes_res = client_ref.get_notification_mutes(&target_url).await;

                        if gen_tracker.load(Ordering::SeqCst) != current_gen {
                            break;
                        }

                        let is_unauthenticated = is_unauth_error(&user_res)
                            || is_unauth_error(&prefs_res)
                            || is_unauth_error(&mutes_res);

                        if is_unauthenticated {
                            let _ = keychain::delete_token(&target_url);
                            notif_mgr.reset_context();
                            if gen_tracker.load(Ordering::SeqCst) == current_gen {
                                update_status(RealtimeStatusEnvelope {
                                    origin: target_url.clone(),
                                    user_id: None,
                                    generation: current_gen,
                                    status: "unauthenticated".to_string(),
                                });
                            }
                            break;
                        }

                        // If any readiness prerequisite failed transiently, stay not-ready, close stream, and back off
                        let (user, prefs, mutes) = match (user_res, prefs_res, mutes_res) {
                            (Ok(u), Ok(p), Ok(m)) => (u, p, m),
                            _ => {
                                notif_mgr.set_not_ready_for_generation(&target_url, current_gen);
                                if gen_tracker.load(Ordering::SeqCst) == current_gen {
                                    update_status(RealtimeStatusEnvelope {
                                        origin: target_url.clone(),
                                        user_id: None,
                                        generation: current_gen,
                                        status: "disconnected".to_string(),
                                    });
                                }
                                let base_secs =
                                    BACKOFF_STEPS[backoff_idx.min(BACKOFF_STEPS.len() - 1)];
                                let jitter_ms = rand::thread_rng().gen_range(100..800);
                                if backoff_idx < BACKOFF_STEPS.len() - 1 {
                                    backoff_idx += 1;
                                }
                                sleep(Duration::from_millis(base_secs * 1000 + jitter_ms)).await;
                                continue;
                            }
                        };

                        // Atomically activate manager session and ready=true
                        notif_mgr.activate_session(
                            &target_url,
                            user.id,
                            current_gen,
                            &prefs,
                            mutes,
                        );
                        backoff_idx = 0; // Reset backoff on full readiness activation
                        let active_user_id = user.id;

                        if gen_tracker.load(Ordering::SeqCst) == current_gen {
                            update_status(RealtimeStatusEnvelope {
                                origin: target_url.clone(),
                                user_id: Some(active_user_id),
                                generation: current_gen,
                                status: "connected".to_string(),
                            });
                        }

                        while let Some(msg_res) = ws_stream.next().await {
                            if gen_tracker.load(Ordering::SeqCst) != current_gen {
                                break;
                            }

                            match msg_res {
                                Ok(Message::Text(text)) => {
                                    handle_incoming_text(
                                        &app_handle,
                                        &notif_mgr,
                                        &client_ref,
                                        &target_url,
                                        active_user_id,
                                        current_gen,
                                        &text,
                                    );
                                }
                                Ok(Message::Ping(data)) => {
                                    let _ = ws_stream.send(Message::Pong(data)).await;
                                }
                                Ok(Message::Close(_)) => {
                                    break;
                                }
                                Err(_) => {
                                    break;
                                }
                                _ => {}
                            }
                        }

                        notif_mgr.set_not_ready_for_generation(&target_url, current_gen);
                    }
                    Err(HandshakeErrorClassification::Unauthenticated) => {
                        let _ = keychain::delete_token(&target_url);
                        notif_mgr.reset_context();
                        if gen_tracker.load(Ordering::SeqCst) == current_gen {
                            update_status(RealtimeStatusEnvelope {
                                origin: target_url.clone(),
                                user_id: None,
                                generation: current_gen,
                                status: "unauthenticated".to_string(),
                            });
                        }
                        break;
                    }
                    Err(HandshakeErrorClassification::NetworkError) => {
                        notif_mgr.set_not_ready_for_generation(&target_url, current_gen);
                    }
                }

                if gen_tracker.load(Ordering::SeqCst) != current_gen {
                    break;
                }

                update_status(RealtimeStatusEnvelope {
                    origin: target_url.clone(),
                    user_id: None,
                    generation: current_gen,
                    status: "disconnected".to_string(),
                });

                // Calculate backoff with jitter
                let base_secs = BACKOFF_STEPS[backoff_idx.min(BACKOFF_STEPS.len() - 1)];
                let jitter_ms = rand::thread_rng().gen_range(100..800);
                let sleep_duration = Duration::from_millis(base_secs * 1000 + jitter_ms);

                if backoff_idx < BACKOFF_STEPS.len() - 1 {
                    backoff_idx += 1;
                }

                sleep(sleep_duration).await;
            }
        });

        *handle_guard = Some(handle);
    }

    pub async fn stop(&self) {
        let cur_gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.notification_manager.reset_context();
        let mut handle_guard = self.task_handle.lock().await;
        if let Some(existing) = handle_guard.take() {
            existing.abort();
        }
        self.emit_and_update_status(RealtimeStatusEnvelope {
            origin: "".to_string(),
            user_id: None,
            generation: cur_gen,
            status: "disconnected".to_string(),
        });
    }
}

pub fn convert_to_ws_url(http_url: &str) -> Result<String, String> {
    let canonical = crate::http::validate_server_url(http_url)?;
    let base =
        url::Url::parse(&format!("{}/", canonical)).map_err(|e| format!("Invalid URL: {}", e))?;
    let ws_endpoint = base
        .join("api/realtime")
        .map_err(|e| format!("Failed to build ws endpoint: {}", e))?;

    let mut ws_url = ws_endpoint.clone();
    let new_scheme = if base.scheme() == "https" {
        "wss"
    } else {
        "ws"
    };
    ws_url
        .set_scheme(new_scheme)
        .map_err(|_| "Failed to set WebSocket scheme".to_string())?;

    Ok(ws_url.to_string())
}

async fn connect_websocket(
    url_str: &str,
    token: &str,
) -> Result<
    (
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        tokio_tungstenite::tungstenite::handshake::client::Response,
    ),
    HandshakeErrorClassification,
> {
    let mut req = match url_str.into_client_request() {
        Ok(r) => r,
        Err(_) => return Err(HandshakeErrorClassification::NetworkError),
    };
    let auth_val = match HeaderValue::from_str(&format!("Bearer {}", token)) {
        Ok(v) => v,
        Err(_) => return Err(HandshakeErrorClassification::Unauthenticated),
    };
    req.headers_mut().insert("Authorization", auth_val);

    match connect_async(req).await {
        Ok(res) => Ok(res),
        Err(tokio_tungstenite::tungstenite::Error::Http(resp)) => {
            let status = resp.status().as_u16();
            Err(classify_handshake_status(status))
        }
        Err(_) => Err(HandshakeErrorClassification::NetworkError),
    }
}

fn handle_incoming_text(
    app: &AppHandle,
    notif_mgr: &Arc<NotificationManager>,
    http_client: &Arc<ApiHttpClient>,
    target_url: &str,
    active_user_id: i64,
    current_gen: u64,
    text: &str,
) {
    if let Ok(raw_json) = serde_json::from_str::<serde_json::Value>(text) {
        // Emit event envelope to React WebView
        let _ = app.emit(
            "realtime:event",
            RealtimeEventEnvelope {
                origin: target_url.to_string(),
                user_id: active_user_id,
                generation: current_gen,
                event: raw_json.clone(),
            },
        );

        if let Some(event_type) = raw_json.get("type").and_then(|v| v.as_str()) {
            if event_type == "notification.created" {
                if let Some(notif) = raw_json.get("notification") {
                    let notif_id = notif.get("id").and_then(|v| v.as_i64());
                    let n_type = notif
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("NOTIFICATION");
                    let message = notif.get("message").and_then(|v| v.as_str()).unwrap_or("");
                    let issue_id = notif.get("issueId").and_then(|v| v.as_i64());

                    notif_mgr.send_notification(
                        app,
                        target_url,
                        active_user_id,
                        current_gen,
                        notif_id,
                        n_type,
                        message,
                        issue_id,
                        None,
                    );
                }
            } else if event_type == "notification-mute.changed" {
                if let Some(issue_id) = raw_json.get("issueId").and_then(|v| v.as_i64()) {
                    let muted = raw_json
                        .get("muted")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    notif_mgr.set_issue_mute_for_generation(
                        target_url,
                        current_gen,
                        issue_id,
                        muted,
                    );
                }
            } else if event_type == "preferences.changed" {
                let http_clone = http_client.clone();
                let notif_clone = notif_mgr.clone();
                let target = target_url.to_string();
                tokio::spawn(async move {
                    if let Ok(prefs) = http_clone.get_desktop_preferences(&target).await {
                        notif_clone.update_preferences_for_generation(&target, current_gen, &prefs);
                    }
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ws_url_conversion() {
        assert_eq!(
            convert_to_ws_url("http://localhost:3101").unwrap(),
            "ws://localhost:3101/api/realtime"
        );
        assert_eq!(
            convert_to_ws_url("https://api.issueflow.dev/").unwrap(),
            "wss://api.issueflow.dev/api/realtime"
        );
        assert_eq!(
            convert_to_ws_url("https://API.IssueFlow.Dev:443/").unwrap(),
            "wss://api.issueflow.dev/api/realtime"
        );
    }

    #[test]
    fn test_handshake_error_classification() {
        assert_eq!(
            classify_handshake_status(401),
            HandshakeErrorClassification::Unauthenticated
        );
        // 403 Forbidden is a business rejection / disconnected, must NOT delete token (classified as NetworkError)
        assert_eq!(
            classify_handshake_status(403),
            HandshakeErrorClassification::NetworkError
        );
        assert_eq!(
            classify_handshake_status(500),
            HandshakeErrorClassification::NetworkError
        );
        assert_eq!(
            classify_handshake_status(502),
            HandshakeErrorClassification::NetworkError
        );
        assert_eq!(
            classify_handshake_status(404),
            HandshakeErrorClassification::NetworkError
        );
    }
}
