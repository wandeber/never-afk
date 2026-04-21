use std::time::Duration;

use crate::config::{PlatformKind, ResolvedKeyboardInput};
use crate::platform::PlatformDriver;

pub struct UnsupportedDriver;

impl PlatformDriver for UnsupportedDriver {
    fn kind(&self) -> PlatformKind {
        PlatformKind::Unsupported
    }

    fn name(&self) -> &'static str {
        "Unsupported"
    }

    fn seconds_since_last_input(&self) -> Result<Duration, String> {
        Err("This platform is not supported by never-afk.".into())
    }

    fn send_keyboard_input(&self, _input: &ResolvedKeyboardInput) -> Result<(), String> {
        Err("This platform is not supported by never-afk.".into())
    }
}
