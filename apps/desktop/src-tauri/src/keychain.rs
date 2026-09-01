use keyring::Entry;

const SERVICE_NAME: &str = "com.issueflow.desktop";

pub fn account_for_server(server_url: &str) -> Result<String, String> {
    let normalized = crate::http::validate_server_url(server_url)?;
    Ok(format!("token:{}", normalized))
}

pub fn save_token(server_url: &str, token: &str) -> Result<(), String> {
    let account = account_for_server(server_url)?;
    let entry = Entry::new(SERVICE_NAME, &account).map_err(|e| e.to_string())?;
    entry.set_password(token).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_token(server_url: &str) -> Result<Option<String>, String> {
    let account = account_for_server(server_url)?;
    let entry =
        Entry::new(SERVICE_NAME, &account).map_err(|e| format!("Keychain entry error: {}", e))?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Keychain access error: {}", e)),
    }
}

pub fn delete_token(server_url: &str) -> Result<(), String> {
    let account = account_for_server(server_url)?;
    let entry =
        Entry::new(SERVICE_NAME, &account).map_err(|e| format!("Keychain entry error: {}", e))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Keychain deletion error: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_account_derivation_isolation() {
        let acc1 = account_for_server("https://app1.issueflow.dev").unwrap();
        let acc2 = account_for_server("https://app2.issueflow.dev").unwrap();
        let acc1_trailing = account_for_server("https://app1.issueflow.dev/").unwrap();
        let acc1_upper_port = account_for_server("https://APP1.IssueFlow.Dev:443/").unwrap();

        assert_eq!(acc1, "token:https://app1.issueflow.dev");
        assert_eq!(acc2, "token:https://app2.issueflow.dev");
        assert_ne!(acc1, acc2);
        assert_eq!(acc1, acc1_trailing);
        assert_eq!(acc1, acc1_upper_port);
    }

    #[test]
    fn test_invalid_server_url_rejected_for_account() {
        assert!(account_for_server("https://user:pass@example.com").is_err());
        assert!(account_for_server("invalid url").is_err());
        assert!(account_for_server("https://example.com?query=1").is_err());
    }
}
