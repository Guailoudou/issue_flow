use crate::config::{AppConfig, ConfigManager};
use crate::http::{
    endpoint_url, validate_server_url, validate_verification_url, ApiHttpClient,
    DesktopOverviewData, DesktopPreferenceData, IssueStateUpdateResult, PairingExchangeResponseRaw,
    PairingExchangeResult, PairingSession, PairingStateManager, PublicPairingCreateResponse,
    PublicUserInfo, UpdateDesktopPreferencePayload,
};
use crate::keychain;
use crate::notifications::NotificationManager;
use crate::realtime::RealtimeManager;
use crate::tray::update_tray_badge;
use crate::window::WindowStateManager;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatusResponse {
    pub authenticated: bool,
    pub user: Option<PublicUserInfo>,
}

pub fn format_rollback_error(primary_err: &str, compensation_errs: &[String]) -> String {
    if compensation_errs.is_empty() {
        primary_err.to_string()
    } else {
        format!(
            "{}; Additionally, compensation failed: {}",
            primary_err,
            compensation_errs.join("; ")
        )
    }
}

pub fn execute_pairing_exchange_transaction<F, KSave, KDel>(
    server_url: &str,
    orig_token: Option<String>,
    new_token: &str,
    save_token_fn: KSave,
    delete_token_fn: KDel,
    update_config_fn: F,
) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
    KSave: Fn(&str, &str) -> Result<(), String>,
    KDel: Fn(&str) -> Result<(), String>,
{
    // 1. Save new token
    if let Err(save_err) = save_token_fn(server_url, new_token) {
        let mut rollback_errors = Vec::new();
        match orig_token {
            Some(orig) => {
                if let Err(e) = save_token_fn(server_url, &orig) {
                    rollback_errors.push(format!("Failed to restore original token: {}", e));
                }
            }
            None => {
                if let Err(e) = delete_token_fn(server_url) {
                    rollback_errors.push(format!(
                        "Failed to clean up token after save failure: {}",
                        e
                    ));
                }
            }
        }
        let err_msg = format_rollback_error(
            &format!(
                "PAIRING_TOKEN_SAVE_FAILED: Failed to save authentication token: {}",
                save_err
            ),
            &rollback_errors,
        );
        return Err(err_msg);
    }

    // 2. Attempt config update
    if let Err(cfg_err) = update_config_fn() {
        // Rollback token
        let mut rollback_errors = Vec::new();
        match orig_token {
            Some(orig) => {
                if let Err(e) = save_token_fn(server_url, &orig) {
                    rollback_errors.push(format!("Failed to restore original token: {}", e));
                }
            }
            None => {
                if let Err(e) = delete_token_fn(server_url) {
                    rollback_errors
                        .push(format!("Failed to delete new token during rollback: {}", e));
                }
            }
        }
        let err_msg = format_rollback_error(
            &format!(
                "PAIRING_CONFIG_SAVE_FAILED: Failed to update app configuration: {}",
                cfg_err
            ),
            &rollback_errors,
        );
        return Err(err_msg);
    }

    Ok(())
}

#[tauri::command]
pub async fn check_auth_status(
    config_mgr: State<'_, Arc<ConfigManager>>,
    http_client: State<'_, Arc<ApiHttpClient>>,
    realtime_mgr: State<'_, Arc<RealtimeManager>>,
    notif_mgr: State<'_, Arc<NotificationManager>>,
) -> Result<AuthStatusResponse, String> {
    let raw_url = config_mgr.get().server_url;
    let server_url = validate_server_url(&raw_url)?;

    let _token = match keychain::get_token(&server_url)? {
        Some(t) => t,
        None => {
            notif_mgr.reset_context();
            return Ok(AuthStatusResponse {
                authenticated: false,
                user: None,
            });
        }
    };

    match http_client.get_current_user(&server_url).await {
        Ok(user) => {
            realtime_mgr.start(&server_url).await;
            Ok(AuthStatusResponse {
                authenticated: true,
                user: Some(user),
            })
        }
        Err(e) => {
            if e == "UNAUTHENTICATED" || e.starts_with("UNAUTHENTICATED") {
                let _ = keychain::delete_token(&server_url);
                notif_mgr.reset_context();
                Ok(AuthStatusResponse {
                    authenticated: false,
                    user: None,
                })
            } else {
                // If offline or transient network error, but token exists, still start realtime reconnect loop
                realtime_mgr.start(&server_url).await;
                Ok(AuthStatusResponse {
                    authenticated: true,
                    user: None,
                })
            }
        }
    }
}

#[tauri::command]
pub async fn start_pairing(
    server_url: Option<String>,
    device_name: Option<String>,
    config_mgr: State<'_, Arc<ConfigManager>>,
    http_client: State<'_, Arc<ApiHttpClient>>,
    pairing_state_mgr: State<'_, Arc<PairingStateManager>>,
) -> Result<PublicPairingCreateResponse, String> {
    let raw_url = server_url.unwrap_or_else(|| config_mgr.get().server_url);
    let validated_url = validate_server_url(&raw_url)?;
    let dev_name = device_name.unwrap_or_else(|| "Mac 浮窗".to_string());

    let resp = http_client
        .create_pairing(&validated_url, &dev_name)
        .await?;
    let validated_verification_url = validate_verification_url(&resp.verification_url)?;

    pairing_state_mgr.set(PairingSession {
        pairing_id: resp.pairing_id.clone(),
        device_secret: resp.device_secret,
        server_url: validated_url,
        verification_url: validated_verification_url.clone(),
        expires_at: resp.expires_at.clone(),
    });

    // Open browser with validated verification URL
    let _ = open::that(&validated_verification_url);

    // Return public pairing info to React without deviceSecret or verificationUrl
    Ok(PublicPairingCreateResponse {
        pairing_id: resp.pairing_id,
        user_code: resp.user_code,
        expires_at: resp.expires_at,
        poll_interval_seconds: resp.poll_interval_seconds,
    })
}

#[tauri::command]
pub async fn poll_pairing_status(
    config_mgr: State<'_, Arc<ConfigManager>>,
    http_client: State<'_, Arc<ApiHttpClient>>,
    realtime_mgr: State<'_, Arc<RealtimeManager>>,
    pairing_state_mgr: State<'_, Arc<PairingStateManager>>,
) -> Result<PairingExchangeResult, String> {
    let session = pairing_state_mgr
        .get()
        .ok_or_else(|| "NO_ACTIVE_PAIRING".to_string())?;

    // Keychain preflight: reading orig_token MUST NOT use .ok().flatten; Keychain errors abort before exchange
    let orig_token = keychain::get_token(&session.server_url)?;

    let raw_resp = http_client
        .exchange_pairing_raw(
            &session.server_url,
            &session.pairing_id,
            &session.device_secret,
        )
        .await?;

    match raw_resp {
        PairingExchangeResponseRaw::Pending {
            expires_at,
            retry_after_seconds,
        } => Ok(PairingExchangeResult::Pending {
            expires_at,
            retry_after_seconds,
        }),
        PairingExchangeResponseRaw::Authorized { token, api_token } => {
            let server_url = session.server_url.clone();
            let server_url_for_cfg = server_url.clone();
            let config_mgr_clone = config_mgr.inner().clone();
            let pairing_id = session.pairing_id.clone();
            let token_id = api_token.id;

            // Atomically check if pairing session is still current, commit transaction and clear
            let commit_res = pairing_state_mgr.finalize_if_current(&pairing_id, || {
                execute_pairing_exchange_transaction(
                    &server_url,
                    orig_token,
                    &token,
                    keychain::save_token,
                    keychain::delete_token,
                    move || {
                        config_mgr_clone
                            .update(|c| c.server_url = server_url_for_cfg)
                            .map(|_| ())
                    },
                )
            });

            match commit_res {
                Ok(()) => {
                    realtime_mgr.start(&session.server_url).await;
                    Ok(PairingExchangeResult::Authorized { api_token })
                }
                Err(err) => {
                    if err.starts_with("PAIRING_STALE_SESSION") {
                        let revoke_res = http_client
                            .revoke_token_with_raw_secret(&server_url, token_id, &token)
                            .await;
                        if let Err(re) = revoke_res {
                            Err(format!(
                                "PAIRING_STALE_SESSION_REVOKE_FAILED: Stale token self-revocation failed: {}",
                                re
                            ))
                        } else {
                            Err(err)
                        }
                    } else {
                        pairing_state_mgr.clear_if_current(&pairing_id);
                        let revoke_res = http_client
                            .revoke_token_with_raw_secret(&server_url, token_id, &token)
                            .await;
                        if let Err(re) = revoke_res {
                            Err(format!(
                                "PAIRING_COMMIT_FAILED_REVOKE_FAILED: {}; Additionally, token self-revocation failed: {}. Please revoke this device token manually in web UI or settings.",
                                err, re
                            ))
                        } else {
                            Err(err)
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub fn cancel_pairing(
    pairing_id: Option<String>,
    pairing_state_mgr: State<'_, Arc<PairingStateManager>>,
) -> Result<(), String> {
    if let Some(pid) = pairing_id {
        pairing_state_mgr.clear_if_current(&pid);
    } else {
        pairing_state_mgr.clear_all();
    }
    Ok(())
}

#[tauri::command]
pub fn reopen_pairing_authorization(
    pairing_state_mgr: State<'_, Arc<PairingStateManager>>,
) -> Result<(), String> {
    let session = pairing_state_mgr
        .get()
        .ok_or_else(|| "NO_ACTIVE_PAIRING".to_string())?;
    let validated_url = validate_verification_url(&session.verification_url)?;
    open::that(&validated_url).map_err(|e| format!("Failed to open browser: {}", e))
}

#[tauri::command]
pub async fn logout(
    app: AppHandle,
    config_mgr: State<'_, Arc<ConfigManager>>,
    realtime_mgr: State<'_, Arc<RealtimeManager>>,
    notif_mgr: State<'_, Arc<NotificationManager>>,
    pairing_state_mgr: State<'_, Arc<PairingStateManager>>,
) -> Result<(), String> {
    let raw_url = config_mgr.get().server_url;
    let server_url = validate_server_url(&raw_url)?;
    keychain::delete_token(&server_url)?;
    realtime_mgr.stop().await;
    notif_mgr.reset_context();
    pairing_state_mgr.clear_all();
    update_tray_badge(&app, 0);
    Ok(())
}

#[tauri::command]
pub async fn get_overview(
    closed_days: Option<i64>,
    app: AppHandle,
    config_mgr: State<'_, Arc<ConfigManager>>,
    http_client: State<'_, Arc<ApiHttpClient>>,
) -> Result<DesktopOverviewData, String> {
    let raw_url = config_mgr.get().server_url;
    let server_url = validate_server_url(&raw_url)?;
    let data = http_client.get_overview(&server_url, closed_days).await?;
    update_tray_badge(&app, data.unread_count);
    Ok(data)
}

#[tauri::command]
pub async fn update_issue_state(
    issue_id: i64,
    state: String,
    updated_at: String,
    config_mgr: State<'_, Arc<ConfigManager>>,
    http_client: State<'_, Arc<ApiHttpClient>>,
) -> Result<IssueStateUpdateResult, String> {
    let raw_url = config_mgr.get().server_url;
    let server_url = validate_server_url(&raw_url)?;
    http_client
        .update_issue_state(&server_url, issue_id, &state, &updated_at)
        .await
}

#[tauri::command]
pub async fn set_issue_subscription(
    issue_id: i64,
    subscribed: bool,
    config_mgr: State<'_, Arc<ConfigManager>>,
    http_client: State<'_, Arc<ApiHttpClient>>,
) -> Result<(), String> {
    let raw_url = config_mgr.get().server_url;
    let server_url = validate_server_url(&raw_url)?;
    http_client
        .set_issue_subscription(&server_url, issue_id, subscribed)
        .await
}

#[tauri::command]
pub async fn set_issue_mute(
    issue_id: i64,
    muted: bool,
    config_mgr: State<'_, Arc<ConfigManager>>,
    http_client: State<'_, Arc<ApiHttpClient>>,
    notif_mgr: State<'_, Arc<NotificationManager>>,
) -> Result<(), String> {
    let raw_url = config_mgr.get().server_url;
    let server_url = validate_server_url(&raw_url)?;
    let snapshot = notif_mgr.context_snapshot(&server_url);

    http_client
        .set_issue_mute(&server_url, issue_id, muted)
        .await?;

    if let Some((user_id, gen)) = snapshot {
        notif_mgr.set_issue_mute_for_context(&server_url, user_id, gen, issue_id, muted);
    }
    Ok(())
}

#[tauri::command]
pub async fn mark_issue_notifications_read(
    issue_id: i64,
    config_mgr: State<'_, Arc<ConfigManager>>,
    http_client: State<'_, Arc<ApiHttpClient>>,
) -> Result<(), String> {
    let raw_url = config_mgr.get().server_url;
    let server_url = validate_server_url(&raw_url)?;
    http_client
        .mark_issue_notifications_read(&server_url, issue_id)
        .await
}

#[tauri::command]
pub async fn get_desktop_preferences(
    config_mgr: State<'_, Arc<ConfigManager>>,
    http_client: State<'_, Arc<ApiHttpClient>>,
    notif_mgr: State<'_, Arc<NotificationManager>>,
) -> Result<DesktopPreferenceData, String> {
    let raw_url = config_mgr.get().server_url;
    let server_url = validate_server_url(&raw_url)?;
    let snapshot = notif_mgr.context_snapshot(&server_url);

    let prefs = http_client.get_desktop_preferences(&server_url).await?;

    if let Some((user_id, gen)) = snapshot {
        notif_mgr.update_preferences_for_context(&server_url, user_id, gen, &prefs);
    }
    Ok(prefs)
}

#[tauri::command]
pub async fn update_desktop_preferences(
    payload: UpdateDesktopPreferencePayload,
    config_mgr: State<'_, Arc<ConfigManager>>,
    http_client: State<'_, Arc<ApiHttpClient>>,
    notif_mgr: State<'_, Arc<NotificationManager>>,
) -> Result<DesktopPreferenceData, String> {
    let raw_url = config_mgr.get().server_url;
    let server_url = validate_server_url(&raw_url)?;
    let snapshot = notif_mgr.context_snapshot(&server_url);

    let prefs = http_client
        .update_desktop_preferences(&server_url, payload)
        .await?;

    if let Some((user_id, gen)) = snapshot {
        notif_mgr.update_preferences_for_context(&server_url, user_id, gen, &prefs);
    }

    Ok(prefs)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppConfigTransactionResult {
    pub config: AppConfig,
    pub has_token: bool,
}

pub fn execute_app_config_transaction<
    FPreflightKeychain,
    FUnregOldShortcut,
    FRegNewShortcut,
    FSetAutostart,
    FSetPinned,
    FSaveConfig,
    FRollbackUnregNewShortcut,
    FRollbackRegOldShortcut,
    FRollbackAutostart,
    FRollbackPinned,
>(
    new_config: AppConfig,
    old_config: AppConfig,
    preflight_keychain_fn: FPreflightKeychain,
    unreg_old_sc_fn: FUnregOldShortcut,
    reg_new_sc_fn: FRegNewShortcut,
    set_autostart_fn: FSetAutostart,
    set_pinned_fn: FSetPinned,
    save_config_fn: FSaveConfig,
    rb_unreg_new_sc_fn: FRollbackUnregNewShortcut,
    rb_reg_old_sc_fn: FRollbackRegOldShortcut,
    rb_autostart_fn: FRollbackAutostart,
    rb_pinned_fn: FRollbackPinned,
) -> Result<AppConfigTransactionResult, String>
where
    FPreflightKeychain: FnOnce(&str) -> Result<Option<String>, String>,
    FUnregOldShortcut: FnOnce(&str) -> Result<(), String>,
    FRegNewShortcut: FnOnce(&str) -> Result<(), String>,
    FSetAutostart: FnOnce(bool) -> Result<(), String>,
    FSetPinned: FnOnce(bool) -> Result<(), String>,
    FSaveConfig: FnOnce(AppConfig) -> Result<AppConfig, String>,
    FRollbackUnregNewShortcut: FnOnce(&str) -> Result<(), String>,
    FRollbackRegOldShortcut: FnOnce(&str) -> Result<(), String>,
    FRollbackAutostart: FnOnce(bool) -> Result<(), String>,
    FRollbackPinned: FnOnce(bool) -> Result<(), String>,
{
    // 1. Validate all formats upfront before touching runtime state
    let validated_url = validate_server_url(&new_config.server_url)?;
    let _ = new_config
        .global_shortcut
        .parse::<Shortcut>()
        .map_err(|e| format!("Invalid shortcut format: {}", e))?;

    // 2. Preflight Keychain read on the new target URL BEFORE touching any OS runtime state
    // Ok(None) is valid (no token yet, auth checking will transition to auth); Err aborts immediately!
    let token_opt = preflight_keychain_fn(&validated_url)?;
    let has_token = token_opt.is_some();

    let shortcut_changed = new_config.global_shortcut != old_config.global_shortcut;
    let mut shortcut_updated = false;

    // 3. Global shortcut unregister and register
    if shortcut_changed {
        if !old_config.global_shortcut.is_empty() {
            unreg_old_sc_fn(&old_config.global_shortcut)?;
        }

        if let Err(e) = reg_new_sc_fn(&new_config.global_shortcut) {
            let mut comp_errs = Vec::new();
            if !old_config.global_shortcut.is_empty() {
                if let Err(re) = rb_reg_old_sc_fn(&old_config.global_shortcut) {
                    comp_errs.push(format!("Failed to restore previous shortcut: {}", re));
                }
            }
            return Err(format_rollback_error(
                &format!("Failed to register shortcut: {}", e),
                &comp_errs,
            ));
        }
        shortcut_updated = true;
    }

    // 4. Autostart
    let autostart_changed = new_config.launch_at_login != old_config.launch_at_login;
    if autostart_changed {
        if let Err(e) = set_autostart_fn(new_config.launch_at_login) {
            let mut comp_errs = Vec::new();
            if shortcut_updated {
                if let Err(ue) = rb_unreg_new_sc_fn(&new_config.global_shortcut) {
                    comp_errs.push(format!(
                        "Failed to unregister new shortcut during rollback: {}",
                        ue
                    ));
                }
                if !old_config.global_shortcut.is_empty() {
                    if let Err(re) = rb_reg_old_sc_fn(&old_config.global_shortcut) {
                        comp_errs.push(format!(
                            "Failed to restore old shortcut during rollback: {}",
                            re
                        ));
                    }
                }
            }
            return Err(format_rollback_error(&e, &comp_errs));
        }
    }

    // 5. Window pinned
    let pin_changed = new_config.pinned != old_config.pinned;
    if pin_changed {
        if let Err(e) = set_pinned_fn(new_config.pinned) {
            let mut comp_errs = Vec::new();
            if autostart_changed {
                if let Err(ae) = rb_autostart_fn(old_config.launch_at_login) {
                    comp_errs.push(format!("Failed to restore autostart setting: {}", ae));
                }
            }
            if shortcut_updated {
                if let Err(ue) = rb_unreg_new_sc_fn(&new_config.global_shortcut) {
                    comp_errs.push(format!(
                        "Failed to unregister new shortcut during rollback: {}",
                        ue
                    ));
                }
                if !old_config.global_shortcut.is_empty() {
                    if let Err(re) = rb_reg_old_sc_fn(&old_config.global_shortcut) {
                        comp_errs.push(format!(
                            "Failed to restore old shortcut during rollback: {}",
                            re
                        ));
                    }
                }
            }
            return Err(format_rollback_error(
                &format!("Failed to set window pinned: {}", e),
                &comp_errs,
            ));
        }
    }

    // 6. Config persistence
    let mut to_save = new_config.clone();
    to_save.server_url = validated_url.clone();

    match save_config_fn(to_save) {
        Ok(saved) => Ok(AppConfigTransactionResult {
            config: saved,
            has_token,
        }),
        Err(e) => {
            let mut comp_errs = Vec::new();
            if pin_changed {
                if let Err(pe) = rb_pinned_fn(old_config.pinned) {
                    comp_errs.push(format!("Failed to restore window pinned state: {}", pe));
                }
            }
            if autostart_changed {
                if let Err(ae) = rb_autostart_fn(old_config.launch_at_login) {
                    comp_errs.push(format!(
                        "Failed to restore autostart during config rollback: {}",
                        ae
                    ));
                }
            }
            if shortcut_updated {
                if let Err(ue) = rb_unreg_new_sc_fn(&new_config.global_shortcut) {
                    comp_errs.push(format!(
                        "Failed to unregister new shortcut during config rollback: {}",
                        ue
                    ));
                }
                if !old_config.global_shortcut.is_empty() {
                    if let Err(re) = rb_reg_old_sc_fn(&old_config.global_shortcut) {
                        comp_errs.push(format!(
                            "Failed to restore old shortcut during config rollback: {}",
                            re
                        ));
                    }
                }
            }
            Err(format_rollback_error(
                &format!("Failed to save configuration: {}", e),
                &comp_errs,
            ))
        }
    }
}

#[tauri::command]
pub fn get_app_config(config_mgr: State<'_, Arc<ConfigManager>>) -> AppConfig {
    config_mgr.get()
}

#[tauri::command]
pub async fn update_app_config(
    new_config: AppConfig,
    app: AppHandle,
    config_mgr: State<'_, Arc<ConfigManager>>,
    realtime_mgr: State<'_, Arc<RealtimeManager>>,
    window_mgr: State<'_, Arc<WindowStateManager>>,
) -> Result<AppConfig, String> {
    let old_config = config_mgr.get();
    let old_url = validate_server_url(&old_config.server_url).unwrap_or_default();

    let app_handle_for_reg = app.clone();
    let app_handle_for_reg_rb = app.clone();
    let app_handle_for_unreg = app.clone();
    let app_handle_for_unreg_rb = app.clone();
    let app_handle_for_auto = app.clone();
    let app_handle_for_auto_rb = app.clone();
    let app_handle_for_win = app.clone();
    let app_handle_for_win_rb = app.clone();
    let config_mgr_inner = config_mgr.inner().clone();
    let window_mgr_inner = window_mgr.inner().clone();
    let window_mgr_inner_rb = window_mgr.inner().clone();

    let tx_res = execute_app_config_transaction(
        new_config,
        old_config.clone(),
        |url| keychain::get_token(url),
        |old_sc_str| {
            if let Ok(old_sc) = old_sc_str.parse::<Shortcut>() {
                app_handle_for_unreg
                    .global_shortcut()
                    .unregister(old_sc)
                    .map_err(|e| format!("Failed to unregister previous shortcut: {}", e))
            } else {
                Ok(())
            }
        },
        |new_sc_str| {
            let new_sc = new_sc_str
                .parse::<Shortcut>()
                .map_err(|e| format!("Invalid shortcut format: {}", e))?;
            let app_h = app_handle_for_reg.clone();
            app_handle_for_reg
                .global_shortcut()
                .on_shortcut(new_sc, move |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        crate::tray::toggle_window_visibility(&app_h);
                    }
                })
                .map_err(|e| format!("{}", e))
        },
        |enable| {
            if enable {
                app_handle_for_auto
                    .autolaunch()
                    .enable()
                    .map_err(|e| format!("Failed to enable launch at login: {}", e))
            } else {
                app_handle_for_auto
                    .autolaunch()
                    .disable()
                    .map_err(|e| format!("Failed to disable launch at login: {}", e))
            }
        },
        |pinned| {
            let win = app_handle_for_win.get_webview_window("main");
            window_mgr_inner.set_pinned(pinned, win.as_ref())
        },
        |cfg| config_mgr_inner.update(|c| *c = cfg),
        |new_sc_str| {
            if let Ok(new_sc) = new_sc_str.parse::<Shortcut>() {
                app_handle_for_unreg_rb
                    .global_shortcut()
                    .unregister(new_sc)
                    .map_err(|e| format!("{}", e))
            } else {
                Ok(())
            }
        },
        |old_sc_str| {
            let old_sc = old_sc_str
                .parse::<Shortcut>()
                .map_err(|e| format!("{}", e))?;
            let app_h = app_handle_for_reg_rb.clone();
            app_handle_for_reg_rb
                .global_shortcut()
                .on_shortcut(old_sc, move |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        crate::tray::toggle_window_visibility(&app_h);
                    }
                })
                .map_err(|e| format!("{}", e))
        },
        |enable| {
            if enable {
                app_handle_for_auto_rb
                    .autolaunch()
                    .enable()
                    .map_err(|e| format!("{}", e))
            } else {
                app_handle_for_auto_rb
                    .autolaunch()
                    .disable()
                    .map_err(|e| format!("{}", e))
            }
        },
        |pinned| {
            let win = app_handle_for_win_rb.get_webview_window("main");
            window_mgr_inner_rb.set_pinned(pinned, win.as_ref())
        },
    )?;

    if tx_res.config.server_url != old_url {
        realtime_mgr.stop().await;
        if tx_res.has_token {
            realtime_mgr.start(&tx_res.config.server_url).await;
        }
    }

    window_mgr.set_edge_snap_enabled(tx_res.config.edge_snap_enabled);

    Ok(tx_res.config)
}

#[tauri::command]
pub fn set_window_pinned(
    pinned: bool,
    app: AppHandle,
    config_mgr: State<'_, Arc<ConfigManager>>,
    window_mgr: State<'_, Arc<WindowStateManager>>,
) -> Result<(), String> {
    let prev_pinned = window_mgr.is_pinned();
    let win = app.get_webview_window("main");
    window_mgr.set_pinned(pinned, win.as_ref())?;

    if let Err(e) = config_mgr.update(|c| c.pinned = pinned) {
        // Rollback window runtime state on persistence error
        let mut comp_errs = Vec::new();
        if let Err(pe) = window_mgr.set_pinned(prev_pinned, win.as_ref()) {
            comp_errs.push(format!("Failed to restore window pinned state: {}", pe));
        }
        return Err(format_rollback_error(
            &format!("Failed to save pinned configuration: {}", e),
            &comp_errs,
        ));
    }

    Ok(())
}

#[tauri::command]
pub fn start_window_drag(window: WebviewWindow) -> Result<(), String> {
    window
        .start_dragging()
        .map_err(|e| format!("Failed to start window drag: {e}"))
}

#[tauri::command]
pub fn snap_window_to_nearest_edge(
    window: WebviewWindow,
    window_mgr: State<'_, Arc<WindowStateManager>>,
) -> Result<(), String> {
    window_mgr.snap_to_nearest_edge(&window)
}

#[tauri::command]
pub async fn reconnect_realtime(
    config_mgr: State<'_, Arc<ConfigManager>>,
    realtime_mgr: State<'_, Arc<RealtimeManager>>,
) -> Result<(), String> {
    let server_url = validate_server_url(&config_mgr.get().server_url)?;
    if keychain::get_token(&server_url)?.is_none() {
        return Err(format!("UNAUTHENTICATED:{server_url}"));
    }
    realtime_mgr.start(&server_url).await;
    Ok(())
}

#[tauri::command]
pub fn hide_window(
    app: AppHandle,
    notif_mgr: State<'_, Arc<NotificationManager>>,
) -> Result<(), String> {
    notif_mgr.set_window_visible(false);
    notif_mgr.set_window_focused(false);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
pub fn set_focused_issue(
    issue_id: Option<i64>,
    notif_mgr: State<'_, Arc<NotificationManager>>,
) -> Result<(), String> {
    notif_mgr.set_focused_issue(issue_id);
    Ok(())
}

#[tauri::command]
pub fn open_main_site(
    issue_id: Option<i64>,
    config_mgr: State<'_, Arc<ConfigManager>>,
) -> Result<(), String> {
    let server_url = config_mgr.get().server_url;
    let target_url = match issue_id {
        Some(id) => endpoint_url(&server_url, &format!("issues/{}", id))?,
        None => endpoint_url(&server_url, "issues")?,
    };

    open::that(target_url.as_str()).map_err(|e| format!("Failed to open browser: {}", e))
}

#[tauri::command]
pub fn get_realtime_status(
    realtime_mgr: State<'_, Arc<RealtimeManager>>,
) -> crate::realtime::RealtimeStatusEnvelope {
    realtime_mgr.get_status()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn test_format_rollback_error_with_and_without_compensation() {
        // Without compensation errors
        assert_eq!(
            format_rollback_error("Primary failure", &[]),
            "Primary failure"
        );

        // With compensation errors
        let comp = vec![
            "Failed to restore shortcut".to_string(),
            "Failed to restore autostart".to_string(),
        ];
        assert_eq!(
            format_rollback_error("Primary failure", &comp),
            "Primary failure; Additionally, compensation failed: Failed to restore shortcut; Failed to restore autostart"
        );
    }

    #[test]
    fn test_execute_pairing_exchange_transaction_success() {
        let saved_token = Mutex::new(None::<String>);
        let deleted = Mutex::new(false);
        let config_saved = Mutex::new(false);

        let res = execute_pairing_exchange_transaction(
            "https://server-b.example.com",
            Some("old_token_b".to_string()),
            "new_token_b",
            |_url, token| {
                *saved_token.lock().unwrap() = Some(token.to_string());
                Ok(())
            },
            |_url| {
                *deleted.lock().unwrap() = true;
                Ok(())
            },
            || {
                *config_saved.lock().unwrap() = true;
                Ok(())
            },
        );

        assert!(res.is_ok());
        assert_eq!(
            *saved_token.lock().unwrap(),
            Some("new_token_b".to_string())
        );
        assert_eq!(*config_saved.lock().unwrap(), true);
        assert_eq!(*deleted.lock().unwrap(), false);
    }

    #[test]
    fn test_execute_pairing_exchange_transaction_rollback_when_config_fails_with_prior_token() {
        let token_history = Mutex::new(Vec::new());

        let res = execute_pairing_exchange_transaction(
            "https://server-b.example.com",
            Some("old_token_b".to_string()),
            "new_token_b",
            |_url, token| {
                token_history.lock().unwrap().push(token.to_string());
                Ok(())
            },
            |_url| Ok(()),
            || Err("Disk write failed: permission denied".to_string()),
        );

        assert!(res.is_err());
        let err_msg = res.unwrap_err();
        assert!(err_msg.contains("PAIRING_CONFIG_SAVE_FAILED"));
        assert!(err_msg.contains("Disk write failed: permission denied"));

        // Token history must be: first "new_token_b", then rolled back to "old_token_b"
        let history = token_history.lock().unwrap().clone();
        assert_eq!(
            history,
            vec!["new_token_b".to_string(), "old_token_b".to_string()]
        );
    }

    #[test]
    fn test_execute_pairing_exchange_transaction_rollback_when_config_fails_without_prior_token() {
        let saved_tokens = Mutex::new(Vec::new());
        let deleted_count = Mutex::new(0);

        let res = execute_pairing_exchange_transaction(
            "https://server-b.example.com",
            None, // No prior token existed
            "new_token_b",
            |_url, token| {
                saved_tokens.lock().unwrap().push(token.to_string());
                Ok(())
            },
            |_url| {
                *deleted_count.lock().unwrap() += 1;
                Ok(())
            },
            || Err("Failed to save config".to_string()),
        );

        assert!(res.is_err());
        assert!(res.unwrap_err().contains("PAIRING_CONFIG_SAVE_FAILED"));

        assert_eq!(
            *saved_tokens.lock().unwrap(),
            vec!["new_token_b".to_string()]
        );
        assert_eq!(*deleted_count.lock().unwrap(), 1); // New token was deleted
    }

    #[test]
    fn test_execute_pairing_exchange_transaction_token_save_failure_compensation_and_code() {
        let deleted_count = Mutex::new(0);

        let res = execute_pairing_exchange_transaction(
            "https://server-b.example.com",
            None,
            "new_token_b",
            |_url, _token| Err("OS Keychain disk error".to_string()),
            |_url| {
                *deleted_count.lock().unwrap() += 1;
                Ok(())
            },
            || Ok(()),
        );

        assert!(res.is_err());
        let err = res.unwrap_err();
        assert!(err.contains("PAIRING_TOKEN_SAVE_FAILED"));
        assert!(err.contains("OS Keychain disk error"));
        assert_eq!(*deleted_count.lock().unwrap(), 1);
    }

    #[test]
    fn test_pairing_state_manager_finalize_and_cancel_compare_and_commit() {
        let mgr = PairingStateManager::new();

        // 1. Session 1 begins
        mgr.set(PairingSession {
            pairing_id: "session_1".to_string(),
            device_secret: "secret_1".to_string(),
            server_url: "https://server.example.com".to_string(),
            verification_url: "https://server.example.com/verify?code=1".to_string(),
            expires_at: "2026-08-31T12:00:00Z".to_string(),
        });

        // 2. User restarts pairing -> Session 2 supersedes Session 1
        mgr.set(PairingSession {
            pairing_id: "session_2".to_string(),
            device_secret: "secret_2".to_string(),
            server_url: "https://server.example.com".to_string(),
            verification_url: "https://server.example.com/verify?code=2".to_string(),
            expires_at: "2026-08-31T12:05:00Z".to_string(),
        });

        // 3. Stale Session 1 exchange response arrives and tries to finalize
        let s1_commit = mgr.finalize_if_current("session_1", || Ok("token_saved"));
        assert!(s1_commit.is_err());
        assert!(s1_commit.unwrap_err().contains("PAIRING_STALE_SESSION"));

        // Session 2 MUST STILL be current and active!
        let cur = mgr.get();
        assert!(cur.is_some());
        assert_eq!(cur.unwrap().pairing_id, "session_2");

        // 4. Stale Session 1 cancel arrives -> must NOT clear session 2
        let cleared_old = mgr.clear_if_current("session_1");
        assert_eq!(cleared_old, false);
        assert!(mgr.get().is_some());
        assert_eq!(mgr.get().unwrap().pairing_id, "session_2");

        // 5. Session 2 cancel arrives -> clears session 2
        let cleared_new = mgr.clear_if_current("session_2");
        assert_eq!(cleared_new, true);
        assert!(mgr.get().is_none());
    }

    #[test]
    fn test_execute_app_config_transaction_preflight_keychain_error_blocks_all_changes() {
        let old_cfg = AppConfig {
            server_url: "http://localhost:3101".to_string(),
            global_shortcut: "Alt+CommandOrControl+I".to_string(),
            launch_at_login: false,
            pinned: false,
            edge_snap_enabled: true,
        };
        let new_cfg = AppConfig {
            server_url: "https://new.example.com".to_string(),
            global_shortcut: "Alt+CommandOrControl+K".to_string(),
            launch_at_login: true,
            pinned: true,
            edge_snap_enabled: true,
        };

        let unreg_called = Mutex::new(false);
        let reg_called = Mutex::new(false);
        let auto_called = Mutex::new(false);
        let pin_called = Mutex::new(false);
        let save_called = Mutex::new(false);

        let res = execute_app_config_transaction(
            new_cfg,
            old_cfg,
            |_url| Err("Keychain access failure (OSStatus -25308)".to_string()),
            |_sc| {
                *unreg_called.lock().unwrap() = true;
                Ok(())
            },
            |_sc| {
                *reg_called.lock().unwrap() = true;
                Ok(())
            },
            |_auto| {
                *auto_called.lock().unwrap() = true;
                Ok(())
            },
            |_pin| {
                *pin_called.lock().unwrap() = true;
                Ok(())
            },
            |_cfg| {
                *save_called.lock().unwrap() = true;
                Ok(AppConfig::default())
            },
            |_| Ok(()),
            |_| Ok(()),
            |_| Ok(()),
            |_| Ok(()),
        );

        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Keychain access failure"));

        // No OS or config changes were performed
        assert_eq!(*unreg_called.lock().unwrap(), false);
        assert_eq!(*reg_called.lock().unwrap(), false);
        assert_eq!(*auto_called.lock().unwrap(), false);
        assert_eq!(*pin_called.lock().unwrap(), false);
        assert_eq!(*save_called.lock().unwrap(), false);
    }

    #[test]
    fn test_execute_app_config_transaction_unreg_old_shortcut_failure_stops_transaction() {
        let old_cfg = AppConfig {
            server_url: "http://localhost:3101".to_string(),
            global_shortcut: "Alt+CommandOrControl+I".to_string(),
            launch_at_login: false,
            pinned: false,
            edge_snap_enabled: true,
        };
        let new_cfg = AppConfig {
            server_url: "http://localhost:3101".to_string(),
            global_shortcut: "Alt+CommandOrControl+K".to_string(),
            launch_at_login: true,
            pinned: true,
            edge_snap_enabled: true,
        };

        let reg_called = Mutex::new(false);
        let auto_called = Mutex::new(false);
        let pin_called = Mutex::new(false);
        let save_called = Mutex::new(false);

        let res = execute_app_config_transaction(
            new_cfg,
            old_cfg,
            |_url| Ok(None),
            |_sc| Err("OS shortcut unregister error".to_string()),
            |_sc| {
                *reg_called.lock().unwrap() = true;
                Ok(())
            },
            |_auto| {
                *auto_called.lock().unwrap() = true;
                Ok(())
            },
            |_pin| {
                *pin_called.lock().unwrap() = true;
                Ok(())
            },
            |_cfg| {
                *save_called.lock().unwrap() = true;
                Ok(AppConfig::default())
            },
            |_| Ok(()),
            |_| Ok(()),
            |_| Ok(()),
            |_| Ok(()),
        );

        assert!(res.is_err());
        assert!(res.unwrap_err().contains("OS shortcut unregister error"));

        // Must not proceed to register new shortcut, autostart, pin, or config
        assert_eq!(*reg_called.lock().unwrap(), false);
        assert_eq!(*auto_called.lock().unwrap(), false);
        assert_eq!(*pin_called.lock().unwrap(), false);
        assert_eq!(*save_called.lock().unwrap(), false);
    }

    #[test]
    fn test_execute_app_config_transaction_success_returns_has_token() {
        let old_cfg = AppConfig {
            server_url: "http://localhost:3101".to_string(),
            global_shortcut: "Alt+CommandOrControl+I".to_string(),
            launch_at_login: false,
            pinned: false,
            edge_snap_enabled: true,
        };
        let new_cfg = AppConfig {
            server_url: "https://server-with-token.example.com".to_string(),
            global_shortcut: "Alt+CommandOrControl+I".to_string(),
            launch_at_login: false,
            pinned: false,
            edge_snap_enabled: true,
        };

        // Case 1: Preflight finds existing token -> returns has_token = true
        let res_with_token = execute_app_config_transaction(
            new_cfg.clone(),
            old_cfg.clone(),
            |_url| Ok(Some("existing_token".to_string())),
            |_| Ok(()),
            |_| Ok(()),
            |_| Ok(()),
            |_| Ok(()),
            |cfg| Ok(cfg),
            |_| Ok(()),
            |_| Ok(()),
            |_| Ok(()),
            |_| Ok(()),
        );
        assert!(res_with_token.is_ok());
        let tx_res = res_with_token.unwrap();
        assert_eq!(tx_res.has_token, true);
        assert_eq!(
            tx_res.config.server_url,
            "https://server-with-token.example.com"
        );

        // Case 2: Preflight finds no token -> returns has_token = false
        let res_without_token = execute_app_config_transaction(
            new_cfg,
            old_cfg,
            |_url| Ok(None),
            |_| Ok(()),
            |_| Ok(()),
            |_| Ok(()),
            |_| Ok(()),
            |cfg| Ok(cfg),
            |_| Ok(()),
            |_| Ok(()),
            |_| Ok(()),
            |_| Ok(()),
        );
        assert!(res_without_token.is_ok());
        assert_eq!(res_without_token.unwrap().has_token, false);
    }
}
