import type { RuntimeSnapshot } from "../types";

type QuickActionsProps = {
  runtime: RuntimeSnapshot;
  busy: boolean;
  onPause30: () => Promise<void>;
  onPause60: () => Promise<void>;
  onResume: () => Promise<void>;
  onRunOnce: () => Promise<void>;
  onTestInput: () => Promise<void>;
};

export function QuickActions({
  runtime,
  busy,
  onPause30,
  onPause60,
  onResume,
  onRunOnce,
  onTestInput,
}: QuickActionsProps) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Controls</p>
          <h2>Quick actions</h2>
        </div>
      </div>

      <div className="action-grid">
        <button type="button" onClick={onPause30} disabled={busy}>
          Pause for 30 min
        </button>
        <button type="button" onClick={onPause60} disabled={busy}>
          Pause for 1 h
        </button>
        <button type="button" onClick={onRunOnce} disabled={busy}>
          Run once now
        </button>
        <button type="button" onClick={onTestInput} disabled={busy}>
          Send test input
        </button>
        <button
          type="button"
          onClick={onResume}
          disabled={busy || runtime.phase !== "paused"}
        >
          Resume engine
        </button>
      </div>
    </section>
  );
}
