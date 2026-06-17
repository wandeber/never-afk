mod unsupported;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

use std::time::Duration;

use crate::config::{PlatformKind, ResolvedKeyboardInput};

pub trait SystemSleepGuard: Send {}

struct NoopSystemSleepGuard;

impl SystemSleepGuard for NoopSystemSleepGuard {}

pub trait PlatformDriver: Send + Sync {
    fn kind(&self) -> PlatformKind;
    fn seconds_since_last_input(&self) -> Result<Duration, String>;
    fn send_keyboard_input(&self, input: &ResolvedKeyboardInput) -> Result<(), String>;

    fn prevent_idle_sleep(&self, _reason: &str) -> Result<Box<dyn SystemSleepGuard>, String> {
        Ok(Box::new(NoopSystemSleepGuard))
    }
}

pub fn create_platform_driver() -> Box<dyn PlatformDriver> {
    #[cfg(target_os = "macos")]
    {
        return Box::new(macos::MacosDriver::default());
    }

    #[cfg(target_os = "windows")]
    {
        return Box::new(windows::WindowsDriver::default());
    }

    #[allow(unreachable_code)]
    Box::new(unsupported::UnsupportedDriver)
}

pub fn spawn_system_wake_listener(
    on_wake: impl Fn() + Send + Sync + 'static,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return macos::spawn_system_wake_listener(on_wake);
    }

    #[allow(unreachable_code)]
    {
        let _ = on_wake;
        Ok(())
    }
}

pub fn synthetic_input_access_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        return macos::synthetic_input_access_granted();
    }

    #[allow(unreachable_code)]
    true
}

pub fn synthetic_input_access_request_supported() -> bool {
    #[cfg(target_os = "macos")]
    {
        return true;
    }

    #[allow(unreachable_code)]
    false
}

pub fn request_synthetic_input_access() -> bool {
    #[cfg(target_os = "macos")]
    {
        return macos::request_synthetic_input_access();
    }

    #[allow(unreachable_code)]
    true
}
