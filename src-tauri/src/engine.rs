use std::thread;
use std::time::Duration;

use serde::Serialize;

use crate::schedule::{evaluate_schedule, ScheduleState};
use crate::state::SharedAppContext;

const ENGINE_POLL_INTERVAL: Duration = Duration::from_millis(250);
const ERROR_BACKOFF: Duration = Duration::from_secs(5);
const OBSERVATION_EPSILON: Duration = Duration::from_millis(150);

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EnginePhase {
    Disabled,
    Paused,
    ScheduledOff,
    WaitingQuiet,
    Observing,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub phase: EnginePhase,
    pub status_label: String,
    pub detail_label: String,
    pub resolved_input_label: String,
    pub next_check_in_seconds: Option<u64>,
    pub next_relevant_epoch_ms: Option<u64>,
    pub paused_until_epoch_ms: Option<u64>,
    pub last_fake_input_epoch_ms: Option<u64>,
    pub last_error: Option<String>,
}

impl RuntimeSnapshot {
    pub fn bootstrap(resolved_input_label: String, last_fake_input_epoch_ms: Option<u64>) -> Self {
        Self {
            phase: EnginePhase::WaitingQuiet,
            status_label: "Bootstrapping".into(),
            detail_label: "Preparing the resident engine.".into(),
            resolved_input_label,
            next_check_in_seconds: None,
            next_relevant_epoch_ms: None,
            paused_until_epoch_ms: None,
            last_fake_input_epoch_ms,
            last_error: None,
        }
    }
}

pub fn spawn_engine(context: SharedAppContext) -> Result<(), String> {
    thread::Builder::new()
        .name("never-afk-engine".into())
        .spawn(move || engine_loop(context))
        .map(|_| ())
        .map_err(|error| format!("Failed to spawn the engine thread: {error}"))
}

fn engine_loop(context: SharedAppContext) {
    loop {
        if context.is_quitting() {
            return;
        }

        let config = context.config_snapshot();
        let resolved_input_label = config
            .resolved_input(context.platform_kind())
            .map(|input| input.display_label)
            .unwrap_or_else(|error| format!("Unavailable ({error})"));

        if !config.enabled {
            context.update_runtime_snapshot(|snapshot| {
                snapshot.phase = EnginePhase::Disabled;
                snapshot.status_label = "Disabled".into();
                snapshot.detail_label = "The engine is disabled.".into();
                snapshot.resolved_input_label = resolved_input_label.clone();
                snapshot.next_check_in_seconds = None;
                snapshot.next_relevant_epoch_ms = None;
                snapshot.paused_until_epoch_ms = context.pause_until_epoch_ms();
            });
            context.refresh_tray();
            context.wait_until_wake(None);
            continue;
        }

        if let Some(paused_until_epoch_ms) = context.pause_until_epoch_ms() {
            let now_epoch_ms = context.now_epoch_ms();
            if paused_until_epoch_ms > now_epoch_ms {
                let remaining_seconds =
                    remaining_seconds_until_epoch(now_epoch_ms, paused_until_epoch_ms);
                context.update_runtime_snapshot(|snapshot| {
                    snapshot.phase = EnginePhase::Paused;
                    snapshot.status_label = "Paused".into();
                    snapshot.detail_label =
                        format!("Paused for another {}s.", remaining_seconds.max(1));
                    snapshot.resolved_input_label = resolved_input_label.clone();
                    snapshot.next_check_in_seconds = Some(remaining_seconds.max(1));
                    snapshot.next_relevant_epoch_ms = Some(paused_until_epoch_ms);
                    snapshot.paused_until_epoch_ms = Some(paused_until_epoch_ms);
                });
                context.refresh_tray();
                context.wait_until_wake(Some(paused_until_epoch_ms));
                continue;
            }

            context.clear_pause();
        }

        if context.take_manual_run_request() {
            if let Err(error) = context.perform_fake_input_now("manual run") {
                record_driver_error(&context, resolved_input_label.clone(), error);
                context.wait_for_signal(ERROR_BACKOFF);
            }
            continue;
        }

        let schedule_state = evaluate_schedule(&config);
        if !schedule_state.automatic_activity_allowed() {
            // Outside schedule we do not keep a watchdog loop alive. Instead we
            // publish the next relevant boundary and sleep until either that
            // deadline or an explicit wake signal arrives.
            let detail_label = match schedule_state {
                ScheduleState::Empty => {
                    "Automatic activity is off until at least one schedule range is added."
                        .to_string()
                }
                ScheduleState::Inactive {
                    next_start_epoch_ms: Some(_),
                } => "Automatic activity will resume in the next scheduled range.".to_string(),
                ScheduleState::Inactive {
                    next_start_epoch_ms: None,
                } => "Automatic activity is waiting for the next scheduled range.".to_string(),
                ScheduleState::Unrestricted | ScheduleState::Active { .. } => unreachable!(),
            };

            context.update_runtime_snapshot(|snapshot| {
                snapshot.phase = EnginePhase::ScheduledOff;
                snapshot.status_label = "Outside schedule".into();
                snapshot.detail_label = detail_label;
                snapshot.resolved_input_label = resolved_input_label.clone();
                snapshot.next_check_in_seconds =
                    schedule_state.next_relevant_epoch_ms().map(|deadline| {
                        remaining_seconds_until_epoch(context.now_epoch_ms(), deadline)
                    });
                snapshot.next_relevant_epoch_ms = schedule_state.next_relevant_epoch_ms();
                snapshot.paused_until_epoch_ms = context.pause_until_epoch_ms();
                snapshot.last_error = None;
            });
            context.refresh_tray();
            context.wait_until_wake(schedule_state.next_relevant_epoch_ms());
            continue;
        }

        let config_generation = context.config_generation();
        let active_range_end_epoch_ms = schedule_state.active_until_epoch_ms();
        if wait_for_quiet_period(
            &context,
            &config,
            &resolved_input_label,
            config_generation,
            active_range_end_epoch_ms,
        )
        .is_err()
        {
            continue;
        }

        if schedule_window_ended(&context, active_range_end_epoch_ms) {
            continue;
        }

        if observe_idle_window(
            &context,
            &config,
            &resolved_input_label,
            config_generation,
            active_range_end_epoch_ms,
        )
        .is_err()
        {
            continue;
        }

        if schedule_window_ended(&context, active_range_end_epoch_ms) {
            continue;
        }

        if let Err(error) = context.perform_fake_input_now("scheduled cycle") {
            record_driver_error(&context, resolved_input_label, error);
            context.wait_for_signal(ERROR_BACKOFF);
        }
    }
}

fn wait_for_quiet_period(
    context: &SharedAppContext,
    config: &crate::config::AppConfig,
    resolved_input_label: &str,
    config_generation: u64,
    active_range_end_epoch_ms: Option<u64>,
) -> Result<(), ()> {
    let started_at = std::time::Instant::now();
    let quiet_deadline_epoch_ms = context
        .now_epoch_ms()
        .saturating_add(config.quiet_period_seconds.saturating_mul(1000));

    loop {
        let elapsed = started_at.elapsed().as_secs();
        let remaining = config.quiet_period_seconds.saturating_sub(elapsed);
        let next_relevant_epoch_ms =
            earlier_deadline(Some(quiet_deadline_epoch_ms), active_range_end_epoch_ms);
        let next_check_in_seconds = next_relevant_epoch_ms
            .map(|deadline| remaining_seconds_until_epoch(context.now_epoch_ms(), deadline));
        let range_ends_first =
            active_range_end_epoch_ms.is_some_and(|range_end| range_end < quiet_deadline_epoch_ms);

        context.update_runtime_snapshot(|snapshot| {
            snapshot.phase = EnginePhase::WaitingQuiet;
            snapshot.status_label = "Enabled".into();
            snapshot.detail_label = if range_ends_first {
                format!(
                    "Current schedule window ends in {}s.",
                    next_check_in_seconds.unwrap_or(remaining).max(1)
                )
            } else {
                format!(
                    "Waiting {}s before observation starts.",
                    next_check_in_seconds.unwrap_or(remaining)
                )
            };
            snapshot.resolved_input_label = resolved_input_label.to_string();
            snapshot.next_check_in_seconds = next_check_in_seconds.or(Some(remaining));
            snapshot.next_relevant_epoch_ms = next_relevant_epoch_ms;
            snapshot.paused_until_epoch_ms = context.pause_until_epoch_ms();
            snapshot.last_error = None;
        });
        context.refresh_tray();

        if remaining == 0 {
            return Ok(());
        }

        if should_restart_current_cycle(context, config_generation, active_range_end_epoch_ms) {
            return Err(());
        }

        context.wait_for_signal(poll_wait_duration(
            context,
            next_relevant_epoch_ms,
            ENGINE_POLL_INTERVAL,
        ));
    }
}

fn observe_idle_window(
    context: &SharedAppContext,
    config: &crate::config::AppConfig,
    resolved_input_label: &str,
    config_generation: u64,
    active_range_end_epoch_ms: Option<u64>,
) -> Result<(), ()> {
    let started_at = std::time::Instant::now();
    let observation_deadline_epoch_ms = context
        .now_epoch_ms()
        .saturating_add(config.idle_confirmation_period_seconds.saturating_mul(1000));

    loop {
        let elapsed = started_at.elapsed();
        let elapsed_secs = elapsed.as_secs();
        let remaining = config
            .idle_confirmation_period_seconds
            .saturating_sub(elapsed_secs);
        let next_relevant_epoch_ms = earlier_deadline(
            Some(observation_deadline_epoch_ms),
            active_range_end_epoch_ms,
        );
        let next_check_in_seconds = next_relevant_epoch_ms
            .map(|deadline| remaining_seconds_until_epoch(context.now_epoch_ms(), deadline));
        let range_ends_first = active_range_end_epoch_ms
            .is_some_and(|range_end| range_end < observation_deadline_epoch_ms);

        context.update_runtime_snapshot(|snapshot| {
            snapshot.phase = EnginePhase::Observing;
            snapshot.status_label = "Observing".into();
            snapshot.detail_label = if range_ends_first {
                format!(
                    "Current schedule window ends in {}s.",
                    next_check_in_seconds.unwrap_or(remaining.max(1)).max(1)
                )
            } else {
                format!(
                    "Confirming idleness for another {}s.",
                    next_check_in_seconds.unwrap_or(remaining.max(1)).max(1)
                )
            };
            snapshot.resolved_input_label = resolved_input_label.to_string();
            snapshot.next_check_in_seconds = next_check_in_seconds.or(Some(remaining.max(1)));
            snapshot.next_relevant_epoch_ms = next_relevant_epoch_ms;
            snapshot.paused_until_epoch_ms = context.pause_until_epoch_ms();
            snapshot.last_error = None;
        });
        context.refresh_tray();

        match context.seconds_since_last_input() {
            Ok(idle_for) => {
                if human_input_detected(idle_for, elapsed) {
                    return Err(());
                }
            }
            Err(error) => {
                record_driver_error(context, resolved_input_label.to_string(), error);
                context.wait_for_signal(ERROR_BACKOFF);
                return Err(());
            }
        }

        if elapsed_secs >= config.idle_confirmation_period_seconds {
            return Ok(());
        }

        if should_restart_current_cycle(context, config_generation, active_range_end_epoch_ms) {
            return Err(());
        }

        context.wait_for_signal(poll_wait_duration(
            context,
            next_relevant_epoch_ms,
            ENGINE_POLL_INTERVAL,
        ));
    }
}

fn should_restart_current_cycle(
    context: &SharedAppContext,
    config_generation: u64,
    active_range_end_epoch_ms: Option<u64>,
) -> bool {
    context.is_quitting()
        || context.has_manual_run_request()
        || !context.config_snapshot().enabled
        || context.pause_until_epoch_ms().is_some()
        || context.config_generation() != config_generation
        || schedule_window_ended(context, active_range_end_epoch_ms)
}

fn record_driver_error(
    context: &SharedAppContext,
    resolved_input_label: impl Into<String>,
    error: String,
) {
    context.update_runtime_snapshot(|snapshot| {
        snapshot.phase = EnginePhase::Error;
        snapshot.status_label = "Driver error".into();
        snapshot.detail_label = error.clone();
        snapshot.resolved_input_label = resolved_input_label.into();
        snapshot.next_check_in_seconds = Some(ERROR_BACKOFF.as_secs());
        snapshot.next_relevant_epoch_ms = Some(
            context
                .now_epoch_ms()
                .saturating_add(ERROR_BACKOFF.as_millis() as u64),
        );
        snapshot.last_error = Some(error);
        snapshot.paused_until_epoch_ms = context.pause_until_epoch_ms();
    });
    context.refresh_tray();
}

fn schedule_window_ended(
    context: &SharedAppContext,
    active_range_end_epoch_ms: Option<u64>,
) -> bool {
    active_range_end_epoch_ms.is_some_and(|deadline| context.now_epoch_ms() >= deadline)
}

fn earlier_deadline(left: Option<u64>, right: Option<u64>) -> Option<u64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    }
}

fn remaining_seconds_until_epoch(now_epoch_ms: u64, deadline_epoch_ms: u64) -> u64 {
    let remaining_ms = deadline_epoch_ms.saturating_sub(now_epoch_ms);
    if remaining_ms == 0 {
        0
    } else {
        remaining_ms.saturating_add(999) / 1000
    }
}

fn poll_wait_duration(
    context: &SharedAppContext,
    next_relevant_epoch_ms: Option<u64>,
    fallback: Duration,
) -> Duration {
    let Some(deadline_epoch_ms) = next_relevant_epoch_ms else {
        return fallback;
    };

    let remaining_ms = deadline_epoch_ms.saturating_sub(context.now_epoch_ms());
    if remaining_ms == 0 {
        return Duration::ZERO;
    }

    fallback.min(Duration::from_millis(remaining_ms))
}

pub fn human_input_detected(idle_for: Duration, observation_elapsed: Duration) -> bool {
    idle_for + OBSERVATION_EPSILON < observation_elapsed
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use crate::engine::human_input_detected;

    #[test]
    fn keeps_observation_when_idle_is_older_than_observation() {
        assert!(!human_input_detected(
            Duration::from_secs(8),
            Duration::from_secs(5)
        ));
    }

    #[test]
    fn detects_human_input_inside_observation_window() {
        assert!(human_input_detected(
            Duration::from_secs(2),
            Duration::from_secs(5)
        ));
    }
}
