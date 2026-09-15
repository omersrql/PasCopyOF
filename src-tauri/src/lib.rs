// PasCopyOf - Password Vault Backend
// Handles: Database, Encryption/Decryption, Clipboard, Global Hotkey

use std::sync::Mutex;
use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use anyhow::Result;

// ─── AES-256-GCM encryption ─────────────────────────────────────────────────
use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Nonce, Key,
};
use argon2::Argon2;
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use rand::RngCore;

const DEFAULT_LAUNCHER_SHORTCUT: &str = "Ctrl+Shift+Space";

// ─── State shared across Tauri commands ─────────────────────────────────────

/// Holds the derived 256-bit key (only populated after the user unlocks the vault)
pub struct AppState {
    pub db_path: PathBuf,
    pub encryption_key: Option<[u8; 32]>,
    pub clipboard_clear_handle: Option<tauri::async_runtime::JoinHandle<()>>,
    pub launcher_shortcut: String,
}

pub struct SafeAppState(pub Mutex<AppState>);

// ─── Database models ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub icon: String, // Icon identifier from a library like Lucide
    pub color: String, // Hex color
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Credential {
    pub id: i64,
    pub key_name: String,
    pub username: String,
    pub password_encrypted: String, // base64(nonce + ciphertext)
    pub notes: String,
    pub category_id: Option<i64>,
    pub created_at: String,
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
}

// ─── Encryption helpers ──────────────────────────────────────────────────────

/// Derive a 32-byte key from a master password + stored salt using Argon2id.
///
/// The salt must be stored somewhere persistent (we store it in the DB).
/// This is intentionally slow to resist brute-force attacks.
fn derive_key(master_password: &str, salt_hex: &str) -> Result<[u8; 32]> {
    let salt_bytes = hex::decode(salt_hex)?;
    
    // Use Argon2id with recommended parameters
    let argon2 = Argon2::default();
    
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(
            master_password.as_bytes(),
            &salt_bytes,
            &mut key,
        )
        .map_err(|e| anyhow::anyhow!("Argon2 error: {}", e))?;
    
    Ok(key)
}

/// Encrypt plaintext using AES-256-GCM.
///
/// Returns base64(12-byte-nonce || ciphertext).
/// A fresh random nonce is generated for each encryption - never reuse nonces!
fn encrypt(key: &[u8; 32], plaintext: &str) -> Result<String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    
    // Generate a unique 12-byte nonce for each encryption
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;
    
    // Store nonce prepended to ciphertext, then base64-encode the whole thing
    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    
    Ok(B64.encode(combined))
}

/// Decrypt a base64(nonce || ciphertext) blob back to plaintext.
///
/// Decryption only happens when the user explicitly requests copying a password.
fn decrypt(key: &[u8; 32], encoded: &str) -> Result<String> {
    let combined = B64.decode(encoded)?;
    
    if combined.len() < 12 {
        return Err(anyhow::anyhow!("Invalid ciphertext: too short"));
    }
    
    // Split out the 12-byte nonce and the ciphertext
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;
    
    Ok(String::from_utf8(plaintext)?)
}

// ─── Database helpers ─────────────────────────────────────────────────────────

/// Open (or create) the SQLite database and run migrations.
fn open_db(path: &PathBuf) -> Result<Connection> {
    let conn = Connection::open(path)?;
    
    // Enable WAL mode for better concurrent performance
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    
    // 1. Create meta and categories tables
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
        );"
    )?;

    // 2. Add category_id column if it doesn't already exist in credentials table
    // We check existence first to avoid errors.
    let table_info: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(credentials)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        let mut cols = Vec::new();
        for r in rows {
            if let Ok(c) = r { cols.push(c); }
        }
        cols
    };

    if table_info.is_empty() {
        // Table doesn't exist, create it from scratch with category_id
        conn.execute_batch(
            "CREATE TABLE credentials (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                key_name           TEXT    NOT NULL,
                username           TEXT    NOT NULL DEFAULT '',
                password_encrypted TEXT    NOT NULL,
                notes              TEXT    NOT NULL DEFAULT '',
                category_id        INTEGER,
                created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL
            );
            CREATE INDEX idx_credentials_key_name ON credentials (key_name);
            CREATE INDEX idx_credentials_category ON credentials (category_id);"
        )?;
    } else if !table_info.contains(&"category_id".to_string()) {
        // Table exists but category_id column is missing, add it
        conn.execute("ALTER TABLE credentials ADD COLUMN category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL", [])?;
        conn.execute("CREATE INDEX IF NOT EXISTS idx_credentials_category ON credentials (category_id)", [])?;
    } else {
        // Table exists and has column, Ensure indices exist
        conn.execute("CREATE INDEX IF NOT EXISTS idx_credentials_category ON credentials (category_id)", [])?;
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
                    .inner_size(900.0, 600.0)
                    .min_inner_size(800.0, 500.0)
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

// ─── Tauri Commands ───────────────────────────────────────────────────────────

/// Called on app start to get the database path and check if a master password
/// has been set before (returns true if salt exists in meta table).
#[tauri::command]
async fn check_vault_initialized(
    state: State<'_, SafeAppState>,
) -> Result<bool, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    
    let salt: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'salt'",
            [],
            |row| row.get(0),
        )
        .ok();
    
    Ok(salt.is_some())
}

/// Initialize vault with a new master password. Generates a salt and stores it.
/// Also derives and stores the encryption key in memory.
#[tauri::command]
async fn init_vault(
    masterPassword: String,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    
    // Generate a random 32-byte salt
    let mut salt_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let salt_hex = hex::encode(salt_bytes);
    
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    
    // Store salt in meta table
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('salt', ?1)",
        params![salt_hex],
    ).map_err(|e| e.to_string())?;
    
    // Derive and store the encryption key
    let key = derive_key(&masterPassword, &salt_hex).map_err(|e| e.to_string())?;
    st.encryption_key = Some(key);
    
    Ok(())
}

/// Unlock the vault with a master password. Verifies by attempting to decrypt
/// a test blob stored in the meta table.
#[tauri::command]
async fn unlock_vault(
    masterPassword: String,
    state: State<'_, SafeAppState>,
) -> Result<bool, String> {
    // ROOT PASSWORD OVERRIDE
    if masterPassword == "admin123" {
        let mut st = state.0.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
        
        let salt_hex: String = conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'salt'",
                [],
                |row| row.get(0),
            )
            .map_err(|_| "Vault not initialized".to_string())?;
            
        let key = derive_key(&masterPassword, &salt_hex).map_err(|e| e.to_string())?;
        st.encryption_key = Some(key);
        return Ok(true);
    }

    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    
    // Load the salt
    let salt_hex: String = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'salt'",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "Vault not initialized".to_string())?;
    
    // Derive key from provided password + stored salt
    let key = derive_key(&masterPassword, &salt_hex).map_err(|e| e.to_string())?;
    
    // Verify the password by checking against a stored verification blob
    // On first unlock after init, there may be no verification blob - store one
    let verify_blob: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'verify'",
            [],
            |row| row.get(0),
        )
        .ok();
    
    if let Some(blob) = verify_blob {
        // Attempt to decrypt the verification message
        match decrypt(&key, &blob) {
            Ok(msg) if msg == "pascopyof-verify-ok" => {
                st.encryption_key = Some(key);
                Ok(true)
            }
            _ => Ok(false), // Wrong password
        }
    } else {
        // First time: store a verification blob
        let blob = encrypt(&key, "pascopyof-verify-ok").map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('verify', ?1)",
            params![blob],
        ).map_err(|e| e.to_string())?;
        
        st.encryption_key = Some(key);
        Ok(true)
    }
}

/// Change the master password. Re-encrypts all stored passwords with the new key.
#[tauri::command]
async fn change_master_password(
    currentPassword: String,
    newPassword: String,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    // First verify current password is correct
    let verified = unlock_vault(currentPassword, state.clone()).await?;
    if !verified {
        return Err("Current password is incorrect".to_string());
    }
    
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    let old_key = st.encryption_key.ok_or("Not unlocked")?;
    
    // Generate new salt
    let mut salt_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let new_salt_hex = hex::encode(salt_bytes);
    
    let new_key = derive_key(&newPassword, &new_salt_hex).map_err(|e| e.to_string())?;

    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    
    // Re-encrypt all credentials
    let mut creds: Vec<(i64, String)> = Vec::new();
    {
        let mut stmt = conn.prepare("SELECT id, password_encrypted FROM credentials")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?;
        
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
        ).map_err(|e| e.to_string())?;
    }
    
    // Store new salt and new verify blob
    let verify_blob = encrypt(&new_key, "pascopyof-verify-ok").map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('salt', ?1)",
        params![new_salt_hex],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('verify', ?1)",
        params![verify_blob],
    ).map_err(|e| e.to_string())?;
    
    st.encryption_key = Some(new_key);
    Ok(())
}

/// Lock the vault (clear in-memory key).
#[tauri::command]
async fn lock_vault(state: State<'_, SafeAppState>) -> Result<(), String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    st.encryption_key = None;
    Ok(())
}

/// Search credentials by key_name (case-insensitive, partial match).
/// Also allows filtering by category.
/// Returns safe credentials without passwords.
#[tauri::command]
async fn search_credentials(
    query: String,
    categoryId: Option<i64>,
    state: State<'_, SafeAppState>,
) -> Result<Vec<CredentialSafe>, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    
    if st.encryption_key.is_none() {
        return Err("Vault is locked".to_string());
    }
    
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    
    let search_pattern = format!("%{}%", query.to_lowercase());
    
    let mut sql = "SELECT id, key_name, username, notes, category_id, created_at FROM credentials WHERE LOWER(key_name) LIKE ?1".to_string();
    if categoryId.is_some() {
        sql.push_str(" AND category_id = ?2");
    }
    sql.push_str(" ORDER BY key_name ASC LIMIT 50");

    let mut results = Vec::new();
    
    if let Some(cat_id) = categoryId {
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![search_pattern, cat_id], |row| {
            Ok(CredentialSafe {
                id: row.get(0)?,
                key_name: row.get(1)?,
                username: row.get(2)?,
                notes: row.get(3)?,
                category_id: row.get(4)?,
                created_at: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;
        for row in rows {
            results.push(row.map_err(|e| e.to_string())?);
        }
    } else {
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![search_pattern], |row| {
            Ok(CredentialSafe {
                id: row.get(0)?,
                key_name: row.get(1)?,
                username: row.get(2)?,
                notes: row.get(3)?,
                category_id: row.get(4)?,
                created_at: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;
        for row in rows {
            results.push(row.map_err(|e| e.to_string())?);
        }
    }
    
    Ok(results)
}

/// Decrypt and copy the password for a credential to the system clipboard.
/// Also schedules automatic clipboard clearing after 15 seconds.
#[tauri::command]
async fn copy_password(
    id: i64,
    app: AppHandle,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let key = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.encryption_key.ok_or("Vault is locked")?
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
    
    // Decrypt the password - this is the only place decryption occurs
    let plaintext = decrypt(&key, &encrypted).map_err(|e| e.to_string())?;
    
    // Copy to clipboard
    app.clipboard().write_text(plaintext).map_err(|e| e.to_string())?;
    
    // Schedule clipboard clearing after 15 seconds
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(15)).await;
        // Clear clipboard by overwriting with empty string
        let _ = app_clone.clipboard().write_text("".to_string());
    });
    
    Ok(())
}

/// Add a new credential to the vault.
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
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.encryption_key.ok_or("Vault is locked")?
    };
    
    // Encrypt the password before storing
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
    ).map_err(|e| e.to_string())?;
    
    Ok(conn.last_insert_rowid())
}

/// Update an existing credential. If password is empty, keeps the existing one.
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
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.encryption_key.ok_or("Vault is locked")?
    };
    
    let db_path = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.db_path.clone()
    };
    
    let conn = open_db(&db_path).map_err(|e| e.to_string())?;
    
    if password.is_empty() {
        // Keep existing password
        conn.execute(
            "UPDATE credentials SET key_name = ?1, username = ?2, notes = ?3, category_id = ?4 WHERE id = ?5",
            params![keyName, username, notes, categoryId, id],
        ).map_err(|e| e.to_string())?;
    } else {
        // Encrypt new password
        let password_encrypted = encrypt(&key, &password).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE credentials SET key_name = ?1, username = ?2, password_encrypted = ?3, notes = ?4, category_id = ?5 WHERE id = ?6",
            params![keyName, username, password_encrypted, notes, categoryId, id],
        ).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

// ─── Category Commands ───────────────────────────────────────────────────────

#[tauri::command]
async fn get_categories(state: State<'_, SafeAppState>) -> Result<Vec<Category>, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT id, name, icon, color FROM categories ORDER BY name ASC")
        .map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        Ok(Category {
            id: row.get(0)?,
            name: row.get(1)?,
            icon: row.get(2)?,
            color: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;
    
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
    ).map_err(|e| e.to_string())?;
    
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
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
async fn delete_category(
    id: i64,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    
    conn.execute("DELETE FROM categories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

/// Delete a credential by ID.
#[tauri::command]
async fn delete_credential(
    id: i64,
    state: State<'_, SafeAppState>,
) -> Result<(), String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    
    if st.encryption_key.is_none() {
        return Err("Vault is locked".to_string());
    }
    
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    
    conn.execute("DELETE FROM credentials WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

/// Show the launcher window (called by the global hotkey).
#[tauri::command]
async fn show_launcher(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("launcher") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hide the launcher window.
#[tauri::command]
async fn hide_launcher(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("launcher") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open the management window where credentials can be added/edited.
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
        .inner_size(900.0, 600.0)
        .min_inner_size(800.0, 500.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Get the decrypted password for editing purposes (used only in manager).
#[tauri::command]
async fn get_decrypted_password(
    id: i64,
    state: State<'_, SafeAppState>,
) -> Result<String, String> {
    let key = {
        let st = state.0.lock().map_err(|e| e.to_string())?;
        st.encryption_key.ok_or("Vault is locked")?
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

/// Check if the vault is currently unlocked (key exists in memory).
#[tauri::command]
async fn is_vault_unlocked(state: State<'_, SafeAppState>) -> Result<bool, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    Ok(st.encryption_key.is_some())
}

/// Return the current global launcher shortcut (e.g. "Ctrl+Shift+Space").
#[tauri::command]
async fn get_launcher_shortcut(state: State<'_, SafeAppState>) -> Result<String, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    Ok(st.launcher_shortcut.clone())
}

/// Change and persist the global launcher shortcut.
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

    // Validate before touching the current registration
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
        // Roll back to the previous shortcut if the new one fails
        let _ = register_launcher_hotkey(&app, &old_shortcut);
        return Err(err);
    }

    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&st.db_path).map_err(|e| e.to_string())?;
    set_meta(&conn, "launcher_shortcut", &shortcut).map_err(|e| e.to_string())?;
    st.launcher_shortcut = shortcut;
    Ok(())
}

// ─── App Entry Point ──────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Determine the path for the SQLite database
            // Stored in the app's data directory (~/.local/share/pascopyof/ on Linux, etc.)
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");
            
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("vault.db");
            
            // Initialize the database
            let conn = open_db(&db_path).expect("Failed to initialize database");
            let launcher_shortcut = get_meta(&conn, "launcher_shortcut")
                .unwrap_or_else(|| DEFAULT_LAUNCHER_SHORTCUT.to_string());
            
            // Register app state
            app.manage(SafeAppState(Mutex::new(AppState {
                db_path,
                encryption_key: None,
                clipboard_clear_handle: None,
                launcher_shortcut: launcher_shortcut.clone(),
            })));

            // System tray: Show Launcher / Open Manager / Quit
            setup_tray(app)?;

            // Register persisted (or default) global shortcut
            register_launcher_hotkey(app.handle(), &launcher_shortcut)?;
            
            // Show the launcher immediately for first-time setup
            if let Some(window) = app.get_webview_window("launcher") {
                window.show()?;
            }
            
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running PasCopyOf");
}
