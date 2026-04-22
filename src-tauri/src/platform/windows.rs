use std::mem::size_of;
use std::time::Duration;

use windows::core::Error as WindowsError;
use windows::Win32::Foundation::GetLastError;
use windows::Win32::System::SystemInformation::GetTickCount64;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetLastInputInfo, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    LASTINPUTINFO, VIRTUAL_KEY,
};

use crate::config::{PlatformKind, ResolvedKeyboardInput};
use crate::platform::PlatformDriver;

#[derive(Default)]
pub struct WindowsDriver;

impl PlatformDriver for WindowsDriver {
    fn kind(&self) -> PlatformKind {
        PlatformKind::Windows
    }

    fn seconds_since_last_input(&self) -> Result<Duration, String> {
        let mut info = LASTINPUTINFO {
            cbSize: size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };

        let ok = unsafe { GetLastInputInfo(&mut info).as_bool() };
        if !ok {
            return Err(format!(
                "GetLastInputInfo failed: {}",
                WindowsError::from_win32()
            ));
        }

        let tick_count = unsafe { GetTickCount64() };
        let idle_millis = tick_count.saturating_sub(u64::from(info.dwTime));
        Ok(Duration::from_millis(idle_millis))
    }

    fn send_keyboard_input(&self, input: &ResolvedKeyboardInput) -> Result<(), String> {
        let key_code = input.windows_virtual_key_code.ok_or_else(|| {
            "The current input does not include a Windows virtual-key code.".to_string()
        })?;

        let key_down = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(key_code),
                    wScan: 0,
                    dwFlags: Default::default(),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };

        let key_up = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(key_code),
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };

        let sent = unsafe { SendInput(&[key_down, key_up], size_of::<INPUT>() as i32) };
        if sent != 2 {
            return Err(format!(
                "SendInput failed with the current key configuration (GetLastError = {}).",
                unsafe { GetLastError().0 }
            ));
        }

        Ok(())
    }
}
