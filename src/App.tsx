import { SettingsForm } from "./settings/SettingsForm";
import { useAppController } from "./hooks/useAppController";
import { formatRuntimeNote } from "./runtimeLabels";
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

  return (
    <main className="app-shell">
      <section className="content-shell">
        <header className="compact-header">
          <div>
            <p className="eyebrow">never-afk</p>
            <h1 className="screen-title">Settings</h1>
            <p className="screen-summary">
              Configure startup behavior, schedule windows, idle delays and the
              synthetic key used by the resident engine.
            </p>
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
            Status{" "}
            <strong>{runtimeSnapshot?.statusLabel ?? "Bootstrapping"}</strong>
          </span>
          <span>
            {runtimeSnapshot
              ? formatRuntimeNote(runtimeSnapshot)
              : "Preparing runtime status"}
          </span>
          <span>
            Current key{" "}
            <strong>
              {runtimeSnapshot?.resolvedInputLabel ??
                serverState.config.selectedKey}
            </strong>
          </span>
          <span>Local only</span>
        </footer>
      </section>
    </main>
  );
}

export default App;
