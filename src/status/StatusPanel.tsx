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

type StatusPanelProps = {
  runtime: RuntimeSnapshot;
  platformName: string;
};

export function StatusPanel({ runtime, platformName }: StatusPanelProps) {
  return (
    <section className="panel panel-highlight">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Runtime</p>
          <h2>Resident engine status</h2>
        </div>
        <span className={`pill pill-${phaseTone(runtime.phase)}`}>
          {runtime.statusLabel}
        </span>
      </div>

      <p className="panel-summary">{runtime.detailLabel}</p>

      <dl className="status-grid">
        <div>
          <dt>Platform</dt>
          <dd>{platformName}</dd>
        </div>
        <div>
          <dt>Resolved input</dt>
          <dd>{runtime.resolvedInputLabel}</dd>
        </div>
        <div>
          <dt>Next check</dt>
          <dd>
            {runtime.nextCheckInSeconds === null
              ? "Idle"
              : `${runtime.nextCheckInSeconds}s`}
          </dd>
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
