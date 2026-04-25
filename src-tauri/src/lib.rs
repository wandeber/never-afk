mod config;
mod engine;
mod platform;
mod schedule;
mod state;
mod tray;

use config::AppConfig;
use engine::RuntimeSnapshot;
use state::{FrontendState, SharedAppContext};
use tauri::{Manager, RunEvent, State, WindowEvent};

#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri_plugin_autostart::MacosLauncher;

fn boxed_error(message: String) -> Box<dyn std::error::Error> {
    Box::new(std::io::Error::new(std::io::ErrorKind::Other, message))
}

#[tauri::command]
fn get_frontend_state(state: State<'_, SharedAppContext>) -> FrontendState {
    state.frontend_state()
}

#[tauri::command]
fn get_runtime_snapshot(state: State<'_, SharedAppContext>) -> RuntimeSnapshot {
    state.runtime_snapshot()
}

#[tauri::command]
fn save_config(
    state: State<'_, SharedAppContext>,
    config: AppConfig,
) -> Result<FrontendState, String> {
    state.persist_config_change(config)?;
    Ok(state.frontend_state())
}

#[tauri::command]
fn request_synthetic_input_access_command(
    state: State<'_, SharedAppContext>,
) -> Result<FrontendState, String> {
    state.request_synthetic_input_access()?;
    Ok(state.frontend_state())
}

#[tauri::command]
fn reveal_synthetic_input_access_target_command(
    state: State<'_, SharedAppContext>,
) -> Result<FrontendState, String> {
    state.reveal_synthetic_input_access_target()?;
    Ok(state.frontend_state())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .on_menu_event(|app_handle, event| {
            if let Some(context) = app_handle.try_state::<SharedAppContext>() {
                let _ = tray::handle_menu_event(context.inner().clone(), event.id().as_ref());
            }
        })
        .on_tray_icon_event(|app_handle, event| {
            if let Some(context) = app_handle.try_state::<SharedAppContext>() {
                let _ = tray::handle_tray_click(context.inner().clone(), &event);
            }
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if let Some(context) = window.app_handle().try_state::<SharedAppContext>() {
                    if !context.is_quitting() {
                        api.prevent_close();
                        let _ = context.hide_settings_window();
                    }
                }
            }
        })
        .setup(|app| {
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            app.handle()
                .plugin(tauri_plugin_autostart::init(
                    MacosLauncher::LaunchAgent,
                    None::<Vec<&str>>,
                ))
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;

            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(ActivationPolicy::Accessory);
                let _ = app.handle().set_dock_visibility(false);
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }

            let context = state::AppContext::bootstrap(
                app.handle().clone(),
                platform::create_platform_driver(),
            )
            .map_err(boxed_error)?;

            let tray_handles = tray::build_tray(app.handle()).map_err(boxed_error)?;
            context.set_tray_handles(tray_handles);
            context.refresh_tray();

            app.manage(context.clone());
            engine::spawn_engine(context).map_err(boxed_error)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_frontend_state,
            get_runtime_snapshot,
            save_config,
            request_synthetic_input_access_command,
            reveal_synthetic_input_access_target_command
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Resumed = event {
            if let Some(context) = app_handle.try_state::<SharedAppContext>() {
                context.wake_engine();
            }
        }
    });
}
