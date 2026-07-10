import { memo, type ReactNode } from "react";
import type { AppConfig, SafeKeyOption, SafeKeyPreset } from "../types";
import { SchedulePreferences } from "./SchedulePreferences";

type SettingsFormProps = {
  config: AppConfig;
  customInputLabel: string;
  safeKeyOptions: SafeKeyOption[];
  onChange: (nextConfig: AppConfig) => void;
};

type PreferenceRowProps = {
  controlId: string;
  title: string;
  description: string;
  children: ReactNode;
};

type PreferenceSwitchProps = {
  id: string;
  describedBy: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

function updateNumberField(value: string, fallback: number | null = null) {
  if (value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function PreferenceRow({
  controlId,
  title,
  description,
  children,
}: PreferenceRowProps) {
  return (
    <div className="preference-row">
      <div className="preference-copy">
        <label className="preference-title" htmlFor={controlId}>
          {title}
        </label>
        <p id={`${controlId}-description`}>{description}</p>
      </div>

      <div className="preference-control">{children}</div>
    </div>
  );
}

function PreferenceSwitch({
  id,
  describedBy,
  checked,
  onChange,
}: PreferenceSwitchProps) {
  return (
    <label className="switch-control" htmlFor={id}>
      <input
        id={id}
        className="switch-input"
        type="checkbox"
        role="switch"
        checked={checked}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-state" aria-hidden="true">
        {checked ? "On" : "Off"}
      </span>
    </label>
  );
}

export const SettingsForm = memo(function SettingsForm({
  config,
  customInputLabel,
  safeKeyOptions,
  onChange,
}: SettingsFormProps) {
  return (
    <section className="preferences-pane" aria-label="Settings">
      <div className="settings-heading">
        <div>
          <p className="section-kicker">Preferences</p>
          <h2>How never-afk behaves</h2>
        </div>
        <p>Changes are saved automatically.</p>
      </div>

      <section className="preferences-group">
        <div className="preferences-group-header">
          <h2>General</h2>
          <p>Launch and menu bar behavior.</p>
        </div>

        <div className="preferences-list">
          <PreferenceRow
            controlId="start-at-login"
            title="Start at login"
            description="Launch never-afk automatically after you sign in."
          >
            <PreferenceSwitch
              id="start-at-login"
              describedBy="start-at-login-description"
              checked={config.startAtLogin}
              onChange={(checked) =>
                onChange({ ...config, startAtLogin: checked })
              }
            />
          </PreferenceRow>

          <PreferenceRow
            controlId="show-last-event"
            title="Show last event in menu bar"
            description="Show the latest synthetic-event time next to the menu bar icon."
          >
            <PreferenceSwitch
              id="show-last-event"
              describedBy="show-last-event-description"
              checked={config.showLastEventInMenuBar}
              onChange={(checked) =>
                onChange({ ...config, showLastEventInMenuBar: checked })
              }
            />
          </PreferenceRow>
        </div>
      </section>

      <SchedulePreferences config={config} onChange={onChange} />

      <section className="preferences-group">
        <div className="preferences-group-header">
          <h2>Timing</h2>
          <p>Decide how cautiously never-afk confirms that you are away.</p>
        </div>

        <div className="preferences-list">
          <PreferenceRow
            controlId="quiet-period"
            title="Wait before monitoring"
            description="How long to wait after a cycle before watching for inactivity."
          >
            <div className="preference-inline">
              <input
                id="quiet-period"
                className="preference-input preference-input-compact"
                type="number"
                min={1}
                value={config.quietPeriodSeconds}
                aria-describedby="quiet-period-description quiet-period-unit"
                onChange={(event) =>
                  onChange({
                    ...config,
                    quietPeriodSeconds:
                      updateNumberField(
                        event.currentTarget.value,
                        config.quietPeriodSeconds,
                      ) ?? config.quietPeriodSeconds,
                  })
                }
              />
              <span id="quiet-period-unit" className="preference-unit">
                seconds
              </span>
            </div>
          </PreferenceRow>

          <PreferenceRow
            controlId="idle-confirmation"
            title="Confirm inactivity"
            description="Extra time with no human input before sending the configured key."
          >
            <div className="preference-inline">
              <input
                id="idle-confirmation"
                className="preference-input preference-input-compact"
                type="number"
                min={1}
                value={config.idleConfirmationPeriodSeconds}
                aria-describedby="idle-confirmation-description idle-confirmation-unit"
                onChange={(event) =>
                  onChange({
                    ...config,
                    idleConfirmationPeriodSeconds:
                      updateNumberField(
                        event.currentTarget.value,
                        config.idleConfirmationPeriodSeconds,
                      ) ?? config.idleConfirmationPeriodSeconds,
                  })
                }
              />
              <span id="idle-confirmation-unit" className="preference-unit">
                seconds
              </span>
            </div>
          </PreferenceRow>
        </div>
      </section>

      <details className="preferences-group advanced-group">
        <summary className="advanced-summary">
          <span>
            <strong>Advanced</strong>
            <small>Synthetic key and platform-specific input codes.</small>
          </span>
          <span className="disclosure-label" aria-hidden="true">
            Show
          </span>
        </summary>

        <div className="preferences-list advanced-content">
          <PreferenceRow
            controlId="preset-key"
            title="Synthetic key"
            description="Choose a safe key that is unlikely to interfere with your work."
          >
            <select
              id="preset-key"
              className="preference-input"
              value={config.selectedKey}
              disabled={config.customInputEnabled}
              aria-describedby="preset-key-description"
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
          </PreferenceRow>

          <PreferenceRow
            controlId="custom-input-enabled"
            title="Use a custom key code"
            description="Enable a platform-specific code only when the safe presets are not enough."
          >
            <PreferenceSwitch
              id="custom-input-enabled"
              describedBy="custom-input-enabled-description"
              checked={config.customInputEnabled}
              onChange={(checked) =>
                onChange({
                  ...config,
                  customInputEnabled: checked,
                  customInputValue: checked ? config.customInputValue : null,
                })
              }
            />
          </PreferenceRow>

          <PreferenceRow
            controlId="custom-input-value"
            title={customInputLabel}
            description="Stored for this platform and used only while custom input is enabled."
          >
            <input
              id="custom-input-value"
              className="preference-input preference-input-compact"
              type="number"
              min={0}
              value={config.customInputValue ?? ""}
              disabled={!config.customInputEnabled}
              aria-describedby="custom-input-value-description"
              onChange={(event) =>
                onChange({
                  ...config,
                  customInputValue: updateNumberField(event.currentTarget.value),
                })
              }
            />
          </PreferenceRow>
        </div>
      </details>
    </section>
  );
});

SettingsForm.displayName = "SettingsForm";
