/**
 * MasterPasswordAuth.tsx — Guided Onboarding & Master Password Authentication.
 *
 * Modes:
 *  - "setup"  → First run guided 3-step onboarding wizard for setting the master password.
 *  - "unlock" → Vault exists, quick password unlock screen with Caps Lock & visibility toggles.
 */
import React, { useState, useRef, useEffect } from "react";
import { checkVaultInitialized, initVault, unlockVault } from "../api/vault";
import { useApp } from "../context/AppContext";

interface Props {
  onUnlocked: () => void;
}

export function MasterPasswordAuth({ onUnlocked }: Props) {
  const { t } = useApp();
  const [mode, setMode] = useState<"loading" | "setup" | "unlock">("loading");
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    checkVaultInitialized()
      .then((initialized) => {
        if (!active) return;
        setMode(initialized ? "unlock" : "setup");
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
      await initVault(password);
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
        setPassword("");
        inputRef.current?.focus();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
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

          {/* STEP 2: Password Creation with Strength Meter & Interactive Checks */}
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

          {/* STEP 3: Success Celebration & Global Shortcuts Quick Reference */}
          {setupStep === 3 && (
            <div className="onboarding-step-view">
              <div className="onboarding-hero">
                <div className="onboarding-badge-icon success-icon">🎉</div>
                <div className="onboarding-title">{t("onboardingSuccessTitle")}</div>
                <p className="onboarding-desc">{t("onboardingSuccessDesc")}</p>
              </div>

              {/* Shortcut Cheat-Cards */}
              <div className="onboarding-shortcuts-grid">
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

              <div className="onboarding-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-full onboarding-start-btn"
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

        {/* Security note */}
        <p
          style={{
            fontSize: 11,
            color: "var(--color-text-muted)",
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          Protected with{" "}
          <span style={{ color: "var(--color-text-secondary)" }}>Argon2id</span> &{" "}
          <span style={{ color: "var(--color-text-secondary)" }}>AES-256-GCM</span> local encryption.
        </p>
      </div>
    </div>
  );
}
