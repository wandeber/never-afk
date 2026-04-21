import type { AppConfig, RuntimeSnapshot, SafeKeyPreset, SafeKeyOption } from "../types";

type SettingsFormProps = {
  config: AppConfig;
  customInputLabel: string;
  safeKeyOptions: SafeKeyOption[];
  busy: boolean;
  dirty: boolean;
  saveError: string | null;
  runtime: RuntimeSnapshot;
  onChange: (nextConfig: AppConfig) => void;
  onSave: () => Promise<void>;
};

function updateNumberField(value: string, fallback: number | null = null) {
  if (value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function SettingsForm({
  config,
  customInputLabel,
  safeKeyOptions,
  busy,
  dirty,
  saveError,
  runtime,
  onChange,
  onSave,
}: SettingsFormProps) {
  const supportedSafeKeys = safeKeyOptions.filter((option) => option.supported);

  return (
    <section className="settings-screen">
      <div className="settings-group">
        <div className="group-heading">
          <h2>Startup</h2>
          <p>Basic availability and login behavior.</p>
        </div>

        <div className="form-grid form-grid-compact">
          <label className="field checkbox-field checkbox-row">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(event) =>
                onChange({ ...config, enabled: event.currentTarget.checked })
              }
            />
            <span>
              <strong>Enabled</strong>
              <small>Allow the engine to keep cycling quietly in the background.</small>
            </span>
          </label>

          <label className="field checkbox-field checkbox-row">
            <input
              type="checkbox"
              checked={config.startAtLogin}
              onChange={(event) =>
                onChange({ ...config, startAtLogin: event.currentTarget.checked })
              }
            />
            <span>
              <strong>Start at login</strong>
              <small>Launch the utility automatically after you sign in.</small>
            </span>
          </label>
        </div>
      </div>

      <div className="settings-group">
        <div className="group-heading">
          <h2>Delays</h2>
          <p>Control when the engine starts watching for idleness.</p>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Quiet period</span>
            <input
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
            <small>Seconds to wait before observation starts.</small>
          </label>

          <label className="field">
            <span>Idle confirmation</span>
            <input
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
            <small>Extra seconds used to confirm that no human input happened.</small>
          </label>
        </div>
      </div>

      <div className="settings-group">
        <div className="group-heading">
          <h2>Synthetic key</h2>
          <p>Choose the key that will be sent when the engine acts.</p>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Safe key preset</span>
            <select
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
            <small>
              Available here: {supportedSafeKeys.map((option) => option.label).join(", ")}
            </small>
          </label>

          <label className="field checkbox-field checkbox-row">
            <input
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
            <span>
              <strong>Use custom input</strong>
              <small>Switch to a platform-specific key code when needed.</small>
            </span>
          </label>

          <label className="field field-wide">
            <span>{customInputLabel}</span>
            <input
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
            <small>
              Stored as the current platform mapping and only used when custom input is enabled.
            </small>
          </label>
        </div>

        <p className="section-note">
          Current runtime key: <strong>{runtime.resolvedInputLabel}</strong>
        </p>
      </div>

      {saveError ? (
        <p className="status-banner" role="alert">
          {saveError}
        </p>
      ) : null}

      <div className="form-actions">
        <button
          className="primary-button"
          type="button"
          onClick={onSave}
          disabled={!dirty || busy}
        >
          {busy ? "Saving..." : "Save settings"}
        </button>
      </div>
    </section>
  );
}
