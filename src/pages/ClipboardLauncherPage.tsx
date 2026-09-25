/**
 * ClipboardLauncherPage.tsx — Spotlight/Raycast-style floating Clipboard History.
 * Enhanced with 2-second hover & linger detail preview popover.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  getClipboardHistory,
  copyFromHistory,
  deleteHistoryItem,
  clearClipboardHistory,
  togglePinHistory,
  hideClipboardLauncher,
  getClipboardSettings,
} from "../api/clipboard";
import type { ClipboardItem, ClipboardFilterType } from "../api/clipboard";
import { useApp } from "../context/AppContext";
import { SaveToVaultModal } from "../components/SaveToVaultModal";
import { useToast } from "../hooks/useToast";
import { ToastContainer } from "../components/Toast";

export default function ClipboardLauncherPage() {
  const { t, lang } = useApp();
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<ClipboardFilterType>("all");
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [hoverPreviewItem, setHoverPreviewItem] = useState<ClipboardItem | null>(null);
  const [saveToVaultItem, setSaveToVaultItem] = useState<ClipboardItem | null>(null);
  const [previewDelayMs, setPreviewDelayMs] = useState(2000);
  const hoverPreviewItemRef = useRef(hoverPreviewItem);
  hoverPreviewItemRef.current = hoverPreviewItem;
  const saveToVaultItemRef = useRef(saveToVaultItem);
  saveToVaultItemRef.current = saveToVaultItem;

  const { toasts, showToast, removeToast } = useToast();

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSettings = useCallback(() => {
    getClipboardSettings()
      .then((s) => {
        if (s && typeof s.previewDelayMs === "number") {
          setPreviewDelayMs(s.previewDelayMs);
        }
      })
      .catch(() => {});
  }, []);

  const fetchItems = useCallback(async (q: string, filter: ClipboardFilterType) => {
    try {
      setLoading(true);
      const data = await getClipboardHistory(q, filter);
      setItems(data);
      setSelectedIndex(0);
      setHoverPreviewItem(null);
    } catch (err) {
      console.error("Failed to load clipboard history:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load and focus handling
  useEffect(() => {
    fetchItems("", filterType);
    loadSettings();

    const win = getCurrentWindow();
    const unlistenFocus = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        if (!saveToVaultItemRef.current) {
          setTimeout(() => searchRef.current?.focus(), 20);
        }
        fetchItems(query, filterType);
        loadSettings();
      } else {
        setHoverPreviewItem(null);
        setSaveToVaultItem(null);
        hideClipboardLauncher();
      }
    });

    // Real-time clipboard update listener
    let unlistenEvent: (() => void) | null = null;
    listen("clipboard-updated", () => {
      fetchItems(query, filterType);
    }).then((fn) => {
      unlistenEvent = fn;
    });

    return () => {
      unlistenFocus.then((fn) => fn());
      if (unlistenEvent) unlistenEvent();
    };
  }, [fetchItems, filterType, query, loadSettings]);

  // Handle Search Input Debounce
  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setHoverPreviewItem(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchItems(val, filterType);
    }, 120);
  };

  const handleFilterChange = (f: ClipboardFilterType) => {
    setFilterType(f);
    setHoverPreviewItem(null);
    fetchItems(query, f);
  };

  const handleOpenSaveToVault = (e: React.MouseEvent | null, item: ClipboardItem) => {
    if (e) e.stopPropagation();
    setHoverPreviewItem(null);
    setSaveToVaultItem(item);
  };

  const handleSaveSuccess = (savedKeyName: string) => {
    showToast(t("clipVaultSavedSuccess", { name: savedKeyName }), "success");
  };

  const handleCopy = async (id: number) => {
    try {
      setCopiedId(id);
      setHoverPreviewItem(null);
      await copyFromHistory(id);
    } catch (err) {
      console.error("Failed to copy item:", err);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    try {
      setHoverPreviewItem(null);
      await deleteHistoryItem(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
      if (selectedIndex >= items.length - 1) {
        setSelectedIndex(Math.max(0, items.length - 2));
      }
    } catch (err) {
      console.error("Failed to delete item:", err);
    }
  };

  const handleTogglePin = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    try {
      const isPinned = await togglePinHistory(id);
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, isPinned } : it))
      );
    } catch (err) {
      console.error("Failed to pin item:", err);
    }
  };

  const handleClearAll = async () => {
    try {
      setHoverPreviewItem(null);
      await clearClipboardHistory();
      fetchItems(query, filterType);
    } catch (err) {
      console.error("Failed to clear history:", err);
    }
  };

  // Keyboard navigation & lingering 2s preview
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If modal is open, let modal handle keyboard events
      if (saveToVaultItemRef.current !== null) {
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setHoverPreviewItem(null);
        hideClipboardLauncher();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const sel = items[selectedIndex];
        if (sel && (sel.contentType === "text" || sel.textContent)) {
          handleOpenSaveToVault(null, sel);
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : prev));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (items[selectedIndex]) {
          handleCopy(items[selectedIndex].id);
        }
      } else if (e.key === "Delete") {
        if (items[selectedIndex] && !items[selectedIndex].isPinned) {
          e.preventDefault();
          deleteHistoryItem(items[selectedIndex].id).then(() => {
            fetchItems(query, filterType);
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [items, selectedIndex, query, filterType, fetchItems]);

  // Scroll selected into view & keyboard linger preview
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.children[selectedIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }

    if (keyHoverTimerRef.current) {
      clearTimeout(keyHoverTimerRef.current);
      keyHoverTimerRef.current = null;
    }

    if (items[selectedIndex]) {
      if (hoverPreviewItemRef.current !== null) {
        // Preview session already active: update immediately
        setHoverPreviewItem(items[selectedIndex]);
      } else {
        // First open: wait configured delay
        if (previewDelayMs <= 0) {
          setHoverPreviewItem(items[selectedIndex]);
        } else {
          keyHoverTimerRef.current = setTimeout(() => {
            setHoverPreviewItem(items[selectedIndex]);
          }, previewDelayMs);
        }
      }
    }

    return () => {
      if (keyHoverTimerRef.current) clearTimeout(keyHoverTimerRef.current);
    };
  }, [selectedIndex, items, previewDelayMs]);

  // Mouse hover handlers (first open waits previewDelayMs, once open updates immediately)
  const handleItemMouseEnter = (item: ClipboardItem, idx: number) => {
    setSelectedIndex(idx);
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    if (hoverPreviewItemRef.current !== null) {
      // Preview session is already open: update immediately without waiting!
      setHoverPreviewItem(item);
    } else {
      // First open: wait previewDelayMs
      if (previewDelayMs <= 0) {
        setHoverPreviewItem(item);
      } else {
        hoverTimerRef.current = setTimeout(() => {
          setHoverPreviewItem(item);
        }, previewDelayMs);
      }
    }
  };

  const handleItemMouseLeave = () => {
    // If preview hasn't opened yet, cancel the pending timer so it doesn't open after leaving
    if (hoverPreviewItemRef.current === null && hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const handleRootMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    // Ending the session when leaving the window
    setHoverPreviewItem(null);
  };

  // Format relative timestamp
  const formatTime = (timeStr: string) => {
    try {
      const date = new Date(timeStr.replace(" ", "T"));
      const diffMs = Date.now() - date.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 60) return t("clipNow");
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return t("clipMin", { m: diffMin });
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return t("clipHr", { h: diffHr });
      return t("clipDay", { d: Math.floor(diffHr / 24) });
    } catch {
      return timeStr;
    }
  };

  return (
    <div className="clip-launcher-root" onMouseLeave={handleRootMouseLeave}>
      {/* Main List Box */}
      <div className="clip-launcher-main">
        {/* Search Header */}
        <div className="clip-launcher-header">
          <div className="clip-launcher-search-box">
            <svg
              className="clip-search-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              className="clip-search-input"
              placeholder={t("clipSearchPlaceholder")}
              value={query}
              onChange={handleQueryChange}
              autoFocus
            />
            {query && (
              <button
                className="clip-clear-btn"
                onClick={() => {
                  setQuery("");
                  fetchItems("", filterType);
                  searchRef.current?.focus();
                }}
              >
                ×
              </button>
            )}
          </div>

          {/* Filter Badges */}
          <div className="clip-filters-bar">
            {(
              [
                { id: "all", label: t("clipTabAll") },
                { id: "text", label: t("clipTabText") },
                { id: "image", label: t("clipTabImages") },
                { id: "files", label: t("clipTabFiles") },
                { id: "pinned", label: t("clipTabPinned") },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                className={`clip-filter-chip ${filterType === tab.id ? "active" : ""}`}
                onClick={() => handleFilterChange(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* List Content */}
        <div className="clip-launcher-list" ref={listRef}>
          {items.length === 0 ? (
            <div className="clip-empty-state">
              <div className="clip-empty-icon">📋</div>
              <div className="clip-empty-title">
                {loading ? "Yükleniyor..." : "Pano kaydı bulunamadı"}
              </div>
              <div className="clip-empty-sub">
                {query
                  ? "Arama kriterine uygun öğe yok."
                  : "Kopyaladığınız metinler, görseller ve dosyalar burada görünür."}
              </div>
            </div>
          ) : (
            items.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const isJustCopied = copiedId === item.id;

              return (
                <div
                  key={item.id}
                  className={`clip-item-card ${isSelected ? "selected" : ""} ${
                    item.isPinned ? "pinned" : ""
                  }`}
                  onClick={() => handleCopy(item.id)}
                  onMouseEnter={() => handleItemMouseEnter(item, idx)}
                  onMouseLeave={handleItemMouseLeave}
                >
                  {/* Left Type Icon / Thumbnail */}
                  <div className="clip-item-left">
                    {item.contentType === "image" && item.imageData ? (
                      <div className="clip-img-thumb-wrap">
                        <img
                          src={item.imageData}
                          alt="Önizleme"
                          className="clip-img-thumb"
                        />
                      </div>
                    ) : item.contentType === "files" ? (
                      <div className="clip-type-badge files">
                        <svg
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                      </div>
                    ) : (
                      <div className="clip-type-badge text">
                        <svg
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <polyline points="4 7 4 4 20 4 20 7" />
                          <line x1="9" y1="20" x2="15" y2="20" />
                          <line x1="12" y1="4" x2="12" y2="20" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Middle Content */}
                  <div className="clip-item-body">
                    <div className="clip-item-preview">
                      {item.preview || "(Boş içerik)"}
                    </div>
                    <div className="clip-item-meta">
                      <span className="clip-meta-time">
                        {formatTime(item.copiedAt)}
                      </span>
                      {item.charCount && (
                        <span className="clip-meta-badge">
                          {item.charCount} karakter
                        </span>
                      )}
                      {item.fileCount && (
                        <span className="clip-meta-badge">
                          {item.fileCount} dosya
                        </span>
                      )}
                      {item.imageDimensions && (
                        <span className="clip-meta-badge">
                          {item.imageDimensions}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right Actions */}
                  <div className="clip-item-actions">
                    {(item.contentType === "text" || item.textContent) && (
                      <button
                        className="clip-action-btn vault-save"
                        title={t("clipSaveToVaultHint")}
                        onClick={(e) => handleOpenSaveToVault(e, item)}
                      >
                        🔒
                      </button>
                    )}
                    <button
                      className={`clip-action-btn pin ${item.isPinned ? "active" : ""}`}
                      title={item.isPinned ? "Sabitlemeyi Kaldır" : "Sabitle"}
                      onClick={(e) => handleTogglePin(e, item.id)}
                    >
                      ★
                    </button>
                    <button
                      className="clip-action-btn delete"
                      title="Sil (Del)"
                      onClick={(e) => handleDelete(e, item.id)}
                    >
                      ✕
                    </button>
                  </div>

                  {isJustCopied && (
                    <div className="clip-copied-toast">Kopyalandı!</div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer / Status bar */}
        <div className="clip-launcher-footer">
          <div className="clip-footer-hints">
            <span className="clip-kbd">↑↓</span> Gezin
            <span className="clip-kbd">↵</span> Kopyala
            <span className="clip-kbd">Ctrl+S</span> Kasaya
            <span className="clip-kbd">Del</span> Sil
            <span className="clip-kbd">Esc</span> Kapat
          </div>
          <div className="clip-footer-right">
            <span className="clip-count-label">{items.length} kayıt</span>
            {items.length > 0 && (
              <button
                className="clip-footer-clear-btn"
                title="Sabitlenmemiş geçmişi temizler"
                onClick={handleClearAll}
              >
                Temizle
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Floating Detail Preview Popover (Opens after 2-second hover or linger) */}
      {hoverPreviewItem && (
        <div className="clip-preview-popover" onClick={(e) => e.stopPropagation()}>
          {/* Popover Header */}
          <div className="clip-preview-header">
            <div className="clip-preview-title-box">
              {hoverPreviewItem.contentType === "image" ? (
                <span className="clip-preview-badge image">Görsel</span>
              ) : hoverPreviewItem.contentType === "files" ? (
                <span className="clip-preview-badge files">Dosya</span>
              ) : (
                <span className="clip-preview-badge text">Metin</span>
              )}
              <span className="clip-preview-title">İçerik Detayı</span>
            </div>
            <button
              className="clip-clear-btn"
              title="Kapat"
              onClick={() => setHoverPreviewItem(null)}
            >
              ×
            </button>
          </div>

          {/* Popover Content */}
          <div className="clip-preview-body">
            {hoverPreviewItem.contentType === "image" && hoverPreviewItem.imageData ? (
              <div className="clip-preview-img-box">
                <img
                  src={hoverPreviewItem.imageData}
                  alt="Görsel Detayı"
                  className="clip-preview-img"
                />
              </div>
            ) : hoverPreviewItem.contentType === "files" && hoverPreviewItem.filePaths ? (
              <div className="clip-preview-files-list">
                {hoverPreviewItem.filePaths.map((fp, i) => (
                  <div key={i} className="clip-preview-file-item">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#c084fc" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span>{fp}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="clip-preview-text-box">
                {hoverPreviewItem.textContent || hoverPreviewItem.preview}
              </div>
            )}

            {/* Meta Statistics */}
            <div className="clip-preview-stats">
              {hoverPreviewItem.charCount && (
                <span className="clip-preview-stat-item">
                  <strong>{hoverPreviewItem.charCount.toLocaleString(lang === "tr" ? "tr-TR" : "en-US")}</strong> {t("clipStatsChars")}
                </span>
              )}
              {hoverPreviewItem.textContent && (
                <>
                  <span className="clip-preview-stat-item">
                    <strong>
                      {hoverPreviewItem.textContent.trim().split(/\s+/).filter(Boolean).length}
                    </strong>{" "}
                    {t("clipStatsWords")}
                  </span>
                  <span className="clip-preview-stat-item">
                    <strong>{hoverPreviewItem.textContent.split("\n").length}</strong> {t("clipStatsLines")}
                  </span>
                </>
              )}
              {hoverPreviewItem.fileCount && (
                <span className="clip-preview-stat-item">
                  <strong>{hoverPreviewItem.fileCount}</strong> {t("clipStatsFiles")}
                </span>
              )}
              {hoverPreviewItem.imageDimensions && (
                <span className="clip-preview-stat-item">
                  <strong>{hoverPreviewItem.imageDimensions}</strong>
                </span>
              )}
            </div>
          </div>

          {/* Popover Footer Actions */}
          <div className="clip-preview-footer">
            <span className="clip-preview-time">
              {hoverPreviewItem.copiedAt}
            </span>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              {(hoverPreviewItem.contentType === "text" || hoverPreviewItem.textContent) && (
                <button
                  className="clip-preview-vault-btn"
                  title={t("clipSaveToVaultHint")}
                  onClick={(e) => handleOpenSaveToVault(e, hoverPreviewItem)}
                >
                  🔒 <span>{t("clipSaveToVault")}</span>
                </button>
              )}
              <button
                className="clip-preview-copy-btn"
                onClick={() => handleCopy(hoverPreviewItem.id)}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Kopyala (↵)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save to Vault Modal */}
      <SaveToVaultModal
        isOpen={saveToVaultItem !== null}
        initialText={saveToVaultItem?.textContent || saveToVaultItem?.preview || ""}
        onClose={() => {
          setSaveToVaultItem(null);
          setTimeout(() => searchRef.current?.focus(), 50);
        }}
        onSuccess={handleSaveSuccess}
      />

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
