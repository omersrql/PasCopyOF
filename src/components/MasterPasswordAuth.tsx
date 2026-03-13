/**
 * MasterPasswordAuth.tsx — Overlay shown on app start.
 *
 * Two modes:
 *  - "setup"  → first run, user sets a new master password
 *  - "unlock" → vault exists, user enters password to unlock
 */
import React, { useState, useRef, useEffect } from "react";
import { checkVaultInitialized, initVault, unlockVault } from "../api/vault";

interface Props {
  onUnlocked: () => void;
}

export function MasterPasswordAuth({ onUnlocked }: Props) {
  const [mode, setMode] = useState<"loading" | "setup" | "unlock">("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkVaultInitialized().then((initialized) => {
      setMode(initialized ? "unlock" : "setup");
      setTimeout(() => inputRef.current?.focus(), 100);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (mode === "setup") {
      if (password.length < 8) {
        setError("Master password must be at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }
      setLoading(true);
      try {
        await initVault(password);
        onUnlocked();
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    } else {
      setLoading(true);
      try {
        const ok = await unlockVault(password);
        if (ok) {
          onUnlocked();
        } else {
          setError("Incorrect master password.");
          setPassword("");
          inputRef.current?.focus();
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    }
  }

  if (mode === "loading") {
    return (
      <div className="auth-overlay">
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  return (
    <div className="auth-overlay">
      <div className="auth-card">
        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo-icon">🔐</div>
          <div>
            <div className="auth-title">PasCopyOf</div>
            <div className="auth-subtitle">
              {mode === "setup" ? "Set up your vault" : "Enter master password"}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {/* Password field */}
          <div className="form-group">
            <label className="form-label">
              {mode === "setup" ? "Create master password" : "Master password"}
            </label>
            <input
              ref={inputRef}
              id="master-password-input"
              type="password"
              className={`form-input ${error ? "error" : ""}`}
              placeholder={mode === "setup" ? "Min. 8 characters" : "Enter password…"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          {/* Confirm field (setup only) */}
          {mode === "setup" && (
            <div className="form-group">
              <label className="form-label">Confirm password</label>
              <input
                id="confirm-password-input"
                type="password"
                className={`form-input ${error ? "error" : ""}`}
                placeholder="Repeat password…"
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); setError(""); }}
                autoComplete="new-password"
                disabled={loading}
              />
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
            disabled={loading || !password}
          >
            {loading ? <span className="spinner" /> : mode === "setup" ? "🔒  Create Vault" : "🔓  Unlock Vault"}
          </button>
        </form>

        {/* Security note */}
        <p style={{ fontSize: 11, color: "var(--color-text-muted)", textAlign: "center", lineHeight: 1.6 }}>
          Your vault is protected with{" "}
          <span style={{ color: "var(--color-text-secondary)" }}>Argon2id</span> key derivation
          and <span style={{ color: "var(--color-text-secondary)" }}>AES-256-GCM</span> encryption.
          {mode === "setup" && " This password cannot be recovered if lost."}
        </p>
      </div>
    </div>
  );
}
