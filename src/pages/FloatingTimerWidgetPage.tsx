/**
 * FloatingTimerWidgetPage.tsx — Compact always-on-top draggable mini timer pill.
 */
import { useState, useEffect } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
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
  const [lastTaskId, setLastTaskId] = useState<number | null>(null);
  const [lastTaskTitle, setLastTaskTitle] = useState<string>("");

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
        setLastTaskId(s.activeTimer.taskId);
        setLastTaskTitle(s.activeTimer.taskTitle);
      } else if (s.autoPausedTask) {
        setLastTaskId(s.autoPausedTask.taskId);
        setLastTaskTitle(s.autoPausedTask.title);
      } else if (s.lastActiveTask) {
        setLastTaskId(s.lastActiveTask.taskId);
        setLastTaskTitle(s.lastActiveTask.title);
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
    listen("tasks-changed", () => syncStatus()).then((u) => unlistens.push(u));
    listen("task-updated", () => syncStatus()).then((u) => unlistens.push(u));

    // Periodic safety sync every 3 seconds
    const pollInterval = window.setInterval(syncStatus, 3000);

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

  // Start window dragging natively via Tauri on mouse down
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag with left mouse button and not on button elements
    if (e.button === 0 && !(e.target as HTMLElement).closest("button")) {
      try {
        getCurrentWebviewWindow().startDragging();
      } catch (err) {
        console.error("startDragging error:", err);
      }
    }
  };

  // Double click anywhere on widget opens Manager and navigates to this task
  const handleDoubleClick = async (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const tid =
      status.activeTimer?.taskId ||
      status.autoPausedTask?.taskId ||
      status.lastActiveTask?.taskId ||
      lastTaskId;
    try {
      if (tid) {
        localStorage.setItem("pascopyof_target_task_id", String(tid));
        localStorage.setItem("pascopyof_target_tab", "tasks");
      }
      await invoke("open_manager", { taskId: tid ?? null });
      if (tid) {
        await emit("open-task-in-manager", { taskId: tid });
        setTimeout(() => emit("open-task-in-manager", { taskId: tid }), 150);
        setTimeout(() => emit("open-task-in-manager", { taskId: tid }), 450);
      }
    } catch (err) {
      console.error("Open manager error:", err);
    }
  };

  // Toggle play/pause/resume
  const handleTogglePlay = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (status.isRunning && status.activeTimer) {
      // Pause
      await stopTaskTimer(status.activeTimer.taskId);
      syncStatus();
    } else {
      // Start or Resume
      const tid =
        status.autoPausedTask?.taskId ||
        status.activeTimer?.taskId ||
        status.lastActiveTask?.taskId ||
        lastTaskId;
      if (tid) {
        await startTaskTimer(tid);
        syncStatus();
      }
    }
  };

  // Mark current task done and close widget
  const handleMarkDone = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const tid =
      status.activeTimer?.taskId ||
      status.autoPausedTask?.taskId ||
      status.lastActiveTask?.taskId ||
      lastTaskId;
    if (tid) {
      try {
        await toggleTaskStatus(tid);
        await emit("task-updated", { id: tid });
        await emit("tasks-changed", { id: tid });
        await emit("timer-stopped", tid);
      } catch (err) {
        console.error("Failed to toggle task status from widget:", err);
      }
      setStatus((prev) => ({
        ...prev,
        isRunning: false,
        isAutoPaused: false,
        activeTimer: null,
        autoPausedTask: null,
        lastActiveTask: null,
      }));
      setLastTaskId(null);
      setLastTaskTitle("");
      setSecondsTick(0);
      await hideTimerWidget();
    } else {
      await hideTimerWidget();
    }
  };

  // Keyboard shortcuts:
  // Space / P: Play / Pause timer
  // Enter / D: Finish & Complete task (Sonlandır)
  // Esc: Hide widget
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hideTimerWidget();
      } else if (e.key === " " || e.key.toLowerCase() === "p") {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === "Enter" || e.key.toLowerCase() === "d") {
        e.preventDefault();
        handleMarkDone();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [status, lastTaskId]);

  // Open Manager
  const handleOpenManager = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const tid =
      status.activeTimer?.taskId ||
      status.autoPausedTask?.taskId ||
      status.lastActiveTask?.taskId ||
      lastTaskId;
    try {
      if (tid) {
        localStorage.setItem("pascopyof_target_task_id", String(tid));
        localStorage.setItem("pascopyof_target_tab", "tasks");
      }
      await invoke("open_manager", { taskId: tid ?? null });
      if (tid) {
        await emit("open-task-in-manager", { taskId: tid });
        setTimeout(() => emit("open-task-in-manager", { taskId: tid }), 150);
        setTimeout(() => emit("open-task-in-manager", { taskId: tid }), 450);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Close / Hide widget
  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await hideTimerWidget();
  };

  const currentTitle =
    status.activeTimer?.taskTitle ||
    status.autoPausedTask?.title ||
    status.lastActiveTask?.title ||
    lastTaskTitle ||
    "PasCopyOf Focus";

  const hasTask = Boolean(
    status.activeTimer ||
    status.autoPausedTask ||
    status.lastActiveTask ||
    lastTaskId
  );

  return (
    <div
      className="floating-widget-wrapper"
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
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
        <div
          className="widget-drag-handle"
          data-tauri-drag-region
          title="Sürüklemek için basılı tutun | Çift tıklayarak görevi açın"
        >
          ⋮⋮
        </div>

        {/* Status Indicator Dot */}
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
              ? "Sayaç çalışıyor (Çift tık: Göreve git)"
              : status.isAutoPaused
              ? "Boşta / Ekran Kilitlendi (Hareket bekleniyor)"
              : "Durduruldu (Çift tık: Göreve git)"
          }
        />

        {/* Info & Timer */}
        <div
          className="widget-info"
          data-tauri-drag-region
          title={`${currentTitle} (Çift tıklayarak görev detayına gidin)`}
        >
          <div className="widget-title">
            {status.isAutoPaused ? `[Boşta] ${currentTitle}` : currentTitle}
          </div>
          <div className="widget-time">
            {formatDigital(secondsTick)}
          </div>
        </div>

        {/* Actions */}
        <div className="widget-actions">
          {hasTask && (
            <button
              type="button"
              className="widget-btn btn-play"
              onClick={handleTogglePlay}
              title={status.isRunning ? "Sayacı Duraklat (Kısayol: Boşluk veya P)" : "Sayacı Başlat / Devam Et (Kısayol: Boşluk veya P)"}
            >
              {status.isRunning ? "⏸️" : "▶️"}
            </button>
          )}

          {hasTask && (
            <button
              type="button"
              className="widget-btn btn-done"
              onClick={handleMarkDone}
              title="Görevi Sonlandır / Tamamla (Kısayol: Enter veya D)"
            >
              ✓
            </button>
          )}

          <button
            type="button"
            className="widget-btn btn-manager"
            onClick={handleOpenManager}
            title="Yönetici Ekranında Aç (Çift tık ile de açılır)"
          >
            ↗
          </button>

          <button
            type="button"
            className="widget-btn btn-close"
            onClick={handleClose}
            title="Widget'ı Gizle (Kısayol: Esc)"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
