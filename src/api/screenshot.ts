/**
 * screenshot.ts — Typed wrappers around all Tauri screenshot backend commands.
 */
import { invoke } from "@tauri-apps/api/core";

export async function triggerScreenshot(): Promise<void> {
  return invoke<void>("trigger_screenshot");
}

export async function copyAnnotatedImage(base64Png: string): Promise<void> {
  return invoke<void>("copy_annotated_image", { base64Png });
}

export async function saveAnnotatedImage(
  base64Png: string,
  defaultFilename?: string
): Promise<string | null> {
  return invoke<string | null>("save_annotated_image", {
    base64Png,
    defaultFilename: defaultFilename || null,
  });
}

export async function hideScreenshotOverlay(): Promise<void> {
  return invoke<void>("hide_screenshot_overlay");
}

export async function getScreenshotShortcut(): Promise<string> {
  return invoke<string>("get_screenshot_shortcut");
}

export async function setScreenshotShortcut(shortcut: string): Promise<void> {
  return invoke<void>("set_screenshot_shortcut", { shortcut });
}

export async function extractTextFromImage(base64Png: string): Promise<string> {
  return invoke<string>("extract_text_from_image", { base64Png });
}

export interface ScreenshotSettings {
  shortcut: string;
  notificationEnabled: boolean;
}

export async function getScreenshotSettings(): Promise<ScreenshotSettings> {
  return invoke<ScreenshotSettings>("get_screenshot_settings");
}

export async function updateScreenshotSettings(notificationEnabled: boolean): Promise<void> {
  return invoke<void>("update_screenshot_settings", { notificationEnabled });
}

