import { formatRuntimeNote } from "../runtimeLabels";
import type {
  AppConfig,
  PermissionFeedback,
  RuntimeSnapshot,
  SyntheticInputAccessState,
  UpdateActionKind,
  UpdateSnapshot,
} from "../types";

type StatusTone = "active" | "neutral" | "warning" | "danger" | "success";

type OverviewPanelProps = {
  config: AppConfig;
  runtime: RuntimeSnapshot;
  syntheticInputAccess: SyntheticInputAccessState;
  update: UpdateSnapshot;
  permissionBusy: boolean;
  permissionFeedback: PermissionFeedback | null;
  updateActionKind: UpdateActionKind | null;
  lastFailedUpdateAction: UpdateActionKind | null;
  onConfigChange: (nextConfig: AppConfig) => void;
  onRequestSyntheticInputAccess: () => void;
  onRevealSyntheticInputAccessTarget: () => void;
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
};

type StatusPresentation = {
  label: string;
  description: string;
  tone: StatusTone;
};

export function runtimeTone(runtime: RuntimeSnapshot): StatusTone {
  if (runtime.lastError || runtime.phase === "error") {
    return "danger";
  }

  switch (runtime.phase) {
    case "waitingQuiet":
    case "observing":
      return "active";
    case "scheduledOff":
      return "warning";
    case "disabled":
    case "paused":
      return "neutral";
  }
}

function formatUpdateProgress(update: UpdateSnapshot) {
  if (
    update.downloadedBytes === null ||
    update.contentLengthBytes === null ||
    update.contentLengthBytes <= 0
  ) {
    return "Downloading the signed update. never-afk will relaunch when installation finishes.";
  }

  const percent = Math.min(
    100,
    Math.floor((update.downloadedBytes / update.contentLengthBytes) * 100),
  );
  return `Downloading the signed update — ${percent}%. never-afk will relaunch when installation finishes.`;
}

export function updatePresentation(
  update: UpdateSnapshot,
): StatusPresentation {
  if (!update.configured) {
    return {
      label: "Unavailable in this build",
      description:
        "This copy of never-afk was built without in-app update support.",
      tone: "neutral",
    };
  }

  if (update.lastError || update.phase === "error") {
    return {
      label: "Update failed",
      description: update.lastError ?? "The last update action failed.",
      tone: "danger",
    };
  }

  switch (update.phase) {
    case "checking":
      return {
        label: "Checking for updates",
        description: "Looking for a newer signed release.",
        tone: "active",
      };
    case "available":
      return {
        label: update.availableVersion
          ? `Version ${update.availableVersion} is ready`
          : "An update is ready",
        description:
          "Download and install it here. never-afk will relaunch automatically.",
        tone: "warning",
      };
    case "notAvailable":
      return {
        label: "You're up to date",
        description: `Version ${update.currentVersion} is the latest available release.`,
        tone: "success",
      };
    case "downloading":
      return {
        label: "Downloading and installing",
        description: formatUpdateProgress(update),
        tone: "active",
      };
    case "installing":
      return {
        label: "Finishing installation",
        description: "never-afk is about to relaunch with the new version.",
        tone: "active",
      };
    case "idle":
      return {
        label: "Ready to check",
        description: `You are using version ${update.currentVersion}.`,
        tone: "neutral",
      };
  }
}

function StatusBadge({ tone, children }: { tone: StatusTone; children: string }) {
  return <span className={`status-badge status-badge-${tone}`}>{children}</span>;
}

function RuntimeOverview({
  config,
  runtime,
  onConfigChange,
}: Pick<OverviewPanelProps, "config" | "runtime" | "onConfigChange">) {
  const tone = runtimeTone(runtime);
  const runtimeMessage = runtime.lastError ?? formatRuntimeNote(runtime);

  return (
    <section className={`runtime-card runtime-card-${tone}`}>
      <div className="runtime-copy" aria-live="polite">
        <div className="section-kicker-row">
          <p className="section-kicker">Automatic activity</p>
          <StatusBadge tone={tone}>{runtime.statusLabel}</StatusBadge>
        </div>
        <h1>{runtime.statusLabel}</h1>
        <p
          className="runtime-lead"
          role={runtime.lastError || runtime.phase === "error" ? "alert" : undefined}
        >
          {runtimeMessage}
        </p>
        {!runtime.lastError && runtime.detailLabel ? (
          <p className="runtime-detail">{runtime.detailLabel}</p>
        ) : null}
      </div>

      <div className="runtime-controls">
        <label className="master-switch" htmlFor="automatic-activity-enabled">
          <span className="master-switch-label">
            {config.enabled ? "Enabled" : "Disabled"}
          </span>
          <input
            id="automatic-activity-enabled"
            className="switch-input"
            type="checkbox"
            role="switch"
            checked={config.enabled}
            aria-label="Automatic activity"
            aria-describedby="automatic-activity-description"
            onChange={(event) =>
              onConfigChange({
                ...config,
                enabled: event.currentTarget.checked,
              })
            }
          />
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
        </label>
        <span id="automatic-activity-description" className="sr-only">
          Allow never-afk to monitor idle time and send the configured key.
        </span>
      </div>

      <div className="runtime-meta" aria-label="Current activity configuration">
        <span>
          Key <strong>{runtime.resolvedInputLabel}</strong>
        </span>
        <span>
          Privacy <strong>Activity stays on this device</strong>
        </span>
      </div>
    </section>
  );
}

function PermissionCard({
  syntheticInputAccess,
  permissionBusy,
  permissionFeedback,
  onRequestSyntheticInputAccess,
  onRevealSyntheticInputAccessTarget,
}: Pick<
  OverviewPanelProps,
  | "syntheticInputAccess"
  | "permissionBusy"
  | "permissionFeedback"
  | "onRequestSyntheticInputAccess"
  | "onRevealSyntheticInputAccessTarget"
>) {
  if (!syntheticInputAccess.supported) {
    return null;
  }

  const granted = syntheticInputAccess.granted;
  const tone: StatusTone = granted ? "success" : "warning";

  return (
    <section className={`action-card action-card-${tone}`}>
      <div className="action-card-heading">
        <div>
          <p className="section-kicker">macOS permission</p>
          <h2>Accessibility</h2>
        </div>
        <StatusBadge tone={tone}>{granted ? "Ready" : "Action needed"}</StatusBadge>
      </div>

      <p className="action-card-copy">
        {granted
          ? "never-afk can send the configured synthetic key to other apps."
          : "Allow never-afk in Privacy & Security → Accessibility so synthetic keys can reach other apps."}
      </p>

      {!granted ? (
        <div className="action-buttons">
          <button
            className="primary-button"
            type="button"
            disabled={permissionBusy || !syntheticInputAccess.canRequest}
            onClick={onRequestSyntheticInputAccess}
          >
            {permissionBusy ? "Opening…" : "Open Accessibility Settings"}
          </button>
        </div>
      ) : null}

      {!granted && !syntheticInputAccess.canRequest ? (
        <p className="inline-message" role="status">
          This build cannot open the permission prompt automatically. Use the
          Finder helper below to add it manually.
        </p>
      ) : null}

      {permissionFeedback ? (
        <p
          className={`inline-message inline-message-${permissionFeedback.kind}`}
          role={permissionFeedback.kind === "error" ? "alert" : "status"}
        >
          {permissionFeedback.message}
        </p>
      ) : null}

      {syntheticInputAccess.targetPath ? (
        <details className="troubleshooting-disclosure">
          <summary>Troubleshooting</summary>
          <p>
            If never-afk is not in the list, show its executable in Finder and
            drag it into Accessibility.
          </p>
          <button
            className="secondary-button"
            type="button"
            disabled={permissionBusy}
            onClick={onRevealSyntheticInputAccessTarget}
          >
            Show never-afk in Finder
          </button>
          <code className="path-chip">{syntheticInputAccess.targetPath}</code>
        </details>
      ) : null}
    </section>
  );
}

function UpdateCard({
  update,
  updateActionKind,
  lastFailedUpdateAction,
  onCheckForUpdates,
  onInstallUpdate,
}: Pick<
  OverviewPanelProps,
  | "update"
  | "updateActionKind"
  | "lastFailedUpdateAction"
  | "onCheckForUpdates"
  | "onInstallUpdate"
>) {
  const presentation = updatePresentation(update);
  const locallyBusy = updateActionKind !== null;
  const snapshotBusy = ["checking", "downloading", "installing"].includes(
    update.phase,
  );
  const busy = locallyBusy || snapshotBusy;
  const retryInstall =
    update.phase === "error" &&
    lastFailedUpdateAction === "install" &&
    update.availableVersion !== null;

  return (
    <section className={`action-card action-card-${presentation.tone}`}>
      <div className="action-card-heading">
        <div>
          <p className="section-kicker">Software update</p>
          <h2>{presentation.label}</h2>
        </div>
        <StatusBadge tone={presentation.tone}>
          {update.availableVersion
            ? `v${update.availableVersion}`
            : `v${update.currentVersion}`}
        </StatusBadge>
      </div>

      <p
        className="action-card-copy"
        role={presentation.tone === "danger" ? "alert" : "status"}
        aria-live="polite"
      >
        {presentation.description}
      </p>

      {update.configured ? (
        <div className="action-buttons">
          {busy ? (
            <button
              className={
                update.phase === "downloading" ||
                update.phase === "installing" ||
                updateActionKind === "install"
                  ? "primary-button"
                  : "secondary-button"
              }
              type="button"
              disabled
            >
              {update.phase === "checking"
                ? "Checking…"
                : update.phase === "installing"
                  ? "Installing…"
                  : "Downloading and Installing…"}
            </button>
          ) : update.phase === "available" ? (
            <button
              className="primary-button"
              type="button"
              onClick={onInstallUpdate}
            >
              Download and Install
            </button>
          ) : update.phase === "error" && retryInstall ? (
            <button
              className="primary-button"
              type="button"
              onClick={onInstallUpdate}
            >
              Retry Installation
            </button>
          ) : (
            <button
              className="secondary-button"
              type="button"
              onClick={onCheckForUpdates}
            >
              Check for Updates
            </button>
          )}
        </div>
      ) : null}

      {update.phase === "available" && update.notes ? (
        <details className="release-notes" open>
          <summary>What’s new</summary>
          <p>{update.notes}</p>
        </details>
      ) : null}

      {update.channel !== "stable" ? (
        <p className="card-footnote">Release channel: {update.channel}</p>
      ) : null}
      <p className="card-footnote">
        Weekly and manual update checks connect to GitHub. Installation always
        requires your confirmation.
      </p>
    </section>
  );
}

export function OverviewPanel(props: OverviewPanelProps) {
  return (
    <div className="overview-stack">
      <RuntimeOverview
        config={props.config}
        runtime={props.runtime}
        onConfigChange={props.onConfigChange}
      />

      <div className="action-card-grid">
        <PermissionCard
          syntheticInputAccess={props.syntheticInputAccess}
          permissionBusy={props.permissionBusy}
          permissionFeedback={props.permissionFeedback}
          onRequestSyntheticInputAccess={props.onRequestSyntheticInputAccess}
          onRevealSyntheticInputAccessTarget={
            props.onRevealSyntheticInputAccessTarget
          }
        />
        <UpdateCard
          update={props.update}
          updateActionKind={props.updateActionKind}
          lastFailedUpdateAction={props.lastFailedUpdateAction}
          onCheckForUpdates={props.onCheckForUpdates}
          onInstallUpdate={props.onInstallUpdate}
        />
      </div>
    </div>
  );
}
