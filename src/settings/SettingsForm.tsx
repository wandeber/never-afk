import type { AppConfig, SafeKeyPreset, SafeKeyOption } from "../types";

type SettingsFormProps = {
  config: AppConfig;
  customInputLabel: string;
  safeKeyOptions: SafeKeyOption[];
  busy: boolean;
  dirty: boolean;
  saveError: string | null;
  onChange: (nextConfig: AppConfig) => void;
  onSave: () => Promise<void>;
};

function updateNumberField(
  value: string,
  fallback: number | null = null,
) {
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
  onChange,
  onSave,
}: SettingsFormProps) {
  const supportedSafeKeys = safeKeyOptions.filter((option) => option.supported);

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Engine configuration</h2>
        </div>
      </div>

      <div className="form-grid">
        <label className="field checkbox-field">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) =>
              onChange({ ...config, enabled: event.currentTarget.checked })
            }
          />
          <span>
            <strong>Enabled</strong>
            <small>Allow the resident engine to run the quiet + observe cycle.</small>
          </span>
        </label>

        <label className="field checkbox-field">
          <input
            type="checkbox"
            checked={config.startAtLogin}
            onChange={(event) =>
              onChange({ ...config, startAtLogin: event.currentTarget.checked })
            }
          />
          <span>
            <strong>Start at login</strong>
            <small>Register the app for login-item startup on supported platforms.</small>
          </span>
        </label>

        <label className="field">
          <span>Quiet period (seconds)</span>
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
        </label>

        <label className="field">
          <span>Idle confirmation (seconds)</span>
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
        </label>

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
            Built-in presets available on this platform:{" "}
            {supportedSafeKeys.map((option) => option.label).join(", ")}
          </small>
        </label>

        <label className="field checkbox-field">
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
            <small>
              Switch from the safe preset list to a platform-specific code path.
            </small>
          </span>
        </label>

        <label className="field">
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
            Required only when custom input is enabled. The value is stored for the
            current platform mapping.
          </small>
        </label>
      </div>

      {saveError ? (
        <p className="status-banner" role="alert">
          {saveError}
        </p>
      ) : null}

      <div className="form-actions">
        <button type="button" onClick={onSave} disabled={!dirty || busy}>
          {busy ? "Saving..." : "Save settings"}
        </button>
      </div>
    </section>
  );
}
