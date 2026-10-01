// PasCopyOf - Password Vault Backend
// Handles: Database, Encryption/Decryption, Clipboard, Global Hotkey, Backup, Idle Lock

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
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
const DEFAULT_TIMER_WIDGET_SHORTCUT: &str = "Ctrl+Shift+T";
const DEFAULT_TASKS_SHORTCUT: &str = "Ctrl+Shift+P";
const DEFAULT_QUICK_TASK_SHORTCUT: &str = "Ctrl+Shift+N";
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
    pub timer_widget_shortcut: String,
    pub tasks_shortcut: String,
    pub quick_task_shortcut: String,
    pub screenshot_notification_enabled: bool,
    pub screenshot_save_dir: String,
    pub default_screenshot_save_dir: String,
    pub clipboard_page_size: u32,
    pub clipboard_lock_with_vault: bool,
    pub clipboard_enabled: bool,
    pub clipboard_preview_delay_ms: u32,
    pub auto_paste_on_select: bool,
    pub clipboard_window_mode: String,
    pub clipboard_close_on_blur: bool,
    pub clipboard_close_on_space: bool,
    pub clipboard_clear_search_on_open: bool,
    pub panel_scale: String,
    pub clipboard_clear_seconds: u64, // 0 = disabled (never clear)
    pub idle_timeout_minutes: u64, // 0 = disabled
    pub last_activity: Instant,
    pub last_vault_password: Option<String>,
    pub ignore_clipboard_change: bool,
    pub clipboard_image_cache: Arc<Mutex<HashMap<String, String>>>,
    pub active_timer_auto_paused: Option<(i64, String)>,
    pub timer_auto_pause_enabled: bool,
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
    pub auto_paste_on_select: bool,
    pub window_mode: String,
    pub close_on_blur: bool,
    pub close_on_space: bool,
    pub clear_search_on_open: bool,
    pub panel_scale: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotSettings {
    pub shortcut: String,
    pub notification_enabled: bool,
    pub save_dir: String,
    pub default_save_dir: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub theme: String,
    pub language: String,
}

// ─── Task & Focus Tracker Models ─────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskItem {
    pub id: i64,
    pub title: String,
    pub notes: String,
    pub status: String,
    pub priority: String,
    pub category: String,
    pub is_routine: bool,
    pub routine_schedule: String,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub total_duration_seconds: i64,
    pub checklist_count: i64,
    pub checklist_done_count: i64,
    pub is_timer_running: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskWorklog {
    pub id: i64,
    pub task_id: i64,
    pub start_time: String,
    pub end_time: Option<String>,
    pub duration_seconds: i64,
    pub note: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskChecklistItem {
    pub id: i64,
    pub task_id: i64,
    pub title: String,
    pub is_done: bool,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTimerInfo {
    pub worklog_id: i64,
    pub task_id: i64,
    pub task_title: String,
    pub start_time: String,
    pub elapsed_seconds: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DailySummary {
    pub date: String,
    pub total_seconds: i64,
    pub completed_tasks_count: i64,
    pub in_progress_tasks_count: i64,
    pub markdown_summary: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TimerStatusInfo {
    pub is_running: bool,
    pub is_auto_paused: bool,
    pub active_timer: Option<ActiveTimerInfo>,
    pub auto_paused_task: Option<PausedTaskInfo>,
    pub last_active_task: Option<PausedTaskInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PausedTaskInfo {
    pub task_id: i64,
    pub title: String,
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

fn init_db_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
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
        CREATE INDEX IF NOT EXISTS idx_clipboard_pinned ON clipboard_history (is_pinned);
        CREATE INDEX IF NOT EXISTS idx_clipboard_pinned_copied ON clipboard_history (is_pinned DESC, copied_at DESC);
        CREATE INDEX IF NOT EXISTS idx_clipboard_type_pinned ON clipboard_history (content_type, is_pinned DESC, copied_at DESC);

        -- Clean up duplicate historical text entries keeping the newest one
        DELETE FROM clipboard_history
        WHERE content_type = 'text'
          AND text_content IS NOT NULL
          AND id NOT IN (
              SELECT MAX(id) FROM clipboard_history WHERE content_type = 'text' GROUP BY text_content
          );

        -- Clean up duplicate historical file entries keeping the newest one
        DELETE FROM clipboard_history
        WHERE content_type = 'files'
          AND file_paths IS NOT NULL
          AND id NOT IN (
              SELECT MAX(id) FROM clipboard_history WHERE content_type = 'files' GROUP BY file_paths
          );

        CREATE TABLE IF NOT EXISTS tasks (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            title            TEXT    NOT NULL,
            notes            TEXT    NOT NULL DEFAULT '',
            status           TEXT    NOT NULL DEFAULT 'todo',
            priority         TEXT    NOT NULL DEFAULT 'medium',
            category         TEXT    NOT NULL DEFAULT '',
            is_routine       INTEGER NOT NULL DEFAULT 0,
            routine_schedule TEXT    NOT NULL DEFAULT '',
            created_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
            completed_at     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
        CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks (created_at DESC);

        CREATE TABLE IF NOT EXISTS task_worklogs (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id          INTEGER NOT NULL,
            start_time       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
            end_time         TEXT,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            note             TEXT    NOT NULL DEFAULT '',
            FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_worklogs_task_id ON task_worklogs (task_id);
        CREATE INDEX IF NOT EXISTS idx_worklogs_start_time ON task_worklogs (start_time DESC);

        CREATE TABLE IF NOT EXISTS task_checklists (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id    INTEGER NOT NULL,
            title      TEXT    NOT NULL,
            is_done    INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_checklists_task_id ON task_checklists (task_id);",
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

    Ok(())
}

fn open_db(path: &PathBuf) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
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

// ─── Emergency Recovery Key Helpers ──────────────────────────────────────────

fn generate_recovery_key_string() -> String {
    const CHARSET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let mut bytes = [0u8; 20];
    rand::thread_rng().fill_bytes(&mut bytes);
    let mut chars = Vec::with_capacity(20);
    for b in bytes {
        chars.push(CHARSET[(b as usize) % CHARSET.len()] as char);
    }
    let s: String = chars.into_iter().collect();
    format!(
        "PCYF-{}-{}-{}-{}-{}",
        &s[0..4],
        &s[4..8],
        &s[8..12],
        &s[12..16],
        &s[16..20]
    )
}

fn clean_recovery_key_str(input: &str) -> String {
    input
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_uppercase()
}

fn setup_recovery_for_key(conn: &Connection, key: &[u8; 32], recovery_key_str: &str) -> Result<()> {
    let clean_key = clean_recovery_key_str(recovery_key_str);
    let mut salt_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let recovery_salt_hex = hex::encode(salt_bytes);

    let recovery_derived_key = derive_key(&clean_key, &recovery_salt_hex)?;
    let key_hex = hex::encode(key);
    let recovery_vault_blob = encrypt(&recovery_derived_key, &key_hex)?;
    let recovery_verify = encrypt(&recovery_derived_key, VERIFY_MESSAGE)?;

    set_meta(conn, "recovery_salt", &recovery_salt_hex)?;
    set_meta(conn, "recovery_vault_blob", &recovery_vault_blob)?;
    set_meta(conn, "recovery_verify", &recovery_verify)?;
    let now = chrono::Local::now().to_rfc3339();
    set_meta(conn, "recovery_created_at", &now)?;
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
    let secs = st.clipboard_clear_seconds;
    if secs == 0 {
        return;
    }
    let app_clone = app.clone();
    st.clipboard_clear_handle = Some(tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(secs)).await;
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
            let _ = show_launcher_window(app);
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

fn get_monitor_for_cursor(app: &AppHandle, cursor: Option<(i32, i32)>) -> Option<tauri::Monitor> {
    let monitors = app.available_monitors().ok()?;
    if monitors.is_empty() {
        return None;
    }

    if let Some((cx, cy)) = cursor {
        // 1. Strict containment check
        for m in &monitors {
            let pos = m.position();
            let size = m.size();
            let min_x = pos.x;
            let max_x = pos.x + size.width as i32;
            let min_y = pos.y;
            let max_y = pos.y + size.height as i32;
            if cx >= min_x && cx < max_x && cy >= min_y && cy < max_y {
                return Some(m.clone());
            }
        }

        // 2. Nearest monitor distance check (if cursor is on boundary or slightly off)
        let mut best_monitor = None;
        let mut min_dist = i64::MAX;
        for m in &monitors {
            let pos = m.position();
            let size = m.size();
            let center_x = pos.x + (size.width as i32 / 2);
            let center_y = pos.y + (size.height as i32 / 2);
            let dx = (cx - center_x) as i64;
            let dy = (cy - center_y) as i64;
            let dist = dx * dx + dy * dy;
            if dist < min_dist {
                min_dist = dist;
                best_monitor = Some(m.clone());
            }
        }
        if best_monitor.is_some() {
            return best_monitor;
        }
    }

    // Fallback: primary monitor or first available
    app.primary_monitor().ok().flatten().or_else(|| monitors.into_iter().next())
}

fn show_launcher_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("launcher") {
        let cursor = get_screen_cursor_pos()
            .or_else(|| app.cursor_position().ok().map(|p| (p.x as i32, p.y as i32)));
        let monitor = get_monitor_for_cursor(app, cursor);

        if let Some(ref m) = monitor {
            let m_pos = m.position();
            let m_size = m.size();
            let scale = m.scale_factor();

            let m_log_w = m_size.width as f64 / scale;
            let m_log_h = m_size.height as f64 / scale;

            let panel_scale = {
                let state = app.state::<SafeAppState>();
                state.0.lock().map(|st| st.panel_scale.clone()).unwrap_or_else(|_| "medium".to_string())
            };
            let scale_mult: f64 = match panel_scale.as_str() {
                "small" => 0.85,
                "large" => 1.18,
                _ => 1.0,
            };

            // Adaptively scale based on screen resolution and user panel_scale preference:
            // ~36% width (clamped 580 to 760) and ~46% height (clamped 440 to 620)
            let base_w = (m_log_w * 0.36).clamp(580.0, 760.0);
            let base_h = (m_log_h * 0.46).clamp(440.0, 620.0);
            let win_w = (base_w * scale_mult).clamp(480.0, m_log_w * 0.90);
            let win_h = (base_h * scale_mult).clamp(380.0, m_log_h * 0.90);
            let win_w_phys = win_w * scale;
            let win_h_phys = win_h * scale;

            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: win_w,
                height: win_h,
            }));

            let target_x = m_pos.x as f64 + (m_size.width as f64 - win_w_phys) / 2.0;
            let target_y = m_pos.y as f64 + (m_size.height as f64 - win_h_phys) / 2.0;

            let pos = tauri::Position::Physical(tauri::PhysicalPosition {
                x: target_x as i32,
                y: target_y as i32,
            });
            let _ = window.set_position(pos);
            let _ = window.show();
            let _ = window.set_position(pos);
            let _ = window.set_focus();
        } else {
            let _ = window.center();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
    Ok(())
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

        let window_mode = {
            let st = state.0.lock().map_err(|e| e.to_string())?;
            st.clipboard_window_mode.clone()
        };

        let cursor = get_screen_cursor_pos()
            .or_else(|| app.cursor_position().ok().map(|p| (p.x as i32, p.y as i32)));
        let monitor = get_monitor_for_cursor(app, cursor);

        if window_mode == "fullscreen" {
            let _ = window.unmaximize();
            if let Some(ref m) = monitor {
                let m_pos = m.position();
                let m_size = m.size();
                let _ = window.set_position(tauri::Position::Physical(*m_pos));
                let _ = window.set_size(tauri::Size::Physical(*m_size));
                let _ = window.show();
                // Re-apply position and size after show to ensure Windows DWM uses correct monitor DPI mapping
                let _ = window.set_position(tauri::Position::Physical(*m_pos));
                let _ = window.set_size(tauri::Size::Physical(*m_size));
            } else {
                let _ = window.show();
                let _ = window.maximize();
            }
            let _ = window.set_focus();
        } else {
            let _ = window.unmaximize();

            let panel_scale = {
                let state = app.state::<SafeAppState>();
                state.0.lock().map(|st| st.panel_scale.clone()).unwrap_or_else(|_| "medium".to_string())
            };
            let scale_mult: f64 = match panel_scale.as_str() {
                "small" => 0.88,
                "large" => 1.15,
                _ => 1.0,
            };

            // Adaptively size the popup window based on the monitor resolution and panel_scale
            // Ensure width is wide enough to house both main panel and detail preview popover without clipping
            let (window_width, window_height) = if let Some(ref m) = monitor {
                let m_size = m.size();
                let scale = m.scale_factor();
                let m_log_w = m_size.width as f64 / scale;
                let m_log_h = m_size.height as f64 / scale;

                let base_w = (m_log_w * 0.58).clamp(920.0, 1150.0);
                let base_h = (m_log_h * 0.56).clamp(480.0, 700.0);
                let w = (base_w * scale_mult).clamp(800.0, m_log_w * 0.96);
                let h = (base_h * scale_mult).clamp(420.0, m_log_h * 0.96);
                (w, h)
            } else {
                ((960.0 * scale_mult).clamp(800.0, 1200.0), (520.0 * scale_mult).clamp(420.0, 800.0))
            };

            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: window_width,
                height: window_height,
            }));

            if let Some(ref m) = monitor {
                let m_pos = m.position();
                let m_size = m.size();
                let scale = m.scale_factor();
                let win_w_phys = window_width * scale;
                let win_h_phys = window_height * scale;

                let mut tx_shifted_left = false;
                let (target_x, target_y) = if let Some((cur_x, cur_y)) = cursor {
                    let mut tx = cur_x as f64 + 10.0;
                    let mut ty = cur_y as f64 + 10.0;

                    let max_x = m_pos.x as f64 + m_size.width as f64 - win_w_phys;
                    let max_y = m_pos.y as f64 + m_size.height as f64 - win_h_phys;

                    if tx > max_x {
                        tx = cur_x as f64 - win_w_phys - 10.0;
                        tx_shifted_left = true;
                    }
                    if ty > max_y {
                        ty = cur_y as f64 - win_h_phys - 10.0;
                    }
                    if tx < m_pos.x as f64 {
                        tx = m_pos.x as f64 + 10.0;
                    }
                    if ty < m_pos.y as f64 {
                        ty = m_pos.y as f64 + 10.0;
                    }
                    (tx, ty)
                } else {
                    let tx = m_pos.x as f64 + (m_size.width as f64 - win_w_phys) / 2.0;
                    let ty = m_pos.y as f64 + (m_size.height as f64 - win_h_phys) / 2.0;
                    (tx, ty)
                };

                let pos = tauri::Position::Physical(tauri::PhysicalPosition {
                    x: target_x as i32,
                    y: target_y as i32,
                });
                let _ = window.set_position(pos);
                let _ = window.show();
                let _ = window.set_position(pos); // ensure applied after shown
                let _ = window.set_focus();

                let side = if tx_shifted_left { "left" } else { "right" };
                let _ = app.emit("clipboard-launcher-side", side);
            } else {
                let _ = window.center();
                let _ = window.show();
                let _ = window.set_focus();
                let _ = app.emit("clipboard-launcher-side", "right");
            }
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

fn toggle_timer_widget_internal(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("timer-widget") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            if let Ok(Some(mon)) = w.current_monitor() {
                let size = mon.size();
                let scale = mon.scale_factor();
                let screen_w = size.width as f64 / scale;
                let x = (screen_w - 290.0).max(20.0);
                let y = 30.0;
                let _ = w.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
            }
            let _ = w.show();
        }
    }
    Ok(())
}

fn register_timer_widget_hotkey(app: &AppHandle, shortcut_str: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    let shortcut: Shortcut = shortcut_str
        .parse()
        .map_err(|e| format!("Invalid shortcut: {e}"))?;
    let app_handle = app.clone();

    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = toggle_timer_widget_internal(&app_handle);
            }
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn open_tasks_window_internal(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("manager") {
        let is_vis = window.is_visible().unwrap_or(false);
        let is_min = window.is_minimized().unwrap_or(false);
        let is_foc = window.is_focused().unwrap_or(false);

        if is_vis && !is_min && is_foc {
            let _ = window.minimize();
        } else {
            let _ = window.unminimize();
            if let Ok(size) = window.inner_size() {
                let scale = window.scale_factor().unwrap_or(1.0);
                let log_w = size.width as f64 / scale;
                let log_h = size.height as f64 / scale;
                if log_w < 1100.0 || log_h < 700.0 {
                    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 1300.0, height: 830.0 }));
                    let _ = window.center();
                }
            }
            let _ = window.show();
            let _ = window.set_focus();
            let _ = app.emit("open-task-in-manager", serde_json::json!({ "tab": "tasks" }));
        }
    } else {
        WebviewWindowBuilder::new(
            app,
            "manager",
            WebviewUrl::App("index.html#/manager".into()),
        )
        .title("PasCopyOf - Vault Manager")
        .inner_size(1300.0, 830.0)
        .min_inner_size(1050.0, 650.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(150)).await;
            let _ = app_clone.emit("open-task-in-manager", serde_json::json!({ "tab": "tasks" }));
        });
    }
    Ok(())
}

fn register_tasks_hotkey(app: &AppHandle, shortcut_str: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    let shortcut: Shortcut = shortcut_str
        .parse()
        .map_err(|e| format!("Invalid shortcut: {e}"))?;
    let app_handle = app.clone();

    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = open_tasks_window_internal(&app_handle);
            }
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn show_quick_task_window(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("quick-task") {
        let _ = w.unminimize();
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("quick-task-reset", ());
    } else {
        WebviewWindowBuilder::new(
            app,
            "quick-task",
            WebviewUrl::App("index.html#/quick-task".into()),
        )
        .title("PasCopyOf Quick Task")
        .inner_size(520.0, 260.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(150)).await;
            let _ = app_clone.emit("quick-task-reset", ());
        });
    }
    Ok(())
}

fn hide_quick_task_window(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("quick-task") {
        let _ = w.hide();
    }
    Ok(())
}

fn toggle_quick_task_window(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("quick-task") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = show_quick_task_window(app);
        }
    } else {
        let _ = show_quick_task_window(app);
    }
    Ok(())
}

fn register_quick_task_hotkey(app: &AppHandle, shortcut_str: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    let shortcut: Shortcut = shortcut_str
        .parse()
        .map_err(|e| format!("Invalid shortcut: {e}"))?;
    let app_handle = app.clone();

    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = toggle_quick_task_window(&app_handle);
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

                    let existing_id: Option<i64> = conn.query_row(
                        "SELECT id FROM clipboard_history WHERE content_type = 'files' AND file_paths = ?1 LIMIT 1",
                        params![json_paths],
                        |r| r.get(0),
                    ).ok();

                    if let Some(id) = existing_id {
                        let _ = conn.execute(
                            "UPDATE clipboard_history SET copied_at = datetime('now') WHERE id = ?1",
                            params![id],
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

                        // Check if an image with same dimensions and bytes already exists in recent items
                        let existing_img: Option<(i64, String)> = conn.query_row(
                            "SELECT id, image_path FROM clipboard_history WHERE content_type = 'image' AND image_dimensions = ?1 ORDER BY copied_at DESC LIMIT 1",
                            params![dimensions],
                            |r| Ok((r.get(0)?, r.get(1)?)),
                        ).ok();

                        let is_dup = if let Some((old_id, ref old_path)) = existing_img {
                            if let (Ok(new_b), Ok(old_b)) = (std::fs::read(&path_str), std::fs::read(old_path)) {
                                if new_b == old_b {
                                    let _ = std::fs::remove_file(&path_str);
                                    let _ = conn.execute(
                                        "UPDATE clipboard_history SET copied_at = datetime('now') WHERE id = ?1",
                                        params![old_id],
                                    );
                                    let _ = self.app_handle.emit("clipboard-updated", ());
                                    true
                                } else {
                                    false
                                }
                            } else {
                                false
                            }
                        } else {
                            false
                        };

                        if !is_dup {
                            let _ = conn.execute(
                                "INSERT INTO clipboard_history (content_type, image_path, preview, image_dimensions, copied_at) VALUES ('image', ?1, ?2, ?3, datetime('now'))",
                                params![path_str, preview, dimensions],
                            );
                            prune_clipboard_history(&conn, max_items);
                            let _ = self.app_handle.emit("clipboard-updated", ());
                        }
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
                let existing_id: Option<i64> = conn.query_row(
                    "SELECT id FROM clipboard_history WHERE content_type = 'text' AND text_content = ?1 LIMIT 1",
                    params![text],
                    |r| r.get(0),
                ).ok();

                if let Some(id) = existing_id {
                    let _ = conn.execute(
                        "UPDATE clipboard_history SET copied_at = datetime('now') WHERE id = ?1",
                        params![id],
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
    let open_tasks =
        MenuItem::with_id(app, "open_tasks", "Görevler & Odak Takibi (Tasks)", true, None::<&str>)?;
    let open_manager =
        MenuItem::with_id(app, "open_manager", "Open Manager", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit PasCopyOf", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_launcher, &show_clipboard, &take_screenshot, &open_tasks, &open_manager, &separator, &quit])?;

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
                let _ = show_launcher_window(app);
            }
            "show_clipboard" => {
                let _ = show_clipboard_launcher_window(app);
            }
            "take_screenshot" => {
                let _ = trigger_screenshot_capture(app);
            }
            "open_tasks" => {
                let _ = open_tasks_window_internal(app);
            }
            "open_manager" => {
                if let Some(window) = app.get_webview_window("manager") {
                    let _ = window.unminimize();
                    if let Ok(size) = window.inner_size() {
                        let scale = window.scale_factor().unwrap_or(1.0);
                        let log_w = size.width as f64 / scale;
                        let log_h = size.height as f64 / scale;
                        if log_w < 1100.0 || log_h < 700.0 {
                            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 1300.0, height: 830.0 }));
                            let _ = window.center();
                        }
                    }
                    let _ = window.show();
                    let _ = window.set_focus();
                } else {
                    let _ = WebviewWindowBuilder::new(
                        app,
                        "manager",
                        WebviewUrl::App("index.html#/manager".into()),
                    )
                    .title("PasCopyOf - Vault Manager")
                    .inner_size(1300.0, 830.0)
                    .min_inner_size(1050.0, 650.0)
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
async fn init_vault(
    masterPassword: String,
    passwordHint: Option<String>,
    state: State<'_, SafeAppState>,
) -> Result<String, String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;

    let mut salt_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let salt_hex = hex::encode(salt_bytes);

    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    set_meta(&conn, "salt", &salt_hex).map_err(|e| e.to_string())?;

    let key = derive_key(&masterPassword, &salt_hex).map_err(|e| e.to_string())?;
    let blob = encrypt(&key, VERIFY_MESSAGE).map_err(|e| e.to_string())?;
    set_meta(&conn, "verify", &blob).map_err(|e| e.to_string())?;

    if let Some(hint) = passwordHint {
        let trimmed = hint.trim();
        if !trimmed.is_empty() {
            let _ = set_meta(&conn, "password_hint", trimmed);
        }
    }

    // Generate emergency recovery key
    let recovery_key = generate_recovery_key_string();
    setup_recovery_for_key(&conn, &key, &recovery_key).map_err(|e| e.to_string())?;

    st.encryption_key = Some(key);
    touch_activity(&mut st);
    Ok(recovery_key)
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
) -> Result<Option<String>, String> {
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

    // If recovery was previously configured, rotate/update recovery key with the new master key
    let mut updated_recovery_key: Option<String> = None;
    if get_meta(&conn, "recovery_salt").is_some() {
        let rk = generate_recovery_key_string();
        setup_recovery_for_key(&conn, &new_key, &rk).map_err(|e| e.to_string())?;
        updated_recovery_key = Some(rk);
    }

    st.encryption_key = Some(new_key);
    touch_activity(&mut st);
    Ok(updated_recovery_key)
}

#[tauri::command]
async fn get_password_hint(state: State<'_, SafeAppState>) -> Result<Option<String>, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    Ok(get_meta(&conn, "password_hint"))
}

#[tauri::command]
async fn set_password_hint(hint: Option<String>, state: State<'_, SafeAppState>) -> Result<(), String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    match hint {
        Some(h) if !h.trim().is_empty() => {
            set_meta(&conn, "password_hint", h.trim()).map_err(|e| e.to_string())?;
        }
        _ => {
            let _ = conn.execute("DELETE FROM meta WHERE key = 'password_hint'", []);
        }
    }
    Ok(())
}

#[tauri::command]
async fn has_recovery_key(state: State<'_, SafeAppState>) -> Result<bool, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    Ok(get_meta(&conn, "recovery_salt").is_some() && get_meta(&conn, "recovery_vault_blob").is_some())
}

#[tauri::command]
async fn generate_new_recovery_key(state: State<'_, SafeAppState>) -> Result<String, String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    let key = require_key(&mut st)?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    let recovery_key = generate_recovery_key_string();
    setup_recovery_for_key(&conn, &key, &recovery_key).map_err(|e| e.to_string())?;
    Ok(recovery_key)
}

#[tauri::command]
async fn recover_vault(
    recoveryKey: String,
    newMasterPassword: String,
    state: State<'_, SafeAppState>,
) -> Result<String, String> {
    if newMasterPassword.len() < 8 {
        return Err("Yeni ana parola en az 8 karakter olmalıdır.".into());
    }

    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

    let recovery_salt = get_meta(&conn, "recovery_salt")
        .ok_or_else(|| "Kayıtlı kurtarma anahtarı bulunamadı.".to_string())?;
    let recovery_blob = get_meta(&conn, "recovery_vault_blob")
        .ok_or_else(|| "Kayıtlı kurtarma verisi bulunamadı.".to_string())?;
    let recovery_verify = get_meta(&conn, "recovery_verify");

    let clean_key = clean_recovery_key_str(&recoveryKey);
    if clean_key.len() < 16 {
        return Err("Geçersiz kurtarma anahtarı biçimi.".into());
    }

    let recovery_derived_key = derive_key(&clean_key, &recovery_salt).map_err(|e| e.to_string())?;

    // Verify recovery key
    if let Some(verify_blob) = recovery_verify {
        match decrypt(&recovery_derived_key, &verify_blob) {
            Ok(msg) if msg == VERIFY_MESSAGE => {}
            _ => return Err("Kurtarma anahtarı geçersiz veya hatalı.".into()),
        }
    }

    // Decrypt the original master key
    let original_master_key_hex = decrypt(&recovery_derived_key, &recovery_blob)
        .map_err(|_| "Kurtarma anahtarı geçersiz veya veri çözülemedi.".to_string())?;
    let master_key_bytes = hex::decode(&original_master_key_hex)
        .map_err(|e| format!("Kasa anahtarı çözümlenemedi: {}", e))?;
    if master_key_bytes.len() != 32 {
        return Err("Geçersiz kasa anahtarı boyutu.".into());
    }
    let mut old_key = [0u8; 32];
    old_key.copy_from_slice(&master_key_bytes);

    // Derive new key from newMasterPassword
    let mut salt_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let new_salt_hex = hex::encode(salt_bytes);
    let new_key = derive_key(&newMasterPassword, &new_salt_hex).map_err(|e| e.to_string())?;

    // Re-encrypt all credentials with new_key
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

    // Generate brand new recovery key for the new master key
    let new_recovery_key = generate_recovery_key_string();
    setup_recovery_for_key(&conn, &new_key, &new_recovery_key).map_err(|e| e.to_string())?;

    st.encryption_key = Some(new_key);
    touch_activity(&mut st);

    Ok(new_recovery_key)
}

#[tauri::command]
async fn reset_vault(
    confirmText: String,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let normalized = confirmText.trim().to_uppercase();
    if normalized != "SIFIRLA" && normalized != "RESET" {
        return Err("Onaylamak için lütfen 'SIFIRLA' veya 'RESET' yazın.".into());
    }

    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM credentials", []).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM categories", []).map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM meta WHERE key IN ('salt', 'verify', 'recovery_salt', 'recovery_vault_blob', 'recovery_verify', 'recovery_created_at', 'password_hint')",
        [],
    ).map_err(|e| e.to_string())?;

    st.encryption_key = None;
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
async fn get_clipboard_clear_seconds(state: State<'_, SafeAppState>) -> Result<u64, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    Ok(st.clipboard_clear_seconds)
}

#[tauri::command]
async fn set_clipboard_clear_seconds(seconds: u64, state: State<'_, SafeAppState>) -> Result<(), String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    set_meta(&conn, "clipboard_clear_seconds", &seconds.to_string()).map_err(|e| e.to_string())?;
    st.clipboard_clear_seconds = seconds;
    if seconds == 0 {
        if let Some(handle) = st.clipboard_clear_handle.take() {
            handle.abort();
        }
    }
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

    let auto_paste = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.auto_paste_on_select
    };
    if auto_paste {
        if let Some(window) = app.get_webview_window("launcher") {
            let _ = window.hide();
        }
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(150)).await;
            win_paste::simulate_paste();
        });
    }

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

    let auto_paste = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.auto_paste_on_select
    };
    if auto_paste {
        if let Some(window) = app.get_webview_window("launcher") {
            let _ = window.hide();
        }
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(150)).await;
            win_paste::simulate_paste();
        });
    }

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
    app: AppHandle,
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
    let id = conn.last_insert_rowid();
    let _ = app.emit("vault-updated", ());
    Ok(id)
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
    show_launcher_window(&app)
}

#[tauri::command]
async fn hide_launcher(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("launcher") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn open_manager(app: AppHandle, task_id: Option<i64>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("manager") {
        let _ = window.unminimize();
        if let Ok(size) = window.inner_size() {
            let scale = window.scale_factor().unwrap_or(1.0);
            let log_w = size.width as f64 / scale;
            let log_h = size.height as f64 / scale;
            if log_w < 1100.0 || log_h < 700.0 {
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 1300.0, height: 830.0 }));
                let _ = window.center();
            }
        }
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        WebviewWindowBuilder::new(
            &app,
            "manager",
            WebviewUrl::App("index.html#/manager".into()),
        )
        .title("PasCopyOf - Vault Manager")
        .inner_size(1300.0, 830.0)
        .min_inner_size(1050.0, 650.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    }

    if let Some(tid) = task_id {
        let _ = app.emit("open-task-in-manager", serde_json::json!({ "taskId": tid }));
    }

    Ok(())
}

#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
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

#[tauri::command]
async fn save_recovery_key_file(
    app: AppHandle,
    path: Option<String>,
    key: String,
) -> Result<String, String> {
    let target_path = match path {
        Some(p) if !p.trim().is_empty() => std::path::PathBuf::from(p),
        _ => {
            let base_dir = app
                .path()
                .download_dir()
                .or_else(|_| app.path().desktop_dir())
                .or_else(|_| app.path().document_dir())
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let date = chrono::Local::now().format("%Y-%m-%d").to_string();
            base_dir.join(format!("pascopyof-recovery-key-{}.txt", date))
        }
    };

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let content = format!(
"=====================================================
PasCopyOf - Acil Durum Kurtarma Anahtari (Emergency Recovery Kit)
Tarih: {}
=====================================================

Kurtarma Anahtariniz (Recovery Key):
{}

ONEMLI GUVENLIK BILGISI:
Bu anahtar, PasCopyOf kasanizin ana sifresini unuttugunuzda
verilerinizi sifir veri kaybi ile kurtarabilmenizi saglayan TEK anahtardir.
Lutfen bu dosyayi guvenli bir USB bellege, harici diske
veya parola yoneticinize kaydedin.
=====================================================",
        now, key
    );

    std::fs::write(&target_path, content.as_bytes())
        .map_err(|e| format!("Dosya kaydedilemedi: {}", e))?;

    Ok(target_path.to_string_lossy().to_string())
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
    let (db_path, default_limit, image_cache) = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        (st.db_path.clone(), st.clipboard_page_size, Arc::clone(&st.clipboard_image_cache))
    };

    let take_limit = limit.unwrap_or(default_limit).max(1);
    let conn = open_db(&db_path).map_err(|e| e.to_string())?;

    let q = query.trim();
    let filter = filter_type.as_deref().unwrap_or("all");

    let mut sql = "SELECT id, content_type, text_content, image_path, file_paths, preview, char_count, file_count, image_dimensions, copied_at, is_pinned FROM clipboard_history WHERE 1=1".to_string();

    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if !q.is_empty() {
        sql.push_str(" AND (preview LIKE ? OR text_content LIKE ? OR file_paths LIKE ?)");
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
                    let mut cache = image_cache.lock().unwrap();
                    if let Some(cached) = cache.get(path) {
                        Some(cached.clone())
                    } else if let Ok(bytes) = std::fs::read(path) {
                        let data = format!("data:image/png;base64,{}", B64.encode(&bytes));
                        if cache.len() > 150 {
                            cache.clear();
                        }
                        cache.insert(path.clone(), data.clone());
                        Some(data)
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
                let img_res = RustImageData::from_path(&path).or_else(|_| {
                    image::open(&path)
                        .map(RustImageData::from_dynamic_image)
                        .map_err(|e| e.to_string())
                });
                if let Ok(img) = img_res {
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

    let auto_paste = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.auto_paste_on_select
    };
    if auto_paste {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(150)).await;
            win_paste::simulate_paste();
        });
    }

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
        let _ = std::fs::remove_file(&path);
        if let Ok(st) = state.0.lock() {
            if let Ok(mut cache) = st.clipboard_image_cache.lock() {
                cache.remove(&path);
            }
        }
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
    if let Ok(st) = state.0.lock() {
        if let Ok(mut cache) = st.clipboard_image_cache.lock() {
            cache.clear();
        }
    }
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
        auto_paste_on_select: st.auto_paste_on_select,
        window_mode: st.clipboard_window_mode.clone(),
        close_on_blur: st.clipboard_close_on_blur,
        close_on_space: st.clipboard_close_on_space,
        clear_search_on_open: st.clipboard_clear_search_on_open,
        panel_scale: st.panel_scale.clone(),
    })
}

#[tauri::command]
async fn update_clipboard_settings(
    page_size: u32,
    lock_with_vault: bool,
    enabled: bool,
    preview_delay_ms: Option<u32>,
    auto_paste_on_select: Option<bool>,
    window_mode: Option<String>,
    close_on_blur: Option<bool>,
    close_on_space: Option<bool>,
    clear_search_on_open: Option<bool>,
    panel_scale: Option<String>,
    app: AppHandle,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let delay = preview_delay_ms.unwrap_or(2000);
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    st.clipboard_page_size = page_size;
    st.clipboard_lock_with_vault = lock_with_vault;
    st.clipboard_enabled = enabled;
    st.clipboard_preview_delay_ms = delay;
    if let Some(auto) = auto_paste_on_select {
        st.auto_paste_on_select = auto;
    }
    if let Some(ref mode) = window_mode {
        st.clipboard_window_mode = mode.clone();
    }
    if let Some(cob) = close_on_blur {
        st.clipboard_close_on_blur = cob;
    }
    if let Some(cos) = close_on_space {
        st.clipboard_close_on_space = cos;
    }
    if let Some(cso) = clear_search_on_open {
        st.clipboard_clear_search_on_open = cso;
    }
    if let Some(ref ps) = panel_scale {
        st.panel_scale = ps.clone();
    }

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
    if let Some(auto) = auto_paste_on_select {
        set_meta(
            &conn,
            "auto_paste_on_select",
            if auto { "1" } else { "0" },
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(ref mode) = window_mode {
        set_meta(&conn, "clipboard_window_mode", mode).map_err(|e| e.to_string())?;
    }
    if let Some(cob) = close_on_blur {
        set_meta(&conn, "clipboard_close_on_blur", if cob { "1" } else { "0" }).map_err(|e| e.to_string())?;
    }
    if let Some(cos) = close_on_space {
        set_meta(&conn, "clipboard_close_on_space", if cos { "1" } else { "0" }).map_err(|e| e.to_string())?;
    }
    if let Some(cso) = clear_search_on_open {
        set_meta(&conn, "clipboard_clear_search_on_open", if cso { "1" } else { "0" }).map_err(|e| e.to_string())?;
    }
    if let Some(ref ps) = panel_scale {
        set_meta(&conn, "panel_scale", ps).map_err(|e| e.to_string())?;
    }

    // Live update window if clipboard-launcher exists
    if let Some(ref mode) = window_mode {
        if let Some(window) = app.get_webview_window("clipboard-launcher") {
            let cursor = get_screen_cursor_pos()
                .or_else(|| app.cursor_position().ok().map(|p| (p.x as i32, p.y as i32)));
            let monitor = get_monitor_for_cursor(&app, cursor);

            if mode == "fullscreen" {
                let _ = window.unmaximize();
                if let Some(ref m) = monitor {
                    let m_pos = m.position();
                    let m_size = m.size();
                    let _ = window.set_position(tauri::Position::Physical(*m_pos));
                    let _ = window.set_size(tauri::Size::Physical(*m_size));
                } else {
                    let _ = window.maximize();
                }
            } else {
                let _ = window.unmaximize();
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: 960.0,
                    height: 540.0,
                }));
            }
        }
    }
    let _ = app.emit("clipboard-settings-updated", ());

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

    let (show_notif, auto_paste) = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        (st.screenshot_notification_enabled, st.auto_paste_on_select)
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

    if auto_paste {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(150)).await;
            win_paste::simulate_paste();
        });
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

fn get_default_screenshot_dir(app: &AppHandle) -> PathBuf {
    if let Ok(pic_dir) = app.path().picture_dir() {
        pic_dir.join("PasCopyOf")
    } else if let Ok(user_profile) = std::env::var("USERPROFILE") {
        PathBuf::from(user_profile).join("Pictures").join("PasCopyOf")
    } else if let Ok(data_dir) = app.path().app_data_dir() {
        data_dir.join("Screenshots")
    } else {
        PathBuf::from("C:\\PasCopyOf_Screenshots")
    }
}

#[tauri::command]
async fn save_annotated_image(
    app: AppHandle,
    state: State<'_, SafeAppState>,
    base64_png: String,
    default_filename: Option<String>,
) -> Result<Option<String>, String> {
    let bytes = decode_base64_png(&base64_png)?;
    let (save_dir_str, notify_enabled) = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        (st.screenshot_save_dir.clone(), st.screenshot_notification_enabled)
    };

    let target_dir = if save_dir_str.trim().is_empty() {
        get_default_screenshot_dir(&app)
    } else {
        PathBuf::from(&save_dir_str)
    };

    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Kayıt dizini oluşturulamadı ({}): {}", target_dir.display(), e))?;

    let now = chrono::Local::now();
    let base_stem = default_filename
        .map(|f| f.trim_end_matches(".png").to_string())
        .unwrap_or_else(|| format!("PasCopyOf_Screenshot_{}", now.format("%Y%m%d_%H%M%S")));

    let mut final_path = target_dir.join(format!("{}.png", base_stem));
    let mut counter = 1u32;
    while final_path.exists() {
        final_path = target_dir.join(format!("{}_{}.png", base_stem, counter));
        counter += 1;
    }

    std::fs::write(&final_path, &bytes)
        .map_err(|e| format!("Dosya kaydedilemedi: {}", e))?;

    let saved_str = final_path.to_string_lossy().to_string();

    if notify_enabled {
        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title("PasCopyOf — Ekran Görüntüsü Kaydedildi")
            .body(format!("✓ Kaydedildi:\n{}", saved_str))
            .show();
    }

    Ok(Some(saved_str))
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
        save_dir: st.screenshot_save_dir.clone(),
        default_save_dir: st.default_screenshot_save_dir.clone(),
    })
}

#[tauri::command]
async fn update_screenshot_settings(
    notification_enabled: bool,
    save_dir: Option<String>,
    state: State<'_, SafeAppState>,
) -> Result<ScreenshotSettings, String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    st.screenshot_notification_enabled = notification_enabled;
    if let Some(dir) = save_dir {
        let trimmed = dir.trim();
        let next_dir = if trimmed.is_empty() {
            st.default_screenshot_save_dir.clone()
        } else {
            trimmed.to_string()
        };
        let _ = std::fs::create_dir_all(&next_dir);
        st.screenshot_save_dir = next_dir;
    }
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    set_meta(
        &conn,
        "screenshot_notification_enabled",
        if notification_enabled { "1" } else { "0" },
    )
    .map_err(|e| e.to_string())?;
    set_meta(&conn, "screenshot_save_dir", &st.screenshot_save_dir)
        .map_err(|e| e.to_string())?;

    Ok(ScreenshotSettings {
        shortcut: st.screenshot_shortcut.clone(),
        notification_enabled: st.screenshot_notification_enabled,
        save_dir: st.screenshot_save_dir.clone(),
        default_save_dir: st.default_screenshot_save_dir.clone(),
    })
}

#[tauri::command]
async fn pick_screenshot_folder(
    app: AppHandle,
    state: State<'_, SafeAppState>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let current_dir = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.screenshot_save_dir.clone()
    };

    let mut builder = app.dialog().file().set_title("Ekran Görüntüsü Kayıt Klasörünü Seçin");
    let cur_path = PathBuf::from(&current_dir);
    if cur_path.exists() {
        builder = builder.set_directory(cur_path);
    }

    let picked = builder.blocking_pick_folder();
    if let Some(folder) = picked {
        if let Some(p) = folder.as_path() {
            let path_str = p.to_string_lossy().to_string();
            let _ = std::fs::create_dir_all(p);
            let mut st = state.0.lock().map_err(|e| e.to_string())?;
            st.screenshot_save_dir = path_str.clone();
            let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
            set_meta(&conn, "screenshot_save_dir", &path_str).map_err(|e| e.to_string())?;
            return Ok(Some(path_str));
        }
    }
    Ok(None)
}

#[tauri::command]
async fn open_screenshot_folder(
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let dir = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.screenshot_save_dir.clone()
    };
    let p = PathBuf::from(&dir);
    let _ = std::fs::create_dir_all(&p);
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg(&p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
mod win_paste {
    #[link(name = "user32")]
    extern "system" {
        fn keybd_event(b_vk: u8, b_scan: u8, dw_flags: u32, dw_extra_info: usize);
    }

    const VK_CONTROL: u8 = 0x11;
    const VK_V: u8 = 0x56;
    const KEYEVENTF_KEYUP: u32 = 0x0002;

    pub fn simulate_paste() {
        unsafe {
            // VK_CONTROL scan code is 0x1D, VK_V scan code is 0x2F
            keybd_event(VK_CONTROL, 0x1D, 0, 0);
            std::thread::sleep(std::time::Duration::from_millis(15));
            keybd_event(VK_V, 0x2F, 0, 0);
            std::thread::sleep(std::time::Duration::from_millis(25));
            keybd_event(VK_V, 0x2F, KEYEVENTF_KEYUP, 0);
            std::thread::sleep(std::time::Duration::from_millis(15));
            keybd_event(VK_CONTROL, 0x1D, KEYEVENTF_KEYUP, 0);
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod win_paste {
    pub fn simulate_paste() {}
}

#[tauri::command]
async fn trigger_auto_paste() -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(150)).await;
        win_paste::simulate_paste();
    });
    Ok(())
}

// ─── System Idle & Screen Lock Detection ────────────────────────────────────

#[cfg(target_os = "windows")]
fn get_system_idle_seconds() -> u64 {
    #[repr(C)]
    struct LASTINPUTINFO {
        cb_size: u32,
        dw_time: u32,
    }
    #[link(name = "user32")]
    extern "system" {
        fn GetLastInputInfo(plii: *mut LASTINPUTINFO) -> i32;
        fn GetTickCount() -> u32;
    }
    unsafe {
        let mut lii = LASTINPUTINFO {
            cb_size: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dw_time: 0,
        };
        if GetLastInputInfo(&mut lii) != 0 {
            let tc = GetTickCount();
            if tc >= lii.dw_time {
                ((tc - lii.dw_time) / 1000) as u64
            } else {
                0
            }
        } else {
            0
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn get_system_idle_seconds() -> u64 {
    0
}

#[cfg(target_os = "windows")]
fn is_system_locked() -> bool {
    #[link(name = "user32")]
    extern "system" {
        fn OpenInputDesktop(dw_flags: u32, f_inherit: i32, dw_desired_access: u32) -> isize;
        fn CloseDesktop(h_desktop: isize) -> i32;
    }
    const DESKTOP_SWITCHDESKTOP: u32 = 0x0100;
    unsafe {
        let desk = OpenInputDesktop(0, 0, DESKTOP_SWITCHDESKTOP);
        if desk == 0 {
            true
        } else {
            CloseDesktop(desk);
            false
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn is_system_locked() -> bool {
    false
}

// ─── Task & Focus Management Helpers & Commands ─────────────────────────────

fn get_task_by_id(conn: &Connection, task_id: i64) -> Result<TaskItem, String> {
    let query = "SELECT
            t.id,
            t.title,
            t.notes,
            t.status,
            t.priority,
            t.category,
            t.is_routine,
            t.routine_schedule,
            t.created_at,
            t.updated_at,
            t.completed_at,
            COALESCE((
                SELECT SUM(
                    CASE 
                        WHEN w.end_time IS NOT NULL THEN w.duration_seconds
                        ELSE MAX(0, CAST(strftime('%s', 'now', 'localtime') - strftime('%s', w.start_time) AS INTEGER))
                    END
                )
                FROM task_worklogs w
                WHERE w.task_id = t.id
            ), 0) AS total_duration_seconds,
            (SELECT COUNT(*) FROM task_checklists c WHERE c.task_id = t.id) AS checklist_count,
            (SELECT COUNT(*) FROM task_checklists c WHERE c.task_id = t.id AND c.is_done = 1) AS checklist_done_count,
            EXISTS (SELECT 1 FROM task_worklogs w WHERE w.task_id = t.id AND w.end_time IS NULL) AS is_timer_running
        FROM tasks t
        WHERE t.id = ?1";
    conn.query_row(query, params![task_id], |row| {
        let is_routine_i: i64 = row.get(6)?;
        let is_timer_running_i: i64 = row.get(14)?;
        Ok(TaskItem {
            id: row.get(0)?,
            title: row.get(1)?,
            notes: row.get(2)?,
            status: row.get(3)?,
            priority: row.get(4)?,
            category: row.get(5)?,
            is_routine: is_routine_i != 0,
            routine_schedule: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
            completed_at: row.get(10)?,
            total_duration_seconds: row.get(11)?,
            checklist_count: row.get(12)?,
            checklist_done_count: row.get(13)?,
            is_timer_running: is_timer_running_i != 0,
        })
    }).map_err(|e| e.to_string())
}

fn stop_running_timers(conn: &Connection, task_id: Option<i64>) -> Result<(), String> {
    if let Some(tid) = task_id {
        conn.execute(
            "UPDATE task_worklogs
             SET end_time = datetime('now', 'localtime'),
                 duration_seconds = MAX(0, CAST(strftime('%s', 'now', 'localtime') - strftime('%s', start_time) AS INTEGER))
             WHERE task_id = ?1 AND end_time IS NULL",
            params![tid],
        ).map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE task_worklogs
             SET end_time = datetime('now', 'localtime'),
                 duration_seconds = MAX(0, CAST(strftime('%s', 'now', 'localtime') - strftime('%s', start_time) AS INTEGER))
             WHERE end_time IS NULL",
            [],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn get_tasks(
    state: State<'_, SafeAppState>,
    filter_status: Option<String>,
    search: Option<String>,
) -> Result<Vec<TaskItem>, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

    let mut query = String::from(
        "SELECT
            t.id,
            t.title,
            t.notes,
            t.status,
            t.priority,
            t.category,
            t.is_routine,
            t.routine_schedule,
            t.created_at,
            t.updated_at,
            t.completed_at,
            COALESCE((
                SELECT SUM(
                    CASE 
                        WHEN w.end_time IS NOT NULL THEN w.duration_seconds
                        ELSE MAX(0, CAST(strftime('%s', 'now', 'localtime') - strftime('%s', w.start_time) AS INTEGER))
                    END
                )
                FROM task_worklogs w
                WHERE w.task_id = t.id
            ), 0) AS total_duration_seconds,
            (SELECT COUNT(*) FROM task_checklists c WHERE c.task_id = t.id) AS checklist_count,
            (SELECT COUNT(*) FROM task_checklists c WHERE c.task_id = t.id AND c.is_done = 1) AS checklist_done_count,
            EXISTS (SELECT 1 FROM task_worklogs w WHERE w.task_id = t.id AND w.end_time IS NULL) AS is_timer_running
        FROM tasks t
        WHERE 1=1"
    );

    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(ref st_filter) = filter_status {
        if !st_filter.is_empty() && st_filter != "all" {
            query.push_str(" AND t.status = ?");
            params_vec.push(Box::new(st_filter.clone()));
        }
    }

    if let Some(ref q) = search {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            query.push_str(" AND (t.title LIKE ? OR t.notes LIKE ? OR t.category LIKE ?)");
            let pattern = format!("%{}%", trimmed);
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern));
        }
    }

    query.push_str(" ORDER BY
        CASE t.status WHEN 'in_progress' THEN 1 WHEN 'todo' THEN 2 ELSE 3 END,
        CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        t.created_at DESC");

    let params_slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_slice.as_slice(), |row| {
            let is_routine_i: i64 = row.get(6)?;
            let is_timer_running_i: i64 = row.get(14)?;
            Ok(TaskItem {
                id: row.get(0)?,
                title: row.get(1)?,
                notes: row.get(2)?,
                status: row.get(3)?,
                priority: row.get(4)?,
                category: row.get(5)?,
                is_routine: is_routine_i != 0,
                routine_schedule: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                completed_at: row.get(10)?,
                total_duration_seconds: row.get(11)?,
                checklist_count: row.get(12)?,
                checklist_done_count: row.get(13)?,
                is_timer_running: is_timer_running_i != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
async fn create_task(
    app: AppHandle,
    state: State<'_, SafeAppState>,
    title: String,
    notes: Option<String>,
    priority: Option<String>,
    category: Option<String>,
    is_routine: Option<bool>,
    routine_schedule: Option<String>,
) -> Result<TaskItem, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

    let notes_val = notes.unwrap_or_default();
    let priority_val = priority.unwrap_or_else(|| "medium".to_string());
    let category_val = category.unwrap_or_default();
    let is_routine_val = if is_routine.unwrap_or(false) { 1 } else { 0 };
    let routine_sched_val = routine_schedule.unwrap_or_default();

    conn.execute(
        "INSERT INTO tasks (title, notes, status, priority, category, is_routine, routine_schedule, created_at, updated_at)
         VALUES (?1, ?2, 'todo', ?3, ?4, ?5, ?6, datetime('now', 'localtime'), datetime('now', 'localtime'))",
        params![
            title.trim(),
            notes_val,
            priority_val,
            category_val,
            is_routine_val,
            routine_sched_val,
        ],
    ).map_err(|e| e.to_string())?;

    let last_id = conn.last_insert_rowid();
    let task = get_task_by_id(&conn, last_id)?;
    let _ = app.emit("tasks-changed", ());
    Ok(task)
}

#[tauri::command]
async fn update_task(
    app: AppHandle,
    state: State<'_, SafeAppState>,
    id: i64,
    title: String,
    notes: String,
    status: String,
    priority: String,
    category: String,
    is_routine: bool,
    routine_schedule: String,
) -> Result<TaskItem, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

    let completed_at_update = if status == "done" {
        "completed_at = COALESCE(completed_at, datetime('now', 'localtime')),"
    } else {
        "completed_at = NULL,"
    };

    let sql = format!(
        "UPDATE tasks SET
            title = ?1,
            notes = ?2,
            status = ?3,
            priority = ?4,
            category = ?5,
            is_routine = ?6,
            routine_schedule = ?7,
            {}
            updated_at = datetime('now', 'localtime')
         WHERE id = ?8",
        completed_at_update
    );

    conn.execute(
        &sql,
        params![
            title.trim(),
            notes,
            status,
            priority,
            category,
            if is_routine { 1 } else { 0 },
            routine_schedule,
            id,
        ],
    ).map_err(|e| e.to_string())?;

    if status == "done" {
        let _ = stop_running_timers(&conn, Some(id));
        let _ = app.emit("timer-stopped", Some(id));
    }

    let task = get_task_by_id(&conn, id)?;
    let _ = app.emit("task-updated", &task);
    let _ = app.emit("tasks-changed", ());
    Ok(task)
}

#[tauri::command]
async fn delete_task(app: AppHandle, state: State<'_, SafeAppState>, id: i64) -> Result<(), String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM task_checklists WHERE task_id = ?1", params![id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM task_worklogs WHERE task_id = ?1", params![id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    let _ = app.emit("tasks-changed", ());
    let _ = app.emit("timer-stopped", Some(id));
    Ok(())
}

#[tauri::command]
async fn toggle_task_status(
    app: AppHandle,
    state: State<'_, SafeAppState>,
    id: i64,
) -> Result<TaskItem, String> {
    let task = {
        let mut st = state.0.lock().map_err(|e| e.to_string())?;
        if let Some((paused_id, _)) = st.active_timer_auto_paused {
            if paused_id == id {
                st.active_timer_auto_paused = None;
            }
        }
        let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

        let cur_status: String = conn.query_row(
            "SELECT status FROM tasks WHERE id = ?1",
            params![id],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;

        let next_status = if cur_status == "done" { "todo" } else { "done" };
        if next_status == "done" {
            let _ = stop_running_timers(&conn, Some(id));
            conn.execute(
                "UPDATE tasks SET status = 'done', completed_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime') WHERE id = ?1",
                params![id],
            ).map_err(|e| e.to_string())?;
        } else {
            conn.execute(
                "UPDATE tasks SET status = 'todo', completed_at = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?1",
                params![id],
            ).map_err(|e| e.to_string())?;
        }

        get_task_by_id(&conn, id)?
    };

    let _ = app.emit("task-updated", &task);
    let _ = app.emit("tasks-changed", ());
    if task.status == "done" {
        let _ = app.emit("timer-stopped", Some(id));
    }
    Ok(task)
}

#[tauri::command]
async fn start_task_timer(
    app: AppHandle,
    state: State<'_, SafeAppState>,
    task_id: i64,
) -> Result<ActiveTimerInfo, String> {
    let (worklog_id, task_title, start_time) = {
        let mut st = state.0.lock().map_err(|e| e.to_string())?;
        st.active_timer_auto_paused = None;
        let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

        // 1. Stop any currently running timers
        stop_running_timers(&conn, None)?;

        // 2. Set task status to in_progress if currently todo
        conn.execute(
            "UPDATE tasks SET status = 'in_progress', updated_at = datetime('now', 'localtime') WHERE id = ?1 AND status = 'todo'",
            params![task_id],
        ).map_err(|e| e.to_string())?;

        // 3. Insert new worklog entry
        conn.execute(
            "INSERT INTO task_worklogs (task_id, start_time, end_time, duration_seconds, note)
             VALUES (?1, datetime('now', 'localtime'), NULL, 0, '')",
            params![task_id],
        ).map_err(|e| e.to_string())?;

        let wid = conn.last_insert_rowid();
        let title: String = conn.query_row(
            "SELECT title FROM tasks WHERE id = ?1",
            params![task_id],
            |row| row.get(0),
        ).unwrap_or_else(|_| "Görev".to_string());

        let stime: String = conn.query_row(
            "SELECT start_time FROM task_worklogs WHERE id = ?1",
            params![wid],
            |row| row.get(0),
        ).unwrap_or_default();

        (wid, title, stime)
    };

    let info = ActiveTimerInfo {
        worklog_id,
        task_id,
        task_title,
        start_time,
        elapsed_seconds: 0,
    };

    let _ = show_timer_widget(app.clone()).await;
    let _ = app.emit("timer-started", &info);
    let _ = app.emit("tasks-changed", ());

    Ok(info)
}

#[tauri::command]
async fn stop_task_timer(
    app: AppHandle,
    state: State<'_, SafeAppState>,
    task_id: Option<i64>,
) -> Result<(), String> {
    {
        let mut st = state.0.lock().map_err(|e| e.to_string())?;
        st.active_timer_auto_paused = None;
        let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
        stop_running_timers(&conn, task_id)?;
    }
    let _ = app.emit("timer-stopped", task_id);
    let _ = app.emit("tasks-changed", ());
    Ok(())
}

#[tauri::command]
async fn show_timer_widget(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("timer-widget") {
        if let Ok(Some(mon)) = w.current_monitor() {
            let size = mon.size();
            let scale = mon.scale_factor();
            let screen_w = size.width as f64 / scale;
            let x = (screen_w - 290.0).max(20.0);
            let y = 30.0;
            let _ = w.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
        }
        let _ = w.show();
    }
    Ok(())
}

#[tauri::command]
async fn hide_timer_widget(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("timer-widget") {
        let _ = w.hide();
    }
    Ok(())
}

#[tauri::command]
async fn toggle_timer_widget(app: AppHandle) -> Result<(), String> {
    toggle_timer_widget_internal(&app)
}

#[tauri::command]
async fn complete_active_task(
    app: AppHandle,
    state: State<'_, SafeAppState>,
) -> Result<Option<TaskItem>, String> {
    let task_opt = {
        let mut st = state.0.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

        // 1. Check running timer worklog
        let running_id: Option<i64> = conn.query_row(
            "SELECT task_id FROM task_worklogs WHERE end_time IS NULL ORDER BY start_time DESC LIMIT 1",
            [],
            |r| r.get(0),
        ).ok();

        let target_id = running_id
            .or_else(|| st.active_timer_auto_paused.as_ref().map(|(tid, _)| *tid))
            .or_else(|| {
                conn.query_row(
                    "SELECT id FROM tasks WHERE status != 'done' ORDER BY CASE status WHEN 'in_progress' THEN 1 ELSE 2 END, updated_at DESC LIMIT 1",
                    [],
                    |r| r.get(0),
                ).ok()
            });

        if let Some(tid) = target_id {
            st.active_timer_auto_paused = None;
            let _ = stop_running_timers(&conn, Some(tid));
            conn.execute(
                "UPDATE tasks SET status = 'done', completed_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime') WHERE id = ?1",
                params![tid],
            ).map_err(|e| e.to_string())?;
            Some(get_task_by_id(&conn, tid)?)
        } else {
            None
        }
    };

    if let Some(ref task) = task_opt {
        let _ = app.emit("task-updated", task);
        let _ = app.emit("tasks-changed", ());
        let _ = app.emit("timer-stopped", task.id);
        if let Some(w) = app.get_webview_window("timer-widget") {
            let _ = w.hide();
        }
    }

    Ok(task_opt)
}

#[tauri::command]
async fn toggle_active_task_timer(
    app: AppHandle,
    state: State<'_, SafeAppState>,
) -> Result<Option<ActiveTimerInfo>, String> {
    let result = {
        let mut st = state.0.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

        let running_id: Option<i64> = conn.query_row(
            "SELECT task_id FROM task_worklogs WHERE end_time IS NULL ORDER BY start_time DESC LIMIT 1",
            [],
            |r| r.get(0),
        ).ok();

        if let Some(tid) = running_id {
            // Stop / Pause
            st.active_timer_auto_paused = None;
            let _ = stop_running_timers(&conn, Some(tid));
            None
        } else {
            // Resume / Start
            let target_id = st.active_timer_auto_paused.as_ref().map(|(tid, _)| *tid)
                .or_else(|| {
                    conn.query_row(
                        "SELECT id FROM tasks WHERE status != 'done' ORDER BY CASE status WHEN 'in_progress' THEN 1 ELSE 2 END, updated_at DESC LIMIT 1",
                        [],
                        |r| r.get(0),
                    ).ok()
                });

            if let Some(tid) = target_id {
                st.active_timer_auto_paused = None;
                let _ = conn.execute(
                    "UPDATE tasks SET status = 'in_progress', updated_at = datetime('now', 'localtime') WHERE id = ?1",
                    params![tid],
                );
                let _ = conn.execute(
                    "INSERT INTO task_worklogs (task_id, start_time) VALUES (?1, datetime('now', 'localtime'))",
                    params![tid],
                );
                let wid = conn.last_insert_rowid();
                let title = get_task_by_id(&conn, tid).map(|t| t.title).unwrap_or_default();
                let stime: String = conn.query_row(
                    "SELECT start_time FROM task_worklogs WHERE id = ?1",
                    params![wid],
                    |row| row.get(0),
                ).unwrap_or_default();

                Some(ActiveTimerInfo {
                    worklog_id: wid,
                    task_id: tid,
                    task_title: title,
                    start_time: stime,
                    elapsed_seconds: 0,
                })
            } else {
                None
            }
        }
    };

    if let Some(ref info) = result {
        let _ = show_timer_widget(app.clone()).await;
        let _ = app.emit("timer-started", info);
    } else {
        let _ = app.emit("timer-stopped", serde_json::Value::Null);
    }
    let _ = app.emit("tasks-changed", ());

    Ok(result)
}

#[tauri::command]
async fn get_timer_widget_shortcut(state: State<'_, SafeAppState>) -> Result<String, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    Ok(st.timer_widget_shortcut.clone())
}

#[tauri::command]
async fn set_timer_widget_shortcut(
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
        st.timer_widget_shortcut.clone()
    };
    if shortcut == old_shortcut {
        return Ok(());
    }
    if let Ok(old) = old_shortcut.parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(old);
    }
    if let Err(err) = register_timer_widget_hotkey(&app, &shortcut) {
        let _ = register_timer_widget_hotkey(&app, &old_shortcut);
        return Err(err);
    }

    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    set_meta(&conn, "timer_widget_shortcut", &shortcut).map_err(|e| e.to_string())?;
    st.timer_widget_shortcut = shortcut;
    Ok(())
}

#[tauri::command]
async fn open_tasks_window(app: AppHandle) -> Result<(), String> {
    open_tasks_window_internal(&app)
}

#[tauri::command]
async fn get_tasks_shortcut(state: State<'_, SafeAppState>) -> Result<String, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    Ok(st.tasks_shortcut.clone())
}

#[tauri::command]
async fn set_tasks_shortcut(
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
        st.tasks_shortcut.clone()
    };
    if shortcut == old_shortcut {
        return Ok(());
    }
    if let Ok(old) = old_shortcut.parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(old);
    }
    if let Err(err) = register_tasks_hotkey(&app, &shortcut) {
        let _ = register_tasks_hotkey(&app, &old_shortcut);
        return Err(err);
    }

    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    set_meta(&conn, "tasks_shortcut", &shortcut).map_err(|e| e.to_string())?;
    st.tasks_shortcut = shortcut;
    Ok(())
}

#[tauri::command]
async fn show_quick_task(app: AppHandle) -> Result<(), String> {
    show_quick_task_window(&app)
}

#[tauri::command]
async fn hide_quick_task(app: AppHandle) -> Result<(), String> {
    hide_quick_task_window(&app)
}

#[tauri::command]
async fn toggle_quick_task(app: AppHandle) -> Result<(), String> {
    toggle_quick_task_window(&app)
}

#[tauri::command]
async fn get_quick_task_shortcut(state: State<'_, SafeAppState>) -> Result<String, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    Ok(st.quick_task_shortcut.clone())
}

#[tauri::command]
async fn set_quick_task_shortcut(
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
        st.quick_task_shortcut.clone()
    };
    if shortcut == old_shortcut {
        return Ok(());
    }
    if let Ok(old) = old_shortcut.parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(old);
    }
    if let Err(err) = register_quick_task_hotkey(&app, &shortcut) {
        let _ = register_quick_task_hotkey(&app, &old_shortcut);
        return Err(err);
    }

    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    set_meta(&conn, "quick_task_shortcut", &shortcut).map_err(|e| e.to_string())?;
    st.quick_task_shortcut = shortcut;
    Ok(())
}

#[tauri::command]
async fn get_timer_status(
    state: State<'_, SafeAppState>,
) -> Result<TimerStatusInfo, String> {
    let (auto_paused, db_path) = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        (st.active_timer_auto_paused.clone(), st.db_path.clone())
    };

    let active_timer = {
        let conn = open_db(&db_path).map_err(|e| e.to_string())?;
        let query = "SELECT w.id, w.task_id, t.title, w.start_time,
                            MAX(0, CAST(strftime('%s', 'now', 'localtime') - strftime('%s', w.start_time) AS INTEGER)) as elapsed
                     FROM task_worklogs w
                     JOIN tasks t ON t.id = w.task_id
                     WHERE w.end_time IS NULL
                     ORDER BY w.start_time DESC
                     LIMIT 1";

        let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            Some(ActiveTimerInfo {
                worklog_id: row.get(0).map_err(|e| e.to_string())?,
                task_id: row.get(1).map_err(|e| e.to_string())?,
                task_title: row.get(2).map_err(|e| e.to_string())?,
                start_time: row.get(3).map_err(|e| e.to_string())?,
                elapsed_seconds: row.get(4).map_err(|e| e.to_string())?,
            })
        } else {
            None
        }
    };

    let last_active_task: Option<PausedTaskInfo> = {
        let conn = open_db(&db_path).map_err(|e| e.to_string())?;
        let q = "SELECT t.id, t.title FROM tasks t
                 WHERE t.status != 'done'
                 ORDER BY CASE WHEN t.status = 'in_progress' THEN 0 ELSE 1 END,
                          t.updated_at DESC
                 LIMIT 1";
        let mut stmt = conn.prepare(q).map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        if let Some(r) = rows.next().map_err(|e| e.to_string())? {
            Some(PausedTaskInfo {
                task_id: r.get(0).map_err(|e| e.to_string())?,
                title: r.get(1).map_err(|e| e.to_string())?,
            })
        } else {
            None
        }
    };

    let is_running = active_timer.is_some();
    let is_auto_paused = auto_paused.is_some();
    let auto_paused_task = auto_paused.map(|(id, title)| PausedTaskInfo { task_id: id, title });

    Ok(TimerStatusInfo {
        is_running,
        is_auto_paused,
        active_timer,
        auto_paused_task,
        last_active_task,
    })
}

#[tauri::command]
async fn get_active_timer(
    state: State<'_, SafeAppState>,
) -> Result<Option<ActiveTimerInfo>, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

    let query = "SELECT w.id, w.task_id, t.title, w.start_time,
                        MAX(0, CAST(strftime('%s', 'now', 'localtime') - strftime('%s', w.start_time) AS INTEGER)) as elapsed
                 FROM task_worklogs w
                 JOIN tasks t ON t.id = w.task_id
                 WHERE w.end_time IS NULL
                 ORDER BY w.start_time DESC
                 LIMIT 1";

    let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        Ok(Some(ActiveTimerInfo {
            worklog_id: row.get(0).map_err(|e| e.to_string())?,
            task_id: row.get(1).map_err(|e| e.to_string())?,
            task_title: row.get(2).map_err(|e| e.to_string())?,
            start_time: row.get(3).map_err(|e| e.to_string())?,
            elapsed_seconds: row.get(4).map_err(|e| e.to_string())?,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn get_task_worklogs(
    state: State<'_, SafeAppState>,
    task_id: i64,
) -> Result<Vec<TaskWorklog>, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, task_id, start_time, end_time,
                CASE 
                    WHEN end_time IS NOT NULL THEN duration_seconds
                    ELSE MAX(0, CAST(strftime('%s', 'now', 'localtime') - strftime('%s', start_time) AS INTEGER))
                END,
                note
         FROM task_worklogs
         WHERE task_id = ?1
         ORDER BY start_time DESC",
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![task_id], |row| {
        Ok(TaskWorklog {
            id: row.get(0)?,
            task_id: row.get(1)?,
            start_time: row.get(2)?,
            end_time: row.get(3)?,
            duration_seconds: row.get(4)?,
            note: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut logs = Vec::new();
    for r in rows {
        logs.push(r.map_err(|e| e.to_string())?);
    }
    Ok(logs)
}

#[tauri::command]
async fn delete_task_worklog(
    state: State<'_, SafeAppState>,
    id: i64,
) -> Result<(), String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM task_worklogs WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_task_checklists(
    state: State<'_, SafeAppState>,
    task_id: i64,
) -> Result<Vec<TaskChecklistItem>, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, task_id, title, is_done, sort_order
         FROM task_checklists
         WHERE task_id = ?1
         ORDER BY sort_order ASC, id ASC",
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![task_id], |row| {
        let is_done_i: i64 = row.get(3)?;
        Ok(TaskChecklistItem {
            id: row.get(0)?,
            task_id: row.get(1)?,
            title: row.get(2)?,
            is_done: is_done_i != 0,
            sort_order: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

#[tauri::command]
async fn add_task_checklist(
    state: State<'_, SafeAppState>,
    task_id: i64,
    title: String,
) -> Result<TaskChecklistItem, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO task_checklists (task_id, title, is_done, sort_order)
         VALUES (?1, ?2, 0, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM task_checklists WHERE task_id = ?1))",
        params![task_id, title.trim()],
    ).map_err(|e| e.to_string())?;

    let last_id = conn.last_insert_rowid();
    Ok(TaskChecklistItem {
        id: last_id,
        task_id,
        title: title.trim().to_string(),
        is_done: false,
        sort_order: 0,
    })
}

#[tauri::command]
async fn toggle_task_checklist(
    state: State<'_, SafeAppState>,
    id: i64,
) -> Result<TaskChecklistItem, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE task_checklists SET is_done = CASE WHEN is_done = 1 THEN 0 ELSE 1 END WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, task_id, title, is_done, sort_order FROM task_checklists WHERE id = ?1",
        params![id],
        |row| {
            let is_done_i: i64 = row.get(3)?;
            Ok(TaskChecklistItem {
                id: row.get(0)?,
                task_id: row.get(1)?,
                title: row.get(2)?,
                is_done: is_done_i != 0,
                sort_order: row.get(4)?,
            })
        },
    ).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_task_checklist(
    state: State<'_, SafeAppState>,
    id: i64,
) -> Result<(), String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM task_checklists WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_daily_summary(
    state: State<'_, SafeAppState>,
    date_str: Option<String>,
) -> Result<DailySummary, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;

    let target_date = match date_str {
        Some(d) if !d.trim().is_empty() => d.trim().to_string(),
        _ => {
            conn.query_row("SELECT strftime('%Y-%m-%d', 'now', 'localtime')", [], |r| r.get(0))
                .unwrap_or_else(|_| "2026-09-30".to_string())
        }
    };

    let total_seconds: i64 = conn.query_row(
        "SELECT COALESCE(SUM(
            CASE 
                WHEN end_time IS NOT NULL THEN duration_seconds
                ELSE MAX(0, CAST(strftime('%s', 'now', 'localtime') - strftime('%s', start_time) AS INTEGER))
            END
        ), 0)
        FROM task_worklogs
        WHERE date(start_time) = date(?1)",
        params![target_date],
        |row| row.get(0),
    ).unwrap_or(0);

    struct WorkSummaryItem {
        title: String,
        status: String,
        duration: i64,
    }

    let mut stmt = conn.prepare(
        "SELECT t.title, t.status,
                COALESCE(SUM(
                    CASE 
                        WHEN w.end_time IS NOT NULL THEN w.duration_seconds
                        ELSE MAX(0, CAST(strftime('%s', 'now', 'localtime') - strftime('%s', w.start_time) AS INTEGER))
                    END
                ), 0) as task_duration
         FROM tasks t
         LEFT JOIN task_worklogs w ON w.task_id = t.id AND date(w.start_time) = date(?1)
         WHERE date(w.start_time) = date(?1) OR (date(t.completed_at) = date(?1))
         GROUP BY t.id
         ORDER BY task_duration DESC, t.title ASC"
    ).map_err(|e| e.to_string())?;

    let items = stmt.query_map(params![target_date], |row| {
        Ok(WorkSummaryItem {
            title: row.get(0)?,
            status: row.get(1)?,
            duration: row.get(2)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut completed_tasks_count = 0;
    let mut in_progress_tasks_count = 0;
    let mut completed_lines = Vec::new();
    let mut active_lines = Vec::new();

    let fmt_duration = |secs: i64| -> String {
        let h = secs / 3600;
        let m = (secs % 3600) / 60;
        let s = secs % 60;
        if h > 0 {
            if m > 0 && s > 0 {
                format!("{}s {}dk {}sn", h, m, s)
            } else if m > 0 {
                format!("{}s {}dk", h, m)
            } else if s > 0 {
                format!("{}s {}sn", h, s)
            } else {
                format!("{}s", h)
            }
        } else if m > 0 {
            if s > 0 {
                format!("{}dk {}sn", m, s)
            } else {
                format!("{}dk", m)
            }
        } else {
            format!("{}sn", s)
        }
    };

    for item in items.flatten() {
        if item.status == "done" {
            completed_tasks_count += 1;
            completed_lines.push(format!("- [x] {} ({})", item.title, fmt_duration(item.duration)));
        } else {
            in_progress_tasks_count += 1;
            active_lines.push(format!("- [ ] {} ({})", item.title, fmt_duration(item.duration)));
        }
    }

    let total_time_str = fmt_duration(total_seconds);
    let mut md = format!("## 📅 Günlük Çalışma Raporu: {} (Toplam Efor: {})\n\n", target_date, total_time_str);

    if !completed_lines.is_empty() {
        md.push_str("### ✅ Tamamlanan Görevler:\n");
        for line in completed_lines {
            md.push_str(&line);
            md.push('\n');
        }
        md.push('\n');
    }

    if !active_lines.is_empty() {
        md.push_str("### ⏳ Devam Eden Görevler:\n");
        for line in active_lines {
            md.push_str(&line);
            md.push('\n');
        }
        md.push('\n');
    }

    if total_seconds == 0 && completed_tasks_count == 0 && in_progress_tasks_count == 0 {
        md.push_str("_Bu tarihte henüz bir çalışma veya tamamlanan görev kaydı bulunmuyor._\n");
    }

    Ok(DailySummary {
        date: target_date,
        total_seconds,
        completed_tasks_count,
        in_progress_tasks_count,
        markdown_summary: md,
    })
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
            init_db_schema(&conn).expect("Failed to initialize database schema");
            let launcher_shortcut = get_meta(&conn, "launcher_shortcut")
                .unwrap_or_else(|| DEFAULT_LAUNCHER_SHORTCUT.to_string());
            let clipboard_shortcut = get_meta(&conn, "clipboard_shortcut")
                .unwrap_or_else(|| DEFAULT_CLIPBOARD_SHORTCUT.to_string());
            let screenshot_shortcut = get_meta(&conn, "screenshot_shortcut")
                .unwrap_or_else(|| DEFAULT_SCREENSHOT_SHORTCUT.to_string());
            let timer_widget_shortcut = get_meta(&conn, "timer_widget_shortcut")
                .unwrap_or_else(|| DEFAULT_TIMER_WIDGET_SHORTCUT.to_string());
            let tasks_shortcut = get_meta(&conn, "tasks_shortcut")
                .unwrap_or_else(|| DEFAULT_TASKS_SHORTCUT.to_string());
            let quick_task_shortcut = get_meta(&conn, "quick_task_shortcut")
                .unwrap_or_else(|| DEFAULT_QUICK_TASK_SHORTCUT.to_string());
            let screenshot_notification_enabled = get_meta(&conn, "screenshot_notification_enabled")
                .map(|v| v != "0")
                .unwrap_or(true);
            let default_screenshot_save_dir = get_default_screenshot_dir(app.handle())
                .to_string_lossy()
                .to_string();
            let screenshot_save_dir = get_meta(&conn, "screenshot_save_dir")
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| default_screenshot_save_dir.clone());
            let _ = std::fs::create_dir_all(&screenshot_save_dir);
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
            let auto_paste_on_select = get_meta(&conn, "auto_paste_on_select")
                .map(|v| v != "0")
                .unwrap_or(true);
            let clipboard_window_mode = get_meta(&conn, "clipboard_window_mode")
                .unwrap_or_else(|| "popup".to_string());
            let clipboard_close_on_blur = get_meta(&conn, "clipboard_close_on_blur")
                .map(|v| v != "0")
                .unwrap_or(true);
            let clipboard_close_on_space = get_meta(&conn, "clipboard_close_on_space")
                .map(|v| v != "0")
                .unwrap_or(true);
            let clipboard_clear_search_on_open = get_meta(&conn, "clipboard_clear_search_on_open")
                .map(|v| v != "0")
                .unwrap_or(true);
            let panel_scale = get_meta(&conn, "panel_scale")
                .unwrap_or_else(|| "medium".to_string());
            let clipboard_clear_seconds = get_meta(&conn, "clipboard_clear_seconds")
                .and_then(|v| v.parse().ok())
                .unwrap_or(15);
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
                timer_widget_shortcut: timer_widget_shortcut.clone(),
                tasks_shortcut: tasks_shortcut.clone(),
                quick_task_shortcut: quick_task_shortcut.clone(),
                screenshot_notification_enabled,
                screenshot_save_dir,
                default_screenshot_save_dir,
                clipboard_page_size,
                clipboard_lock_with_vault,
                clipboard_enabled,
                clipboard_preview_delay_ms,
                auto_paste_on_select,
                clipboard_window_mode,
                clipboard_close_on_blur,
                clipboard_close_on_space,
                clipboard_clear_search_on_open,
                panel_scale,
                clipboard_clear_seconds,
                idle_timeout_minutes,
                last_activity: Instant::now(),
                last_vault_password: None,
                ignore_clipboard_change: false,
                clipboard_image_cache: Arc::new(Mutex::new(HashMap::new())),
                active_timer_auto_paused: None,
                timer_auto_pause_enabled: true,
            })));

            #[cfg(target_os = "windows")]
            ensure_windows_notification_identity();

            if let Err(e) = setup_tray(app) {
                eprintln!("Failed to setup tray: {e}");
            }
            if let Err(e) = register_launcher_hotkey(app.handle(), &launcher_shortcut) {
                eprintln!("Failed to register launcher hotkey: {e}");
            }
            if let Err(e) = register_clipboard_hotkey(app.handle(), &clipboard_shortcut) {
                eprintln!("Failed to register clipboard hotkey: {e}");
            }
            if let Err(e) = register_screenshot_hotkey(app.handle(), &screenshot_shortcut) {
                eprintln!("Failed to register screenshot hotkey: {e}");
            }
            if let Err(e) = register_timer_widget_hotkey(app.handle(), &timer_widget_shortcut) {
                eprintln!("Failed to register timer widget hotkey: {e}");
            }
            if let Err(e) = register_tasks_hotkey(app.handle(), &tasks_shortcut) {
                eprintln!("Failed to register tasks hotkey: {e}");
            }
            if let Err(e) = register_quick_task_hotkey(app.handle(), &quick_task_shortcut) {
                eprintln!("Failed to register quick task hotkey: {e}");
            }

            // Start clipboard watcher background thread
            start_clipboard_watcher(app.handle().clone(), db_path.clone(), cache_dir.clone());

            if let Some(window) = app.get_webview_window("launcher") {
                window.show()?;
            }

            // Task Timer Auto-Pause on Idle / Lock & Auto-Resume on Activity
            let handle_timer = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut was_inactive = false;
                loop {
                    tokio::time::sleep(Duration::from_millis(1000)).await;
                    let idle_secs = get_system_idle_seconds();
                    let locked = is_system_locked();
                    let is_now_inactive = locked || idle_secs >= 60;

                    let state = handle_timer.state::<SafeAppState>();

                    if is_now_inactive && !was_inactive {
                        let mut paused_task = None;
                        if let Ok(mut st) = state.0.lock() {
                            if st.timer_auto_pause_enabled {
                                if let Ok(conn) = open_db(&st.db_path) {
                                    let running_timer: Option<(i64, String)> = conn.query_row(
                                        "SELECT w.task_id, t.title
                                         FROM task_worklogs w
                                         JOIN tasks t ON t.id = w.task_id
                                         WHERE w.end_time IS NULL
                                         ORDER BY w.start_time DESC
                                         LIMIT 1",
                                        [],
                                        |row| Ok((row.get(0)?, row.get(1)?)),
                                    ).ok();

                                    if let Some((tid, title)) = running_timer {
                                        let deduct = if locked { 0 } else { idle_secs.min(60) };
                                        let _ = conn.execute(
                                            "UPDATE task_worklogs
                                             SET end_time = datetime('now', 'localtime'),
                                                 duration_seconds = MAX(0, CAST(strftime('%s', 'now', 'localtime') - strftime('%s', start_time) AS INTEGER) - ?1)
                                             WHERE task_id = ?2 AND end_time IS NULL",
                                            params![deduct as i64, tid],
                                        );
                                        st.active_timer_auto_paused = Some((tid, title.clone()));
                                        paused_task = Some((tid, title, if locked { "locked" } else { "idle" }));
                                    }
                                }
                            }
                        }
                        if let Some((tid, title, reason)) = paused_task {
                            let _ = handle_timer.emit("timer-auto-paused", serde_json::json!({
                                "taskId": tid,
                                "title": title,
                                "reason": reason
                            }));
                        }
                        was_inactive = true;
                    } else if !is_now_inactive && was_inactive {
                        let mut resumed_task = None;
                        if let Ok(mut st) = state.0.lock() {
                            if st.timer_auto_pause_enabled {
                                if let Some((tid, title)) = st.active_timer_auto_paused.take() {
                                    if let Ok(conn) = open_db(&st.db_path) {
                                        let _ = conn.execute(
                                            "INSERT INTO task_worklogs (task_id, start_time, end_time, duration_seconds, note)
                                             VALUES (?1, datetime('now', 'localtime'), NULL, 0, '')",
                                            params![tid],
                                        );
                                        let _ = conn.execute(
                                            "UPDATE tasks SET status = 'in_progress', updated_at = datetime('now', 'localtime') WHERE id = ?1",
                                            params![tid],
                                        );
                                        resumed_task = Some((tid, title));
                                    }
                                }
                            }
                        }
                        if let Some((tid, title)) = resumed_task {
                            let _ = handle_timer.emit("timer-auto-resumed", serde_json::json!({
                                "taskId": tid,
                                "title": title
                            }));
                        }
                        was_inactive = false;
                    }
                }
            });

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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(focused) = event {
                if !focused {
                    if window.label() == "clipboard-launcher" {
                        let state = window.app_handle().state::<SafeAppState>();
                        let close_on_blur = if let Ok(st) = state.0.lock() {
                            st.clipboard_close_on_blur
                        } else {
                            true
                        };
                        if close_on_blur {
                            let _ = window.hide();
                        }
                    } else if window.label() == "quick-task" {
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            check_vault_initialized,
            init_vault,
            unlock_vault,
            lock_vault,
            change_master_password,
            get_password_hint,
            set_password_hint,
            has_recovery_key,
            generate_new_recovery_key,
            recover_vault,
            reset_vault,
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
            get_clipboard_clear_seconds,
            set_clipboard_clear_seconds,
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
            pick_screenshot_folder,
            open_screenshot_folder,
            extract_text_from_image,
            // App settings (theme & language)
            get_app_config,
            set_app_theme,
            set_app_language,
            trigger_auto_paste,
            // Task & Focus tracker commands
            get_tasks,
            create_task,
            update_task,
            delete_task,
            toggle_task_status,
            start_task_timer,
            stop_task_timer,
            get_active_timer,
            get_task_worklogs,
            delete_task_worklog,
            get_task_checklists,
            add_task_checklist,
            toggle_task_checklist,
            delete_task_checklist,
            get_daily_summary,
            show_timer_widget,
            hide_timer_widget,
            toggle_timer_widget,
            get_timer_widget_shortcut,
            set_timer_widget_shortcut,
            complete_active_task,
            toggle_active_task_timer,
            get_timer_status,
            open_tasks_window,
            get_tasks_shortcut,
            set_tasks_shortcut,
            show_quick_task,
            hide_quick_task,
            toggle_quick_task,
            get_quick_task_shortcut,
            set_quick_task_shortcut,
            save_recovery_key_file,
            restart_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PasCopyOf");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sqlite_duration() {
        let conn = Connection::open_in_memory().unwrap();
        init_db_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO tasks (title) VALUES ('test')",
            [],
        ).unwrap();
        let tid = conn.last_insert_rowid();

        // Simulate start 45 seconds ago
        conn.execute(
            "INSERT INTO task_worklogs (task_id, start_time, end_time, duration_seconds)
             VALUES (?1, datetime('now', 'localtime', '-45 seconds'), NULL, 0)",
            params![tid],
        ).unwrap();

        stop_running_timers(&conn, Some(tid)).unwrap();

        let dur: i64 = conn.query_row(
            "SELECT duration_seconds FROM task_worklogs WHERE task_id = ?1",
            params![tid],
            |r| r.get(0),
        ).unwrap();

        println!("Calculated duration: {} seconds", dur);
        assert!(dur >= 44 && dur <= 46);
    }
}

