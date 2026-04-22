export type SafeKeyPreset =
  | "Fn"
  | "A"
  | "Shift"
  | "Option"
  | "F13"
  | "F14"
  | "F15"
  | "F16"
  | "F17"
  | "F18"
  | "F19"
  | "F20"
  | "F21"
  | "F22"
  | "F23"
  | "F24";

export type ActivityMethod = "keyboard";
export type SaveState = "idle" | "saving" | "saved";
export type ScheduleWeekday =
  | "Mon"
  | "Tue"
  | "Wed"
  | "Thu"
  | "Fri"
  | "Sat"
  | "Sun";

export type ScheduleRange = {
  daysOfWeek: ScheduleWeekday[];
  startMinutes: number;
  endMinutes: number;
};

export type EnginePhase =
  | "disabled"
  | "paused"
  | "scheduledOff"
  | "waitingQuiet"
  | "observing"
  | "error";

export type PlatformKeyMapping = {
  macosKeyCode: number | null;
  windowsVirtualKeyCode: number | null;
  hidUsageCode: number | null;
};

export type AppConfig = {
  enabled: boolean;
  quietPeriodSeconds: number;
  idleConfirmationPeriodSeconds: number;
  startAtLogin: boolean;
  scheduleEnabled: boolean;
  scheduleRanges: ScheduleRange[];
  activityMethod: ActivityMethod;
  selectedKey: SafeKeyPreset;
  showLastEventInMenuBar: boolean;
  customInputEnabled: boolean;
  customInputValue: number | null;
  platformKeyMapping: PlatformKeyMapping;
};

export type RuntimeSnapshot = {
  phase: EnginePhase;
  statusLabel: string;
  detailLabel: string;
  resolvedInputLabel: string;
  nextCheckInSeconds: number | null;
  nextRelevantEpochMs: number | null;
  pausedUntilEpochMs: number | null;
  lastFakeInputEpochMs: number | null;
  lastError: string | null;
};

export type SafeKeyOption = {
  id: SafeKeyPreset;
  label: string;
  supported: boolean;
};

export type SyntheticInputAccessState = {
  supported: boolean;
  granted: boolean;
  canRequest: boolean;
  targetPath: string | null;
};

export type FrontendState = {
  config: AppConfig;
  runtime: RuntimeSnapshot;
  safeKeyOptions: SafeKeyOption[];
  customInputLabel: string;
  syntheticInputAccess: SyntheticInputAccessState;
};
