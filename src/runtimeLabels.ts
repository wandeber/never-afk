import type { RuntimeSnapshot } from "./types";

function formatAbsoluteTime(
  epochMs: number,
  options: Intl.DateTimeFormatOptions,
) {
  return new Date(epochMs).toLocaleString(undefined, options);
}

export function formatRuntimeNote(runtime: RuntimeSnapshot) {
  if (runtime.phase === "paused" && runtime.pausedUntilEpochMs) {
    return `Paused until ${formatAbsoluteTime(runtime.pausedUntilEpochMs, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  if (runtime.phase === "scheduledOff") {
    if (runtime.nextRelevantEpochMs) {
      return `Next scheduled range ${formatAbsoluteTime(
        runtime.nextRelevantEpochMs,
        {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
        },
      )}`;
    }

    return "Automatic activity is off until you add a schedule range.";
  }

  if (runtime.phase === "disabled") {
    return "Enable the engine to resume automatic activity.";
  }

  if (runtime.nextRelevantEpochMs === null) {
    return "Waiting for the next activity cycle";
  }

  return `Next activity check ${formatAbsoluteTime(runtime.nextRelevantEpochMs, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
