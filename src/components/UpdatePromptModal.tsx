/**
 * UpdatePromptModal.tsx — Startup / New Version Available Prompt Modal.
 * Prompts user to download and install updates with live progress and automatic restart.
 */
import { useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { downloadAndInstallUpdate, restartApp } from "../api/updater";
import type { UpdateInfo } from "../api/updater";

interface Props {
  isOpen: boolean;
  updateInfo: UpdateInfo | null;
  onClose: () => void;
}

export function UpdatePromptModal({ isOpen, updateInfo, onClose }: Props) {
  const { t } = useApp();
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setDownloading(false);
      setProgress(0);
      setInstalled(false);
      setError(null);
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !downloading) {
        e.preventDefault();
        handleDismiss();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, downloading]);

  if (!isOpen || !updateInfo || !updateInfo.available) {
    return null;
  }

  const handleDismiss = () => {
    sessionStorage.setItem("pascopyof_update_dismissed", "true");
    onClose();
  };

  const handleStartUpdate = async () => {
    if (!updateInfo.rawUpdate) return;
    setDownloading(true);
    setError(null);
    setProgress(0);

    try {
      await downloadAndInstallUpdate(updateInfo.rawUpdate, (downloaded, total) => {
        if (total > 0) {
          setProgress(Math.round((downloaded / total) * 100));
        }
      });

      setInstalled(true);
      setDownloading(false);

      // Auto-restart after 1.8s
      setTimeout(async () => {
        try {
          await restartApp();
        } catch (err) {
          console.error("Auto restart failed:", err);
        }
      }, 1800);
    } catch (err: any) {
      console.error("Update install failed:", err);
      setError(err?.message || String(err));
      setDownloading(false);
    }
  };

  const handleManualRestart = async () => {
    try {
      await restartApp();
    } catch (err) {
      console.error("Manual restart failed:", err);
    }
  };

  return (
    <div className="update-modal-backdrop" onClick={!downloading ? handleDismiss : undefined}>
      <div className="update-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="update-modal-header">
          <div className="update-modal-title-wrap">
            <span className="update-rocket-icon">🚀</span>
            <div>
              <div className="update-modal-badge">{t("updatePromptBadge")}</div>
              <h2 className="update-modal-title">{t("updatePromptTitle")}</h2>
            </div>
          </div>
          {!downloading && !installed && (
            <button
              type="button"
              className="update-close-btn"
              onClick={handleDismiss}
              title={t("close") + " (Esc)"}
            >
              ✕
            </button>
          )}
        </div>

        {/* Versions Tag Bar */}
        <div className="update-version-row">
          <span className="update-version-item old">
            <span className="update-ver-label">{t("updatePromptCurrentVersion")}:</span>
            <strong>v{updateInfo.currentVersion}</strong>
          </span>
          <span className="update-version-arrow">➔</span>
          <span className="update-version-item new">
            <span className="update-ver-label">{t("updatePromptNewVersion")}:</span>
            <strong>v{updateInfo.version}</strong>
          </span>
        </div>

        {/* Release Notes if available */}
        {updateInfo.body && (
          <div className="update-notes-container">
            <div className="update-notes-label">📋 {t("updatePromptReleaseNotes")}</div>
            <div className="update-notes-content">{updateInfo.body}</div>
          </div>
        )}

        {/* Body State: Success */}
        {installed ? (
          <div className="update-state-box success">
            <div style={{ fontSize: 32 }}>🎉</div>
            <div className="update-state-title">{t("updatePromptSuccessTitle")}</div>
            <p className="update-state-desc">{t("updatePromptSuccessDesc")}</p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleManualRestart}
              style={{ marginTop: 8 }}
            >
              🔄 {t("updatePromptRestartBtn")}
            </button>
          </div>
        ) : downloading ? (
          /* Body State: Downloading Progress */
          <div className="update-state-box downloading">
            <div className="update-progress-info">
              <span className="update-progress-text">
                {t("updatePromptDownloading").replace("{percent}", String(progress))}
              </span>
              <span className="update-progress-pct">{progress}%</span>
            </div>
            <div className="update-progress-bar">
              <div
                className="update-progress-bar-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="update-install-note">{t("updatePromptInstallingNote")}</p>
          </div>
        ) : (
          /* Body State: Prompt Question */
          <div className="update-prompt-question-box">
            <p className="update-prompt-question-text">{t("updatePromptQuestion")}</p>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="update-error-box">
            <span>⚠️</span>
            <div>
              <strong>{t("updatePromptErrorTitle")}:</strong> {error}
            </div>
          </div>
        )}

        {/* Actions Footer */}
        {!installed && !downloading && (
          <div className="update-modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleDismiss}
            >
              {t("updatePromptLaterBtn")}
            </button>
            <button
              type="button"
              className="btn btn-primary update-primary-btn"
              onClick={handleStartUpdate}
            >
              {error ? t("updatePromptRetryBtn") : t("updatePromptUpdateBtn")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
