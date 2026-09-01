use crate::http::DesktopPreferenceData;
use chrono::{NaiveTime, Timelike};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationFilterRule {
    pub current_user_id: i64,
    pub system_notifications_enabled: bool,
    pub assignment_enabled: bool,
    pub mention_enabled: bool,
    pub status_enabled: bool,
    pub assignee_enabled: bool,
    pub comment_enabled: bool,
    pub dnd_enabled: bool,
    pub dnd_start: Option<String>,
    pub dnd_end: Option<String>,
    pub time_zone: String,
    pub muted_issue_ids: Vec<i64>,
}

impl Default for NotificationFilterRule {
    fn default() -> Self {
        Self {
            current_user_id: 0,
            system_notifications_enabled: true,
            assignment_enabled: true,
            mention_enabled: true,
            status_enabled: true,
            assignee_enabled: true,
            comment_enabled: false,
            dnd_enabled: false,
            dnd_start: None,
            dnd_end: None,
            time_zone: "Asia/Shanghai".to_string(),
            muted_issue_ids: Vec::new(),
        }
    }
}

use std::collections::{HashSet, VecDeque};

#[derive(Debug, Clone)]
struct NotificationSessionState {
    ready: bool,
    origin: Option<String>,
    user_id: i64,
    generation: u64,
    rules: NotificationFilterRule,
    seen_origin: Option<String>,
    seen_user_id: i64,
    seen_deque: VecDeque<i64>,
    seen_set: HashSet<i64>,
}

impl Default for NotificationSessionState {
    fn default() -> Self {
        Self {
            ready: false,
            origin: None,
            user_id: 0,
            generation: 0,
            rules: NotificationFilterRule::default(),
            seen_origin: None,
            seen_user_id: 0,
            seen_deque: VecDeque::new(),
            seen_set: HashSet::new(),
        }
    }
}

impl NotificationSessionState {
    fn record_seen_notification(&mut self, origin: &str, user_id: i64, id: i64) -> bool {
        let is_same_context =
            self.seen_origin.as_deref() == Some(origin) && self.seen_user_id == user_id;
        if !is_same_context {
            self.seen_origin = Some(origin.to_string());
            self.seen_user_id = user_id;
            self.seen_deque.clear();
            self.seen_set.clear();
        }

        if self.seen_set.contains(&id) {
            return true; // Already seen
        }
        if self.seen_deque.len() >= 1000 {
            if let Some(oldest) = self.seen_deque.pop_front() {
                self.seen_set.remove(&oldest);
            }
        }
        self.seen_deque.push_back(id);
        self.seen_set.insert(id);
        false
    }
}

pub struct NotificationManager {
    session: Mutex<NotificationSessionState>,
    focused_issue_id: Mutex<Option<i64>>,
    window_visible: AtomicBool,
    window_focused: AtomicBool,
}

impl NotificationManager {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(NotificationSessionState::default()),
            focused_issue_id: Mutex::new(None),
            window_visible: AtomicBool::new(true),
            window_focused: AtomicBool::new(false),
        }
    }

    pub fn is_ready(&self) -> bool {
        self.session.lock().unwrap().ready
    }

    pub fn is_window_visible(&self) -> bool {
        self.window_visible.load(Ordering::SeqCst)
    }

    pub fn is_window_focused(&self) -> bool {
        self.window_focused.load(Ordering::SeqCst)
    }

    pub fn activate_session(
        &self,
        server_url: &str,
        user_id: i64,
        generation: u64,
        prefs: &DesktopPreferenceData,
        mutes: Vec<i64>,
    ) {
        let canonical =
            crate::http::validate_server_url(server_url).unwrap_or_else(|_| server_url.to_string());

        let mut session = self.session.lock().unwrap();
        session.ready = true;
        session.origin = Some(canonical.clone());
        session.user_id = user_id;
        session.generation = generation;

        session.rules.current_user_id = user_id;
        session.rules.system_notifications_enabled = prefs.system_notifications_enabled;
        session.rules.assignment_enabled = prefs.assignment_notifications_enabled;
        session.rules.mention_enabled = prefs.mention_notifications_enabled;
        session.rules.status_enabled = prefs.status_notifications_enabled;
        session.rules.assignee_enabled = prefs.assignee_notifications_enabled;
        session.rules.comment_enabled = prefs.comment_notifications_enabled;
        session.rules.dnd_enabled = prefs.do_not_disturb_enabled;
        session.rules.dnd_start = prefs.do_not_disturb_start.clone();
        session.rules.dnd_end = prefs.do_not_disturb_end.clone();
        session.rules.time_zone = prefs.time_zone.clone();
        session.rules.muted_issue_ids = mutes;

        let is_same_dedupe_context =
            session.seen_origin.as_deref() == Some(&canonical) && session.seen_user_id == user_id;
        if !is_same_dedupe_context {
            session.seen_origin = Some(canonical);
            session.seen_user_id = user_id;
            session.seen_deque.clear();
            session.seen_set.clear();
        }
    }

    pub fn set_not_ready(&self) {
        self.session.lock().unwrap().ready = false;
    }

    pub fn set_not_ready_for_generation(&self, server_url: &str, generation: u64) -> bool {
        let canonical = match crate::http::validate_server_url(server_url) {
            Ok(u) => u,
            Err(_) => server_url.to_string(),
        };
        let mut session = self.session.lock().unwrap();
        if session.origin.as_deref() == Some(&canonical) && session.generation == generation {
            session.ready = false;
            true
        } else {
            false
        }
    }

    pub fn context_snapshot(&self, server_url: &str) -> Option<(i64, u64)> {
        let canonical = match crate::http::validate_server_url(server_url) {
            Ok(u) => u,
            Err(_) => return None,
        };
        let session = self.session.lock().unwrap();
        if session.ready && session.origin.as_deref() == Some(&canonical) {
            if session.user_id > 0 && session.generation > 0 {
                return Some((session.user_id, session.generation));
            }
        }
        None
    }

    pub fn reset_context(&self) {
        {
            let mut session = self.session.lock().unwrap();
            *session = NotificationSessionState::default();
        }
        *self.focused_issue_id.lock().unwrap() = None;
    }

    pub fn check_and_record_seen_notification(&self, origin: &str, user_id: i64, id: i64) -> bool {
        let mut session = self.session.lock().unwrap();
        session.record_seen_notification(origin, user_id, id)
    }

    pub fn update_preferences_for_context(
        &self,
        server_url: &str,
        user_id: i64,
        generation: u64,
        prefs: &DesktopPreferenceData,
    ) -> bool {
        let canonical = match crate::http::validate_server_url(server_url) {
            Ok(u) => u,
            Err(_) => server_url.to_string(),
        };
        let mut session = self.session.lock().unwrap();
        if !session.ready
            || session.origin.as_deref() != Some(&canonical)
            || session.user_id != user_id
            || session.generation != generation
        {
            return false; // Stale context discarded
        }

        session.rules.system_notifications_enabled = prefs.system_notifications_enabled;
        session.rules.assignment_enabled = prefs.assignment_notifications_enabled;
        session.rules.mention_enabled = prefs.mention_notifications_enabled;
        session.rules.status_enabled = prefs.status_notifications_enabled;
        session.rules.assignee_enabled = prefs.assignee_notifications_enabled;
        session.rules.comment_enabled = prefs.comment_notifications_enabled;
        session.rules.dnd_enabled = prefs.do_not_disturb_enabled;
        session.rules.dnd_start = prefs.do_not_disturb_start.clone();
        session.rules.dnd_end = prefs.do_not_disturb_end.clone();
        session.rules.time_zone = prefs.time_zone.clone();
        true
    }

    pub fn set_issue_mute_for_context(
        &self,
        server_url: &str,
        user_id: i64,
        generation: u64,
        issue_id: i64,
        muted: bool,
    ) -> bool {
        let canonical = match crate::http::validate_server_url(server_url) {
            Ok(u) => u,
            Err(_) => server_url.to_string(),
        };
        let mut session = self.session.lock().unwrap();
        if !session.ready
            || session.origin.as_deref() != Some(&canonical)
            || session.user_id != user_id
            || session.generation != generation
        {
            return false; // Stale context discarded
        }

        if muted {
            if !session.rules.muted_issue_ids.contains(&issue_id) {
                session.rules.muted_issue_ids.push(issue_id);
            }
        } else {
            session.rules.muted_issue_ids.retain(|&id| id != issue_id);
        }
        true
    }

    pub fn update_preferences_for_generation(
        &self,
        server_url: &str,
        generation: u64,
        prefs: &DesktopPreferenceData,
    ) -> bool {
        let canonical =
            crate::http::validate_server_url(server_url).unwrap_or_else(|_| server_url.to_string());
        let mut session = self.session.lock().unwrap();
        if !session.ready
            || session.origin.as_deref() != Some(&canonical)
            || session.generation != generation
        {
            return false; // Mismatched source or old generation response discarded
        }

        session.rules.system_notifications_enabled = prefs.system_notifications_enabled;
        session.rules.assignment_enabled = prefs.assignment_notifications_enabled;
        session.rules.mention_enabled = prefs.mention_notifications_enabled;
        session.rules.status_enabled = prefs.status_notifications_enabled;
        session.rules.assignee_enabled = prefs.assignee_notifications_enabled;
        session.rules.comment_enabled = prefs.comment_notifications_enabled;
        session.rules.dnd_enabled = prefs.do_not_disturb_enabled;
        session.rules.dnd_start = prefs.do_not_disturb_start.clone();
        session.rules.dnd_end = prefs.do_not_disturb_end.clone();
        session.rules.time_zone = prefs.time_zone.clone();
        true
    }

    pub fn update_preferences_for_source(
        &self,
        server_url: &str,
        prefs: &DesktopPreferenceData,
    ) -> bool {
        let canonical =
            crate::http::validate_server_url(server_url).unwrap_or_else(|_| server_url.to_string());
        let mut session = self.session.lock().unwrap();
        if !session.ready || session.origin.as_deref() != Some(&canonical) {
            return false;
        }

        session.rules.system_notifications_enabled = prefs.system_notifications_enabled;
        session.rules.assignment_enabled = prefs.assignment_notifications_enabled;
        session.rules.mention_enabled = prefs.mention_notifications_enabled;
        session.rules.status_enabled = prefs.status_notifications_enabled;
        session.rules.assignee_enabled = prefs.assignee_notifications_enabled;
        session.rules.comment_enabled = prefs.comment_notifications_enabled;
        session.rules.dnd_enabled = prefs.do_not_disturb_enabled;
        session.rules.dnd_start = prefs.do_not_disturb_start.clone();
        session.rules.dnd_end = prefs.do_not_disturb_end.clone();
        session.rules.time_zone = prefs.time_zone.clone();
        true
    }

    pub fn set_issue_mute_for_generation(
        &self,
        server_url: &str,
        generation: u64,
        issue_id: i64,
        muted: bool,
    ) -> bool {
        let canonical =
            crate::http::validate_server_url(server_url).unwrap_or_else(|_| server_url.to_string());
        let mut session = self.session.lock().unwrap();
        if !session.ready
            || session.origin.as_deref() != Some(&canonical)
            || session.generation != generation
        {
            return false;
        }

        if muted {
            if !session.rules.muted_issue_ids.contains(&issue_id) {
                session.rules.muted_issue_ids.push(issue_id);
            }
        } else {
            session.rules.muted_issue_ids.retain(|&id| id != issue_id);
        }
        true
    }

    pub fn set_issue_mute(&self, issue_id: i64, muted: bool) {
        let mut session = self.session.lock().unwrap();
        if muted {
            if !session.rules.muted_issue_ids.contains(&issue_id) {
                session.rules.muted_issue_ids.push(issue_id);
            }
        } else {
            session.rules.muted_issue_ids.retain(|&id| id != issue_id);
        }
    }

    pub fn set_focused_issue(&self, issue_id: Option<i64>) {
        *self.focused_issue_id.lock().unwrap() = issue_id;
    }

    pub fn clear_focus(&self) {
        *self.focused_issue_id.lock().unwrap() = None;
    }

    pub fn set_window_visible(&self, visible: bool) {
        self.window_visible.store(visible, Ordering::SeqCst);
    }

    pub fn set_window_focused(&self, focused: bool) {
        self.window_focused.store(focused, Ordering::SeqCst);
    }

    pub fn is_dnd_active_at_time(
        start_str: &Option<String>,
        end_str: &Option<String>,
        time_zone_str: &str,
        utc_now: chrono::DateTime<chrono::Utc>,
    ) -> bool {
        let (start_str, end_str) = match (start_str, end_str) {
            (Some(s), Some(e)) => (s, e),
            _ => return false,
        };

        let start = match NaiveTime::parse_from_str(start_str, "%H:%M") {
            Ok(t) => t,
            Err(_) => return false,
        };
        let end = match NaiveTime::parse_from_str(end_str, "%H:%M") {
            Ok(t) => t,
            Err(_) => return false,
        };

        let tz: chrono_tz::Tz = match time_zone_str.parse() {
            Ok(t) => t,
            Err(_) => {
                // Fail-open: Invalid IANA timezone logs diagnosis and does not activate DND
                eprintln!(
                    "Invalid IANA timezone '{}', DND will remain inactive (fail-open)",
                    time_zone_str
                );
                return false;
            }
        };

        let now_in_tz = utc_now.with_timezone(&tz);
        let now_time =
            match NaiveTime::from_hms_opt(now_in_tz.hour(), now_in_tz.minute(), now_in_tz.second())
            {
                Some(t) => t,
                None => return false,
            };

        if start <= end {
            now_time >= start && now_time <= end
        } else {
            now_time >= start || now_time <= end
        }
    }

    fn evaluate_rules_locked(
        &self,
        rules: &NotificationFilterRule,
        notification_type: &str,
        issue_id: Option<i64>,
        actor_id: Option<i64>,
    ) -> bool {
        if !rules.system_notifications_enabled {
            return false;
        }

        // Don't notify self (actor is current user)
        if let Some(actor) = actor_id {
            if actor == rules.current_user_id && rules.current_user_id > 0 {
                return false;
            }
        }

        // Don't notify if issue is muted (full mute set)
        if let Some(id) = issue_id {
            if rules.muted_issue_ids.contains(&id) {
                return false;
            }
        }

        // Suppress ONLY IF window is BOTH visible AND focused AND actively viewing that same issue
        if let Some(id) = issue_id {
            let is_visible = self.window_visible.load(Ordering::SeqCst);
            let is_focused = self.window_focused.load(Ordering::SeqCst);
            let focused = *self.focused_issue_id.lock().unwrap();
            if is_visible && is_focused && focused == Some(id) {
                return false;
            }
        }

        // Check DND with IANA timezone (fail-open if invalid)
        if rules.dnd_enabled
            && Self::is_dnd_active_at_time(
                &rules.dnd_start,
                &rules.dnd_end,
                &rules.time_zone,
                chrono::Utc::now(),
            )
        {
            return false;
        }

        // Explicit whitelist mapping. Unknown types default to NO alert (false)
        match notification_type {
            "ASSIGNED" => rules.assignment_enabled,
            "MENTIONED" => rules.mention_enabled,
            "STATE_CHANGED"
            | "YUNXIAO_COMMIT_CLOSED"
            | "YUNXIAO_COMMIT_REOPENED"
            | "YUNXIAO_MR_MERGED" => rules.status_enabled,
            "ASSIGNEES_CHANGED" => rules.assignee_enabled,
            "COMMENT" => rules.comment_enabled,
            "COMMENT_EDITED" => rules.comment_enabled,
            _ => false,
        }
    }

    pub fn should_notify(
        &self,
        notification_type: &str,
        issue_id: Option<i64>,
        actor_id: Option<i64>,
    ) -> bool {
        let session = self.session.lock().unwrap();
        if !session.ready {
            return false;
        }
        self.evaluate_rules_locked(&session.rules, notification_type, issue_id, actor_id)
    }

    pub fn evaluate_and_record_notification(
        &self,
        origin: &str,
        user_id: i64,
        generation: u64,
        notification_id: Option<i64>,
        notification_type: &str,
        issue_id: Option<i64>,
        actor_id: Option<i64>,
    ) -> bool {
        let canonical =
            crate::http::validate_server_url(origin).unwrap_or_else(|_| origin.to_string());

        let mut session = self.session.lock().unwrap();
        if !session.ready
            || session.origin.as_deref() != Some(&canonical)
            || session.user_id != user_id
            || session.generation != generation
        {
            return false;
        }

        if !self.evaluate_rules_locked(&session.rules, notification_type, issue_id, actor_id) {
            return false;
        }

        if let Some(id) = notification_id {
            if session.record_seen_notification(&canonical, user_id, id) {
                return false;
            }
        }

        true
    }

    pub fn send_notification(
        &self,
        app: &AppHandle,
        origin: &str,
        user_id: i64,
        generation: u64,
        notification_id: Option<i64>,
        notification_type: &str,
        message: &str,
        issue_id: Option<i64>,
        actor_id: Option<i64>,
    ) {
        let title = match notification_type {
            "ASSIGNED" => "指派提醒",
            "MENTIONED" => "提及提醒",
            "STATE_CHANGED"
            | "YUNXIAO_COMMIT_CLOSED"
            | "YUNXIAO_COMMIT_REOPENED"
            | "YUNXIAO_MR_MERGED" => "状态变化",
            "ASSIGNEES_CHANGED" => "负责人变动",
            "COMMENT" => "新评论提醒",
            "COMMENT_EDITED" => "评论已编辑",
            _ => return,
        };

        // Context check, rules evaluation, and dedupe registration happen atomically in single lock domain
        let should_send = self.evaluate_and_record_notification(
            origin,
            user_id,
            generation,
            notification_id,
            notification_type,
            issue_id,
            actor_id,
        );

        if !should_send {
            return;
        }

        // Send system notification WITHOUT holding the session lock
        let _ = app
            .notification()
            .builder()
            .title(title)
            .body(message)
            .show();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn sample_preferences() -> DesktopPreferenceData {
        DesktopPreferenceData {
            system_notifications_enabled: true,
            assignment_notifications_enabled: true,
            mention_notifications_enabled: true,
            status_notifications_enabled: true,
            assignee_notifications_enabled: true,
            comment_notifications_enabled: true,
            do_not_disturb_enabled: false,
            do_not_disturb_start: None,
            do_not_disturb_end: None,
            time_zone: "Asia/Shanghai".to_string(),
            recently_closed_days: 7,
            updated_at: "2026-08-31T12:00:00.000Z".to_string(),
        }
    }

    #[test]
    fn test_readiness_failure_and_session_lifecycle() {
        let manager = NotificationManager::new();
        let prefs = sample_preferences();

        // 1. Initially not ready -> all notifications must be suppressed
        assert_eq!(manager.is_ready(), false);
        assert_eq!(manager.should_notify("ASSIGNED", Some(1), Some(20)), false);

        // 2. Activate session for Server A, user 10, gen 1
        manager.activate_session("https://server-a.example.com", 10, 1, &prefs, vec![99]);
        assert_eq!(manager.is_ready(), true);
        assert_eq!(manager.should_notify("ASSIGNED", Some(1), Some(20)), true);
        // Muted issue 99 is suppressed
        assert_eq!(manager.should_notify("ASSIGNED", Some(99), Some(20)), false);

        // 3. Mark not ready (e.g. reconnecting or transient fetch failure)
        manager.set_not_ready();
        assert_eq!(manager.is_ready(), false);
        assert_eq!(manager.should_notify("ASSIGNED", Some(1), Some(20)), false);

        // 4. Reset context (e.g. logout)
        manager.reset_context();
        assert_eq!(manager.is_ready(), false);
        assert_eq!(manager.session.lock().unwrap().user_id, 0);
    }

    #[test]
    fn test_cross_origin_deduplication_isolation() {
        let manager = NotificationManager::new();
        let prefs = sample_preferences();

        // Activate Server A, User 1
        manager.activate_session("https://server-a.example.com", 1, 1, &prefs, vec![]);

        // Notification 500 on Server A, User 1 -> first time is unseen (false)
        assert_eq!(
            manager.check_and_record_seen_notification("https://server-a.example.com", 1, 500),
            false
        );
        // Duplicate on Server A, User 1 -> seen (true)
        assert_eq!(
            manager.check_and_record_seen_notification("https://server-a.example.com", 1, 500),
            true
        );

        // Switch context to Server B, User 2
        manager.activate_session("https://server-b.example.com", 2, 1, &prefs, vec![]);

        // Notification 500 on Server B MUST NOT be killed by Server A's history!
        assert_eq!(
            manager.check_and_record_seen_notification("https://server-b.example.com", 2, 500),
            false
        );
        assert_eq!(
            manager.check_and_record_seen_notification("https://server-b.example.com", 2, 500),
            true
        );

        // Reconnect within the same context (Server B, User 2, Gen 2) -> preserves dedupe
        manager.activate_session("https://server-b.example.com", 2, 2, &prefs, vec![]);
        assert_eq!(
            manager.check_and_record_seen_notification("https://server-b.example.com", 2, 500),
            true
        );
    }

    #[test]
    fn test_old_generation_and_wrong_source_preferences_rejection() {
        let manager = NotificationManager::new();
        let mut prefs_v1 = sample_preferences();
        prefs_v1.comment_notifications_enabled = false;

        // Activate Server A, User 1, Gen 2
        manager.activate_session("https://server-a.example.com", 1, 2, &prefs_v1, vec![]);
        assert_eq!(manager.should_notify("COMMENT", Some(1), Some(20)), false);

        // Late response from Gen 1 arrives -> must be REJECTED and return false
        let mut late_prefs = sample_preferences();
        late_prefs.comment_notifications_enabled = true;
        let updated = manager.update_preferences_for_generation(
            "https://server-a.example.com",
            1,
            &late_prefs,
        );
        assert_eq!(updated, false);
        // State remains false
        assert_eq!(manager.should_notify("COMMENT", Some(1), Some(20)), false);

        // Late response from wrong source arrives -> must be REJECTED
        let updated_src = manager.update_preferences_for_generation(
            "https://server-b.example.com",
            2,
            &late_prefs,
        );
        assert_eq!(updated_src, false);
        assert_eq!(manager.should_notify("COMMENT", Some(1), Some(20)), false);

        // Valid generation 2 response from Server A -> accepted
        let updated_valid = manager.update_preferences_for_generation(
            "https://server-a.example.com",
            2,
            &late_prefs,
        );
        assert_eq!(updated_valid, true);
        assert_eq!(manager.should_notify("COMMENT", Some(1), Some(20)), true);
    }

    #[test]
    fn test_invalid_iana_timezone_fails_open() {
        let start = Some("00:00".to_string());
        let end = Some("23:59".to_string());
        let utc_now = chrono::Utc::now();

        // Valid timezone inside range -> DND active (true)
        assert!(NotificationManager::is_dnd_active_at_time(
            &start,
            &end,
            "Asia/Shanghai",
            utc_now
        ));

        // Invalid timezone -> MUST FAIL-OPEN (false), NOT fall back to UTC
        assert_eq!(
            NotificationManager::is_dnd_active_at_time(&start, &end, "Invalid/Unknown_TZ", utc_now),
            false
        );
        assert_eq!(
            NotificationManager::is_dnd_active_at_time(&start, &end, "GMT+99:00", utc_now),
            false
        );
    }

    #[test]
    fn test_dnd_time_range_with_iana_timezones() {
        let start = Some("22:00".to_string());
        let end = Some("07:00".to_string());

        // 2026-08-31 15:30:00 UTC
        // In Asia/Shanghai (UTC+8): 23:30:00 -> Inside DND [22:00 .. 07:00]
        let utc_15_30 = chrono::Utc
            .with_ymd_and_hms(2026, 8, 31, 15, 30, 0)
            .unwrap();
        assert!(NotificationManager::is_dnd_active_at_time(
            &start,
            &end,
            "Asia/Shanghai",
            utc_15_30
        ));

        // In America/New_York (UTC-4 in August): 11:30:00 -> Outside DND [22:00 .. 07:00]
        assert!(!NotificationManager::is_dnd_active_at_time(
            &start,
            &end,
            "America/New_York",
            utc_15_30
        ));

        // In Europe/London (UTC+1 in August): 16:30:00 -> Outside DND [22:00 .. 07:00]
        assert!(!NotificationManager::is_dnd_active_at_time(
            &start,
            &end,
            "Europe/London",
            utc_15_30
        ));

        // Boundary exact minute tests
        // 2026-08-31 14:00:00 UTC in Asia/Shanghai is exactly 22:00:00 -> Inside DND
        let utc_22_00 = chrono::Utc.with_ymd_and_hms(2026, 8, 31, 14, 0, 0).unwrap();
        assert!(NotificationManager::is_dnd_active_at_time(
            &start,
            &end,
            "Asia/Shanghai",
            utc_22_00
        ));

        // 2026-08-31 23:00:00 UTC in Asia/Shanghai is exactly 07:00:00 -> Inside DND
        let utc_07_00 = chrono::Utc.with_ymd_and_hms(2026, 8, 31, 23, 0, 0).unwrap();
        assert!(NotificationManager::is_dnd_active_at_time(
            &start,
            &end,
            "Asia/Shanghai",
            utc_07_00
        ));

        // 2026-08-31 23:01:00 UTC in Asia/Shanghai is 07:01:00 -> Outside DND
        let utc_07_01 = chrono::Utc.with_ymd_and_hms(2026, 8, 31, 23, 1, 0).unwrap();
        assert!(!NotificationManager::is_dnd_active_at_time(
            &start,
            &end,
            "Asia/Shanghai",
            utc_07_01
        ));

        let none_range =
            NotificationManager::is_dnd_active_at_time(&None, &None, "Asia/Shanghai", utc_15_30);
        assert_eq!(none_range, false);
    }

    #[test]
    fn test_whitelist_and_unknown_rejection() {
        let manager = NotificationManager::new();
        let mut prefs = sample_preferences();
        prefs.comment_notifications_enabled = false;
        manager.activate_session("https://server-a.example.com", 10, 1, &prefs, vec![]);

        // Unknown notification types MUST be rejected
        assert_eq!(
            manager.should_notify("UNKNOWN_TYPE", Some(1), Some(20)),
            false
        );
        assert_eq!(
            manager.should_notify("SYSTEM_ANNOUNCEMENT", Some(1), Some(20)),
            false
        );
        assert_eq!(
            manager.should_notify("PROJECT_UPDATED", None, Some(20)),
            false
        );
        assert_eq!(
            manager.should_notify("issue.changed", Some(1), Some(20)),
            false
        );

        // Whitelisted types should pass
        assert_eq!(manager.should_notify("ASSIGNED", Some(1), Some(20)), true);
        assert_eq!(manager.should_notify("MENTIONED", Some(1), Some(20)), true);
        assert_eq!(
            manager.should_notify("STATE_CHANGED", Some(1), Some(20)),
            true
        );
        assert_eq!(
            manager.should_notify("YUNXIAO_COMMIT_CLOSED", Some(1), Some(20)),
            true
        );
        assert_eq!(
            manager.should_notify("YUNXIAO_COMMIT_REOPENED", Some(1), Some(20)),
            true
        );
        assert_eq!(
            manager.should_notify("YUNXIAO_MR_MERGED", Some(1), Some(20)),
            true
        );
        assert_eq!(
            manager.should_notify("ASSIGNEES_CHANGED", Some(1), Some(20)),
            true
        );
    }

    #[test]
    fn test_comment_default_disabled_and_toggled() {
        let manager = NotificationManager::new();
        let mut prefs = sample_preferences();
        prefs.comment_notifications_enabled = false;
        manager.activate_session("https://server-a.example.com", 10, 1, &prefs, vec![]);

        // Default comment_enabled is false
        assert_eq!(manager.should_notify("COMMENT", Some(1), Some(20)), false);
        assert_eq!(
            manager.should_notify("COMMENT_EDITED", Some(1), Some(20)),
            false
        );

        // Enable comments
        prefs.comment_notifications_enabled = true;
        manager.update_preferences_for_generation("https://server-a.example.com", 1, &prefs);
        assert_eq!(manager.should_notify("COMMENT", Some(1), Some(20)), true);
        assert_eq!(
            manager.should_notify("COMMENT_EDITED", Some(1), Some(20)),
            true
        );
    }

    #[test]
    fn test_mute_outside_overview_and_focus_visibility_combinations() {
        let manager = NotificationManager::new();
        let prefs = sample_preferences();
        manager.activate_session("https://server-a.example.com", 10, 1, &prefs, vec![9999]);

        // Muted issue 9999 (even if outside overview) is suppressed
        assert_eq!(
            manager.should_notify("ASSIGNED", Some(9999), Some(20)),
            false
        );

        // Set focused issue #200
        manager.set_focused_issue(Some(200));

        // Case 1: Visible = true, Focused = true -> Suppress notification for #200
        manager.set_window_visible(true);
        manager.set_window_focused(true);
        assert_eq!(
            manager.should_notify("ASSIGNED", Some(200), Some(20)),
            false
        );
        // Other issue #201 is NOT suppressed
        assert_eq!(manager.should_notify("ASSIGNED", Some(201), Some(20)), true);

        // Case 2: Visible = false (hidden in dock/tray), Focused = true -> MUST NOT suppress!
        manager.set_window_visible(false);
        manager.set_window_focused(true);
        assert_eq!(manager.should_notify("ASSIGNED", Some(200), Some(20)), true);

        // Case 3: Visible = true, Focused = false (blurred/inactive window) -> MUST NOT suppress!
        manager.set_window_visible(true);
        manager.set_window_focused(false);
        assert_eq!(manager.should_notify("ASSIGNED", Some(200), Some(20)), true);

        // Case 4: Clear focus
        manager.set_window_visible(true);
        manager.set_window_focused(true);
        manager.clear_focus();
        assert_eq!(manager.should_notify("ASSIGNED", Some(200), Some(20)), true);
    }

    #[test]
    fn test_same_origin_different_user_and_gen_discards_stale_responses() {
        let manager = NotificationManager::new();
        let mut prefs_u1 = sample_preferences();
        prefs_u1.comment_notifications_enabled = false;

        // 1. Activate origin for user 1, generation 1
        manager.activate_session("https://server-a.example.com", 1, 1, &prefs_u1, vec![101]);
        assert_eq!(
            manager.context_snapshot("https://server-a.example.com"),
            Some((1, 1))
        );
        assert_eq!(manager.should_notify("COMMENT", Some(10), Some(20)), false);
        assert_eq!(
            manager.should_notify("ASSIGNED", Some(101), Some(20)),
            false
        ); // 101 is muted

        // 2. Switch same origin to user 2, generation 2
        let mut prefs_u2 = sample_preferences();
        prefs_u2.comment_notifications_enabled = true;
        manager.activate_session("https://server-a.example.com", 2, 2, &prefs_u2, vec![]);
        assert_eq!(
            manager.context_snapshot("https://server-a.example.com"),
            Some((2, 2))
        );
        assert_eq!(manager.should_notify("COMMENT", Some(10), Some(20)), true);
        assert_eq!(manager.should_notify("ASSIGNED", Some(101), Some(20)), true); // 101 is NOT muted for user 2

        // 3. Stale prefs response for user 1 (gen 1) arrives -> rejected, does not overwrite user 2
        let mut late_prefs = sample_preferences();
        late_prefs.comment_notifications_enabled = false;
        let prefs_res = manager.update_preferences_for_context(
            "https://server-a.example.com",
            1,
            1,
            &late_prefs,
        );
        assert_eq!(prefs_res, false);
        assert_eq!(manager.should_notify("COMMENT", Some(10), Some(20)), true);

        // 4. Stale mute request for user 1 (gen 1) arrives -> rejected, does not mute 101 for user 2
        let mute_res =
            manager.set_issue_mute_for_context("https://server-a.example.com", 1, 1, 101, true);
        assert_eq!(mute_res, false);
        assert_eq!(manager.should_notify("ASSIGNED", Some(101), Some(20)), true);
    }

    #[test]
    fn test_old_generation_not_ready_does_not_close_new_generation() {
        let manager = NotificationManager::new();
        let prefs = sample_preferences();

        // Activate generation 2
        manager.activate_session("https://server-a.example.com", 1, 2, &prefs, vec![]);
        assert_eq!(manager.is_ready(), true);

        // Generation 1 cleanup finishes and calls set_not_ready_for_generation with gen 1
        let res = manager.set_not_ready_for_generation("https://server-a.example.com", 1);
        assert_eq!(res, false);
        assert_eq!(manager.is_ready(), true); // Gen 2 is STILL ready!

        // Generation 2 cleanup calls set_not_ready_for_generation with gen 2 -> accepted
        let res2 = manager.set_not_ready_for_generation("https://server-a.example.com", 2);
        assert_eq!(res2, true);
        assert_eq!(manager.is_ready(), false);
    }

    #[test]
    fn test_concurrent_interleaving_prevents_cross_account_rule_pollution() {
        use std::sync::Arc;
        use std::thread;

        let manager = Arc::new(NotificationManager::new());
        let mut prefs_a = sample_preferences();
        prefs_a.comment_notifications_enabled = false;

        let mut prefs_b = sample_preferences();
        prefs_b.comment_notifications_enabled = true;

        // Run 50 iterations of high-concurrency races
        for _ in 0..50 {
            // Activate Session A
            manager.activate_session("https://server-a.example.com", 1, 1, &prefs_a, vec![100]);

            let mgr_b = manager.clone();
            let p_b = prefs_b.clone();
            let h1 = thread::spawn(move || {
                // Thread 1: Activates Session B
                mgr_b.activate_session("https://server-b.example.com", 2, 2, &p_b, vec![]);
            });

            let mgr_a = manager.clone();
            let mut late_prefs_a = sample_preferences();
            late_prefs_a.comment_notifications_enabled = false;
            let h2 = thread::spawn(move || {
                // Thread 2: Late update for Session A tries to write old preferences / mute
                mgr_a.update_preferences_for_context(
                    "https://server-a.example.com",
                    1,
                    1,
                    &late_prefs_a,
                );
                mgr_a.set_issue_mute_for_context("https://server-a.example.com", 1, 1, 100, true);
            });

            h1.join().unwrap();
            h2.join().unwrap();

            // After thread 1 activated Session B:
            // If the current session is B (gen 2), its comment_notifications_enabled MUST be true
            // and muted issue 100 from A MUST NOT be in B's rules!
            if let Some((user_id, gen)) = manager.context_snapshot("https://server-b.example.com") {
                assert_eq!(user_id, 2);
                assert_eq!(gen, 2);
                assert_eq!(manager.should_notify("COMMENT", Some(1), Some(999)), true);
                assert_eq!(
                    manager.should_notify("ASSIGNED", Some(100), Some(999)),
                    true
                );
            }
        }
    }

    #[test]
    fn test_concurrent_late_session_a_cannot_pollute_b_dedupe_or_send() {
        use std::sync::Arc;
        use std::thread;

        let manager = Arc::new(NotificationManager::new());
        let prefs_a = sample_preferences();
        let prefs_b = sample_preferences();

        for _ in 0..50 {
            manager.activate_session("https://server-a.example.com", 1, 1, &prefs_a, vec![]);

            let mgr_b = manager.clone();
            let p_b = prefs_b.clone();
            let h_switch = thread::spawn(move || {
                mgr_b.activate_session("https://server-b.example.com", 2, 2, &p_b, vec![]);
            });

            let mgr_a = manager.clone();
            let h_late = thread::spawn(move || {
                mgr_a.evaluate_and_record_notification(
                    "https://server-a.example.com",
                    1,
                    1,
                    Some(888),
                    "ASSIGNED",
                    Some(10),
                    Some(999),
                )
            });

            h_switch.join().unwrap();
            let _late_allowed = h_late.join().unwrap();

            // After thread switch to B:
            if let Some((uid, gen)) = manager.context_snapshot("https://server-b.example.com") {
                assert_eq!(uid, 2);
                assert_eq!(gen, 2);
                // Notification 888 on Session B MUST NOT have been marked as seen by A!
                assert_eq!(
                    manager.check_and_record_seen_notification(
                        "https://server-b.example.com",
                        2,
                        888
                    ),
                    false
                );
            }
        }
    }

    #[test]
    fn test_mute_and_disable_prevents_old_decision_leak() {
        let manager = NotificationManager::new();
        let mut prefs = sample_preferences();
        prefs.system_notifications_enabled = true;
        manager.activate_session("https://server-a.example.com", 1, 1, &prefs, vec![]);

        // 1. Initially allowed
        assert_eq!(
            manager.evaluate_and_record_notification(
                "https://server-a.example.com",
                1,
                1,
                Some(101),
                "ASSIGNED",
                Some(50),
                Some(999)
            ),
            true
        );

        // 2. Mute issue 50
        manager.set_issue_mute_for_context("https://server-a.example.com", 1, 1, 50, true);

        // Notification for muted issue 50 is rejected and DOES NOT record dedupe for 102
        assert_eq!(
            manager.evaluate_and_record_notification(
                "https://server-a.example.com",
                1,
                1,
                Some(102),
                "ASSIGNED",
                Some(50),
                Some(999)
            ),
            false
        );

        // Unmute issue 50
        manager.set_issue_mute_for_context("https://server-a.example.com", 1, 1, 50, false);

        // Now notification 102 is allowed (was NOT consumed when muted!)
        assert_eq!(
            manager.evaluate_and_record_notification(
                "https://server-a.example.com",
                1,
                1,
                Some(102),
                "ASSIGNED",
                Some(50),
                Some(999)
            ),
            true
        );

        // 3. Disable system notifications
        prefs.system_notifications_enabled = false;
        manager.update_preferences_for_context("https://server-a.example.com", 1, 1, &prefs);

        // Notification 103 rejected and DOES NOT record dedupe
        assert_eq!(
            manager.evaluate_and_record_notification(
                "https://server-a.example.com",
                1,
                1,
                Some(103),
                "ASSIGNED",
                Some(50),
                Some(999)
            ),
            false
        );

        // Re-enable notifications
        prefs.system_notifications_enabled = true;
        manager.update_preferences_for_context("https://server-a.example.com", 1, 1, &prefs);

        // Notification 103 is allowed now
        assert_eq!(
            manager.evaluate_and_record_notification(
                "https://server-a.example.com",
                1,
                1,
                Some(103),
                "ASSIGNED",
                Some(50),
                Some(999)
            ),
            true
        );
    }
}
