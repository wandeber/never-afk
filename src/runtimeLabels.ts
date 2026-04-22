import type {
  EnginePhase,
  RuntimeSnapshot,
  SyntheticInputAccessState,
} from "./types";

export function formatPhaseLabel(phase: EnginePhase) {
  switch (phase) {
    case "waitingQuiet":
      return "Waiting";
    case "observing":
      return "Observing";
    case "paused":
      return "Paused";
    case "disabled":
      return "Disabled";
    case "error":
      return "Driver Error";
  }
}

export function formatRuntimeNote(runtime: RuntimeSnapshot) {
  if (runtime.phase === "paused" && runtime.pausedUntilEpochMs) {
    return `Paused until ${new Date(runtime.pausedUntilEpochMs).toLocaleString()}`;
  }

  if (runtime.nextCheckInSeconds === null) {
    return "Waiting for the next activity cycle";
  }

  return `Next check in ${runtime.nextCheckInSeconds}s`;
}

export function formatSyntheticInputAccessLabel(
  syntheticInputAccess: SyntheticInputAccessState,
) {
  if (!syntheticInputAccess.supported) {
    return "Accessibility unsupported";
  }

  return syntheticInputAccess.granted
    ? "Accessibility granted"
    : "Accessibility required";
}
