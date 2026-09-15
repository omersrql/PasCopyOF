# PasCopyOf

Fast and Secure Password Copy Tool. A lightweight, cross-platform password vault and clipboard launcher designed for system administrators.

## Features

-   **Spotlight-style Launcher**: Minimal search window for instant credential lookup and copy.
-   **Configurable Global Shortcut**: Default `Ctrl + Shift + Space`. Change it from **Manager → Settings**.
-   **System Tray**: Right-click for **Show Launcher**, **Open Manager**, and **Quit PasCopyOf**.
-   **Auto-Lock**: Idle timeout (default 15 minutes, configurable or disabled) locks the vault automatically.
-   **Favorites & Recent**: Pin favorites; recently copied credentials rise to the top of search results.
-   **Username + Password Copy**: `Enter` copies password, `Ctrl+Enter` copies username (clipboard clears after 15s).
-   **Backup / Restore**: Export an encrypted `.pascopyof` backup; restore replaces the vault safely.
-   **CSV Import**: Import from KeePass / browser CSV exports (`name`, `username`, `password`, optional `notes` / `category` / `url`).
-   **Autostart**: Optionally launch with Windows sign-in.
-   **Category Management**: Organize credentials (DB, VPN, RDP, Cloud, etc.) with custom icons and colors.
-   **Security First**:
    -   Master password protection (no hardcoded backdoor override).
    -   **Argon2id** key derivation.
    -   **AES-256-GCM** encryption for all stored credentials.
    -   Local **SQLite** database outside the install folder.
-   **Management UI**: Add / edit / delete credentials, manage categories, change master password and all settings.

## Technical Stack

-   **Frontend**: React + TypeScript + Vite
-   **Backend**: Rust (Tauri v2)
-   **Database**: SQLite (via `rusqlite`)
-   **Encryption**: `aes-gcm` and `argon2` crates

## Data Location

Vault data lives in the OS app-data directory (not the install folder), so upgrades keep your credentials:

-   **Windows**: `%APPDATA%\com.pascopyof.vault\vault.db`
-   **Linux**: `~/.local/share/com.pascopyof.vault/vault.db` (typical)
-   **macOS**: `~/Library/Application Support/com.pascopyof.vault/vault.db` (typical)

When uninstalling on Windows, do **not** delete application data if you want to keep the vault.

## Development

### Prerequisites

1.  **Node.js**: [LTS version](https://nodejs.org/)
2.  **Rust**: [rustup.rs](https://rustup.rs/)
3.  **OS Specific Dependencies**:
    -   **Windows**: [C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
    -   **Linux**: `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`
    -   **macOS**: Xcode or Command Line Tools

### Setup & Run

```powershell
npm install
npm run tauri dev
```

## Build Instructions

### Windows

```powershell
npm run tauri build
```

Produces:

-   NSIS setup: `src-tauri/target/release/bundle/nsis/PasCopyOf_*_x64-setup.exe`
-   MSI: `src-tauri/target/release/bundle/msi/PasCopyOf_*_x64_en-US.msi`

### Linux / macOS

```bash
npm run tauri build
```

## Security Model

1. On first run, the user sets a **Master Password**.
2. A random 32-byte salt is stored in SQLite.
3. **Argon2id** derives a 256-bit encryption key (kept only in memory while unlocked).
4. Credentials are encrypted with **AES-256-GCM**; decryption happens only on Copy.
5. Idle auto-lock clears the in-memory key.
6. Backups store already-encrypted blobs + salt; restore requires the original master password.
