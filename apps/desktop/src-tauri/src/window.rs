use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{PhysicalPosition, WebviewWindow, WindowEvent};

const EDGE_SNAP_THRESHOLD_LOGICAL_PX: f64 = 18.0;
const EDGE_SNAP_DEBOUNCE_MS: u64 = 140;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

pub fn calculate_snap_position(
    window: WindowRect,
    work_area: WindowRect,
    threshold: i32,
    force_nearest: bool,
) -> (i32, i32) {
    let max_x = (work_area.x + work_area.width - window.width).max(work_area.x);
    let max_y = (work_area.y + work_area.height - window.height).max(work_area.y);
    let clamped_x = window.x.clamp(work_area.x, max_x);
    let clamped_y = window.y.clamp(work_area.y, max_y);

    let distances = [
        (clamped_x - work_area.x).abs(),
        (clamped_x - max_x).abs(),
        (clamped_y - work_area.y).abs(),
        (clamped_y - max_y).abs(),
    ];

    if force_nearest {
        return match distances
            .iter()
            .enumerate()
            .min_by_key(|(_, distance)| *distance)
            .map(|(index, _)| index)
        {
            Some(0) => (work_area.x, clamped_y),
            Some(1) => (max_x, clamped_y),
            Some(2) => (clamped_x, work_area.y),
            Some(3) => (clamped_x, max_y),
            _ => (clamped_x, clamped_y),
        };
    }

    let snapped_x = if distances[0] <= threshold {
        work_area.x
    } else if distances[1] <= threshold {
        max_x
    } else {
        clamped_x
    };
    let snapped_y = if distances[2] <= threshold {
        work_area.y
    } else if distances[3] <= threshold {
        max_y
    } else {
        clamped_y
    };

    (snapped_x, snapped_y)
}

fn snap_window(window: &WebviewWindow, force_nearest: bool) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| format!("Failed to read current monitor: {e}"))?
        .ok_or_else(|| "No active monitor is available".to_string())?;
    let position = window
        .outer_position()
        .map_err(|e| format!("Failed to read window position: {e}"))?;
    let size = window
        .outer_size()
        .map_err(|e| format!("Failed to read window size: {e}"))?;
    let work_area = monitor.work_area();
    let threshold = (EDGE_SNAP_THRESHOLD_LOGICAL_PX * monitor.scale_factor()).round() as i32;
    let (target_x, target_y) = calculate_snap_position(
        WindowRect {
            x: position.x,
            y: position.y,
            width: size.width.min(i32::MAX as u32) as i32,
            height: size.height.min(i32::MAX as u32) as i32,
        },
        WindowRect {
            x: work_area.position.x,
            y: work_area.position.y,
            width: work_area.size.width.min(i32::MAX as u32) as i32,
            height: work_area.size.height.min(i32::MAX as u32) as i32,
        },
        threshold,
        force_nearest,
    );

    if target_x != position.x || target_y != position.y {
        window
            .set_position(PhysicalPosition::new(target_x, target_y))
            .map_err(|e| format!("Failed to snap window: {e}"))?;
    }
    Ok(())
}

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
    edge_snap_enabled: Arc<AtomicBool>,
    move_generation: Arc<AtomicU64>,
}

impl WindowStateManager {
    pub fn new(pinned_initial: bool, edge_snap_enabled: bool) -> Self {
        Self {
            pinned: Arc::new(AtomicBool::new(pinned_initial)),
            edge_snap_enabled: Arc::new(AtomicBool::new(edge_snap_enabled)),
            move_generation: Arc::new(AtomicU64::new(0)),
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

    pub fn set_edge_snap_enabled(&self, enabled: bool) {
        self.edge_snap_enabled.store(enabled, Ordering::SeqCst);
    }

    pub fn is_edge_snap_enabled(&self) -> bool {
        self.edge_snap_enabled.load(Ordering::SeqCst)
    }

    pub fn snap_to_nearest_edge(&self, window: &WebviewWindow) -> Result<(), String> {
        snap_window(window, true)
    }

    pub fn setup_window_events(
        &self,
        window: &WebviewWindow,
        notif_mgr: Arc<crate::notifications::NotificationManager>,
    ) {
        let pinned_flag = self.pinned.clone();
        let win_clone = window.clone();
        let notif_mgr_clone = notif_mgr.clone();
        let edge_snap_enabled = self.edge_snap_enabled.clone();
        let move_generation = self.move_generation.clone();

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
            WindowEvent::Moved(_) if edge_snap_enabled.load(Ordering::SeqCst) => {
                let generation = move_generation.fetch_add(1, Ordering::SeqCst) + 1;
                let generation_tracker = move_generation.clone();
                let snap_enabled = edge_snap_enabled.clone();
                let moved_window = win_clone.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(EDGE_SNAP_DEBOUNCE_MS)).await;
                    if snap_enabled.load(Ordering::SeqCst)
                        && generation_tracker.load(Ordering::SeqCst) == generation
                    {
                        let _ = snap_window(&moved_window, false);
                    }
                });
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
        let mgr = WindowStateManager::new(false, true);
        assert!(!mgr.is_pinned());
        assert!(mgr.set_pinned(true, None).is_ok());
        assert!(mgr.is_pinned());
        assert!(mgr.set_pinned(false, None).is_ok());
        assert!(!mgr.is_pinned());
        assert!(mgr.is_edge_snap_enabled());
        mgr.set_edge_snap_enabled(false);
        assert!(!mgr.is_edge_snap_enabled());
    }

    #[test]
    fn test_window_snaps_to_edges_inside_threshold() {
        let work_area = WindowRect {
            x: 0,
            y: 24,
            width: 1440,
            height: 876,
        };
        let window = WindowRect {
            x: 12,
            y: 720,
            width: 420,
            height: 180,
        };
        assert_eq!(
            calculate_snap_position(window, work_area, 18, false),
            (0, 720)
        );

        let corner = WindowRect {
            x: 1010,
            y: 34,
            width: 420,
            height: 180,
        };
        assert_eq!(
            calculate_snap_position(corner, work_area, 18, false),
            (1020, 24)
        );
    }

    #[test]
    fn test_window_stays_free_outside_threshold_and_force_uses_nearest_edge() {
        let work_area = WindowRect {
            x: 0,
            y: 24,
            width: 1440,
            height: 876,
        };
        let window = WindowRect {
            x: 500,
            y: 300,
            width: 420,
            height: 180,
        };
        assert_eq!(
            calculate_snap_position(window, work_area, 18, false),
            (500, 300)
        );
        assert_eq!(
            calculate_snap_position(window, work_area, 18, true),
            (500, 24)
        );
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
