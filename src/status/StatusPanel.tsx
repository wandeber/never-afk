import type { RuntimeSnapshot } from "../types";

function formatTimestamp(epochMs: number | null) {
  if (!epochMs) {
    return "Not yet";
  }

  return new Date(epochMs).toLocaleString();
}

function phaseTone(phase: RuntimeSnapshot["phase"]) {
  switch (phase) {
    case "error":
      return "danger";
    case "paused":
      return "warning";
    case "observing":
      return "accent";
    default:
      return "neutral";
  }
}

function nextEvent(runtime: RuntimeSnapshot) {
  if (runtime.phase === "paused" && runtime.pausedUntilEpochMs) {
    return {
      label: "Paused until",
      value: formatTimestamp(runtime.pausedUntilEpochMs),
    };
  }

  return {
    label: "Next check",
    value:
      runtime.nextCheckInSeconds === null ? "Idle" : `${runtime.nextCheckInSeconds}s`,
  };
}

type StatusPanelProps = {
  runtime: RuntimeSnapshot;
};

export function StatusPanel({ runtime }: StatusPanelProps) {
  const followUpEvent = nextEvent(runtime);

  return (
    <section className="sidebar-panel panel-status">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Activity</p>
          <h2>Runtime status</h2>
        </div>
        <span className={`pill pill-${phaseTone(runtime.phase)}`}>
          {runtime.statusLabel}
        </span>
      </div>

      <p className="panel-summary panel-summary-tight">{runtime.detailLabel}</p>

      <dl className="status-grid">
        <div>
          <dt>{followUpEvent.label}</dt>
          <dd>{followUpEvent.value}</dd>
        </div>
        <div>
          <dt>Last synthetic input</dt>
          <dd>{formatTimestamp(runtime.lastFakeInputEpochMs)}</dd>
        </div>
      </dl>

      {runtime.lastError ? (
        <p className="status-banner" role="status">
          {runtime.lastError}
        </p>
      ) : null}
    </section>
  );
}
