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
}

#[derive(Default)]
pub struct MacosDriver;

impl PlatformDriver for MacosDriver {
    fn kind(&self) -> PlatformKind {
        PlatformKind::Macos
    }

    fn name(&self) -> &'static str {
        "macOS"
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

        let event_source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| "Failed to create the CoreGraphics event source.".to_string())?;

        // Two separate events keep the synthetic input as small as possible while still
        // producing a normal key press lifecycle that apps and the OS both understand.
        let key_down = CGEvent::new_keyboard_event(event_source.clone(), key_code, true)
            .map_err(|_| "Failed to create the synthetic key down event.".to_string())?;
        key_down.post(CGEventTapLocation::HID);

        let key_up = CGEvent::new_keyboard_event(event_source, key_code, false)
            .map_err(|_| "Failed to create the synthetic key up event.".to_string())?;
        key_up.post(CGEventTapLocation::HID);

        Ok(())
    }
}
