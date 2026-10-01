/**
 * TaskPlanner.tsx — Focus & Daily Task Planner with Worklog / Time Tracker
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  toggleTaskStatus,
  startTaskTimer,
  stopTaskTimer,
  getActiveTimer,
  getTaskWorklogs,
  deleteTaskWorklog,
  getTaskChecklists,
  addTaskChecklist,
  toggleTaskChecklist,
  deleteTaskChecklist,
  getDailySummary,
  toggleTimerWidget,
} from "../api/tasks";
import type {
  TaskItem,
  TaskWorklog,
  TaskChecklistItem,
  ActiveTimerInfo,
  DailySummary,
} from "../api/tasks";
import { useApp } from "../context/AppContext";

interface TaskPlannerProps {
  showToast: (message: string, type: "success" | "error" | "info") => void;
}

export function TaskPlanner({ showToast }: TaskPlannerProps) {
  const { lang, t } = useApp();

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "in_progress" | "todo" | "done" | "routine">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<"low" | "medium" | "high">("medium");

  const [activeTimer, setActiveTimer] = useState<ActiveTimerInfo | null>(null);
  const [timerTick, setTimerTick] = useState<number>(0);

  const [checklists, setChecklists] = useState<TaskChecklistItem[]>([]);
  const [newChecklistTitle, setNewChecklistTitle] = useState("");

  const [worklogs, setWorklogs] = useState<TaskWorklog[]>([]);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);

  const [notesDraft, setNotesDraft] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  // Custom Delete Confirmation Modal State
  const [taskToDelete, setTaskToDelete] = useState<{ id: number; title: string } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeTask = tasks.find((t) => t.id === selectedTaskId) || null;

  // Escape key listener for custom delete confirmation modal
  useEffect(() => {
    if (!taskToDelete) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setTaskToDelete(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [taskToDelete]);

  // Format seconds to "1s 45dk 10sn", "1dk 30sn" or "45sn"
  const formatDurationFriendly = (secs: number) => {
    const sUnit = lang === "tr" ? "sn" : "s";
    const mUnit = lang === "tr" ? "dk" : "m";
    const hUnit = lang === "tr" ? "s" : "h";

    if (!secs || secs <= 0) return `0${sUnit}`;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);

    if (h > 0) {
      if (m > 0 && s > 0) return `${h}${hUnit} ${m}${mUnit} ${s}${sUnit}`;
      if (m > 0) return `${h}${hUnit} ${m}${mUnit}`;
      if (s > 0) return `${h}${hUnit} ${s}${sUnit}`;
      return `${h}${hUnit}`;
    }
    if (m > 0) {
      return s > 0 ? `${m}${mUnit} ${s}${sUnit}` : `${m}${mUnit}`;
    }
    return `${s}${sUnit}`;
  };

  // Format seconds to "01:24:35"
  const formatDigital = (totalSecs: number) => {
    const s = Math.max(0, totalSecs);
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  };

  const loadData = useCallback(async () => {
    try {
      const [tList, timer, summary] = await Promise.all([
        getTasks(filter === "routine" ? "all" : filter, searchQuery),
        getActiveTimer(),
        getDailySummary(),
      ]);

      const filteredList =
        filter === "routine" ? tList.filter((item) => item.isRoutine) : tList;

      setTasks(filteredList);
      setActiveTimer(timer);
      if (timer) {
        setTimerTick(timer.elapsedSeconds);
      }
      setDailySummary(summary);
    } catch (err) {
      console.error("Error loading task data:", err);
    }
  }, [filter, searchQuery]);

  const selectAndOpenTask = useCallback(async (targetId: number) => {
    setFilter("all");
    setSearchQuery("");
    try {
      const [tList, timer, summary] = await Promise.all([
        getTasks("all"),
        getActiveTimer(),
        getDailySummary(),
      ]);
      setTasks(tList);
      setActiveTimer(timer);
      if (timer) {
        setTimerTick(timer.elapsedSeconds);
      }
      setDailySummary(summary);
      setSelectedTaskId(targetId);

      const found = tList.find((t) => t.id === targetId);
      if (found) {
        setNotesDraft(found.notes || "");
      }
      getTaskChecklists(targetId).then(setChecklists).catch(console.error);
      getTaskWorklogs(targetId).then(setWorklogs).catch(console.error);

      // Smooth scroll task into view and briefly pulse it
      setTimeout(() => {
        const el = document.querySelector(`.task-card[data-task-id="${targetId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
          el.classList.add("just-opened");
          setTimeout(() => el.classList.remove("just-opened"), 1200);
        }
      }, 150);
    } catch (err) {
      console.error("selectAndOpenTask error:", err);
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("pascopyof_target_task_id");
    if (stored) {
      const tid = Number(stored);
      if (tid) {
        selectAndOpenTask(tid);
      }
      localStorage.removeItem("pascopyof_target_task_id");
    } else {
      loadData();
    }

    const unlistens: Array<() => void> = [];
    listen("timer-auto-paused", (event: any) => {
      loadData();
      const reason = event.payload?.reason === "locked" ? "Ekran kilitlendiği" : "1 dk hareketsizlik";
      showToast(
        lang === "tr"
          ? `⏸️ ${reason} için sayaç otomatik duraklatıldı.`
          : `⏸️ Timer auto-paused due to inactivity/lock.`,
        "info"
      );
    }).then((u) => unlistens.push(u));

    listen("timer-auto-resumed", () => {
      loadData();
      showToast(
        lang === "tr"
          ? `▶️ Tekrar hoş geldiniz! Sayaç kaldığı yerden devam ediyor.`
          : `▶️ Welcome back! Timer resumed.`,
        "success"
      );
    }).then((u) => unlistens.push(u));

    listen("timer-started", () => loadData()).then((u) => unlistens.push(u));
    listen("timer-stopped", () => loadData()).then((u) => unlistens.push(u));
    listen("tasks-changed", () => loadData()).then((u) => unlistens.push(u));
    listen("task-updated", (event: any) => {
      loadData();
      if (event.payload?.id && event.payload.id === selectedTaskId) {
        getTaskChecklists(event.payload.id).then(setChecklists).catch(console.error);
        getTaskWorklogs(event.payload.id).then(setWorklogs).catch(console.error);
      }
    }).then((u) => unlistens.push(u));
    listen("open-task-in-manager", (event: any) => {
      if (event.payload?.taskId) {
        selectAndOpenTask(Number(event.payload.taskId));
      } else {
        loadData();
      }
    }).then((u) => unlistens.push(u));

    return () => {
      unlistens.forEach((u) => u());
    };
  }, [loadData, lang, showToast, selectAndOpenTask, selectedTaskId]);

  // If a task is selected, load its checklist and worklogs
  useEffect(() => {
    if (selectedTaskId !== null) {
      getTaskChecklists(selectedTaskId).then(setChecklists).catch(console.error);
      getTaskWorklogs(selectedTaskId).then(setWorklogs).catch(console.error);
      const curr = tasks.find((t) => t.id === selectedTaskId);
      if (curr) {
        setNotesDraft(curr.notes || "");
      }
    } else {
      setChecklists([]);
      setWorklogs([]);
      setNotesDraft("");
    }
  }, [selectedTaskId]);

  // Live timer interval
  useEffect(() => {
    if (!activeTimer) return;
    const interval = window.setInterval(() => {
      setTimerTick((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTimer]);

  // Handle Quick Task Add
  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTaskTitle.trim();
    if (!title) return;

    try {
      const created = await createTask({
        title,
        priority: newTaskPriority,
        isRoutine: filter === "routine",
      });
      setNewTaskTitle("");
      setTasks((prev) => [created, ...prev]);
      setSelectedTaskId(created.id);
      showToast(lang === "tr" ? "Görev eklendi" : "Task added", "success");
      getDailySummary().then(setDailySummary).catch(console.error);
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  // Toggle Task Completion
  const handleToggleTask = async (task: TaskItem) => {
    try {
      const updated = await toggleTaskStatus(task.id);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
      if (activeTimer && activeTimer.taskId === task.id) {
        setActiveTimer(null);
      }
      loadData();
      showToast(
        updated.status === "done"
          ? (lang === "tr" ? "✓ Görev tamamlandı!" : "✓ Task completed!")
          : (lang === "tr" ? "Görev yapılacaklara alındı" : "Task marked as to do"),
        "success"
      );
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  // Start / Stop Timer
  const handleToggleTimer = async (task: TaskItem) => {
    if (activeTimer && activeTimer.taskId === task.id) {
      // Stop timer
      try {
        await stopTaskTimer(task.id);
        setActiveTimer(null);
        showToast(lang === "tr" ? "Sayaç durduruldu" : "Timer stopped", "info");
        loadData();
        if (selectedTaskId === task.id) {
          getTaskWorklogs(task.id).then(setWorklogs).catch(console.error);
        }
      } catch (err) {
        showToast(String(err), "error");
      }
    } else {
      // Start timer
      try {
        const info = await startTaskTimer(task.id);
        setActiveTimer(info);
        setTimerTick(0);
        showToast(
          lang === "tr"
            ? `▶️ "${task.title}" için sayaç başlatıldı`
            : `▶️ Timer started for "${task.title}"`,
          "success"
        );
        loadData();
      } catch (err) {
        showToast(String(err), "error");
      }
    }
  };

  // Save Notes Draft
  const handleSaveNotes = async () => {
    if (!activeTask) return;
    setIsSavingNotes(true);
    try {
      const updated = await updateTask({
        id: activeTask.id,
        title: activeTask.title,
        notes: notesDraft,
        status: activeTask.status,
        priority: activeTask.priority,
        category: activeTask.category,
        isRoutine: activeTask.isRoutine,
        routineSchedule: activeTask.routineSchedule,
      });
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      showToast(lang === "tr" ? "Not kaydedildi" : "Notes saved", "success");
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setIsSavingNotes(false);
    }
  };

  // Add Checklist Item
  const handleAddChecklist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTaskId || !newChecklistTitle.trim()) return;

    try {
      const item = await addTaskChecklist(selectedTaskId, newChecklistTitle.trim());
      setChecklists((prev) => [...prev, item]);
      setNewChecklistTitle("");
      setTasks((prev) =>
        prev.map((t) =>
          t.id === selectedTaskId
            ? { ...t, checklistCount: t.checklistCount + 1 }
            : t
        )
      );
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  // Toggle Checklist Item
  const handleToggleChecklist = async (item: TaskChecklistItem) => {
    try {
      const updated = await toggleTaskChecklist(item.id);
      setChecklists((prev) => prev.map((c) => (c.id === item.id ? updated : c)));
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id === item.taskId) {
            const diff = updated.isDone ? 1 : -1;
            return { ...t, checklistDoneCount: t.checklistDoneCount + diff };
          }
          return t;
        })
      );
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  // Delete Checklist Item
  const handleDeleteChecklist = async (id: number) => {
    try {
      await deleteTaskChecklist(id);
      setChecklists((prev) => prev.filter((c) => c.id !== id));
      if (selectedTaskId) {
        getTaskChecklists(selectedTaskId).then(setChecklists).catch(console.error);
        loadData();
      }
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  // Open custom theme-styled delete confirmation modal
  const requestDeleteTask = (task: { id: number; title: string }) => {
    setTaskToDelete(task);
  };

  // Execute deletion after modal confirmation
  const executeDeleteTask = async (taskId: number) => {
    try {
      await deleteTask(taskId);
      if (selectedTaskId === taskId) {
        setSelectedTaskId(null);
      }
      if (activeTimer && activeTimer.taskId === taskId) {
        setActiveTimer(null);
      }
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      showToast(lang === "tr" ? "✓ Görev başarıyla silindi" : "✓ Task deleted successfully", "info");
      getDailySummary().then(setDailySummary).catch(console.error);
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setTaskToDelete(null);
    }
  };

  // Copy Daily Summary Report to Clipboard
  const handleCopyReport = async () => {
    try {
      const summary = await getDailySummary();
      await navigator.clipboard.writeText(summary.markdownSummary);
      showToast(t("tasksDailySummaryCopied"), "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  return (
    <div className="task-planner-root">
      {/* ── Top Focus Bar & Daily Summary ── */}
      <div className="task-header-bar">
        <div className="task-header-left">
          <div className="task-header-title">🎯 {t("tasksTitle")}</div>
          <div className="task-header-metrics">
            <span className="metric-badge">
              ⏱️ {t("tasksTotalEffort")}:{" "}
              <strong>{formatDurationFriendly(dailySummary?.totalSeconds || 0)}</strong>
            </span>
            <span className="metric-badge">
              ✅ {lang === "tr" ? "Tamamlanan" : "Completed"}:{" "}
              <strong>{dailySummary?.completedTasksCount || 0}</strong>
            </span>
            <span className="metric-badge">
              ⏳ {lang === "tr" ? "Aktif" : "Active"}:{" "}
              <strong>{dailySummary?.inProgressTasksCount || 0}</strong>
            </span>
          </div>
        </div>

        <div className="task-header-right">
          {activeTimer && (
            <div className="active-timer-pill">
              <span className="timer-pulse-dot" />
              <span className="timer-task-name" title={activeTimer.taskTitle}>
                {activeTimer.taskTitle}
              </span>
              <span className="timer-digits">{formatDigital(timerTick)}</span>
              <button
                type="button"
                className="btn-timer-stop-mini"
                title={t("tasksTimerStop")}
                onClick={() => {
                  const tObj = tasks.find((t) => t.id === activeTimer.taskId);
                  if (tObj) handleToggleTimer(tObj);
                  else stopTaskTimer().then(() => setActiveTimer(null));
                }}
              >
                ⏸️
              </button>
            </div>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => toggleTimerWidget()}
            title={lang === "tr" ? "Yüzen Sayacı Aç / Kapat (Kısayol: Ctrl+Shift+T)" : "Toggle Floating Widget (Shortcut: Ctrl+Shift+T)"}
          >
            📌 {lang === "tr" ? "Yüzen Sayaç" : "Mini Widget"}
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-copy-report"
            onClick={handleCopyReport}
            title={t("tasksDailySummaryBtn")}
          >
            {t("tasksDailySummaryBtn")}
          </button>
        </div>
      </div>

      {/* ── Main Canvas (Split View) ── */}
      <div className="task-canvas">
        {/* ── Left Column: Task List ── */}
        <div className="task-list-panel">
          {/* Quick Add Form */}
          <form className="quick-add-form" onSubmit={handleQuickAdd}>
            <input
              type="text"
              className="quick-add-input"
              placeholder={t("tasksNewTaskPlaceholder")}
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
            />
            <div className="quick-add-actions">
              <select
                className="quick-add-priority"
                value={newTaskPriority}
                onChange={(e) =>
                  setNewTaskPriority(e.target.value as "low" | "medium" | "high")
                }
              >
                <option value="low">🔵 {t("tasksPriorityLow")}</option>
                <option value="medium">🟡 {t("tasksPriorityMedium")}</option>
                <option value="high">🔴 {t("tasksPriorityHigh")}</option>
              </select>
              <button type="submit" className="btn btn-primary btn-add-task">
                +
              </button>
            </div>
          </form>

          {/* Filter Pills & Search */}
          <div className="task-filters-row">
            <div className="task-filter-pills">
              <button
                type="button"
                className={`filter-pill ${filter === "all" ? "active" : ""}`}
                onClick={() => setFilter("all")}
              >
                {t("tasksFilterAll")}
              </button>
              <button
                type="button"
                className={`filter-pill ${filter === "in_progress" ? "active" : ""}`}
                onClick={() => setFilter("in_progress")}
              >
                {t("tasksFilterInProgress")}
              </button>
              <button
                type="button"
                className={`filter-pill ${filter === "todo" ? "active" : ""}`}
                onClick={() => setFilter("todo")}
              >
                {t("tasksFilterTodo")}
              </button>
              <button
                type="button"
                className={`filter-pill ${filter === "done" ? "active" : ""}`}
                onClick={() => setFilter("done")}
              >
                {t("tasksFilterDone")}
              </button>
              <button
                type="button"
                className={`filter-pill ${filter === "routine" ? "active" : ""}`}
                onClick={() => setFilter("routine")}
              >
                {t("tasksFilterRoutine")}
              </button>
            </div>
            <div className="task-search-wrap">
              <input
                ref={searchInputRef}
                type="text"
                className="task-search-input"
                placeholder={t("tasksSearchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Tasks List */}
          <div className="tasks-scroll-list">
            {tasks.length === 0 ? (
              <div className="task-empty-state">
                <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
                <div>{t("tasksNoTasksFound")}</div>
              </div>
            ) : (
              tasks.map((task) => {
                const isRunning = activeTimer?.taskId === task.id;
                const isSelected = selectedTaskId === task.id;
                const isDone = task.status === "done";

                return (
                  <div
                    key={task.id}
                    data-task-id={task.id}
                    className={`task-card ${isSelected ? "selected" : ""} ${
                      isDone ? "is-done" : ""
                    } ${isRunning ? "is-running" : ""}`}
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <div className="task-card-left">
                      <button
                        type="button"
                        className={`task-checkbox ${isDone ? "checked" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleTask(task);
                        }}
                        title={isDone ? t("tasksMarkTodo") : t("tasksMarkDone")}
                      >
                        {isDone ? "✓" : ""}
                      </button>

                      <div className="task-card-main">
                        <div className="task-card-title-row">
                          <span className={`task-card-title ${isDone ? "line-through" : ""}`}>
                            {task.title}
                          </span>
                          {task.isRoutine && (
                            <span className="routine-badge" title="Rutin Görev">
                              🔄
                            </span>
                          )}
                        </div>

                        <div className="task-card-badges">
                          <span className={`priority-tag priority-${task.priority}`}>
                            {task.priority === "high"
                              ? "🔴 Yüksek"
                              : task.priority === "low"
                              ? "🔵 Düşük"
                              : "🟡 Orta"}
                          </span>

                          {task.totalDurationSeconds > 0 && (
                            <span className="duration-tag">
                              ⏱️ {formatDurationFriendly(task.totalDurationSeconds)}
                            </span>
                          )}

                          {task.checklistCount > 0 && (
                            <span className="checklist-tag">
                              ☑️ {task.checklistDoneCount}/{task.checklistCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="task-card-right">
                      {!isDone && (
                        <button
                          type="button"
                          className={`btn-card-timer ${isRunning ? "running" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleTimer(task);
                          }}
                          title={isRunning ? t("tasksTimerStop") : t("tasksTimerStart")}
                        >
                          {isRunning ? "⏸️" : "▶️"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-card-del"
                        onClick={(e) => {
                          e.stopPropagation();
                          requestDeleteTask({ id: task.id, title: task.title });
                        }}
                        title={t("delete")}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right Column: Task Detail & Notes Canvas ── */}
        <div className="task-detail-panel">
          {activeTask ? (
            <div className="detail-inner">
              {/* Task Header & Controls */}
              <div className="detail-header">
                <input
                  type="text"
                  className="detail-title-input"
                  value={activeTask.title}
                  onChange={async (e) => {
                    const newTitle = e.target.value;
                    setTasks((prev) =>
                      prev.map((t) => (t.id === activeTask.id ? { ...t, title: newTitle } : t))
                    );
                    await updateTask({
                      id: activeTask.id,
                      title: newTitle,
                      notes: activeTask.notes,
                      status: activeTask.status,
                      priority: activeTask.priority,
                      category: activeTask.category,
                      isRoutine: activeTask.isRoutine,
                      routineSchedule: activeTask.routineSchedule,
                    });
                  }}
                />

                <div className="detail-header-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-delete-task"
                    onClick={() => requestDeleteTask({ id: activeTask.id, title: activeTask.title })}
                    title={t("delete")}
                  >
                    🗑️ {t("delete")}
                  </button>
                </div>
              </div>

              {/* Status & Priority Row */}
              <div className="detail-meta-row">
                <div className="detail-meta-item">
                  <label className="meta-label">{t("tasksStatusLabel")}</label>
                  <select
                    className="meta-select"
                    value={activeTask.status}
                    onChange={async (e) => {
                      const st = e.target.value as "todo" | "in_progress" | "done";
                      const updated = await updateTask({
                        id: activeTask.id,
                        title: activeTask.title,
                        notes: activeTask.notes,
                        status: st,
                        priority: activeTask.priority,
                        category: activeTask.category,
                        isRoutine: activeTask.isRoutine,
                        routineSchedule: activeTask.routineSchedule,
                      });
                      setTasks((prev) =>
                        prev.map((t) => (t.id === updated.id ? updated : t))
                      );
                      loadData();
                    }}
                  >
                    <option value="todo">{t("tasksStatusTodo")}</option>
                    <option value="in_progress">{t("tasksStatusInProgress")}</option>
                    <option value="done">{t("tasksStatusDone")}</option>
                  </select>
                </div>

                <div className="detail-meta-item">
                  <label className="meta-label">{t("tasksPriorityLabel")}</label>
                  <select
                    className="meta-select"
                    value={activeTask.priority}
                    onChange={async (e) => {
                      const pr = e.target.value as "low" | "medium" | "high";
                      const updated = await updateTask({
                        id: activeTask.id,
                        title: activeTask.title,
                        notes: activeTask.notes,
                        status: activeTask.status,
                        priority: pr,
                        category: activeTask.category,
                        isRoutine: activeTask.isRoutine,
                        routineSchedule: activeTask.routineSchedule,
                      });
                      setTasks((prev) =>
                        prev.map((t) => (t.id === updated.id ? updated : t))
                      );
                    }}
                  >
                    <option value="low">🔵 {t("tasksPriorityLow")}</option>
                    <option value="medium">🟡 {t("tasksPriorityMedium")}</option>
                    <option value="high">🔴 {t("tasksPriorityHigh")}</option>
                  </select>
                </div>

                <div className="detail-meta-item" style={{ flex: 1 }}>
                  <label className="meta-label">Rutin</label>
                  <label className="routine-toggle-label">
                    <input
                      type="checkbox"
                      checked={activeTask.isRoutine}
                      onChange={async (e) => {
                        const isR = e.target.checked;
                        const updated = await updateTask({
                          id: activeTask.id,
                          title: activeTask.title,
                          notes: activeTask.notes,
                          status: activeTask.status,
                          priority: activeTask.priority,
                          category: activeTask.category,
                          isRoutine: isR,
                          routineSchedule: isR ? "daily" : "",
                        });
                        setTasks((prev) =>
                          prev.map((t) => (t.id === updated.id ? updated : t))
                        );
                      }}
                    />
                    <span>{t("tasksRoutineCheckbox")}</span>
                  </label>
                </div>
              </div>

              {/* Big Timer Control Box */}
              <div
                className={`task-timer-hero ${
                  activeTimer?.taskId === activeTask.id ? "running" : ""
                }`}
              >
                <div className="hero-timer-left">
                  <div className="hero-timer-label">{t("tasksElapsed")}</div>
                  <div className="hero-timer-digits">
                    {activeTimer?.taskId === activeTask.id
                      ? formatDigital(timerTick)
                      : formatDigital(activeTask.totalDurationSeconds)}
                  </div>
                  <div className="hero-total-label">
                    {t("tasksTotalEffort")}:{" "}
                    <strong>
                      {formatDurationFriendly(
                        activeTask.totalDurationSeconds +
                          (activeTimer?.taskId === activeTask.id ? timerTick : 0)
                      )}
                    </strong>
                  </div>
                </div>

                <div className="hero-timer-right">
                  <button
                    type="button"
                    className={`btn-hero-timer ${
                      activeTimer?.taskId === activeTask.id ? "stop" : "start"
                    }`}
                    onClick={() => handleToggleTimer(activeTask)}
                  >
                    {activeTimer?.taskId === activeTask.id
                      ? `⏸️ ${t("tasksTimerStop")}`
                      : `▶️ ${t("tasksTimerStart")}`}
                  </button>
                </div>
              </div>

              {/* Checklist Sub-steps */}
              <div className="checklist-section">
                <div className="section-title">☑️ {t("tasksChecklistLabel")}</div>

                <form className="checklist-add-form" onSubmit={handleAddChecklist}>
                  <input
                    type="text"
                    className="checklist-add-input"
                    placeholder={t("tasksAddChecklistPlaceholder")}
                    value={newChecklistTitle}
                    onChange={(e) => setNewChecklistTitle(e.target.value)}
                  />
                  <button type="submit" className="btn btn-secondary btn-checklist-add">
                    +
                  </button>
                </form>

                <div className="checklist-items">
                  {checklists.map((item) => (
                    <div
                      key={item.id}
                      className={`checklist-row ${item.isDone ? "is-done" : ""}`}
                    >
                      <button
                        type="button"
                        className={`checklist-box ${item.isDone ? "checked" : ""}`}
                        onClick={() => handleToggleChecklist(item)}
                      >
                        {item.isDone ? "✓" : ""}
                      </button>
                      <span className="checklist-text">{item.title}</span>
                      <button
                        type="button"
                        className="btn-checklist-del"
                        onClick={() => handleDeleteChecklist(item.id)}
                        title="Kaldır"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rich Technical Notes */}
              <div className="notes-section">
                <div className="notes-section-header">
                  <span className="section-title">📝 {t("tasksNotesLabel")}</span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-save-notes"
                    onClick={handleSaveNotes}
                    disabled={isSavingNotes}
                  >
                    {isSavingNotes ? "Kaydediliyor..." : "💾 Notu Kaydet"}
                  </button>
                </div>
                <textarea
                  className="notes-textarea"
                  placeholder={t("tasksNotesPlaceholder")}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={handleSaveNotes}
                />
              </div>

              {/* Worklog History */}
              {worklogs.length > 0 && (
                <div className="worklogs-section">
                  <div className="section-title">🕒 {t("tasksWorklogHistory")}</div>
                  <div className="worklogs-list">
                    {worklogs.map((log) => (
                      <div key={log.id} className="worklog-row">
                        <span className="worklog-time">
                          {log.startTime}
                          {log.endTime ? ` → ${log.endTime}` : t("tasksRunningSuffix")}
                        </span>
                        <span className="worklog-duration">
                          ⏱️ {formatDurationFriendly(log.durationSeconds)}
                        </span>
                        <button
                          type="button"
                          className="btn-worklog-del"
                          onClick={async () => {
                            await deleteTaskWorklog(log.id);
                            setWorklogs((prev) => prev.filter((w) => w.id !== log.id));
                            loadData();
                          }}
                          title={t("tasksDeleteWorklog")}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="detail-empty-state">
              <div style={{ fontSize: 44, marginBottom: 12 }}>🎯</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
                {lang === "tr" ? "Bir Görev Seçin" : "Select a Task"}
              </div>
              <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                {lang === "tr"
                  ? "Sol listeden bir göreve tıklayarak detaylarını, notlarını, kontrol listesini görebilir ve sayacını başlatabilirsiniz."
                  : "Click a task from the list to view notes, checklists, and start its focus timer."}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Theme-Styled Task Delete Confirmation Modal ── */}
      {taskToDelete && (
        <div className="modal-overlay" style={{ zIndex: 99999 }} onClick={() => setTaskToDelete(null)}>
          <div
            className="modal-dialog task-delete-confirm-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}>🗑️</span>
                <div>
                  <div className="modal-title" style={{ fontSize: 16, fontWeight: 700 }}>
                    {t("tasksDeleteModalTitle")}
                  </div>
                  <div className="modal-subtitle" style={{ fontSize: 12 }}>
                    {t("tasksDeleteModalIrreversible")}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setTaskToDelete(null)}
                title="Esc"
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ margin: 0, fontSize: 13.5, color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
                {t("tasksDeleteModalDesc")}
              </p>

              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-bg-primary)",
                  border: "1px solid var(--color-border)",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span style={{ color: "var(--color-danger)", fontSize: 12 }}>●</span>
                <span style={{ wordBreak: "break-word" }}>{taskToDelete.title}</span>
              </div>
            </div>

            <div className="modal-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 20px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setTaskToDelete(null)}
              >
                {t("cancel")} (Esc)
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => executeDeleteTask(taskToDelete.id)}
                autoFocus
              >
                {t("tasksDeleteModalConfirmBtn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
