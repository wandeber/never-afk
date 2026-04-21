import type { ReactNode } from "react";
import type { AppConfig, SafeKeyPreset, SafeKeyOption } from "../types";

type SaveState = "idle" | "saving" | "saved";

type SettingsFormProps = {
  config: AppConfig;
  customInputLabel: string;
  safeKeyOptions: SafeKeyOption[];
  busy: boolean;
  dirty: boolean;
  saveError: string | null;
  saveState: SaveState;
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

export function SettingsForm({
  config,
  customInputLabel,
  safeKeyOptions,
  busy,
  dirty,
  saveError,
  saveState,
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
}
