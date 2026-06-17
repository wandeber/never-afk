use chrono::Weekday;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Wry};
use tauri_plugin_store::StoreExt;

pub const CONFIG_STORE_PATH: &str = "settings.json";
const CONFIG_STORE_KEY: &str = "app-config";
const LAST_FAKE_INPUT_EPOCH_MS_STORE_KEY: &str = "last-fake-input-epoch-ms";
const LAST_DRIVER_ERROR_STORE_KEY: &str = "last-driver-error";

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
    #[serde(rename = "Fn")]
    Fn,
    #[serde(rename = "A")]
    A,
    #[serde(rename = "Shift")]
    Shift,
    #[serde(rename = "Option")]
    OptionKey,
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
    pub const ALL: [Self; 16] = [
        Self::Fn,
        Self::A,
        Self::Shift,
        Self::OptionKey,
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
            Self::Fn => "Fn",
            Self::A => "A",
            Self::Shift => "Shift",
            Self::OptionKey => "Option / Alt",
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
            // macOS exposes the function / globe key as a dedicated virtual key code, and
            // we also allow a small set of modifier presets. F21-F24 stay disabled because
            // Carbon only exposes built-in virtual key codes up to F20.
            PlatformKind::Macos => !matches!(self, Self::F21 | Self::F22 | Self::F23 | Self::F24),
            // Windows does not expose a portable equivalent for Fn because that key is
            // typically handled in firmware rather than the standard virtual-key layer.
            PlatformKind::Windows => !matches!(self, Self::Fn),
            PlatformKind::Unsupported => false,
        }
    }

    pub fn macos_key_code(self) -> Option<u16> {
        match self {
            Self::Fn => Some(0x3F),
            // Letter presets use the standard physical key for that character so the
            // generated event matches what the focused app would normally receive.
            Self::A => Some(0x00),
            // Modifier presets use the left-side virtual key codes so there is one
            // canonical built-in preset per modifier without introducing left/right
            // variants into the basic settings UI.
            Self::Shift => Some(0x38),
            Self::OptionKey => Some(0x3A),
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

    pub fn windows_virtual_key(self) -> Option<u16> {
        match self {
            Self::Fn => None,
            Self::A => Some(0x41),
            Self::Shift => Some(0x10),
            Self::OptionKey => Some(0x12),
            Self::F13 => Some(0x7C),
            Self::F14 => Some(0x7D),
            Self::F15 => Some(0x7E),
            Self::F16 => Some(0x7F),
            Self::F17 => Some(0x80),
            Self::F18 => Some(0x81),
            Self::F19 => Some(0x82),
            Self::F20 => Some(0x83),
            Self::F21 => Some(0x84),
            Self::F22 => Some(0x85),
            Self::F23 => Some(0x86),
            Self::F24 => Some(0x87),
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum ScheduleWeekday {
    Mon,
    Tue,
    Wed,
    Thu,
    Fri,
    Sat,
    Sun,
}

impl ScheduleWeekday {
    pub fn sort_index(self) -> usize {
        match self {
            Self::Mon => 0,
            Self::Tue => 1,
            Self::Wed => 2,
            Self::Thu => 3,
            Self::Fri => 4,
            Self::Sat => 5,
            Self::Sun => 6,
        }
    }

    pub fn from_chrono(weekday: Weekday) -> Self {
        match weekday {
            Weekday::Mon => Self::Mon,
            Weekday::Tue => Self::Tue,
            Weekday::Wed => Self::Wed,
            Weekday::Thu => Self::Thu,
            Weekday::Fri => Self::Fri,
            Weekday::Sat => Self::Sat,
            Weekday::Sun => Self::Sun,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRange {
    pub days_of_week: Vec<ScheduleWeekday>,
    pub start_minutes: u16,
    pub end_minutes: u16,
}

impl ScheduleRange {
    pub const MAX_MINUTE_OF_DAY: u16 = 23 * 60 + 59;

    pub fn validate_and_normalize(&mut self, index: usize) -> Result<(), String> {
        if self.days_of_week.is_empty() {
            return Err(format!(
                "Schedule range {} must include at least one weekday.",
                index + 1
            ));
        }

        if self.start_minutes > Self::MAX_MINUTE_OF_DAY {
            return Err(format!(
                "Schedule range {} starts outside the valid 00:00-23:59 day window.",
                index + 1
            ));
        }

        if self.end_minutes > Self::MAX_MINUTE_OF_DAY {
            return Err(format!(
                "Schedule range {} ends outside the valid 00:00-23:59 day window.",
                index + 1
            ));
        }

        if self.end_minutes <= self.start_minutes {
            return Err(format!(
                "Schedule range {} must end after it starts. Overnight ranges are not supported.",
                index + 1
            ));
        }

        // Ranges are persisted as a stable Monday-first set so repeated saves do
        // not shuffle the JSON representation or create duplicate weekdays.
        self.days_of_week.sort_by_key(|day| day.sort_index());
        self.days_of_week.dedup();

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub enabled: bool,
    pub quiet_period_seconds: u64,
    pub idle_confirmation_period_seconds: u64,
    pub start_at_login: bool,
    #[serde(default)]
    pub schedule_enabled: bool,
    #[serde(default)]
    pub schedule_ranges: Vec<ScheduleRange>,
    pub activity_method: ActivityMethod,
    pub selected_key: SafeKeyPreset,
    #[serde(default = "default_show_last_event_in_menu_bar")]
    pub show_last_event_in_menu_bar: bool,
    pub custom_input_enabled: bool,
    pub custom_input_value: Option<u16>,
    pub platform_key_mapping: PlatformKeyMapping,
}

fn default_show_last_event_in_menu_bar() -> bool {
    true
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            quiet_period_seconds: 120,
            idle_confirmation_period_seconds: 120,
            start_at_login: false,
            schedule_enabled: false,
            schedule_ranges: Vec::new(),
            activity_method: ActivityMethod::Keyboard,
            selected_key: SafeKeyPreset::F15,
            show_last_event_in_menu_bar: default_show_last_event_in_menu_bar(),
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

        for (index, range) in self.schedule_ranges.iter_mut().enumerate() {
            range.validate_and_normalize(index)?;
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
                    self.platform_key_mapping.windows_virtual_key_code =
                        Some(current_platform_code);
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
            windows_virtual_key_code: self.selected_key.windows_virtual_key(),
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

pub fn load_last_fake_input_epoch_ms(app_handle: &AppHandle<Wry>) -> Result<Option<u64>, String> {
    let store = app_handle
        .store(CONFIG_STORE_PATH)
        .map_err(|error| format!("Failed to open settings store: {error}"))?;

    let persisted = store.get(LAST_FAKE_INPUT_EPOCH_MS_STORE_KEY);
    match persisted {
        Some(value) => serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|error| format!("Failed to decode last fake-input timestamp: {error}")),
        None => Ok(None),
    }
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

pub fn save_last_fake_input_epoch_ms(
    app_handle: &AppHandle<Wry>,
    epoch_ms: Option<u64>,
) -> Result<(), String> {
    let store = app_handle
        .store(CONFIG_STORE_PATH)
        .map_err(|error| format!("Failed to open settings store: {error}"))?;

    match epoch_ms {
        Some(epoch_ms) => {
            let value = serde_json::to_value(epoch_ms).map_err(|error| {
                format!("Failed to serialize last fake-input timestamp: {error}")
            })?;
            store.set(LAST_FAKE_INPUT_EPOCH_MS_STORE_KEY.to_string(), value);
        }
        None => {
            store.delete(LAST_FAKE_INPUT_EPOCH_MS_STORE_KEY);
        }
    }

    store
        .save()
        .map_err(|error| format!("Failed to save runtime metadata: {error}"))?;
    Ok(())
}

pub fn save_last_driver_error(
    app_handle: &AppHandle<Wry>,
    error: Option<&str>,
) -> Result<(), String> {
    let store = app_handle
        .store(CONFIG_STORE_PATH)
        .map_err(|store_error| format!("Failed to open settings store: {store_error}"))?;

    match error {
        Some(error) => {
            let value = serde_json::to_value(error).map_err(|serialize_error| {
                format!("Failed to serialize last driver error: {serialize_error}")
            })?;
            store.set(LAST_DRIVER_ERROR_STORE_KEY.to_string(), value);
        }
        None => {
            store.delete(LAST_DRIVER_ERROR_STORE_KEY);
        }
    }

    store
        .save()
        .map_err(|save_error| format!("Failed to save runtime metadata: {save_error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{AppConfig, PlatformKind, SafeKeyPreset, ScheduleRange, ScheduleWeekday};
    use serde_json::json;

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
        assert_eq!(
            normalized.platform_key_mapping.windows_virtual_key_code,
            None
        );
    }

    #[test]
    fn resolves_fn_on_macos() {
        let config = AppConfig {
            selected_key: SafeKeyPreset::Fn,
            ..AppConfig::default()
        };

        let resolved = config.resolved_input(PlatformKind::Macos).unwrap();

        assert_eq!(resolved.display_label, "Fn");
        assert_eq!(resolved.macos_key_code, Some(0x3F));
        assert_eq!(resolved.windows_virtual_key_code, None);
    }

    #[test]
    fn resolves_a_on_both_platforms() {
        let config = AppConfig {
            selected_key: SafeKeyPreset::A,
            ..AppConfig::default()
        };

        let mac = config.resolved_input(PlatformKind::Macos).unwrap();
        let windows = config.resolved_input(PlatformKind::Windows).unwrap();

        assert_eq!(mac.display_label, "A");
        assert_eq!(mac.macos_key_code, Some(0x00));
        assert_eq!(windows.windows_virtual_key_code, Some(0x41));
    }

    #[test]
    fn resolves_modifier_presets_on_both_platforms() {
        let shift = AppConfig {
            selected_key: SafeKeyPreset::Shift,
            ..AppConfig::default()
        };
        let option = AppConfig {
            selected_key: SafeKeyPreset::OptionKey,
            ..AppConfig::default()
        };

        let mac_shift = shift.resolved_input(PlatformKind::Macos).unwrap();
        let windows_option = option.resolved_input(PlatformKind::Windows).unwrap();

        assert_eq!(mac_shift.macos_key_code, Some(0x38));
        assert_eq!(windows_option.windows_virtual_key_code, Some(0x12));
    }

    #[test]
    fn rejects_fn_as_built_in_key_on_windows() {
        let config = AppConfig {
            selected_key: SafeKeyPreset::Fn,
            ..AppConfig::default()
        };

        let result = config.validate_and_normalize(PlatformKind::Windows);

        assert!(result.is_err());
    }

    #[test]
    fn defaults_last_event_visibility_when_loading_older_settings() {
        let decoded: AppConfig = serde_json::from_value(json!({
            "enabled": true,
            "quietPeriodSeconds": 120,
            "idleConfirmationPeriodSeconds": 120,
            "startAtLogin": false,
            "activityMethod": "keyboard",
            "selectedKey": "F15",
            "customInputEnabled": false,
            "customInputValue": null,
            "platformKeyMapping": {
                "macosKeyCode": null,
                "windowsVirtualKeyCode": null,
                "hidUsageCode": null
            }
        }))
        .unwrap();

        assert!(decoded.show_last_event_in_menu_bar);
        assert!(!decoded.schedule_enabled);
        assert!(decoded.schedule_ranges.is_empty());
    }

    #[test]
    fn rejects_schedule_ranges_without_weekdays() {
        let config = AppConfig {
            schedule_enabled: true,
            schedule_ranges: vec![ScheduleRange {
                days_of_week: Vec::new(),
                start_minutes: 9 * 60,
                end_minutes: 17 * 60,
            }],
            ..AppConfig::default()
        };

        let result = config.validate_and_normalize(PlatformKind::Macos);

        assert!(result.is_err());
    }

    #[test]
    fn rejects_overnight_schedule_ranges() {
        let config = AppConfig {
            schedule_enabled: true,
            schedule_ranges: vec![ScheduleRange {
                days_of_week: vec![ScheduleWeekday::Mon],
                start_minutes: 22 * 60,
                end_minutes: 8 * 60,
            }],
            ..AppConfig::default()
        };

        let result = config.validate_and_normalize(PlatformKind::Macos);

        assert!(result.is_err());
    }

    #[test]
    fn normalizes_schedule_weekdays_into_stable_order() {
        let config = AppConfig {
            schedule_enabled: true,
            schedule_ranges: vec![ScheduleRange {
                days_of_week: vec![
                    ScheduleWeekday::Fri,
                    ScheduleWeekday::Mon,
                    ScheduleWeekday::Fri,
                    ScheduleWeekday::Wed,
                ],
                start_minutes: 8 * 60,
                end_minutes: 9 * 60,
            }],
            ..AppConfig::default()
        };

        let normalized = config.validate_and_normalize(PlatformKind::Macos).unwrap();

        assert_eq!(
            normalized.schedule_ranges[0].days_of_week,
            vec![
                ScheduleWeekday::Mon,
                ScheduleWeekday::Wed,
                ScheduleWeekday::Fri
            ]
        );
    }
}
