/**
 * MasterPasswordAuth.tsx — Guided Onboarding & Master Password Authentication.
 *
 * Modes:
 *  - "setup"  → First run guided 3-step onboarding wizard for setting master password & emergency recovery key.
 *  - "unlock" → Vault exists, quick password unlock with hint support & emergency recovery/reset options.
 */
import React, { useState, useRef, useEffect } from "react";
import {
  checkVaultInitialized,
  initVault,
  unlockVault,
  getPasswordHint,
  recoverVault,
  resetVault,
} from "../api/vault";
import { useApp } from "../context/AppContext";

interface Props {
  onUnlocked: () => void;
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

export function MasterPasswordAuth({ onUnlocked }: Props) {
  const { t } = useApp();
  const [mode, setMode] = useState<"loading" | "setup" | "unlock">("loading");
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1);

  // Setup / Unlock state
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordHint, setPasswordHintState] = useState("");
  const [generatedRecoveryKey, setGeneratedRecoveryKey] = useState("");
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Stored password hint in unlock mode
  const [storedHint, setStoredHint] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);

  // Recovery modal state
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [recoveryTab, setRecoveryTab] = useState<"key" | "reset">("key");
  const [recoveryKeyInput, setRecoveryKeyInput] = useState("");
  const [recoveryNewPw, setRecoveryNewPw] = useState("");
  const [recoveryConfirmPw, setRecoveryConfirmPw] = useState("");
  const [showRecoveryNewPw, setShowRecoveryNewPw] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveredNewKey, setRecoveredNewKey] = useState<string | null>(null);
  const [recoveredCopied, setRecoveredCopied] = useState(false);

  // Reset vault state
  const [confirmResetInput, setConfirmResetInput] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    checkVaultInitialized()
      .then((initialized) => {
        if (!active) return;
        setMode(initialized ? "unlock" : "setup");
        if (initialized) {
          getPasswordHint()
            .then((hint) => {
              if (active) setStoredHint(hint);
            })
            .catch(() => {});
        }
        setTimeout(() => inputRef.current?.focus(), 80);
      })
      .catch((err) => {
        console.warn("checkVaultInitialized failed, defaulting to unlock:", err);
        if (!active) return;
        setMode("unlock");
        setTimeout(() => inputRef.current?.focus(), 80);
      });

    const timer = setTimeout(() => {
      if (active) {
        setMode((curr) => (curr === "loading" ? "unlock" : curr));
        setTimeout(() => inputRef.current?.focus(), 80);
      }
    }, 500);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (setupStep === 2) {
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [setupStep]);

  // Key modifier tracking for Caps Lock
  const handleKeyModifier = (e: React.KeyboardEvent) => {
    if (e.getModifierState) {
      setCapsLockActive(e.getModifierState("CapsLock"));
    }
  };

  // Password Strength & Criteria Calculation
  const hasMinLength = password.length >= 8;
  const hasMixedCase = /[a-z]/.test(password) && /[A-Z]/.test(password);
  const hasNumOrSpecial = /[0-9]/.test(password) || /[^a-zA-Z0-9]/.test(password);
  const passwordsMatch = password.length > 0 && confirm.length > 0 && password === confirm;

  let strengthScore = 0;
  if (password.length >= 8) strengthScore++;
  if (password.length >= 12) strengthScore++;
  if (hasMixedCase) strengthScore++;
  if (hasNumOrSpecial) strengthScore++;

  const strengthLabels = [
    t("onboardingStrengthVeryWeak"),
    t("onboardingStrengthWeak"),
    t("onboardingStrengthMedium"),
    t("onboardingStrengthStrong"),
    t("onboardingStrengthGreat"),
  ];

  const strengthColors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#10b981"];

  const handleInitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!hasMinLength) {
      setError(t("authMinCharsError"));
      return;
    }
    if (password !== confirm) {
      setError(t("authMismatchError"));
      return;
    }

    setLoading(true);
    try {
      const rk = await initVault(password, passwordHint.trim() || undefined);
      setGeneratedRecoveryKey(rk);
      setLoading(false);
      setSetupStep(3);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const ok = await unlockVault(password);
      if (ok) {
        onUnlocked();
      } else {
        setError(t("authIncorrectError"));
        if (storedHint) {
          setShowHint(true);
        }
        setPassword("");
        inputRef.current?.focus();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // Recovery Key Submit Handler
  const handleRecoverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryError("");

    if (recoveryKeyInput.trim().length < 16) {
      setRecoveryError("Geçerli bir 24 haneli kurtarma anahtarı girin.");
      return;
    }
    if (recoveryNewPw.length < 8) {
      setRecoveryError(t("authMinCharsError"));
      return;
    }
    if (recoveryNewPw !== recoveryConfirmPw) {
      setRecoveryError(t("authMismatchError"));
      return;
    }

    setRecoveryLoading(true);
    try {
      const freshKey = await recoverVault(recoveryKeyInput.trim(), recoveryNewPw);
      setRecoveredNewKey(freshKey);
      setRecoveryLoading(false);
    } catch (err) {
      setRecoveryError(String(err));
      setRecoveryLoading(false);
    }
  };

  // Clean Reset Submit Handler
  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError("");

    const norm = confirmResetInput.trim().toUpperCase();
    if (norm !== "SIFIRLA" && norm !== "RESET") {
      setResetError("Lütfen onaylamak için 'SIFIRLA' veya 'RESET' yazın.");
      return;
    }

    setResetLoading(true);
    try {
      await resetVault(confirmResetInput);
      setResetLoading(false);
      setShowRecoveryModal(false);
      setMode("setup");
      setSetupStep(1);
      setPassword("");
      setConfirm("");
      setPasswordHintState("");
      setGeneratedRecoveryKey("");
      setRecoveryConfirmed(false);
      setStoredHint(null);
    } catch (err) {
      setResetError(String(err));
      setResetLoading(false);
    }
  };

  if (mode === "loading") {
    return (
      <div className="auth-overlay">
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  // ─── SETUP MODE (GUIDED 3-STEP ONBOARDING WIZARD) ─────────────────────────
  if (mode === "setup") {
    return (
      <div className="auth-overlay">
        <div className="auth-card onboarding-auth-card">
          {/* Top Step Progress Bar */}
          <div className="onboarding-step-indicator">
            <div className={`step-item ${setupStep >= 1 ? "active" : ""}`}>
              <span className="step-num">1</span>
              <span className="step-text">{t("onboardingStepWelcome")}</span>
            </div>
            <div className={`step-line ${setupStep >= 2 ? "active" : ""}`} />
            <div className={`step-item ${setupStep >= 2 ? "active" : ""}`}>
              <span className="step-num">2</span>
              <span className="step-text">{t("onboardingStepPassword")}</span>
            </div>
            <div className={`step-line ${setupStep >= 3 ? "active" : ""}`} />
            <div className={`step-item ${setupStep >= 3 ? "active" : ""}`}>
              <span className="step-num">3</span>
              <span className="step-text">{t("onboardingStepComplete")}</span>
            </div>
          </div>

          {/* STEP 1: Welcome & Zero-Knowledge Security Overview */}
          {setupStep === 1 && (
            <div className="onboarding-step-view">
              <div className="onboarding-hero">
                <div className="onboarding-badge-icon">🛡️</div>
                <div className="onboarding-title">{t("onboardingWelcomeTitle")}</div>
                <p className="onboarding-desc">{t("onboardingWelcomeDesc")}</p>
              </div>

              <div className="onboarding-security-notice">
                <div className="notice-icon">⚠️</div>
                <div className="notice-content">
                  <div className="notice-title">{t("onboardingZeroKnowledgeTitle")}</div>
                  <div className="notice-desc">{t("onboardingZeroKnowledgeDesc")}</div>
                </div>
              </div>

              <div className="onboarding-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-full onboarding-next-btn"
                  onClick={() => setSetupStep(2)}
                >
                  {t("onboardingStartBtn")}
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Password Creation with Strength Meter, Criteria Checks & Hint */}
          {setupStep === 2 && (
            <div className="onboarding-step-view">
              <div className="onboarding-header-compact">
                <div className="onboarding-title-compact">🔑 {t("authCreatePassword")}</div>
                <p className="onboarding-desc-compact">
                  {t("authSubtitleSetup")}
                </p>
              </div>

              <form onSubmit={handleInitSubmit} className="onboarding-form">
                {/* Password field */}
                <div className="form-group">
                  <label className="form-label">{t("authMasterPassword")}</label>
                  <div className="input-with-action">
                    <input
                      ref={inputRef}
                      type={showPassword ? "text" : "password"}
                      className={`form-input ${error ? "error" : ""}`}
                      placeholder={t("authPasswordPlaceholder")}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError("");
                      }}
                      onKeyUp={handleKeyModifier}
                      onKeyDown={handleKeyModifier}
                      disabled={loading}
                    />
                    <button
                      type="button"
                      className="input-eye-btn"
                      onClick={() => setShowPassword(!showPassword)}
                      title={showPassword ? "Gizle" : "Göster"}
                      tabIndex={-1}
                    >
                      {showPassword ? "🙈" : "👁️"}
                    </button>
                  </div>
                </div>

                {/* Password Strength Meter */}
                {password.length > 0 && (
                  <div className="password-strength-box">
                    <div className="strength-header">
                      <span>Güvenlik Derecesi:</span>
                      <strong style={{ color: strengthColors[strengthScore] }}>
                        {strengthLabels[strengthScore]}
                      </strong>
                    </div>
                    <div className="strength-track">
                      <div
                        className="strength-fill"
                        style={{
                          width: `${Math.max(15, (strengthScore / 4) * 100)}%`,
                          background: strengthColors[strengthScore],
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Confirm Password field */}
                <div className="form-group">
                  <label className="form-label">{t("authConfirmPassword")}</label>
                  <div className="input-with-action">
                    <input
                      type={showConfirm ? "text" : "password"}
                      className={`form-input ${error ? "error" : ""}`}
                      placeholder={t("authConfirmPlaceholder")}
                      value={confirm}
                      onChange={(e) => {
                        setConfirm(e.target.value);
                        setError("");
                      }}
                      onKeyUp={handleKeyModifier}
                      onKeyDown={handleKeyModifier}
                      disabled={loading}
                    />
                    <button
                      type="button"
                      className="input-eye-btn"
                      onClick={() => setShowConfirm(!showConfirm)}
                      title={showConfirm ? "Gizle" : "Göster"}
                      tabIndex={-1}
                    >
                      {showConfirm ? "🙈" : "👁️"}
                    </button>
                  </div>
                </div>

                {/* Optional Password Hint */}
                <div className="form-group" style={{ marginTop: 2 }}>
                  <label className="form-label" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{t("authPasswordHintLabel")}</span>
                    <span style={{ fontSize: 11, opacity: 0.65 }}>💡 İsteğe bağlı</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder={t("authPasswordHintPlaceholder")}
                    value={passwordHint}
                    onChange={(e) => setPasswordHintState(e.target.value)}
                    disabled={loading}
                  />
                </div>

                {/* Real-time Criteria Checklist */}
                <div className="password-criteria-list">
                  <div className={`criteria-item ${hasMinLength ? "passed" : ""}`}>
                    <span className="criteria-check">{hasMinLength ? "✓" : "○"}</span>
                    <span>{t("onboardingReqLength")}</span>
                  </div>
                  <div className={`criteria-item ${hasMixedCase ? "passed" : ""}`}>
                    <span className="criteria-check">{hasMixedCase ? "✓" : "○"}</span>
                    <span>{t("onboardingReqCase")}</span>
                  </div>
                  <div className={`criteria-item ${hasNumOrSpecial ? "passed" : ""}`}>
                    <span className="criteria-check">{hasNumOrSpecial ? "✓" : "○"}</span>
                    <span>{t("onboardingReqNumberSymbol")}</span>
                  </div>
                  {confirm.length > 0 && (
                    <div className={`criteria-item ${passwordsMatch ? "passed" : ""}`}>
                      <span className="criteria-check">{passwordsMatch ? "✓" : "○"}</span>
                      <span>{t("onboardingReqMatch")}</span>
                    </div>
                  )}
                </div>

                {/* Caps Lock Alert */}
                {capsLockActive && (
                  <div className="caps-lock-alert">
                    {t("onboardingCapsWarning")}
                  </div>
                )}

                {/* Error message */}
                {error && (
                  <div className="form-error">
                    <span>⚠</span> {error}
                  </div>
                )}

                {/* Buttons */}
                <div className="onboarding-dual-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setSetupStep(1)}
                    disabled={loading}
                  >
                    {t("onboardingBackBtn")}
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={loading || !hasMinLength || (confirm.length > 0 && !passwordsMatch)}
                  >
                    {loading ? t("loading") : t("onboardingCreateVaultBtn")}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* STEP 3: Emergency Recovery Key & Shortcut Cheat-Sheet */}
          {setupStep === 3 && (
            <div className="onboarding-step-view">
              <div className="onboarding-hero">
                <div className="onboarding-badge-icon success-icon">🛡️</div>
                <div className="onboarding-title">{t("onboardingKeyStepTitle")}</div>
                <p className="onboarding-desc">{t("onboardingKeyStepDesc")}</p>
              </div>

              {/* Recovery Key Monospace Box */}
              <div className="recovery-key-display-box">
                <div className="recovery-key-code">{generatedRecoveryKey}</div>
                <div className="recovery-key-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      navigator.clipboard.writeText(generatedRecoveryKey);
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2500);
                    }}
                  >
                    {copiedKey ? t("onboardingKeyCopied") : t("onboardingKeyCopyBtn")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => downloadRecoveryKeyFile(generatedRecoveryKey)}
                  >
                    {t("onboardingKeyDownloadBtn")}
                  </button>
                </div>
              </div>

              {/* Acknowledgment Checkbox */}
              <label className="recovery-confirm-label">
                <input
                  type="checkbox"
                  checked={recoveryConfirmed}
                  onChange={(e) => setRecoveryConfirmed(e.target.checked)}
                />
                <span>{t("onboardingKeyConfirmCheckbox")}</span>
              </label>

              {/* Shortcut Cheat-Cards */}
              <div className="onboarding-shortcuts-grid" style={{ marginTop: 14 }}>
                <div className="shortcut-mini-card">
                  <div className="mini-card-icon">🔑</div>
                  <div className="mini-card-info">
                    <div className="mini-card-title">Kasa Hızlı Başlatıcı</div>
                    <kbd className="mini-card-kbd">Ctrl + Shift + Space</kbd>
                  </div>
                </div>

                <div className="shortcut-mini-card">
                  <div className="mini-card-icon">📋</div>
                  <div className="mini-card-info">
                    <div className="mini-card-title">Pano Geçmişi & Arama</div>
                    <kbd className="mini-card-kbd">Ctrl + Shift + V</kbd>
                  </div>
                </div>

                <div className="shortcut-mini-card">
                  <div className="mini-card-icon">📸</div>
                  <div className="mini-card-info">
                    <div className="mini-card-title">Ekran Alıntısı & OCR</div>
                    <kbd className="mini-card-kbd">Ctrl + Shift + S</kbd>
                  </div>
                </div>

                <div className="shortcut-mini-card">
                  <div className="mini-card-icon">⚡</div>
                  <div className="mini-card-info">
                    <div className="mini-card-title">Hızlı Görev & Sayaç</div>
                    <kbd className="mini-card-kbd">Ctrl + Shift + N</kbd>
                  </div>
                </div>
              </div>

              <div className="onboarding-actions" style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-full onboarding-start-btn"
                  disabled={!recoveryConfirmed}
                  onClick={onUnlocked}
                >
                  {t("onboardingStartAppBtn")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── UNLOCK MODE ──────────────────────────────────────────────────────────
  return (
    <div className="auth-overlay">
      <div className="auth-card">
        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo-icon">🔐</div>
          <div>
            <div className="auth-title">{t("authTitle")}</div>
            <div className="auth-subtitle">{t("authSubtitleUnlock")}</div>
          </div>
        </div>

        <form
          onSubmit={handleUnlockSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
        >
          {/* Password field */}
          <div className="form-group">
            <label className="form-label">{t("authMasterPassword")}</label>
            <div className="input-with-action">
              <input
                ref={inputRef}
                id="master-password-input"
                type={showPassword ? "text" : "password"}
                className={`form-input ${error ? "error" : ""}`}
                placeholder={t("authPasswordPlaceholder")}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                onKeyUp={handleKeyModifier}
                onKeyDown={handleKeyModifier}
                autoComplete="current-password"
                disabled={loading}
              />
              <button
                type="button"
                className="input-eye-btn"
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? "Gizle" : "Göster"}
                tabIndex={-1}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

          {/* Password Hint Toggle & Display */}
          {storedHint && (
            <div className="auth-hint-container">
              {!showHint ? (
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => setShowHint(true)}
                >
                  {t("authShowHintBtn")}
                </button>
              ) : (
                <div className="auth-hint-box">
                  <span className="auth-hint-tag">💡 {t("authHintPrefix")}</span>
                  <span className="auth-hint-text">{storedHint}</span>
                  <button
                    type="button"
                    className="auth-hint-close-btn"
                    onClick={() => setShowHint(false)}
                    title={t("authHideHintBtn")}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Caps Lock Alert */}
          {capsLockActive && (
            <div className="caps-lock-alert">
              {t("onboardingCapsWarning")}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="form-error">
              <span>⚠</span> {error}
            </div>
          )}

          {/* Submit button */}
          <button
            id="auth-submit-btn"
            type="submit"
            className="btn btn-primary btn-full"
            disabled={loading || password.trim().length === 0}
          >
            {loading ? t("loading") : t("authSubmitUnlock")}
          </button>
        </form>

        {/* Forgot Password / Recovery Link */}
        <div className="auth-footer-actions">
          <button
            type="button"
            className="auth-forgot-link"
            onClick={() => {
              setShowRecoveryModal(true);
              setRecoveryError("");
              setResetError("");
              setRecoveredNewKey(null);
            }}
          >
            {t("authForgotPasswordBtn")}
          </button>
        </div>

        {/* Security note */}
        <p
          style={{
            fontSize: 11,
            color: "var(--color-text-muted)",
            textAlign: "center",
            lineHeight: 1.6,
            marginTop: 6,
          }}
        >
          Protected with{" "}
          <span style={{ color: "var(--color-text-secondary)" }}>Argon2id</span> &{" "}
          <span style={{ color: "var(--color-text-secondary)" }}>AES-256-GCM</span> local encryption.
        </p>
      </div>

      {/* ─── RECOVERY & RESET MODAL ─── */}
      {showRecoveryModal && (
        <div className="modal-overlay" style={{ zIndex: 99999 }}>
          <div className="modal-dialog recovery-modal-card">
            <div className="modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }}>🆘</span>
                <div>
                  <div className="modal-title" style={{ fontSize: 16 }}>{t("recoveryModalTitle")}</div>
                  <div className="modal-subtitle" style={{ fontSize: 12 }}>{t("recoveryModalSub")}</div>
                </div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => {
                  setShowRecoveryModal(false);
                  setRecoveredNewKey(null);
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="recovery-tabs">
              <button
                type="button"
                className={`recovery-tab-btn ${recoveryTab === "key" ? "active" : ""}`}
                onClick={() => {
                  setRecoveryTab("key");
                  setRecoveryError("");
                }}
              >
                {t("recoveryTabKey")}
              </button>
              <button
                type="button"
                className={`recovery-tab-btn ${recoveryTab === "reset" ? "active danger" : ""}`}
                onClick={() => {
                  setRecoveryTab("reset");
                  setResetError("");
                }}
              >
                {t("recoveryTabReset")}
              </button>
            </div>

            <div className="modal-body" style={{ paddingTop: 14 }}>
              {/* TAB 1: Kurtarma Anahtarı ile Aç */}
              {recoveryTab === "key" && (
                <div>
                  {recoveredNewKey ? (
                    <div className="recovery-success-box">
                      <div className="recovery-success-header">
                        <span style={{ fontSize: 28 }}>🎉</span>
                        <div style={{ fontWeight: 600, fontSize: 16, color: "var(--color-success)" }}>
                          {t("recoverySuccessTitle")}
                        </div>
                      </div>
                      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "8px 0" }}>
                        {t("recoverySuccessDesc")}
                      </p>

                      <div className="recovery-key-display-box" style={{ margin: "12px 0" }}>
                        <div className="recovery-key-code">{recoveredNewKey}</div>
                        <div className="recovery-key-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              navigator.clipboard.writeText(recoveredNewKey);
                              setRecoveredCopied(true);
                              setTimeout(() => setRecoveredCopied(false), 2500);
                            }}
                          >
                            {recoveredCopied ? t("onboardingKeyCopied") : t("onboardingKeyCopyBtn")}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => downloadRecoveryKeyFile(recoveredNewKey)}
                          >
                            {t("onboardingKeyDownloadBtn")}
                          </button>
                        </div>
                      </div>

                      <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => {
                            setShowRecoveryModal(false);
                            onUnlocked();
                          }}
                        >
                          Kasanın Kilidini Aç ve Giriş Yap ✨
                        </button>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={handleRecoverSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      <div className="form-group">
                        <label className="form-label">{t("recoveryKeyInputLabel")}</label>
                        <input
                          type="text"
                          className="form-input recovery-key-input"
                          placeholder={t("recoveryKeyInputPlaceholder")}
                          value={recoveryKeyInput}
                          onChange={(e) => setRecoveryKeyInput(e.target.value.toUpperCase())}
                          disabled={recoveryLoading}
                          autoFocus
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">{t("recoveryNewPasswordLabel")}</label>
                        <div className="input-with-action">
                          <input
                            type={showRecoveryNewPw ? "text" : "password"}
                            className="form-input"
                            placeholder="Yeni güçlü parola..."
                            value={recoveryNewPw}
                            onChange={(e) => setRecoveryNewPw(e.target.value)}
                            disabled={recoveryLoading}
                          />
                          <button
                            type="button"
                            className="input-eye-btn"
                            onClick={() => setShowRecoveryNewPw(!showRecoveryNewPw)}
                            tabIndex={-1}
                          >
                            {showRecoveryNewPw ? "🙈" : "👁️"}
                          </button>
                        </div>
                      </div>

                      <div className="form-group">
                        <label className="form-label">{t("recoveryNewPasswordConfirmLabel")}</label>
                        <input
                          type={showRecoveryNewPw ? "text" : "password"}
                          className="form-input"
                          placeholder="Yeni parolayı tekrar girin..."
                          value={recoveryConfirmPw}
                          onChange={(e) => setRecoveryConfirmPw(e.target.value)}
                          disabled={recoveryLoading}
                        />
                      </div>

                      {recoveryError && (
                        <div className="form-error">
                          <span>⚠</span> {recoveryError}
                        </div>
                      )}

                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setShowRecoveryModal(false)}
                          disabled={recoveryLoading}
                        >
                          {t("cancel")}
                        </button>
                        <button
                          type="submit"
                          className="btn btn-primary"
                          disabled={recoveryLoading || !recoveryKeyInput.trim() || recoveryNewPw.length < 8}
                        >
                          {recoveryLoading ? t("loading") : t("recoverySubmitBtn")}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {/* TAB 2: Kasayı Temiz Sıfırla */}
              {recoveryTab === "reset" && (
                <form onSubmit={handleResetSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div className="recovery-danger-box">
                    <div style={{ fontSize: 24 }}>⚠️</div>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--color-danger)", marginBottom: 4 }}>
                        {t("recoveryResetTitle")}
                      </div>
                      <p style={{ fontSize: 12.5, lineHeight: 1.5, margin: 0, color: "var(--color-text-secondary)" }}>
                        {t("recoveryResetWarning")}
                      </p>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">
                      {t("recoveryResetConfirmPrompt")}
                    </label>
                    <input
                      type="text"
                      className="form-input danger-input"
                      placeholder={t("recoveryResetPlaceholder")}
                      value={confirmResetInput}
                      onChange={(e) => setConfirmResetInput(e.target.value)}
                      disabled={resetLoading}
                    />
                  </div>

                  {resetError && (
                    <div className="form-error">
                      <span>⚠</span> {resetError}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setShowRecoveryModal(false)}
                      disabled={resetLoading}
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="submit"
                      className="btn btn-danger"
                      disabled={
                        resetLoading ||
                        (confirmResetInput.trim().toUpperCase() !== "SIFIRLA" &&
                          confirmResetInput.trim().toUpperCase() !== "RESET")
                      }
                    >
                      {resetLoading ? t("loading") : t("recoveryResetBtn")}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
