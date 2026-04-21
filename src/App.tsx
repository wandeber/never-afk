import { startTransition, useEffect, useEffectEvent, useState } from "react";
import { getFrontendState, saveConfig } from "./api";
import { SettingsForm } from "./settings/SettingsForm";
import type { AppConfig, FrontendState, RuntimeSnapshot } from "./types";
import "./App.css";

function formatPhaseLabel(phase: FrontendState["runtime"]["phase"]) {
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

function formatTimestamp(epochMs: number | null) {
  if (!epochMs) {
    return "not yet";
  }

  return new Date(epochMs).toLocaleString();
}

function formatRuntimeNote(runtime: RuntimeSnapshot) {
  if (runtime.phase === "paused" && runtime.pausedUntilEpochMs) {
    return `Paused until ${formatTimestamp(runtime.pausedUntilEpochMs)}.`;
  }

  if (runtime.nextCheckInSeconds === null) {
    return "Waiting for the next activity cycle.";
  }

  return `Next check in ${runtime.nextCheckInSeconds}s.`;
}

function App() {
  const [serverState, setServerState] = useState<FrontendState | null>(null);
  const [draftConfig, setDraftConfig] = useState<AppConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty =
    !!serverState &&
    !!draftConfig &&
    JSON.stringify(serverState.config) !== JSON.stringify(draftConfig);

  const applyServerState = useEffectEvent(
    (nextState: FrontendState, preserveDraft: boolean) => {
      startTransition(() => {
        setServerState(nextState);
        setDraftConfig((currentDraft) => {
          if (!preserveDraft || !currentDraft) {
            return nextState.config;
          }

          return currentDraft;
        });
      });
    },
  );

  const loadInitialState = useEffectEvent(async () => {
    const nextState = await getFrontendState();
    applyServerState(nextState, false);
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        if (!cancelled) {
          await loadInitialState();
        }
      } catch (error) {
        if (!cancelled) {
          setSaveError(
            error instanceof Error
              ? error.message
              : "Failed to load the initial application state.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadInitialState]);

  useEffect(() => {
    if (!serverState) {
      return undefined;
    }

    let cancelled = false;

    // Runtime polling intentionally updates only the server snapshot so in-progress
    // edits inside the form are never blown away by background status refreshes.
    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const nextState = await getFrontendState();
          if (!cancelled) {
            applyServerState(nextState, true);
          }
        } catch {
          // Poll failures should not interrupt local editing. The last successful
          // runtime snapshot remains on screen until the next refresh succeeds.
        }
      })();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [applyServerState, serverState]);

  async function handleSave() {
    if (!draftConfig) {
      return;
    }

    setBusy(true);
    setSaveError(null);

    try {
      const nextState = await saveConfig(draftConfig);
      applyServerState(nextState, dirty);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "The requested action failed.",
      );
    } finally {
      setBusy(false);
    }
  }

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
              Quietly keeps activity alive after it confirms that you are idle.
            </p>
            <p className="screen-runtime">
              {serverState.runtime.detailLabel} {formatRuntimeNote(serverState.runtime)}
            </p>
          </div>

          <div className="toolbar-meta">
            <span className={`phase-chip phase-${serverState.runtime.phase}`}>
              {formatPhaseLabel(serverState.runtime.phase)}
            </span>
            <span className="meta-pill">{serverState.platformName}</span>
          </div>
        </header>

        {serverState.runtime.lastError ? (
          <div className="content-body">
            <p className="status-banner" role="status">
              {serverState.runtime.lastError}
            </p>
          </div>
        ) : null}

        <div className="content-body">
          <SettingsForm
            config={draftConfig}
            customInputLabel={serverState.customInputLabel}
            safeKeyOptions={serverState.safeKeyOptions}
            busy={busy}
            dirty={dirty}
            saveError={saveError}
            runtime={serverState.runtime}
            onChange={(nextConfig) => {
              setSaveError(null);
              setDraftConfig(nextConfig);
            }}
            onSave={handleSave}
          />

          <p className="privacy-footnote">
            Local-only utility. No telemetry, no network traffic, and no input
            history is stored.
          </p>
        </div>
      </section>
    </main>
  );
}

export default App;
