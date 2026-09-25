/**
 * SaveToVaultModal.tsx — Quick save modal to add clipboard items directly to the password vault.
 */
import React, { useState, useEffect, useRef } from "react";
import {
  isVaultUnlocked,
  unlockVault,
  getCategories,
  addCategory,
  addCredential,
} from "../api/vault";
import type { Category } from "../api/vault";
import { useApp } from "../context/AppContext";

interface SaveToVaultModalProps {
  initialText: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (keyName: string) => void;
}

const PRESET_COLORS = ["#38bdf8", "#4ade80", "#fbbf24", "#c084fc", "#f43f5e", "#a855f7"];

export function SaveToVaultModal({
  initialText,
  isOpen,
  onClose,
  onSuccess,
}: SaveToVaultModalProps) {
  const { t, lang } = useApp();

  const [unlocked, setUnlocked] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Unlock state
  const [masterPassword, setMasterPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  // Credential form state
  const [keyName, setKeyName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(initialText || "");
  const [notes, setNotes] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Inline new category creation state
  const [showNewCatInput, setShowNewCatInput] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState(PRESET_COLORS[0]);
  const [creatingCat, setCreatingCat] = useState(false);

  const keyNameInputRef = useRef<HTMLInputElement>(null);
  const masterPasswordInputRef = useRef<HTMLInputElement>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);

  // Check auth and initialize when opened
  useEffect(() => {
    if (!isOpen) return;

    setPassword(initialText || "");
    setKeyName("");
    setUsername("");
    setNotes("");
    setCategoryId(null);
    setFormError("");
    setUnlockError("");
    setMasterPassword("");
    setShowNewCatInput(false);

    setCheckingAuth(true);
    isVaultUnlocked()
      .then((ok) => {
        setUnlocked(ok);
        setCheckingAuth(false);
        if (ok) {
          loadCategoriesList();
          setTimeout(() => keyNameInputRef.current?.focus(), 80);
        } else {
          setTimeout(() => masterPasswordInputRef.current?.focus(), 80);
        }
      })
      .catch(() => {
        setUnlocked(false);
        setCheckingAuth(false);
        setTimeout(() => masterPasswordInputRef.current?.focus(), 80);
      });
  }, [isOpen, initialText]);

  const loadCategoriesList = async () => {
    try {
      const cats = await getCategories();
      setCategories(cats);
    } catch (err) {
      console.error("Failed to load categories:", err);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterPassword.trim() || unlocking) return;
    setUnlocking(true);
    setUnlockError("");

    try {
      const ok = await unlockVault(masterPassword);
      if (ok) {
        setUnlocked(true);
        loadCategoriesList();
        setTimeout(() => keyNameInputRef.current?.focus(), 80);
      } else {
        setUnlockError(t("clipVaultUnlockError"));
      }
    } catch {
      setUnlockError(t("clipVaultUnlockError"));
    } finally {
      setUnlocking(false);
    }
  };

  const handleCreateCategory = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!newCatName.trim() || creatingCat) return;
    setCreatingCat(true);
    try {
      const newId = await addCategory(newCatName.trim(), "📁", newCatColor);
      await loadCategoriesList();
      setCategoryId(newId);
      setShowNewCatInput(false);
      setNewCatName("");
    } catch (err) {
      console.error("Failed to add category:", err);
    } finally {
      setCreatingCat(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) {
      setFormError(lang === "tr" ? "Lütfen bir başlık girin." : "Please enter a title.");
      keyNameInputRef.current?.focus();
      return;
    }
    if (!password) {
      setFormError(lang === "tr" ? "Şifre veya metin boş olamaz." : "Password cannot be empty.");
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      await addCredential({
        keyName: keyName.trim(),
        username: username.trim(),
        password,
        notes: notes.trim(),
        categoryId: categoryId || null,
      });
      onSuccess(keyName.trim());
      onClose();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="clip-vault-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
      ref={modalContainerRef}
    >
      <div className="clip-vault-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="clip-vault-modal-header">
          <div className="clip-vault-modal-title-wrap">
            <span className="clip-vault-modal-icon">🔒</span>
            <div>
              <div className="clip-vault-modal-title">{t("clipVaultModalTitle")}</div>
              <div className="clip-vault-modal-sub">{t("clipVaultModalSub")}</div>
            </div>
          </div>
          <button className="clip-vault-modal-close" onClick={onClose} title={t("close")}>
            ×
          </button>
        </div>

        {/* Content */}
        <div className="clip-vault-modal-body">
          {checkingAuth ? (
            <div className="clip-vault-loading">
              <span className="clip-vault-spinner" />
              <span>{t("loading")}</span>
            </div>
          ) : !unlocked ? (
            /* Vault Unlock Form */
            <form onSubmit={handleUnlock} className="clip-vault-unlock-view">
              <div className="clip-vault-unlock-badge">🔐</div>
              <div className="clip-vault-unlock-title">{t("clipVaultUnlockRequired")}</div>
              <p className="clip-vault-unlock-hint">{t("clipVaultUnlockPrompt")}</p>

              <div className="clip-vault-input-group" style={{ width: "100%", maxWidth: "340px" }}>
                <input
                  type="password"
                  ref={masterPasswordInputRef}
                  className="clip-vault-input"
                  placeholder={t("authPasswordPlaceholder")}
                  value={masterPassword}
                  onChange={(e) => setMasterPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>

              {unlockError && <div className="clip-vault-error">{unlockError}</div>}

              <button
                type="submit"
                className="clip-vault-btn-primary"
                disabled={!masterPassword.trim() || unlocking}
              >
                {unlocking ? t("loading") : t("clipVaultUnlockBtn")}
              </button>
            </form>
          ) : (
            /* Add Credential Form */
            <form onSubmit={handleSave} className="clip-vault-form">
              {formError && <div className="clip-vault-error">{formError}</div>}

              {/* Title / Key Name */}
              <div className="clip-vault-field">
                <label className="clip-vault-label">
                  {t("clipVaultKeyName")} <span className="clip-vault-req">*</span>
                </label>
                <input
                  ref={keyNameInputRef}
                  type="text"
                  className="clip-vault-input"
                  placeholder={t("clipVaultKeyNamePlaceholder")}
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  maxLength={100}
                />
              </div>

              {/* Category Selection */}
              <div className="clip-vault-field">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label className="clip-vault-label">{t("clipVaultCategory")}</label>
                  {!showNewCatInput && (
                    <button
                      type="button"
                      className="clip-vault-link-btn"
                      onClick={() => setShowNewCatInput(true)}
                    >
                      {t("clipVaultNewCategory")}
                    </button>
                  )}
                </div>

                {!showNewCatInput ? (
                  <select
                    className="clip-vault-select"
                    value={categoryId ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "__new__") {
                        setShowNewCatInput(true);
                      } else {
                        setCategoryId(val ? Number(val) : null);
                      }
                    }}
                  >
                    <option value="">{t("clipVaultUnassigned")}</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  /* Inline New Category Creator */
                  <div className="clip-vault-inline-new-cat">
                    <input
                      type="text"
                      className="clip-vault-input inline"
                      placeholder={t("clipVaultNewCategoryPlaceholder")}
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      autoFocus
                    />
                    <div className="clip-vault-color-presets">
                      {PRESET_COLORS.map((c) => (
                        <div
                          key={c}
                          className={`clip-vault-color-dot ${newCatColor === c ? "selected" : ""}`}
                          style={{ backgroundColor: c }}
                          onClick={() => setNewCatColor(c)}
                        />
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        type="button"
                        className="clip-vault-btn-small primary"
                        onClick={handleCreateCategory}
                        disabled={!newCatName.trim() || creatingCat}
                      >
                        {creatingCat ? "..." : t("clipVaultAddCategoryBtn")}
                      </button>
                      <button
                        type="button"
                        className="clip-vault-btn-small"
                        onClick={() => setShowNewCatInput(false)}
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Username (Optional) */}
              <div className="clip-vault-field">
                <label className="clip-vault-label">{t("clipVaultUsername")}</label>
                <input
                  type="text"
                  className="clip-vault-input"
                  placeholder={t("clipVaultUsernamePlaceholder")}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={100}
                />
              </div>

              {/* Password / Text Content */}
              <div className="clip-vault-field">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label className="clip-vault-label">
                    {t("clipVaultPassword")} <span className="clip-vault-req">*</span>
                  </label>
                  <span className="clip-vault-char-badge">
                    {password.length} {t("clipStatsChars")}
                  </span>
                </div>
                <div className="clip-vault-password-wrap">
                  <input
                    type={showPassword ? "text" : "password"}
                    className="clip-vault-input password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="clip-vault-eye-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    title={showPassword ? "Gizle" : "Göster"}
                  >
                    {showPassword ? "👁" : "👁‍🗨"}
                  </button>
                </div>
              </div>

              {/* Notes (Optional) */}
              <div className="clip-vault-field">
                <label className="clip-vault-label">{t("clipVaultNotes")}</label>
                <textarea
                  className="clip-vault-textarea"
                  placeholder={t("clipVaultNotesPlaceholder")}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>

              {/* Footer actions */}
              <div className="clip-vault-modal-footer">
                <button
                  type="button"
                  className="clip-vault-btn-secondary"
                  onClick={onClose}
                  disabled={saving}
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  className="clip-vault-btn-primary"
                  disabled={!keyName.trim() || !password || saving}
                >
                  {saving ? t("loading") : t("clipVaultSaveBtn")}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
