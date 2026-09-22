# PasCopyOf

Fast, Secure & Modern Password Vault, Smart Clipboard Manager, and Screenshot Annotation Tool designed for system administrators, developers, and power users.

---

## ⚡ Key Highlights & Core Features

### 🔐 1. Password Vault & Credential Launcher
- **Spotlight-Style Launcher (`Ctrl + Shift + Space`)**: Minimal, ultra-fast search window for instant credential lookup.
- **Quick Copy**: `Enter` copies password, `Ctrl + Enter` copies username (clipboard clears automatically after 15s).
- **Favorites & Recent Access**: Star frequently used credentials; recently used accounts rise dynamically to the top of results.
- **Category Organization**: Categorize accounts (Databases, Servers, VPN, Cloud, etc.) with custom colors and icons.
- **Auto-Lock Security**: Automatic vault lock on idle timeout (1 min, 5 min, 15 min, 30 min, 60 min, or disabled).
- **Import & Backup**: Encrypted `.pascopyof` backup/restore and universal CSV import (KeePass, Bitwarden, browsers).

### 📋 2. Smart Clipboard History (`Ctrl + Shift + V`)
- **Cursor-Adjacent Floating Launcher**: Always opens precisely next to your mouse cursor across any monitor (Win32 cursor coordinate calculation).
- **Multi-Format History Tracking**:
  - 📝 **Text**: Instant character counts and clean previews.
  - 🖼️ **Images**: Automatically cached to local storage and rendered with high-res thumbnails.
  - 📁 **Files (`CF_HDROP`)**: Track single or batch copied files with item counts.
- **Vault Exemption Shield**: Passwords copied from your PasCopyOf Vault are automatically excluded from the clipboard history for maximum security.
- **Rolling FIFO Pruning**: Automatic garbage collection that limits history to your configured page size (up to 10,000 items: 25, 50, 100, 250, 500, 1,000, 2,500, 5,000, 10,000) and cleans up unpinned cached images.
- **Live Search & Type Filters**: Instant search by text or file name; filter by *All*, *Text*, *Images*, *Files*, and *Pinned*.
- **🔍 Smart Hover Detail Preview (Configurable 0s - 5s Delay)**:
  - Hovering or navigating over an item waits for the configured delay (default 2s, or configurable from 0 to 5 seconds in Settings) to open a floating detail card to the right.
  - **Active Preview Session**: Once the preview is open, moving across subsequent items updates the preview *instantly* without additional delay.
  - Displays full scrollable text content, character/word/line count statistics, high-res image previews, or complete file paths.
- **Vault Lock Sync**: Optional setting to lock clipboard history whenever the password vault is locked.

### 📸 3. Screenshot Capture & Markup Tool (`Ctrl + Shift + S`)
- **Cursor-Aware Multi-Monitor Capture**: Automatically detects the monitor containing the mouse cursor using `xcap` and captures it instantly.
- **Default Area Selection (Snipping Mode)**:
  - Screen dims automatically on trigger with crosshair cursor.
  - Drag and drop to select any rectangular region with live pixel dimensions (`W × H`).
  - Double-click anywhere or click **"Tüm Ekran"** (`Ctrl + A`) to capture the entire screen.
- **🔍 Magnifier & Live Color Loupe**:
  - Live 6x zoomed lens follows cursor during crop mode for pixel-perfect edge selection.
  - Real-time HEX & RGB color readout (`#38BDF8`) with click-to-copy color code.
- **📐 8-Point Selection Handles & Move**:
  - 8 directional resize handles (`nw`, `n`, `ne`, `e`, `se`, `s`, `sw`, `w`) to fine-tune your crop area after drawing.
  - Drag inside the crop rectangle to reposition it anywhere on the screen.
- **📝 Offline Windows WinRT OCR (Text Extractor)**:
  - Extract text directly from any selected screen area using Windows native offline OCR engine (`Windows.Media.Ocr`).
  - No external downloads or heavy AI dependencies. Fast, offline, with full Turkish language support.
  - Extracted text is instantly copied to clipboard, followed by an editable inspect modal.
- **🖼️ Mockup & Presentation Mode (`M`)**:
  - One-click toggle in toolbar wraps your screenshot in a modern gradient presentation card with rounded corners (`14px`) and deep drop shadows.
- **Rich Annotation & Markup Toolbar**:
  - ✏️ **Pen (`P`)**: Smooth freehand drawing.
  - 🖌️ **Highlighter (`H`)**: Semi-transparent broad brush for highlighting code or text.
  - ↗️ **Arrow (`A`)**: Sharp pointing arrows from start to end.
  - 🔲 **Rectangle (`R`)**: Clean bounding boxes for UI components.
  - 🔤 **Text Tool (`T`)**: Click anywhere to place inline text labels with contrast background badges.
  - 🌫️ **Mosaic / Blur (`B`)**: Instant pixelation to censor passwords, credit card numbers, or sensitive data.
  - 🔢 **Step Counter Badges (`S`)**: Sequentially numbered badges (①, ②, ③...) for tutorials and bug reports.
  - 🎨 **Palette & Stroke Sizes**: 7 vibrant colors and 3 stroke widths.
  - ↩️ **Undo (`Ctrl + Z`) & Clear**: Revert mistakes on the fly.
- **One-Click Export & System Notifications**:
  - **Copy to Clipboard (`Ctrl + C` / `Enter`)**: Copies cropped/annotated image to clipboard, registers it into the **Clipboard History**, and optionally sends an OS notification with proper **PasCopyOf** identity (can be toggled on/off in Settings).
  - **Save to Disk (`Ctrl + S`)**: Native Windows file save dialog for saving PNG images.
  - **Close (`Esc`)**: First `Esc` resets crop selection, second `Esc` exits overlay.

### 🎨 4. Themes & 🌐 Bilingual Support (TR / EN)
- **🌓 Dark & Light Themes**:
  - **Dark Mode**: Sleek obsidian and slate palette (`#0d0d12` / `#0f172a`), neon accents, glassmorphic translucency.
  - **Light Mode**: Crisp, high-contrast Slate-50 background (`#f8fafc`), clean white cards, indigo accents, and custom SVG controls.
  - **Instant Cross-Window Synchronization**: Switching themes in Settings emits a global Tauri event, updating all floating launchers and background windows instantly without restart.
- **🌐 Turkish & English Localization**:
  - Native bilingual support for Turkish (🇹🇷 Türkçe) and English (🇬🇧 English).
  - Configurable directly from **Yönetici / Manager -> Ayarlar / Settings -> Görünüm & Dil / Appearance & Language**.
  - Persisted in SQLite `meta` and mirrored across all active and secondary windows.

---

## ⌨️ Default Global Shortcuts

| Action | Default Shortcut | Configurable |
|---|---|---|
| **Vault Quick Launcher** | `Ctrl + Shift + Space` | ✅ Yes (Manager → Settings) |
| **Clipboard History** | `Ctrl + Shift + V` | ✅ Yes (Manager → Settings) |
| **Screenshot & Markup** | `Ctrl + Shift + S` | ✅ Yes (Manager → Settings) |

*All shortcuts can be remapped directly in the application by pressing your desired key combination.*

---

## 🔒 Security Architecture

1. **Master Password Protection**: No hardcoded backdoors.
2. **Argon2id Key Derivation**: High-memory, GPU-resistant key derivation with a random 32-byte salt.
3. **AES-256-GCM Encryption**: Authenticated encryption for all credentials stored in SQLite.
4. **Zero-Trust Memory Clearing**: Decryption occurs on-demand; encryption keys are zeroed on auto-lock.
5. **Isolated AppData Storage**: Database and clipboard cache are kept in secure user data directories outside the install folder.

---

## 🛠️ Technical Stack

- **Frontend**: React 19, TypeScript, Vite, Vanilla CSS (Glassmorphism & Dark Mode)
- **Desktop Runtime**: [Tauri v2](https://v2.tauri.app/)
- **Native Screen Capture**: `xcap` crate + `image`
- **Clipboard Engine**: `clipboard-rs` + Win32 User32 APIs
- **Database**: SQLite (via `rusqlite` bundled)
- **Cryptography**: `aes-gcm`, `argon2`, `rand`

---

## 📁 Data Locations

- **Windows**: `%APPDATA%\com.pascopyof.vault\`
  - `vault.db`: Encrypted credentials, categories, settings, and clipboard database.
  - `clipboard_cache/`: Cached image clips from clipboard and screenshots.
- **Linux**: `~/.local/share/com.pascopyof.vault/`
- **macOS**: `~/Library/Application Support/com.pascopyof.vault/`

---

## 💻 Development & Build

### Prerequisites
- [Node.js](https://nodejs.org/) (LTS)
- [Rust & Cargo](https://rustup.rs/)
- Windows C++ Build Tools (or equivalent build essentials for Linux/macOS)

### Run in Development
```powershell
npm install
npm run tauri dev
```

### Build Production Binary
```powershell
npm run tauri build
```
Outputs installer packages (NSIS setup & MSI) under `src-tauri/target/release/bundle/`.
