use std::time::Duration;

use core_graphics::event::{CGEvent, CGEventTapLocation, CGEventType};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

use crate::config::{PlatformKind, ResolvedKeyboardInput};
use crate::platform::PlatformDriver;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(
        state_id: CGEventSourceStateID,
        event_type: CGEventType,
    ) -> f64;
    fn CGPreflightPostEventAccess() -> bool;
    fn CGRequestPostEventAccess() -> bool;
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

#[derive(Default)]
pub struct MacosDriver;

// The resident engine should behave like a normal Quartz keyboard event that
// travels through the global input stream, not like text injected directly
// into one target process. Posting at the HID boundary is the closest Core
// Graphics path to a system-wide synthetic key press.
const GLOBAL_SYNTHETIC_EVENT_TAP_LOCATION: CGEventTapLocation = CGEventTapLocation::HID;

fn missing_post_event_access_message() -> String {
    "never-afk needs Accessibility permission to send synthetic key events. Approve it in System Settings > Privacy & Security > Accessibility, then retry the action.".to_string()
}

fn post_event_access_granted() -> bool {
    unsafe { CGPreflightPostEventAccess() }
}

fn accessibility_trust_granted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

fn effective_synthetic_input_access_granted(
    post_event_access: bool,
    accessibility_trust: bool,
) -> bool {
    post_event_access || accessibility_trust
}

pub fn synthetic_input_access_granted() -> bool {
    // macOS exposes two related trust signals here:
    //
    // - `CGPreflightPostEventAccess()` reports the Quartz "post events" grant.
    // - `AXIsProcessTrusted()` reports classic Accessibility trust.
    //
    // In practice, especially while developing with `tauri dev` or after the
    // user manually approves the app from System Settings, we can end up with
    // the second signal enabled while the first one still reads as false for
    // the current process. Treating either one as sufficient avoids trapping
    // the app in a false-negative "permission required" state.
    effective_synthetic_input_access_granted(
        post_event_access_granted(),
        accessibility_trust_granted(),
    )
}

pub fn request_synthetic_input_access() -> bool {
    if synthetic_input_access_granted() {
        return true;
    }

    // Requesting post-event access lets macOS show the native prompt owned by
    // the current app process instead of failing silently the first time the
    // engine tries to synthesize input. We still re-check the broader
    // Accessibility trust afterwards because some approval flows surface there
    // first when the user adds the app manually from System Settings.
    if !post_event_access_granted() {
        let _ = unsafe { CGRequestPostEventAccess() };
    }

    synthetic_input_access_granted()
}

fn event_source() -> Result<CGEventSource, String> {
    CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| "Failed to create the CoreGraphics event source.".to_string())
}

fn post_event_globally(event: &CGEvent) {
    event.post(GLOBAL_SYNTHETIC_EVENT_TAP_LOCATION);
}

fn post_keyboard_event_pair(key_code: u16, deliver: impl Fn(&CGEvent)) -> Result<(), String> {
    let event_source = event_source()?;

    let key_down = CGEvent::new_keyboard_event(event_source.clone(), key_code, true)
        .map_err(|_| "Failed to create the synthetic key down event.".to_string())?;
    deliver(&key_down);

    let key_up = CGEvent::new_keyboard_event(event_source, key_code, false)
        .map_err(|_| "Failed to create the synthetic key up event.".to_string())?;
    deliver(&key_up);

    Ok(())
}

impl PlatformDriver for MacosDriver {
    fn kind(&self) -> PlatformKind {
        PlatformKind::Macos
    }

    fn seconds_since_last_input(&self) -> Result<Duration, String> {
        let seconds = unsafe {
            CGEventSourceSecondsSinceLastEventType(
                CGEventSourceStateID::CombinedSessionState,
                CGEventType::Null,
            )
        };

        Ok(Duration::from_secs_f64(seconds))
    }

    fn send_keyboard_input(&self, input: &ResolvedKeyboardInput) -> Result<(), String> {
        let key_code = input
            .macos_key_code
            .ok_or_else(|| "The current input does not include a macOS key code.".to_string())?;

        if !request_synthetic_input_access() {
            return Err(missing_post_event_access_message());
        }

        // The engine must publish a regular Quartz key press into the global
        // input stream so system-wide idle tracking and focused apps observe a
        // single synthetic key lifecycle, not a private per-process injection.
        post_keyboard_event_pair(key_code, post_event_globally)?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::effective_synthetic_input_access_granted;

    #[test]
    fn grants_access_when_post_event_permission_is_available() {
        assert!(effective_synthetic_input_access_granted(true, false));
    }

    #[test]
    fn grants_access_when_accessibility_trust_is_available() {
        assert!(effective_synthetic_input_access_granted(false, true));
    }

    #[test]
    fn denies_access_when_no_signal_is_granted() {
        assert!(!effective_synthetic_input_access_granted(false, false));
    }
}
