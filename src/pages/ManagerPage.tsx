/**
 * ManagerPage.tsx — Vault management interface.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { MasterPasswordAuth } from "../components/MasterPasswordAuth";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { useVaultLock } from "../hooks/useVaultLock";
import { save, open } from "@tauri-apps/plugin-dialog";
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import {
  searchCredentials,
  addCredential,
  updateCredential,
  deleteCredential,
  getDecryptedPassword,
  lockVault,
  changeMasterPassword,
  isVaultUnlocked,
  getCategories,
  addCategory,
  updateCategory,
  deleteCategory,
  getLauncherShortcut,
  setLauncherShortcut,
  toggleFavorite,
  getIdleTimeout,
  setIdleTimeout,
  getClipboardClearSeconds,
  setClipboardClearSeconds,
  exportVault,
  restoreVault,
  importCsv,
} from "../api/vault";
import type { CredentialSafe, Category } from "../api/vault";
import {
  getClipboardSettings,
  updateClipboardSettings,
  setClipboardShortcut,
  clearClipboardHistory,
} from "../api/clipboard";
import {
  setScreenshotShortcut,
  triggerScreenshot,
  getScreenshotSettings,
  updateScreenshotSettings,
} from "../api/screenshot";
import { useApp } from "../context/AppContext";
import type { AppTheme, AppLanguage } from "../api/config";
import { checkAppUpdate, downloadAndInstallUpdate, getAppVersion } from "../api/updater";
import type { UpdateInfo } from "../api/updater";

type EditorMode = "idle" | "new" | "edit";

interface FormState {
  keyName: string;
  username: string;
  password: string;
  notes: string;
  categoryId: number | null;
}

const emptyForm: FormState = {
  keyName: "",
  username: "",
  password: "",
  notes: "",
  categoryId: null,
};

/** Build a Tauri-compatible shortcut string from a keyboard event. */
function shortcutFromEvent(e: KeyboardEvent): string | null {
  const modifiers: string[] = [];
  if (e.ctrlKey || e.metaKey) modifiers.push("Ctrl");
  if (e.altKey) modifiers.push("Alt");
  if (e.shiftKey) modifiers.push("Shift");

  const key = e.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) {
    return null;
  }

  let keyName: string;
  if (key === " ") keyName = "Space";
  else if (key.length === 1) keyName = key.toUpperCase();
  else keyName = key;

  if (modifiers.length === 0) {
    return null;
  }

  return [...modifiers, keyName].join("+");
}

export default function ManagerPage() {
  const { theme, setTheme, lang, setLanguage, t } = useApp();
  const [unlocked, setUnlocked] = useState(false);
  const [credentials, setCredentials] = useState<CredentialSafe[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("idle");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changePwForm, setChangePwForm] = useState({ current: "", next: "", confirm: "" });
  const [categories, setCategories] = useState<Category[]>([]);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [catForm, setCatForm] = useState({ id: null as number | null, name: "", icon: "Key", color: "#0ea5e9" });
  const [launcherShortcut, setLauncherShortcutState] = useState("Ctrl+Shift+Space");
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const [savingShortcut, setSavingShortcut] = useState(false);

  // Clipboard Settings State
  const [clipboardShortcut, setClipboardShortcutState] = useState("Ctrl+Shift+V");
  const [recordingClipboardShortcut, setRecordingClipboardShortcut] = useState(false);
  const [clipboardPageSize, setClipboardPageSize] = useState(100);
  const [clipboardLockWithVault, setClipboardLockWithVault] = useState(false);
  const [clipboardEnabled, setClipboardEnabled] = useState(true);
  const [clipboardPreviewDelayMs, setClipboardPreviewDelayMs] = useState(2000);
  const [autoPasteOnSelect, setAutoPasteOnSelect] = useState(true);

  // Screenshot Settings State
  const [screenshotShortcut, setScreenshotShortcutState] = useState("Ctrl+Shift+S");
  const [screenshotNotificationEnabled, setScreenshotNotificationEnabled] = useState(true);
  const [recordingScreenshotShortcut, setRecordingScreenshotShortcut] = useState(false);

  // Software Updates State
  const [appVersion, setAppVersion] = useState("0.2.0");
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const [idleTimeout, setIdleTimeoutState] = useState(15);
  const [clipboardClearSeconds, setClipboardClearSecondsState] = useState(15);
  const [autostartOn, setAutostartOn] = useState(false);
  const [busyIo, setBusyIo] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { toasts, showToast, removeToast } = useToast();

  const handleAutoLock = useCallback(() => {
    setUnlocked(false);
    setCredentials([]);
    setSelectedId(null);
    setEditorMode("idle");
  }, []);

  useVaultLock(handleAutoLock, unlocked);

  const handleCheckUpdate = async () => {
    setUpdateChecking(true);
    setUpdateError(null);
    setUpdateInfo(null);
    setDownloadProgress(null);
    try {
      const info = await checkAppUpdate();
      setUpdateInfo(info);
      if (!info.available) {
        showToast(t("settingsUpdaterUpToDate"), "success");
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      setUpdateError(msg);
      showToast(`${lang === "tr" ? "Güncelleme denetlenemedi" : "Failed to check update"}: ${msg}`, "error");
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateInfo?.rawUpdate) return;
    setUpdateError(null);
    setDownloadProgress(0);
    try {
      await downloadAndInstallUpdate(updateInfo.rawUpdate, (downloaded, total) => {
        if (total > 0) {
          setDownloadProgress(Math.round((downloaded / total) * 100));
        }
      });
      showToast(
        lang === "tr"
          ? "Güncelleme yüklendi. Uygulama yeniden başlatılıyor..."
          : "Update installed. Restarting...",
        "success"
      );
    } catch (err: any) {
      const msg = err?.message || String(err);
      setUpdateError(msg);
      setDownloadProgress(null);
      showToast(`${lang === "tr" ? "Güncelleme yüklenemedi" : "Failed to install update"}: ${msg}`, "error");
    }
  };

  async function loadSettings() {
    try {
      const [shortcut, idle, auto, clipSettings, scSettings, clearSecs] = await Promise.all([
        getLauncherShortcut(),
        getIdleTimeout(),
        isAutostartEnabled().catch(() => false),
        getClipboardSettings().catch(() => ({
          shortcut: "Ctrl+Shift+V",
          pageSize: 100,
          lockWithVault: false,
          enabled: true,
          previewDelayMs: 2000,
          autoPasteOnSelect: true,
        })),
        getScreenshotSettings().catch(() => ({
          shortcut: "Ctrl+Shift+S",
          notificationEnabled: true,
        })),
        getClipboardClearSeconds().catch(() => 15),
        getAppVersion().catch(() => "0.2.0"),
      ]);
      setLauncherShortcutState(shortcut);
      setIdleTimeoutState(idle);
      setClipboardClearSecondsState(clearSecs);
      setAutostartOn(auto);
      if (clipSettings) {
        setClipboardShortcutState(clipSettings.shortcut);
        setClipboardPageSize(clipSettings.pageSize);
        setClipboardLockWithVault(clipSettings.lockWithVault);
        setClipboardEnabled(clipSettings.enabled);
        setClipboardPreviewDelayMs(clipSettings.previewDelayMs ?? 2000);
        setAutoPasteOnSelect(clipSettings.autoPasteOnSelect ?? true);
      }
      if (scSettings) {
        setScreenshotShortcutState(scSettings.shortcut);
        setScreenshotNotificationEnabled(scSettings.notificationEnabled);
      }
      if (arguments[4] || true) {
        getAppVersion().then(setAppVersion);
      }
    } catch {
      /* ignore */
    }
  }

  // Check if already unlocked on mount
  useEffect(() => {
    isVaultUnlocked().then((ok) => {
      if (ok) {
        setUnlocked(true);
        loadCategories();
        loadSettings();
      }
    });
  }, []);

  useEffect(() => {
    if (!recordingShortcut) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecordingShortcut(false);
        return;
      }

      const next = shortcutFromEvent(e);
      if (!next) return;

      setRecordingShortcut(false);
      void (async () => {
        setSavingShortcut(true);
        try {
          await setLauncherShortcut(next);
          setLauncherShortcutState(next);
          showToast(`✓ Shortcut set to ${next}`, "success");
        } catch (err) {
          showToast(String(err), "error");
        } finally {
          setSavingShortcut(false);
        }
      })();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingShortcut, showToast]);

  useEffect(() => {
    if (!recordingClipboardShortcut) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecordingClipboardShortcut(false);
        return;
      }

      const next = shortcutFromEvent(e);
      if (!next) return;

      setRecordingClipboardShortcut(false);
      void (async () => {
        try {
          await setClipboardShortcut(next);
          setClipboardShortcutState(next);
          showToast(`✓ Pano kısayolu ${next} olarak ayarlandı`, "success");
        } catch (err) {
          showToast(String(err), "error");
        }
      })();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingClipboardShortcut, showToast]);

  useEffect(() => {
    if (!recordingScreenshotShortcut) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecordingScreenshotShortcut(false);
        return;
      }

      const next = shortcutFromEvent(e);
      if (!next) return;

      setRecordingScreenshotShortcut(false);
      void (async () => {
        try {
          await setScreenshotShortcut(next);
          setScreenshotShortcutState(next);
          showToast(`✓ Ekran görüntüsü kısayolu ${next} olarak ayarlandı`, "success");
        } catch (err) {
          showToast(String(err), "error");
        }
      })();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingScreenshotShortcut, showToast]);

  const loadCategories = async () => {
    try {
      const cats = await getCategories();
      setCategories(cats);
    } catch (e) {
      console.error(e);
    }
  };

  // Load all credentials
  const loadCredentials = useCallback(async (q = "") => {
    try {
      const list = await searchCredentials(q);
      setCredentials(list);
    } catch {
      showToast("Failed to load credentials", "error");
    }
  }, [showToast]);

  useEffect(() => {
    if (unlocked) {
      loadCredentials();
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [unlocked, loadCredentials]);

  // Filtered credentials based on search
  const filtered = credentials.filter(
    (c) =>
      (c.keyName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.username || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ── Editor actions ──────────────────────────────────────────────────────────

  function handleNewCredential() {
    setSelectedId(null);
    setForm(emptyForm);
    setShowPassword(false);
    setEditorMode("new");
  }

  async function handleSelectCredential(cred: CredentialSafe) {
    setSelectedId(cred.id);
    setShowPassword(false);
    setEditorMode("edit");
    setForm({
      keyName: cred.keyName || "",
      username: cred.username || "",
      password: "",
      notes: cred.notes || "",
      categoryId: cred.categoryId,
    });
  }

  async function handleRevealPassword() {
    if (!selectedId) return;
    try {
      const pw = await getDecryptedPassword(selectedId);
      setForm((f) => ({ ...f, password: pw }));
      setShowPassword(true);
    } catch {
      showToast("Failed to decrypt password", "error");
    }
  }

  async function handleSave() {
    if (!form.keyName.trim()) {
      showToast("Key name is required", "error");
      return;
    }
    if (editorMode === "new" && !form.password) {
      showToast("Password is required for new credentials", "error");
      return;
    }

    setSaving(true);
    try {
      if (editorMode === "new") {
        const newId = await addCredential({ ...form });
        showToast(`✓ "${form.keyName}" added`, "success");
        await loadCredentials(searchQuery);
        setSelectedId(newId);
        setEditorMode("edit");
      } else if (editorMode === "edit" && selectedId !== null) {
        await updateCredential({ id: selectedId, ...form });
        showToast(`✓ "${form.keyName}" updated`, "success");
        await loadCredentials(searchQuery);
      }
      setShowPassword(false);
    } catch (err) {
      showToast(`Error: ${String(err)}`, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (selectedId === null) return;
    try {
      await deleteCredential(selectedId);
      showToast("Credential deleted", "success");
      setSelectedId(null);
      setEditorMode("idle");
      setShowDeleteConfirm(false);
      await loadCredentials(searchQuery);
    } catch (err) {
      showToast(`Error: ${String(err)}`, "error");
    }
  }

  async function handleLock() {
    await lockVault();
    setUnlocked(false);
    setCredentials([]);
    setSelectedId(null);
    setEditorMode("idle");
  }

  // ── Change master password ──────────────────────────────────────────────────

  async function handleChangeMasterPassword(e: React.FormEvent) {
    e.preventDefault();

    if (changePwForm.next.length < 8) {
      showToast("New password must be at least 8 characters.", "error");
      return;
    }
    if (changePwForm.next !== changePwForm.confirm) {
      showToast("New passwords do not match.", "error");
      return;
    }

    try {
      await changeMasterPassword(changePwForm.current, changePwForm.next);
      showToast("✓ Master password changed", "success");
      setShowChangePassword(false);
      setChangePwForm({ current: "", next: "", confirm: "" });
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearchQuery(e.target.value);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function getInitials(name: string) {
    if (!name) return "??";
    return name.slice(0, 2).toLowerCase();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="manager-root">
      {!unlocked && (
        <MasterPasswordAuth
          onUnlocked={() => {
            setUnlocked(true);
            loadCategories();
            loadSettings();
          }}
        />
      )}

      {unlocked && (
        <>
          <div className="manager-topbar">
            <div className="manager-logo">
              <div className="manager-logo-dot" />
              {t("topbarAdmin")}
            </div>
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {t("topbarCredentialsCount", { count: credentials.length })}
            </span>

            <div className="manager-topbar-right">
              <button className="btn btn-secondary" onClick={() => setShowCategoryManager(true)}>{t("topbarCategories")}</button>
              <button className="btn btn-primary" onClick={handleNewCredential}>{t("topbarAddCredential")}</button>
              <button className="btn btn-secondary" onClick={() => {
                setShowChangePassword(true);
                loadSettings();
              }}>{t("topbarSettings")}</button>
              <button className="btn btn-secondary" onClick={handleLock}>{t("topbarLock")}</button>
            </div>
          </div>

          <div className="manager-content">
            <div className="credential-list-panel">
              <div className="list-header">
                <div className="list-search">
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder={t("credSearchPlaceholder")}
                    value={searchQuery}
                    onChange={handleSearchChange}
                  />
                </div>
              </div>

              <div className="credential-list">
                {filtered.map((cred) => (
                  <div
                    key={cred.id}
                    className={`cred-item ${selectedId === cred.id ? "active" : ""}`}
                    onClick={() => handleSelectCredential(cred)}
                  >
                    <div className="cred-item-icon" style={{ 
                        background: cred.categoryId ? categories.find(c => c.id === cred.categoryId)?.color + '22' : 'transparent',
                        color: cred.categoryId ? categories.find(c => c.id === cred.categoryId)?.color : 'inherit'
                      }}>
                        {getInitials(cred.keyName)}
                    </div>
                    <div className="cred-item-info">
                      <div className="cred-item-name">
                        {cred.isFavorite ? "★ " : ""}{cred.keyName}
                      </div>
                      <div className="cred-item-user">{cred.username || "—"}</div>
                      {cred.categoryId && (
                        <div className="credential-category-tag" style={{ border: `1px solid ${categories.find(c => c.id === cred.categoryId)?.color}55`, color: categories.find(c => c.id === cred.categoryId)?.color }}>
                          {categories.find(c => c.id === cred.categoryId)?.name}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="editor-panel">
              {editorMode === "idle" ? (
                <div className="editor-empty">Select a credential to manage.</div>
              ) : (
                <div className="editor-form">
                  <div className="editor-header">
                    <div className="editor-title">
                      {editorMode === "new" ? "New Credential" : form.keyName}
                    </div>
                    {editorMode === "edit" && selectedId !== null && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={async () => {
                          try {
                            const next = await toggleFavorite(selectedId);
                            setCredentials((list) =>
                              list.map((c) => (c.id === selectedId ? { ...c, isFavorite: next } : c))
                            );
                            showToast(next ? "Added to favorites" : "Removed from favorites", "success");
                          } catch (err) {
                            showToast(String(err), "error");
                          }
                        }}
                      >
                        {credentials.find((c) => c.id === selectedId)?.isFavorite ? "★ Favorited" : "☆ Favorite"}
                      </button>
                    )}
                  </div>

                  <div className="form-group-row">
                    <div className="form-group">
                      <label className="form-label">{t("credKeyName")}</label>
                      <input
                        className="form-input"
                        placeholder={t("credKeyNamePlaceholder")}
                        value={form.keyName}
                        onChange={(e) => setForm({ ...form, keyName: e.target.value })}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">{t("credCategory")}</label>
                      <select 
                        className="form-input"
                        value={form.categoryId || ""}
                        onChange={(e) => setForm({ ...form, categoryId: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">{t("credSelectCategory")}</option>
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t("credUsername")}</label>
                    <input
                      className="form-input"
                      placeholder={t("credUsernamePlaceholder")}
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t("credPassword")}</label>
                    <div className="form-input-wrap">
                      <input
                        type={showPassword ? "text" : "password"}
                        className="form-input"
                        placeholder={editorMode === "edit" ? "••••••••" : t("credPasswordPlaceholder")}
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                      />
                      <button
                        type="button"
                        className="form-input-action"
                        onClick={editorMode === "edit" && !showPassword ? handleRevealPassword : () => setShowPassword(!showPassword)}
                      >
                        {showPassword ? "🙈" : "👁"}
                      </button>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t("credNotes")}</label>
                    <textarea
                      className="form-textarea"
                      placeholder={t("credNotesPlaceholder")}
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                  </div>

                  <div style={{ display: "flex", gap: "10px" }}>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                      {saving ? t("loading") : t("save")}
                    </button>
                    {editorMode === "edit" && (
                      <button className="btn btn-danger" onClick={() => setShowDeleteConfirm(true)}>{t("delete")}</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {showDeleteConfirm && (
            <div className="modal-overlay">
              <div className="modal-card">
                <div className="modal-title">Delete?</div>
                <p>Are you sure you want to delete {form.keyName}?</p>
                <div className="modal-actions">
                  <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                  <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
                </div>
              </div>
            </div>
          )}

          {showChangePassword && (
            <div className="modal-overlay">
              <div className="modal-card settings-modal">
                <div className="modal-title">{t("settingsTitle")}</div>

                {/* Görünüm & Dil Section */}
                <div className="settings-section">
                  <div className="settings-section-title">{t("settingsAppearanceSection")}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label className="settings-label" style={{ fontSize: 12, marginBottom: 4, display: "block" }}>
                        {t("settingsThemeLabel")}
                      </label>
                      <select
                        className="form-input"
                        value={theme}
                        onChange={(e) => setTheme(e.target.value as AppTheme)}
                      >
                        <option value="dark">{t("settingsThemeDark")}</option>
                        <option value="light">{t("settingsThemeLight")}</option>
                      </select>
                    </div>
                    <div>
                      <label className="settings-label" style={{ fontSize: 12, marginBottom: 4, display: "block" }}>
                        {t("settingsLanguageLabel")}
                      </label>
                      <select
                        className="form-input"
                        value={lang}
                        onChange={(e) => setLanguage(e.target.value as AppLanguage)}
                      >
                        <option value="tr">{t("settingsLanguageTr")}</option>
                        <option value="en">{t("settingsLanguageEn")}</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="settings-divider" />

                <div className="settings-section">
                  <div className="settings-section-title">{t("settingsLauncherShortcutTitle")}</div>
                  <p className="settings-hint">{t("settingsLauncherShortcutHint")}</p>
                  <div className="shortcut-row">
                    <div className={`shortcut-display ${recordingShortcut ? "recording" : ""}`}>
                      {recordingShortcut ? "..." : launcherShortcut}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={savingShortcut}
                      onClick={() => setRecordingShortcut(true)}
                    >
                      {recordingShortcut ? "..." : t("edit")}
                    </button>
                  </div>
                </div>

                <div className="settings-divider" />

                <div className="settings-section">
                  <div className="settings-section-title">{t("settingsClipboardSectionTitle")}</div>
                  <p className="settings-hint">{t("settingsClipboardSectionHint")}</p>

                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Pano Geçmişi Kısayolu</div>
                    <div className="shortcut-row">
                      <div className={`shortcut-display ${recordingClipboardShortcut ? "recording" : ""}`}>
                        {recordingClipboardShortcut ? "Yeni kısayola basın…" : clipboardShortcut}
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setRecordingClipboardShortcut(true)}
                      >
                        {recordingClipboardShortcut ? "Dinleniyor…" : "Değiştir"}
                      </button>
                    </div>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Tek Seferde Yüklenecek Kayıt Limiti</div>
                    <select
                      className="form-input"
                      value={clipboardPageSize}
                      onChange={async (e) => {
                        const nextSize = Number(e.target.value);
                        setClipboardPageSize(nextSize);
                        try {
                          await updateClipboardSettings(nextSize, clipboardLockWithVault, clipboardEnabled, clipboardPreviewDelayMs);
                          showToast(`Kayıt limiti ${nextSize} olarak güncellendi`, "success");
                        } catch (err) {
                          showToast(String(err), "error");
                        }
                      }}
                    >
                      <option value={25}>25 Kayıt</option>
                      <option value={50}>50 Kayıt</option>
                      <option value={100}>100 Kayıt (Önerilen)</option>
                      <option value={250}>250 Kayıt</option>
                      <option value={500}>500 Kayıt</option>
                      <option value={1000}>1.000 Kayıt</option>
                      <option value={2500}>2.500 Kayıt</option>
                      <option value={5000}>5.000 Kayıt (Geniş Arşiv)</option>
                      <option value={10000}>10.000 Kayıt (Maksimum)</option>
                    </select>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                      İçerik Detay Önizleme Gecikmesi (Mercek / Hover)
                    </div>
                    <select
                      className="form-input"
                      value={clipboardPreviewDelayMs}
                      onChange={async (e) => {
                        const nextDelay = Number(e.target.value);
                        setClipboardPreviewDelayMs(nextDelay);
                        try {
                          await updateClipboardSettings(clipboardPageSize, clipboardLockWithVault, clipboardEnabled, nextDelay);
                          showToast(
                            nextDelay === 0
                              ? "Önizleme gecikmesiz (anında) açılacak"
                              : `Önizleme gecikmesi ${nextDelay / 1000} saniye olarak güncellendi`,
                            "success"
                          );
                        } catch (err) {
                          showToast(String(err), "error");
                        }
                      }}
                    >
                      <option value={0}>Hemen Aç (0 saniye - Anında)</option>
                      <option value={500}>0.5 saniye</option>
                      <option value={1000}>1 saniye</option>
                      <option value={1500}>1.5 saniye</option>
                      <option value={2000}>2 saniye (Varsayılan)</option>
                      <option value={3000}>3 saniye</option>
                      <option value={4000}>4 saniye</option>
                      <option value={5000}>5 saniye</option>
                    </select>
                    <p className="settings-hint" style={{ marginTop: 4 }}>
                      İlk kayıtta belirlenen süre kadar duraklayınca açılır; ardından diğer kayıtlara geçildiğinde anında güncellenir.
                    </p>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={clipboardLockWithVault}
                        onChange={async (e) => {
                          const nextLock = e.target.checked;
                          setClipboardLockWithVault(nextLock);
                          try {
                            await updateClipboardSettings(clipboardPageSize, nextLock, clipboardEnabled, clipboardPreviewDelayMs, autoPasteOnSelect);
                            showToast(
                              nextLock
                                ? "Kasa kilitliyken pano geçmişi de kilitlenecek"
                                : "Pano geçmişi kasa kilidinden bağımsız çalışacak",
                              "success"
                            );
                          } catch (err) {
                            showToast(String(err), "error");
                          }
                        }}
                      />
                      Kasa kilitliyken pano geçmişini de kilitle
                    </label>

                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={clipboardEnabled}
                        onChange={async (e) => {
                          const nextEnabled = e.target.checked;
                          setClipboardEnabled(nextEnabled);
                          try {
                            await updateClipboardSettings(clipboardPageSize, clipboardLockWithVault, nextEnabled, clipboardPreviewDelayMs, autoPasteOnSelect);
                            showToast(
                              nextEnabled ? "Pano geçmişi kaydı aktif" : "Pano geçmişi kaydı duraklatıldı",
                              "success"
                            );
                          } catch (err) {
                            showToast(String(err), "error");
                          }
                        }}
                      />
                      Pano geçmişi izleyicisini aktif et
                    </label>

                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={autoPasteOnSelect}
                        onChange={async (e) => {
                          const nextAuto = e.target.checked;
                          setAutoPasteOnSelect(nextAuto);
                          try {
                            await updateClipboardSettings(
                              clipboardPageSize,
                              clipboardLockWithVault,
                              clipboardEnabled,
                              clipboardPreviewDelayMs,
                              nextAuto
                            );
                            showToast(
                              nextAuto
                                ? (lang === "tr" ? "Otomatik yapıştırma aktif" : "Auto-paste enabled")
                                : (lang === "tr" ? "Otomatik yapıştırma kapatıldı" : "Auto-paste disabled"),
                              "success"
                            );
                          } catch (err) {
                            showToast(String(err), "error");
                          }
                        }}
                      />
                      {t("settingsAutoPasteTitle")}
                    </label>
                    <p className="settings-hint" style={{ marginTop: 2, marginBottom: 4 }}>
                      {t("settingsAutoPasteHint")}
                    </p>
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ color: "#ef4444", borderColor: "rgba(239, 68, 68, 0.4)" }}
                    onClick={async () => {
                      if (window.confirm("Sabitlenmemiş tüm pano geçmişi silinecektir. Emin misiniz?")) {
                        try {
                          await clearClipboardHistory();
                          showToast("Pano geçmişi temizlendi", "success");
                        } catch (err) {
                          showToast(String(err), "error");
                        }
                      }
                    }}
                  >
                    Tüm Pano Geçmişini Temizle
                  </button>
                </div>

                <div className="settings-divider" />

                <div className="settings-section">
                  <div className="settings-section-title">{t("settingsScreenshotSectionTitle")}</div>
                  <p className="settings-hint">
                    {t("settingsScreenshotSectionHint")}
                  </p>

                  <div className="settings-field">
                    <label className="settings-label">{t("settingsScreenshotShortcut")}</label>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <button
                        type="button"
                        className={`btn ${recordingScreenshotShortcut ? "btn-primary" : "btn-secondary"}`}
                        onClick={() => setRecordingScreenshotShortcut(true)}
                      >
                        {recordingScreenshotShortcut ? "..." : screenshotShortcut}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={async () => {
                          try {
                            await triggerScreenshot();
                          } catch (err) {
                            showToast(String(err), "error");
                          }
                        }}
                      >
                        {lang === "tr" ? "Şimdi Yakala" : "Capture Now"}
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={screenshotNotificationEnabled}
                        onChange={async (e) => {
                          const next = e.target.checked;
                          setScreenshotNotificationEnabled(next);
                          try {
                            await updateScreenshotSettings(next);
                            showToast(
                              next
                                ? (lang === "tr" ? "Ekran görüntüsü bildirimi aktif" : "Screenshot notification enabled")
                                : (lang === "tr" ? "Ekran görüntüsü bildirimi kapatıldı" : "Screenshot notification disabled"),
                              "success"
                            );
                          } catch (err) {
                            showToast(String(err), "error");
                          }
                        }}
                      />
                      {t("settingsScreenshotNotify")}
                    </label>
                    <p className="settings-hint" style={{ marginTop: 4 }}>
                      {t("settingsScreenshotNotifyHint")}
                    </p>
                  </div>
                </div>

                <div className="settings-divider" />

                <div className="settings-section">
                  <div className="settings-section-title">{t("settingsAutoLockTitle")}</div>
                  <p className="settings-hint">{t("settingsAutoLockHint")}</p>
                  <select
                    className="form-input"
                    value={idleTimeout}
                    onChange={async (e) => {
                      const minutes = Number(e.target.value);
                      try {
                        await setIdleTimeout(minutes);
                        setIdleTimeoutState(minutes);
                        showToast(
                          minutes === 0
                            ? (lang === "tr" ? "Otomatik kilitleme devre dışı" : "Auto-lock disabled")
                            : (lang === "tr" ? `Otomatik kilitleme: ${minutes} dakika` : `Auto-lock set to ${minutes} min`),
                          "success"
                        );
                      } catch (err) {
                        showToast(String(err), "error");
                      }
                    }}
                  >
                    <option value={0}>{lang === "tr" ? "Devre Dışı (Kapatılmaz)" : "Never"}</option>
                    <option value={1}>1 {lang === "tr" ? "dakika" : "minute"}</option>
                    <option value={5}>5 {lang === "tr" ? "dakika" : "minutes"}</option>
                    <option value={15}>15 {lang === "tr" ? "dakika" : "minutes"}</option>
                    <option value={30}>30 {lang === "tr" ? "dakika" : "minutes"}</option>
                    <option value={60}>60 {lang === "tr" ? "dakika" : "minutes"}</option>
                  </select>
                </div>

                <div className="settings-divider" />

                <div className="settings-section">
                  <div className="settings-section-title">{t("settingsClipboardClearTitle")}</div>
                  <p className="settings-hint">{t("settingsClipboardClearHint")}</p>
                  <select
                    className="form-input"
                    value={clipboardClearSeconds}
                    onChange={async (e) => {
                      const secs = Number(e.target.value);
                      try {
                        await setClipboardClearSeconds(secs);
                        setClipboardClearSecondsState(secs);
                        showToast(
                          secs === 0
                            ? (lang === "tr" ? "Parola panodan otomatik silinmeyecek" : "Password won't be cleared automatically")
                            : (lang === "tr" ? `Parola panoda ${secs} saniye tutulacak` : `Password clipboard cleared after ${secs}s`),
                          "success"
                        );
                      } catch (err) {
                        showToast(String(err), "error");
                      }
                    }}
                  >
                    <option value={5}>5 {lang === "tr" ? "saniye" : "seconds"}</option>
                    <option value={10}>10 {lang === "tr" ? "saniye" : "seconds"}</option>
                    <option value={15}>15 {lang === "tr" ? "saniye (Varsayılan)" : "seconds (Default)"}</option>
                    <option value={30}>30 {lang === "tr" ? "saniye" : "seconds"}</option>
                    <option value={60}>60 {lang === "tr" ? "saniye (1 dakika)" : "seconds (1 minute)"}</option>
                    <option value={120}>120 {lang === "tr" ? "saniye (2 dakika)" : "seconds (2 minutes)"}</option>
                    <option value={0}>{lang === "tr" ? "Asla Temizleme (Devre Dışı)" : "Never Clear (Disabled)"}</option>
                  </select>
                </div>

                <div className="settings-divider" />

                <div className="settings-section">
                  <div className="settings-section-title">Start with Windows</div>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={autostartOn}
                      onChange={async (e) => {
                        const next = e.target.checked;
                        try {
                          if (next) await enableAutostart();
                          else await disableAutostart();
                          setAutostartOn(next);
                          showToast(next ? "Autostart enabled" : "Autostart disabled", "success");
                        } catch (err) {
                          showToast(String(err), "error");
                        }
                      }}
                    />
                    Launch PasCopyOf when I sign in
                  </label>
                </div>

                <div className="settings-divider" />

                <div className="settings-section">
                  <div className="settings-section-title">Backup &amp; Import</div>
                  <p className="settings-hint">
                    Backup keeps passwords encrypted. Restore replaces the current vault (same master password required).
                    CSV import supports KeePass/browser exports (`name,username,password,...`).
                  </p>
                  <div className="settings-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busyIo}
                      onClick={async () => {
                        const path = await save({
                          defaultPath: `PasCopyOf-backup-${new Date().toISOString().slice(0, 10)}.pascopyof`,
                          filters: [{ name: "PasCopyOf Backup", extensions: ["pascopyof"] }],
                        });
                        if (!path) return;
                        setBusyIo(true);
                        try {
                          await exportVault(path);
                          showToast("✓ Backup exported", "success");
                        } catch (err) {
                          showToast(String(err), "error");
                        } finally {
                          setBusyIo(false);
                        }
                      }}
                    >
                      Export Backup
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busyIo}
                      onClick={async () => {
                        const ok = window.confirm(
                          "Restore will replace ALL current vault data. Continue?"
                        );
                        if (!ok) return;
                        const path = await open({
                          multiple: false,
                          filters: [{ name: "PasCopyOf Backup", extensions: ["pascopyof", "json"] }],
                        });
                        if (!path || Array.isArray(path)) return;
                        setBusyIo(true);
                        try {
                          await restoreVault(path);
                          showToast("Vault restored — unlock with the backup master password", "success");
                          setShowChangePassword(false);
                          handleAutoLock();
                        } catch (err) {
                          showToast(String(err), "error");
                        } finally {
                          setBusyIo(false);
                        }
                      }}
                    >
                      Restore Backup
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busyIo}
                      onClick={async () => {
                        const path = await open({
                          multiple: false,
                          filters: [{ name: "CSV", extensions: ["csv"] }],
                        });
                        if (!path || Array.isArray(path)) return;
                        setBusyIo(true);
                        try {
                          const result = await importCsv(path);
                          showToast(
                            `Imported ${result.imported} · skipped ${result.skipped}`,
                            "success"
                          );
                          await loadCredentials(searchQuery);
                          await loadCategories();
                        } catch (err) {
                          showToast(String(err), "error");
                        } finally {
                          setBusyIo(false);
                        }
                      }}
                    >
                      Import CSV
                    </button>
                  </div>
                </div>

                <div className="settings-divider" />

                {/* Software Updates Section */}
                <div className="settings-section">
                  <div className="settings-section-title">{t("settingsUpdaterSectionTitle")}</div>
                  <p className="settings-hint">{t("settingsUpdaterSectionHint")}</p>

                  <div className="updater-box">
                    <div className="updater-header-row">
                      <div>
                        <span style={{ fontSize: 13, color: "var(--color-text-secondary)", marginRight: 8 }}>
                          {t("settingsUpdaterCurrentVersion")}:
                        </span>
                        <span className="updater-version-tag">
                          v{appVersion}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={updateChecking || downloadProgress !== null}
                        onClick={handleCheckUpdate}
                      >
                        {updateChecking ? t("settingsUpdaterChecking") : t("settingsUpdaterCheckBtn")}
                      </button>
                    </div>

                    {updateInfo && !updateInfo.available && (
                      <div className="updater-status-uptodate">
                        {t("settingsUpdaterUpToDate")}
                      </div>
                    )}

                    {updateInfo && updateInfo.available && (
                      <div className="updater-available-card">
                        <div className="updater-badge-new">
                          🚀 {t("settingsUpdaterNewVersion").replace("{version}", updateInfo.version || "")}
                        </div>
                        {updateInfo.body && (
                          <div className="updater-notes">
                            {updateInfo.body}
                          </div>
                        )}
                        {downloadProgress !== null ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <div className="updater-progress-track">
                              <div
                                className="updater-progress-fill"
                                style={{ width: `${downloadProgress}%` }}
                              />
                            </div>
                            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", textAlign: "right" }}>
                              {t("settingsUpdaterDownloading").replace("{percent}", String(downloadProgress))}
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleInstallUpdate}
                          >
                            {t("settingsUpdaterInstallBtn")}
                          </button>
                        )}
                      </div>
                    )}

                    {updateError && (
                      <div style={{ fontSize: 12, color: "var(--color-danger)", marginTop: 4 }}>
                        ⚠️ {updateError}
                      </div>
                    )}
                  </div>
                </div>

                <div className="settings-divider" />

                <div className="settings-section">
                  <div className="settings-section-title">Change Master Password</div>
                  <form onSubmit={handleChangeMasterPassword} className="editor-form" style={{ gap: 10 }}>
                    <input
                      type="password"
                      placeholder="Current Password"
                      className="form-input"
                      value={changePwForm.current}
                      onChange={(e) => setChangePwForm({ ...changePwForm, current: e.target.value })}
                    />
                    <input
                      type="password"
                      placeholder="New Password"
                      className="form-input"
                      value={changePwForm.next}
                      onChange={(e) => setChangePwForm({ ...changePwForm, next: e.target.value })}
                    />
                    <input
                      type="password"
                      placeholder="Confirm New Password"
                      className="form-input"
                      value={changePwForm.confirm}
                      onChange={(e) => setChangePwForm({ ...changePwForm, confirm: e.target.value })}
                    />
                    <div className="modal-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setShowChangePassword(false);
                          setRecordingShortcut(false);
                        }}
                      >
                        Close
                      </button>
                      <button type="submit" className="btn btn-primary">Update Password</button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          )}

          {showCategoryManager && (
            <div className="modal-overlay">
              <div className="modal-card" style={{ width: 500 }}>
                <div className="modal-title">Manage Categories</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
                  <div className="credential-list" style={{ maxHeight: 200, border: '1px solid var(--color-border)', borderRadius: 8 }}>
                    {categories.map(cat => (
                      <div key={cat.id} className="cred-item" onClick={() => setCatForm({ id: cat.id, name: cat.name, icon: cat.icon, color: cat.color })}>
                        <div className="cred-item-icon" style={{ background: cat.color + '22', color: cat.color }}>{cat.name[0]}</div>
                        <div className="cred-item-info">
                          <div className="cred-item-name">{cat.name}</div>
                          <div className="cred-item-user" style={{ opacity: 0.6 }}>Icon: {cat.icon}</div>
                        </div>
                        <button className="btn btn-danger btn-icon" onClick={(e) => { e.stopPropagation(); deleteCategory(cat.id).then(loadCategories); }}>🗑</button>
                      </div>
                    ))}
                    {categories.length === 0 && <div style={{ padding: 20, textAlign: 'center', opacity: 0.5 }}>No categories yet.</div>}
                  </div>

                  <div className="editor-form" style={{ background: 'rgba(255,255,255,0.02)', padding: 15, borderRadius: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{catForm.id ? "Edit Category" : "New Category"}</div>
                    <div className="form-group">
                      <label className="form-label">Name</label>
                      <input className="form-input" value={catForm.name} onChange={e => setCatForm({...catForm, name: e.target.value})} placeholder="e.g. DB, VPN, RDP..." />
                    </div>
                    <div className="form-group-row">
                      <div className="form-group">
                        <label className="form-label">Icon</label>
                        <select className="form-input" value={catForm.icon} onChange={e => setCatForm({...catForm, icon: e.target.value})}>
                          <option value="Database">Database</option>
                          <option value="Network">VPN / Network</option>
                          <option value="Terminal">RDP / SSH</option>
                          <option value="Cloud">Cloud</option>
                          <option value="Code">Source Code</option>
                          <option value="Key">General Password</option>
                          <option value="Shield">Security</option>
                          <option value="Mail">Email</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Color</label>
                        <input type="color" className="form-input" style={{ padding: 4, height: 38 }} value={catForm.color} onChange={e => setCatForm({...catForm, color: e.target.value})} />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button className="btn btn-primary" onClick={async () => {
                        if (!catForm.name) return;
                        if (catForm.id) {
                          await updateCategory(catForm.id, catForm.name, catForm.icon, catForm.color);
                        } else {
                          await addCategory(catForm.name, catForm.icon, catForm.color);
                        }
                        setCatForm({ id: null, name: "", icon: "Key", color: "#0ea5e9" });
                        loadCategories();
                      }}>{catForm.id ? "Update" : "Add"}</button>
                      {catForm.id && <button className="btn btn-secondary" onClick={() => setCatForm({ id: null, name: "", icon: "Key", color: "#0ea5e9" })}>Clear</button>}
                    </div>
                  </div>
                </div>
                <div className="modal-actions">
                  <button className="btn btn-secondary" onClick={() => setShowCategoryManager(false)}>Close</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
