import type { RuntimeSnapshot } from "./types";

export function formatRuntimeNote(runtime: RuntimeSnapshot) {
  if (runtime.phase === "paused" && runtime.pausedUntilEpochMs) {
    return `Paused until ${new Date(runtime.pausedUntilEpochMs).toLocaleString()}`;
  }

  if (runtime.nextCheckInSeconds === null) {
    return "Waiting for the next activity cycle";
  }

  return `Next check in ${runtime.nextCheckInSeconds}s`;
}
