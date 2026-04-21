import {
  startTransition,
  useEffect,
  useEffectEvent,
  useState,
} from "react";
import {
  getFrontendState,
  pauseForMinutes,
  resumeEngine,
  runOnceNow,
  saveConfig,
  sendTestInput,
} from "./api";
import { QuickActions } from "./controls/QuickActions";
import { SettingsForm } from "./settings/SettingsForm";
import { StatusPanel } from "./status/StatusPanel";
import type { AppConfig, FrontendState } from "./types";
import "./App.css";

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

  async function runAction(action: () => Promise<FrontendState>) {
    setBusy(true);
    setSaveError(null);

    try {
      const nextState = await action();
      applyServerState(nextState, dirty);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "The requested action failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!draftConfig) {
      return;
    }

    await runAction(() => saveConfig(draftConfig));
  }

  if (!serverState || !draftConfig) {
    return (
      <main className="app-shell loading-shell">
        <section className="hero">
          <p className="eyebrow">Bootstrapping</p>
          <h1>never-afk</h1>
          <p className="summary">
            Loading the resident engine state and persisted settings.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Personal utility</p>
          <h1>never-afk</h1>
          <p className="summary">
            Local-first idle confirmation and synthetic keyboard activity, with a
            resident engine that keeps running after the window disappears.
          </p>
        </div>

        <div className="hero-metrics">
          <article>
            <span>Platform</span>
            <strong>{serverState.platformName}</strong>
          </article>
          <article>
            <span>Quiet period</span>
            <strong>{serverState.config.quietPeriodSeconds}s</strong>
          </article>
          <article>
            <span>Idle confirmation</span>
            <strong>{serverState.config.idleConfirmationPeriodSeconds}s</strong>
          </article>
        </div>
      </section>

      <div className="layout-grid">
        <div className="primary-column">
          <StatusPanel
            runtime={serverState.runtime}
            platformName={serverState.platformName}
          />
          <SettingsForm
            config={draftConfig}
            customInputLabel={serverState.customInputLabel}
            safeKeyOptions={serverState.safeKeyOptions}
            busy={busy}
            dirty={dirty}
            saveError={saveError}
            onChange={(nextConfig) => {
              setSaveError(null);
              setDraftConfig(nextConfig);
            }}
            onSave={handleSave}
          />
        </div>

        <div className="secondary-column">
          <QuickActions
            runtime={serverState.runtime}
            busy={busy}
            onPause30={() => runAction(() => pauseForMinutes(30))}
            onPause60={() => runAction(() => pauseForMinutes(60))}
            onResume={() => runAction(() => resumeEngine())}
            onRunOnce={() => runAction(() => runOnceNow())}
            onTestInput={() => runAction(() => sendTestInput())}
          />

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Policy</p>
                <h2>Project constraints</h2>
              </div>
            </div>
            <ul className="constraint-list">
              <li>No telemetry, networking or remote crash reporting.</li>
              <li>No input logging, history collection or app-specific integrations.</li>
              <li>The engine must stop observing before it sends fake input.</li>
              <li>The tray remains the primary control surface; the window is disposable.</li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}

export default App;
