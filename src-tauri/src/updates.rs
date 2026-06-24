use serde::Serialize;
use tauri::{AppHandle, Runtime, Wry};
use tauri_plugin_updater::UpdaterExt;
use url::Url;

use crate::config::save_last_update_check_epoch_ms;
use crate::state::SharedAppContext;

const GITHUB_RELEASES_BASE: &str = "https://github.com/wandeber/never-afk/releases";
const UPDATER_PUBLIC_KEY: &str = "";
const WEEKLY_AUTO_CHECK_INTERVAL_MS: u64 = 7 * 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UpdateChannel {
    Stable,
    Beta,
    Canary,
}

impl UpdateChannel {
    fn from_compile_time() -> Self {
        match option_env!("NEVER_AFK_UPDATE_CHANNEL")
            .unwrap_or("stable")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "beta" => Self::Beta,
            "canary" => Self::Canary,
            _ => Self::Stable,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
            Self::Canary => "canary",
        }
    }

    fn endpoint(self) -> Result<Url, String> {
        let url = match self {
            Self::Stable => format!("{GITHUB_RELEASES_BASE}/latest/download/latest.json"),
            Self::Beta => format!("{GITHUB_RELEASES_BASE}/download/latest-beta/latest.json"),
            Self::Canary => format!("{GITHUB_RELEASES_BASE}/download/latest-canary/latest.json"),
        };

        Url::parse(&url).map_err(|error| format!("Invalid updater endpoint: {error}"))
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UpdatePhase {
    Idle,
    Checking,
    Available,
    NotAvailable,
    Downloading,
    Installing,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    pub channel: UpdateChannel,
    pub configured: bool,
    pub phase: UpdatePhase,
    pub current_version: String,
    pub available_version: Option<String>,
    pub notes: Option<String>,
    pub downloaded_bytes: Option<u64>,
    pub content_length_bytes: Option<u64>,
    pub last_checked_epoch_ms: Option<u64>,
    pub last_error: Option<String>,
}

impl UpdateSnapshot {
    pub fn bootstrap(last_checked_epoch_ms: Option<u64>) -> Self {
        Self {
            channel: UpdateChannel::from_compile_time(),
            configured: updater_public_key().is_some(),
            phase: UpdatePhase::Idle,
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            available_version: None,
            notes: None,
            downloaded_bytes: None,
            content_length_bytes: None,
            last_checked_epoch_ms: last_checked_epoch_ms,
            last_error: None,
        }
    }
}

pub fn updater_plugin_builder() -> tauri_plugin_updater::Builder {
    let builder = tauri_plugin_updater::Builder::new();

    match updater_public_key() {
        Some(public_key) => builder.pubkey(public_key),
        None => builder,
    }
}

pub async fn check_for_update(
    app_handle: AppHandle<Wry>,
    context: SharedAppContext,
) -> Result<(), String> {
    perform_update_check(app_handle, context, CheckMode::Manual).await
}

pub fn maybe_spawn_weekly_auto_check(context: SharedAppContext) {
    if !should_run_weekly_auto_check(&context) {
        return;
    }

    let app_handle = context.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let _ = perform_update_check(app_handle, context, CheckMode::Automatic).await;
    });
}

pub async fn download_install_and_restart(
    app_handle: AppHandle<Wry>,
    context: SharedAppContext,
) -> Result<(), String> {
    let _guard = begin_update_action(&context)?;
    require_updater_configuration()?;
    set_update_phase(&context, UpdatePhase::Checking);

    let Some(update) = build_updater(&app_handle)?
        .check()
        .await
        .map_err(|error| format!("Update check failed: {error}"))?
    else {
        context.update_update_snapshot(|snapshot| {
            snapshot.phase = UpdatePhase::NotAvailable;
            snapshot.available_version = None;
            snapshot.notes = None;
            snapshot.downloaded_bytes = None;
            snapshot.content_length_bytes = None;
            snapshot.last_checked_epoch_ms = Some(context.now_epoch_ms());
            snapshot.last_error = None;
        });
        context.refresh_tray();
        return Ok(());
    };

    let available_version = update.version.clone();
    let notes = update.body.clone();
    context.update_update_snapshot(|snapshot| {
        snapshot.phase = UpdatePhase::Downloading;
        snapshot.available_version = Some(available_version);
        snapshot.notes = notes;
        snapshot.downloaded_bytes = Some(0);
        snapshot.content_length_bytes = None;
        snapshot.last_error = None;
    });
    context.refresh_tray();

    let mut downloaded_bytes = 0_u64;
    let progress_context = context.clone();
    let finished_context = context.clone();
    update
        .download_and_install(
            move |chunk_length, content_length| {
                downloaded_bytes = downloaded_bytes.saturating_add(chunk_length as u64);
                progress_context.update_update_snapshot(|snapshot| {
                    snapshot.phase = UpdatePhase::Downloading;
                    snapshot.downloaded_bytes = Some(downloaded_bytes);
                    snapshot.content_length_bytes = content_length;
                });
                progress_context.refresh_tray();
            },
            move || {
                finished_context.update_update_snapshot(|snapshot| {
                    snapshot.phase = UpdatePhase::Installing;
                    snapshot.last_error = None;
                });
                finished_context.refresh_tray();
            },
        )
        .await
        .map_err(|error| {
            let message = format!("Update install failed: {error}");
            record_update_error(&context, message.clone());
            message
        })?;

    context.update_update_snapshot(|snapshot| {
        snapshot.phase = UpdatePhase::Installing;
        snapshot.last_error = None;
    });
    context.refresh_tray();
    app_handle.restart();
}

pub fn record_update_error(context: &SharedAppContext, error: String) {
    context.update_update_snapshot(|snapshot| {
        snapshot.phase = UpdatePhase::Error;
        snapshot.last_error = Some(error);
        snapshot.downloaded_bytes = None;
        snapshot.content_length_bytes = None;
    });
    context.refresh_tray();
}

fn set_update_phase(context: &SharedAppContext, phase: UpdatePhase) {
    context.update_update_snapshot(|snapshot| {
        snapshot.phase = phase;
        snapshot.downloaded_bytes = None;
        snapshot.content_length_bytes = None;
        snapshot.last_error = None;
    });
    context.refresh_tray();
}

async fn perform_update_check(
    app_handle: AppHandle<Wry>,
    context: SharedAppContext,
    mode: CheckMode,
) -> Result<(), String> {
    let _guard = begin_update_action(&context)?;
    require_updater_configuration()?;

    let checked_at = context.now_epoch_ms();
    set_update_phase(&context, UpdatePhase::Checking);
    context.update_update_snapshot(|snapshot| {
        snapshot.last_checked_epoch_ms = Some(checked_at);
    });
    context.refresh_tray();

    match build_updater(&app_handle)?.check().await {
        Ok(Some(update)) => {
            context.update_update_snapshot(|snapshot| {
                snapshot.phase = UpdatePhase::Available;
                snapshot.available_version = Some(update.version);
                snapshot.notes = update.body;
                snapshot.downloaded_bytes = None;
                snapshot.content_length_bytes = None;
                snapshot.last_checked_epoch_ms = Some(checked_at);
                snapshot.last_error = None;
            });
            context.refresh_tray();
            Ok(())
        }
        Ok(None) => {
            save_last_update_check_epoch_ms(context.app_handle(), checked_at)?;
            context.update_update_snapshot(|snapshot| {
                snapshot.phase = UpdatePhase::NotAvailable;
                snapshot.available_version = None;
                snapshot.notes = None;
                snapshot.downloaded_bytes = None;
                snapshot.content_length_bytes = None;
                snapshot.last_checked_epoch_ms = Some(checked_at);
                snapshot.last_error = None;
            });
            context.refresh_tray();
            Ok(())
        }
        Err(error) => {
            let message = format!("Update check failed: {error}");
            match mode {
                CheckMode::Manual => {
                    let _ = save_last_update_check_epoch_ms(context.app_handle(), checked_at);
                    record_update_error(&context, message.clone());
                    Err(message)
                }
                CheckMode::Automatic => {
                    let _ = save_last_update_check_epoch_ms(context.app_handle(), checked_at);
                    // Automatic checks are opportunistic. We remember that the
                    // weekly attempt happened, but avoid leaving a scary tray
                    // error just because the network or GitHub was unavailable.
                    context.update_update_snapshot(|snapshot| {
                        snapshot.phase = UpdatePhase::Idle;
                        snapshot.last_error = None;
                        snapshot.downloaded_bytes = None;
                        snapshot.content_length_bytes = None;
                    });
                    context.refresh_tray();
                    Ok(())
                }
            }
        }
    }
}

fn should_run_weekly_auto_check(context: &SharedAppContext) -> bool {
    if !updater_public_key().is_some() || !context.config_snapshot().enabled {
        return false;
    }

    let snapshot = context.update_snapshot();
    if matches!(
        snapshot.phase,
        UpdatePhase::Available
            | UpdatePhase::Checking
            | UpdatePhase::Downloading
            | UpdatePhase::Installing
    ) {
        return false;
    }

    weekly_auto_check_due(context.now_epoch_ms(), snapshot.last_checked_epoch_ms)
}

fn weekly_auto_check_due(now_epoch_ms: u64, last_checked_epoch_ms: Option<u64>) -> bool {
    match last_checked_epoch_ms {
        Some(last_checked_epoch_ms) => {
            now_epoch_ms.saturating_sub(last_checked_epoch_ms) >= WEEKLY_AUTO_CHECK_INTERVAL_MS
        }
        None => true,
    }
}

fn begin_update_action(context: &SharedAppContext) -> Result<UpdateActionGuard, String> {
    if context.try_begin_update_action() {
        Ok(UpdateActionGuard {
            context: context.clone(),
        })
    } else {
        Err("An update action is already running.".to_string())
    }
}

struct UpdateActionGuard {
    context: SharedAppContext,
}

impl Drop for UpdateActionGuard {
    fn drop(&mut self) {
        self.context.finish_update_action();
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CheckMode {
    Manual,
    Automatic,
}

#[cfg(test)]
mod tests {
    use super::{weekly_auto_check_due, WEEKLY_AUTO_CHECK_INTERVAL_MS};

    #[test]
    fn weekly_auto_check_runs_when_no_previous_check_exists() {
        assert!(weekly_auto_check_due(1_000, None));
    }

    #[test]
    fn weekly_auto_check_waits_until_interval_has_elapsed() {
        let now = WEEKLY_AUTO_CHECK_INTERVAL_MS * 2;

        assert!(!weekly_auto_check_due(
            now,
            Some(now - WEEKLY_AUTO_CHECK_INTERVAL_MS + 1),
        ));
        assert!(weekly_auto_check_due(
            now,
            Some(now - WEEKLY_AUTO_CHECK_INTERVAL_MS),
        ));
    }
}

fn build_updater<R: Runtime>(
    app_handle: &AppHandle<R>,
) -> Result<tauri_plugin_updater::Updater, String> {
    let channel = UpdateChannel::from_compile_time();
    app_handle
        .updater_builder()
        .endpoints(vec![channel.endpoint()?])
        .map_err(|error| format!("Failed to configure updater endpoint: {error}"))?
        .build()
        .map_err(|error| format!("Failed to build updater: {error}"))
}

fn require_updater_configuration() -> Result<(), String> {
    if updater_public_key().is_some() {
        Ok(())
    } else {
        Err(
            "Updater public key is not configured. Set NEVER_AFK_UPDATER_PUBLIC_KEY when building the app."
                .to_string(),
        )
    }
}

fn updater_public_key() -> Option<&'static str> {
    option_env!("NEVER_AFK_UPDATER_PUBLIC_KEY")
        .filter(|value| !value.trim().is_empty())
        .or_else(|| (!UPDATER_PUBLIC_KEY.trim().is_empty()).then_some(UPDATER_PUBLIC_KEY))
}
