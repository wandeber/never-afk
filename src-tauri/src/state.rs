use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager, Wry};

use crate::config::{
    load_persisted_config, safe_key_options, save_persisted_config, AppConfig, PlatformKind,
};
use crate::engine::RuntimeSnapshot;
use crate::platform::PlatformDriver;
use crate::tray::TrayHandles;

pub type SharedAppContext = Arc<AppContext>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendState {
    pub config: AppConfig,
    pub runtime: RuntimeSnapshot,
    pub safe_key_options: Vec<crate::config::SafeKeyOption>,
    pub platform_name: String,
    pub custom_input_label: String,
}

pub struct AppContext {
    app_handle: AppHandle<Wry>,
    driver: Box<dyn PlatformDriver>,
    config: RwLock<AppConfig>,
    config_generation: AtomicU64,
    runtime_snapshot: Mutex<RuntimeSnapshot>,
    pause_until_epoch_ms: Mutex<Option<u64>>,
    wake_signal: Arc<(Mutex<u64>, Condvar)>,
    manual_run_requested: AtomicBool,
    quitting: AtomicBool,
    tray_handles: Mutex<Option<TrayHandles<Wry>>>,
}

impl AppContext {
    pub fn bootstrap(app_handle: AppHandle<Wry>, driver: Box<dyn PlatformDriver>) -> Result<SharedAppContext, String> {
        let platform_kind = driver.kind();
        let config = load_persisted_config(&app_handle, platform_kind)?;
        sync_autostart(&app_handle, config.start_at_login)?;

        let resolved_input_label = config
            .resolved_input(platform_kind)
            .map(|input| input.display_label)
            .unwrap_or_else(|error| format!("Unavailable ({error})"));

        Ok(Arc::new(Self {
            app_handle,
            driver,
            config: RwLock::new(config),
            config_generation: AtomicU64::new(0),
            runtime_snapshot: Mutex::new(RuntimeSnapshot::bootstrap(resolved_input_label)),
            pause_until_epoch_ms: Mutex::new(None),
            wake_signal: Arc::new((Mutex::new(0), Condvar::new())),
            manual_run_requested: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
            tray_handles: Mutex::new(None),
        }))
    }

    pub fn app_handle(&self) -> &AppHandle<Wry> {
        &self.app_handle
    }

    pub fn platform_kind(&self) -> PlatformKind {
        self.driver.kind()
    }

    pub fn platform_name(&self) -> &'static str {
        self.driver.name()
    }

    pub fn config_snapshot(&self) -> AppConfig {
        self.config.read().unwrap().clone()
    }

    pub fn config_generation(&self) -> u64 {
        self.config_generation.load(Ordering::Relaxed)
    }

    pub fn frontend_state(&self) -> FrontendState {
        FrontendState {
            config: self.config_snapshot(),
            runtime: self.runtime_snapshot(),
            safe_key_options: safe_key_options(self.platform_kind()),
            platform_name: self.platform_name().to_string(),
            custom_input_label: self.platform_kind().custom_input_label().to_string(),
        }
    }

    pub fn runtime_snapshot(&self) -> RuntimeSnapshot {
        self.runtime_snapshot.lock().unwrap().clone()
    }

    pub fn update_runtime_snapshot(&self, update: impl FnOnce(&mut RuntimeSnapshot)) {
        let mut snapshot = self.runtime_snapshot.lock().unwrap();
        update(&mut snapshot);
    }

    pub fn set_tray_handles(&self, tray_handles: TrayHandles<Wry>) {
        *self.tray_handles.lock().unwrap() = Some(tray_handles);
    }

    pub fn refresh_tray(&self) {
        let tray_guard = self.tray_handles.lock().unwrap();
        if let Some(tray) = tray_guard.as_ref() {
            let _ = tray.refresh(&self.config_snapshot(), &self.runtime_snapshot());
        }
    }

    pub fn persist_config_change(&self, config: AppConfig) -> Result<(), String> {
        let normalized = config.validate_and_normalize(self.platform_kind())?;
        save_persisted_config(&self.app_handle, &normalized)?;
        sync_autostart(&self.app_handle, normalized.start_at_login)?;

        {
            let mut current = self.config.write().unwrap();
            *current = normalized.clone();
        }

        self.config_generation.fetch_add(1, Ordering::Relaxed);
        self.update_runtime_snapshot(|snapshot| {
            if let Ok(input) = normalized.resolved_input(self.platform_kind()) {
                snapshot.resolved_input_label = input.display_label;
            }
        });
        self.refresh_tray();
        self.wake_engine();
        Ok(())
    }

    pub fn pause_for_minutes(&self, minutes: u64) {
        let pause_until = self
            .now_epoch_ms()
            .saturating_add(minutes.saturating_mul(60).saturating_mul(1000));
        *self.pause_until_epoch_ms.lock().unwrap() = Some(pause_until);
        self.wake_engine();
    }

    pub fn clear_pause(&self) {
        *self.pause_until_epoch_ms.lock().unwrap() = None;
        self.wake_engine();
    }

    pub fn pause_until_epoch_ms(&self) -> Option<u64> {
        *self.pause_until_epoch_ms.lock().unwrap()
    }

    pub fn request_manual_run(&self) {
        self.manual_run_requested.store(true, Ordering::Relaxed);
        self.wake_engine();
    }

    pub fn has_manual_run_request(&self) -> bool {
        self.manual_run_requested.load(Ordering::Relaxed)
    }

    pub fn take_manual_run_request(&self) -> bool {
        self.manual_run_requested.swap(false, Ordering::Relaxed)
    }

    pub fn mark_quitting(&self) {
        self.quitting.store(true, Ordering::Relaxed);
        self.wake_engine();
    }

    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::Relaxed)
    }

    pub fn wake_engine(&self) {
        let (lock, cvar) = &*self.wake_signal;
        let mut generation = lock.lock().unwrap();
        *generation = generation.saturating_add(1);
        cvar.notify_all();
    }

    pub fn wait_for_signal(&self, duration: Duration) {
        let (lock, cvar) = &*self.wake_signal;
        let generation = lock.lock().unwrap();
        let current = *generation;
        let _ = cvar
            .wait_timeout_while(generation, duration, |pending| *pending == current)
            .unwrap();
    }

    pub fn now_epoch_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }

    pub fn seconds_since_last_input(&self) -> Result<Duration, String> {
        self.driver.seconds_since_last_input()
    }

    pub fn perform_fake_input_now(&self, reason: &str) -> Result<(), String> {
        let input = self
            .config_snapshot()
            .resolved_input(self.platform_kind())?;

        self.driver.send_keyboard_input(&input)?;

        // We keep the last successful synthetic event visible in the runtime snapshot so the
        // user can confirm that manual tests and scheduled pulses are actually firing.
        self.update_runtime_snapshot(|snapshot| {
            snapshot.last_fake_input_epoch_ms = Some(self.now_epoch_ms());
            snapshot.last_error = None;
            snapshot.resolved_input_label = input.display_label.clone();
            snapshot.detail_label = format!("Sent {} via {}.", input.display_label, reason);
        });
        self.refresh_tray();

        Ok(())
    }

    pub fn open_settings_window(&self) -> Result<(), String> {
        let window = self
            .app_handle
            .get_webview_window("main")
            .ok_or_else(|| "The settings window is not available.".to_string())?;

        window
            .show()
            .map_err(|error| format!("Failed to show the settings window: {error}"))?;
        window
            .unminimize()
            .map_err(|error| format!("Failed to restore the settings window: {error}"))?;
        window
            .set_focus()
            .map_err(|error| format!("Failed to focus the settings window: {error}"))?;
        Ok(())
    }

    pub fn hide_settings_window(&self) -> Result<(), String> {
        let window = self
            .app_handle
            .get_webview_window("main")
            .ok_or_else(|| "The settings window is not available.".to_string())?;

        window
            .hide()
            .map_err(|error| format!("Failed to hide the settings window: {error}"))?;
        Ok(())
    }
}

fn sync_autostart(app_handle: &AppHandle<Wry>, enabled: bool) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        use tauri_plugin_autostart::ManagerExt;

        let manager = app_handle.autolaunch();
        let result = if enabled {
            manager.enable()
        } else {
            manager.disable()
        };

        result.map_err(|error| format!("Failed to update autostart state: {error}"))?;
    }

    Ok(())
}
