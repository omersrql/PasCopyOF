# PasCopyOf

**Fast, Secure & Modern Password Vault, Smart Clipboard Manager, Screenshot Markup Tool, and Daily Focus & Worklog Tracker** designed for system administrators, software developers, and power users.

---

## ⚡ Key Highlights & Core Features

### 🔐 1. Password Vault & Credential Launcher
- **Spotlight-Style Launcher (`Ctrl + Shift + Space`)**: Minimal, ultra-fast search window for instant credential lookup.
- **Cursor-Aware Multi-Monitor Positioning**: Always appears on the monitor where your mouse cursor is currently positioned.
- **Quick Copy & Auto-Paste**: `Enter` copies password, `Ctrl + Enter` copies username, with automatic credential paste capability (`Ctrl + V`).
- **Favorites & Dynamic Ranking**: Star frequently used accounts; recently used credentials automatically bubble up to the top.
- **Category Organization**: Categorize accounts (Databases, Servers, Cloud, VPN, etc.) with custom colors and icons.
- **Auto-Lock Security**: Automatic vault lock on idle timeout (1 min, 5 min, 15 min, 30 min, 60 min, or disabled).
- **Import & Backup**: Encrypted `.pascopyof` backup/restore and universal CSV import (KeePass, Bitwarden, browsers).
- **Scale Settings**: Choose preview and panel scaling across Small, Medium, and Large views.

---

### 📋 2. Smart Clipboard History (`Ctrl + Shift + V`)
- **Cursor-Adjacent Floating Launcher**: Opens precisely next to your mouse cursor across any monitor with dual mode options:
  - **Compact Popup Mode**: Floating, cursor-anchored panel.
  - **Fullscreen Multi-Column Grid Mode**: Expands into a spacious multi-column dashboard for heavy clipboard workflows.
- **Multi-Format History Tracking**:
  - 📝 **Text**: Instant character counts and clean previews.
  - 🖼️ **Images**: Automatically cached to local storage and rendered with high-res thumbnails.
  - 📁 **Files (`CF_HDROP`)**: Track single or batch copied files with item counts.
- **Direct Image Pasting**: Full support for copying screenshots and images directly into Slack, Teams, browsers, and image editors via `Ctrl + V`.
- **Vault Exemption Shield**: Passwords copied from your PasCopyOf Vault are automatically excluded from the clipboard history for maximum security.
- **Rolling FIFO Pruning**: Automatic garbage collection limiting history to your configured page size (up to 10,000 items) and pruning unpinned image files.
- **Parametric Behaviors (Settings)**:
  - Parametric search persistence (clear search on open or remember last search).
  - Close on Space key and Close on Blur (clicking outside) toggleable settings.
  - Smart Hover Detail Preview (Configurable 0s - 5s delay).

---

### 🎯 3. Focus, Daily Task Planner & Time Tracker (Görevler & Efor Takibi)
- **Daily Focus Dashboard**:
  - Organize today's tasks with priority tags (`🔴 High`, `🟡 Medium`, `🔵 Low`) and statuses (`📝 To Do`, `⏳ In Progress`, `✅ Done`).
  - Filter tasks quickly by *All*, *In Progress*, *To Do*, *Done*, and *Recurring Routines*.
- **Sub-step Checklists & Rich Notes Canvas**:
  - Break tasks into actionable checklists with instant checkboxes (`☑️ 2/5`).
  - Spacious technical notes area for logging bug explanations, code snippets, ticket links, and meeting notes.
- **One-Click Worklog & Stopwatch Timer**:
  - Click `▶️` on any task card or hero widget to start tracking effort; switches seamlessly between tasks.
  - All start/stop timestamps are stored atomically in SQLite, ensuring zero time loss even if the app or PC restarts.
- **⏱️ Floating Mini Desktop Timer Widget (Masaüstü Yüzen Sayaç)**:
  - Compact, always-on-top, translucent pill widget that stays on your desktop while you work in other apps.
  - **Draggable**: Drag by its handle (`⋮⋮`) to place it anywhere (secondary screen, top-right corner, etc.).
  - **Live Controls**: Shows active task title, live digital clock (`00:24:18`), play/pause (`⏸️ / ▶️`), mark done (`✓`), and jump to Manager (`↗`).
- **🧠 Smart Inactivity & Screen Lock Detection (Auto-Pause & Resume)**:
  - **Lock Screen (`Win + L`)**: Instantly detects workstation lock and pauses the timer immediately so idle lock time is never falsely logged.
  - **1-Minute Idle Detection**: If no keyboard or mouse movement is detected for 60 seconds, the timer auto-pauses and deducts the 60s idle gap from effort logs.
  - **Auto-Resume on Return**: The moment you unlock the PC or move your mouse, the timer automatically resumes right where you left off with a welcoming notification.
- **⚡ Quick Task Creator Popup (`Ctrl + Shift + N`)**:
  - Global floating popup that appears instantly anywhere over whatever app you're using.
  - Simply type what you're working on and press `Enter` to create the task and immediately start tracking time on the floating mini timer widget.
  - Options for priority badges, routine recurrence, and save-only mode (`Ctrl + Enter`).
- **📋 "What Did I Do Today?" One-Click Markdown Export**:
  - Generates and copies a clean, professional Markdown daily work summary directly to your clipboard:
    ```markdown
    ## 📅 Günlük Çalışma Raporu: 30.09.2026 (Toplam Efor: 4s 20dk)
    ### ✅ Tamamlanan Görevler:
    - [x] Ekran görüntüsü kayıt dizini ayarları tamamlandı (1s 15dk)
    ### ⏳ Devam Eden Görevler:
    - [ ] DeployOF log analitiği servisi (3s 05dk)
    ```

---

### 📸 4. Screenshot Capture, Markup & OCR (`Ctrl + Shift + S`)
- **Cursor-Aware Multi-Monitor Capture**: Automatically detects the monitor containing the mouse cursor using `xcap` and captures it instantly.
- **Default Area Selection (Snipping Mode)**:
  - Screen dims automatically on trigger with crosshair cursor.
  - Drag and drop to select any rectangular region with live pixel dimensions (`W × H`).
  - Double-click anywhere or click **"Tüm Ekran"** (`Ctrl + A`) to capture the entire screen.
- **Configurable Save Directory & Smooth Save Flow**:
  - Direct saving to your configured folder (`Pictures\PasCopyOf` by default) with automatic filenames (`PasCopyOf_Screenshot_YYYYMMDD_HHMMSS.png`).
  - Eliminates dialog blocking issues; displays a confirmation toast and automatically closes the overlay.
  - Settings panel allows picking any custom folder, opening it in Windows Explorer, or resetting to default.
- **🔍 Magnifier & Live Color Loupe**:
  - Live 6x zoomed lens follows cursor during crop mode for pixel-perfect edge selection.
  - Real-time HEX & RGB color readout (`#38BDF8`) with click-to-copy color code.
- **📐 8-Point Selection Handles & Move**:
  - 8 directional resize handles (`nw`, `n`, `ne`, `e`, `se`, `s`, `sw`, `w`) to fine-tune your crop area after drawing.
  - Drag inside the crop rectangle to reposition it anywhere on the screen.
- **📝 Offline Windows WinRT OCR (Text Extractor)**:
  - Extract text directly from any selected screen area using Windows native offline OCR engine (`Windows.Media.Ocr`).
  - Fast, offline, with full Turkish language support.
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
- **Export & Clipboard Integration**:
  - **Copy to Clipboard (`Ctrl + C` / `Enter`)**: Copies cropped/annotated image to clipboard and registers it into the **Clipboard History**.
  - **Save to Disk (`Ctrl + S`)**: Saves directly to your configured screenshot directory.

---

### 🎨 5. Themes, Bilingual Support & Auto-Updates
- **🌓 Dark & Light Themes**: Sleek dark mode (`#0d0d12` / `#0f172a`) with glassmorphism and crisp Slate-50 light mode (`#f8fafc`).
- **🌐 Turkish & English Localization**: Seamless bilingual switching between 🇹🇷 Türkçe and 🇬🇧 English across all windows and controls.
- **🚀 Built-in Auto-Updater**: Native Tauri updater with cryptographic signature validation (`minisign`), checking GitHub Releases directly from Settings.

---

## ⌨️ Default Global Shortcuts

| Action | Default Shortcut | Configurable |
|---|---|---|
| **Vault Quick Launcher** | `Ctrl + Shift + Space` | ✅ Yes (Manager → Settings) |
| **Clipboard History** | `Ctrl + Shift + V` | ✅ Yes (Manager → Settings) |
| **Screenshot & Markup** | `Ctrl + Shift + S` | ✅ Yes (Manager → Settings) |
| **Floating Timer Widget** | `Ctrl + Shift + T` | ✅ Yes (Manager → Settings) |
| **Tasks & Focus Planner** | `Ctrl + Shift + P` | ✅ Yes (Manager → Settings) |
| **⚡ Quick Task Creator** | `Ctrl + Shift + N` | ✅ Yes (Manager → Settings) |

*All shortcuts can be remapped directly in the application by pressing your desired key combination.*

---

## 🔒 Security Architecture

1. **Master Password Protection**: No hardcoded backdoors.
2. **Argon2id Key Derivation**: High-memory, GPU-resistant key derivation with a random 32-byte salt.
3. **AES-256-GCM Encryption**: Authenticated encryption for all credentials stored in SQLite.
4. **Zero-Trust Memory Clearing**: Decryption occurs on-demand; encryption keys are zeroed on auto-lock.
5. **Local-First & Isolated Storage**: All tasks, credentials, and clipboard history stay strictly on your local device.

---

## 🛠️ Technical Stack

- **Frontend**: React 19, TypeScript, Vite, Vanilla CSS (Glassmorphism & Tokens)
- **Desktop Runtime**: [Tauri v2](https://v2.tauri.app/)
- **Native Screen Capture**: `xcap` crate + `image`
- **Clipboard Engine**: `clipboard-rs` + Win32 User32 APIs
- **Time & Idle Tracking**: Win32 `GetLastInputInfo` & `OpenInputDesktop` API integration
- **Database**: SQLite (via `rusqlite` bundled)
- **Cryptography**: `aes-gcm`, `argon2`, `rand`

---

## 📁 Data Locations

- **Windows**: `%APPDATA%\com.pascopyof.vault\`
  - `vault.db`: Encrypted credentials, categories, settings, clipboard history, tasks, and worklogs.
  - `clipboard_cache/`: Cached image clips from clipboard and screenshots.
- **Screenshots**: `%USERPROFILE%\Pictures\PasCopyOf\` (or custom configured path in Settings)

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

### Build Production Release (with Updater bundle)
```powershell
.\build-release.ps1
```
Outputs installer packages (NSIS setup & MSI) under `src-tauri/target/release/bundle/nsis/`.
