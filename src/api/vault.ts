/**
 * vault.ts — Typed wrappers around all Tauri backend commands.
 */
import { invoke } from "@tauri-apps/api/core";

export interface Category {
  id: number;
  name: string;
  icon: string;
  color: string;
}

export interface CredentialSafe {
  id: number;
  keyName: string;
  username: string;
  notes: string;
  categoryId: number | null;
  createdAt: string;
  isFavorite: boolean;
  lastUsedAt: string | null;
}

export interface AddCredentialParams {
  keyName: string;
  username: string;
  password: string;
  notes: string;
  categoryId: number | null;
}

export interface UpdateCredentialParams {
  id: number;
  keyName: string;
  username: string;
  password: string;
  notes: string;
  categoryId: number | null;
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

export async function checkVaultInitialized(): Promise<boolean> {
  return invoke<boolean>("check_vault_initialized");
}

export async function initVault(masterPassword: string): Promise<void> {
  return invoke<void>("init_vault", { masterPassword });
}

export async function unlockVault(masterPassword: string): Promise<boolean> {
  return invoke<boolean>("unlock_vault", { masterPassword });
}

export async function lockVault(): Promise<void> {
  return invoke<void>("lock_vault");
}

export async function isVaultUnlocked(): Promise<boolean> {
  return invoke<boolean>("is_vault_unlocked");
}

export async function changeMasterPassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  return invoke<void>("change_master_password", { currentPassword, newPassword });
}

export async function getCategories(): Promise<Category[]> {
  return invoke<Category[]>("get_categories");
}

export async function addCategory(name: string, icon: string, color: string): Promise<number> {
  return invoke<number>("add_category", { name, icon, color });
}

export async function updateCategory(id: number, name: string, icon: string, color: string): Promise<void> {
  return invoke<void>("update_category", { id, name, icon, color });
}

export async function deleteCategory(id: number): Promise<void> {
  return invoke<void>("delete_category", { id });
}

export async function searchCredentials(query: string, categoryId: number | null = null): Promise<CredentialSafe[]> {
  return invoke<CredentialSafe[]>("search_credentials", { query, categoryId });
}

export async function addCredential(params: AddCredentialParams): Promise<number> {
  return invoke<number>("add_credential", params as unknown as Record<string, unknown>);
}

export async function updateCredential(params: UpdateCredentialParams): Promise<void> {
  return invoke<void>("update_credential", params as unknown as Record<string, unknown>);
}

export async function deleteCredential(id: number): Promise<void> {
  return invoke<void>("delete_credential", { id });
}

export async function copyPassword(id: number): Promise<void> {
  return invoke<void>("copy_password", { id });
}

export async function copyUsername(id: number): Promise<void> {
  return invoke<void>("copy_username", { id });
}

export async function toggleFavorite(id: number): Promise<boolean> {
  return invoke<boolean>("toggle_favorite", { id });
}

export async function getDecryptedPassword(id: number): Promise<string> {
  return invoke<string>("get_decrypted_password", { id });
}

export async function showLauncher(): Promise<void> {
  return invoke<void>("show_launcher");
}

export async function hideLauncher(): Promise<void> {
  return invoke<void>("hide_launcher");
}

export async function openManager(): Promise<void> {
  return invoke<void>("open_manager");
}

export async function getLauncherShortcut(): Promise<string> {
  return invoke<string>("get_launcher_shortcut");
}

export async function setLauncherShortcut(shortcut: string): Promise<void> {
  return invoke<void>("set_launcher_shortcut", { shortcut });
}

export async function touchActivity(): Promise<void> {
  return invoke<void>("touch_activity_cmd");
}

export async function getIdleTimeout(): Promise<number> {
  return invoke<number>("get_idle_timeout");
}

export async function setIdleTimeout(minutes: number): Promise<void> {
  return invoke<void>("set_idle_timeout", { minutes });
}

export async function getClipboardClearSeconds(): Promise<number> {
  return invoke<number>("get_clipboard_clear_seconds");
}

export async function setClipboardClearSeconds(seconds: number): Promise<void> {
  return invoke<void>("set_clipboard_clear_seconds", { seconds });
}

export async function exportVault(path: string): Promise<void> {
  return invoke<void>("export_vault", { path });
}

export async function restoreVault(path: string): Promise<void> {
  return invoke<void>("restore_vault", { path });
}

export async function importCsv(path: string): Promise<ImportResult> {
  return invoke<ImportResult>("import_csv", { path });
}
