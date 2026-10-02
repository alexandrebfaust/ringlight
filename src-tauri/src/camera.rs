//! Detects whether any app is using the webcam.
//!
//! Windows records every camera use under
//! `HKCU\...\CapabilityAccessManager\ConsentStore\webcam`: packaged apps sit
//! directly under that key and the rest under `NonPackaged\<exe path>`.
//! While the camera is in use, `LastUsedTimeStop` is 0.

#[cfg(windows)]
pub fn in_use() -> bool {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    const PATH: &str =
        r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam";

    fn active(key: &RegKey) -> bool {
        let start: u64 = key.get_value("LastUsedTimeStart").unwrap_or(0);
        let stop: u64 = key.get_value("LastUsedTimeStop").unwrap_or(1);
        start != 0 && stop == 0
    }

    let Ok(root) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(PATH) else {
        return false;
    };
    root.enum_keys().flatten().any(|name| {
        let Ok(sub) = root.open_subkey(&name) else {
            return false;
        };
        if name == "NonPackaged" {
            sub.enum_keys()
                .flatten()
                .any(|exe| sub.open_subkey(&exe).is_ok_and(|k| active(&k)))
        } else {
            active(&sub)
        }
    })
}

#[cfg(not(windows))]
pub fn in_use() -> bool {
    false
}
