import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { AppConfig, FrontendState, RuntimeSnapshot } from "./types";

const apiMocks = vi.hoisted(() => ({
  getFrontendState: vi.fn<() => Promise<FrontendState>>(),
  saveConfig: vi.fn<(config: AppConfig) => Promise<FrontendState>>(),
}));

vi.mock("./api", () => ({
  getFrontendState: apiMocks.getFrontendState,
  saveConfig: apiMocks.saveConfig,
}));

const { getFrontendState, saveConfig } = apiMocks;

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
      { id: "Shift", label: "Shift", supported: true },
      { id: "Option", label: "Option / Alt", supported: true },
      { id: "F13", label: "F13", supported: true },
      { id: "F14", label: "F14", supported: true },
      { id: "F15", label: "F15", supported: true },
    ],
    platformName: "macOS",
    customInputLabel: "macOS key code",
  };
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    getFrontendState.mockResolvedValue(makeFrontendState());
    saveConfig.mockImplementation(async (config) =>
      makeFrontendState(config, { resolvedInputLabel: config.selectedKey }),
    );
  });

  it("keeps the selected key change instead of reverting to F15", async () => {
    render(<App />);

    const presetKeySelect = await screen.findByRole("combobox");
    expect((presetKeySelect as HTMLSelectElement).value).toBe("F15");

    fireEvent.change(presetKeySelect, { target: { value: "Shift" } });
    expect((presetKeySelect as HTMLSelectElement).value).toBe("Shift");

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });

    await waitFor(() =>
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ selectedKey: "Shift" }),
      ),
    );

    await waitFor(() =>
      expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
        "Shift",
      ),
    );
    expect(screen.getByText(/Current key/i).textContent).toContain("Shift");
  }, 10000);

  it("does not poll runtime updates while the settings window is active", async () => {
    render(<App />);

    await screen.findByRole("combobox");
    const initialRequestCount = getFrontendState.mock.calls.length;

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    });

    expect(getFrontendState).toHaveBeenCalledTimes(initialRequestCount);
  }, 10000);
});
