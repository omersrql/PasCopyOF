/**
 * vault.ts — Typed wrappers around all Tauri backend commands.
 * All database/encryption operations run in Rust; we only handle IPC here.
 */
import { invoke } from "@tauri-apps/api/core";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CredentialSafe {
  id: number;
  keyName: string;
  username: string;
  notes: string;
  createdAt: string;
}

export interface AddCredentialParams {
  keyName: string;
  username: string;
  password: string;
  notes: string;
}

export interface UpdateCredentialParams {
  id: number;
  keyName: string;
  username: string;
  password: string; // empty string = keep existing
  notes: string;
}

// ─── Vault lifecycle ──────────────────────────────────────────────────────────

/** Returns true if the vault has been initialized (salt exists in DB). */
export async function checkVaultInitialized(): Promise<boolean> {
  return invoke<boolean>("check_vault_initialized");
}

/** Set up a new vault with a master password. Call only on first run. */
export async function initVault(masterPassword: string): Promise<void> {
  return invoke<void>("init_vault", { masterPassword });
}

/**
 * Unlock an existing vault. Returns true if the password was correct.
 * The derived encryption key is stored in Rust memory — never exposed to JS.
 */
export async function unlockVault(masterPassword: string): Promise<boolean> {
  return invoke<boolean>("unlock_vault", { masterPassword });
}

/** Lock the vault — clears the in-memory encryption key. */
export async function lockVault(): Promise<void> {
  return invoke<void>("lock_vault");
}

/** Returns true if the vault is currently unlocked in memory. */
export async function isVaultUnlocked(): Promise<boolean> {
  return invoke<boolean>("is_vault_unlocked");
}

/** Change the master password. Re-encrypts all stored passwords. */
export async function changeMasterPassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  return invoke<void>("change_master_password", { currentPassword, newPassword });
}

// ─── Credentials ─────────────────────────────────────────────────────────────

/**
 * Search credentials by key_name (case-insensitive, partial match).
 * Returns safe credentials — passwords are never included.
 */
export async function searchCredentials(query: string): Promise<CredentialSafe[]> {
  return invoke<CredentialSafe[]>("search_credentials", { query });
}

/** Add a new credential. Password is encrypted by Rust before storage. */
export async function addCredential(params: AddCredentialParams): Promise<number> {
  return invoke<number>("add_credential", params as unknown as Record<string, unknown>);
}

/** Update an existing credential. If password is empty, the old one is kept. */
export async function updateCredential(params: UpdateCredentialParams): Promise<void> {
  return invoke<void>("update_credential", params as unknown as Record<string, unknown>);
}

/** Delete a credential by ID. */
export async function deleteCredential(id: number): Promise<void> {
  return invoke<void>("delete_credential", { id });
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

/**
 * Decrypt the password for `id` and copy it to the system clipboard.
 * Clipboard is automatically cleared after 15 seconds (handled in Rust).
 */
export async function copyPassword(id: number): Promise<void> {
  return invoke<void>("copy_password", { id });
}

/**
 * Get the decrypted password for a credential.
 * Only used in the manager page for editing.
 */
export async function getDecryptedPassword(id: number): Promise<string> {
  return invoke<string>("get_decrypted_password", { id });
}

// ─── Window management ────────────────────────────────────────────────────────

export async function showLauncher(): Promise<void> {
  return invoke<void>("show_launcher");
}

export async function hideLauncher(): Promise<void> {
  return invoke<void>("hide_launcher");
}

export async function openManager(): Promise<void> {
  return invoke<void>("open_manager");
}
