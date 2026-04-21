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
    <section className="sidebar-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Utilities</p>
          <h2>Quick actions</h2>
        </div>
      </div>

      <p className="panel-summary">
        Run a one-off action without opening the tray menu.
      </p>

      <div className="action-grid">
        <button
          className="secondary-button"
          type="button"
          onClick={onRunOnce}
          disabled={busy}
        >
          Run once now
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={onTestInput}
          disabled={busy}
        >
          Send test input
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={onPause30}
          disabled={busy}
        >
          Pause for 30 min
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={onPause60}
          disabled={busy}
        >
          Pause for 1 h
        </button>
        <button
          className="secondary-button"
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
