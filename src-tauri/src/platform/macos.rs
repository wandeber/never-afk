use std::ffi::CString;
use std::os::raw::{c_char, c_void};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use core_graphics::event::{CGEvent, CGEventTapLocation, CGEventType};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

use crate::config::{PlatformKind, ResolvedKeyboardInput};
use crate::platform::{PlatformDriver, SystemSleepGuard};

type CFAllocatorRef = *const c_void;
type CFDictionaryRef = *const c_void;
type CFIndex = isize;
type CFRunLoopRef = *const c_void;
type CFRunLoopSourceRef = *const c_void;
type CFStringRef = *const c_void;
type CFTypeRef = *const c_void;
type IOPMAssertionId = u32;
type IONotificationPortRef = *mut c_void;
type IoConnect = u32;
type IoObject = u32;
type IoService = u32;
type IOReturn = i32;
type Natural = u32;

type IOServiceInterestCallback = unsafe extern "C" fn(
    refcon: *mut c_void,
    service: IoService,
    message_type: Natural,
    message_argument: *mut c_void,
);

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
    fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
    static kAXTrustedCheckOptionPrompt: CFStringRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFDictionaryCreate(
        allocator: CFAllocatorRef,
        keys: *const *const c_void,
        values: *const *const c_void,
        num_values: CFIndex,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> CFDictionaryRef;
    fn CFRelease(cf: *const c_void);
    fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFStringRef);
    fn CFRunLoopGetCurrent() -> CFRunLoopRef;
    fn CFRunLoopRun();
    fn CFStringCreateWithCString(
        alloc: CFAllocatorRef,
        c_str: *const c_char,
        encoding: u32,
    ) -> CFStringRef;
    static kCFBooleanTrue: CFTypeRef;
    static kCFRunLoopDefaultMode: CFStringRef;
}

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOAllowPowerChange(kernel_port: IoConnect, notification_id: isize) -> IOReturn;
    fn IODeregisterForSystemPower(notifier: *mut IoObject) -> IOReturn;
    fn IONotificationPortDestroy(notify: IONotificationPortRef);
    fn IONotificationPortGetRunLoopSource(notify: IONotificationPortRef) -> CFRunLoopSourceRef;
    fn IOPMAssertionCreateWithName(
        assertion_type: CFStringRef,
        assertion_level: u32,
        assertion_name: CFStringRef,
        assertion_id: *mut IOPMAssertionId,
    ) -> IOReturn;
    fn IOPMAssertionRelease(assertion_id: IOPMAssertionId) -> IOReturn;
    fn IORegisterForSystemPower(
        refcon: *mut c_void,
        notification_port: *mut IONotificationPortRef,
        callback: IOServiceInterestCallback,
        notifier: *mut IoObject,
    ) -> IoConnect;
    fn IOServiceClose(connect: IoConnect) -> IOReturn;
}

#[derive(Default)]
pub struct MacosDriver;

// The resident engine should behave like a normal Quartz keyboard event that
// travels through the global input stream, not like text injected directly
// into one target process. Posting at the HID boundary is the closest Core
// Graphics path to a system-wide synthetic key press.
const GLOBAL_SYNTHETIC_EVENT_TAP_LOCATION: CGEventTapLocation = CGEventTapLocation::HID;
const KERN_SUCCESS: IOReturn = 0;
const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
const K_IOPM_ASSERTION_LEVEL_ON: u32 = 255;
const K_IO_MESSAGE_CAN_SYSTEM_SLEEP: Natural = 0xe000_0270;
const K_IO_MESSAGE_SYSTEM_WILL_SLEEP: Natural = 0xe000_0280;
const K_IO_MESSAGE_SYSTEM_HAS_POWERED_ON: Natural = 0xe000_0300;
const PREVENT_USER_IDLE_SYSTEM_SLEEP_ASSERTION_TYPE: &str = "PreventUserIdleSystemSleep";

struct OwnedCfString(CFStringRef);

impl OwnedCfString {
    fn new(value: &str) -> Result<Self, String> {
        let c_value = CString::new(value)
            .map_err(|_| "Power assertion text cannot contain NUL bytes.".to_string())?;
        let cf_string = unsafe {
            CFStringCreateWithCString(
                std::ptr::null(),
                c_value.as_ptr(),
                K_CF_STRING_ENCODING_UTF8,
            )
        };

        if cf_string.is_null() {
            return Err("Failed to create a CoreFoundation string.".to_string());
        }

        Ok(Self(cf_string))
    }

    fn as_ptr(&self) -> CFStringRef {
        self.0
    }
}

impl Drop for OwnedCfString {
    fn drop(&mut self) {
        unsafe {
            CFRelease(self.0);
        }
    }
}

struct MacosSystemSleepGuard {
    assertion_id: IOPMAssertionId,
}

impl SystemSleepGuard for MacosSystemSleepGuard {}

struct SystemWakeListenerContext {
    root_port: AtomicU32,
    on_wake: Box<dyn Fn() + Send + Sync>,
}

impl Drop for MacosSystemSleepGuard {
    fn drop(&mut self) {
        // Dropping the guard is the only place that should release the power
        // assertion. The engine keeps the value in scope only for the blocking
        // wait, so every schedule wake, config change, or app quit releases it
        // without needing a second cleanup path.
        let _ = unsafe { IOPMAssertionRelease(self.assertion_id) };
    }
}

unsafe extern "C" fn system_power_callback(
    refcon: *mut c_void,
    _service: IoService,
    message_type: Natural,
    message_argument: *mut c_void,
) {
    if refcon.is_null() {
        return;
    }

    let context = unsafe { &*(refcon as *const SystemWakeListenerContext) };
    match message_type {
        K_IO_MESSAGE_SYSTEM_HAS_POWERED_ON => {
            (context.on_wake)();
        }
        K_IO_MESSAGE_CAN_SYSTEM_SLEEP | K_IO_MESSAGE_SYSTEM_WILL_SLEEP => {
            let root_port = context.root_port.load(Ordering::Relaxed);
            if root_port != 0 {
                // These sleep messages must be acknowledged. We never veto
                // sleep here; this listener only asks the engine to re-check
                // wall-clock schedule state once macOS reports wake completion.
                let _ = unsafe { IOAllowPowerChange(root_port, message_argument as isize) };
            }
        }
        _ => {}
    }
}

fn missing_post_event_access_message() -> String {
    "never-afk needs Accessibility permission to send synthetic key events. Approve it in System Settings > Privacy & Security > Accessibility, then retry the action.".to_string()
}

fn post_event_access_granted() -> bool {
    unsafe { CGPreflightPostEventAccess() }
}

fn accessibility_trust_granted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

fn request_accessibility_trust_prompt() -> bool {
    let keys = unsafe { [kAXTrustedCheckOptionPrompt as *const c_void] };
    let values = unsafe { [kCFBooleanTrue as *const c_void] };
    let options = unsafe {
        CFDictionaryCreate(
            std::ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            keys.len() as CFIndex,
            std::ptr::null(),
            std::ptr::null(),
        )
    };

    if options.is_null() {
        return accessibility_trust_granted();
    }

    // This is intentionally separate from `CGRequestPostEventAccess()`: macOS
    // can report the lower-level Quartz event grant and the Accessibility trust
    // grant independently, and synthetic keyboard delivery needs one of those
    // trust signals to be visible to the current signed bundle.
    let trusted = unsafe { AXIsProcessTrustedWithOptions(options) };
    unsafe {
        CFRelease(options);
    }
    trusted
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

    let _ = request_accessibility_trust_prompt();

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

fn prevent_idle_sleep_with_power_assertion(
    reason: &str,
) -> Result<Box<dyn SystemSleepGuard>, String> {
    let assertion_type = OwnedCfString::new(PREVENT_USER_IDLE_SYSTEM_SLEEP_ASSERTION_TYPE)?;
    let assertion_name = OwnedCfString::new(reason)?;
    let mut assertion_id = 0;
    let result = unsafe {
        IOPMAssertionCreateWithName(
            assertion_type.as_ptr(),
            K_IOPM_ASSERTION_LEVEL_ON,
            assertion_name.as_ptr(),
            &mut assertion_id,
        )
    };

    if result != KERN_SUCCESS {
        return Err(format!(
            "macOS could not create an idle-sleep prevention assertion (IOReturn {result})."
        ));
    }

    Ok(Box::new(MacosSystemSleepGuard { assertion_id }))
}

pub fn spawn_system_wake_listener(
    on_wake: impl Fn() + Send + Sync + 'static,
) -> Result<(), String> {
    let (setup_tx, setup_rx) = mpsc::channel();

    thread::Builder::new()
        .name("never-afk-system-wake-listener".into())
        .spawn(move || {
            run_system_wake_listener(on_wake, setup_tx);
        })
        .map_err(|error| format!("Failed to spawn the macOS wake listener: {error}"))?;

    setup_rx
        .recv()
        .unwrap_or_else(|_| Err("The macOS wake listener stopped before setup finished.".into()))
}

fn run_system_wake_listener(
    on_wake: impl Fn() + Send + Sync + 'static,
    setup_tx: mpsc::Sender<Result<(), String>>,
) {
    let listener_context = Box::new(SystemWakeListenerContext {
        root_port: AtomicU32::new(0),
        on_wake: Box::new(on_wake),
    });
    let listener_context_ptr = Box::into_raw(listener_context);
    let mut notification_port = std::ptr::null_mut();
    let mut notifier = 0;

    let root_port = unsafe {
        IORegisterForSystemPower(
            listener_context_ptr as *mut c_void,
            &mut notification_port,
            system_power_callback,
            &mut notifier,
        )
    };

    if root_port == 0 || notification_port.is_null() {
        unsafe {
            drop(Box::from_raw(listener_context_ptr));
        }
        let _ = setup_tx.send(Err(
            "macOS sleep/wake notifications could not be registered.".to_string(),
        ));
        return;
    }

    unsafe {
        (*listener_context_ptr)
            .root_port
            .store(root_port, Ordering::Relaxed);
    }

    let run_loop_source = unsafe { IONotificationPortGetRunLoopSource(notification_port) };
    if run_loop_source.is_null() {
        unsafe {
            let _ = IODeregisterForSystemPower(&mut notifier);
            let _ = IOServiceClose(root_port);
            IONotificationPortDestroy(notification_port);
            drop(Box::from_raw(listener_context_ptr));
        }
        let _ = setup_tx.send(Err(
            "macOS sleep/wake notification source could not be created.".to_string(),
        ));
        return;
    }

    unsafe {
        CFRunLoopAddSource(
            CFRunLoopGetCurrent(),
            run_loop_source,
            kCFRunLoopDefaultMode,
        );
    }
    let _ = setup_tx.send(Ok(()));

    unsafe {
        CFRunLoopRun();

        let _ = IODeregisterForSystemPower(&mut notifier);
        let _ = IOServiceClose(root_port);
        IONotificationPortDestroy(notification_port);
        drop(Box::from_raw(listener_context_ptr));
    }
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

    fn prevent_idle_sleep(&self, reason: &str) -> Result<Box<dyn SystemSleepGuard>, String> {
        // A single IOKit power assertion is cheaper than polling while the
        // engine waits for the next schedule boundary. It prevents idle system
        // sleep, but still allows the display to sleep normally.
        prevent_idle_sleep_with_power_assertion(reason)
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
