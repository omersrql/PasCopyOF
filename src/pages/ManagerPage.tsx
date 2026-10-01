/**
 * ManagerPage.tsx — Vault management interface.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { MasterPasswordAuth } from "../components/MasterPasswordAuth";
import { TaskPlanner } from "../components/TaskPlanner";
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
  hasRecoveryKey,
  generateNewRecoveryKey,
  getPasswordHint,
  setPasswordHint,
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
  pickScreenshotFolder,
  openScreenshotFolder,
} from "../api/screenshot";
import {
  getTimerWidgetShortcut,
  setTimerWidgetShortcut,
  getTasksShortcut,
  setTasksShortcut,
  getQuickTaskShortcut,
  setQuickTaskShortcut,
} from "../api/tasks";
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
  const [activeTab, setActiveTab] = useState<"vault" | "tasks">("vault");
  const [credentials, setCredentials] = useState<CredentialSafe[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("idle");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "shortcuts" | "clipboard" | "screenshot" | "security" | "updates">("general");
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
  const [clipboardWindowMode, setClipboardWindowMode] = useState<"popup" | "fullscreen">("popup");
  const [clipboardCloseOnBlur, setClipboardCloseOnBlur] = useState<boolean>(true);
  const [clipboardCloseOnSpace, setClipboardCloseOnSpace] = useState<boolean>(true);
  const [clipboardClearSearchOnOpen, setClipboardClearSearchOnOpen] = useState<boolean>(true);
  const [panelScale, setPanelScale] = useState<"small" | "medium" | "large">("medium");

  // Screenshot Settings State
  const [screenshotShortcut, setScreenshotShortcutState] = useState("Ctrl+Shift+S");
  const [screenshotNotificationEnabled, setScreenshotNotificationEnabled] = useState(true);
  const [screenshotSaveDir, setScreenshotSaveDir] = useState("");
  const [screenshotDefaultSaveDir, setScreenshotDefaultSaveDir] = useState("");
  const [recordingScreenshotShortcut, setRecordingScreenshotShortcut] = useState(false);

  // Timer Widget Shortcut State
  const [timerWidgetShortcut, setTimerWidgetShortcutState] = useState("Ctrl+Shift+T");
  const [recordingTimerWidgetShortcut, setRecordingTimerWidgetShortcut] = useState(false);

  // Tasks Shortcut State
  const [tasksShortcut, setTasksShortcutState] = useState("Ctrl+Shift+P");
  const [recordingTasksShortcut, setRecordingTasksShortcut] = useState(false);

  // Quick Task Shortcut State
  const [quickTaskShortcut, setQuickTaskShortcutState] = useState("Ctrl+Shift+N");
  const [recordingQuickTaskShortcut, setRecordingQuickTaskShortcut] = useState(false);

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

  // Recovery Key & Password Hint State
  const [recoveryKeyConfigured, setRecoveryKeyConfigured] = useState(false);
  const [activeRecoveryKeyDisplay, setActiveRecoveryKeyDisplay] = useState<string | null>(null);
  const [copiedActiveRecoveryKey, setCopiedActiveRecoveryKey] = useState(false);
  const [generatingRecoveryKey, setGeneratingRecoveryKey] = useState(false);
  const [passwordHintInput, setPasswordHintInput] = useState("");
  const [savingPasswordHint, setSavingPasswordHint] = useState(false);

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
          windowMode: "popup" as const,
          closeOnBlur: true,
          closeOnSpace: true,
          clearSearchOnOpen: true,
          panelScale: "medium" as const,
        })),
        getScreenshotSettings().catch(() => ({
          shortcut: "Ctrl+Shift+S",
          notificationEnabled: true,
          saveDir: "",
          defaultSaveDir: "",
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
        setClipboardWindowMode((clipSettings.windowMode as "popup" | "fullscreen") || "popup");
        setClipboardCloseOnBlur(clipSettings.closeOnBlur ?? true);
        setClipboardCloseOnSpace(clipSettings.closeOnSpace ?? true);
        setClipboardClearSearchOnOpen(clipSettings.clearSearchOnOpen ?? true);
        if (clipSettings.panelScale) {
          setPanelScale((clipSettings.panelScale as "small" | "medium" | "large") || "medium");
        }
      }
      if (scSettings) {
        setScreenshotShortcutState(scSettings.shortcut);
        setScreenshotNotificationEnabled(scSettings.notificationEnabled);
        setScreenshotSaveDir(scSettings.saveDir || "");
        setScreenshotDefaultSaveDir(scSettings.defaultSaveDir || "");
      }
      getTimerWidgetShortcut().then(setTimerWidgetShortcutState).catch(() => {});
      getTasksShortcut().then(setTasksShortcutState).catch(() => {});
      getQuickTaskShortcut().then(setQuickTaskShortcutState).catch(() => {});
      hasRecoveryKey().then(setRecoveryKeyConfigured).catch(() => {});
      getPasswordHint().then((h) => setPasswordHintInput(h || "")).catch(() => {});
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

    const storedTask = localStorage.getItem("pascopyof_target_task_id");
    const storedTab = localStorage.getItem("pascopyof_target_tab");
    if (storedTask || storedTab === "tasks") {
      setActiveTab("tasks");
      localStorage.removeItem("pascopyof_target_tab");
    }

    const unlisten = listen("open-task-in-manager", () => {
      setActiveTab("tasks");
    });
    return () => {
      unlisten.then((u) => u());
    };
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

  useEffect(() => {
    if (!recordingTimerWidgetShortcut) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecordingTimerWidgetShortcut(false);
        return;
      }

      const next = shortcutFromEvent(e);
      if (!next) return;

      setRecordingTimerWidgetShortcut(false);
      void (async () => {
        try {
          await setTimerWidgetShortcut(next);
          setTimerWidgetShortcutState(next);
          showToast(`✓ Sayaç kısayolu ${next} olarak ayarlandı`, "success");
        } catch (err) {
          showToast(String(err), "error");
        }
      })();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingTimerWidgetShortcut, showToast]);

  useEffect(() => {
    if (!recordingTasksShortcut) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecordingTasksShortcut(false);
        return;
      }

      const next = shortcutFromEvent(e);
      if (!next) return;

      setRecordingTasksShortcut(false);
      void (async () => {
        try {
          await setTasksShortcut(next);
          setTasksShortcutState(next);
          showToast(
            lang === "tr"
              ? `✓ Görev kısayolu ${next} olarak ayarlandı`
              : `✓ Tasks shortcut set to ${next}`,
            "success"
          );
        } catch (err) {
          showToast(String(err), "error");
        }
      })();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingTasksShortcut, showToast, lang]);

  useEffect(() => {
    if (!recordingQuickTaskShortcut) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecordingQuickTaskShortcut(false);
        return;
      }

      const next = shortcutFromEvent(e);
      if (!next) return;

      setRecordingQuickTaskShortcut(false);
      void (async () => {
        try {
          await setQuickTaskShortcut(next);
          setQuickTaskShortcutState(next);
          showToast(
            lang === "tr"
              ? `✓ Hızlı görev kısayolu ${next} olarak ayarlandı`
              : `✓ Quick task shortcut set to ${next}`,
            "success"
          );
        } catch (err) {
          showToast(String(err), "error");
        }
      })();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingQuickTaskShortcut, showToast, lang]);

  const saveClipboardPrefs = useCallback(
    async (overrides: {
      pageSize?: number;
      lockWithVault?: boolean;
      enabled?: boolean;
      previewDelayMs?: number;
      autoPasteOnSelect?: boolean;
      windowMode?: "popup" | "fullscreen";
      closeOnBlur?: boolean;
      closeOnSpace?: boolean;
      clearSearchOnOpen?: boolean;
      panelScale?: "small" | "medium" | "large";
    }) => {
      const ps = overrides.pageSize ?? clipboardPageSize;
      const lwv = overrides.lockWithVault ?? clipboardLockWithVault;
      const en = overrides.enabled ?? clipboardEnabled;
      const pd = overrides.previewDelayMs ?? clipboardPreviewDelayMs;
      const ap = overrides.autoPasteOnSelect ?? autoPasteOnSelect;
      const wm = overrides.windowMode ?? clipboardWindowMode;
      const cob = overrides.closeOnBlur ?? clipboardCloseOnBlur;
      const cos = overrides.closeOnSpace ?? clipboardCloseOnSpace;
      const cso = overrides.clearSearchOnOpen ?? clipboardClearSearchOnOpen;
      const sc = overrides.panelScale ?? panelScale;
      await updateClipboardSettings(ps, lwv, en, pd, ap, wm, cob, cos, cso, sc);
    },
    [
      clipboardPageSize,
      clipboardLockWithVault,
      clipboardEnabled,
      clipboardPreviewDelayMs,
      autoPasteOnSelect,
      clipboardWindowMode,
      clipboardCloseOnBlur,
      clipboardCloseOnSpace,
      clipboardClearSearchOnOpen,
      panelScale,
    ]
  );

  useEffect(() => {
    if (!showChangePassword || recordingShortcut || recordingClipboardShortcut || recordingScreenshotShortcut || recordingTimerWidgetShortcut || recordingTasksShortcut || recordingQuickTaskShortcut) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setShowChangePassword(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showChangePassword, recordingShortcut, recordingClipboardShortcut, recordingScreenshotShortcut, recordingTimerWidgetShortcut, recordingTasksShortcut, recordingQuickTaskShortcut]);

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
      const rotatedKey = await changeMasterPassword(changePwForm.current, changePwForm.next);
      if (rotatedKey) {
        setActiveRecoveryKeyDisplay(rotatedKey);
        setRecoveryKeyConfigured(true);
        showToast(
          lang === "tr"
            ? "✓ Ana parola güncellendi. Yeni kurtarma anahtarınız oluşturuldu!"
            : "✓ Master password changed. A new recovery key was generated!",
          "success"
        );
      } else {
        showToast("✓ Master password changed", "success");
      }
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

  function downloadRecoveryKeyFile(key: string) {
    const content = `=====================================================
PasCopyOf - Acil Durum Kurtarma Anahtari (Emergency Recovery Kit)
Tarih: ${new Date().toLocaleString()}
=====================================================

Kurtarma Anahtariniz (Recovery Key):
${key}

ONEMLI GUVENLIK BILGISI:
Bu anahtar, PasCopyOf kasanizin ana sifresini unuttugunuzda
verilerinizi kurtarabilmenizi saglayan TEK anahtardir.
Lutfen bu dosyayi guvenli bir USB bellege, harici diske
veya parola yoneticinize kaydedin.
=====================================================`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pascopyof-recovery-key-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="manager-root">
      <div className="manager-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="manager-logo">
            <div className="manager-logo-dot" />
            {t("topbarAdmin")}
          </div>
          <div className="manager-nav-tabs">
            <button
              type="button"
              className={`manager-tab-btn ${activeTab === "vault" ? "active" : ""}`}
              onClick={() => setActiveTab("vault")}
            >
              🔐 {t("tabVault")}
            </button>
            <button
              type="button"
              className={`manager-tab-btn ${activeTab === "tasks" ? "active" : ""}`}
              onClick={() => setActiveTab("tasks")}
            >
              🎯 {t("tabTasks")}
            </button>
          </div>
        </div>

        {activeTab === "vault" && unlocked && (
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            {t("topbarCredentialsCount", { count: credentials.length })}
          </span>
        )}

        <div className="manager-topbar-right">
          {activeTab === "vault" && unlocked && (
            <>
              <button className="btn btn-secondary" onClick={() => setShowCategoryManager(true)}>{t("topbarCategories")}</button>
              <button className="btn btn-primary" onClick={handleNewCredential}>{t("topbarAddCredential")}</button>
            </>
          )}
          <button className="btn btn-secondary" onClick={() => {
            setShowChangePassword(true);
            loadSettings();
          }}>{t("topbarSettings")}</button>
          {unlocked && (
            <button className="btn btn-secondary" onClick={handleLock}>{t("topbarLock")}</button>
          )}
        </div>
      </div>

      {activeTab === "tasks" && <TaskPlanner showToast={showToast} />}

      {activeTab === "vault" && !unlocked && (
        <MasterPasswordAuth
          onUnlocked={() => {
            setUnlocked(true);
            loadCategories();
            loadSettings();
          }}
        />
      )}

      {activeTab === "vault" && unlocked && (
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
          )}

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
            <div
              className="modal-overlay"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setShowChangePassword(false);
                  setRecordingShortcut(false);
                  setRecordingClipboardShortcut(false);
                  setRecordingScreenshotShortcut(false);
                  setRecordingTimerWidgetShortcut(false);
                  setRecordingTasksShortcut(false);
                  setRecordingQuickTaskShortcut(false);
                }
              }}
            >
              <div className="modal-card settings-modal-tabbed">
                {/* Modal Header */}
                <div className="settings-modal-header">
                  <div>
                    <div className="settings-modal-title">⚙️ {t("settingsTitle")}</div>
                    <div className="settings-modal-subtitle">{t("settingsSubtitle")}</div>
                  </div>
                  <button
                    type="button"
                    className="btn-icon"
                    style={{
                      background: "transparent",
                      border: "none",
                      fontSize: 20,
                      cursor: "pointer",
                      color: "var(--color-text-secondary)",
                      padding: "4px 8px",
                      borderRadius: 6,
                      lineHeight: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.15s ease",
                    }}
                    onClick={() => {
                      setShowChangePassword(false);
                      setRecordingShortcut(false);
                      setRecordingClipboardShortcut(false);
                      setRecordingScreenshotShortcut(false);
                      setRecordingTimerWidgetShortcut(false);
                      setRecordingTasksShortcut(false);
                      setRecordingQuickTaskShortcut(false);
                    }}
                    title="Kapat (Esc)"
                  >
                    ✕
                  </button>
                </div>

                {/* Modal Body with Sidebar Tabs */}
                <div className="settings-modal-body">
                  {/* Left Sidebar Navigation */}
                  <div className="settings-sidebar">
                    <button
                      type="button"
                      className={`settings-nav-btn ${settingsTab === "general" ? "active" : ""}`}
                      onClick={() => setSettingsTab("general")}
                    >
                      <span className="nav-icon">🎨</span>
                      <span className="nav-text">{t("settingsTabGeneral")}</span>
                    </button>

                    <button
                      type="button"
                      className={`settings-nav-btn ${settingsTab === "shortcuts" ? "active" : ""}`}
                      onClick={() => setSettingsTab("shortcuts")}
                    >
                      <span className="nav-icon">⌨️</span>
                      <span className="nav-text">{t("settingsTabShortcuts")}</span>
                      <span className="nav-pill-badge">6</span>
                    </button>

                    <button
                      type="button"
                      className={`settings-nav-btn ${settingsTab === "clipboard" ? "active" : ""}`}
                      onClick={() => setSettingsTab("clipboard")}
                    >
                      <span className="nav-icon">📋</span>
                      <span className="nav-text">{t("settingsTabClipboard")}</span>
                    </button>

                    <button
                      type="button"
                      className={`settings-nav-btn ${settingsTab === "screenshot" ? "active" : ""}`}
                      onClick={() => setSettingsTab("screenshot")}
                    >
                      <span className="nav-icon">📸</span>
                      <span className="nav-text">{t("settingsTabScreenshot")}</span>
                    </button>

                    <button
                      type="button"
                      className={`settings-nav-btn ${settingsTab === "security" ? "active" : ""}`}
                      onClick={() => setSettingsTab("security")}
                    >
                      <span className="nav-icon">🔒</span>
                      <span className="nav-text">{t("settingsTabSecurity")}</span>
                    </button>

                    <button
                      type="button"
                      className={`settings-nav-btn ${settingsTab === "updates" ? "active" : ""}`}
                      onClick={() => setSettingsTab("updates")}
                    >
                      <span className="nav-icon">🚀</span>
                      <span className="nav-text">{t("settingsTabUpdates")}</span>
                      {updateInfo?.available && <span className="nav-pill-badge new">New</span>}
                    </button>
                  </div>

                  {/* Right Content Area */}
                  <div className="settings-content-pane">
                    {/* ─── TAB 1: Görünüm & Sistem ─── */}
                    {settingsTab === "general" && (
                      <>
                        <div className="settings-pane-header">
                          <div className="settings-pane-title">
                            <span>🎨</span>
                            <span>{t("settingsTabGeneral")}</span>
                          </div>
                          <div className="settings-pane-desc">
                            Uygulama teması, sistem dili ve açılış tercihlerini yapılandırın.
                          </div>
                        </div>

                        {/* Theme & Language */}
                        <div className="settings-card">
                          <div className="settings-card-title">
                            <span>🎭</span>
                            <span>{t("settingsAppearanceSection")}</span>
                          </div>
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

                        {/* Windows Autostart */}
                        <div className="settings-card">
                          <div className="settings-card-title">
                            <span>🖥️</span>
                            <span>Sistem Başlangıcı (Windows Autostart)</span>
                          </div>
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
                            <span>Bilgisayar açıldığında PasCopyOf'u arka planda başlat</span>
                          </label>
                          <p className="settings-hint" style={{ marginTop: -2 }}>
                            PasCopyOf sistem tepsisinde (tray) hafif bir servis olarak çalışmaya devam eder.
                          </p>
                        </div>

                        {/* Auto-Lock Timeout */}
                        <div className="settings-card">
                          <div className="settings-card-title">
                            <span>⏱️</span>
                            <span>{t("settingsAutoLockTitle")}</span>
                          </div>
                          <p className="settings-hint" style={{ margin: 0 }}>
                            {t("settingsAutoLockHint")}
                          </p>
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
                      </>
                    )}

                    {/* ─── TAB 2: Kısayol Tuşları (Unified Global Hub) ─── */}
                    {settingsTab === "shortcuts" && (
                      <>
                        <div className="settings-pane-header">
                          <div className="settings-pane-title">
                            <span>⌨️</span>
                            <span>{t("settingsShortcutsHeader")}</span>
                          </div>
                          <div className="settings-pane-desc">
                            {t("settingsShortcutsDesc")}
                          </div>
                        </div>

                        <div className="shortcut-hub-list">
                          {/* 1. Launcher */}
                          <div className="shortcut-hub-item">
                            <div className="shortcut-hub-left">
                              <div className="shortcut-hub-icon">🔑</div>
                              <div>
                                <div className="shortcut-hub-name">{t("settingsLauncherShortcutTitle")}</div>
                                <div className="shortcut-hub-desc">{t("settingsLauncherShortcutHint")}</div>
                              </div>
                            </div>
                            <div className="shortcut-hub-right">
                              <div className={`shortcut-display ${recordingShortcut ? "recording" : ""}`}>
                                {recordingShortcut ? (lang === "tr" ? "Tuşlara basın…" : "Press keys…") : launcherShortcut}
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

                          {/* 2. Clipboard History */}
                          <div className="shortcut-hub-item">
                            <div className="shortcut-hub-left">
                              <div className="shortcut-hub-icon">📋</div>
                              <div>
                                <div className="shortcut-hub-name">{t("settingsClipboardShortcut")}</div>
                                <div className="shortcut-hub-desc">Kopyalanan tüm geçmişi ve çoklu filtrelemeyi ekrana getirir.</div>
                              </div>
                            </div>
                            <div className="shortcut-hub-right">
                              <div className={`shortcut-display ${recordingClipboardShortcut ? "recording" : ""}`}>
                                {recordingClipboardShortcut ? (lang === "tr" ? "Tuşlara basın…" : "Press keys…") : clipboardShortcut}
                              </div>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setRecordingClipboardShortcut(true)}
                              >
                                {recordingClipboardShortcut ? "..." : t("edit")}
                              </button>
                            </div>
                          </div>

                          {/* 3. Screenshot */}
                          <div className="shortcut-hub-item">
                            <div className="shortcut-hub-left">
                              <div className="shortcut-hub-icon">📸</div>
                              <div>
                                <div className="shortcut-hub-name">{t("settingsScreenshotShortcut")}</div>
                                <div className="shortcut-hub-desc">Bölge seçimi, çizim araçları ve Windows OCR metin ayıklamayı başlatır.</div>
                              </div>
                            </div>
                            <div className="shortcut-hub-right">
                              <div className={`shortcut-display ${recordingScreenshotShortcut ? "recording" : ""}`}>
                                {recordingScreenshotShortcut ? (lang === "tr" ? "Tuşlara basın…" : "Press keys…") : screenshotShortcut}
                              </div>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setRecordingScreenshotShortcut(true)}
                              >
                                {recordingScreenshotShortcut ? "..." : t("edit")}
                              </button>
                            </div>
                          </div>

                          {/* 4. Floating Timer Widget */}
                          <div className="shortcut-hub-item">
                            <div className="shortcut-hub-left">
                              <div className="shortcut-hub-icon">⏱️</div>
                              <div>
                                <div className="shortcut-hub-name">{t("settingsTimerWidgetShortcutTitle")}</div>
                                <div className="shortcut-hub-desc">{t("settingsTimerWidgetShortcutHint")}</div>
                              </div>
                            </div>
                            <div className="shortcut-hub-right">
                              <div className={`shortcut-display ${recordingTimerWidgetShortcut ? "recording" : ""}`}>
                                {recordingTimerWidgetShortcut ? (lang === "tr" ? "Tuşlara basın…" : "Press keys…") : timerWidgetShortcut}
                              </div>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setRecordingTimerWidgetShortcut(true)}
                              >
                                {recordingTimerWidgetShortcut ? "..." : t("edit")}
                              </button>
                            </div>
                          </div>

                          {/* 5. Tasks Window */}
                          <div className="shortcut-hub-item">
                            <div className="shortcut-hub-left">
                              <div className="shortcut-hub-icon">📊</div>
                              <div>
                                <div className="shortcut-hub-name">{t("settingsTasksShortcutTitle")}</div>
                                <div className="shortcut-hub-desc">{t("settingsTasksShortcutHint")}</div>
                              </div>
                            </div>
                            <div className="shortcut-hub-right">
                              <div className={`shortcut-display ${recordingTasksShortcut ? "recording" : ""}`}>
                                {recordingTasksShortcut ? (lang === "tr" ? "Tuşlara basın…" : "Press keys…") : tasksShortcut}
                              </div>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setRecordingTasksShortcut(true)}
                              >
                                {recordingTasksShortcut ? "..." : t("edit")}
                              </button>
                            </div>
                          </div>

                          {/* 6. Quick Task Creator */}
                          <div className="shortcut-hub-item">
                            <div className="shortcut-hub-left">
                              <div className="shortcut-hub-icon">⚡</div>
                              <div>
                                <div className="shortcut-hub-name">{t("settingsQuickTaskShortcutTitle")}</div>
                                <div className="shortcut-hub-desc">{t("settingsQuickTaskShortcutHint")}</div>
                              </div>
                            </div>
                            <div className="shortcut-hub-right">
                              <div className={`shortcut-display ${recordingQuickTaskShortcut ? "recording" : ""}`}>
                                {recordingQuickTaskShortcut ? (lang === "tr" ? "Tuşlara basın…" : "Press keys…") : quickTaskShortcut}
                              </div>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setRecordingQuickTaskShortcut(true)}
                              >
                                {recordingQuickTaskShortcut ? "..." : t("edit")}
                              </button>
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {/* ─── TAB 3: Pano Geçmişi ─── */}
                    {settingsTab === "clipboard" && (
                      <>
                        <div className="settings-pane-header">
                          <div className="settings-pane-title">
                            <span>📋</span>
                            <span>{t("settingsTabClipboard")}</span>
                          </div>
                          <div className="settings-pane-desc">
                            {t("settingsClipboardSectionHint")}
                          </div>
                        </div>

                        {/* Format & Size Limits */}
                        <div className="settings-card">
                          <div className="settings-card-title">
                            <span>📊</span>
                            <span>{t("settingsClipboardRecordLimit")}</span>
                          </div>
                          <select
                            className="form-input"
                            value={clipboardPageSize}
                            onChange={async (e) => {
                              const nextSize = Number(e.target.value);
                              setClipboardPageSize(nextSize);
                              try {
                                await saveClipboardPrefs({ pageSize: nextSize });
                                showToast(`Kayıt limiti ${nextSize} olarak güncellendi`, "success");
                              } catch (err) {
                                showToast(String(err), "error");
                              }
                            }}
                          >
                            <option value={15}>15 Kayıt (Hafif Görünüm)</option>
                            <option value={25}>25 Kayıt</option>
                            <option value={50}>50 Kayıt</option>
                            <option value={100}>100 Kayıt (Önerilen)</option>
                            <option value={200}>200 Kayıt</option>
                            <option value={500}>500 Kayıt</option>
                            <option value={1000}>1.000 Kayıt</option>
                            <option value={2500}>2.500 Kayıt</option>
                            <option value={5000}>5.000 Kayıt (Geniş Arşiv)</option>
                            <option value={10000}>10.000 Kayıt (Maksimum)</option>
                          </select>
                          <p className="settings-hint" style={{ margin: 0 }}>
                            {t("settingsClipPageSizeHint")}
                          </p>
                        </div>

                        {/* Window Format & Modes */}
                        <div className="settings-card">
                          <div className="settings-card-title">
                            <span>🗖</span>
                            <span>{t("settingsClipWindowMode")}</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <button
                              type="button"
                              onClick={async () => {
                                setClipboardWindowMode("popup");
                                try {
                                  await saveClipboardPrefs({ windowMode: "popup" });
                                  showToast("Pano formatı: Açılır Pencere (Popup)", "success");
                                } catch (err) {
                                  showToast(String(err), "error");
                                }
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "10px 14px",
                                borderRadius: 8,
                                border: clipboardWindowMode === "popup"
                                  ? "2px solid #0ea5e9"
                                  : "1px solid rgba(255, 255, 255, 0.12)",
                                background: clipboardWindowMode === "popup"
                                  ? "rgba(14, 165, 233, 0.15)"
                                  : "rgba(255, 255, 255, 0.03)",
                                color: "#fff",
                                cursor: "pointer",
                                textAlign: "left",
                                transition: "all 0.18s ease",
                              }}
                            >
                              <span style={{ fontSize: 20 }}>🗗</span>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>
                                  {t("settingsClipWindowModePopup")}
                                </div>
                                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
                                  900 × 500 px (Kompakt)
                                </div>
                              </div>
                            </button>

                            <button
                              type="button"
                              onClick={async () => {
                                setClipboardWindowMode("fullscreen");
                                try {
                                  await saveClipboardPrefs({ windowMode: "fullscreen" });
                                  showToast("Pano formatı: Tam Ekran (Fullscreen)", "success");
                                } catch (err) {
                                  showToast(String(err), "error");
                                }
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "10px 14px",
                                borderRadius: 8,
                                border: clipboardWindowMode === "fullscreen"
                                  ? "2px solid #0ea5e9"
                                  : "1px solid rgba(255, 255, 255, 0.12)",
                                background: clipboardWindowMode === "fullscreen"
                                  ? "rgba(14, 165, 233, 0.15)"
                                  : "rgba(255, 255, 255, 0.03)",
                                color: "#fff",
                                cursor: "pointer",
                                textAlign: "left",
                                transition: "all 0.18s ease",
                              }}
                            >
                              <span style={{ fontSize: 20 }}>⛶</span>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>
                                  {t("settingsClipWindowModeFullscreen")}
                                </div>
                                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
                                  Tüm Ekran (Geniş Odak)
                                </div>
                              </div>
                            </button>
                          </div>
                        </div>

                        {/* Panel Scale & Live Preview */}
                        <div className="settings-card">
                          <div className="settings-card-title">
                            <span>🔍</span>
                            <span>{t("settingsPanelScaleTitle")}</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                            {[
                              { id: "small" as const, label: t("settingsPanelScaleSmall"), desc: "85%" },
                              { id: "medium" as const, label: t("settingsPanelScaleMedium"), desc: "100%" },
                              { id: "large" as const, label: t("settingsPanelScaleLarge"), desc: "118%" },
                            ].map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={async () => {
                                  setPanelScale(opt.id);
                                  try {
                                    await saveClipboardPrefs({ panelScale: opt.id });
                                    showToast(
                                      lang === "tr"
                                        ? `Pano ölçeği ${opt.desc} olarak ayarlandı`
                                        : `Panel scale set to ${opt.desc}`,
                                      "success"
                                    );
                                  } catch (err) {
                                    showToast(String(err), "error");
                                  }
                                }}
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  padding: "8px 6px",
                                  borderRadius: 8,
                                  cursor: "pointer",
                                  border: panelScale === opt.id ? "2px solid #0ea5e9" : "1px solid rgba(255, 255, 255, 0.12)",
                                  background: panelScale === opt.id ? "rgba(14, 165, 233, 0.15)" : "rgba(255, 255, 255, 0.03)",
                                  color: "#fff",
                                  transition: "all 0.15s ease",
                                }}
                              >
                                <span style={{ fontWeight: 600, fontSize: 12.5 }}>{opt.label.split(" ")[0]}</span>
                                <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>{opt.desc}</span>
                              </button>
                            ))}
                          </div>

                          {/* Live Preview Box */}
                          <div
                            style={{
                              padding: panelScale === "small" ? "6px 10px" : panelScale === "large" ? "12px 14px" : "9px 12px",
                              background: "rgba(255, 255, 255, 0.03)",
                              border: "1px dashed rgba(255, 255, 255, 0.2)",
                              borderRadius: panelScale === "small" ? 6 : panelScale === "large" ? 12 : 8,
                              display: "flex",
                              alignItems: "center",
                              gap: panelScale === "small" ? 8 : panelScale === "large" ? 14 : 10,
                              transition: "all 0.2s ease-in-out",
                              marginTop: 4,
                            }}
                          >
                            <div
                              style={{
                                width: panelScale === "small" ? 22 : panelScale === "large" ? 34 : 28,
                                height: panelScale === "small" ? 22 : panelScale === "large" ? 34 : 28,
                                borderRadius: 6,
                                background: "rgba(14, 165, 233, 0.25)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: panelScale === "small" ? 11 : panelScale === "large" ? 16 : 13,
                              }}
                            >
                              📋
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: panelScale === "small" ? 11.5 : panelScale === "large" ? 14.5 : 13,
                                  fontWeight: 500,
                                  color: "var(--color-text-primary)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {t("settingsPanelScalePreview")} — https://example.com/api/v1/auth
                              </div>
                              <div
                                style={{
                                  fontSize: panelScale === "small" ? 10 : panelScale === "large" ? 12 : 11,
                                  color: "var(--color-text-secondary)",
                                  marginTop: 2,
                                }}
                              >
                                {panelScale === "small"
                                  ? (lang === "tr" ? "Kompakt Önizleme Boyutu (Küçük)" : "Compact Preview Scale (Small)")
                                  : panelScale === "large"
                                  ? (lang === "tr" ? "Geniş & Rahat Okuma Boyutu (Büyük)" : "Spacious Preview Scale (Large)")
                                  : (lang === "tr" ? "Dengeli Standart Önizleme Boyutu (Orta)" : "Standard Balanced Preview (Medium)")}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Behavior Toggles */}
                        <div className="settings-card">
                          <div className="settings-card-title">
                            <span>⚙️</span>
                            <span>Davranış & Güvenlik Tercihleri</span>
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <label className="settings-toggle">
                              <input
                                type="checkbox"
                                checked={clipboardEnabled}
                                onChange={async (e) => {
                                  const nextEnabled = e.target.checked;
                                  setClipboardEnabled(nextEnabled);
                                  try {
                                    await saveClipboardPrefs({ enabled: nextEnabled });
                                    showToast(
                                      nextEnabled ? "Pano geçmişi kaydı aktif" : "Pano geçmişi kaydı duraklatıldı",
                                      "success"
                                    );
                                  } catch (err) {
                                    showToast(String(err), "error");
                                  }
                                }}
                              />
                              <span>Pano geçmişi izleyicisini aktif et</span>
                            </label>

                            <label className="settings-toggle">
                              <input
                                type="checkbox"
                                checked={clipboardLockWithVault}
                                onChange={async (e) => {
                                  const nextLock = e.target.checked;
                                  setClipboardLockWithVault(nextLock);
                                  try {
                                    await saveClipboardPrefs({ lockWithVault: nextLock });
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
                              <span>Kasa kilitliyken pano geçmişini de kilitle</span>
                            </label>

                            <label className="settings-toggle">
                              <input
                                type="checkbox"
                                checked={autoPasteOnSelect}
                                onChange={async (e) => {
                                  const nextAuto = e.target.checked;
                                  setAutoPasteOnSelect(nextAuto);
                                  try {
                                    await saveClipboardPrefs({ autoPasteOnSelect: nextAuto });
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
                              <span>{t("settingsAutoPasteTitle")}</span>
                            </label>

                            <label className="settings-toggle">
                              <input
                                type="checkbox"
                                checked={clipboardCloseOnBlur}
                                onChange={async (e) => {
                                  const nextBlur = e.target.checked;
                                  setClipboardCloseOnBlur(nextBlur);
                                  try {
                                    await saveClipboardPrefs({ closeOnBlur: nextBlur });
                                  } catch (err) {
                                    showToast(String(err), "error");
                                  }
                                }}
                              />
                              <span>{t("settingsClipCloseOnBlur")}</span>
                            </label>

                            <label className="settings-toggle">
                              <input
                                type="checkbox"
                                checked={clipboardCloseOnSpace}
                                onChange={async (e) => {
                                  const nextSpace = e.target.checked;
                                  setClipboardCloseOnSpace(nextSpace);
                                  try {
                                    await saveClipboardPrefs({ closeOnSpace: nextSpace });
                                  } catch (err) {
                                    showToast(String(err), "error");
                                  }
                                }}
                              />
                              <span>{t("settingsClipCloseOnSpace")}</span>
                            </label>

                            <label className="settings-toggle">
                              <input
                                type="checkbox"
                                checked={clipboardClearSearchOnOpen}
                                onChange={async (e) => {
                                  const nextClear = e.target.checked;
                                  setClipboardClearSearchOnOpen(nextClear);
                                  try {
                                    await saveClipboardPrefs({ clearSearchOnOpen: nextClear });
                                  } catch (err) {
                                    showToast(String(err), "error");
                                  }
                                }}
                              />
                              <span>{t("settingsClearSearchOnOpen")}</span>
                            </label>
                          </div>
                        </div>

                        {/* Danger zone: Clear */}
                        <div className="settings-card" style={{ borderColor: "rgba(239, 68, 68, 0.3)" }}>
                          <div className="settings-card-title" style={{ color: "#ef4444" }}>
                            <span>🗑️</span>
                            <span>Pano Geçmişini Sıfırla</span>
                          </div>
                          <p className="settings-hint" style={{ margin: 0 }}>
                            Sabitlenmemiş (yıldızsız) tüm pano geçmişi yerel veritabanından kalıcı olarak silinir.
                          </p>
                          <div>
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
                        </div>
                      </>
                    )}

                    {/* ─── TAB 4: Ekran Alıntısı ─── */}
                    {settingsTab === "screenshot" && (
                      <>
                        <div className="settings-pane-header">
                          <div className="settings-pane-title">
                            <span>📸</span>
                            <span>{t("settingsTabScreenshot")}</span>
                          </div>
                          <div className="settings-pane-desc">
                            {t("settingsScreenshotSectionHint")}
                          </div>
                        </div>

                        {/* Test & Trigger */}
                        <div className="settings-card">
                          <div className="settings-card-title">
                            <span>⚡</span>
                            <span>Hızlı Yakalama & Test</span>
                          </div>
                          <p className="settings-hint" style={{ margin: 0 }}>
                            Ekran alıntısı modunu hemen test edebilir veya kısayol tuşunu kullanabilirsiniz.
                          </p>
                          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={async () => {
                                try {
                                  await triggerScreenshot();
                                } catch (err) {
                                  showToast(String(err), "error");
                                }
                              }}
                            >
                              📸 {lang === "tr" ? "Şimdi Yakala" : "Capture Now"}
                            </button>
                            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                              veya <strong>{screenshotShortcut}</strong> tuşlayın
                            </span>
                          </div>
                        </div>

                        {/* Save Directory */}
                        <div className="settings-card">
                          <div className="settings-card-title">
                            <span>📁</span>
                            <span>{t("settingsScreenshotSaveDirTitle")}</span>
                          </div>
                          <p className="settings-hint" style={{ margin: 0 }}>
                            {t("settingsScreenshotSaveDirHint")}
                          </p>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "8px 12px",
                              borderRadius: "8px",
                              background: "rgba(255, 255, 255, 0.04)",
                              border: "1px solid var(--border-color)",
                              fontSize: "12px",
                              fontFamily: "monospace",
                              color: "var(--text-primary)",
                              wordBreak: "break-all",
                            }}
                          >
                            <span>{screenshotSaveDir || screenshotDefaultSaveDir || "Pictures\\PasCopyOf"}</span>
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={async () => {
                                try {
                                  const selected = await pickScreenshotFolder();
                                  if (selected) {
                                    const updated = await updateScreenshotSettings(
                                      screenshotNotificationEnabled,
                                      selected
                                    );
                                    setScreenshotSaveDir(updated.saveDir);
                                    setScreenshotDefaultSaveDir(updated.defaultSaveDir);
                                    showToast(
                                      lang === "tr"
                                        ? `Kayıt dizini güncellendi: ${updated.saveDir}`
                                        : `Save directory updated: ${updated.saveDir}`,
                                      "success"
                                    );
                                  }
                                } catch (err) {
                                  showToast(String(err), "error");
                                }
                              }}
                            >
                              📁 {t("settingsScreenshotBrowseBtn")}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={async () => {
                                try {
                                  await openScreenshotFolder();
                                } catch (err) {
                                  showToast(String(err), "error");
                                }
                              }}
                            >
                              📂 {t("settingsScreenshotOpenFolderBtn")}
                            </button>
                            {screenshotSaveDir &&
                              screenshotDefaultSaveDir &&
                              screenshotSaveDir !== screenshotDefaultSaveDir && (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={async () => {
                                    try {
                                      const updated = await updateScreenshotSettings(
                                        screenshotNotificationEnabled,
                                        ""
                                      );
                                      setScreenshotSaveDir(updated.saveDir);
                                      setScreenshotDefaultSaveDir(updated.defaultSaveDir);
                                      showToast(
                                        lang === "tr"
                                          ? `Varsayılan kayıt dizinine dönüldü: ${updated.saveDir}`
                                          : `Reset to default directory: ${updated.saveDir}`,
                                        "success"
                                      );
                                    } catch (err) {
                                      showToast(String(err), "error");
                                    }
                                  }}
                                >
                                  ↺ {t("settingsScreenshotResetDirBtn")}
                                </button>
                              )}
                          </div>
                        </div>

                        {/* Notifications */}
                        <div className="settings-card">
                          <div className="settings-card-title">
                            <span>🔔</span>
                            <span>Bildirim Tercihleri</span>
                          </div>
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
                            <span>{t("settingsScreenshotNotify")}</span>
                          </label>
                          <p className="settings-hint" style={{ marginTop: -2 }}>
                            {t("settingsScreenshotNotifyHint")}
                          </p>
                        </div>
                      </>
                    )}

                    {/* ─── TAB 5: Güvenlik & Kasa ─── */}
                    {settingsTab === "security" && (
                      <>
                        <div className="settings-pane-header">
                          <div className="settings-pane-title">
                            <span>🔒</span>
                            <span>{t("settingsTabSecurity")}</span>
                          </div>
                          <div className="settings-pane-desc">
                            Ana parola yönetimi, pano temizliği ve şifreli kasa yedekleme işlemleri.
                          </div>
                        </div>

                        {/* Change Master Password */}
                        <div className="settings-card">
                          <div className="settings-card-title">
                            <span>🔑</span>
                            <span>Ana Parola Değiştir (Change Master Password)</span>
                          </div>
                          <form onSubmit={handleChangeMasterPassword} className="editor-form" style={{ gap: 10 }}>
                            <input
                              type="password"
                              placeholder="Mevcut Ana Parola"
                              className="form-input"
                              value={changePwForm.current}
                              onChange={(e) => setChangePwForm({ ...changePwForm, current: e.target.value })}
                            />
                            <input
                              type="password"
                              placeholder="Yeni Ana Parola"
                              className="form-input"
                              value={changePwForm.next}
                              onChange={(e) => setChangePwForm({ ...changePwForm, next: e.target.value })}
                            />
                            <input
                              type="password"
                              placeholder="Yeni Ana Parolayı Onayla"
                              className="form-input"
                              value={changePwForm.confirm}
                              onChange={(e) => setChangePwForm({ ...changePwForm, confirm: e.target.value })}
                            />
                            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                              <button type="submit" className="btn btn-primary">Parolayı Güncelle</button>
                            </div>
                          </form>
                        </div>

                        {/* Emergency Recovery Key Card */}
                        <div className="settings-card">
                          <div className="settings-card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span>🛡️</span>
                              <span>{t("settingsRecoveryCardTitle")}</span>
                            </div>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: "3px 8px",
                                borderRadius: 6,
                                backgroundColor: recoveryKeyConfigured ? "rgba(34, 197, 94, 0.15)" : "rgba(234, 179, 8, 0.15)",
                                color: recoveryKeyConfigured ? "var(--color-success, #22c55e)" : "var(--color-warning, #eab308)",
                              }}
                            >
                              {recoveryKeyConfigured ? t("settingsRecoveryActiveBadge") : t("settingsRecoveryInactiveBadge")}
                            </span>
                          </div>
                          <p className="settings-hint" style={{ margin: 0 }}>
                            {t("settingsRecoveryCardDesc")}
                          </p>

                          {activeRecoveryKeyDisplay && (
                            <div className="recovery-key-display-box" style={{ margin: "10px 0" }}>
                              <div className="recovery-key-code">{activeRecoveryKeyDisplay}</div>
                              <div className="recovery-key-actions">
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => {
                                    navigator.clipboard.writeText(activeRecoveryKeyDisplay);
                                    setCopiedActiveRecoveryKey(true);
                                    setTimeout(() => setCopiedActiveRecoveryKey(false), 2500);
                                  }}
                                >
                                  {copiedActiveRecoveryKey ? t("onboardingKeyCopied") : t("onboardingKeyCopyBtn")}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => downloadRecoveryKeyFile(activeRecoveryKeyDisplay)}
                                >
                                  {t("onboardingKeyDownloadBtn")}
                                </button>
                              </div>
                            </div>
                          )}

                          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={generatingRecoveryKey}
                              onClick={async () => {
                                setGeneratingRecoveryKey(true);
                                try {
                                  const key = await generateNewRecoveryKey();
                                  setActiveRecoveryKeyDisplay(key);
                                  setRecoveryKeyConfigured(true);
                                  showToast(
                                    lang === "tr"
                                      ? "✓ Yeni kurtarma anahtarı üretildi. Lütfen güvenle saklayın!"
                                      : "✓ New recovery key generated. Please save it securely!",
                                    "success"
                                  );
                                } catch (err) {
                                  showToast(String(err), "error");
                                } finally {
                                  setGeneratingRecoveryKey(false);
                                }
                              }}
                            >
                              {generatingRecoveryKey ? t("loading") : t("settingsRecoveryGenerateBtn")}
                            </button>
                          </div>
                        </div>

                        {/* Password Hint Card */}
                        <div className="settings-card">
                          <div className="settings-card-title">
                            <span>💡</span>
                            <span>{t("settingsPasswordHintTitle")}</span>
                          </div>
                          <p className="settings-hint" style={{ margin: 0 }}>
                            {t("settingsPasswordHintDesc")}
                          </p>
                          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                            <input
                              type="text"
                              className="form-input"
                              placeholder={t("authPasswordHintPlaceholder")}
                              value={passwordHintInput}
                              onChange={(e) => setPasswordHintInput(e.target.value)}
                              disabled={savingPasswordHint}
                            />
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ whiteSpace: "nowrap" }}
                              disabled={savingPasswordHint}
                              onClick={async () => {
                                setSavingPasswordHint(true);
                                try {
                                  await setPasswordHint(passwordHintInput.trim() || null);
                                  showToast(t("settingsPasswordHintSavedToast"), "success");
                                } catch (err) {
                                  showToast(String(err), "error");
                                } finally {
                                  setSavingPasswordHint(false);
                                }
                              }}
                            >
                              {savingPasswordHint ? t("loading") : t("settingsPasswordHintSaveBtn")}
                            </button>
                          </div>
                        </div>

                        {/* Password Clipboard Clear Seconds */}
                        <div className="settings-card">
                          <div className="settings-card-title">
                            <span>⏱️</span>
                            <span>{t("settingsClipboardClearTitle")}</span>
                          </div>
                          <p className="settings-hint" style={{ margin: 0 }}>
                            {t("settingsClipboardClearHint")}
                          </p>
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

                        {/* Backup & Import */}
                        <div className="settings-card">
                          <div className="settings-card-title">
                            <span>💾</span>
                            <span>Kasa Yedekleme & İçe Aktarma (Backup & Import)</span>
                          </div>
                          <p className="settings-hint" style={{ margin: 0 }}>
                            Yedekleme dosyanız (.pascopyof) tüm parolalarınızı şifreli olarak saklar. Geri yükleme mevcut kasayı değiştirir.
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
                              Export Backup (.pascopyof)
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
                      </>
                    )}

                    {/* ─── TAB 6: Güncellemeler & Bilgi ─── */}
                    {settingsTab === "updates" && (
                      <>
                        <div className="settings-pane-header">
                          <div className="settings-pane-title">
                            <span>🚀</span>
                            <span>{t("settingsTabUpdates")}</span>
                          </div>
                          <div className="settings-pane-desc">
                            {t("settingsUpdaterSectionHint")}
                          </div>
                        </div>

                        {/* Update box */}
                        <div className="settings-card">
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

                        {/* About Architecture Box */}
                        <div className="settings-card">
                          <div className="settings-card-title">
                            <span>🛡️</span>
                            <span>PasCopyOf Güvenlik Mimarisi</span>
                          </div>
                          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6, margin: 0 }}>
                            PasCopyOf, parolalarınızı, pano geçmişinizi ve zaman kayıtlarınızı üçüncü taraf sunuculara göndermeden, tamamen yerel SQLite veritabanında <strong>Argon2id</strong> anahtar türetimi ve <strong>AES-256-GCM</strong> şifreleme algoritması ile korur.
                          </p>
                        </div>
                      </>
                    )}
                  </div>
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
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
