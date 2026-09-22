/**
 * clipboard.ts — Typed wrappers around all Tauri clipboard backend commands.
 */
import { invoke } from "@tauri-apps/api/core";

export interface ClipboardItem {
  id: number;
  contentType: "text" | "image" | "files";
  textContent: string | null;
  imagePath: string | null;
  imageData: string | null;
  filePaths: string[] | null;
  preview: string;
  charCount: number | null;
  fileCount: number | null;
  imageDimensions: string | null;
  copiedAt: string;
  isPinned: boolean;
}

export interface ClipboardSettings {
  shortcut: string;
  pageSize: number;
  lockWithVault: boolean;
  enabled: boolean;
  previewDelayMs: number;
}

export type ClipboardFilterType = "all" | "text" | "image" | "files" | "pinned";

export async function getClipboardHistory(
  query: string = "",
  filterType: ClipboardFilterType = "all",
  limit?: number
): Promise<ClipboardItem[]> {
  return invoke<ClipboardItem[]>("get_clipboard_history", {
    query,
    filterType: filterType === "all" ? null : filterType,
    limit: limit || null,
  });
}

export async function copyFromHistory(id: number): Promise<void> {
  return invoke<void>("copy_from_history", { id });
}

export async function deleteHistoryItem(id: number): Promise<void> {
  return invoke<void>("delete_history_item", { id });
}

export async function clearClipboardHistory(): Promise<void> {
  return invoke<void>("clear_clipboard_history");
}

export async function togglePinHistory(id: number): Promise<boolean> {
  return invoke<boolean>("toggle_pin_history", { id });
}

export async function getClipboardShortcut(): Promise<string> {
  return invoke<string>("get_clipboard_shortcut");
}

export async function setClipboardShortcut(shortcut: string): Promise<void> {
  return invoke<void>("set_clipboard_shortcut", { shortcut });
}

export async function getClipboardSettings(): Promise<ClipboardSettings> {
  return invoke<ClipboardSettings>("get_clipboard_settings");
}

export async function updateClipboardSettings(
  pageSize: number,
  lockWithVault: boolean,
  enabled: boolean,
  previewDelayMs?: number
): Promise<void> {
  return invoke<void>("update_clipboard_settings", {
    pageSize,
    lockWithVault,
    enabled,
    previewDelayMs: previewDelayMs ?? 2000,
  });
}

export async function showClipboardLauncher(): Promise<void> {
  return invoke<void>("show_clipboard_launcher");
}

export async function hideClipboardLauncher(): Promise<void> {
  return invoke<void>("hide_clipboard_launcher");
}
