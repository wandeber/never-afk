import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { getFrontendState, saveConfig } from "./api";
import { SettingsForm } from "./settings/SettingsForm";
import type { AppConfig, FrontendState, RuntimeSnapshot } from "./types";
import "./App.css";

type SaveState = "idle" | "saving" | "saved";

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

function formatRuntimeNote(runtime: RuntimeSnapshot) {
  if (runtime.phase === "paused" && runtime.pausedUntilEpochMs) {
    return `Paused until ${new Date(runtime.pausedUntilEpochMs).toLocaleString()}`;
  }

  if (runtime.nextCheckInSeconds === null) {
    return "Waiting for the next activity cycle";
  }

  return `Next check in ${runtime.nextCheckInSeconds}s`;
}

function serializeConfig(config: AppConfig) {
  return JSON.stringify(config);
}

function App() {
  const [serverState, setServerState] = useState<FrontendState | null>(null);
  const [draftConfig, setDraftConfig] = useState<AppConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const latestDraftRef = useRef<AppConfig | null>(null);
  const localEditGenerationRef = useRef(0);

  const dirty =
    !!serverState &&
    !!draftConfig &&
    serializeConfig(serverState.config) !== serializeConfig(draftConfig);

  useEffect(() => {
    latestDraftRef.current = draftConfig;
  }, [draftConfig]);

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

  const persistDraft = useEffectEvent(async (configToSave: AppConfig) => {
    const submittedDraft = serializeConfig(configToSave);

    setBusy(true);
    setSaveError(null);
    setSaveState("saving");

    try {
      const nextState = await saveConfig(configToSave);
      const latestDraft = latestDraftRef.current;
      const hasNewerDraft =
        !!latestDraft && serializeConfig(latestDraft) !== submittedDraft;

      // If the user changed something else while the request was in flight, we
      // keep their newer draft on screen and let the next autosave cycle persist it.
      applyServerState(nextState, hasNewerDraft);
      setSaveState("saved");
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "The requested action failed.",
      );
      setSaveState("idle");
    } finally {
      setBusy(false);
    }
  });

  useEffect(() => {
    let cancelled = false;
    const requestEditGeneration = localEditGenerationRef.current;

    void (async () => {
      try {
        // Load the first snapshot directly inside this effect so React dev
        // re-renders cannot accidentally schedule a second initializer that
        // races with local edits and restores an older persisted config. If the
        // user changes any setting before this request resolves, we ignore the
        // stale response instead of overwriting the in-memory draft.
        const nextState = await getFrontendState();
        if (
          !cancelled &&
          localEditGenerationRef.current === requestEditGeneration
        ) {
          startTransition(() => {
            setServerState(nextState);
            setDraftConfig(nextState.config);
          });
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
  }, []);

  useEffect(() => {
    if (!draftConfig || !dirty || busy) {
      return undefined;
    }

    // The settings window behaves like a desktop preferences pane: it renders a
    // stable snapshot, then updates that snapshot only when the user saves a new
    // config. Avoiding background polling here prevents native controls from
    // being reset underneath in-progress edits.
    const timeoutId = window.setTimeout(() => {
      void persistDraft(draftConfig);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [busy, dirty, draftConfig, persistDraft]);

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
              Configure startup behavior, idle delays and the synthetic key used
              by the resident engine.
            </p>
          </div>

          <div className="toolbar-meta">
            <span className={`phase-chip phase-${serverState.runtime.phase}`}>
              {formatPhaseLabel(serverState.runtime.phase)}
            </span>
            <span className="meta-pill">{serverState.platformName}</span>
          </div>
        </header>

        <div className="content-body">
          {serverState.runtime.lastError ? (
            <p className="status-banner" role="status">
              {serverState.runtime.lastError}
            </p>
          ) : null}

          <SettingsForm
            config={draftConfig}
            customInputLabel={serverState.customInputLabel}
            safeKeyOptions={serverState.safeKeyOptions}
            busy={busy}
            dirty={dirty}
            saveError={saveError}
            saveState={saveState}
            onChange={(nextConfig) => {
              localEditGenerationRef.current += 1;
              setSaveError(null);
              setSaveState("idle");
              setDraftConfig(nextConfig);
            }}
          />
        </div>

        <footer className="footer-strip" aria-label="Runtime status">
          <span>
            Status <strong>{serverState.runtime.statusLabel}</strong>
          </span>
          <span>{formatRuntimeNote(serverState.runtime)}</span>
          <span>
            Current key <strong>{serverState.runtime.resolvedInputLabel}</strong>
          </span>
          <span>Local only</span>
        </footer>
      </section>
    </main>
  );
}

export default App;
