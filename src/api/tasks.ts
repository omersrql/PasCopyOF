import { invoke } from "@tauri-apps/api/core";

export interface TaskItem {
  id: number;
  title: string;
  notes: string;
  status: "todo" | "in_progress" | "done";
  priority: "low" | "medium" | "high";
  category: string;
  isRoutine: boolean;
  routineSchedule: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  totalDurationSeconds: number;
  checklistCount: number;
  checklistDoneCount: number;
  isTimerRunning: boolean;
}

export interface TaskWorklog {
  id: number;
  taskId: number;
  startTime: string;
  endTime: string | null;
  durationSeconds: number;
  note: string;
}

export interface TaskChecklistItem {
  id: number;
  taskId: number;
  title: string;
  isDone: boolean;
  sortOrder: number;
}

export interface ActiveTimerInfo {
  worklogId: number;
  taskId: number;
  taskTitle: string;
  startTime: string;
  elapsedSeconds: number;
}

export interface DailySummary {
  date: string;
  totalSeconds: number;
  completedTasksCount: number;
  inProgressTasksCount: number;
  markdownSummary: string;
}

export interface TimerStatusInfo {
  isRunning: boolean;
  isAutoPaused: boolean;
  activeTimer: ActiveTimerInfo | null;
  autoPausedTask: { taskId: number; title: string } | null;
  lastActiveTask?: { taskId: number; title: string } | null;
}

export async function showTimerWidget(): Promise<void> {
  await invoke("show_timer_widget");
}

export async function hideTimerWidget(): Promise<void> {
  await invoke("hide_timer_widget");
}

export async function toggleTimerWidget(): Promise<void> {
  await invoke("toggle_timer_widget");
}

export async function openTasksWindow(): Promise<void> {
  await invoke("open_tasks_window");
}

export async function getTasksShortcut(): Promise<string> {
  return await invoke<string>("get_tasks_shortcut");
}

export async function setTasksShortcut(shortcut: string): Promise<void> {
  await invoke("set_tasks_shortcut", { shortcut });
}

export async function getTimerWidgetShortcut(): Promise<string> {
  return await invoke<string>("get_timer_widget_shortcut");
}

export async function setTimerWidgetShortcut(shortcut: string): Promise<void> {
  await invoke("set_timer_widget_shortcut", { shortcut });
}

export async function showQuickTask(): Promise<void> {
  await invoke("show_quick_task");
}

export async function hideQuickTask(): Promise<void> {
  await invoke("hide_quick_task");
}

export async function toggleQuickTask(): Promise<void> {
  await invoke("toggle_quick_task");
}

export async function getQuickTaskShortcut(): Promise<string> {
  return await invoke<string>("get_quick_task_shortcut");
}

export async function setQuickTaskShortcut(shortcut: string): Promise<void> {
  await invoke("set_quick_task_shortcut", { shortcut });
}

export async function getTimerStatus(): Promise<TimerStatusInfo> {
  return await invoke<TimerStatusInfo>("get_timer_status");
}

export async function getTasks(filterStatus?: string, search?: string): Promise<TaskItem[]> {
  return await invoke<TaskItem[]>("get_tasks", {
    filterStatus: filterStatus || null,
    search: search || null,
  });
}

export async function createTask(params: {
  title: string;
  notes?: string;
  priority?: string;
  category?: string;
  isRoutine?: boolean;
  routineSchedule?: string;
}): Promise<TaskItem> {
  return await invoke<TaskItem>("create_task", {
    title: params.title,
    notes: params.notes ?? "",
    priority: params.priority ?? "medium",
    category: params.category ?? "",
    isRoutine: params.isRoutine ?? false,
    routineSchedule: params.routineSchedule ?? "",
  });
}

export async function updateTask(params: {
  id: number;
  title: string;
  notes: string;
  status: string;
  priority: string;
  category: string;
  isRoutine: boolean;
  routineSchedule: string;
}): Promise<TaskItem> {
  return await invoke<TaskItem>("update_task", {
    id: params.id,
    title: params.title,
    notes: params.notes,
    status: params.status,
    priority: params.priority,
    category: params.category,
    isRoutine: params.isRoutine,
    routineSchedule: params.routineSchedule,
  });
}

export async function deleteTask(id: number): Promise<void> {
  await invoke("delete_task", { id });
}

export async function toggleTaskStatus(id: number): Promise<TaskItem> {
  return await invoke<TaskItem>("toggle_task_status", { id });
}

export async function startTaskTimer(taskId: number): Promise<ActiveTimerInfo> {
  return await invoke<ActiveTimerInfo>("start_task_timer", { taskId });
}

export async function stopTaskTimer(taskId?: number): Promise<void> {
  await invoke("stop_task_timer", { taskId: taskId ?? null });
}

export async function getActiveTimer(): Promise<ActiveTimerInfo | null> {
  return await invoke<ActiveTimerInfo | null>("get_active_timer");
}

export async function getTaskWorklogs(taskId: number): Promise<TaskWorklog[]> {
  return await invoke<TaskWorklog[]>("get_task_worklogs", { taskId });
}

export async function deleteTaskWorklog(id: number): Promise<void> {
  await invoke("delete_task_worklog", { id });
}

export async function getTaskChecklists(taskId: number): Promise<TaskChecklistItem[]> {
  return await invoke<TaskChecklistItem[]>("get_task_checklists", { taskId });
}

export async function addTaskChecklist(taskId: number, title: string): Promise<TaskChecklistItem> {
  return await invoke<TaskChecklistItem>("add_task_checklist", { taskId, title });
}

export async function toggleTaskChecklist(id: number): Promise<TaskChecklistItem> {
  return await invoke<TaskChecklistItem>("toggle_task_checklist", { id });
}

export async function deleteTaskChecklist(id: number): Promise<void> {
  await invoke("delete_task_checklist", { id });
}

export async function getDailySummary(dateStr?: string): Promise<DailySummary> {
  return await invoke<DailySummary>("get_daily_summary", { dateStr: dateStr ?? null });
}
