import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, FrontendState, RuntimeSnapshot } from "./types";

export function getFrontendState() {
  return invoke<FrontendState>("get_frontend_state");
}

export function getRuntimeSnapshot() {
  return invoke<RuntimeSnapshot>("get_runtime_snapshot");
}

export function saveConfig(config: AppConfig) {
  return invoke<FrontendState>("save_config", { config });
}

export function requestSyntheticInputAccess() {
  return invoke<FrontendState>("request_synthetic_input_access_command");
}

export function revealSyntheticInputAccessTarget() {
  return invoke<FrontendState>("reveal_synthetic_input_access_target_command");
}

export function checkForUpdate() {
  return invoke<FrontendState>("check_for_update_command");
}

export function installUpdate() {
  return invoke<FrontendState>("install_update_command");
}
