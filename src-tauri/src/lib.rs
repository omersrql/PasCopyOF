// PasCopyOf - Password Vault Backend
// Handles: Database, Encryption/Decryption, Clipboard, Global Hotkey, Backup, Idle Lock

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use clipboard_rs::common::RustImage;
use clipboard_rs::{
    Clipboard, ClipboardContext, ClipboardHandler, ClipboardWatcher, ClipboardWatcherContext,
    RustImageData,
};
use rand::RngCore;

const DEFAULT_LAUNCHER_SHORTCUT: &str = "Ctrl+Shift+Space";
const DEFAULT_CLIPBOARD_SHORTCUT: &str = "Ctrl+Shift+V";
const DEFAULT_SCREENSHOT_SHORTCUT: &str = "Ctrl+Shift+S";
const DEFAULT_IDLE_TIMEOUT_MINUTES: u64 = 15;
const DEFAULT_CLIPBOARD_PAGE_SIZE: u32 = 50;
const VERIFY_MESSAGE: &str = "pascopyof-verify-ok";

// ─── State ───────────────────────────────────────────────────────────────────

pub struct AppState {
    pub db_path: PathBuf,
    pub cache_dir: PathBuf,
    pub encryption_key: Option<[u8; 32]>,
    pub clipboard_clear_handle: Option<tauri::async_runtime::JoinHandle<()>>,
    pub launcher_shortcut: String,
    pub clipboard_shortcut: String,
    pub screenshot_shortcut: String,
    pub screenshot_notification_enabled: bool,
    pub clipboard_page_size: u32,
    pub clipboard_lock_with_vault: bool,
    pub clipboard_enabled: bool,
    pub clipboard_preview_delay_ms: u32,
    pub idle_timeout_minutes: u64, // 0 = disabled
    pub last_activity: Instant,
    pub last_vault_password: Option<String>,
    pub ignore_clipboard_change: bool,
}

pub struct SafeAppState(pub Mutex<AppState>);

// ─── Models ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardItem {
    pub id: i64,
    pub content_type: String,
    pub text_content: Option<String>,
    pub image_path: Option<String>,
    pub image_data: Option<String>,
    pub file_paths: Option<Vec<String>>,
    pub preview: String,
    pub char_count: Option<i64>,
    pub file_count: Option<i64>,
    pub image_dimensions: Option<String>,
    pub copied_at: String,
    pub is_pinned: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardSettings {
    pub shortcut: String,
    pub page_size: u32,
    pub lock_with_vault: bool,
    pub enabled: bool,
    pub preview_delay_ms: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotSettings {
    pub shortcut: String,
    pub notification_enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub theme: String,
    pub language: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub icon: String,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSafe {
    pub id: i64,
    pub key_name: String,
    pub username: String,
    pub notes: String,
    pub category_id: Option<i64>,
    pub created_at: String,
    pub is_favorite: bool,
    pub last_used_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct BackupFile {
    format: String,
    version: u32,
    exported_at: String,
    salt: String,
    verify: Option<String>,
    categories: Vec<BackupCategory>,
    credentials: Vec<BackupCredential>,
}

#[derive(Debug, Serialize, Deserialize)]
struct BackupCategory {
    name: String,
    icon: String,
    color: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct BackupCredential {
    key_name: String,
    username: String,
    password_encrypted: String,
    notes: String,
    category_name: Option<String>,
    is_favorite: bool,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: u32,
    pub skipped: u32,
}

// ─── Crypto ──────────────────────────────────────────────────────────────────

fn derive_key(master_password: &str, salt_hex: &str) -> Result<[u8; 32]> {
    let salt_bytes = hex::decode(salt_hex)?;
    let argon2 = Argon2::default();
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(master_password.as_bytes(), &salt_bytes, &mut key)
        .map_err(|e| anyhow::anyhow!("Argon2 error: {}", e))?;
    Ok(key)
}

fn encrypt(key: &[u8; 32], plaintext: &str) -> Result<String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;
    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(B64.encode(combined))
}

fn decrypt(key: &[u8; 32], encoded: &str) -> Result<String> {
    let combined = B64.decode(encoded)?;
    if combined.len() < 12 {
        return Err(anyhow::anyhow!("Invalid ciphertext: too short"));
    }
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;
    Ok(String::from_utf8(plaintext)?)
}

// ─── Database ────────────────────────────────────────────────────────────────

fn open_db(path: &PathBuf) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS categories (
            id    INTEGER PRIMARY KEY AUTOINCREMENT,
            name  TEXT    NOT NULL,
            icon  TEXT    NOT NULL,
            color TEXT    NOT NULL DEFAULT '#0ea5e9'
        );
        CREATE TABLE IF NOT EXISTS clipboard_history (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            content_type     TEXT    NOT NULL,
            text_content     TEXT,
            image_path       TEXT,
            file_paths       TEXT,
            preview          TEXT    NOT NULL,
            char_count       INTEGER,
            file_count       INTEGER,
            image_dimensions TEXT,
            copied_at        TEXT    NOT NULL DEFAULT (datetime('now')),
            is_pinned        INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_clipboard_type ON clipboard_history (content_type);
        CREATE INDEX IF NOT EXISTS idx_clipboard_copied_at ON clipboard_history (copied_at DESC);
        CREATE INDEX IF NOT EXISTS idx_clipboard_pinned ON clipboard_history (is_pinned);",
    )?;

    let table_info: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(credentials)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        let mut cols = Vec::new();
        for r in rows {
            if let Ok(c) = r {
                cols.push(c);
            }
        }
        cols
    };

    if table_info.is_empty() {
        conn.execute_batch(
            "CREATE TABLE credentials (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                key_name           TEXT    NOT NULL,
                username           TEXT    NOT NULL DEFAULT '',
                password_encrypted TEXT    NOT NULL,
                notes              TEXT    NOT NULL DEFAULT '',
                category_id        INTEGER,
                created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
                is_favorite        INTEGER NOT NULL DEFAULT 0,
                last_used_at       TEXT,
                FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL
            );
            CREATE INDEX idx_credentials_key_name ON credentials (key_name);
            CREATE INDEX idx_credentials_category ON credentials (category_id);
            CREATE INDEX idx_credentials_favorite ON credentials (is_favorite);
            CREATE INDEX idx_credentials_last_used ON credentials (last_used_at);",
        )?;
    } else {
        if !table_info.contains(&"category_id".to_string()) {
            conn.execute(
                "ALTER TABLE credentials ADD COLUMN category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL",
                [],
            )?;
        }
        if !table_info.contains(&"is_favorite".to_string()) {
            conn.execute(
                "ALTER TABLE credentials ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        if !table_info.contains(&"last_used_at".to_string()) {
            conn.execute("ALTER TABLE credentials ADD COLUMN last_used_at TEXT", [])?;
        }
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_credentials_category ON credentials (category_id)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_credentials_favorite ON credentials (is_favorite)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_credentials_last_used ON credentials (last_used_at)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_credentials_key_name ON credentials (key_name)",
            [],
        )?;
    }

    Ok(conn)
}

fn get_meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM meta WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .ok()
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}

// ─── Idle / activity helpers ─────────────────────────────────────────────────

fn touch_activity(st: &mut AppState) {
    st.last_activity = Instant::now();
}

fn enforce_idle_lock(st: &mut AppState) -> Result<(), String> {
    if st.encryption_key.is_none() {
        return Ok(());
    }
    if st.idle_timeout_minutes == 0 {
        return Ok(());
    }
    let limit = Duration::from_secs(st.idle_timeout_minutes.saturating_mul(60));
    if st.last_activity.elapsed() > limit {
        st.encryption_key = None;
        return Err("Vault locked due to inactivity".into());
    }
    Ok(())
}

fn require_key(st: &mut AppState) -> Result<[u8; 32], String> {
    enforce_idle_lock(st)?;
    let key = st.encryption_key.ok_or_else(|| "Vault is locked".to_string())?;
    touch_activity(st);
    Ok(key)
}

fn mark_last_used(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE credentials SET last_used_at = datetime('now') WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn schedule_clipboard_clear(app: &AppHandle, state: &SafeAppState) {
    let mut st = match state.0.lock() {
        Ok(s) => s,
        Err(_) => return,
    };
    if let Some(handle) = st.clipboard_clear_handle.take() {
        handle.abort();
    }
    let app_clone = app.clone();
    st.clipboard_clear_handle = Some(tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(15)).await;
        let _ = app_clone.clipboard().write_text("".to_string());
    }));
}

fn emit_vault_locked(app: &AppHandle) {
    let _ = app.emit("vault-locked", ());
}

fn toggle_launcher_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("launcher") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[cfg(target_os = "windows")]
fn get_screen_cursor_pos() -> Option<(i32, i32)> {
    #[repr(C)]
    struct POINT {
        x: i32,
        y: i32,
    }
    extern "system" {
        fn GetCursorPos(lpPoint: *mut POINT) -> i32;
    }
    let mut pt = POINT { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut pt) };
    if ok != 0 {
        Some((pt.x, pt.y))
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn get_screen_cursor_pos() -> Option<(i32, i32)> {
    None
}

fn show_clipboard_launcher_window(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<SafeAppState>();
    {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        if st.clipboard_lock_with_vault && st.encryption_key.is_none() {
            let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
            let has_salt = get_meta(&conn, "salt").is_some();
            if has_salt {
                let _ = app.emit("vault-locked", ());
                return Err("Vault is locked".into());
            }
        }
    }

    if let Some(window) = app.get_webview_window("clipboard-launcher") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            return Ok(());
        }

        // Get global screen cursor position (native Win32 or Tauri fallback)
        let cursor = get_screen_cursor_pos()
            .or_else(|| app.cursor_position().ok().map(|p| (p.x as i32, p.y as i32)));

        if let Some((cur_x, cur_y)) = cursor {
            let window_width = 900.0;
            let window_height = 500.0;
            let mut target_x = cur_x as f64 + 10.0;
            let mut target_y = cur_y as f64 + 10.0;

            if let Ok(Some(monitor)) = window.current_monitor() {
                let m_pos = monitor.position();
                let m_size = monitor.size();
                let scale = monitor.scale_factor();
                let max_x = m_pos.x as f64 + m_size.width as f64 - (window_width * scale);
                let max_y = m_pos.y as f64 + m_size.height as f64 - (window_height * scale);

                if target_x > max_x {
                    target_x = cur_x as f64 - (window_width * scale) - 10.0;
                }
                if target_y > max_y {
                    target_y = cur_y as f64 - (window_height * scale) - 10.0;
                }
                if target_x < m_pos.x as f64 {
                    target_x = m_pos.x as f64 + 10.0;
                }
                if target_y < m_pos.y as f64 {
                    target_y = m_pos.y as f64 + 10.0;
                }
            }

            let pos = tauri::Position::Physical(tauri::PhysicalPosition {
                x: target_x as i32,
                y: target_y as i32,
            });
            let _ = window.set_position(pos);
            let _ = window.show();
            let _ = window.set_position(pos); // ensure applied after shown
            let _ = window.set_focus();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
    Ok(())
}

fn register_launcher_hotkey(app: &AppHandle, shortcut_str: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    let shortcut: Shortcut = shortcut_str
        .parse()
        .map_err(|e| format!("Invalid shortcut: {e}"))?;
    let app_handle = app.clone();

    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                toggle_launcher_window(&app_handle);
            }
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn register_clipboard_hotkey(app: &AppHandle, shortcut_str: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    let shortcut: Shortcut = shortcut_str
        .parse()
        .map_err(|e| format!("Invalid shortcut: {e}"))?;
    let app_handle = app.clone();

    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = show_clipboard_launcher_window(&app_handle);
            }
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn trigger_screenshot_capture(app: &AppHandle) -> Result<(), String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("Failed to enumerate monitors: {e}"))?;
    if monitors.is_empty() {
        return Err("No monitors found".into());
    }

    let cursor = get_screen_cursor_pos()
        .or_else(|| app.cursor_position().ok().map(|p| (p.x as i32, p.y as i32)));

    let target_monitor = if let Some((cx, cy)) = cursor {
        xcap::Monitor::from_point(cx, cy).ok()
            .or_else(|| monitors.iter().find(|m| m.is_primary().unwrap_or(false)).cloned())
            .or_else(|| monitors.first().cloned())
    } else {
        monitors.iter().find(|m| m.is_primary().unwrap_or(false)).cloned()
            .or_else(|| monitors.first().cloned())
    }.ok_or("No valid monitor found")?;

    let mon_x = target_monitor.x().map_err(|e| e.to_string())?;
    let mon_y = target_monitor.y().map_err(|e| e.to_string())?;
    let mon_w = target_monitor.width().map_err(|e| e.to_string())?;
    let mon_h = target_monitor.height().map_err(|e| e.to_string())?;

    let captured = target_monitor.capture_image().map_err(|e| format!("Failed to capture screen: {e}"))?;
    let img_w = captured.width();
    let img_h = captured.height();

    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(captured)
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode image: {e}"))?;
    let b64 = B64.encode(buf.into_inner());

    if let Some(window) = app.get_webview_window("screenshot-overlay") {
        let pos = tauri::Position::Physical(tauri::PhysicalPosition { x: mon_x, y: mon_y });
        let size = tauri::Size::Physical(tauri::PhysicalSize { width: mon_w, height: mon_h });
        let _ = window.set_position(pos);
        let _ = window.set_size(size);
        let _ = window.show();
        let _ = window.set_position(pos);
        let _ = window.set_focus();

        let _ = window.emit("screenshot-captured", serde_json::json!({
            "image": format!("data:image/png;base64,{}", b64),
            "width": img_w,
            "height": img_h,
            "monitorX": mon_x,
            "monitorY": mon_y,
        }));
    }

    Ok(())
}

fn register_screenshot_hotkey(app: &AppHandle, shortcut_str: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    let shortcut: Shortcut = shortcut_str
        .parse()
        .map_err(|e| format!("Invalid shortcut: {e}"))?;
    let app_handle = app.clone();

    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = trigger_screenshot_capture(&app_handle);
            }
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

struct AppClipboardHandler {
    app_handle: AppHandle,
    db_path: PathBuf,
    cache_dir: PathBuf,
}

impl ClipboardHandler for AppClipboardHandler {
    fn on_clipboard_change(&mut self) {
        let state = self.app_handle.state::<SafeAppState>();
        let (enabled, last_vault_pw, max_items) = {
            if let Ok(mut st) = state.0.lock() {
                if !st.clipboard_enabled {
                    return;
                }
                if st.ignore_clipboard_change {
                    st.ignore_clipboard_change = false;
                    return;
                }
                (st.clipboard_enabled, st.last_vault_password.clone(), st.clipboard_page_size)
            } else {
                return;
            }
        };

        if !enabled {
            return;
        }

        std::thread::sleep(Duration::from_millis(60));

        let ctx = match ClipboardContext::new() {
            Ok(c) => c,
            Err(_) => return,
        };

        // 1. Files check
        if let Ok(files) = ctx.get_files() {
            if !files.is_empty() {
                if let Ok(conn) = open_db(&self.db_path) {
                    let file_count = files.len();
                    let preview = if file_count == 1 {
                        let p = std::path::Path::new(&files[0]);
                        p.file_name()
                            .map(|f| f.to_string_lossy().to_string())
                            .unwrap_or_else(|| files[0].clone())
                    } else {
                        let p = std::path::Path::new(&files[0]);
                        let first_name = p.file_name()
                            .map(|f| f.to_string_lossy().to_string())
                            .unwrap_or_else(|| "dosya".into());
                        format!("{} ve {} dosya daha", first_name, file_count - 1)
                    };
                    let json_paths = serde_json::to_string(&files).unwrap_or_default();

                    let most_recent: Option<String> = conn.query_row(
                        "SELECT file_paths FROM clipboard_history WHERE content_type = 'files' ORDER BY copied_at DESC LIMIT 1",
                        [],
                        |r| r.get(0),
                    ).ok();

                    if most_recent.as_deref() == Some(&json_paths) {
                        let _ = conn.execute(
                            "UPDATE clipboard_history SET copied_at = datetime('now') WHERE id = (SELECT id FROM clipboard_history WHERE content_type = 'files' ORDER BY copied_at DESC LIMIT 1)",
                            [],
                        );
                    } else {
                        let _ = conn.execute(
                            "INSERT INTO clipboard_history (content_type, file_paths, preview, file_count, copied_at) VALUES ('files', ?1, ?2, ?3, datetime('now'))",
                            params![json_paths, preview, file_count as i64],
                        );
                        prune_clipboard_history(&conn, max_items);
                    }
                    let _ = self.app_handle.emit("clipboard-updated", ());
                    return;
                }
            }
        }

        // 2. Image check
        if let Ok(img) = ctx.get_image() {
            let (w, h) = img.get_size();
            if w > 0 && h > 0 {
                let now = chrono::Local::now();
                let file_name = format!("clip_{}_{}.png", now.format("%Y%m%d_%H%M%S"), rand::random::<u32>());
                let file_path = self.cache_dir.join(&file_name);
                let path_str = file_path.to_string_lossy().to_string();

                if img.save_to_path(&path_str).is_ok() {
                    if let Ok(conn) = open_db(&self.db_path) {
                        let dimensions = format!("{} × {}", w, h);
                        let preview = format!("Görsel ({} × {})", w, h);
                        let _ = conn.execute(
                            "INSERT INTO clipboard_history (content_type, image_path, preview, image_dimensions, copied_at) VALUES ('image', ?1, ?2, ?3, datetime('now'))",
                            params![path_str, preview, dimensions],
                        );
                        prune_clipboard_history(&conn, max_items);
                        let _ = self.app_handle.emit("clipboard-updated", ());
                        return;
                    }
                }
            }
        }

        // 3. Text check
        if let Ok(text) = ctx.get_text() {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return;
            }

            // Exemption: skip vault password
            if let Some(ref pw) = last_vault_pw {
                if pw == &text {
                    return;
                }
            }

            let char_count = text.chars().count();
            let preview: String = text.lines().next().unwrap_or("").chars().take(90).collect();
            let preview = if preview.is_empty() { "Metin".to_string() } else { preview };

            if let Ok(conn) = open_db(&self.db_path) {
                let most_recent: Option<String> = conn.query_row(
                    "SELECT text_content FROM clipboard_history WHERE content_type = 'text' ORDER BY copied_at DESC LIMIT 1",
                    [],
                    |r| r.get(0),
                ).ok();

                if most_recent.as_deref() == Some(&text) {
                    let _ = conn.execute(
                        "UPDATE clipboard_history SET copied_at = datetime('now') WHERE id = (SELECT id FROM clipboard_history WHERE content_type = 'text' ORDER BY copied_at DESC LIMIT 1)",
                        [],
                    );
                } else {
                    let _ = conn.execute(
                        "INSERT INTO clipboard_history (content_type, text_content, preview, char_count, copied_at) VALUES ('text', ?1, ?2, ?3, datetime('now'))",
                        params![text, preview, char_count as i64],
                    );
                    prune_clipboard_history(&conn, max_items);
                }
                let _ = self.app_handle.emit("clipboard-updated", ());
            }
        }
    }
}

fn prune_clipboard_history(conn: &Connection, max_items: u32) {
    let limit = max_items.max(10);
    // Find unpinned images exceeding limit and delete files from disk
    if let Ok(mut stmt) = conn.prepare(
        "SELECT image_path FROM clipboard_history WHERE is_pinned = 0 AND image_path IS NOT NULL AND id NOT IN (
            SELECT id FROM clipboard_history WHERE is_pinned = 0 ORDER BY copied_at DESC LIMIT ?1
        )",
    ) {
        if let Ok(rows) = stmt.query_map(params![limit], |r| r.get::<_, String>(0)) {
            for p in rows.flatten() {
                let _ = std::fs::remove_file(p);
            }
        }
    }

    let _ = conn.execute(
        "DELETE FROM clipboard_history WHERE is_pinned = 0 AND id NOT IN (
            SELECT id FROM clipboard_history WHERE is_pinned = 0 ORDER BY copied_at DESC LIMIT ?1
        )",
        params![limit],
    );
}

fn start_clipboard_watcher(app_handle: AppHandle, db_path: PathBuf, cache_dir: PathBuf) {
    std::thread::spawn(move || {
        let mut watcher = match ClipboardWatcherContext::new() {
            Ok(w) => w,
            Err(e) => {
                eprintln!("Failed to create clipboard watcher: {e}");
                return;
            }
        };

        let handler = AppClipboardHandler {
            app_handle,
            db_path,
            cache_dir,
        };

        watcher.add_handler(handler);
        watcher.start_watch();
    });
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;

    let show_launcher =
        MenuItem::with_id(app, "show_launcher", "Show Vault Launcher", true, None::<&str>)?;
    let show_clipboard =
        MenuItem::with_id(app, "show_clipboard", "Show Clipboard History", true, None::<&str>)?;
    let take_screenshot =
        MenuItem::with_id(app, "take_screenshot", "Capture Screenshot", true, None::<&str>)?;
    let open_manager =
        MenuItem::with_id(app, "open_manager", "Open Manager", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit PasCopyOf", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_launcher, &show_clipboard, &take_screenshot, &open_manager, &separator, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("Missing default window icon")?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("PasCopyOf - Password Vault & Clipboard")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show_launcher" => {
                if let Some(window) = app.get_webview_window("launcher") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "show_clipboard" => {
                let _ = show_clipboard_launcher_window(app);
            }
            "take_screenshot" => {
                let _ = trigger_screenshot_capture(app);
            }
            "open_manager" => {
                if let Some(window) = app.get_webview_window("manager") {
                    let _ = window.show();
                    let _ = window.set_focus();
                } else {
                    let _ = WebviewWindowBuilder::new(
                        app,
                        "manager",
                        WebviewUrl::App("index.html#/manager".into()),
                    )
                    .title("PasCopyOf - Vault Manager")
                    .inner_size(1000.0, 640.0)
                    .min_inner_size(860.0, 520.0)
                    .center()
                    .build();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn map_credential_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CredentialSafe> {
    let favorite_i: i64 = row.get(6)?;
    Ok(CredentialSafe {
        id: row.get(0)?,
        key_name: row.get(1)?,
        username: row.get(2)?,
        notes: row.get(3)?,
        category_id: row.get(4)?,
        created_at: row.get(5)?,
        is_favorite: favorite_i != 0,
        last_used_at: row.get(7)?,
    })
}

// ─── Commands: vault lifecycle ───────────────────────────────────────────────

#[tauri::command]
async fn check_vault_initialized(state: State<'_, SafeAppState>) -> Result<bool, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    Ok(get_meta(&conn, "salt").is_some())
}

#[tauri::command]
async fn init_vault(masterPassword: String, state: State<'_, SafeAppState>) -> Result<(), String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;

    let mut salt_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let salt_hex = hex::encode(salt_bytes);

    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    set_meta(&conn, "salt", &salt_hex).map_err(|e| e.to_string())?;

    let key = derive_key(&masterPassword, &salt_hex).map_err(|e| e.to_string())?;
    let blob = encrypt(&key, VERIFY_MESSAGE).map_err(|e| e.to_string())?;
    set_meta(&conn, "verify", &blob).map_err(|e| e.to_string())?;

    st.encryption_key = Some(key);
    touch_activity(&mut st);
    Ok(())
}

#[tauri::command]
async fn unlock_vault(masterPassword: String, state: State<'_, SafeAppState>) -> Result<bool, String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

    let salt_hex = get_meta(&conn, "salt").ok_or_else(|| "Vault not initialized".to_string())?;
    let key = derive_key(&masterPassword, &salt_hex).map_err(|e| e.to_string())?;

    if let Some(blob) = get_meta(&conn, "verify") {
        match decrypt(&key, &blob) {
            Ok(msg) if msg == VERIFY_MESSAGE => {
                st.encryption_key = Some(key);
                touch_activity(&mut st);
                Ok(true)
            }
            _ => Ok(false),
        }
    } else {
        let blob = encrypt(&key, VERIFY_MESSAGE).map_err(|e| e.to_string())?;
        set_meta(&conn, "verify", &blob).map_err(|e| e.to_string())?;
        st.encryption_key = Some(key);
        touch_activity(&mut st);
        Ok(true)
    }
}

#[tauri::command]
async fn change_master_password(
    currentPassword: String,
    newPassword: String,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let verified = unlock_vault(currentPassword, state.clone()).await?;
    if !verified {
        return Err("Current password is incorrect".into());
    }

    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    let old_key = require_key(&mut st)?;

    let mut salt_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let new_salt_hex = hex::encode(salt_bytes);
    let new_key = derive_key(&newPassword, &new_salt_hex).map_err(|e| e.to_string())?;

    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    let mut creds: Vec<(i64, String)> = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, password_encrypted FROM credentials")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows {
            creds.push(row.map_err(|e| e.to_string())?);
        }
    }

    for (id, encrypted) in creds {
        let plaintext = decrypt(&old_key, &encrypted).map_err(|e| e.to_string())?;
        let new_encrypted = encrypt(&new_key, &plaintext).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE credentials SET password_encrypted = ?1 WHERE id = ?2",
            params![new_encrypted, id],
        )
        .map_err(|e| e.to_string())?;
    }

    let verify_blob = encrypt(&new_key, VERIFY_MESSAGE).map_err(|e| e.to_string())?;
    set_meta(&conn, "salt", &new_salt_hex).map_err(|e| e.to_string())?;
    set_meta(&conn, "verify", &verify_blob).map_err(|e| e.to_string())?;
    st.encryption_key = Some(new_key);
    touch_activity(&mut st);
    Ok(())
}

#[tauri::command]
async fn lock_vault(app: AppHandle, state: State<'_, SafeAppState>) -> Result<(), String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    st.encryption_key = None;
    emit_vault_locked(&app);
    Ok(())
}

#[tauri::command]
async fn touch_activity_cmd(state: State<'_, SafeAppState>) -> Result<(), String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    if st.encryption_key.is_some() {
        if let Err(err) = enforce_idle_lock(&mut st) {
            return Err(err);
        }
        touch_activity(&mut st);
    }
    Ok(())
}

#[tauri::command]
async fn get_idle_timeout(state: State<'_, SafeAppState>) -> Result<u64, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    Ok(st.idle_timeout_minutes)
}

#[tauri::command]
async fn set_idle_timeout(minutes: u64, state: State<'_, SafeAppState>) -> Result<(), String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    set_meta(&conn, "idle_timeout_minutes", &minutes.to_string()).map_err(|e| e.to_string())?;
    st.idle_timeout_minutes = minutes;
    touch_activity(&mut st);
    Ok(())
}

#[tauri::command]
async fn is_vault_unlocked(state: State<'_, SafeAppState>) -> Result<bool, String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    if let Err(_) = enforce_idle_lock(&mut st) {
        return Ok(false);
    }
    Ok(st.encryption_key.is_some())
}

// ─── Credentials ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn search_credentials(
    query: String,
    categoryId: Option<i64>,
    state: State<'_, SafeAppState>,
) -> Result<Vec<CredentialSafe>, String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    require_key(&mut st)?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

    let search_pattern = format!("%{}%", query.to_lowercase());
    let mut sql = "SELECT id, key_name, username, notes, category_id, created_at, is_favorite, last_used_at
                   FROM credentials WHERE LOWER(key_name) LIKE ?1"
        .to_string();
    if categoryId.is_some() {
        sql.push_str(" AND category_id = ?2");
    }
    sql.push_str(
        " ORDER BY is_favorite DESC,
                  CASE WHEN last_used_at IS NULL THEN 1 ELSE 0 END,
                  last_used_at DESC,
                  key_name ASC
           LIMIT 50",
    );

    let mut results = Vec::new();
    if let Some(cat_id) = categoryId {
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![search_pattern, cat_id], map_credential_row)
            .map_err(|e| e.to_string())?;
        for row in rows {
            results.push(row.map_err(|e| e.to_string())?);
        }
    } else {
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![search_pattern], map_credential_row)
            .map_err(|e| e.to_string())?;
        for row in rows {
            results.push(row.map_err(|e| e.to_string())?);
        }
    }
    Ok(results)
}

#[tauri::command]
async fn copy_password(
    id: i64,
    app: AppHandle,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let key = {
        let mut st = state.0.lock().map_err(|e| e.to_string())?;
        require_key(&mut st)?
    };
    let db_path = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.db_path.clone()
    };
    let conn = open_db(&db_path).map_err(|e| e.to_string())?;
    let encrypted: String = conn
        .query_row(
            "SELECT password_encrypted FROM credentials WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| "Credential not found".to_string())?;
    let plaintext = decrypt(&key, &encrypted).map_err(|e| e.to_string())?;
    {
        if let Ok(mut st) = state.0.lock() {
            st.last_vault_password = Some(plaintext.clone());
        }
    }
    app.clipboard()
        .write_text(plaintext)
        .map_err(|e| e.to_string())?;
    mark_last_used(&conn, id)?;
    schedule_clipboard_clear(&app, &*state);
    Ok(())
}

#[tauri::command]
async fn copy_username(
    id: i64,
    app: AppHandle,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    {
        let mut st = state.0.lock().map_err(|e| e.to_string())?;
        require_key(&mut st)?;
    }
    let db_path = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.db_path.clone()
    };
    let conn = open_db(&db_path).map_err(|e| e.to_string())?;
    let username: String = conn
        .query_row(
            "SELECT username FROM credentials WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| "Credential not found".to_string())?;
    if username.trim().is_empty() {
        return Err("No username stored for this credential".into());
    }
    app.clipboard()
        .write_text(username)
        .map_err(|e| e.to_string())?;
    mark_last_used(&conn, id)?;
    schedule_clipboard_clear(&app, &*state);
    Ok(())
}

#[tauri::command]
async fn toggle_favorite(id: i64, state: State<'_, SafeAppState>) -> Result<bool, String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    require_key(&mut st)?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE credentials SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    let favorite: i64 = conn
        .query_row(
            "SELECT is_favorite FROM credentials WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(favorite != 0)
}

#[tauri::command]
async fn add_credential(
    keyName: String,
    username: String,
    password: String,
    notes: String,
    categoryId: Option<i64>,
    state: State<'_, SafeAppState>,
) -> Result<i64, String> {
    let key = {
        let mut st = state.0.lock().map_err(|e| e.to_string())?;
        require_key(&mut st)?
    };
    let password_encrypted = encrypt(&key, &password).map_err(|e| e.to_string())?;
    let db_path = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.db_path.clone()
    };
    let conn = open_db(&db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO credentials (key_name, username, password_encrypted, notes, category_id)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![keyName, username, password_encrypted, notes, categoryId],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
async fn update_credential(
    id: i64,
    keyName: String,
    username: String,
    password: String,
    notes: String,
    categoryId: Option<i64>,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let key = {
        let mut st = state.0.lock().map_err(|e| e.to_string())?;
        require_key(&mut st)?
    };
    let db_path = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.db_path.clone()
    };
    let conn = open_db(&db_path).map_err(|e| e.to_string())?;
    if password.is_empty() {
        conn.execute(
            "UPDATE credentials SET key_name = ?1, username = ?2, notes = ?3, category_id = ?4 WHERE id = ?5",
            params![keyName, username, notes, categoryId, id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let password_encrypted = encrypt(&key, &password).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE credentials SET key_name = ?1, username = ?2, password_encrypted = ?3, notes = ?4, category_id = ?5 WHERE id = ?6",
            params![keyName, username, password_encrypted, notes, categoryId, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn delete_credential(id: i64, state: State<'_, SafeAppState>) -> Result<(), String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    require_key(&mut st)?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM credentials WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_decrypted_password(id: i64, state: State<'_, SafeAppState>) -> Result<String, String> {
    let key = {
        let mut st = state.0.lock().map_err(|e| e.to_string())?;
        require_key(&mut st)?
    };
    let db_path = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.db_path.clone()
    };
    let conn = open_db(&db_path).map_err(|e| e.to_string())?;
    let encrypted: String = conn
        .query_row(
            "SELECT password_encrypted FROM credentials WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| "Credential not found".to_string())?;
    decrypt(&key, &encrypted).map_err(|e| e.to_string())
}

// ─── Categories ──────────────────────────────────────────────────────────────

#[tauri::command]
async fn get_categories(state: State<'_, SafeAppState>) -> Result<Vec<Category>, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, icon, color FROM categories ORDER BY name ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Category {
                id: row.get(0)?,
                name: row.get(1)?,
                icon: row.get(2)?,
                color: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

#[tauri::command]
async fn add_category(
    name: String,
    icon: String,
    color: String,
    state: State<'_, SafeAppState>,
) -> Result<i64, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO categories (name, icon, color) VALUES (?1, ?2, ?3)",
        params![name, icon, color],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
async fn update_category(
    id: i64,
    name: String,
    icon: String,
    color: String,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE categories SET name = ?1, icon = ?2, color = ?3 WHERE id = ?4",
        params![name, icon, color, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_category(id: i64, state: State<'_, SafeAppState>) -> Result<(), String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM categories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Windows ─────────────────────────────────────────────────────────────────

#[tauri::command]
async fn show_launcher(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("launcher") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn hide_launcher(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("launcher") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn open_manager(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("manager") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        WebviewWindowBuilder::new(
            &app,
            "manager",
            WebviewUrl::App("index.html#/manager".into()),
        )
        .title("PasCopyOf - Vault Manager")
        .inner_size(1000.0, 640.0)
        .min_inner_size(860.0, 520.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── Shortcut settings ───────────────────────────────────────────────────────

#[tauri::command]
async fn get_launcher_shortcut(state: State<'_, SafeAppState>) -> Result<String, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    Ok(st.launcher_shortcut.clone())
}

#[tauri::command]
async fn set_launcher_shortcut(
    shortcut: String,
    app: AppHandle,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    let shortcut = shortcut.trim().to_string();
    if shortcut.is_empty() {
        return Err("Shortcut cannot be empty".into());
    }
    shortcut
        .parse::<Shortcut>()
        .map_err(|e| format!("Invalid shortcut: {e}"))?;

    let old_shortcut = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.launcher_shortcut.clone()
    };
    if shortcut == old_shortcut {
        return Ok(());
    }
    if let Ok(old) = old_shortcut.parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(old);
    }
    if let Err(err) = register_launcher_hotkey(&app, &shortcut) {
        let _ = register_launcher_hotkey(&app, &old_shortcut);
        return Err(err);
    }

    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    set_meta(&conn, "launcher_shortcut", &shortcut).map_err(|e| e.to_string())?;
    st.launcher_shortcut = shortcut;
    Ok(())
}

// ─── Backup / restore / CSV import ───────────────────────────────────────────

#[tauri::command]
async fn export_vault(path: String, state: State<'_, SafeAppState>) -> Result<(), String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    require_key(&mut st)?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

    let salt = get_meta(&conn, "salt").ok_or_else(|| "Vault not initialized".to_string())?;
    let verify = get_meta(&conn, "verify");

    let mut categories = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT name, icon, color FROM categories ORDER BY name ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(BackupCategory {
                    name: row.get(0)?,
                    icon: row.get(1)?,
                    color: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            categories.push(row.map_err(|e| e.to_string())?);
        }
    }

    let mut credentials = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT c.key_name, c.username, c.password_encrypted, c.notes,
                        cat.name, c.is_favorite, c.created_at
                 FROM credentials c
                 LEFT JOIN categories cat ON cat.id = c.category_id
                 ORDER BY c.key_name ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let favorite_i: i64 = row.get(5)?;
                Ok(BackupCredential {
                    key_name: row.get(0)?,
                    username: row.get(1)?,
                    password_encrypted: row.get(2)?,
                    notes: row.get(3)?,
                    category_name: row.get(4)?,
                    is_favorite: favorite_i != 0,
                    created_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            credentials.push(row.map_err(|e| e.to_string())?);
        }
    }

    let backup = BackupFile {
        format: "pascopyof-backup".into(),
        version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
        salt,
        verify,
        categories,
        credentials,
    };
    let json = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn restore_vault(
    path: String,
    app: AppHandle,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let backup: BackupFile = serde_json::from_str(&raw).map_err(|e| format!("Invalid backup: {e}"))?;
    if backup.format != "pascopyof-backup" {
        return Err("Not a PasCopyOf backup file".into());
    }

    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM credentials", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM categories", [])
        .map_err(|e| e.to_string())?;

    set_meta(&conn, "salt", &backup.salt).map_err(|e| e.to_string())?;
    if let Some(verify) = &backup.verify {
        set_meta(&conn, "verify", verify).map_err(|e| e.to_string())?;
    } else {
        conn.execute("DELETE FROM meta WHERE key = 'verify'", [])
            .map_err(|e| e.to_string())?;
    }

    let mut category_ids = std::collections::HashMap::new();
    for cat in &backup.categories {
        conn.execute(
            "INSERT INTO categories (name, icon, color) VALUES (?1, ?2, ?3)",
            params![cat.name, cat.icon, cat.color],
        )
        .map_err(|e| e.to_string())?;
        category_ids.insert(cat.name.clone(), conn.last_insert_rowid());
    }

    for cred in &backup.credentials {
        let category_id = cred
            .category_name
            .as_ref()
            .and_then(|name| category_ids.get(name).copied());
        conn.execute(
            "INSERT INTO credentials (key_name, username, password_encrypted, notes, category_id, created_at, is_favorite)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                cred.key_name,
                cred.username,
                cred.password_encrypted,
                cred.notes,
                category_id,
                cred.created_at,
                if cred.is_favorite { 1 } else { 0 }
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    st.encryption_key = None;
    emit_vault_locked(&app);
    Ok(())
}

#[tauri::command]
async fn import_csv(path: String, state: State<'_, SafeAppState>) -> Result<ImportResult, String> {
    let key = {
        let mut st = state.0.lock().map_err(|e| e.to_string())?;
        require_key(&mut st)?
    };
    let db_path = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.db_path.clone()
    };
    let conn = open_db(&db_path).map_err(|e| e.to_string())?;
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;

    let mut lines = raw.lines().filter(|l| !l.trim().is_empty());
    let header_line = lines.next().ok_or_else(|| "CSV is empty".to_string())?;
    let headers: Vec<String> = parse_csv_line(header_line)
        .into_iter()
        .map(|h| h.trim().to_lowercase())
        .collect();

    let idx = |names: &[&str]| -> Option<usize> {
        headers.iter().position(|h| names.iter().any(|n| h == n))
    };

    let key_idx = idx(&["key_name", "name", "title", "entry"])
        .ok_or_else(|| "CSV must include a name/title/key_name column".to_string())?;
    let user_idx = idx(&["username", "user", "login"]);
    let pass_idx = idx(&["password", "pass", "passwd"]);
    let notes_idx = idx(&["notes", "note", "comments", "comment"]);
    let cat_idx = idx(&["category", "folder", "group"]);
    // Browser exports often have url — store in notes if notes empty
    let url_idx = idx(&["url", "website", "uri"]);

    let mut imported = 0u32;
    let mut skipped = 0u32;

    for line in lines {
        let cols = parse_csv_line(line);
        let key_name = cols.get(key_idx).map(|s| s.trim()).unwrap_or("");
        if key_name.is_empty() {
            skipped += 1;
            continue;
        }
        let username = user_idx
            .and_then(|i| cols.get(i))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let password = pass_idx
            .and_then(|i| cols.get(i))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        if password.is_empty() {
            skipped += 1;
            continue;
        }
        let mut notes = notes_idx
            .and_then(|i| cols.get(i))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        if notes.is_empty() {
            if let Some(i) = url_idx {
                if let Some(url) = cols.get(i) {
                    let url = url.trim();
                    if !url.is_empty() {
                        notes = format!("URL: {url}");
                    }
                }
            }
        }

        let category_id = if let Some(i) = cat_idx {
            let cat_name = cols.get(i).map(|s| s.trim()).unwrap_or("");
            if !cat_name.is_empty() {
                let existing: Option<i64> = conn
                    .query_row(
                        "SELECT id FROM categories WHERE LOWER(name) = LOWER(?1)",
                        params![cat_name],
                        |row| row.get(0),
                    )
                    .ok();
                Some(match existing {
                    Some(id) => id,
                    None => {
                        conn.execute(
                            "INSERT INTO categories (name, icon, color) VALUES (?1, 'Key', '#0ea5e9')",
                            params![cat_name],
                        )
                        .map_err(|e| e.to_string())?;
                        conn.last_insert_rowid()
                    }
                })
            } else {
                None
            }
        } else {
            None
        };

        let password_encrypted = encrypt(&key, &password).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO credentials (key_name, username, password_encrypted, notes, category_id)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![key_name, username, password_encrypted, notes, category_id],
        )
        .map_err(|e| e.to_string())?;
        imported += 1;
    }

    Ok(ImportResult { imported, skipped })
}

fn parse_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                if in_quotes && chars.peek() == Some(&'"') {
                    current.push('"');
                    chars.next();
                } else {
                    in_quotes = !in_quotes;
                }
            }
            ',' if !in_quotes => {
                fields.push(current.clone());
                current.clear();
            }
            _ => current.push(c),
        }
    }
    fields.push(current);
    fields
}

// ─── Clipboard History Commands ──────────────────────────────────────────────

#[tauri::command]
async fn get_clipboard_history(
    query: String,
    filter_type: Option<String>,
    limit: Option<u32>,
    state: State<'_, SafeAppState>,
) -> Result<Vec<ClipboardItem>, String> {
    let (db_path, default_limit) = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        (st.db_path.clone(), st.clipboard_page_size)
    };

    let take_limit = limit.unwrap_or(default_limit).max(1);
    let conn = open_db(&db_path).map_err(|e| e.to_string())?;

    let q = query.trim().to_lowercase();
    let filter = filter_type.as_deref().unwrap_or("all");

    let mut sql = "SELECT id, content_type, text_content, image_path, file_paths, preview, char_count, file_count, image_dimensions, copied_at, is_pinned FROM clipboard_history WHERE 1=1".to_string();

    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if !q.is_empty() {
        sql.push_str(" AND (lower(preview) LIKE ? OR lower(coalesce(text_content, '')) LIKE ? OR lower(coalesce(file_paths, '')) LIKE ?)");
        let pattern = format!("%{q}%");
        params_vec.push(Box::new(pattern.clone()));
        params_vec.push(Box::new(pattern.clone()));
        params_vec.push(Box::new(pattern));
    }

    match filter {
        "text" => {
            sql.push_str(" AND content_type = 'text'");
        }
        "image" => {
            sql.push_str(" AND content_type = 'image'");
        }
        "files" => {
            sql.push_str(" AND content_type = 'files'");
        }
        "pinned" => {
            sql.push_str(" AND is_pinned = 1");
        }
        _ => {}
    }

    sql.push_str(" ORDER BY is_pinned DESC, copied_at DESC LIMIT ?");
    params_vec.push(Box::new(take_limit as i64));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params_slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();

    let rows = stmt
        .query_map(params_slice.as_slice(), |row| {
            let id: i64 = row.get(0)?;
            let content_type: String = row.get(1)?;
            let text_content: Option<String> = row.get(2)?;
            let image_path: Option<String> = row.get(3)?;
            let file_paths_json: Option<String> = row.get(4)?;
            let preview: String = row.get(5)?;
            let char_count: Option<i64> = row.get(6)?;
            let file_count: Option<i64> = row.get(7)?;
            let image_dimensions: Option<String> = row.get(8)?;
            let copied_at: String = row.get(9)?;
            let is_pinned: i64 = row.get(10)?;

            let file_paths = file_paths_json.and_then(|j| serde_json::from_str(&j).ok());

            let image_data = if content_type == "image" {
                if let Some(ref path) = image_path {
                    if let Ok(bytes) = std::fs::read(path) {
                        Some(format!("data:image/png;base64,{}", B64.encode(&bytes)))
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            Ok(ClipboardItem {
                id,
                content_type,
                text_content,
                image_path,
                image_data,
                file_paths,
                preview,
                char_count,
                file_count,
                image_dimensions,
                copied_at,
                is_pinned: is_pinned == 1,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for r in rows {
        results.push(r.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

#[tauri::command]
async fn copy_from_history(
    id: i64,
    app: AppHandle,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let (db_path, ctx) = {
        let mut st = state.0.lock().map_err(|e| e.to_string())?;
        st.ignore_clipboard_change = true;
        let p = st.db_path.clone();
        (p, ClipboardContext::new().map_err(|e| e.to_string())?)
    };

    let conn = open_db(&db_path).map_err(|e| e.to_string())?;
    let row = conn
        .query_row(
            "SELECT content_type, text_content, image_path, file_paths FROM clipboard_history WHERE id = ?1",
            params![id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .map_err(|_| "Item not found".to_string())?;

    let (content_type, text_content, image_path, file_paths) = row;
    match content_type.as_str() {
        "text" => {
            if let Some(text) = text_content {
                ctx.set_text(text).map_err(|e| e.to_string())?;
            }
        }
        "image" => {
            if let Some(path) = image_path {
                if let Ok(img) = RustImageData::from_path(&path) {
                    ctx.set_image(img).map_err(|e| e.to_string())?;
                }
            }
        }
        "files" => {
            if let Some(json_str) = file_paths {
                if let Ok(paths) = serde_json::from_str::<Vec<String>>(&json_str) {
                    ctx.set_files(paths).map_err(|e| e.to_string())?;
                }
            }
        }
        _ => {}
    }

    let _ = conn.execute(
        "UPDATE clipboard_history SET copied_at = datetime('now') WHERE id = ?1",
        params![id],
    );

    if let Some(window) = app.get_webview_window("clipboard-launcher") {
        let _ = window.hide();
    }
    let _ = app.emit("clipboard-updated", ());
    Ok(())
}

#[tauri::command]
async fn delete_history_item(
    id: i64,
    app: AppHandle,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let db_path = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.db_path.clone()
    };
    let conn = open_db(&db_path).map_err(|e| e.to_string())?;
    let img_path: Option<String> = conn
        .query_row(
            "SELECT image_path FROM clipboard_history WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    if let Some(path) = img_path {
        let _ = std::fs::remove_file(path);
    }
    conn.execute(
        "DELETE FROM clipboard_history WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    let _ = app.emit("clipboard-updated", ());
    Ok(())
}

#[tauri::command]
async fn clear_clipboard_history(
    app: AppHandle,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let db_path = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.db_path.clone()
    };
    let conn = open_db(&db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT image_path FROM clipboard_history WHERE is_pinned = 0 AND image_path IS NOT NULL")
        .map_err(|e| e.to_string())?;
    let img_paths = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for p in img_paths.flatten() {
        let _ = std::fs::remove_file(p);
    }
    conn.execute("DELETE FROM clipboard_history WHERE is_pinned = 0", [])
        .map_err(|e| e.to_string())?;
    let _ = app.emit("clipboard-updated", ());
    Ok(())
}

#[tauri::command]
async fn toggle_pin_history(
    id: i64,
    app: AppHandle,
    state: State<'_, SafeAppState>,
) -> Result<bool, String> {
    let db_path = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.db_path.clone()
    };
    let conn = open_db(&db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE clipboard_history SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    let is_pinned: i64 = conn
        .query_row(
            "SELECT is_pinned FROM clipboard_history WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let _ = app.emit("clipboard-updated", ());
    Ok(is_pinned == 1)
}

#[tauri::command]
async fn get_clipboard_shortcut(state: State<'_, SafeAppState>) -> Result<String, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    Ok(st.clipboard_shortcut.clone())
}

#[tauri::command]
async fn set_clipboard_shortcut(
    shortcut: String,
    app: AppHandle,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    let old_shortcut = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.clipboard_shortcut.clone()
    };

    if let Ok(s) = old_shortcut.parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(s);
    }

    register_clipboard_hotkey(&app, &shortcut)?;

    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    st.clipboard_shortcut = shortcut.clone();
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    set_meta(&conn, "clipboard_shortcut", &shortcut).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_clipboard_settings(
    state: State<'_, SafeAppState>,
) -> Result<ClipboardSettings, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    Ok(ClipboardSettings {
        shortcut: st.clipboard_shortcut.clone(),
        page_size: st.clipboard_page_size,
        lock_with_vault: st.clipboard_lock_with_vault,
        enabled: st.clipboard_enabled,
        preview_delay_ms: st.clipboard_preview_delay_ms,
    })
}

#[tauri::command]
async fn update_clipboard_settings(
    page_size: u32,
    lock_with_vault: bool,
    enabled: bool,
    preview_delay_ms: Option<u32>,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let delay = preview_delay_ms.unwrap_or(2000);
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    st.clipboard_page_size = page_size;
    st.clipboard_lock_with_vault = lock_with_vault;
    st.clipboard_enabled = enabled;
    st.clipboard_preview_delay_ms = delay;

    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    set_meta(&conn, "clipboard_page_size", &page_size.to_string()).map_err(|e| e.to_string())?;
    set_meta(
        &conn,
        "clipboard_lock_with_vault",
        if lock_with_vault { "1" } else { "0" },
    )
    .map_err(|e| e.to_string())?;
    set_meta(
        &conn,
        "clipboard_enabled",
        if enabled { "1" } else { "0" },
    )
    .map_err(|e| e.to_string())?;
    set_meta(
        &conn,
        "clipboard_preview_delay_ms",
        &delay.to_string(),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn show_clipboard_launcher(app: AppHandle) -> Result<(), String> {
    show_clipboard_launcher_window(&app)
}

#[tauri::command]
async fn hide_clipboard_launcher(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("clipboard-launcher") {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
async fn get_app_config(
    state: State<'_, SafeAppState>,
) -> Result<AppConfig, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    let theme = get_meta(&conn, "app_theme").unwrap_or_else(|| "dark".to_string());
    let language = get_meta(&conn, "app_language").unwrap_or_else(|| "tr".to_string());
    Ok(AppConfig { theme, language })
}

#[tauri::command]
async fn set_app_theme(
    theme: String,
    state: State<'_, SafeAppState>,
    app: AppHandle,
) -> Result<(), String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    set_meta(&conn, "app_theme", &theme).map_err(|e| e.to_string())?;
    let _ = app.emit("theme-changed", &theme);
    Ok(())
}

#[tauri::command]
async fn set_app_language(
    language: String,
    state: State<'_, SafeAppState>,
    app: AppHandle,
) -> Result<(), String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    set_meta(&conn, "app_language", &language).map_err(|e| e.to_string())?;
    let _ = app.emit("language-changed", &language);
    Ok(())
}

fn decode_base64_png(data: &str) -> Result<Vec<u8>, String> {
    let raw = if let Some(idx) = data.find(',') {
        &data[idx + 1..]
    } else {
        data
    };
    B64.decode(raw.trim()).map_err(|e| format!("Base64 decode error: {e}"))
}

#[tauri::command]
async fn trigger_screenshot(app: AppHandle) -> Result<(), String> {
    trigger_screenshot_capture(&app)
}

#[tauri::command]
async fn copy_annotated_image(
    app: AppHandle,
    base64_png: String,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let bytes = decode_base64_png(&base64_png)?;
    let dynamic_img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let rust_img = RustImageData::from_dynamic_image(dynamic_img);
    let ctx = ClipboardContext::new().map_err(|e| e.to_string())?;
    ctx.set_image(rust_img).map_err(|e| e.to_string())?;

    let show_notif = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.screenshot_notification_enabled
    };

    if show_notif {
        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title("PasCopyOf")
            .body("✓ Ekran görüntüsü panoya kopyalandı ve geçmişe eklendi.")
            .show();
    }

    if let Some(w) = app.get_webview_window("screenshot-overlay") {
        let _ = w.hide();
    }
    Ok(())
}

#[tauri::command]
async fn extract_text_from_image(app: AppHandle, base64_png: String) -> Result<String, String> {
    let bytes = decode_base64_png(&base64_png)?;
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join(format!("ocr_{}.png", rand::random::<u32>()));
    std::fs::write(&temp_file, &bytes).map_err(|e| e.to_string())?;

    let ps_script = format!(
        r#"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {{
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod
}} | Select-Object -First 1

function Await-WinRt($WinRtTask, $ResultType) {{
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(6000) | Out-Null
    return $netTask.Result
}}

[Windows.Media.Ocr.OcrEngine, Windows.Foundation.Diagnostics, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) {{
    exit 0
}}

$fileOp = [Windows.Storage.StorageFile]::GetFileFromPathAsync('{}')
$file = Await-WinRt $fileOp ([Windows.Storage.StorageFile])

$streamOp = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
$stream = Await-WinRt $streamOp ([Windows.Storage.Streams.IRandomAccessStream])

$decoderOp = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
$decoder = Await-WinRt $decoderOp ([Windows.Graphics.Imaging.BitmapDecoder])

$bitmapOp = $decoder.GetSoftwareBitmapAsync()
$bitmap = Await-WinRt $bitmapOp ([Windows.Graphics.Imaging.SoftwareBitmap])

$ocrOp = $engine.RecognizeAsync($bitmap)
$result = Await-WinRt $ocrOp ([Windows.Media.Ocr.OcrResult])

if ($result -and $result.Lines) {{
    $lines = $result.Lines | ForEach-Object {{ $_.Text }}
    $lines -join "`n"
}}
"#,
        temp_file.to_string_lossy().replace('\'', "''")
    );

    #[cfg(target_os = "windows")]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &ps_script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("PowerShell error: {e}"))?
    };

    #[cfg(not(target_os = "windows"))]
    let output = std::process::Command::new("true").output().map_err(|e| e.to_string())?;

    let _ = std::fs::remove_file(&temp_file);

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if !text.is_empty() {
        if let Ok(ctx) = ClipboardContext::new() {
            let _ = ctx.set_text(text.clone());
        }

        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title("PasCopyOf Metin Çıkarma (OCR)")
            .body("✓ Metin başarıyla çıkarıldı ve panoya kopyalandı.")
            .show();
    }

    Ok(text)
}

#[tauri::command]
async fn save_annotated_image(
    app: AppHandle,
    base64_png: String,
    default_filename: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let bytes = decode_base64_png(&base64_png)?;
    let default_name = default_filename.unwrap_or_else(|| {
        let now = chrono::Local::now();
        format!("PasCopyOf_Screenshot_{}.png", now.format("%Y%m%d_%H%M%S"))
    });

    let file_path = app
        .dialog()
        .file()
        .add_filter("PNG Resim (*.png)", &["png"])
        .set_file_name(&default_name)
        .blocking_save_file();

    if let Some(path) = file_path {
        let p = path.as_path().ok_or("Geçersiz dosya yolu")?;
        std::fs::write(p, bytes).map_err(|e| e.to_string())?;
        if let Some(w) = app.get_webview_window("screenshot-overlay") {
            let _ = w.hide();
        }
        Ok(Some(p.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn hide_screenshot_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("screenshot-overlay") {
        let _ = w.hide();
    }
    Ok(())
}

#[tauri::command]
async fn get_screenshot_shortcut(state: State<'_, SafeAppState>) -> Result<String, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    Ok(st.screenshot_shortcut.clone())
}

#[tauri::command]
async fn set_screenshot_shortcut(
    app: AppHandle,
    state: State<'_, SafeAppState>,
    shortcut: String,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    let new_sc: Shortcut = shortcut
        .parse()
        .map_err(|e| format!("Geçersiz kısayol: {e}"))?;
    let old_sc_str = {
        let mut st = state.0.lock().map_err(|e| e.to_string())?;
        let old = st.screenshot_shortcut.clone();
        st.screenshot_shortcut = shortcut.clone();
        old
    };

    if let Ok(old_sc) = old_sc_str.parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(old_sc);
    }

    let app_handle = app.clone();
    app.global_shortcut()
        .on_shortcut(new_sc, move |_app, _shortcut, event| {
            if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                let _ = trigger_screenshot_capture(&app_handle);
            }
        })
        .map_err(|e| e.to_string())?;

    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    set_meta(&conn, "screenshot_shortcut", &shortcut).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn get_screenshot_settings(
    state: State<'_, SafeAppState>,
) -> Result<ScreenshotSettings, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    Ok(ScreenshotSettings {
        shortcut: st.screenshot_shortcut.clone(),
        notification_enabled: st.screenshot_notification_enabled,
    })
}

#[tauri::command]
async fn update_screenshot_settings(
    notification_enabled: bool,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    st.screenshot_notification_enabled = notification_enabled;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    set_meta(
        &conn,
        "screenshot_notification_enabled",
        if notification_enabled { "1" } else { "0" },
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn ensure_windows_notification_identity() {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    let app_id = "com.pascopyof.vault";
    let wide_app_id: Vec<u16> = OsStr::new(app_id)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    #[link(name = "shell32")]
    extern "system" {
        fn SetCurrentProcessExplicitAppUserModelID(AppID: *const u16) -> i32;
    }
    unsafe {
        let _ = SetCurrentProcessExplicitAppUserModelID(wide_app_id.as_ptr());
    }

    if let Ok(app_data) = std::env::var("APPDATA") {
        let shortcut_path = std::path::PathBuf::from(app_data)
            .join("Microsoft\\Windows\\Start Menu\\Programs\\PasCopyOf.lnk");
        if !shortcut_path.exists() {
            if let Ok(exe_path) = std::env::current_exe() {
                let ps_cmd = format!(
                    r#"$w = New-Object -ComObject WScript.Shell; $s = $w.CreateShortcut('{}'); $s.TargetPath = '{}'; $s.Description = 'PasCopyOf'; $s.Save();"#,
                    shortcut_path.to_string_lossy().replace('\'', "''"),
                    exe_path.to_string_lossy().replace('\'', "''")
                );
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                let _ = std::process::Command::new("powershell")
                    .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &ps_cmd])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
        }
    }
}

// ─── Entry ───────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("vault.db");
            let cache_dir = data_dir.join("clipboard_cache");
            std::fs::create_dir_all(&cache_dir)?;

            let conn = open_db(&db_path).expect("Failed to initialize database");
            let launcher_shortcut = get_meta(&conn, "launcher_shortcut")
                .unwrap_or_else(|| DEFAULT_LAUNCHER_SHORTCUT.to_string());
            let clipboard_shortcut = get_meta(&conn, "clipboard_shortcut")
                .unwrap_or_else(|| DEFAULT_CLIPBOARD_SHORTCUT.to_string());
            let screenshot_shortcut = get_meta(&conn, "screenshot_shortcut")
                .unwrap_or_else(|| DEFAULT_SCREENSHOT_SHORTCUT.to_string());
            let screenshot_notification_enabled = get_meta(&conn, "screenshot_notification_enabled")
                .map(|v| v != "0")
                .unwrap_or(true);
            let clipboard_page_size = get_meta(&conn, "clipboard_page_size")
                .and_then(|v| v.parse().ok())
                .unwrap_or(DEFAULT_CLIPBOARD_PAGE_SIZE);
            let clipboard_lock_with_vault = get_meta(&conn, "clipboard_lock_with_vault")
                .map(|v| v == "1")
                .unwrap_or(false);
            let clipboard_enabled = get_meta(&conn, "clipboard_enabled")
                .map(|v| v != "0")
                .unwrap_or(true);
            let clipboard_preview_delay_ms = get_meta(&conn, "clipboard_preview_delay_ms")
                .and_then(|v| v.parse().ok())
                .unwrap_or(2000);
            let idle_timeout_minutes = get_meta(&conn, "idle_timeout_minutes")
                .and_then(|v| v.parse().ok())
                .unwrap_or(DEFAULT_IDLE_TIMEOUT_MINUTES);

            app.manage(SafeAppState(Mutex::new(AppState {
                db_path: db_path.clone(),
                cache_dir: cache_dir.clone(),
                encryption_key: None,
                clipboard_clear_handle: None,
                launcher_shortcut: launcher_shortcut.clone(),
                clipboard_shortcut: clipboard_shortcut.clone(),
                screenshot_shortcut: screenshot_shortcut.clone(),
                screenshot_notification_enabled,
                clipboard_page_size,
                clipboard_lock_with_vault,
                clipboard_enabled,
                clipboard_preview_delay_ms,
                idle_timeout_minutes,
                last_activity: Instant::now(),
                last_vault_password: None,
                ignore_clipboard_change: false,
            })));

            #[cfg(target_os = "windows")]
            ensure_windows_notification_identity();

            setup_tray(app)?;
            register_launcher_hotkey(app.handle(), &launcher_shortcut)?;
            if let Err(e) = register_clipboard_hotkey(app.handle(), &clipboard_shortcut) {
                eprintln!("Failed to register clipboard hotkey: {e}");
            }
            if let Err(e) = register_screenshot_hotkey(app.handle(), &screenshot_shortcut) {
                eprintln!("Failed to register screenshot hotkey: {e}");
            }

            // Start clipboard watcher background thread
            start_clipboard_watcher(app.handle().clone(), db_path.clone(), cache_dir.clone());

            if let Some(window) = app.get_webview_window("launcher") {
                window.show()?;
            }

            // Background idle checker
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(20)).await;
                    let state = handle.state::<SafeAppState>();
                    let mut locked_now = false;
                    if let Ok(mut st) = state.0.lock() {
                        if st.encryption_key.is_some()
                            && st.idle_timeout_minutes > 0
                            && enforce_idle_lock(&mut st).is_err()
                        {
                            locked_now = true;
                        }
                    }
                    if locked_now {
                        emit_vault_locked(&handle);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_vault_initialized,
            init_vault,
            unlock_vault,
            lock_vault,
            change_master_password,
            search_credentials,
            copy_password,
            copy_username,
            toggle_favorite,
            add_credential,
            update_credential,
            delete_credential,
            show_launcher,
            hide_launcher,
            open_manager,
            get_decrypted_password,
            is_vault_unlocked,
            get_categories,
            add_category,
            update_category,
            delete_category,
            get_launcher_shortcut,
            set_launcher_shortcut,
            touch_activity_cmd,
            get_idle_timeout,
            set_idle_timeout,
            export_vault,
            restore_vault,
            import_csv,
            // Clipboard commands
            get_clipboard_history,
            copy_from_history,
            delete_history_item,
            clear_clipboard_history,
            toggle_pin_history,
            get_clipboard_shortcut,
            set_clipboard_shortcut,
            get_clipboard_settings,
            update_clipboard_settings,
            show_clipboard_launcher,
            hide_clipboard_launcher,
            // Screenshot commands
            trigger_screenshot,
            copy_annotated_image,
            save_annotated_image,
            hide_screenshot_overlay,
            get_screenshot_shortcut,
            set_screenshot_shortcut,
            get_screenshot_settings,
            update_screenshot_settings,
            extract_text_from_image,
            // App settings (theme & language)
            get_app_config,
            set_app_theme,
            set_app_language,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PasCopyOf");
}
