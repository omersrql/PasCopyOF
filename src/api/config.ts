/**
 * config.ts — Typed wrappers around theme and language Tauri commands.
 */
import { invoke } from "@tauri-apps/api/core";

export type AppTheme = "dark" | "light";
export type AppLanguage = "tr" | "en";

export interface AppConfig {
  theme: AppTheme;
  language: AppLanguage;
}

export async function getAppConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("get_app_config");
}

export async function setAppTheme(theme: AppTheme): Promise<void> {
  return invoke<void>("set_app_theme", { theme });
}

export async function setAppLanguage(language: AppLanguage): Promise<void> {
  return invoke<void>("set_app_language", { language });
}
