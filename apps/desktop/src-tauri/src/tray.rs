use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager};

pub const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-icon.png");

pub fn load_tray_icon() -> Result<tauri::image::Image<'static>, Box<dyn std::error::Error>> {
    let icon = tauri::image::Image::from_bytes(TRAY_ICON_BYTES)?;
    if icon.width() < 22 || icon.height() < 22 {
        return Err(format!(
            "Tray icon dimensions too small ({}x{}), expected at least 22x22",
            icon.width(),
            icon.height()
        )
        .into());
    }
    Ok(icon)
}

pub fn should_toggle_on_tray_click(
    button: tauri::tray::MouseButton,
    button_state: tauri::tray::MouseButtonState,
) -> bool {
    matches!(
        (button, button_state),
        (
            tauri::tray::MouseButton::Left,
            tauri::tray::MouseButtonState::Up
        )
    )
}

pub fn should_toggle_on_tray_event(event: &tauri::tray::TrayIconEvent) -> bool {
    match event {
        tauri::tray::TrayIconEvent::Click {
            button,
            button_state,
            ..
        } => should_toggle_on_tray_click(*button, *button_state),
        _ => false,
    }
}

pub fn setup_tray(app: &AppHandle) -> Result<TrayIcon, Box<dyn std::error::Error>> {
    let show_hide_i = MenuItem::with_id(app, "toggle_window", "显示/隐藏", true, None::<&str>)?;
    let settings_i = MenuItem::with_id(app, "open_settings", "偏好设置…", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出 IssueFlow", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_hide_i, &settings_i, &quit_i])?;
    let icon_img = load_tray_icon()?;

    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon_img)
        .icon_as_template(true)
        .tooltip("IssueFlow")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle_window" => {
                toggle_window_visibility(app);
            }
            "open_settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("desktop:navigate", "settings");
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if should_toggle_on_tray_event(&event) {
                let app = tray.app_handle();
                toggle_window_visibility(app);
            }
        })
        .build(app)?;

    Ok(tray)
}

pub fn update_tray_badge(app: &AppHandle, count: i64) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let badge_text = if count <= 0 {
            "".to_string()
        } else if count > 99 {
            " 99+".to_string()
        } else {
            format!(" {}", count)
        };
        let _ = tray.set_title(Some(&badge_text));
    }
}

pub fn toggle_window_visibility(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(is_visible) = window.is_visible() {
            if is_visible {
                let _ = window.hide();
            } else {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};

    #[test]
    fn test_tray_icon_decodable_and_dimensions() {
        let icon_res = load_tray_icon();
        assert!(icon_res.is_ok(), "Tray icon must decode successfully");
        let icon = icon_res.unwrap();
        assert!(
            icon.width() >= 22,
            "Tray icon width must be >= 22, got {}",
            icon.width()
        );
        assert!(
            icon.height() >= 22,
            "Tray icon height must be >= 22, got {}",
            icon.height()
        );
    }

    #[test]
    fn test_should_toggle_on_tray_click_logic() {
        // Only MouseButton::Left + MouseButtonState::Up triggers toggle
        assert_eq!(
            should_toggle_on_tray_click(MouseButton::Left, MouseButtonState::Up),
            true
        );

        // MouseButton::Left + MouseButtonState::Down must NOT trigger toggle
        assert_eq!(
            should_toggle_on_tray_click(MouseButton::Left, MouseButtonState::Down),
            false
        );

        // Right button clicks must NOT trigger toggle
        assert_eq!(
            should_toggle_on_tray_click(MouseButton::Right, MouseButtonState::Up),
            false
        );
        assert_eq!(
            should_toggle_on_tray_click(MouseButton::Right, MouseButtonState::Down),
            false
        );

        // Middle button clicks must NOT trigger toggle
        assert_eq!(
            should_toggle_on_tray_click(MouseButton::Middle, MouseButtonState::Up),
            false
        );
        assert_eq!(
            should_toggle_on_tray_click(MouseButton::Middle, MouseButtonState::Down),
            false
        );
    }

    #[test]
    fn test_should_toggle_on_tray_event() {
        let click_up = TrayIconEvent::Click {
            id: tauri::tray::TrayIconId::new("main-tray"),
            position: tauri::PhysicalPosition { x: 0.0, y: 0.0 },
            rect: tauri::Rect {
                position: tauri::Position::Physical(tauri::PhysicalPosition { x: 0, y: 0 }),
                size: tauri::Size::Physical(tauri::PhysicalSize {
                    width: 0,
                    height: 0,
                }),
            },
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
        };
        assert_eq!(should_toggle_on_tray_event(&click_up), true);

        let click_down = TrayIconEvent::Click {
            id: tauri::tray::TrayIconId::new("main-tray"),
            position: tauri::PhysicalPosition { x: 0.0, y: 0.0 },
            rect: tauri::Rect {
                position: tauri::Position::Physical(tauri::PhysicalPosition { x: 0, y: 0 }),
                size: tauri::Size::Physical(tauri::PhysicalSize {
                    width: 0,
                    height: 0,
                }),
            },
            button: MouseButton::Left,
            button_state: MouseButtonState::Down,
        };
        assert_eq!(should_toggle_on_tray_event(&click_down), false);

        let double_click = TrayIconEvent::DoubleClick {
            id: tauri::tray::TrayIconId::new("main-tray"),
            position: tauri::PhysicalPosition { x: 0.0, y: 0.0 },
            rect: tauri::Rect {
                position: tauri::Position::Physical(tauri::PhysicalPosition { x: 0, y: 0 }),
                size: tauri::Size::Physical(tauri::PhysicalSize {
                    width: 0,
                    height: 0,
                }),
            },
            button: MouseButton::Left,
        };
        assert_eq!(should_toggle_on_tray_event(&double_click), false);

        let enter = TrayIconEvent::Enter {
            id: tauri::tray::TrayIconId::new("main-tray"),
            position: tauri::PhysicalPosition { x: 0.0, y: 0.0 },
            rect: tauri::Rect {
                position: tauri::Position::Physical(tauri::PhysicalPosition { x: 0, y: 0 }),
                size: tauri::Size::Physical(tauri::PhysicalSize {
                    width: 0,
                    height: 0,
                }),
            },
        };
        assert_eq!(should_toggle_on_tray_event(&enter), false);
    }
}
