use chrono::{Local, TimeZone};
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
        let next_check_text = match snapshot.next_check_in_seconds {
            Some(seconds) => format!("Next check in {}s", seconds.max(1)),
            None => "Next check in -".to_string(),
        };
        let last_event_text = format_last_event_menu_text(snapshot.last_fake_input_epoch_ms);

        let status_text = match snapshot.phase {
            EnginePhase::WaitingQuiet => "Status: Enabled".to_string(),
            EnginePhase::Observing => "Status: Observing".to_string(),
            EnginePhase::Paused => "Status: Paused".to_string(),
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
        self.icon
            .set_title(format_last_event_title(snapshot.last_fake_input_epoch_ms))
            .map_err(|error| format!("Failed to update the tray title: {error}"))?;

        Ok(())
    }
}

fn format_last_event_menu_text(last_fake_input_epoch_ms: Option<u64>) -> String {
    match last_fake_input_epoch_ms.and_then(format_timestamp_for_menu) {
        Some(label) => format!("Last event: {label}"),
        None => "Last event: -".to_string(),
    }
}

fn format_last_event_title(last_fake_input_epoch_ms: Option<u64>) -> Option<String> {
    last_fake_input_epoch_ms.and_then(format_timestamp_for_title)
}

fn format_timestamp_for_menu(epoch_ms: u64) -> Option<String> {
    // The tray menu can afford a fuller timestamp so the user can confirm the
    // exact day and minute when the last synthetic event was sent.
    let timestamp = Local.timestamp_millis_opt(epoch_ms as i64).single()?;
    Some(timestamp.format("%Y-%m-%d %H:%M").to_string())
}

fn format_timestamp_for_title(epoch_ms: u64) -> Option<String> {
    // The visible menu-bar title must stay short enough to avoid stealing too
    // much horizontal space from the rest of the macOS status items.
    let timestamp = Local.timestamp_millis_opt(epoch_ms as i64).single()?;
    Some(timestamp.format("%d/%m %H:%M").to_string())
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

    let icon = app_handle
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "The application icon is not available.".to_string())?;

    let icon = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("never-afk")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .build(app_handle)
        .map_err(|error| format!("Failed to build the tray icon: {error}"))?;

    Ok(TrayHandles {
        icon,
        status,
        next_check,
        last_event,
        enabled,
    })
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
