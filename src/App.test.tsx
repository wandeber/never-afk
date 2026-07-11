import { act } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { APPEARANCE_STORAGE_KEY } from "./appearance";
import type {
  AppConfig,
  FrontendState,
  RuntimeSnapshot,
  ScheduleRange,
  SyntheticInputAccessState,
  UpdateSnapshot,
} from "./types";

const apiMocks = vi.hoisted(() => ({
  checkForUpdate: vi.fn<() => Promise<FrontendState>>(),
  getFrontendState: vi.fn<() => Promise<FrontendState>>(),
  getRuntimeSnapshot: vi.fn<() => Promise<RuntimeSnapshot>>(),
  installUpdate: vi.fn<() => Promise<FrontendState>>(),
  revealSyntheticInputAccessTarget: vi.fn<() => Promise<FrontendState>>(),
  requestSyntheticInputAccess: vi.fn<() => Promise<FrontendState>>(),
  saveConfig: vi.fn<(config: AppConfig) => Promise<FrontendState>>(),
}));

const nativeWindowMocks = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(),
  setTheme: vi.fn<(theme: "light" | "dark" | null) => Promise<void>>(),
}));

vi.mock("./api", () => ({
  checkForUpdate: apiMocks.checkForUpdate,
  getFrontendState: apiMocks.getFrontendState,
  getRuntimeSnapshot: apiMocks.getRuntimeSnapshot,
  installUpdate: apiMocks.installUpdate,
  revealSyntheticInputAccessTarget: apiMocks.revealSyntheticInputAccessTarget,
  requestSyntheticInputAccess: apiMocks.requestSyntheticInputAccess,
  saveConfig: apiMocks.saveConfig,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: nativeWindowMocks.getCurrentWindow,
}));

const {
  checkForUpdate,
  getFrontendState,
  getRuntimeSnapshot,
  installUpdate,
  revealSyntheticInputAccessTarget,
  requestSyntheticInputAccess,
  saveConfig,
} = apiMocks;
const { getCurrentWindow, setTheme } = nativeWindowMocks;

let systemPrefersDark = false;
let mediaChangeListeners = new Set<(event: MediaQueryListEvent) => void>();

function setSystemAppearance(dark: boolean) {
  systemPrefersDark = dark;
  const event = { matches: dark } as MediaQueryListEvent;
  mediaChangeListeners.forEach((listener) => listener(event));
}

function installMatchMediaMock() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: systemPrefersDark,
      media: query,
      onchange: null,
      addEventListener: (
        type: string,
        listener: (event: MediaQueryListEvent) => void,
      ) => {
        if (type === "change") {
          mediaChangeListeners.add(listener);
        }
      },
      removeEventListener: (
        type: string,
        listener: (event: MediaQueryListEvent) => void,
      ) => {
        if (type === "change") {
          mediaChangeListeners.delete(listener);
        }
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function makeRuntimeSnapshot(
  overrides: Partial<RuntimeSnapshot> = {},
): RuntimeSnapshot {
  return {
    phase: "waitingQuiet",
    statusLabel: "Observing",
    detailLabel: "Idle monitoring is running.",
    resolvedInputLabel: "F15",
    nextCheckInSeconds: 120,
    nextRelevantEpochMs: Date.now() + 120_000,
    pausedUntilEpochMs: null,
    lastFakeInputEpochMs: null,
    lastError: null,
    ...overrides,
  };
}

function makeScheduleRange(
  overrides: Partial<ScheduleRange> = {},
): ScheduleRange {
  return {
    daysOfWeek: ["Mon"],
    startMinutes: 9 * 60,
    endMinutes: 17 * 60,
    ...overrides,
  };
}

function makeUpdateSnapshot(
  overrides: Partial<UpdateSnapshot> = {},
): UpdateSnapshot {
  return {
    channel: "stable",
    configured: true,
    phase: "idle",
    currentVersion: "0.1.4",
    availableVersion: null,
    notes: null,
    downloadedBytes: null,
    contentLengthBytes: null,
    lastCheckedEpochMs: null,
    lastError: null,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    enabled: true,
    quietPeriodSeconds: 120,
    idleConfirmationPeriodSeconds: 120,
    startAtLogin: false,
    scheduleEnabled: false,
    scheduleRanges: [],
    activityMethod: "keyboard",
    selectedKey: "F15",
    showLastEventInMenuBar: true,
    customInputEnabled: false,
    customInputValue: null,
    platformKeyMapping: {
      macosKeyCode: null,
      windowsVirtualKeyCode: null,
      hidUsageCode: null,
    },
    ...overrides,
  };
}

function makeFrontendState(
  configOverrides: Partial<AppConfig> = {},
  runtimeOverrides: Partial<RuntimeSnapshot> = {},
  accessOverrides: Partial<SyntheticInputAccessState> = {},
  updateOverrides: Partial<UpdateSnapshot> = {},
): FrontendState {
  const config = makeConfig(configOverrides);

  return {
    config,
    runtime: makeRuntimeSnapshot({
      resolvedInputLabel: config.selectedKey,
      ...runtimeOverrides,
    }),
    update: makeUpdateSnapshot(updateOverrides),
    safeKeyOptions: [
      { id: "Fn", label: "Fn", supported: true },
      { id: "A", label: "A", supported: true },
      { id: "Shift", label: "Shift", supported: true },
      { id: "Option", label: "Option / Alt", supported: true },
      { id: "F13", label: "F13", supported: true },
      { id: "F14", label: "F14", supported: true },
      { id: "F15", label: "F15", supported: true },
    ],
    customInputLabel: "macOS key code",
    syntheticInputAccess: {
      supported: true,
      granted: false,
      canRequest: true,
      targetPath:
        "/Users/example/never-afk/src-tauri/target/debug/never-afk",
      ...accessOverrides,
    },
  };
}

function openAdvancedSettings() {
  const advancedLabel = screen.getByText("Advanced");
  const summary = advancedLabel.closest("summary");
  if (!summary) {
    throw new Error("Advanced settings summary was not rendered.");
  }
  fireEvent.click(summary);
}

async function waitForApp() {
  return screen.findByRole("heading", { name: "How never-afk behaves" });
}

describe("App", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.removeProperty("color-scheme");
    mediaChangeListeners.clear();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentWindow.mockReset();
    setTheme.mockReset();
    setTheme.mockResolvedValue(undefined);
    getCurrentWindow.mockReturnValue({ setTheme });
    systemPrefersDark = false;
    mediaChangeListeners = new Set();
    installMatchMediaMock();
    window.localStorage.clear();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    getFrontendState.mockResolvedValue(makeFrontendState());
    getRuntimeSnapshot.mockResolvedValue(makeRuntimeSnapshot());
    checkForUpdate.mockResolvedValue(
      makeFrontendState({}, {}, {}, { phase: "notAvailable" }),
    );
    installUpdate.mockResolvedValue(
      makeFrontendState({}, {}, {}, { phase: "notAvailable" }),
    );
    revealSyntheticInputAccessTarget.mockResolvedValue(makeFrontendState());
    requestSyntheticInputAccess.mockResolvedValue(
      makeFrontendState({}, {}, { granted: true }),
    );
    saveConfig.mockImplementation(async (config) =>
      makeFrontendState(config, { resolvedInputLabel: config.selectedKey }),
    );
  });

  it("keeps the selected key change instead of reverting to F15", async () => {
    render(<App />);
    await waitForApp();
    openAdvancedSettings();

    const presetKeySelect = screen.getByRole("combobox", {
      name: "Synthetic key",
    });
    expect((presetKeySelect as HTMLSelectElement).value).toBe("F15");

    fireEvent.change(presetKeySelect, { target: { value: "A" } });
    expect((presetKeySelect as HTMLSelectElement).value).toBe("A");

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });

    await waitFor(() =>
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ selectedKey: "A" }),
      ),
    );
    expect(
      screen.getByLabelText("Current activity configuration").textContent,
    ).toContain("A");
  }, 10000);

  it("keeps the runtime card visually aligned when activity is disabled", async () => {
    render(<App />);
    await waitForApp();

    fireEvent.click(
      screen.getByRole("switch", { name: "Automatic activity" }),
    );

    expect(screen.getByRole("heading", { name: "Disabled" })).toBeTruthy();
    expect(screen.getAllByText("Disabled").length).toBeGreaterThan(1);
    expect(screen.queryByText("Idle monitoring is running.")).toBeNull();
  });

  it("keeps the runtime card visually aligned when activity is enabled", async () => {
    getFrontendState.mockResolvedValueOnce(
      makeFrontendState(
        { enabled: false },
        {
          phase: "disabled",
          statusLabel: "Disabled",
          detailLabel: "The engine is disabled.",
          nextRelevantEpochMs: null,
        },
      ),
    );
    render(<App />);
    await waitForApp();

    fireEvent.click(
      screen.getByRole("switch", { name: "Automatic activity" }),
    );

    expect(screen.getByRole("heading", { name: "Enabled" })).toBeTruthy();
    expect(screen.queryByText("The engine is disabled.")).toBeNull();
  });

  it("polls runtime updates without resetting the current key selection", async () => {
    vi.useFakeTimers();
    getRuntimeSnapshot.mockResolvedValue(
      makeRuntimeSnapshot({
        nextCheckInSeconds: 45,
        resolvedInputLabel: "A",
      }),
    );

    try {
      render(<App />);
      await act(async () => {
        await Promise.resolve();
      });
      openAdvancedSettings();

      const presetKeySelect = screen.getByRole("combobox", {
        name: "Synthetic key",
      });
      fireEvent.change(presetKeySelect, { target: { value: "A" } });

      await act(async () => {
        vi.advanceTimersByTime(350);
        await Promise.resolve();
        vi.advanceTimersByTime(30_000);
        await Promise.resolve();
      });

      expect(getRuntimeSnapshot).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Next activity check/i)).toBeTruthy();
      expect((presetKeySelect as HTMLSelectElement).value).toBe("A");
    } finally {
      vi.useRealTimers();
    }
  }, 10000);

  it("shows an initial load error and retries successfully", async () => {
    getFrontendState.mockReset();
    getFrontendState
      .mockRejectedValueOnce(new Error("State service unavailable"))
      .mockResolvedValueOnce(makeFrontendState());

    render(<App />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "State service unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitForApp();
    expect(getFrontendState).toHaveBeenCalledTimes(2);
  });

  it("keeps the web theme functional when native theme synchronization fails", async () => {
    render(<App />);
    await waitForApp();

    setTheme.mockRejectedValueOnce(new Error("Tauri bridge unavailable"));
    fireEvent.click(
      screen.getByRole("button", { name: "Use dark appearance" }),
    );

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("dark");
  });

  it("maps system, light, and dark appearance to the native Tauri theme", async () => {
    render(<App />);
    await waitForApp();

    const systemButton = screen.getByRole("button", {
      name: "Use system appearance",
    });
    const lightButton = screen.getByRole("button", {
      name: "Use light appearance",
    });
    const darkButton = screen.getByRole("button", {
      name: "Use dark appearance",
    });

    fireEvent.click(darkButton);
    await waitFor(() => expect(setTheme).toHaveBeenLastCalledWith("dark"));
    expect(darkButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(lightButton);
    await waitFor(() => expect(setTheme).toHaveBeenLastCalledWith("light"));
    expect(lightButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(systemButton);
    await waitFor(() => expect(setTheme).toHaveBeenLastCalledWith(null));
    expect(systemButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("uses system appearance and falls back from an invalid stored value", async () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "sepia");
    render(<App />);
    await waitForApp();

    const systemButton = screen.getByRole("button", {
      name: "Use system appearance",
    });
    const lightButton = screen.getByRole("button", {
      name: "Use light appearance",
    });
    expect(systemButton.getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => setSystemAppearance(true));
    expect(document.documentElement.dataset.theme).toBe("dark");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: APPEARANCE_STORAGE_KEY,
          newValue: "light",
        }),
      );
    });
    expect(lightButton.getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("refreshes accessibility access after the window regains focus", async () => {
    getFrontendState.mockReset();
    getFrontendState
      .mockResolvedValueOnce(makeFrontendState())
      .mockResolvedValueOnce(makeFrontendState({}, {}, { granted: true }));

    const previousVisibilityState = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    try {
      render(<App />);
      await screen.findByRole("button", {
        name: "Review Accessibility",
      });

      act(() => window.dispatchEvent(new Event("focus")));

      await waitFor(() =>
        expect(
          screen.queryByRole("button", {
            name: "Review Accessibility",
          }),
        ).toBeNull(),
      );
      expect(screen.getByText("Ready")).toBeTruthy();
      expect(getFrontendState).toHaveBeenCalledTimes(2);
    } finally {
      if (previousVisibilityState) {
        Object.defineProperty(
          document,
          "visibilityState",
          previousVisibilityState,
        );
      } else {
        Reflect.deleteProperty(document, "visibilityState");
      }
    }
  });

  it("opens macOS accessibility settings and exposes Finder troubleshooting", async () => {
    render(<App />);

    const requestButton = await screen.findByRole("button", {
      name: "Review Accessibility",
    });
    expect(screen.getByText("Not verified")).toBeTruthy();
    expect(
      screen.getByText(
        "Access could not be confirmed automatically. Review Accessibility if synthetic activity does not work.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Action needed")).toBeNull();
    fireEvent.click(requestButton);
    await waitFor(() =>
      expect(requestSyntheticInputAccess).toHaveBeenCalledTimes(1),
    );

    getFrontendState.mockResolvedValue(makeFrontendState());
    requestSyntheticInputAccess.mockResolvedValue(makeFrontendState());
    cleanup();
    render(<App />);
    await waitForApp();
    fireEvent.click(screen.getByText("Troubleshooting"));
    fireEvent.click(
      screen.getByRole("button", { name: "Show never-afk in Finder" }),
    );
    await waitFor(() =>
      expect(revealSyntheticInputAccessTarget).toHaveBeenCalledTimes(1),
    );
  });

  it("keeps Finder errors visible when accessibility access is already granted", async () => {
    getFrontendState.mockResolvedValueOnce(
      makeFrontendState({}, {}, { granted: true }),
    );
    revealSyntheticInputAccessTarget.mockRejectedValueOnce(
      new Error("Finder could not reveal never-afk"),
    );

    render(<App />);
    await waitForApp();

    fireEvent.click(screen.getByText("Troubleshooting"));
    fireEvent.click(
      screen.getByRole("button", { name: "Show never-afk in Finder" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Finder could not reveal never-afk",
    );
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("omits macOS permission UI on unsupported platforms", async () => {
    getFrontendState.mockResolvedValueOnce(
      makeFrontendState({}, {}, { supported: false, granted: true }),
    );
    render(<App />);
    await waitForApp();

    expect(screen.queryByText("macOS permission")).toBeNull();
  });

  it("persists the named menu-bar visibility switch", async () => {
    render(<App />);
    await waitForApp();

    const showLastEventSwitch = screen.getByRole("switch", {
      name: "Show last event in menu bar",
    });
    expect((showLastEventSwitch as HTMLInputElement).checked).toBe(true);
    fireEvent.click(showLastEventSwitch);

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    await waitFor(() =>
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ showLastEventInMenuBar: false }),
      ),
    );
  });

  it("persists schedule enablement and uniquely labels range controls", async () => {
    render(<App />);
    await waitForApp();

    fireEvent.click(screen.getByRole("switch", { name: "Use schedule" }));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    await waitFor(() =>
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ scheduleEnabled: true }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Range" }));
    expect(screen.getByRole("group", { name: "Days for range 1" })).toBeTruthy();
    expect(screen.getByLabelText("Start time for range 1")).toBeTruthy();
    expect(screen.getByLabelText("End time for range 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove range 1" })).toBeTruthy();
    expect(screen.queryByText("Days")).toBeNull();
    expect(screen.queryByText("Time")).toBeNull();

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    await waitFor(() =>
      expect(saveConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ scheduleRanges: [makeScheduleRange()] }),
      ),
    );
  }, 10000);

  it("shows the next scheduled range in the primary runtime status", async () => {
    getFrontendState.mockResolvedValueOnce(
      makeFrontendState(
        {
          scheduleEnabled: true,
          scheduleRanges: [makeScheduleRange({ daysOfWeek: ["Wed"] })],
        },
        {
          phase: "scheduledOff",
          statusLabel: "Outside schedule",
          nextCheckInSeconds: null,
          nextRelevantEpochMs: new Date("2026-04-22T09:00:00Z").getTime(),
        },
      ),
    );
    render(<App />);

    expect(await screen.findByText(/Next scheduled range/i)).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Outside schedule" }),
    ).toBeTruthy();
  });

  it("surfaces an available update, release notes, and explicit install", async () => {
    const availableState = makeFrontendState(
      {},
      {},
      {},
      {
        phase: "available",
        availableVersion: "0.2.0",
        notes: "Improved schedule controls and reliability.",
      },
    );
    getFrontendState.mockResolvedValueOnce(availableState);
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Version 0.2.0 is ready" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Improved schedule controls and reliability."),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Download and Install" }),
    );
    await waitFor(() => expect(installUpdate).toHaveBeenCalledTimes(1));
  });

  it("guards duplicate update checks and preserves optimistic state over focus refresh", async () => {
    let resolveCheck: ((state: FrontendState) => void) | undefined;
    checkForUpdate.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );
    getFrontendState.mockReset();
    getFrontendState
      .mockResolvedValueOnce(makeFrontendState())
      .mockResolvedValueOnce(makeFrontendState());

    render(<App />);
    const checkButton = await screen.findByRole("button", {
      name: "Check for Updates",
    });
    fireEvent.click(checkButton);
    fireEvent.click(checkButton);

    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("heading", { name: "Checking for updates" }),
    ).toBeTruthy();

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(getFrontendState).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole("heading", { name: "Checking for updates" }),
    ).toBeTruthy();

    act(() => {
      resolveCheck?.(
        makeFrontendState({}, {}, {}, { phase: "notAvailable" }),
      );
    });
    expect(await screen.findByText("You're up to date")).toBeTruthy();
  });

  it("ignores a delayed focus snapshot that predates a completed update check", async () => {
    let resolveFocusRefresh: ((state: FrontendState) => void) | undefined;
    let resolveCheck: ((state: FrontendState) => void) | undefined;

    getFrontendState.mockReset();
    getFrontendState
      .mockResolvedValueOnce(makeFrontendState())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFocusRefresh = resolve;
          }),
      );
    checkForUpdate.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );

    render(<App />);
    const checkButton = await screen.findByRole("button", {
      name: "Check for Updates",
    });

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(getFrontendState).toHaveBeenCalledTimes(2));

    fireEvent.click(checkButton);
    expect(
      screen.getByRole("heading", { name: "Checking for updates" }),
    ).toBeTruthy();

    await act(async () => {
      resolveCheck?.(
        makeFrontendState({}, {}, {}, { phase: "notAvailable" }),
      );
      await Promise.resolve();
    });
    expect(
      await screen.findByRole("heading", { name: "You're up to date" }),
    ).toBeTruthy();

    await act(async () => {
      // This idle snapshot was captured before the check began. Resolving it
      // now must not replace the newer NotAvailable terminal state.
      resolveFocusRefresh?.(makeFrontendState());
      await Promise.resolve();
    });

    expect(
      screen.getByRole("heading", { name: "You're up to date" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Check for Updates" }),
    ).toBeTruthy();
  });

  it("retries a locally failed installation instead of changing it into a check", async () => {
    getFrontendState.mockResolvedValueOnce(
      makeFrontendState(
        {},
        {},
        {},
        { phase: "available", availableVersion: "0.2.0" },
      ),
    );
    installUpdate.mockRejectedValue(new Error("Signature verification failed"));
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Download and Install" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Signature verification failed",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Retry Installation" }),
    );
    await waitFor(() => expect(installUpdate).toHaveBeenCalledTimes(2));
    expect(checkForUpdate).not.toHaveBeenCalled();
  });

  it("renders an unconfigured updater honestly without actions", async () => {
    getFrontendState.mockResolvedValueOnce(
      makeFrontendState({}, {}, {}, { configured: false }),
    );
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Unavailable in this build" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Check for Updates" }),
    ).toBeNull();
  });

  it("gives every primary setting a unique accessible name", async () => {
    render(<App />);
    await waitForApp();

    expect(
      screen.getByRole("switch", { name: "Automatic activity" }),
    ).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Start at login" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Use schedule" })).toBeTruthy();
    expect(
      screen.getByRole("spinbutton", { name: "Wait before monitoring" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("spinbutton", { name: "Confirm inactivity" }),
    ).toBeTruthy();
  });
});
