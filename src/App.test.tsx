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
import type {
  AppConfig,
  FrontendState,
  RuntimeSnapshot,
  SyntheticInputAccessState,
} from "./types";

const apiMocks = vi.hoisted(() => ({
  getFrontendState: vi.fn<() => Promise<FrontendState>>(),
  revealSyntheticInputAccessTarget: vi.fn<() => Promise<FrontendState>>(),
  requestSyntheticInputAccess: vi.fn<() => Promise<FrontendState>>(),
  saveConfig: vi.fn<(config: AppConfig) => Promise<FrontendState>>(),
}));

vi.mock("./api", () => ({
  getFrontendState: apiMocks.getFrontendState,
  revealSyntheticInputAccessTarget: apiMocks.revealSyntheticInputAccessTarget,
  requestSyntheticInputAccess: apiMocks.requestSyntheticInputAccess,
  saveConfig: apiMocks.saveConfig,
}));

const {
  getFrontendState,
  revealSyntheticInputAccessTarget,
  requestSyntheticInputAccess,
  saveConfig,
} = apiMocks;

function makeRuntimeSnapshot(
  overrides: Partial<RuntimeSnapshot> = {},
): RuntimeSnapshot {
  return {
    phase: "waitingQuiet",
    statusLabel: "Observing",
    detailLabel: "Idle monitoring is running.",
    resolvedInputLabel: "F15",
    nextCheckInSeconds: 120,
    pausedUntilEpochMs: null,
    lastFakeInputEpochMs: null,
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
    activityMethod: "keyboard",
    selectedKey: "F15",
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
): FrontendState {
  const config = makeConfig(configOverrides);

  return {
    config,
    runtime: makeRuntimeSnapshot({
      resolvedInputLabel: config.selectedKey,
      ...runtimeOverrides,
    }),
    safeKeyOptions: [
      { id: "Fn", label: "Fn", supported: true },
      { id: "A", label: "A", supported: true },
      { id: "Shift", label: "Shift", supported: true },
      { id: "Option", label: "Option / Alt", supported: true },
      { id: "F13", label: "F13", supported: true },
      { id: "F14", label: "F14", supported: true },
      { id: "F15", label: "F15", supported: true },
    ],
    platformName: "macOS",
    customInputLabel: "macOS key code",
    syntheticInputAccess: {
      supported: true,
      granted: false,
      canRequest: true,
      targetPath: "/Users/wandeber/Projects/Personal/never-afk/src-tauri/target/debug/never-afk",
      ...accessOverrides,
    },
  };
}

describe("App", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    getFrontendState.mockResolvedValue(makeFrontendState());
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

    const presetKeySelect = await screen.findByRole("combobox");
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

    await waitFor(() =>
      expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
        "A",
      ),
    );
    expect(screen.getByText(/Current key/i).textContent).toContain("A");
  }, 10000);

  it("polls runtime updates without resetting the current key selection", async () => {
    getFrontendState.mockReset();
    getFrontendState
      .mockResolvedValueOnce(makeFrontendState())
      .mockResolvedValue(
        makeFrontendState(
          { selectedKey: "A" },
          {
            nextCheckInSeconds: 45,
            resolvedInputLabel: "A",
          },
        ),
      );

    render(<App />);

    const presetKeySelect = await screen.findByRole("combobox");
    fireEvent.change(presetKeySelect, { target: { value: "A" } });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    });

    await waitFor(() =>
      expect(getFrontendState.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(screen.getByText("Next check in 45s")).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("A");
    expect(screen.getByText(/Current key/i).textContent).toContain("A");
  }, 10000);

  it("refreshes accessibility access after the window regains focus", async () => {
    getFrontendState.mockReset();
    getFrontendState
      .mockResolvedValueOnce(makeFrontendState())
      .mockResolvedValueOnce(
        makeFrontendState({}, {}, { granted: true }),
      );

    const previousVisibilityState = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );

    // The refresh-on-return flow is gated on the window being visible, so the
    // test pins the document state to the same value a foreground Tauri window
    // reports after the user comes back from System Settings.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    try {
      render(<App />);

      await screen.findByText("Required");

      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      await waitFor(() => expect(screen.getByText("Granted")).toBeTruthy());
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
  }, 10000);

  it("requests macOS accessibility access from the permissions section", async () => {
    render(<App />);

    const requestButtons = await screen.findAllByRole("button", {
      name: "Request Access",
    });
    fireEvent.click(requestButtons[0]!);

    await waitFor(() =>
      expect(requestSyntheticInputAccess).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Access Granted" }),
      ).toBeTruthy(),
    );
  }, 10000);

  it("reveals the current dev binary from the permissions section", async () => {
    render(<App />);

    const revealButtons = await screen.findAllByRole("button", {
      name: "Reveal Binary",
    });
    fireEvent.click(revealButtons[0]!);

    await waitFor(() =>
      expect(revealSyntheticInputAccessTarget).toHaveBeenCalledTimes(1),
    );
  }, 10000);
});
