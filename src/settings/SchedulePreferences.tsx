import type { AppConfig, ScheduleRange, ScheduleWeekday } from "../types";

type SchedulePreferencesProps = {
  config: AppConfig;
  onChange: (nextConfig: AppConfig) => void;
};

const WEEKDAY_OPTIONS: ScheduleWeekday[] = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
];
const MAX_MINUTE_OF_DAY = 23 * 60 + 59;
const LATEST_VALID_START_MINUTE = MAX_MINUTE_OF_DAY - 1;

const DEFAULT_SCHEDULE_RANGE: ScheduleRange = {
  daysOfWeek: ["Mon"],
  startMinutes: 9 * 60,
  endMinutes: 17 * 60,
};

function sortWeekdays(daysOfWeek: ScheduleWeekday[]) {
  // Persist weekday selections in a stable Monday-first order so autosave does
  // not reshuffle the JSON payload every time the user toggles a button.
  return [...daysOfWeek].sort(
    (left, right) =>
      WEEKDAY_OPTIONS.indexOf(left) - WEEKDAY_OPTIONS.indexOf(right),
  );
}

function formatMinutesAsTime(minutes: number) {
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const remainingMinutes = (minutes % 60).toString().padStart(2, "0");
  return `${hours}:${remainingMinutes}`;
}

function parseTimeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
}

function toggleWeekday(
  currentDays: ScheduleWeekday[],
  weekday: ScheduleWeekday,
) {
  if (currentDays.includes(weekday) && currentDays.length === 1) {
    return currentDays;
  }

  // The backend treats days as a set, but the UI keeps them in a predictable
  // order so the range rows stay easy to scan after repeated edits.
  const nextDays = currentDays.includes(weekday)
    ? currentDays.filter((day) => day !== weekday)
    : [...currentDays, weekday];

  return sortWeekdays(nextDays);
}

function updateStartMinutes(range: ScheduleRange, startMinutes: number) {
  // Autosave would otherwise persist a temporarily invalid "start >= end"
  // state while the user is still editing both fields, so the UI keeps the
  // paired end time nudged forward when needed.
  const safeStartMinutes = Math.min(startMinutes, LATEST_VALID_START_MINUTE);
  const safeEndMinutes =
    range.endMinutes <= safeStartMinutes
      ? Math.min(safeStartMinutes + 60, MAX_MINUTE_OF_DAY)
      : range.endMinutes;

  return {
    ...range,
    startMinutes: safeStartMinutes,
    endMinutes: Math.max(safeEndMinutes, safeStartMinutes + 1),
  };
}

function updateEndMinutes(range: ScheduleRange, endMinutes: number) {
  // Same idea in the opposite direction: the user can drag the end time
  // earlier, but the stored range remains valid throughout the edit.
  const safeEndMinutes = Math.min(Math.max(endMinutes, 1), MAX_MINUTE_OF_DAY);
  const safeStartMinutes =
    range.startMinutes >= safeEndMinutes
      ? Math.max(safeEndMinutes - 60, 0)
      : range.startMinutes;

  return {
    ...range,
    startMinutes: Math.min(safeStartMinutes, safeEndMinutes - 1),
    endMinutes: safeEndMinutes,
  };
}

export function SchedulePreferences({
  config,
  onChange,
}: SchedulePreferencesProps) {
  const updateRange = (
    index: number,
    updater: (range: ScheduleRange) => ScheduleRange,
  ) => {
    const nextRanges = config.scheduleRanges.map((range, currentIndex) =>
      currentIndex === index ? updater(range) : range,
    );
    onChange({ ...config, scheduleRanges: nextRanges });
  };

  const appendRange = () => {
    onChange({
      ...config,
      scheduleRanges: [
        ...config.scheduleRanges,
        {
          ...DEFAULT_SCHEDULE_RANGE,
          daysOfWeek: [...DEFAULT_SCHEDULE_RANGE.daysOfWeek],
        },
      ],
    });
  };

  const removeRange = (index: number) => {
    onChange({
      ...config,
      scheduleRanges: config.scheduleRanges.filter(
        (_, currentIndex) => currentIndex !== index,
      ),
    });
  };

  return (
    <section className="preferences-group">
      <div className="preferences-group-header">
        <h2>Schedule</h2>
        <p>Limit automatic activity to specific local time windows.</p>
      </div>

      <div className="preferences-list">
        <div className="preference-row">
          <div className="preference-copy">
            <label className="preference-title" htmlFor="schedule-enabled">
              Use schedule
            </label>
            <p id="schedule-enabled-description">
              Keep automatic cycles active only inside the ranges configured
              below.
            </p>
          </div>

          <div className="preference-control">
            <label className="switch-control" htmlFor="schedule-enabled">
              <input
                id="schedule-enabled"
                className="switch-input"
                type="checkbox"
                role="switch"
                checked={config.scheduleEnabled}
                aria-describedby="schedule-enabled-description"
                onChange={(event) =>
                  onChange({
                    ...config,
                    scheduleEnabled: event.currentTarget.checked,
                  })
                }
              />
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
              <span className="switch-state" aria-hidden="true">
                {config.scheduleEnabled ? "On" : "Off"}
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className="schedule-editor">
        <p className="schedule-helper">
          Add as many windows as you need. Automatic activity runs only inside
          them, while manual actions still work outside schedule.
        </p>

        {config.scheduleRanges.length === 0 ? (
          <p className="schedule-empty-state">
            When schedule is on and no ranges exist, automatic activity stays
            off until you add one.
          </p>
        ) : (
          <div className="schedule-range-list">
            {config.scheduleRanges.map((range, index) => (
              <section
                className="schedule-range-card"
                key={index}
                aria-labelledby={`schedule-range-${index + 1}-title`}
              >
                <div className="schedule-range-header">
                  <div>
                    <h3 id={`schedule-range-${index + 1}-title`}>
                      Range {index + 1}
                    </h3>
                    <p>Pick weekdays plus a start and end time.</p>
                  </div>

                  <button
                    className="secondary-button"
                    type="button"
                    aria-label={`Remove range ${index + 1}`}
                    onClick={() => removeRange(index)}
                  >
                    Remove
                  </button>
                </div>

                <div className="schedule-card-grid">
                  <div className="schedule-field schedule-field-days">
                    <div
                      className="weekday-toggle-grid"
                      role="group"
                      aria-label={`Days for range ${index + 1}`}
                    >
                      {WEEKDAY_OPTIONS.map((weekday) => {
                        const selected = range.daysOfWeek.includes(weekday);

                        return (
                          <button
                            key={weekday}
                            className={
                              selected
                                ? "weekday-toggle weekday-toggle-active"
                                : "weekday-toggle"
                            }
                            type="button"
                            aria-pressed={selected}
                            onClick={() =>
                              updateRange(index, (currentRange) => ({
                                ...currentRange,
                                daysOfWeek: toggleWeekday(
                                  currentRange.daysOfWeek,
                                  weekday,
                                ),
                              }))
                            }
                          >
                            {weekday}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="schedule-field schedule-field-time">
                    <div className="schedule-time-grid">
                      <label className="schedule-time-field">
                        <span>Start</span>
                        <input
                          className="preference-input schedule-time-input"
                          type="time"
                          step={60}
                          value={formatMinutesAsTime(range.startMinutes)}
                          aria-label={`Start time for range ${index + 1}`}
                          onChange={(event) => {
                            const parsed = parseTimeToMinutes(
                              event.currentTarget.value,
                            );
                            if (parsed === null) {
                              return;
                            }

                            updateRange(index, (currentRange) =>
                              updateStartMinutes(currentRange, parsed),
                            );
                          }}
                        />
                      </label>

                      <label className="schedule-time-field">
                        <span>End</span>
                        <input
                          className="preference-input schedule-time-input"
                          type="time"
                          step={60}
                          value={formatMinutesAsTime(range.endMinutes)}
                          aria-label={`End time for range ${index + 1}`}
                          onChange={(event) => {
                            const parsed = parseTimeToMinutes(
                              event.currentTarget.value,
                            );
                            if (parsed === null) {
                              return;
                            }

                            updateRange(index, (currentRange) =>
                              updateEndMinutes(currentRange, parsed),
                            );
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}

        <div className="schedule-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={appendRange}
          >
            Add Range
          </button>
        </div>
      </div>
    </section>
  );
}
