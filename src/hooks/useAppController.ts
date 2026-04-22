import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import {
  getFrontendState,
  getRuntimeSnapshot,
  revealSyntheticInputAccessTarget,
  requestSyntheticInputAccess,
  saveConfig,
} from "../api";
import type {
  AppConfig,
  FrontendState,
  RuntimeSnapshot,
  SaveState,
} from "../types";

function serializeConfig(config: AppConfig) {
  return JSON.stringify(config);
}

export function useAppController() {
  const [serverState, setServerState] = useState<FrontendState | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] =
    useState<RuntimeSnapshot | null>(null);
  const [draftConfig, setDraftConfig] = useState<AppConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionNote, setPermissionNote] = useState<string | null>(null);
  const latestDraftRef = useRef<AppConfig | null>(null);
  const localEditGenerationRef = useRef(0);

  const dirty =
    !!serverState &&
    !!draftConfig &&
    serializeConfig(serverState.config) !== serializeConfig(draftConfig);

  const applyServerState = useEffectEvent(
    (nextState: FrontendState, preserveDraft: boolean) => {
      startTransition(() => {
        setServerState(nextState);
        setRuntimeSnapshot(nextState.runtime);
        setDraftConfig((currentDraft) => {
          if (!preserveDraft || !currentDraft) {
            latestDraftRef.current = nextState.config;
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
      // keep the newer local draft on screen and let the next debounce cycle
      // persist it instead of restoring stale data from the server response.
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
          ? "Accessibility access is enabled. Scheduled synthetic keys can now be delivered to other apps."
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

  const refreshRuntimeSnapshot = useEffectEvent(async () => {
    try {
      const nextRuntime = await getRuntimeSnapshot();
      setRuntimeSnapshot(nextRuntime);
    } catch {
      // Runtime polling is best-effort. We keep the last known snapshot if a
      // refresh fails rather than interrupting the settings workflow.
    }
  });

  useEffect(() => {
    let cancelled = false;
    const requestEditGeneration = localEditGenerationRef.current;

    void (async () => {
      try {
        // Loading the first snapshot must never overwrite a local edit that
        // happened while the async request was in flight, so we gate the
        // response against the edit generation captured at effect start.
        const nextState = await getFrontendState();
        if (
          !cancelled &&
          localEditGenerationRef.current === requestEditGeneration
        ) {
          latestDraftRef.current = nextState.config;
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
      if (document.visibilityState !== "visible") {
        return;
      }

      void refreshRuntimeSnapshot();
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshRuntimeSnapshot, serverState]);

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
    // earlier helper text about opening System Settings is stale noise.
    setPermissionNote(null);
  }, [permissionNote, serverState?.syntheticInputAccess.granted]);

  const handleConfigChange = useEffectEvent((nextConfig: AppConfig) => {
    localEditGenerationRef.current += 1;
    latestDraftRef.current = nextConfig;
    setSaveError(null);
    setSaveState("idle");
    setDraftConfig(nextConfig);
  });

  return {
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
  };
}
