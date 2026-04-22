use chrono::{
    DateTime, Datelike, Duration as ChronoDuration, Local, LocalResult, NaiveDate, TimeZone,
};

use crate::config::{AppConfig, ScheduleRange, ScheduleWeekday};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScheduleState {
    Unrestricted,
    Empty,
    Active { active_until_epoch_ms: u64 },
    Inactive { next_start_epoch_ms: Option<u64> },
}

impl ScheduleState {
    pub fn automatic_activity_allowed(self) -> bool {
        matches!(self, Self::Unrestricted | Self::Active { .. })
    }

    pub fn next_relevant_epoch_ms(self) -> Option<u64> {
        match self {
            Self::Active {
                active_until_epoch_ms,
            } => Some(active_until_epoch_ms),
            Self::Inactive {
                next_start_epoch_ms,
            } => next_start_epoch_ms,
            Self::Unrestricted | Self::Empty => None,
        }
    }

    pub fn active_until_epoch_ms(self) -> Option<u64> {
        match self {
            Self::Active {
                active_until_epoch_ms,
            } => Some(active_until_epoch_ms),
            Self::Unrestricted | Self::Inactive { .. } | Self::Empty => None,
        }
    }
}

pub fn evaluate_schedule(config: &AppConfig) -> ScheduleState {
    evaluate_schedule_at(config, Local::now())
}

fn evaluate_schedule_at<Tz>(config: &AppConfig, now: DateTime<Tz>) -> ScheduleState
where
    Tz: TimeZone + Clone,
    Tz::Offset: Copy,
{
    if !config.schedule_enabled {
        return ScheduleState::Unrestricted;
    }

    if config.schedule_ranges.is_empty() {
        return ScheduleState::Empty;
    }

    let today = now.date_naive();
    let timezone = now.timezone();
    let mut active_until_epoch_ms = None;
    let mut next_start_epoch_ms = None;

    // A seven-day schedule repeats weekly, so scanning today plus the next
    // seven dates is enough to find both the current active window and the
    // next start after "now" without any background polling.
    for day_offset in 0..=7 {
        let Some(date) = today.checked_add_signed(ChronoDuration::days(day_offset)) else {
            continue;
        };
        let weekday = ScheduleWeekday::from_chrono(date.weekday());

        for range in &config.schedule_ranges {
            if !range.days_of_week.contains(&weekday) {
                continue;
            }

            let Some(start_at) = local_datetime_from_minutes(&timezone, date, range, true) else {
                continue;
            };
            let Some(end_at) = local_datetime_from_minutes(&timezone, date, range, false) else {
                continue;
            };

            if start_at <= now && now < end_at {
                let end_epoch_ms = epoch_ms(end_at);
                active_until_epoch_ms = Some(
                    active_until_epoch_ms
                        .map_or(end_epoch_ms, |current: u64| current.max(end_epoch_ms)),
                );
                continue;
            }

            if start_at > now {
                let start_epoch_ms = epoch_ms(start_at);
                next_start_epoch_ms = Some(
                    next_start_epoch_ms
                        .map_or(start_epoch_ms, |current: u64| current.min(start_epoch_ms)),
                );
            }
        }
    }

    if let Some(active_until_epoch_ms) = active_until_epoch_ms {
        ScheduleState::Active {
            active_until_epoch_ms,
        }
    } else {
        ScheduleState::Inactive {
            next_start_epoch_ms,
        }
    }
}

fn local_datetime_from_minutes<Tz>(
    timezone: &Tz,
    date: NaiveDate,
    range: &ScheduleRange,
    use_start: bool,
) -> Option<DateTime<Tz>>
where
    Tz: TimeZone + Clone,
    Tz::Offset: Copy,
{
    let minutes = if use_start {
        range.start_minutes
    } else {
        range.end_minutes
    };
    let hour = u32::from(minutes / 60);
    let minute = u32::from(minutes % 60);
    let naive = date.and_hms_opt(hour, minute, 0)?;

    // Local wall-clock times can be ambiguous around DST boundaries. Picking
    // the earliest valid instant keeps schedule transitions deterministic
    // without adding another layer of state or listeners.
    match timezone.from_local_datetime(&naive) {
        LocalResult::Single(datetime) => Some(datetime),
        LocalResult::Ambiguous(earliest, _) => Some(earliest),
        LocalResult::None => None,
    }
}

fn epoch_ms<Tz>(datetime: DateTime<Tz>) -> u64
where
    Tz: TimeZone,
{
    datetime.timestamp_millis() as u64
}

#[cfg(test)]
mod tests {
    use chrono::{FixedOffset, TimeZone};

    use crate::config::{ActivityMethod, PlatformKeyMapping, SafeKeyPreset};

    use super::*;

    fn base_config() -> AppConfig {
        AppConfig {
            enabled: true,
            quiet_period_seconds: 120,
            idle_confirmation_period_seconds: 120,
            start_at_login: false,
            schedule_enabled: true,
            schedule_ranges: Vec::new(),
            activity_method: ActivityMethod::Keyboard,
            selected_key: SafeKeyPreset::F15,
            show_last_event_in_menu_bar: true,
            custom_input_enabled: false,
            custom_input_value: None,
            platform_key_mapping: PlatformKeyMapping::default(),
        }
    }

    fn weekday_range(
        days_of_week: Vec<ScheduleWeekday>,
        start_minutes: u16,
        end_minutes: u16,
    ) -> ScheduleRange {
        ScheduleRange {
            days_of_week,
            start_minutes,
            end_minutes,
        }
    }

    fn madrid_like_offset() -> FixedOffset {
        FixedOffset::east_opt(2 * 60 * 60).unwrap()
    }

    #[test]
    fn allows_automatic_activity_when_schedule_is_disabled() {
        let mut config = base_config();
        config.schedule_enabled = false;

        let state = evaluate_schedule_at(
            &config,
            madrid_like_offset()
                .with_ymd_and_hms(2026, 4, 22, 10, 0, 0)
                .unwrap(),
        );

        assert_eq!(state, ScheduleState::Unrestricted);
    }

    #[test]
    fn reports_empty_when_schedule_is_enabled_without_ranges() {
        let state = evaluate_schedule_at(
            &base_config(),
            madrid_like_offset()
                .with_ymd_and_hms(2026, 4, 22, 10, 0, 0)
                .unwrap(),
        );

        assert_eq!(state, ScheduleState::Empty);
    }

    #[test]
    fn detects_when_now_is_inside_a_range() {
        let mut config = base_config();
        config.schedule_ranges = vec![weekday_range(vec![ScheduleWeekday::Wed], 9 * 60, 12 * 60)];

        let now = madrid_like_offset()
            .with_ymd_and_hms(2026, 4, 22, 10, 15, 0)
            .unwrap();
        let state = evaluate_schedule_at(&config, now);

        assert_eq!(
            state,
            ScheduleState::Active {
                active_until_epoch_ms: epoch_ms(
                    madrid_like_offset()
                        .with_ymd_and_hms(2026, 4, 22, 12, 0, 0)
                        .unwrap()
                ),
            }
        );
    }

    #[test]
    fn finds_the_next_range_later_on_the_same_day() {
        let mut config = base_config();
        config.schedule_ranges = vec![weekday_range(vec![ScheduleWeekday::Wed], 14 * 60, 16 * 60)];

        let now = madrid_like_offset()
            .with_ymd_and_hms(2026, 4, 22, 10, 15, 0)
            .unwrap();
        let state = evaluate_schedule_at(&config, now);

        assert_eq!(
            state,
            ScheduleState::Inactive {
                next_start_epoch_ms: Some(epoch_ms(
                    madrid_like_offset()
                        .with_ymd_and_hms(2026, 4, 22, 14, 0, 0)
                        .unwrap()
                )),
            }
        );
    }

    #[test]
    fn finds_the_next_range_on_a_later_day() {
        let mut config = base_config();
        config.schedule_ranges = vec![weekday_range(vec![ScheduleWeekday::Fri], 9 * 60, 17 * 60)];

        let now = madrid_like_offset()
            .with_ymd_and_hms(2026, 4, 22, 10, 15, 0)
            .unwrap();
        let state = evaluate_schedule_at(&config, now);

        assert_eq!(
            state,
            ScheduleState::Inactive {
                next_start_epoch_ms: Some(epoch_ms(
                    madrid_like_offset()
                        .with_ymd_and_hms(2026, 4, 24, 9, 0, 0)
                        .unwrap()
                )),
            }
        );
    }

    #[test]
    fn overlapping_ranges_behave_like_a_union() {
        let mut config = base_config();
        config.schedule_ranges = vec![
            weekday_range(vec![ScheduleWeekday::Wed], 9 * 60, 12 * 60),
            weekday_range(vec![ScheduleWeekday::Wed], 11 * 60, 13 * 60),
        ];

        let now = madrid_like_offset()
            .with_ymd_and_hms(2026, 4, 22, 11, 30, 0)
            .unwrap();
        let state = evaluate_schedule_at(&config, now);

        assert_eq!(
            state,
            ScheduleState::Active {
                active_until_epoch_ms: epoch_ms(
                    madrid_like_offset()
                        .with_ymd_and_hms(2026, 4, 22, 13, 0, 0)
                        .unwrap()
                ),
            }
        );
    }

    #[test]
    fn end_of_range_is_exclusive() {
        let mut config = base_config();
        config.schedule_ranges = vec![weekday_range(vec![ScheduleWeekday::Wed], 9 * 60, 12 * 60)];

        let now = madrid_like_offset()
            .with_ymd_and_hms(2026, 4, 22, 12, 0, 0)
            .unwrap();
        let state = evaluate_schedule_at(&config, now);

        assert_eq!(state.automatic_activity_allowed(), false);
    }
}
