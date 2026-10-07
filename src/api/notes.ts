import { invoke } from "@tauri-apps/api/core";

export interface StickyNote {
  id: number;
  title: string;
  content: string;
  color: string;
  isPinnedTop: boolean;
  isDesktopOpen: boolean;
  windowX: number | null;
  windowY: number | null;
  windowWidth: number;
  windowHeight: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export const NOTE_COLORS = [
  { id: "yellow", name: "Sarı", bg: "#fef08a", border: "#fde047", text: "#1c1917" },
  { id: "green", name: "Yeşil", bg: "#bbf7d0", border: "#86efac", text: "#1c1917" },
  { id: "blue", name: "Mavi", bg: "#bae6fd", border: "#7dd3fc", text: "#1c1917" },
  { id: "purple", name: "Mor", bg: "#e9d5ff", border: "#d8b4fe", text: "#1c1917" },
  { id: "pink", name: "Pembe", bg: "#fbcfe8", border: "#f472b6", text: "#1c1917" },
  { id: "charcoal", name: "Koyu Grafit", bg: "#1e293b", border: "#334155", text: "#f8fafc" },
];

export async function getStickyNotes(includeArchived = false): Promise<StickyNote[]> {
  return invoke<StickyNote[]>("get_sticky_notes", { includeArchived });
}

export async function getStickyNoteById(id: number): Promise<StickyNote> {
  return invoke<StickyNote>("get_sticky_note_by_id", { id });
}

export async function createStickyNote(params?: {
  title?: string;
  content?: string;
  color?: string;
  openDesktop?: boolean;
}): Promise<StickyNote> {
  return invoke<StickyNote>("create_sticky_note", {
    title: params?.title,
    content: params?.content,
    color: params?.color,
    openDesktop: params?.openDesktop ?? true,
  });
}

export async function updateStickyNote(params: {
  id: number;
  title?: string;
  content?: string;
  color?: string;
  isPinnedTop?: boolean;
}): Promise<StickyNote> {
  return invoke<StickyNote>("update_sticky_note", params);
}

export async function updateStickyNoteGeometry(params: {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<void> {
  return invoke<void>("update_sticky_note_geometry", params);
}

export async function deleteStickyNote(id: number): Promise<void> {
  return invoke<void>("delete_sticky_note", { id });
}

export async function toggleStickyNoteArchive(id: number): Promise<StickyNote> {
  return invoke<StickyNote>("toggle_sticky_note_archive", { id });
}

export async function openStickyNoteWindow(id: number): Promise<void> {
  return invoke<void>("open_sticky_note_window", { id });
}

export async function closeStickyNoteWindow(id: number): Promise<void> {
  return invoke<void>("close_sticky_note_window", { id });
}

export async function toggleAllStickyNotes(show: boolean): Promise<void> {
  return invoke<void>("toggle_all_sticky_notes", { show });
}

export async function getStickyNotesShortcut(): Promise<string> {
  return invoke<string>("get_sticky_notes_shortcut");
}

export async function setStickyNotesShortcut(shortcut: string): Promise<void> {
  return invoke<void>("set_sticky_notes_shortcut", { shortcut });
}
