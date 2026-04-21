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
import {
  settingsSections,
  SettingsForm,
  type SettingsSectionId,
} from "./settings/SettingsForm";
import { StatusPanel } from "./status/StatusPanel";
import type { AppConfig, FrontendState } from "./types";
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

function App() {
  const [serverState, setServerState] = useState<FrontendState | null>(null);
  const [draftConfig, setDraftConfig] = useState<AppConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Keep the window closer to a native macOS preferences surface by focusing
  // the detail pane on one topic at a time.
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>("general");

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
            <h1 className="screen-title">Preferences</h1>
            <p className="screen-summary">
              Adjust the resident engine without turning the window into a dashboard.
            </p>
          </div>

          <div className="toolbar-meta">
            <span className={`phase-chip phase-${serverState.runtime.phase}`}>
              {formatPhaseLabel(serverState.runtime.phase)}
            </span>
            <span className="meta-pill">{serverState.platformName}</span>
          </div>
        </header>

        <div className="preferences-layout">
          <aside className="preferences-sidebar">
            <nav
              className="sidebar-panel section-nav"
              aria-label="Preferences sections"
            >
              {settingsSections.map((section) => (
                <button
                  key={section.id}
                  className={`section-button${
                    section.id === activeSection ? " section-button-active" : ""
                  }`}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                >
                  <strong>{section.title}</strong>
                  <span>{section.sidebarSummary}</span>
                </button>
              ))}
            </nav>

            <StatusPanel runtime={serverState.runtime} />
            <QuickActions
              runtime={serverState.runtime}
              busy={busy}
              onPause30={() => runAction(() => pauseForMinutes(30))}
              onPause60={() => runAction(() => pauseForMinutes(60))}
              onResume={() => runAction(() => resumeEngine())}
              onRunOnce={() => runAction(() => runOnceNow())}
              onTestInput={() => runAction(() => sendTestInput())}
            />

            <section className="sidebar-panel privacy-note">
              <p className="eyebrow">Privacy</p>
              <p>
                Local-only engine. No telemetry, no network traffic, no input
                history. Observation stops before synthetic input is sent.
              </p>
            </section>
          </aside>

          <div className="detail-column">
            <SettingsForm
              activeSection={activeSection}
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
        </div>
      </section>
    </main>
  );
}

export default App;
