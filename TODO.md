# TODO

## Relaunch only during schedule windows

Add an optional battery-saver mode that lets `never-afk` exit while automatic
activity is outside the configured schedule, then relaunch when the next
schedule window starts.

Implementation notes:

- On macOS, use a per-user LaunchAgent with `StartCalendarInterval` for the
  schedule start times and `RunAtLoad` so the app can self-check after login or
  wake. If the current time is still outside a configured range, the app should
  update the next launch schedule and exit again.
- On Windows, use Task Scheduler with calendar/logon triggers and the equivalent
  "run as soon as possible after a scheduled start is missed" behavior. Do not
  enable wake-from-sleep options.
- This mode must only launch the app when the OS is already awake. It must not
  schedule system wake events through `pmset`, IOKit power wake APIs, or Windows
  wake timers.
- Manual launches outside schedule should keep the settings UI usable instead of
  immediately quitting, so users can inspect or edit the schedule.
