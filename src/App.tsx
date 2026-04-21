import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  getFrontendState,
  revealSyntheticInputAccessTarget,
  requestSyntheticInputAccess,
  saveConfig,
  sendVirtualA,
} from "./api";
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

function formatSyntheticInputAccessLabel(
  syntheticInputAccess: FrontendState["syntheticInputAccess"],
) {
  if (!syntheticInputAccess.supported) {
    return "Accessibility unsupported";
  }

  return syntheticInputAccess.granted
    ? "Accessibility granted"
    : "Accessibility required";
}

function serializeConfig(config: AppConfig) {
  return JSON.stringify(config);
}

function App() {
  const [serverState, setServerState] = useState<FrontendState | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] =
    useState<RuntimeSnapshot | null>(null);
  const [draftConfig, setDraftConfig] = useState<AppConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionNote, setPermissionNote] = useState<string | null>(null);
  const [virtualKeyBusy, setVirtualKeyBusy] = useState(false);
  const [virtualKeyNote, setVirtualKeyNote] = useState<string | null>(null);
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
        setRuntimeSnapshot(nextState.runtime);
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

  const requestPermission = useEffectEvent(async () => {
    setPermissionBusy(true);
    setPermissionNote(null);

    try {
      const nextState = await requestSyntheticInputAccess();
      applyServerState(nextState, true);

      setPermissionNote(
        nextState.syntheticInputAccess.granted
          ? "Accessibility access is enabled. Retry the test in your text editor."
          : "System Settings should now be open. If approval is still missing, add the exact binary shown below and retry.",
      );
    } catch (error) {
      setPermissionNote(
        error instanceof Error
          ? error.message
          : "The permission request could not be completed.",
      );
    } finally {
      setPermissionBusy(false);
    }
  });

  const revealPermissionTarget = useEffectEvent(async () => {
    setPermissionBusy(true);
    setPermissionNote(null);

    try {
      const nextState = await revealSyntheticInputAccessTarget();
      applyServerState(nextState, true);
      setPermissionNote(
        "Finder is revealing the exact binary that macOS must authorize in Accessibility.",
      );
    } catch (error) {
      setPermissionNote(
        error instanceof Error
          ? error.message
          : "The current executable could not be revealed in Finder.",
      );
    } finally {
      setPermissionBusy(false);
    }
  });

  const triggerVirtualA = useEffectEvent(async () => {
    setVirtualKeyBusy(true);
    setVirtualKeyNote(null);

    try {
      const nextState = await sendVirtualA();
      applyServerState(nextState, true);
      setVirtualKeyNote(
        "A is queued for 2 seconds from now. Focus your text editor immediately.",
      );
    } catch (error) {
      setVirtualKeyNote(
        error instanceof Error
          ? error.message
          : "The virtual keyboard test could not be completed.",
      );
    } finally {
      setVirtualKeyBusy(false);
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
            setRuntimeSnapshot(nextState.runtime);
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
    if (!serverState) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const nextState = await getFrontendState();
          setRuntimeSnapshot(nextState.runtime);
        } catch {
          // Runtime polling is best-effort. We keep the last known snapshot if a
          // refresh fails rather than interrupting the settings workflow.
        }
      })();
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [serverState]);

  useEffect(() => {
    const refreshVisibleState = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void (async () => {
        try {
          const nextState = await getFrontendState();
          applyServerState(nextState, true);
        } catch {
          // Returning from System Settings should not surface a noisy error if
          // the refresh misses once; the user can retry the permission flow.
        }
      })();
    };

    window.addEventListener("focus", refreshVisibleState);
    document.addEventListener("visibilitychange", refreshVisibleState);

    return () => {
      window.removeEventListener("focus", refreshVisibleState);
      document.removeEventListener("visibilitychange", refreshVisibleState);
    };
  }, [applyServerState]);

  useEffect(() => {
    if (!draftConfig || !dirty || busy) {
      return undefined;
    }

    // Config changes are still autosaved with a short debounce so the form
    // feels like a native preferences pane instead of a manual submit flow.
    const timeoutId = window.setTimeout(() => {
      void persistDraft(draftConfig);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [busy, dirty, draftConfig, persistDraft]);

  useEffect(() => {
    if (!serverState?.syntheticInputAccess.granted || !permissionNote) {
      return;
    }

    // Once macOS reports that posting synthetic events is allowed again, any
    // earlier "open Settings" helper text is stale and should get out of the
    // way so the granted state speaks for itself.
    setPermissionNote(null);
  }, [permissionNote, serverState?.syntheticInputAccess.granted]);

  const handleConfigChange = useEffectEvent((nextConfig: AppConfig) => {
    localEditGenerationRef.current += 1;
    setSaveError(null);
    setSaveState("idle");
    setDraftConfig(nextConfig);
  });

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
            <span
              aria-label={formatSyntheticInputAccessLabel(
                serverState.syntheticInputAccess,
              )}
              className={`access-chip ${
                serverState.syntheticInputAccess.granted
                  ? "access-chip-granted"
                  : "access-chip-missing"
              }`}
            >
              {formatSyntheticInputAccessLabel(serverState.syntheticInputAccess)}
            </span>
            <span
              className={`phase-chip phase-${
                runtimeSnapshot?.phase ?? "waitingQuiet"
              }`}
            >
              {formatPhaseLabel(runtimeSnapshot?.phase ?? "waitingQuiet")}
            </span>
            <span className="meta-pill">{serverState.platformName}</span>
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
            virtualKeyBusy={virtualKeyBusy}
            virtualKeyNote={virtualKeyNote}
            onRequestSyntheticInputAccess={requestPermission}
            onRevealSyntheticInputAccessTarget={revealPermissionTarget}
            onTriggerVirtualA={triggerVirtualA}
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
