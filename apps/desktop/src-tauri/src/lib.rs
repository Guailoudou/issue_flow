pub mod commands;
pub mod config;
pub mod http;
pub mod keychain;
pub mod notifications;
pub mod realtime;
pub mod tray;
pub mod window;

use commands::*;
use config::ConfigManager;
use http::{ApiHttpClient, PairingStateManager};
use notifications::NotificationManager;
use realtime::RealtimeManager;
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use window::WindowStateManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let config_mgr = Arc::new(ConfigManager::new(app_data_dir));
            let http_client = Arc::new(ApiHttpClient::new());
            let notif_mgr = Arc::new(NotificationManager::new());
            let realtime_mgr = Arc::new(RealtimeManager::new(
                app.handle().clone(),
                notif_mgr.clone(),
                http_client.clone(),
            ));
            let window_mgr = Arc::new(WindowStateManager::new(config_mgr.get().pinned));
            let pairing_state_mgr = Arc::new(PairingStateManager::new());

            let current_config = config_mgr.get();

            // Setup main window and apply saved pinned / always-on-top
            if let Some(main_win) = app.get_webview_window("main") {
                if let Err(e) = window_mgr.set_pinned(current_config.pinned, Some(&main_win)) {
                    eprintln!("Failed to set initial window pinned state: {}", e);
                }
                window_mgr.setup_window_events(&main_win, notif_mgr.clone());
            }

            // Setup tray - failure must return explicit error
            tray::setup_tray(app.handle())?;

            // Register startup global shortcut
            match current_config.global_shortcut.parse::<Shortcut>() {
                Ok(shortcut) => {
                    let app_handle = app.handle().clone();
                    if let Err(e) = app.global_shortcut().on_shortcut(
                        shortcut,
                        move |_app, _shortcut, event| {
                            if event.state() == ShortcutState::Pressed {
                                tray::toggle_window_visibility(&app_handle);
                            }
                        },
                    ) {
                        eprintln!("Failed to register startup global shortcut: {}", e);
                    }
                }
                Err(e) => {
                    eprintln!("Failed to parse startup global shortcut: {}", e);
                }
            }

            // Request notification permission gracefully on startup without blocking
            let app_handle_for_notif = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_notification::NotificationExt;
                let _ = app_handle_for_notif.notification().request_permission();
            });

            // Sync startup autostart
            if current_config.launch_at_login {
                if let Err(e) = app.handle().autolaunch().enable() {
                    eprintln!("Failed to enable launch at login on startup: {}", e);
                }
            } else if let Err(e) = app.handle().autolaunch().disable() {
                eprintln!("Failed to disable launch at login on startup: {}", e);
            }

            app.manage(config_mgr);
            app.manage(http_client);
            app.manage(notif_mgr);
            app.manage(realtime_mgr);
            app.manage(window_mgr);
            app.manage(pairing_state_mgr);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_auth_status,
            start_pairing,
            poll_pairing_status,
            cancel_pairing,
            reopen_pairing_authorization,
            logout,
            get_overview,
            update_issue_state,
            set_issue_subscription,
            set_issue_mute,
            mark_issue_notifications_read,
            get_desktop_preferences,
            update_desktop_preferences,
            get_app_config,
            update_app_config,
            set_window_pinned,
            hide_window,
            set_focused_issue,
            open_main_site,
            get_realtime_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_tauri_conf_does_not_contain_single_instance_plugin() {
        let conf_str = include_str!("../tauri.conf.json");
        let conf: serde_json::Value =
            serde_json::from_str(conf_str).expect("tauri.conf.json must be valid JSON");

        let forbidden_plugin_keys = [
            "opener",
            "notification",
            "global-shortcut",
            "globalShortcut",
            "global_shortcut",
            "autostart",
            "autoStart",
            "auto_start",
            "single-instance",
            "singleInstance",
            "single_instance",
        ];

        if let Some(plugins) = conf.get("plugins").and_then(|p| p.as_object()) {
            for key in forbidden_plugin_keys {
                if let Some(val) = plugins.get(key) {
                    assert!(
                        !val.is_object(),
                        "tauri.conf.json plugins must not contain '{key}' as a mapping configuration"
                    );
                }
                assert!(
                    !plugins.contains_key(key),
                    "tauri.conf.json plugins must not contain '{key}'"
                );
            }
        }
    }
}
