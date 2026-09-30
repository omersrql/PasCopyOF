/**
 * FloatingTimerWidgetPage.tsx — Compact always-on-top draggable mini timer pill.
 */
import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  getTimerStatus,
  startTaskTimer,
  stopTaskTimer,
  toggleTaskStatus,
  hideTimerWidget,
} from "../api/tasks";
import type { TimerStatusInfo } from "../api/tasks";

export default function FloatingTimerWidgetPage() {
  const [status, setStatus] = useState<TimerStatusInfo>({
    isRunning: false,
    isAutoPaused: false,
    activeTimer: null,
    autoPausedTask: null,
  });
  const [secondsTick, setSecondsTick] = useState<number>(0);

  const formatDigital = (totalSecs: number) => {
    const s = Math.max(0, totalSecs);
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  };

  const syncStatus = async () => {
    try {
      const s = await getTimerStatus();
      setStatus(s);
      if (s.activeTimer) {
        setSecondsTick(s.activeTimer.elapsedSeconds);
      }
    } catch (err) {
      console.error("Failed to sync timer status:", err);
    }
  };

  useEffect(() => {
    syncStatus();

    // Setup Tauri event listeners
    const unlistens: Array<() => void> = [];

    listen("timer-started", () => syncStatus()).then((u) => unlistens.push(u));
    listen("timer-stopped", () => syncStatus()).then((u) => unlistens.push(u));
    listen("timer-auto-paused", () => syncStatus()).then((u) => unlistens.push(u));
    listen("timer-auto-resumed", () => syncStatus()).then((u) => unlistens.push(u));

    // Periodic safety check every 5 seconds
    const pollInterval = window.setInterval(syncStatus, 5000);

    return () => {
      window.clearInterval(pollInterval);
      unlistens.forEach((u) => u());
    };
  }, []);

  // Tick seconds when actively running
  useEffect(() => {
    if (!status.isRunning || status.isAutoPaused) return;
    const interval = window.setInterval(() => {
      setSecondsTick((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [status.isRunning, status.isAutoPaused]);

  const handleTogglePlay = async () => {
    if (status.isRunning && status.activeTimer) {
      await stopTaskTimer(status.activeTimer.taskId);
      syncStatus();
    } else if (status.isAutoPaused && status.autoPausedTask) {
      await startTaskTimer(status.autoPausedTask.taskId);
      syncStatus();
    }
  };

  const handleMarkDone = async () => {
    const tid = status.activeTimer?.taskId || status.autoPausedTask?.taskId;
    if (tid) {
      await toggleTaskStatus(tid);
      syncStatus();
    }
  };

  const handleOpenManager = async () => {
    try {
      await invoke("open_manager");
    } catch (err) {
      console.error(err);
    }
  };

  const handleClose = async () => {
    await hideTimerWidget();
  };

  const currentTitle =
    status.activeTimer?.taskTitle ||
    status.autoPausedTask?.title ||
    "PasCopyOf Focus";

  return (
    <div className="floating-widget-wrapper">
      <div
        className={`floating-timer-pill ${
          status.isRunning
            ? "running"
            : status.isAutoPaused
            ? "auto-paused"
            : "idle"
        }`}
        data-tauri-drag-region
      >
        {/* Drag handle */}
        <div className="widget-drag-handle" data-tauri-drag-region title="Sürüklemek için basılı tutun">
          ⋮⋮
        </div>

        {/* Pulse Dot */}
        <div
          className={`widget-status-dot ${
            status.isRunning
              ? "dot-running"
              : status.isAutoPaused
              ? "dot-paused"
              : "dot-idle"
          }`}
          title={
            status.isRunning
              ? "Sayaç çalışıyor"
              : status.isAutoPaused
              ? "Boşta / Ekran Kilitlendi (Hareket bekleniyor)"
              : "Durduruldu"
          }
        />

        {/* Info & Timer */}
        <div className="widget-info" data-tauri-drag-region>
          <div className="widget-title" title={currentTitle}>
            {status.isAutoPaused ? `[Boşta] ${currentTitle}` : currentTitle}
          </div>
          <div className="widget-time">
            {formatDigital(secondsTick)}
          </div>
        </div>

        {/* Actions */}
        <div className="widget-actions">
          {(status.isRunning || status.isAutoPaused) && (
            <button
              type="button"
              className="widget-btn btn-play"
              onClick={handleTogglePlay}
              title={status.isRunning ? "Duraklat" : "Devam Et"}
            >
              {status.isRunning ? "⏸️" : "▶️"}
            </button>
          )}

          {(status.isRunning || status.isAutoPaused) && (
            <button
              type="button"
              className="widget-btn btn-done"
              onClick={handleMarkDone}
              title="Görevi Tamamla"
            >
              ✓
            </button>
          )}

          <button
            type="button"
            className="widget-btn btn-manager"
            onClick={handleOpenManager}
            title="Yöneticiyi Aç"
          >
            ↗
          </button>

          <button
            type="button"
            className="widget-btn btn-close"
            onClick={handleClose}
            title="Gizle"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
