/**
 * StickyNotesManager.tsx — Central Sticky Notes management component inside ManagerPage
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getStickyNotes,
  createStickyNote,
  updateStickyNote,
  deleteStickyNote,
  toggleStickyNoteArchive,
  openStickyNoteWindow,
  closeStickyNoteWindow,
  toggleAllStickyNotes,
  StickyNote,
  NOTE_COLORS,
} from "../api/notes";
import { createTask } from "../api/tasks";
import { addCredential } from "../api/vault";

interface StickyNotesManagerProps {
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export function StickyNotesManager({ showToast }: StickyNotesManagerProps) {
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load notes
  const fetchNotes = useCallback(async () => {
    try {
      const data = await getStickyNotes(showArchived);
      setNotes(data);
    } catch (err) {
      console.error("Failed to load sticky notes:", err);
      showToast("Yapışkan notlar yüklenirken hata oluştu", "error");
    } finally {
      setIsLoading(false);
    }
  }, [showArchived, showToast]);

  useEffect(() => {
    fetchNotes();

    // Listen for updates from other windows
    const unlistenPromise = listen("sticky-notes-updated", () => {
      fetchNotes();
    });

    return () => {
      unlistenPromise.then((fn) => fn()).catch(() => {});
    };
  }, [fetchNotes]);

  // Create new note
  const handleCreateNew = async () => {
    try {
      await createStickyNote({
        title: "",
        content: "",
        color: "#fef08a",
        openDesktop: true,
      });
      showToast("Yeni yapışkan not masaüstünde açıldı", "success");
      fetchNotes();
    } catch (err) {
      console.error("Failed to create note:", err);
      showToast("Not oluşturulamadı", "error");
    }
  };

  // Toggle open on desktop
  const handleToggleDesktop = async (note: StickyNote) => {
    try {
      if (note.isDesktopOpen) {
        await closeStickyNoteWindow(note.id);
        showToast("Not masaüstünden kapatıldı", "info");
      } else {
        await openStickyNoteWindow(note.id);
        showToast("Not masaüstünde açıldı", "success");
      }
      fetchNotes();
    } catch (err) {
      console.error("Failed to toggle desktop note:", err);
      showToast("İşlem başarısız oldu", "error");
    }
  };

  // Toggle archive
  const handleToggleArchive = async (id: number) => {
    try {
      const updated = await toggleStickyNoteArchive(id);
      showToast(updated.isArchived ? "Not arşivlendi" : "Not arşivden çıkarıldı", "info");
      fetchNotes();
    } catch (err) {
      console.error("Failed to toggle archive:", err);
      showToast("Arşivleme işlemi başarısız", "error");
    }
  };

  // Delete
  const handleDelete = async (id: number) => {
    if (window.confirm("Bu notu kalıcı olarak silmek istediğinize emin misiniz?")) {
      try {
        await deleteStickyNote(id);
        showToast("Not başarıyla silindi", "success");
        fetchNotes();
      } catch (err) {
        console.error("Failed to delete note:", err);
        showToast("Not silinemedi", "error");
      }
    }
  };

  // Convert to Task
  const handleConvertToTask = async (note: StickyNote) => {
    const taskTitle = note.title.trim() || note.content.trim().split("\n")[0] || "Yeni Görev";
    try {
      await createTask({
        title: taskTitle.slice(0, 100),
        notes: note.content,
        priority: "medium",
        category: "Sticky Note",
      });
      showToast("Görev Takvimine Eklendi ✅", "success");
    } catch (err) {
      console.error("Failed to convert note to task:", err);
      showToast("Görev eklenirken hata oluştu", "error");
    }
  };

  // Save to Vault
  const handleSaveToVault = async (note: StickyNote) => {
    const keyName = note.title.trim() || "Yapışkan Not";
    try {
      await addCredential({
        keyName,
        username: "Sticky Note",
        password: note.content,
        notes: "Yapışkan nottan aktarıldı",
        categoryId: null,
      });
      showToast("Kasaya Güvenle Kaydedildi 🔐", "success");
    } catch (err) {
      console.error("Failed to save to vault:", err);
      showToast("Kasaya kaydedilemedi (Kasa kilitli olabilir)", "error");
    }
  };

  // Change color
  const handleChangeColor = async (id: number, hex: string) => {
    try {
      await updateStickyNote({ id, color: hex });
      fetchNotes();
    } catch (err) {
      console.error("Failed to change color:", err);
    }
  };

  // Filter notes
  const filteredNotes = useMemo(() => {
    return notes.filter((n) => {
      if (selectedColor && n.color.toLowerCase() !== selectedColor.toLowerCase()) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = n.title.toLowerCase().includes(q);
        const matchContent = n.content.toLowerCase().includes(q);
        return matchTitle || matchContent;
      }
      return true;
    });
  }, [notes, selectedColor, searchQuery]);

  const activeDesktopCount = notes.filter((n) => n.isDesktopOpen && !n.isArchived).length;

  return (
    <div className="sticky-manager-container">
      {/* ─── Top Action & Filter Bar ──────────────────────────────────── */}
      <div className="sticky-manager-header">
        <div className="sticky-manager-title-area">
          <h2 className="sticky-manager-title">📝 Yapışkan Notlar (Sticky Notes)</h2>
          <span className="sticky-manager-subtitle">
            {notes.length} toplam not • {activeDesktopCount} masaüstünde açık
          </span>
        </div>

        <div className="sticky-manager-actions">
          <button
            type="button"
            className="sticky-primary-btn"
            onClick={handleCreateNew}
          >
            ＋ Yeni Not Ekle
          </button>
          <button
            type="button"
            className="sticky-secondary-btn"
            title="Açık tüm masaüstü notlarını gizle"
            onClick={() => toggleAllStickyNotes(false)}
          >
            Tümünü Gizle
          </button>
          <button
            type="button"
            className="sticky-secondary-btn"
            title="Masaüstü notlarını geri getir"
            onClick={() => toggleAllStickyNotes(true)}
          >
            Tümünü Göster
          </button>
        </div>
      </div>

      {/* ─── Search & Filters Bar ────────────────────────────────────── */}
      <div className="sticky-manager-filters">
        <div className="sticky-search-box">
          <span className="sticky-search-icon">🔍</span>
          <input
            type="text"
            className="sticky-search-input"
            placeholder="Notlarda veya başlıklarda ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="sticky-search-clear"
              onClick={() => setSearchQuery("")}
            >
              ✕
            </button>
          )}
        </div>

        <div className="sticky-color-filters">
          <button
            type="button"
            className={`sticky-color-filter-chip ${selectedColor === null ? "active" : ""}`}
            onClick={() => setSelectedColor(null)}
          >
            Tüm Renkler
          </button>
          {NOTE_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`sticky-color-filter-dot ${selectedColor === c.bg ? "active" : ""}`}
              style={{ backgroundColor: c.bg, borderColor: c.border }}
              title={c.name}
              onClick={() => setSelectedColor(selectedColor === c.bg ? null : c.bg)}
            />
          ))}
        </div>

        <div className="sticky-archive-toggle">
          <label className="sticky-checkbox-label">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            <span>Arşivdekileri Göster</span>
          </label>
        </div>
      </div>

      {/* ─── Notes Grid ─────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="sticky-manager-loading">Notlar yükleniyor...</div>
      ) : filteredNotes.length === 0 ? (
        <div className="sticky-empty-state">
          <div className="sticky-empty-icon">📝</div>
          <h3>Henüz bir yapışkan not bulunmuyor</h3>
          <p>
            {searchQuery || selectedColor
              ? "Arama kriterlerinize uygun not bulunamadı."
              : "Hızlı notlar almak ve masaüstünüzde sabitlemek için yeni bir not oluşturun."}
          </p>
          <button
            type="button"
            className="sticky-primary-btn"
            onClick={handleCreateNew}
          >
            ＋ İlk Notunuzu Oluşturun
          </button>
        </div>
      ) : (
        <div className="sticky-grid">
          {filteredNotes.map((note) => {
            const colorObj =
              NOTE_COLORS.find((c) => c.bg.toLowerCase() === note.color.toLowerCase()) ||
              NOTE_COLORS[0];

            return (
              <div
                key={note.id}
                className={`sticky-card ${note.isDesktopOpen ? "desktop-open" : ""}`}
                style={{
                  backgroundColor: colorObj.bg,
                  borderColor: colorObj.border,
                  color: colorObj.text,
                }}
              >
                {/* Card Top */}
                <div className="sticky-card-header">
                  <div className="sticky-card-title-line">
                    <span className="sticky-card-title">
                      {note.title.trim() || "Başlıksız Not"}
                    </span>
                    {note.isPinnedTop && (
                      <span className="sticky-card-pin" title="Üstte Sabitli">
                        📌
                      </span>
                    )}
                  </div>
                  <div className="sticky-card-meta">
                    {note.updatedAt ? note.updatedAt.slice(0, 16) : ""}
                  </div>
                </div>

                {/* Card Body */}
                <div className="sticky-card-body">
                  <p className="sticky-card-content">
                    {note.content.trim() || <span className="empty-content">İçerik boş...</span>}
                  </p>
                </div>

                {/* Card Actions Bottom */}
                <div className="sticky-card-actions">
                  <button
                    type="button"
                    className={`sticky-action-chip ${note.isDesktopOpen ? "active" : ""}`}
                    title={note.isDesktopOpen ? "Masaüstünde Açık (Kapat)" : "Masaüstünde Aç"}
                    onClick={() => handleToggleDesktop(note)}
                  >
                    {note.isDesktopOpen ? "🖥️ Masaüstünde" : "↗ Masaüstüne Aç"}
                  </button>

                  <div className="sticky-card-palette">
                    {NOTE_COLORS.map((c) => (
                      <span
                        key={c.id}
                        className={`palette-dot ${note.color === c.bg ? "current" : ""}`}
                        style={{ backgroundColor: c.bg }}
                        title={c.name}
                        onClick={() => handleChangeColor(note.id, c.bg)}
                      />
                    ))}
                  </div>

                  <div className="sticky-card-icons">
                    <button
                      type="button"
                      className="card-icon-btn"
                      title="Kasaya Kaydet"
                      onClick={() => handleSaveToVault(note)}
                    >
                      🔐
                    </button>
                    <button
                      type="button"
                      className="card-icon-btn"
                      title="Görefe Dönüştür"
                      onClick={() => handleConvertToTask(note)}
                    >
                      📋
                    </button>
                    <button
                      type="button"
                      className="card-icon-btn"
                      title={note.isArchived ? "Arşivden Çıkar" : "Arşivle"}
                      onClick={() => handleToggleArchive(note.id)}
                    >
                      📦
                    </button>
                    <button
                      type="button"
                      className="card-icon-btn danger"
                      title="Notu Sil"
                      onClick={() => handleDelete(note.id)}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
