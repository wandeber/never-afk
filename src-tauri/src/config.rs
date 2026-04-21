use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Wry};
use tauri_plugin_store::StoreExt;

pub const CONFIG_STORE_PATH: &str = "settings.json";
const CONFIG_STORE_KEY: &str = "app-config";

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlatformKind {
    Macos,
    Windows,
    Unsupported,
}

impl PlatformKind {
    pub fn name(self) -> &'static str {
        match self {
            Self::Macos => "macOS",
            Self::Windows => "Windows",
            Self::Unsupported => "Unsupported",
        }
    }

    pub fn custom_input_label(self) -> &'static str {
        match self {
            Self::Macos => "macOS key code",
            Self::Windows => "Windows virtual-key code",
            Self::Unsupported => "Platform-specific key code",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ActivityMethod {
    Keyboard,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SafeKeyPreset {
    #[serde(rename = "F13")]
    F13,
    #[serde(rename = "F14")]
    F14,
    #[serde(rename = "F15")]
    F15,
    #[serde(rename = "F16")]
    F16,
    #[serde(rename = "F17")]
    F17,
    #[serde(rename = "F18")]
    F18,
    #[serde(rename = "F19")]
    F19,
    #[serde(rename = "F20")]
    F20,
    #[serde(rename = "F21")]
    F21,
    #[serde(rename = "F22")]
    F22,
    #[serde(rename = "F23")]
    F23,
    #[serde(rename = "F24")]
    F24,
}

impl SafeKeyPreset {
    pub const ALL: [Self; 12] = [
        Self::F13,
        Self::F14,
        Self::F15,
        Self::F16,
        Self::F17,
        Self::F18,
        Self::F19,
        Self::F20,
        Self::F21,
        Self::F22,
        Self::F23,
        Self::F24,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::F13 => "F13",
            Self::F14 => "F14",
            Self::F15 => "F15",
            Self::F16 => "F16",
            Self::F17 => "F17",
            Self::F18 => "F18",
            Self::F19 => "F19",
            Self::F20 => "F20",
            Self::F21 => "F21",
            Self::F22 => "F22",
            Self::F23 => "F23",
            Self::F24 => "F24",
        }
    }

    pub fn supported_on(self, platform: PlatformKind) -> bool {
        match platform {
            // Carbon only exposes virtual key codes up to F20. We keep F21-F24 available
            // for Windows and for explicit custom mappings, but we do not guess undocumented
            // macOS key codes because this project should prefer boring correctness.
            PlatformKind::Macos => !matches!(self, Self::F21 | Self::F22 | Self::F23 | Self::F24),
            PlatformKind::Windows => true,
            PlatformKind::Unsupported => false,
        }
    }

    pub fn macos_key_code(self) -> Option<u16> {
        match self {
            Self::F13 => Some(0x69),
            Self::F14 => Some(0x6B),
            Self::F15 => Some(0x71),
            Self::F16 => Some(0x6A),
            Self::F17 => Some(0x40),
            Self::F18 => Some(0x4F),
            Self::F19 => Some(0x50),
            Self::F20 => Some(0x5A),
            Self::F21 | Self::F22 | Self::F23 | Self::F24 => None,
        }
    }

    pub fn windows_virtual_key(self) -> u16 {
        match self {
            Self::F13 => 0x7C,
            Self::F14 => 0x7D,
            Self::F15 => 0x7E,
            Self::F16 => 0x7F,
            Self::F17 => 0x80,
            Self::F18 => 0x81,
            Self::F19 => 0x82,
            Self::F20 => 0x83,
            Self::F21 => 0x84,
            Self::F22 => 0x85,
            Self::F23 => 0x86,
            Self::F24 => 0x87,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformKeyMapping {
    pub macos_key_code: Option<u16>,
    pub windows_virtual_key_code: Option<u16>,
    pub hid_usage_code: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub enabled: bool,
    pub quiet_period_seconds: u64,
    pub idle_confirmation_period_seconds: u64,
    pub start_at_login: bool,
    pub activity_method: ActivityMethod,
    pub selected_key: SafeKeyPreset,
    pub custom_input_enabled: bool,
    pub custom_input_value: Option<u16>,
    pub platform_key_mapping: PlatformKeyMapping,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            quiet_period_seconds: 120,
            idle_confirmation_period_seconds: 120,
            start_at_login: false,
            activity_method: ActivityMethod::Keyboard,
            selected_key: SafeKeyPreset::F15,
            custom_input_enabled: false,
            custom_input_value: None,
            platform_key_mapping: PlatformKeyMapping::default(),
        }
    }
}

impl AppConfig {
    pub fn validate_and_normalize(mut self, platform: PlatformKind) -> Result<Self, String> {
        if self.quiet_period_seconds == 0 {
            return Err("Quiet period must be greater than zero seconds.".into());
        }

        if self.idle_confirmation_period_seconds == 0 {
            return Err("Idle confirmation period must be greater than zero seconds.".into());
        }

        if self.custom_input_enabled {
            let current_platform_code = self.custom_input_value.ok_or_else(|| {
                format!(
                    "Custom input is enabled, so {} is required.",
                    platform.custom_input_label()
                )
            })?;

            match platform {
                PlatformKind::Macos => {
                    self.platform_key_mapping.macos_key_code = Some(current_platform_code);
                }
                PlatformKind::Windows => {
                    self.platform_key_mapping.windows_virtual_key_code = Some(current_platform_code);
                }
                PlatformKind::Unsupported => {}
            }
        } else {
            self.custom_input_value = None;
            if !self.selected_key.supported_on(platform) {
                return Err(format!(
                    "{} is not available as a built-in safe key on {}. Use a custom platform code instead.",
                    self.selected_key.label(),
                    platform.name()
                ));
            }
        }

        Ok(self)
    }

    pub fn resolved_input(&self, platform: PlatformKind) -> Result<ResolvedKeyboardInput, String> {
        if self.custom_input_enabled {
            let display_label = format!(
                "{} {}",
                platform.custom_input_label(),
                self.custom_input_value.unwrap_or_default()
            );

            let resolved = match platform {
                PlatformKind::Macos => ResolvedKeyboardInput {
                    display_label,
                    macos_key_code: self
                        .platform_key_mapping
                        .macos_key_code
                        .or(self.custom_input_value),
                    windows_virtual_key_code: None,
                    hid_usage_code: self.platform_key_mapping.hid_usage_code,
                },
                PlatformKind::Windows => ResolvedKeyboardInput {
                    display_label,
                    macos_key_code: None,
                    windows_virtual_key_code: self
                        .platform_key_mapping
                        .windows_virtual_key_code
                        .or(self.custom_input_value),
                    hid_usage_code: self.platform_key_mapping.hid_usage_code,
                },
                PlatformKind::Unsupported => ResolvedKeyboardInput {
                    display_label,
                    macos_key_code: None,
                    windows_virtual_key_code: None,
                    hid_usage_code: self.platform_key_mapping.hid_usage_code,
                },
            };

            return if resolved.current_platform_code(platform).is_some() {
                Ok(resolved)
            } else {
                Err(format!(
                    "The current configuration does not include a {} value.",
                    platform.custom_input_label()
                ))
            };
        }

        if !self.selected_key.supported_on(platform) {
            return Err(format!(
                "{} is not available on {} without a custom platform code.",
                self.selected_key.label(),
                platform.name()
            ));
        }

        Ok(ResolvedKeyboardInput {
            display_label: self.selected_key.label().to_string(),
            macos_key_code: self.selected_key.macos_key_code(),
            windows_virtual_key_code: Some(self.selected_key.windows_virtual_key()),
            hid_usage_code: None,
        })
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedKeyboardInput {
    pub display_label: String,
    pub macos_key_code: Option<u16>,
    pub windows_virtual_key_code: Option<u16>,
    pub hid_usage_code: Option<u16>,
}

impl ResolvedKeyboardInput {
    pub fn current_platform_code(&self, platform: PlatformKind) -> Option<u16> {
        match platform {
            PlatformKind::Macos => self.macos_key_code,
            PlatformKind::Windows => self.windows_virtual_key_code,
            PlatformKind::Unsupported => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SafeKeyOption {
    pub id: SafeKeyPreset,
    pub label: &'static str,
    pub supported: bool,
}

pub fn safe_key_options(platform: PlatformKind) -> Vec<SafeKeyOption> {
    SafeKeyPreset::ALL
        .into_iter()
        .map(|key| SafeKeyOption {
            id: key,
            label: key.label(),
            supported: key.supported_on(platform),
        })
        .collect()
}

pub fn load_persisted_config(
    app_handle: &AppHandle<Wry>,
    platform: PlatformKind,
) -> Result<AppConfig, String> {
    let store = app_handle
        .store(CONFIG_STORE_PATH)
        .map_err(|error| format!("Failed to open settings store: {error}"))?;

    let persisted = store.get(CONFIG_STORE_KEY);
    let config = match persisted {
        Some(value) => serde_json::from_value(value.clone())
            .map_err(|error| format!("Failed to decode persisted settings: {error}"))?,
        None => AppConfig::default(),
    };

    let normalized = config.validate_and_normalize(platform)?;
    save_persisted_config(app_handle, &normalized)?;
    Ok(normalized)
}

pub fn save_persisted_config(
    app_handle: &AppHandle<Wry>,
    config: &AppConfig,
) -> Result<(), String> {
    let store = app_handle
        .store(CONFIG_STORE_PATH)
        .map_err(|error| format!("Failed to open settings store: {error}"))?;

    let value = serde_json::to_value(config)
        .map_err(|error| format!("Failed to serialize settings: {error}"))?;

    store.set(CONFIG_STORE_KEY.to_string(), value);
    store
        .save()
        .map_err(|error| format!("Failed to save settings: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{AppConfig, PlatformKind, SafeKeyPreset};

    #[test]
    fn rejects_unsupported_safe_key_on_macos() {
        let config = AppConfig {
            selected_key: SafeKeyPreset::F24,
            ..AppConfig::default()
        };

        let result = config.validate_and_normalize(PlatformKind::Macos);

        assert!(result.is_err());
    }

    #[test]
    fn keeps_platform_specific_custom_mapping() {
        let config = AppConfig {
            custom_input_enabled: true,
            custom_input_value: Some(113),
            ..AppConfig::default()
        };

        let normalized = config.validate_and_normalize(PlatformKind::Macos).unwrap();

        assert_eq!(normalized.platform_key_mapping.macos_key_code, Some(113));
        assert_eq!(normalized.platform_key_mapping.windows_virtual_key_code, None);
    }
}
