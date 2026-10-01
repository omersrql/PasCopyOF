/**
 * useAutoUpdateChecker.ts — Background startup update checker hook.
 * Checks for new app releases on GitHub and controls the UpdatePromptModal.
 */
import { useState, useEffect, useCallback } from "react";
import { checkAppUpdate } from "../api/updater";
import type { UpdateInfo } from "../api/updater";

export function useAutoUpdateChecker(enabled: boolean = true) {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async (force: boolean = false) => {
    if (!force) {
      const autoCheckPref = localStorage.getItem("pascopyof_auto_check_updates");
      if (autoCheckPref === "false") return;

      const dismissed = sessionStorage.getItem("pascopyof_update_dismissed");
      if (dismissed === "true") return;
    }

    setChecking(true);
    try {
      const info = await checkAppUpdate();
      setUpdateInfo(info);
      if (info.available && info.rawUpdate) {
        setShowPrompt(true);
      }
    } catch (err) {
      // Silently catch network errors on background startup check
      console.debug("Silent startup update check error:", err);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Small delay so application rendering is not blocked at all
    const timer = setTimeout(() => {
      check(false);
    }, 2200);

    return () => clearTimeout(timer);
  }, [enabled, check]);

  const dismissPrompt = useCallback(() => {
    sessionStorage.setItem("pascopyof_update_dismissed", "true");
    setShowPrompt(false);
  }, []);

  return {
    updateInfo,
    showPrompt,
    setShowPrompt,
    dismissPrompt,
    checking,
    checkNow: () => check(true),
  };
}
