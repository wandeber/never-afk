import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, FrontendState } from "./types";

export function getFrontendState() {
  return invoke<FrontendState>("get_frontend_state");
}

export function saveConfig(config: AppConfig) {
  return invoke<FrontendState>("save_config", { config });
}

export function pauseForMinutes(minutes: number) {
  return invoke<FrontendState>("pause_for_minutes", { minutes });
}

export function resumeEngine() {
  return invoke<FrontendState>("resume_engine");
}

export function runOnceNow() {
  return invoke<FrontendState>("run_once_now");
}

export function sendTestInput() {
  return invoke<FrontendState>("send_test_input");
}

export function requestSyntheticInputAccess() {
  return invoke<FrontendState>("request_synthetic_input_access_command");
}

export function revealSyntheticInputAccessTarget() {
  return invoke<FrontendState>("reveal_synthetic_input_access_target_command");
}
