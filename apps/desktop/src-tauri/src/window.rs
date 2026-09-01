use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{WebviewWindow, WindowEvent};

#[derive(Debug, PartialEq, Eq)]
pub enum WindowAction {
    Hide,
    PreventCloseAndHide,
    Ignore,
}

pub fn determine_window_event_action(
    is_focused_event: Option<bool>,
    is_close_requested: bool,
    is_pinned: bool,
) -> WindowAction {
    if is_close_requested {
        return WindowAction::PreventCloseAndHide;
    }
    if let Some(focused) = is_focused_event {
        if !focused && !is_pinned {
            return WindowAction::Hide;
        }
    }
    WindowAction::Ignore
}

pub struct WindowStateManager {
    pinned: Arc<AtomicBool>,
}

impl WindowStateManager {
    pub fn new(pinned_initial: bool) -> Self {
        Self {
            pinned: Arc::new(AtomicBool::new(pinned_initial)),
        }
    }

    pub fn set_pinned(&self, pinned: bool, window: Option<&WebviewWindow>) -> Result<(), String> {
        if let Some(win) = window {
            win.set_always_on_top(pinned)
                .map_err(|e| format!("Failed to set window always-on-top: {}", e))?;
        }
        self.pinned.store(pinned, Ordering::SeqCst);
        Ok(())
    }

    pub fn is_pinned(&self) -> bool {
        self.pinned.load(Ordering::SeqCst)
    }

    pub fn setup_window_events(
        &self,
        window: &WebviewWindow,
        notif_mgr: Arc<crate::notifications::NotificationManager>,
    ) {
        let pinned_flag = self.pinned.clone();
        let win_clone = window.clone();
        let notif_mgr_clone = notif_mgr.clone();

        window.on_window_event(move |event| match event {
            WindowEvent::Focused(focused) => {
                notif_mgr_clone.set_window_focused(*focused);
                if *focused {
                    notif_mgr_clone.set_window_visible(true);
                } else if !pinned_flag.load(Ordering::SeqCst) {
                    notif_mgr_clone.set_window_visible(false);
                    let _ = win_clone.hide();
                }
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                notif_mgr_clone.set_window_visible(false);
                notif_mgr_clone.set_window_focused(false);
                let _ = win_clone.hide();
            }
            _ => {}
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_window_close_requested_prevented_and_hidden() {
        assert_eq!(
            determine_window_event_action(None, true, false),
            WindowAction::PreventCloseAndHide
        );
        assert_eq!(
            determine_window_event_action(None, true, true),
            WindowAction::PreventCloseAndHide
        );
    }

    #[test]
    fn test_window_unfocused_behavior() {
        // Unpinned + lost focus -> Hide
        assert_eq!(
            determine_window_event_action(Some(false), false, false),
            WindowAction::Hide
        );
        // Pinned + lost focus -> Ignore (keep visible)
        assert_eq!(
            determine_window_event_action(Some(false), false, true),
            WindowAction::Ignore
        );
        // Focused -> Ignore
        assert_eq!(
            determine_window_event_action(Some(true), false, false),
            WindowAction::Ignore
        );
    }

    #[test]
    fn test_window_state_manager_pinned() {
        let mgr = WindowStateManager::new(false);
        assert!(!mgr.is_pinned());
        assert!(mgr.set_pinned(true, None).is_ok());
        assert!(mgr.is_pinned());
        assert!(mgr.set_pinned(false, None).is_ok());
        assert!(!mgr.is_pinned());
    }

    #[test]
    fn test_focused_visibility_sync_notification_manager() {
        let notif_mgr = Arc::new(crate::notifications::NotificationManager::new());
        // Initially visible=true, focused=false
        assert!(notif_mgr.is_window_visible());
        assert!(!notif_mgr.is_window_focused());

        // Focus lost, unpinned -> window hidden
        notif_mgr.set_window_focused(false);
        notif_mgr.set_window_visible(false);
        assert!(!notif_mgr.is_window_visible());
        assert!(!notif_mgr.is_window_focused());

        // Window focused again -> window visible must sync to true
        notif_mgr.set_window_focused(true);
        notif_mgr.set_window_visible(true);
        assert!(notif_mgr.is_window_visible());
        assert!(notif_mgr.is_window_focused());
    }
}
