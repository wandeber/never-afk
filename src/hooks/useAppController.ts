import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import {
  checkForUpdate,
  getFrontendState,
  getRuntimeSnapshot,
  installUpdate,
  revealSyntheticInputAccessTarget,
  requestSyntheticInputAccess,
  saveConfig,
} from "../api";
import type {
  AppConfig,
  FrontendState,
  PermissionFeedback,
  RuntimeSnapshot,
  SaveState,
  UpdateActionKind,
  UpdateSnapshot,
} from "../types";

function serializeConfig(config: AppConfig) {
  return JSON.stringify(config);
}

function actionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }

  return fallback;
}

type ActiveUpdateAction = {
  id: number;
  kind: UpdateActionKind;
};

type ServerStateSource =
  | { kind: "updateAction" }
  | { kind: "nonUpdate"; updateGenerationAtRequestStart: number };

const RUNTIME_REFRESH_INTERVAL_MS = 30_000;

export function useAppController() {
  const [serverState, setServerState] = useState<FrontendState | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] =
    useState<RuntimeSnapshot | null>(null);
  const [updateSnapshot, setUpdateSnapshot] = useState<UpdateSnapshot | null>(
    null,
  );
  const [draftConfig, setDraftConfig] = useState<AppConfig | null>(null);
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionFeedback, setPermissionFeedback] =
    useState<PermissionFeedback | null>(null);
  const [updateActionKind, setUpdateActionKind] =
    useState<UpdateActionKind | null>(null);
  const [lastFailedUpdateAction, setLastFailedUpdateAction] =
    useState<UpdateActionKind | null>(null);
  const latestDraftRef = useRef<AppConfig | null>(null);
  const localEditGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const nextUpdateActionIdRef = useRef(0);
  const activeUpdateActionRef = useRef<ActiveUpdateAction | null>(null);
  const updateGenerationRef = useRef(0);
  const previousPermissionGrantedRef = useRef<boolean | null>(null);

  const dirty =
    !!serverState &&
    !!draftConfig &&
    serializeConfig(serverState.config) !== serializeConfig(draftConfig);

  const applyServerState = useEffectEvent(
    (
      nextState: FrontendState,
      preserveDraft: boolean,
      source: ServerStateSource,
    ) => {
      startTransition(() => {
        setServerState(nextState);
        setRuntimeSnapshot(nextState.runtime);

        const updateSnapshotIsCurrent =
          source.kind === "updateAction" ||
          (!activeUpdateActionRef.current &&
            source.updateGenerationAtRequestStart ===
              updateGenerationRef.current);

        // Every non-update request captures the update generation before it
        // starts. A local update advances that generation on both start and
        // completion, so responses that span the action cannot later restore
        // an older Checking/Downloading snapshot after the terminal result.
        if (updateSnapshotIsCurrent) {
          setUpdateSnapshot(nextState.update);
        }

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
    const updateGenerationAtRequestStart = updateGenerationRef.current;

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
      applyServerState(nextState, hasNewerDraft, {
        kind: "nonUpdate",
        updateGenerationAtRequestStart,
      });
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
    const updateGenerationAtRequestStart = updateGenerationRef.current;
    setPermissionBusy(true);
    setPermissionFeedback(null);

    try {
      const nextState = await requestSyntheticInputAccess();
      applyServerState(nextState, true, {
        kind: "nonUpdate",
        updateGenerationAtRequestStart,
      });

      setPermissionFeedback({
        kind: "info",
        message: nextState.syntheticInputAccess.granted
          ? "Accessibility access is enabled. Synthetic keys can now reach other apps."
          : "System Settings is open. Turn on never-afk, then return here; access refreshes automatically.",
      });
    } catch (error) {
      setPermissionFeedback({
        kind: "error",
        message: actionErrorMessage(
          error,
          "The permission request could not be completed.",
        ),
      });
    } finally {
      setPermissionBusy(false);
    }
  });

  const revealPermissionTarget = useEffectEvent(async () => {
    const updateGenerationAtRequestStart = updateGenerationRef.current;
    setPermissionBusy(true);
    setPermissionFeedback(null);

    try {
      const nextState = await revealSyntheticInputAccessTarget();
      applyServerState(nextState, true, {
        kind: "nonUpdate",
        updateGenerationAtRequestStart,
      });
      setPermissionFeedback({
        kind: "info",
        message:
          "Finder is showing the exact never-afk executable that macOS must allow.",
      });
    } catch (error) {
      setPermissionFeedback({
        kind: "error",
        message: actionErrorMessage(
          error,
          "The current executable could not be revealed in Finder.",
        ),
      });
    } finally {
      setPermissionBusy(false);
    }
  });

  const runUpdateAction = useEffectEvent(
    async (
      kind: UpdateActionKind,
      optimisticPhase: UpdateSnapshot["phase"],
      command: () => Promise<FrontendState>,
    ) => {
      // React has not necessarily rendered the disabled button between two
      // synchronous clicks, so the ref is the authoritative duplicate guard.
      if (activeUpdateActionRef.current) {
        return;
      }

      const action: ActiveUpdateAction = {
        id: ++nextUpdateActionIdRef.current,
        kind,
      };
      activeUpdateActionRef.current = action;
      updateGenerationRef.current += 1;
      setUpdateActionKind(kind);
      setLastFailedUpdateAction(null);
      setUpdateSnapshot((current) =>
        current
          ? {
              ...current,
              phase: optimisticPhase,
              downloadedBytes: kind === "install" ? 0 : null,
              contentLengthBytes: null,
              lastError: null,
            }
          : current,
      );

      try {
        const nextState = await command();
        if (!mountedRef.current || activeUpdateActionRef.current !== action) {
          return;
        }

        // An install that succeeds restarts the process and never reaches this
        // branch. The response is still authoritative for checks and for the
        // install edge case where the advertised update disappeared.
        applyServerState(nextState, true, { kind: "updateAction" });
        setLastFailedUpdateAction(null);
      } catch (error) {
        if (!mountedRef.current || activeUpdateActionRef.current !== action) {
          return;
        }

        setLastFailedUpdateAction(kind);
        setUpdateSnapshot((current) =>
          current
            ? {
                ...current,
                phase: "error",
                downloadedBytes: null,
                contentLengthBytes: null,
                lastError: actionErrorMessage(
                  error,
                  kind === "install"
                    ? "Update install failed."
                    : "Update check failed.",
                ),
              }
            : current,
        );
      } finally {
        if (activeUpdateActionRef.current === action) {
          // The second increment distinguishes responses started during the
          // update from requests started after its terminal state is known.
          updateGenerationRef.current += 1;
          activeUpdateActionRef.current = null;
          if (mountedRef.current) {
            setUpdateActionKind(null);
          }
        }
      }
    },
  );

  const checkForUpdates = useEffectEvent(() => {
    void runUpdateAction("check", "checking", checkForUpdate);
  });

  const installAvailableUpdate = useEffectEvent(() => {
    void runUpdateAction("install", "downloading", installUpdate);
  });

  const refreshRuntimeSnapshot = useEffectEvent(async () => {
    try {
      const nextRuntime = await getRuntimeSnapshot();
      if (mountedRef.current) {
        setRuntimeSnapshot(nextRuntime);
      }
    } catch {
      // Runtime polling is best-effort. We keep the last known snapshot if a
      // refresh fails rather than interrupting the settings workflow.
    }
  });

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      activeUpdateActionRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestEditGeneration = localEditGenerationRef.current;
    setInitialLoadError(null);

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
            setUpdateSnapshot(nextState.update);
            setDraftConfig(nextState.config);
          });
        }
      } catch (error) {
        if (!cancelled) {
          setInitialLoadError(
            actionErrorMessage(
              error,
              "Failed to load the initial application state.",
            ),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  useEffect(() => {
    if (!serverState) {
      return undefined;
    }

    // Runtime status uses absolute deadlines instead of a visible countdown,
    // so a low-frequency refresh is enough when the settings window is open.
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void refreshRuntimeSnapshot();
    }, RUNTIME_REFRESH_INTERVAL_MS);

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
        const updateGenerationAtRequestStart = updateGenerationRef.current;

        try {
          const nextState = await getFrontendState();
          applyServerState(nextState, true, {
            kind: "nonUpdate",
            updateGenerationAtRequestStart,
          });
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

    // Config changes are autosaved with a short debounce so the form feels like
    // a native preferences pane instead of a manual submit workflow.
    const timeoutId = window.setTimeout(() => {
      void persistDraft(draftConfig);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [busy, dirty, draftConfig, persistDraft]);

  useEffect(() => {
    const granted = serverState?.syntheticInputAccess.granted;
    if (granted === undefined) {
      return;
    }

    const previouslyGranted = previousPermissionGrantedRef.current;
    previousPermissionGrantedRef.current = granted;

    // Only the informational guidance that told the user to approve access is
    // stale on the denied-to-granted transition. Errors from the Finder helper
    // or a permission request remain actionable even when access is already
    // granted, so clearing all feedback here would hide real failures.
    if (
      previouslyGranted === false &&
      granted &&
      permissionFeedback?.kind === "info"
    ) {
      setPermissionFeedback(null);
    }
  }, [permissionFeedback, serverState?.syntheticInputAccess.granted]);

  const retryInitialLoad = useEffectEvent(() => {
    setInitialLoadError(null);
    setLoadAttempt((current) => current + 1);
  });

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
  };
}
