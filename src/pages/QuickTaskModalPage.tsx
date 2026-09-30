import React, { useState, useEffect, useRef } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { useApp } from "../context/AppContext";
import {
  createTask,
  startTaskTimer,
  showTimerWidget,
  hideQuickTask,
} from "../api/tasks";

export default function QuickTaskModalPage() {
  const { t } = useApp();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [isRoutine, setIsRoutine] = useState(false);
  const [autoStartTimer, setAutoStartTimer] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorShake, setErrorShake] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setTitle("");
    setPriority("medium");
    setIsRoutine(false);
    setAutoStartTimer(true);
    setIsSubmitting(false);
    setErrorShake(false);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  useEffect(() => {
    // Initial focus
    inputRef.current?.focus();

    // Listen for reset events from Tauri when the window is shown
    const unlistenPromise = listen("quick-task-reset", () => {
      resetForm();
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const handleClose = async () => {
    try {
      await hideQuickTask();
    } catch (err) {
      console.error("Failed to hide quick task window:", err);
    }
  };

  const handleSubmit = async (withTimer: boolean) => {
    const trimmed = title.trim();
    if (!trimmed) {
      setErrorShake(true);
      setTimeout(() => setErrorShake(false), 500);
      inputRef.current?.focus();
      return;
    }

    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      // 1. Create the task
      const newTask = await createTask({
        title: trimmed,
        priority,
        isRoutine,
      });

      // 2. Start timer if requested
      if (withTimer) {
        try {
          await startTaskTimer(newTask.id);
          await showTimerWidget();
        } catch (timerErr) {
          console.error("Failed to start task timer:", timerErr);
        }
      }

      // 3. Notify other windows (Manager, Launcher, etc.)
      await emit("tasks-changed", { id: newTask.id });
      await emit("task-updated", { id: newTask.id });

      // 4. Reset & hide popup
      resetForm();
      await hideQuickTask();
    } catch (err) {
      console.error("Failed to create quick task:", err);
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (e.ctrlKey) {
        // Ctrl+Enter: Save only (without starting timer)
        handleSubmit(false);
      } else {
        // Enter: Save and start timer if autoStartTimer is checked
        handleSubmit(autoStartTimer);
      }
    }
  };

  return (
    <div
      className="quick-task-window-container"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className={`quick-task-card ${errorShake ? "shake-anim" : ""}`}>
        {/* Header (Draggable) */}
        <div className="quick-task-header" data-tauri-drag-region>
          <div className="quick-task-header-title" data-tauri-drag-region>
            <span className="quick-task-badge-icon">⚡</span>
            <span>{t("quickTaskModalTitle")}</span>
          </div>
          <button
            type="button"
            className="quick-task-close-btn"
            onClick={handleClose}
            title={t("close")}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="quick-task-body">
          <div className="quick-task-input-wrapper">
            <input
              ref={inputRef}
              type="text"
              className="quick-task-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("quickTaskInputPlaceholder")}
              autoFocus
              disabled={isSubmitting}
            />
          </div>

          {/* Options Row */}
          <div className="quick-task-options-row">
            {/* Priority Selector */}
            <div className="quick-task-priority-group">
              <button
                type="button"
                className={`quick-task-priority-pill low ${
                  priority === "low" ? "active" : ""
                }`}
                onClick={() => setPriority("low")}
              >
                ● {t("quickTaskPriorityLow")}
              </button>
              <button
                type="button"
                className={`quick-task-priority-pill medium ${
                  priority === "medium" ? "active" : ""
                }`}
                onClick={() => setPriority("medium")}
              >
                ● {t("quickTaskPriorityMedium")}
              </button>
              <button
                type="button"
                className={`quick-task-priority-pill high ${
                  priority === "high" ? "active" : ""
                }`}
                onClick={() => setPriority("high")}
              >
                ● {t("quickTaskPriorityHigh")}
              </button>
            </div>

            {/* Routine & Auto-start Checkboxes */}
            <div className="quick-task-checkboxes">
              <label className="quick-task-checkbox-label">
                <input
                  type="checkbox"
                  checked={isRoutine}
                  onChange={(e) => setIsRoutine(e.target.checked)}
                />
                <span>{t("quickTaskRoutineCheckbox")}</span>
              </label>

              <label className="quick-task-checkbox-label timer-label">
                <input
                  type="checkbox"
                  checked={autoStartTimer}
                  onChange={(e) => setAutoStartTimer(e.target.checked)}
                />
                <span className="timer-badge-text">
                  ⏱️ {t("quickTaskStartTimerCheckbox")}
                </span>
              </label>
            </div>
          </div>

          {/* Action Footer */}
          <div className="quick-task-actions">
            <button
              type="button"
              className="quick-task-btn cancel-btn"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              {t("quickTaskCancelBtn")}
            </button>

            {autoStartTimer && (
              <button
                type="button"
                className="quick-task-btn secondary-btn"
                onClick={() => handleSubmit(false)}
                disabled={isSubmitting}
                title="Ctrl+Enter"
              >
                {t("quickTaskSaveOnlyBtn")}
              </button>
            )}

            <button
              type="button"
              className="quick-task-btn primary-btn"
              onClick={() => handleSubmit(autoStartTimer)}
              disabled={isSubmitting}
              title="Enter"
            >
              {autoStartTimer
                ? t("quickTaskSaveAndStartBtn")
                : t("save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
