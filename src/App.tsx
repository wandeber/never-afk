import { SettingsForm } from "./settings/SettingsForm";
import { useAppController } from "./hooks/useAppController";
import {
  formatPhaseLabel,
  formatRuntimeNote,
  formatSyntheticInputAccessLabel,
} from "./runtimeLabels";
import "./App.css";

function App() {
  const {
    serverState,
    runtimeSnapshot,
    draftConfig,
    busy,
    dirty,
    saveError,
    saveState,
    permissionBusy,
    permissionNote,
    requestPermission,
    revealPermissionTarget,
    handleConfigChange,
  } = useAppController();

  if (!serverState || !draftConfig) {
    return (
      <main className="app-shell loading-shell">
        <section className="content-shell content-shell-loading">
          <div className="compact-header">
            <div>
              <p className="eyebrow">never-afk</p>
              <h1 className="screen-title">Loading</h1>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const runtimePhase = runtimeSnapshot?.phase ?? "waitingQuiet";
  const syntheticInputAccessLabel = formatSyntheticInputAccessLabel(
    serverState.syntheticInputAccess,
  );

  return (
    <main className="app-shell">
      <section className="content-shell">
        <header className="compact-header">
          <div>
            <p className="eyebrow">never-afk</p>
            <h1 className="screen-title">Settings</h1>
            <p className="screen-summary">
              Configure startup behavior, idle delays and the synthetic key used
              by the resident engine.
            </p>
          </div>

          <div className="toolbar-meta">
            <span
              aria-label={syntheticInputAccessLabel}
              className={`access-chip ${
                serverState.syntheticInputAccess.granted
                  ? "access-chip-granted"
                  : "access-chip-missing"
              }`}
            >
              {syntheticInputAccessLabel}
            </span>
            <span className={`phase-chip phase-${runtimePhase}`}>
              {formatPhaseLabel(runtimePhase)}
            </span>
          </div>
        </header>

        <div className="content-body">
          {runtimeSnapshot?.lastError ? (
            <p className="status-banner" role="status">
              {runtimeSnapshot.lastError}
            </p>
          ) : null}

          <SettingsForm
            config={draftConfig}
            customInputLabel={serverState.customInputLabel}
            safeKeyOptions={serverState.safeKeyOptions}
            syntheticInputAccess={serverState.syntheticInputAccess}
            busy={busy}
            dirty={dirty}
            saveError={saveError}
            saveState={saveState}
            permissionBusy={permissionBusy}
            permissionNote={permissionNote}
            onRequestSyntheticInputAccess={requestPermission}
            onRevealSyntheticInputAccessTarget={revealPermissionTarget}
            onChange={handleConfigChange}
          />
        </div>

        <footer className="footer-strip" aria-label="Runtime status">
          <span>
            Status <strong>{runtimeSnapshot?.statusLabel ?? "Bootstrapping"}</strong>
          </span>
          <span>
            {runtimeSnapshot
              ? formatRuntimeNote(runtimeSnapshot)
              : "Preparing runtime status"}
          </span>
          <span>
            Current key{" "}
            <strong>
              {runtimeSnapshot?.resolvedInputLabel ?? serverState.config.selectedKey}
            </strong>
          </span>
          <span>Local only</span>
        </footer>
      </section>
    </main>
  );
}

export default App;
