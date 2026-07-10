import { useEffect, useLayoutEffect, useState } from "react";
import { getCurrentWindow, type Theme } from "@tauri-apps/api/window";

export type AppearancePreference = "system" | "light" | "dark";
export type ResolvedAppearance = Exclude<AppearancePreference, "system">;

export const APPEARANCE_STORAGE_KEY = "never-afk.appearance";
const SYSTEM_DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

export function parseAppearancePreference(
  value: string | null,
): AppearancePreference {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

function systemPrefersDark() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(SYSTEM_DARK_MODE_QUERY).matches
  );
}

export function resolveAppearance(
  preference: AppearancePreference,
  prefersDark = systemPrefersDark(),
): ResolvedAppearance {
  return preference === "system"
    ? prefersDark
      ? "dark"
      : "light"
    : preference;
}

export function resolveNativeAppearance(
  preference: AppearancePreference,
): Theme | null {
  return preference === "system" ? null : preference;
}

export function readAppearancePreference() {
  if (typeof window === "undefined") {
    return "system" satisfies AppearancePreference;
  }

  try {
    return parseAppearancePreference(
      window.localStorage.getItem(APPEARANCE_STORAGE_KEY),
    );
  } catch {
    // A disabled or unavailable storage backend should not stop the settings
    // window from rendering. System appearance remains the safest fallback.
    return "system";
  }
}

export function applyAppearance(preference: AppearancePreference) {
  if (typeof document === "undefined") {
    return;
  }

  const resolved = resolveAppearance(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;

  // CSS controls the webview, while Tauri's native theme controls surrounding
  // window chrome such as the macOS title bar. The native call is deliberately
  // best-effort: this module also runs in Vite, jsdom, and browser previews
  // where the Tauri IPC bridge does not exist, and those environments must
  // still receive a fully functional web theme.
  void syncNativeAppearance(preference);
}

async function syncNativeAppearance(preference: AppearancePreference) {
  try {
    await getCurrentWindow().setTheme(resolveNativeAppearance(preference));
  } catch {
    // A missing or unavailable native bridge must not prevent the synchronous
    // data-theme and color-scheme updates above from taking effect.
  }
}

export function initializeAppearance() {
  const preference = readAppearancePreference();
  applyAppearance(preference);
  return preference;
}

function persistAppearance(preference: AppearancePreference) {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, preference);
  } catch {
    // Appearance still changes for the current session when persistence is
    // unavailable, so storage failures stay intentionally non-fatal.
  }
}

export function useAppearance() {
  const [appearance, setAppearanceState] = useState<AppearancePreference>(
    readAppearancePreference,
  );

  useLayoutEffect(() => {
    applyAppearance(appearance);
  }, [appearance]);

  useEffect(() => {
    const mediaQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia(SYSTEM_DARK_MODE_QUERY)
        : null;

    const handleSystemAppearanceChange = () => {
      if (appearance === "system") {
        applyAppearance("system");
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== APPEARANCE_STORAGE_KEY) {
        return;
      }

      setAppearanceState(parseAppearancePreference(event.newValue));
    };

    mediaQuery?.addEventListener("change", handleSystemAppearanceChange);
    window.addEventListener("storage", handleStorageChange);

    return () => {
      mediaQuery?.removeEventListener("change", handleSystemAppearanceChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [appearance]);

  const setAppearance = (nextAppearance: AppearancePreference) => {
    persistAppearance(nextAppearance);
    setAppearanceState(nextAppearance);
  };

  return { appearance, setAppearance };
}
