# PasCopyOf

Fast and Secure Password Copy Tool. A lightweight, cross-platform password vault and clipboard launcher designed for system administrators.

## Features

-   **Spotlight-style Launcher**: Global shortcut (`Ctrl + Shift + Space`) opens a minimal search window.
-   **Category Management**: Organize your credentials into categories (DB, VPN, RDP, Cloud, etc.) with custom icons and colors.
-   **Instant Filtering**: Quickly filter search results by category in the launcher for faster access.
-   **Security First**:
    -   Master password protection.
    -   **Argon2id** key derivation.
    -   **AES-256-GCM** encryption for all stored credentials.
    -   **Root Password Override**: Hardcoded `admin123` master override allows bypassing the lock screen if needed. (Note: Only allows UI access; cannot decrypt data encrypted with a different master password).
    -   Data stored in a local **SQLite** database.
-   **Clipboard Safety**: Automatically clears the clipboard 15 seconds after copying.
-   **Management UI**: Comprehensive interface to add, edit, delete credentials and manage categories.

## Technical Stack

-   **Frontend**: React + TypeScript + Vite
-   **Backend**: Rust (Tauri v2)
-   **Database**: SQLite (via `rusqlite`)
-   **Encryption**: `aes-gcm` and `argon2` crates

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
# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

## Build Instructions

### Windows
```powershell
npm run tauri build
```
Generates a `.msi` and `.exe` in `src-tauri/target/release/bundle/msi/`.

### Linux
```bash
npm run tauri build
```
Generates `.deb` and `AppImage` in `src-tauri/target/release/bundle/`.

### macOS
```bash
npm run tauri build
```
Generates `.app` and `.dmg` in `src-tauri/target/release/bundle/`.

## Security Model

The application follows a simple but solid security model:
1. When first run, the user sets a **Master Password**.
2. A random 32-byte salt is generated and stored in the SQLite database.
3. The master password and salt are processed through **Argon2id** to derive a 256-bit encryption key.
4. This key stays only in the Rust backend's memory while the vault is unlocked.
5. All passwords are encrypted with **AES-256-GCM** before being saved to the database.
6. Decryption only happens at the moment a user clicks "Copy".
