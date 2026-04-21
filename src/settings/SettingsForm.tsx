import type { AppConfig, SafeKeyPreset, SafeKeyOption } from "../types";

export const settingsSections = [
  {
    id: "general",
    title: "General",
    sidebarSummary: "Availability and login behavior.",
    description: "Choose when the resident engine is allowed to run.",
  },
  {
    id: "timing",
    title: "Timing",
    sidebarSummary: "Quiet and confirmation delays.",
    description: "Control how long the app waits before it validates idleness.",
  },
  {
    id: "input",
    title: "Input",
    sidebarSummary: "Safe preset or custom key code.",
    description: "Pick the synthetic key the engine should emit when it acts.",
  },
] as const;

export type SettingsSectionId = (typeof settingsSections)[number]["id"];

type SettingsFormProps = {
  activeSection: SettingsSectionId;
  config: AppConfig;
  customInputLabel: string;
  safeKeyOptions: SafeKeyOption[];
  busy: boolean;
  dirty: boolean;
  saveError: string | null;
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
  activeSection,
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
  const activeSectionMeta = settingsSections.find(
    (section) => section.id === activeSection,
  )!;

  function renderActiveSection() {
    // Show one settings group at a time so the detail view feels like a native
    // preferences pane instead of a long dashboard with duplicated state.
    switch (activeSection) {
      case "general":
        return (
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
                <small>
                  Allow the engine to keep cycling quietly in the background.
                </small>
              </span>
            </label>

            <label className="field checkbox-field checkbox-row">
              <input
                type="checkbox"
                checked={config.startAtLogin}
                onChange={(event) =>
                  onChange({
                    ...config,
                    startAtLogin: event.currentTarget.checked,
                  })
                }
              />
              <span>
                <strong>Start at login</strong>
                <small>
                  Register a login item so the tray utility is ready after sign
                  in.
                </small>
              </span>
            </label>
          </div>
        );
      case "timing":
        return (
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
              <small>
                Seconds to wait before the engine starts observing for idleness.
              </small>
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
              <small>
                Extra seconds used to confirm that no human input happened.
              </small>
            </label>
          </div>
        );
      case "input":
        return (
          <>
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
                      {option.supported
                        ? option.label
                        : `${option.label} (unsupported here)`}
                    </option>
                  ))}
                </select>
                <small>
                  Available here:{" "}
                  {supportedSafeKeys.map((option) => option.label).join(", ")}
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
                  <small>
                    Switch from the safe preset list to a platform-specific code
                    path.
                  </small>
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
                      customInputValue: updateNumberField(
                        event.currentTarget.value,
                      ),
                    })
                  }
                />
                <small>
                  Stored as the current platform mapping and only used when
                  custom input is enabled.
                </small>
              </label>
            </div>

            <p className="section-note">
              Safe presets are preferred because they avoid platform-specific
              keycode guessing and keep the default behavior predictable.
            </p>
          </>
        );
    }
  }

  return (
    <section className="settings-detail">
      <div className="settings-header">
        <div>
          <p className="eyebrow">Preferences</p>
          <h2>{activeSectionMeta.title}</h2>
          <p className="panel-summary">{activeSectionMeta.description}</p>
        </div>
      </div>

      <div className="settings-body">
        {renderActiveSection()}

        {saveError ? (
          <p className="status-banner" role="alert">
            {saveError}
          </p>
        ) : null}
      </div>

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
