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
use rand::RngCore;

const DEFAULT_LAUNCHER_SHORTCUT: &str = "Ctrl+Shift+Space";
const DEFAULT_IDLE_TIMEOUT_MINUTES: u64 = 15;
const VERIFY_MESSAGE: &str = "pascopyof-verify-ok";

// ─── State ───────────────────────────────────────────────────────────────────

pub struct AppState {
    pub db_path: PathBuf,
    pub encryption_key: Option<[u8; 32]>,
    pub clipboard_clear_handle: Option<tauri::async_runtime::JoinHandle<()>>,
    pub launcher_shortcut: String,
    pub idle_timeout_minutes: u64, // 0 = disabled
    pub last_activity: Instant,
}

pub struct SafeAppState(pub Mutex<AppState>);

// ─── Models ──────────────────────────────────────────────────────────────────

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
        );",
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

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;

    let show_launcher =
        MenuItem::with_id(app, "show_launcher", "Show Launcher", true, None::<&str>)?;
    let open_manager =
        MenuItem::with_id(app, "open_manager", "Open Manager", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit PasCopyOf", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_launcher, &open_manager, &separator, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("Missing default window icon")?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("PasCopyOf - Password Vault")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show_launcher" => {
                if let Some(window) = app.get_webview_window("launcher") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
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

// ─── Entry ───────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("vault.db");

            let conn = open_db(&db_path).expect("Failed to initialize database");
            let launcher_shortcut = get_meta(&conn, "launcher_shortcut")
                .unwrap_or_else(|| DEFAULT_LAUNCHER_SHORTCUT.to_string());
            let idle_timeout_minutes = get_meta(&conn, "idle_timeout_minutes")
                .and_then(|v| v.parse().ok())
                .unwrap_or(DEFAULT_IDLE_TIMEOUT_MINUTES);

            app.manage(SafeAppState(Mutex::new(AppState {
                db_path,
                encryption_key: None,
                clipboard_clear_handle: None,
                launcher_shortcut: launcher_shortcut.clone(),
                idle_timeout_minutes,
                last_activity: Instant::now(),
            })));

            setup_tray(app)?;
            register_launcher_hotkey(app.handle(), &launcher_shortcut)?;

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running PasCopyOf");
}
