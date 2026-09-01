use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppConfig {
    pub server_url: String,
    pub global_shortcut: String,
    pub launch_at_login: bool,
    pub pinned: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server_url: "http://localhost:3101".to_string(),
            global_shortcut: "Alt+CommandOrControl+I".to_string(),
            launch_at_login: false,
            pinned: false,
        }
    }
}

pub struct ConfigManager {
    config_path: PathBuf,
    current: Mutex<AppConfig>,
}

impl ConfigManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let config_path = app_data_dir.join("config.json");
        let initial_config = if config_path.exists() {
            match fs::read_to_string(&config_path) {
                Ok(data) => match serde_json::from_str::<AppConfig>(&data) {
                    Ok(cfg) => cfg,
                    Err(e) => {
                        eprintln!(
                            "Corrupted config.json encountered (parse error: {}), creating .corrupt backup",
                            e
                        );
                        let corrupt_path = app_data_dir.join("config.json.corrupt");
                        let _ = fs::copy(&config_path, &corrupt_path);
                        AppConfig::default()
                    }
                },
                Err(e) => {
                    eprintln!("Failed to read config.json ({}), using defaults", e);
                    AppConfig::default()
                }
            }
        } else {
            AppConfig::default()
        };

        Self {
            config_path,
            current: Mutex::new(initial_config),
        }
    }

    pub fn get(&self) -> AppConfig {
        self.current.lock().unwrap().clone()
    }

    pub fn update<F>(&self, update_fn: F) -> Result<AppConfig, String>
    where
        F: FnOnce(&mut AppConfig),
    {
        // 1. Lock mutex across the ENTIRE sequence: clone -> mutate -> write unique temp file -> flush -> sync -> atomic rename -> update *current
        let mut current = self.current.lock().unwrap();
        let mut next_config = current.clone();

        // 2. Mutate cloned config
        update_fn(&mut next_config);

        // 3. Ensure parent directory exists
        if let Some(parent) = self.config_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        // 4. Serialize
        let serialized = serde_json::to_string_pretty(&next_config).map_err(|e| e.to_string())?;

        // 5. Atomic write with unique temp path in same directory
        let temp_file_name = format!(
            "config.json.tmp.{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        let temp_path = match self.config_path.parent() {
            Some(p) => p.join(temp_file_name),
            None => self.config_path.with_extension("json.tmp"),
        };

        let write_res = (|| -> Result<(), std::io::Error> {
            let mut file = fs::File::create(&temp_path)?;
            file.write_all(serialized.as_bytes())?;
            file.flush()?;
            file.sync_all()?;
            fs::rename(&temp_path, &self.config_path)?;
            Ok(())
        })();

        if let Err(e) = write_res {
            let _ = fs::remove_file(&temp_path);
            return Err(e.to_string());
        }

        // 6. Only after atomic persistence succeeds, update in-memory state
        *current = next_config.clone();

        Ok(next_config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;
    use tempfile::tempdir;

    #[test]
    fn test_config_defaults_and_update() {
        let dir = tempdir().unwrap();
        let manager = ConfigManager::new(dir.path().to_path_buf());
        let config = manager.get();
        assert_eq!(config.server_url, "http://localhost:3101");
        assert_eq!(config.pinned, false);

        let updated = manager
            .update(|c| {
                c.pinned = true;
                c.server_url = "https://issueflow.example.com".to_string();
            })
            .unwrap();

        assert_eq!(updated.pinned, true);
        assert_eq!(updated.server_url, "https://issueflow.example.com");

        // Reload to verify persistence
        let reloaded = ConfigManager::new(dir.path().to_path_buf());
        assert_eq!(reloaded.get().pinned, true);
        assert_eq!(reloaded.get().server_url, "https://issueflow.example.com");
    }

    #[test]
    fn test_config_concurrent_updates_no_loss() {
        let dir = tempdir().unwrap();
        let manager = Arc::new(ConfigManager::new(dir.path().to_path_buf()));

        let mut handles = Vec::new();
        for i in 0..10 {
            let mgr = manager.clone();
            handles.push(thread::spawn(move || {
                let _ = mgr.update(|c| {
                    c.server_url = format!("https://server-{}.example.com", i);
                    c.pinned = i % 2 == 0;
                });
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        // Must match on-disk content without corruption
        let final_mem = manager.get();
        let reloaded = ConfigManager::new(dir.path().to_path_buf());
        assert_eq!(final_mem, reloaded.get());
    }

    #[test]
    fn test_config_corrupt_file_backup() {
        let dir = tempdir().unwrap();
        let config_file = dir.path().join("config.json");
        fs::write(&config_file, b"NOT_VALID_JSON{{{").unwrap();

        let manager = ConfigManager::new(dir.path().to_path_buf());
        let config = manager.get();
        // Fallback to default
        assert_eq!(config.server_url, "http://localhost:3101");

        // Verify .corrupt file was preserved
        let corrupt_file = dir.path().join("config.json.corrupt");
        assert!(corrupt_file.exists());
        assert_eq!(
            fs::read_to_string(&corrupt_file).unwrap(),
            "NOT_VALID_JSON{{{"
        );

        // Can successfully update after corruption recovery
        let updated = manager
            .update(|c| {
                c.server_url = "https://fixed.issueflow.dev".to_string();
            })
            .unwrap();
        assert_eq!(updated.server_url, "https://fixed.issueflow.dev");
    }

    #[test]
    fn test_config_update_failure_preserves_in_memory_state() {
        let dir = tempdir().unwrap();
        let manager = ConfigManager::new(dir.path().to_path_buf());

        // First successful update
        manager
            .update(|c| {
                c.server_url = "https://initial.example.com".to_string();
                c.pinned = true;
            })
            .unwrap();
        assert_eq!(manager.get().server_url, "https://initial.example.com");
        assert_eq!(manager.get().pinned, true);

        // Now create a scenario where write fails by pointing config_path to a file as a directory
        let bad_file = dir.path().join("blocking_file");
        fs::write(&bad_file, b"cannot be a directory").unwrap();
        let broken_path = bad_file.join("sub").join("config.json");

        let broken_manager = ConfigManager {
            config_path: broken_path,
            current: Mutex::new(manager.get()),
        };

        // Attempt update which will fail at file write/creation
        let res = broken_manager.update(|c| {
            c.server_url = "https://should-fail.example.com".to_string();
            c.pinned = false;
        });

        assert!(res.is_err());
        // In-memory state MUST remain unchanged!
        let retained = broken_manager.get();
        assert_eq!(retained.server_url, "https://initial.example.com");
        assert_eq!(retained.pinned, true);
    }
}
