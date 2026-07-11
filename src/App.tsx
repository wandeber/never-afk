import { useAppearance } from "./appearance";
import { useAppController } from "./hooks/useAppController";
import { OverviewPanel } from "./overview/OverviewPanel";
import { SettingsForm } from "./settings/SettingsForm";
import type { AppearancePreference } from "./appearance";
import type { SaveState } from "./types";
import "./App.css";

const APPEARANCE_OPTIONS: ReadonlyArray<{
  value: AppearancePreference;
  label: string;
}> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function saveStateLabel(
  saveState: SaveState,
  dirty: boolean,
  busy: boolean,
  saveError: string | null,
) {
  if (saveError) {
    return "Changes could not be saved.";
  }

  if (busy || saveState === "saving") {
    return "Saving changes…";
  }

  if (dirty) {
    return "Changes waiting to save…";
  }

  if (saveState === "saved") {
    return "All changes saved.";
  }

  return "Changes save automatically.";
}

function App() {
  const { appearance, setAppearance } = useAppearance();
  const {
    serverState,
    runtimeSnapshot,
    updateSnapshot,
    draftConfig,
    initialLoadError,
    busy,
    dirty,
    saveError,
    saveState,
    permissionBusy,
    permissionFeedback,
    updateActionKind,
    lastFailedUpdateAction,
    retryInitialLoad,
    requestPermission,
    revealPermissionTarget,
    checkForUpdates,
    installAvailableUpdate,
    handleConfigChange,
  } = useAppController();

  if (!serverState || !draftConfig || !runtimeSnapshot) {
    return (
      <main className="app-shell loading-shell">
        <section className="loading-card" aria-live="polite">
          <div className="brand-mark" aria-hidden="true">
            <span />
          </div>
          {initialLoadError ? (
            <>
              <p className="section-kicker">never-afk</p>
              <h1>Couldn’t open settings</h1>
              <p className="loading-error" role="alert">
                {initialLoadError}
              </p>
              <button
                className="primary-button"
                type="button"
                onClick={retryInitialLoad}
              >
                Retry
              </button>
            </>
          ) : (
            <>
              <p className="section-kicker">never-afk</p>
              <h1>Starting…</h1>
              <p>Reading your settings and current activity status.</p>
              <span className="loading-indicator" aria-hidden="true" />
            </>
          )}
        </section>
      </main>
    );
  }

  const update = updateSnapshot ?? serverState.update;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span />
          </div>
          <div>
            <strong>never-afk</strong>
            <span>Idle activity control</span>
          </div>
        </div>

        <div className="header-controls">
          <p className="autosave-status" role="status" aria-live="polite">
            {saveStateLabel(saveState, dirty, busy, saveError)}
          </p>
          <div
            className="appearance-control"
            role="group"
            aria-label="Appearance"
          >
            {APPEARANCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className="appearance-option"
                type="button"
                aria-label={`Use ${option.label.toLowerCase()} appearance`}
                aria-pressed={appearance === option.value}
                onClick={() => setAppearance(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="content-body">
        {saveError ? (
          <div className="status-banner" role="alert">
            <strong>Changes weren’t saved.</strong>
            <span>{saveError}</span>
          </div>
        ) : null}

        <OverviewPanel
          config={draftConfig}
          runtime={runtimeSnapshot}
          syntheticInputAccess={serverState.syntheticInputAccess}
          update={update}
          permissionBusy={permissionBusy}
          permissionFeedback={permissionFeedback}
          updateActionKind={updateActionKind}
          lastFailedUpdateAction={lastFailedUpdateAction}
          onConfigChange={handleConfigChange}
          onRequestSyntheticInputAccess={requestPermission}
          onRevealSyntheticInputAccessTarget={revealPermissionTarget}
          onCheckForUpdates={checkForUpdates}
          onInstallUpdate={installAvailableUpdate}
        />

        <SettingsForm
          config={draftConfig}
          customInputLabel={serverState.customInputLabel}
          safeKeyOptions={serverState.safeKeyOptions}
          onChange={handleConfigChange}
        />
      </div>
    </main>
  );
}

export default App;
