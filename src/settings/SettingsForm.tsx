import { memo, type ReactNode } from "react";
import type {
  AppConfig,
  SafeKeyPreset,
  SafeKeyOption,
  SyntheticInputAccessState,
} from "../types";

type SaveState = "idle" | "saving" | "saved";

type SettingsFormProps = {
  config: AppConfig;
  customInputLabel: string;
  safeKeyOptions: SafeKeyOption[];
  syntheticInputAccess: SyntheticInputAccessState;
  busy: boolean;
  dirty: boolean;
  saveError: string | null;
  saveState: SaveState;
  permissionBusy: boolean;
  permissionNote: string | null;
  onRequestSyntheticInputAccess: () => void;
  onRevealSyntheticInputAccessTarget: () => void;
  onChange: (nextConfig: AppConfig) => void;
};

type PreferenceRowProps = {
  title: string;
  description: string;
  children: ReactNode;
};

function updateNumberField(value: string, fallback: number | null = null) {
  if (value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function PreferenceRow({
  title,
  description,
  children,
}: PreferenceRowProps) {
  // Keep each setting in a strict label/control row so the pane scans like a
  // desktop preferences window instead of a stacked web form.
  return (
    <div className="preference-row">
      <div className="preference-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>

      <div className="preference-control">{children}</div>
    </div>
  );
}

function saveStateLabel(
  saveState: SaveState,
  dirty: boolean,
  busy: boolean,
  saveError: string | null,
) {
  if (saveError) {
    return null;
  }

  if (busy || saveState === "saving") {
    return "Applying changes…";
  }

  if (dirty) {
    return "Applying changes soon…";
  }

  if (saveState === "saved") {
    return "Changes applied automatically.";
  }

  return "Changes apply automatically.";
}

export const SettingsForm = memo(function SettingsForm({
  config,
  customInputLabel,
  safeKeyOptions,
  syntheticInputAccess,
  busy,
  dirty,
  saveError,
  saveState,
  permissionBusy,
  permissionNote,
  onRequestSyntheticInputAccess,
  onRevealSyntheticInputAccessTarget,
  onChange,
}: SettingsFormProps) {
  const supportedPresetKeysLabel = safeKeyOptions
    .filter((option) => option.supported)
    .map((option) => option.label)
    .join(", ");

  return (
    <section className="preferences-pane">
      <section className="preferences-group">
        <div className="preferences-group-header">
          <h2>Startup</h2>
          <p>Basic availability and launch behavior.</p>
        </div>

        <div className="preferences-list">
          <PreferenceRow
            title="Enabled"
            description="Allow the engine to keep cycling quietly in the background."
          >
            <label className="checkbox-inline">
              <input
                className="preference-checkbox"
                type="checkbox"
                checked={config.enabled}
                onChange={(event) =>
                  onChange({ ...config, enabled: event.currentTarget.checked })
                }
              />
              <span>On</span>
            </label>
          </PreferenceRow>

          <PreferenceRow
            title="Start at login"
            description="Launch the utility automatically after you sign in."
          >
            <label className="checkbox-inline">
              <input
                className="preference-checkbox"
                type="checkbox"
                checked={config.startAtLogin}
                onChange={(event) =>
                  onChange({
                    ...config,
                    startAtLogin: event.currentTarget.checked,
                  })
                }
              />
              <span>On</span>
            </label>
          </PreferenceRow>
        </div>
      </section>

      <section className="preferences-group">
        <div className="preferences-group-header">
          <h2>Delays</h2>
          <p>Control when the engine starts watching for idleness.</p>
        </div>

        <div className="preferences-list">
          <PreferenceRow
            title="Quiet period"
            description="Time to wait before observation starts."
          >
            <div className="preference-inline">
              <input
                className="preference-input preference-input-compact"
                type="number"
                min={1}
                value={config.quietPeriodSeconds}
                onChange={(event) =>
                  onChange({
                    ...config,
                    quietPeriodSeconds: updateNumberField(
                      event.currentTarget.value,
                      config.quietPeriodSeconds,
                    ) ?? config.quietPeriodSeconds,
                  })
                }
              />
              <span className="preference-unit">seconds</span>
            </div>
          </PreferenceRow>

          <PreferenceRow
            title="Idle confirmation"
            description="Extra time used to confirm that no human input happened."
          >
            <div className="preference-inline">
              <input
                className="preference-input preference-input-compact"
                type="number"
                min={1}
                value={config.idleConfirmationPeriodSeconds}
                onChange={(event) =>
                  onChange({
                    ...config,
                    idleConfirmationPeriodSeconds: updateNumberField(
                      event.currentTarget.value,
                      config.idleConfirmationPeriodSeconds,
                    ) ?? config.idleConfirmationPeriodSeconds,
                  })
                }
              />
              <span className="preference-unit">seconds</span>
            </div>
          </PreferenceRow>
        </div>
      </section>

      <section className="preferences-group">
        <div className="preferences-group-header">
          <h2>Synthetic Key</h2>
          <p>Choose the key that will be sent when the engine acts.</p>
        </div>

        <div className="preferences-list">
          <PreferenceRow
            title="Preset key"
            description={`Built-in presets available here: ${supportedPresetKeysLabel}. Modifier presets use canonical left-side key codes, while letter presets use the standard key for that character.`}
          >
            <select
              className="preference-input"
              value={config.selectedKey}
              disabled={config.customInputEnabled}
              onChange={(event) =>
                onChange({
                  ...config,
                  selectedKey: event.currentTarget.value as SafeKeyPreset,
                })
              }
            >
              {safeKeyOptions.map((option) => (
                <option
                  key={option.id}
                  value={option.id}
                  disabled={!option.supported}
                >
                  {option.supported ? option.label : `${option.label} (unsupported here)`}
                </option>
              ))}
            </select>
          </PreferenceRow>

          <PreferenceRow
            title="Use custom input"
            description="Switch to a platform-specific key code when the preset list is not enough."
          >
            <label className="checkbox-inline">
              <input
                className="preference-checkbox"
                type="checkbox"
                checked={config.customInputEnabled}
                onChange={(event) =>
                  onChange({
                    ...config,
                    customInputEnabled: event.currentTarget.checked,
                    customInputValue: event.currentTarget.checked
                      ? config.customInputValue
                      : null,
                  })
                }
              />
              <span>Use custom code</span>
            </label>
          </PreferenceRow>

          <PreferenceRow
            title={customInputLabel}
            description="Stored as the current platform mapping and only used when custom input is enabled."
          >
            <input
              className="preference-input preference-input-compact"
              type="number"
              min={0}
              value={config.customInputValue ?? ""}
              disabled={!config.customInputEnabled}
              onChange={(event) =>
                onChange({
                  ...config,
                  customInputValue: updateNumberField(event.currentTarget.value),
                })
              }
            />
          </PreferenceRow>
        </div>
      </section>

      {syntheticInputAccess.supported ? (
        <section className="preferences-group">
          <div className="preferences-group-header">
            <h2>Permissions</h2>
            <p>macOS needs accessibility access before synthetic keys can reach other apps.</p>
          </div>

          <div className="preferences-list">
            <PreferenceRow
              title="Accessibility access"
              description="Required for test input and scheduled key presses to be delivered to the focused app."
            >
              <span
                className={`permission-status ${
                  syntheticInputAccess.granted
                    ? "permission-status-granted"
                    : "permission-status-missing"
                }`}
              >
                {syntheticInputAccess.granted ? "Granted" : "Required"}
              </span>
            </PreferenceRow>

            <PreferenceRow
              title="Request permission"
              description="Ask macOS for accessibility access and open the correct Settings page if approval is still needed."
            >
              <div className="button-cluster">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={
                    permissionBusy ||
                    !syntheticInputAccess.canRequest ||
                    syntheticInputAccess.granted
                  }
                  onClick={onRequestSyntheticInputAccess}
                >
                  {syntheticInputAccess.granted
                    ? "Access Granted"
                    : permissionBusy
                      ? "Opening…"
                      : "Request Access"}
                </button>

                <button
                  className="secondary-button"
                  type="button"
                  disabled={permissionBusy || !syntheticInputAccess.targetPath}
                  onClick={onRevealSyntheticInputAccessTarget}
                >
                  Reveal Binary
                </button>
              </div>
            </PreferenceRow>

            {syntheticInputAccess.targetPath ? (
              <PreferenceRow
                title="Current executable"
                description="This exact binary is the one macOS must allow while the app runs in tauri dev."
              >
                <code className="path-chip">{syntheticInputAccess.targetPath}</code>
              </PreferenceRow>
            ) : null}
          </div>

          <div className="preferences-group-footer">
            <p className="permission-note">
              {permissionNote ??
                (syntheticInputAccess.granted
                  ? "Accessibility access is enabled. You can retry the text editor test now."
                  : "After approving access, return here and test the synthetic key again in your editor.")}
            </p>
          </div>
        </section>
      ) : null}

      {saveError ? (
        <p className="status-banner" role="alert">
          {saveError}
        </p>
      ) : null}

      <div className="form-actions">
        <p className="autosave-status">
          {saveStateLabel(saveState, dirty, busy, saveError)}
        </p>
      </div>
    </section>
  );
});

SettingsForm.displayName = "SettingsForm";
