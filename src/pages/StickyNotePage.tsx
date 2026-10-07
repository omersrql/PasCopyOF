/**
 * StickyNotePage.tsx — Floating Desktop Sticky Note
 * Inspired by Microsoft Sticky Notes: Frameless, pastel, draggable, always-on-top toggle, rich formatting & checklist.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  getStickyNoteById,
  updateStickyNote,
  updateStickyNoteGeometry,
  deleteStickyNote,
  closeStickyNoteWindow,
  createStickyNote,
  NOTE_COLORS,
} from "../api/notes";
import { createTask } from "../api/tasks";
import { addCredential } from "../api/vault";

export default function StickyNotePage() {
  const [searchParams] = useSearchParams();
  const idStr = searchParams.get("id");
  const noteId = idStr ? parseInt(idStr, 10) : null;

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [color, setColor] = useState("#fef08a");
  const [isPinnedTop, setIsPinnedTop] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geometryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTempNotice = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 2500);
  };

  // Load Note Data
  const loadNote = useCallback(async () => {
    if (!noteId) return;
    try {
      const data = await getStickyNoteById(noteId);
      setTitle(data.title);
      setContent(data.content);
      setColor(data.color || "#fef08a");
      setIsPinnedTop(data.isPinnedTop);
    } catch (err) {
      console.error("Failed to load note:", err);
    }
  }, [noteId]);

  useEffect(() => {
    loadNote();
  }, [loadNote]);

  // Debounced Auto-Save Content & Title
  const triggerAutoSave = (newTitle: string, newContent: string, newColor: string, pinned: boolean) => {
    if (!noteId) return;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await updateStickyNote({
          id: noteId,
          title: newTitle,
          content: newContent,
          color: newColor,
          isPinnedTop: pinned,
        });
      } catch (err) {
        console.error("Auto-save failed:", err);
      }
    }, 350);
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTitle(val);
    triggerAutoSave(val, content, color, isPinnedTop);
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    triggerAutoSave(title, val, color, isPinnedTop);
  };

  // Color selection
  const handleSelectColor = async (hex: string) => {
    setColor(hex);
    setShowColorPicker(false);
    if (noteId) {
      try {
        await updateStickyNote({ id: noteId, color: hex });
      } catch (err) {
        console.error("Failed to update color:", err);
      }
    }
  };

  // Toggle Pin on Top
  const handleTogglePin = async () => {
    const nextPinned = !isPinnedTop;
    setIsPinnedTop(nextPinned);
    if (!noteId) return;
    try {
      await updateStickyNote({ id: noteId, isPinnedTop: nextPinned });
      const win = getCurrentWebviewWindow();
      await win.setAlwaysOnTop(nextPinned);
      showTempNotice(nextPinned ? "Üstte Sabitlendi 📌" : "Sabitleme Kaldırıldı");
    } catch (err) {
      console.error("Failed to toggle pin:", err);
    }
  };

  // Close Note Window
  const handleClose = async () => {
    if (!noteId) return;
    try {
      await closeStickyNoteWindow(noteId);
    } catch (err) {
      console.error("Failed to close window:", err);
    }
  };

  // Delete Note
  const handleDelete = async () => {
    if (!noteId) return;
    if (window.confirm("Bu yapışkan notu silmek istediğinize emin misiniz?")) {
      try {
        await deleteStickyNote(noteId);
      } catch (err) {
        console.error("Failed to delete note:", err);
      }
    }
  };

  // Create New Note (+ button)
  const handleNewNote = async () => {
    try {
      await createStickyNote({ color });
    } catch (err) {
      console.error("Failed to create new note:", err);
    }
  };

  // Convert to Task
  const handleConvertToTask = async () => {
    setShowMenu(false);
    const taskTitle = title.trim() || content.trim().split("\n")[0] || "Yeni Görev";
    try {
      await createTask({
        title: taskTitle.slice(0, 100),
        notes: content,
        priority: "medium",
        category: "Sticky Note",
      });
      showTempNotice("Görev Olarak Eklendi ✅");
    } catch (err) {
      console.error("Failed to convert note to task:", err);
      showTempNotice("Görev eklenirken hata oluştu");
    }
  };

  // Save to Vault
  const handleSaveToVault = async () => {
    setShowMenu(false);
    const keyName = title.trim() || "Yapışkan Not";
    try {
      await addCredential({
        keyName,
        username: "Sticky Note",
        password: content,
        notes: "Yapışkan nottan aktarıldı",
        categoryId: null,
      });
      showTempNotice("Kasaya Kaydedildi 🔐");
    } catch (err) {
      console.error("Failed to save to vault:", err);
      showTempNotice("Kasaya kaydetme başarısız (Kasa kilitli olabilir)");
    }
  };

  // Quick formatting insert
  const insertFormatting = (prefix: string, suffix: string = "") => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selectedText = content.substring(start, end);
    const replacement = `${prefix}${selectedText || "metin"}${suffix}`;
    const newContent = content.substring(0, start) + replacement + content.substring(end);
    setContent(newContent);
    triggerAutoSave(title, newContent, color, isPinnedTop);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, start + replacement.length - suffix.length);
    }, 50);
  };

  const insertChecklist = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = content.substring(0, start);
    const isAtLineStart = start === 0 || before.endsWith("\n");
    const checkPrefix = isAtLineStart ? "☐ " : "\n☐ ";
    const newContent = content.substring(0, start) + checkPrefix + content.substring(end);
    setContent(newContent);
    triggerAutoSave(title, newContent, color, isPinnedTop);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + checkPrefix.length, start + checkPrefix.length);
    }, 50);
  };

  // Listen to Window Move & Resize to update geometry in SQLite
  useEffect(() => {
    if (!noteId) return;
    const win = getCurrentWebviewWindow();

    const saveGeometry = async () => {
      try {
        const pos = await win.innerPosition();
        const size = await win.innerSize();
        const scale = await win.scaleFactor();
        const x = pos.x / scale;
        const y = pos.y / scale;
        const width = size.width / scale;
        const height = size.height / scale;

        if (geometryTimeoutRef.current) {
          clearTimeout(geometryTimeoutRef.current);
        }
        geometryTimeoutRef.current = setTimeout(() => {
          updateStickyNoteGeometry({ id: noteId, x, y, width, height }).catch(console.error);
        }, 500);
      } catch (err) {
        // Ignored during drag
      }
    };

    const unlistenMoved = win.onMoved(() => saveGeometry());
    const unlistenResized = win.onResized(() => saveGeometry());

    return () => {
      unlistenMoved.then((fn) => fn()).catch(() => {});
      unlistenResized.then((fn) => fn()).catch(() => {});
    };
  }, [noteId]);

  // Window drag handler
  const handleDrag = () => {
    try {
      getCurrentWebviewWindow().startDragging();
    } catch (err) {
      console.error("startDragging error:", err);
    }
  };

  // Find theme colors
  const activeColorObj = NOTE_COLORS.find((c) => c.bg.toLowerCase() === color.toLowerCase()) || NOTE_COLORS[0];

  return (
    <div
      className="sticky-note-window"
      style={{
        backgroundColor: activeColorObj.bg,
        color: activeColorObj.text,
        borderColor: activeColorObj.border,
      }}
    >
      {/* ─── Header / Drag Region ────────────────────────────────────── */}
      <div
        className="sticky-note-header"
        data-tauri-drag-region
        onMouseDown={handleDrag}
      >
        <div className="sticky-header-actions left">
          <button
            type="button"
            className="sticky-tool-btn"
            title="Yeni Not Ekle (Ctrl+N)"
            onClick={(e) => {
              e.stopPropagation();
              handleNewNote();
            }}
          >
            ＋
          </button>
          <div className="sticky-color-picker-wrapper">
            <button
              type="button"
              className="sticky-tool-btn"
              title="Not Rengi"
              onClick={(e) => {
                e.stopPropagation();
                setShowColorPicker(!showColorPicker);
                setShowMenu(false);
              }}
            >
              🎨
            </button>
            {showColorPicker && (
              <div
                className="sticky-color-popover"
                onClick={(e) => e.stopPropagation()}
              >
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`sticky-color-dot ${color === c.bg ? "active" : ""}`}
                    style={{ backgroundColor: c.bg, borderColor: c.border }}
                    title={c.name}
                    onClick={() => handleSelectColor(c.bg)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="sticky-header-title-text" data-tauri-drag-region>
          {isPinnedTop && <span className="pinned-badge">📌</span>}
        </div>

        <div className="sticky-header-actions right">
          <button
            type="button"
            className={`sticky-tool-btn ${isPinnedTop ? "pinned" : ""}`}
            title={isPinnedTop ? "Her Zaman Üstte (Aktif)" : "Her Zaman Üstte Tut"}
            onClick={(e) => {
              e.stopPropagation();
              handleTogglePin();
            }}
          >
            {isPinnedTop ? "📍" : "📌"}
          </button>

          <div className="sticky-menu-wrapper">
            <button
              type="button"
              className="sticky-tool-btn"
              title="Menü"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
                setShowColorPicker(false);
              }}
            >
              ⋯
            </button>
            {showMenu && (
              <div
                className="sticky-menu-popover"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="sticky-menu-item"
                  onClick={handleConvertToTask}
                >
                  <span>📋</span> Göreve Dönüştür
                </button>
                <button
                  type="button"
                  className="sticky-menu-item"
                  onClick={handleSaveToVault}
                >
                  <span>🔐</span> Kasaya Kaydet
                </button>
                <div className="sticky-menu-divider" />
                <button
                  type="button"
                  className="sticky-menu-item danger"
                  onClick={handleDelete}
                >
                  <span>🗑️</span> Notu Sil
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className="sticky-tool-btn close"
            title="Kapat (Not saklanır)"
            onClick={(e) => {
              e.stopPropagation();
              handleClose();
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* ─── Temp Notification Banner ─────────────────────────────────── */}
      {actionNotice && (
        <div className="sticky-notice-banner">
          {actionNotice}
        </div>
      )}

      {/* ─── Note Title ──────────────────────────────────────────────── */}
      <div className="sticky-title-wrapper">
        <input
          type="text"
          className="sticky-title-input"
          placeholder="Başlık (isteğe bağlı)..."
          value={title}
          onChange={handleTitleChange}
          style={{ color: activeColorObj.text }}
        />
      </div>

      {/* ─── Note Body Textarea ──────────────────────────────────────── */}
      <div className="sticky-body-wrapper">
        <textarea
          ref={textareaRef}
          className="sticky-textarea"
          placeholder="Notunuzu yazın..."
          value={content}
          onChange={handleContentChange}
          style={{ color: activeColorObj.text }}
          autoFocus
        />
      </div>

      {/* ─── Bottom Formatting Toolbar ───────────────────────────────── */}
      <div className="sticky-footer-toolbar">
        <div className="sticky-format-tools">
          <button
            type="button"
            className="format-btn"
            title="Kalın"
            onClick={() => insertFormatting("**", "**")}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className="format-btn"
            title="İtalik"
            onClick={() => insertFormatting("*", "*")}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            className="format-btn"
            title="Üstü Çizili"
            onClick={() => insertFormatting("~~", "~~")}
          >
            <s>S</s>
          </button>
          <button
            type="button"
            className="format-btn"
            title="Madde İşareti"
            onClick={() => insertFormatting("• ")}
          >
            •
          </button>
          <button
            type="button"
            className="format-btn"
            title="Yapılacak Kutusu"
            onClick={insertChecklist}
          >
            ☑
          </button>
        </div>
        <div className="sticky-footer-meta">
          {content.length > 0 && <span>{content.length} karakter</span>}
        </div>
      </div>
    </div>
  );
}
