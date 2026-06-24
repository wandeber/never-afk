import { memo, type ReactNode } from "react";
import type {
  AppConfig,
  SafeKeyPreset,
  SafeKeyOption,
  SaveState,
  SyntheticInputAccessState,
  UpdateSnapshot,
} from "../types";
import { SchedulePreferences } from "./SchedulePreferences";

type SettingsFormProps = {
  config: AppConfig;
  customInputLabel: string;
  safeKeyOptions: SafeKeyOption[];
  syntheticInputAccess: SyntheticInputAccessState;
  update: UpdateSnapshot;
  busy: boolean;
  dirty: boolean;
  saveError: string | null;
  saveState: SaveState;
  permissionBusy: boolean;
  permissionNote: string | null;
  onRequestSyntheticInputAccess: () => void;
  onRevealSyntheticInputAccessTarget: () => void;
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
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

function PreferenceRow({ title, description, children }: PreferenceRowProps) {
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

function formatUpdateProgress(update: UpdateSnapshot) {
  if (
    update.downloadedBytes === null ||
    update.contentLengthBytes === null ||
    update.contentLengthBytes <= 0
  ) {
    return "Downloading update.";
  }

  const percent = Math.min(
    100,
    Math.floor((update.downloadedBytes / update.contentLengthBytes) * 100),
  );
  return `Downloading update ${percent}%.`;
}

function updateStatusLabel(update: UpdateSnapshot) {
  if (!update.configured) {
    return "Updater signing is not configured for this build.";
  }

  if (update.lastError) {
    return update.lastError;
  }

  switch (update.phase) {
    case "checking":
      return "Checking GitHub Releases.";
    case "available":
      return update.availableVersion
        ? `Version ${update.availableVersion} is available.`
        : "An update is available.";
    case "notAvailable":
      return "This version is up to date.";
    case "downloading":
      return formatUpdateProgress(update);
    case "installing":
      return "Installing update and relaunching.";
    case "error":
      return "The last update action failed.";
    case "idle":
    default:
      return `Current version ${update.currentVersion}.`;
  }
}

export const SettingsForm = memo(function SettingsForm({
  config,
  customInputLabel,
  safeKeyOptions,
  syntheticInputAccess,
  update,
  busy,
  dirty,
  saveError,
  saveState,
  permissionBusy,
  permissionNote,
  onRequestSyntheticInputAccess,
  onRevealSyntheticInputAccessTarget,
  onCheckForUpdates,
  onInstallUpdate,
  onChange,
}: SettingsFormProps) {
  const updateBusy = ["checking", "downloading", "installing"].includes(
    update.phase,
  );
  const updateAvailable = update.phase === "available";

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

          <PreferenceRow
            title="Show last event in menu bar"
            description="Display the latest synthetic-event timestamp next to the tray icon."
          >
            <label className="checkbox-inline">
              <input
                className="preference-checkbox"
                type="checkbox"
                checked={config.showLastEventInMenuBar}
                onChange={(event) =>
                  onChange({
                    ...config,
                    showLastEventInMenuBar: event.currentTarget.checked,
                  })
                }
              />
              <span>On</span>
            </label>
          </PreferenceRow>
        </div>
      </section>

      <SchedulePreferences config={config} onChange={onChange} />

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
                    quietPeriodSeconds:
                      updateNumberField(
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
                    idleConfirmationPeriodSeconds:
                      updateNumberField(
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
            description="Choose one of the built-in safe presets. Modifier presets use canonical left-side key codes."
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
                  {option.supported
                    ? option.label
                    : `${option.label} (unsupported here)`}
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
                  customInputValue: updateNumberField(
                    event.currentTarget.value,
                  ),
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
            <p>
              macOS needs accessibility access before synthetic keys can reach
              other apps.
            </p>
          </div>

          <div className="preferences-list">
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
                description="This exact executable is the one macOS must allow in Accessibility for the current app session."
              >
                <code className="path-chip">
                  {syntheticInputAccess.targetPath}
                </code>
              </PreferenceRow>
            ) : null}
          </div>

          <div className="preferences-group-footer">
            <p className="permission-note">
              {permissionNote ??
                (syntheticInputAccess.granted
                  ? "Accessibility access is enabled. Scheduled synthetic keys can now reach other apps."
                  : "After approving access, return here and the engine should be able to deliver the configured synthetic key.")}
            </p>
          </div>
        </section>
      ) : null}

      <section className="preferences-group">
        <div className="preferences-group-header">
          <h2>Updates</h2>
          <p>Install published GitHub release updates for this build channel.</p>
        </div>

        <div className="preferences-list">
          <PreferenceRow
            title="Release channel"
            description="The channel is selected at build time so store builds can use their own update path later."
          >
            <code className="path-chip">{update.channel}</code>
          </PreferenceRow>

          <PreferenceRow
            title="GitHub updater"
            description="Check the configured release manifest and install a signed update when one is available."
          >
            <div className="button-cluster">
              <button
                className="secondary-button"
                type="button"
                disabled={!update.configured || updateBusy}
                onClick={onCheckForUpdates}
              >
                {update.phase === "checking" ? "Checking..." : "Check Now"}
              </button>

              <button
                className="secondary-button"
                type="button"
                disabled={!update.configured || updateBusy || !updateAvailable}
                onClick={onInstallUpdate}
              >
                {update.phase === "downloading"
                  ? "Downloading..."
                  : update.phase === "installing"
                    ? "Installing..."
                    : "Download and Install"}
              </button>
            </div>
          </PreferenceRow>
        </div>

        <div className="preferences-group-footer">
          <p className="permission-note">{updateStatusLabel(update)}</p>
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
});

SettingsForm.displayName = "SettingsForm";
