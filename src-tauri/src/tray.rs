use chrono::{Local, TimeZone};
use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Runtime, Wry};

use crate::engine::{EnginePhase, RuntimeSnapshot};
use crate::state::SharedAppContext;

const STATUS_ITEM_ID: &str = "status";
const NEXT_CHECK_ITEM_ID: &str = "next-check";
const LAST_EVENT_ITEM_ID: &str = "last-event";
const ENABLED_ITEM_ID: &str = "enabled";
const OPEN_SETTINGS_ITEM_ID: &str = "open-settings";
const PAUSE_30_ITEM_ID: &str = "pause-30";
const PAUSE_60_ITEM_ID: &str = "pause-60";
const RUN_ONCE_ITEM_ID: &str = "run-once";
const QUIT_ITEM_ID: &str = "quit";

pub struct TrayHandles<R: Runtime> {
    icon: TrayIcon<R>,
    active_icon: Image<'static>,
    inactive_icon: Image<'static>,
    last_icon_active: Mutex<Option<bool>>,
    status: MenuItem<R>,
    next_check: MenuItem<R>,
    last_event: MenuItem<R>,
    enabled: CheckMenuItem<R>,
}

impl<R: Runtime> TrayHandles<R> {
    pub fn refresh(
        &self,
        config: &crate::config::AppConfig,
        snapshot: &RuntimeSnapshot,
    ) -> Result<(), String> {
        let next_check_text = format_next_check_menu_text(config, snapshot);
        let last_event_text = format_last_event_menu_text(snapshot.last_fake_input_epoch_ms);
        let icon_active = uses_active_tray_icon(snapshot);

        let status_text = match snapshot.phase {
            EnginePhase::WaitingQuiet => "Status: Enabled".to_string(),
            EnginePhase::Observing => "Status: Observing".to_string(),
            EnginePhase::Paused => "Status: Paused".to_string(),
            EnginePhase::ScheduledOff => "Status: Outside schedule".to_string(),
            EnginePhase::Disabled => "Status: Disabled".to_string(),
            EnginePhase::Error => "Status: Driver error".to_string(),
        };

        self.status
            .set_text(status_text)
            .map_err(|error| format!("Failed to update tray status: {error}"))?;
        self.next_check
            .set_text(next_check_text)
            .map_err(|error| format!("Failed to update tray timing: {error}"))?;
        self.last_event
            .set_text(last_event_text)
            .map_err(|error| format!("Failed to update tray last-event item: {error}"))?;
        self.enabled
            .set_checked(config.enabled)
            .map_err(|error| format!("Failed to update tray enabled state: {error}"))?;
        self.refresh_icon(icon_active)?;
        self.icon
            .set_title(Some(format_last_event_title(
                snapshot.last_fake_input_epoch_ms,
                config.show_last_event_in_menu_bar,
            )))
            .map_err(|error| format!("Failed to update the tray title: {error}"))?;

        Ok(())
    }

    fn refresh_icon(&self, icon_active: bool) -> Result<(), String> {
        let mut last_icon_active = self.last_icon_active.lock().unwrap();
        if last_icon_active.is_some_and(|current| current == icon_active) {
            return Ok(());
        }

        // Tray refreshes can happen frequently while the engine is observing.
        // Keeping the last applied state avoids repeatedly sending the same
        // image to the OS when only the text labels changed.
        let next_icon = if icon_active {
            self.active_icon.clone()
        } else {
            self.inactive_icon.clone()
        };

        self.icon
            .set_icon(Some(next_icon))
            .map_err(|error| format!("Failed to update the tray icon: {error}"))?;
        *last_icon_active = Some(icon_active);

        Ok(())
    }
}

fn format_last_event_menu_text(last_fake_input_epoch_ms: Option<u64>) -> String {
    match last_fake_input_epoch_ms.and_then(format_timestamp_for_menu) {
        Some(label) => format!("Last event: {label}"),
        None => "Last event: -".to_string(),
    }
}

fn format_next_check_menu_text(
    config: &crate::config::AppConfig,
    snapshot: &RuntimeSnapshot,
) -> String {
    match snapshot.phase {
        EnginePhase::ScheduledOff => match snapshot
            .next_relevant_epoch_ms
            .and_then(format_weekday_time)
        {
            Some(label) => format!("Next range: {label}"),
            None if config.schedule_enabled && config.schedule_ranges.is_empty() => {
                "Next range: add a range".to_string()
            }
            None => "Next range: -".to_string(),
        },
        EnginePhase::Paused => match snapshot
            .paused_until_epoch_ms
            .or(snapshot.next_relevant_epoch_ms)
            .and_then(format_timestamp_for_menu)
        {
            Some(label) => format!("Resumes: {label}"),
            None => "Resumes: -".to_string(),
        },
        _ => match snapshot.next_check_in_seconds {
            Some(seconds) => format!("Next check in {}s", seconds.max(1)),
            None => "Next check in -".to_string(),
        },
    }
}

fn format_last_event_title(
    last_fake_input_epoch_ms: Option<u64>,
    show_last_event_in_menu_bar: bool,
) -> String {
    if !show_last_event_in_menu_bar {
        return String::new();
    }

    format_timestamp_for_title(last_fake_input_epoch_ms).unwrap_or_default()
}

fn format_timestamp_for_menu(epoch_ms: u64) -> Option<String> {
    // The tray menu can afford a fuller timestamp so the user can confirm the
    // exact day and minute when the last synthetic event was sent.
    let timestamp = Local.timestamp_millis_opt(epoch_ms as i64).single()?;
    Some(timestamp.format("%Y-%m-%d %H:%M").to_string())
}

fn format_weekday_time(epoch_ms: u64) -> Option<String> {
    let timestamp = Local.timestamp_millis_opt(epoch_ms as i64).single()?;
    Some(timestamp.format("%a %H:%M").to_string())
}

fn format_timestamp_for_title(last_fake_input_epoch_ms: Option<u64>) -> Option<String> {
    // The visible menu-bar title must stay short enough to avoid stealing too
    // much horizontal space from the rest of the macOS status items.
    let timestamp = Local
        .timestamp_millis_opt(last_fake_input_epoch_ms? as i64)
        .single()?;
    Some(timestamp.format("%d/%m %H:%M").to_string())
}

fn uses_active_tray_icon(snapshot: &RuntimeSnapshot) -> bool {
    matches!(
        snapshot.phase,
        EnginePhase::WaitingQuiet | EnginePhase::Observing
    )
}

#[cfg(test)]
mod tests {
    use super::{format_last_event_title, uses_active_tray_icon};
    use crate::engine::{EnginePhase, RuntimeSnapshot};

    #[test]
    fn clears_menu_bar_title_when_visibility_is_disabled() {
        assert_eq!(format_last_event_title(Some(1_713_847_200_000), false), "");
    }

    #[test]
    fn clears_menu_bar_title_when_no_event_is_available() {
        assert_eq!(format_last_event_title(None, true), "");
    }

    #[test]
    fn uses_active_tray_icon_only_while_automatic_engine_can_run() {
        let mut snapshot = RuntimeSnapshot::bootstrap("F15".into(), None);

        snapshot.phase = EnginePhase::WaitingQuiet;
        assert!(uses_active_tray_icon(&snapshot));

        snapshot.phase = EnginePhase::Observing;
        assert!(uses_active_tray_icon(&snapshot));

        snapshot.phase = EnginePhase::ScheduledOff;
        assert!(!uses_active_tray_icon(&snapshot));

        snapshot.phase = EnginePhase::Paused;
        assert!(!uses_active_tray_icon(&snapshot));
    }
}

pub fn build_tray(app_handle: &AppHandle<Wry>) -> Result<TrayHandles<Wry>, String> {
    let status = MenuItemBuilder::with_id(STATUS_ITEM_ID, "Status: Bootstrapping")
        .enabled(false)
        .build(app_handle)
        .map_err(|error| format!("Failed to create the tray status item: {error}"))?;

    let next_check = MenuItemBuilder::with_id(NEXT_CHECK_ITEM_ID, "Next check in -")
        .enabled(false)
        .build(app_handle)
        .map_err(|error| format!("Failed to create the tray timing item: {error}"))?;

    let last_event = MenuItemBuilder::with_id(LAST_EVENT_ITEM_ID, "Last event: -")
        .enabled(false)
        .build(app_handle)
        .map_err(|error| format!("Failed to create the tray last-event item: {error}"))?;

    let enabled = CheckMenuItemBuilder::with_id(ENABLED_ITEM_ID, "Enabled")
        .checked(true)
        .build(app_handle)
        .map_err(|error| format!("Failed to create the tray enabled item: {error}"))?;

    let open_settings = MenuItemBuilder::with_id(OPEN_SETTINGS_ITEM_ID, "Open Settings")
        .build(app_handle)
        .map_err(|error| format!("Failed to create the settings menu item: {error}"))?;

    let pause_30 = MenuItemBuilder::with_id(PAUSE_30_ITEM_ID, "Pause for 30 min")
        .build(app_handle)
        .map_err(|error| format!("Failed to create the pause-30 menu item: {error}"))?;

    let pause_60 = MenuItemBuilder::with_id(PAUSE_60_ITEM_ID, "Pause for 1 h")
        .build(app_handle)
        .map_err(|error| format!("Failed to create the pause-60 menu item: {error}"))?;

    let run_once = MenuItemBuilder::with_id(RUN_ONCE_ITEM_ID, "Run once now")
        .build(app_handle)
        .map_err(|error| format!("Failed to create the run-once menu item: {error}"))?;

    let quit = MenuItemBuilder::with_id(QUIT_ITEM_ID, "Quit")
        .build(app_handle)
        .map_err(|error| format!("Failed to create the quit menu item: {error}"))?;

    let menu = MenuBuilder::new(app_handle)
        .item(&status)
        .item(&next_check)
        .item(&last_event)
        .separator()
        .item(&enabled)
        .item(&open_settings)
        .item(&pause_30)
        .item(&pause_60)
        .item(&run_once)
        .separator()
        .item(&quit)
        .build()
        .map_err(|error| format!("Failed to build the tray menu: {error}"))?;

    let active_icon = load_tray_icon(include_bytes!("../icons/tray-active.png"), "active")?;
    let inactive_icon = load_tray_icon(include_bytes!("../icons/tray-inactive.png"), "inactive")?;

    let icon = TrayIconBuilder::with_id("main")
        .icon(inactive_icon.clone())
        .icon_as_template(false)
        .tooltip("never-afk")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .build(app_handle)
        .map_err(|error| format!("Failed to build the tray icon: {error}"))?;

    Ok(TrayHandles {
        icon,
        active_icon,
        inactive_icon,
        last_icon_active: Mutex::new(None),
        status,
        next_check,
        last_event,
        enabled,
    })
}

fn load_tray_icon(bytes: &[u8], label: &str) -> Result<Image<'static>, String> {
    Image::from_bytes(bytes)
        .map_err(|error| format!("Failed to load the {label} tray icon: {error}"))
}

pub fn handle_menu_event(context: SharedAppContext, item_id: &str) -> Result<(), String> {
    match item_id {
        ENABLED_ITEM_ID => {
            let mut config = context.config_snapshot();
            config.enabled = !config.enabled;
            context.persist_config_change(config)?;
        }
        OPEN_SETTINGS_ITEM_ID => {
            context.open_settings_window()?;
        }
        PAUSE_30_ITEM_ID => {
            context.pause_for_minutes(30);
        }
        PAUSE_60_ITEM_ID => {
            context.pause_for_minutes(60);
        }
        RUN_ONCE_ITEM_ID => {
            context.request_manual_run();
        }
        QUIT_ITEM_ID => {
            context.mark_quitting();
            context.app_handle().exit(0);
        }
        _ => {}
    }

    Ok(())
}

pub fn handle_tray_click(context: SharedAppContext, event: &TrayIconEvent) -> Result<(), String> {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        context.open_settings_window()?;
    }

    Ok(())
}
