/**
 * ClipboardLauncherPage.tsx — Spotlight/Raycast-style floating Clipboard History.
 * Enhanced with instant in-memory search, multi-column responsive grid, and linger preview popover.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  getClipboardHistory,
  getClipboardFullImage,
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

interface ClipboardItemCardProps {
  item: ClipboardItem;
  idx: number;
  isSelected: boolean;
  isJustCopied: boolean;
  onCopy: (id: number) => void;
  onMouseEnter: (item: ClipboardItem, idx: number) => void;
  onMouseLeave: () => void;
  onOpenMenu: (e: React.MouseEvent, item: ClipboardItem) => void;
  formatTime: (timeStr: string) => string;
}

const ClipboardItemCard = React.memo(function ClipboardItemCard({
  item,
  idx,
  isSelected,
  isJustCopied,
  onCopy,
  onMouseEnter,
  onMouseLeave,
  onOpenMenu,
  formatTime,
}: ClipboardItemCardProps) {
  const { t } = useApp();
  return (
    <div
      data-clip-index={idx}
      className={`clip-item-card ${isSelected ? "selected" : ""} ${
        item.isPinned ? "pinned" : ""
      }`}
      onClick={() => onCopy(item.id)}
      onContextMenu={(e) => onOpenMenu(e, item)}
      onMouseEnter={() => onMouseEnter(item, idx)}
      onMouseLeave={onMouseLeave}
    >
      {/* Left Type Icon / Thumbnail */}
      <div className="clip-item-left">
        {item.contentType === "image" && item.imageData ? (
          <div className="clip-img-thumb-wrap">
            <img
              src={item.imageData}
              alt={t("clipBadgeImage")}
              className="clip-img-thumb"
              loading="lazy"
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

      {/* Middle Content - Maximized room for preview */}
      <div className="clip-item-body">
        <div className="clip-item-preview">
          {item.preview || t("clipEmptyContent")}
        </div>
        <div className="clip-item-meta">
          <span className="clip-meta-time">
            {formatTime(item.copiedAt)}
          </span>
          {item.fileCount ? (
            <span className="clip-meta-badge">
              {item.fileCount} {t("clipFilesLabel")}
            </span>
          ) : null}
        </div>
      </div>

      {/* Right Actions / Quick Menu */}
      <div className="clip-item-actions">
        {item.isPinned && (
          <span className="clip-pinned-indicator" title={t("clipUnpinTooltip") || "Sabitlendi"}>
            ★
          </span>
        )}
        <button
          className="clip-action-btn menu-btn"
          title={t("clipOptionsTooltip") || "Seçenekler"}
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu(e, item);
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <circle cx="12" cy="5" r="2.2" />
            <circle cx="12" cy="12" r="2.2" />
            <circle cx="12" cy="19" r="2.2" />
          </svg>
        </button>
      </div>

      {isJustCopied && (
        <div className="clip-copied-toast">{t("copied")}</div>
      )}
    </div>
  );
});

interface ContextMenuState {
  item: ClipboardItem;
  x: number;
  y: number;
}

export default function ClipboardLauncherPage() {
  const { t, lang } = useApp();
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<ClipboardFilterType>("all");
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [hoverPreviewItem, setHoverPreviewItem] = useState<ClipboardItem | null>(null);
  const [fullPreviewImage, setFullPreviewImage] = useState<string | null>(null);
  const [saveToVaultItem, setSaveToVaultItem] = useState<ClipboardItem | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [previewDelayMs, setPreviewDelayMs] = useState(2000);
  const [windowMode, setWindowMode] = useState<"popup" | "fullscreen">("popup");
  const [closeOnBlur, setCloseOnBlur] = useState<boolean>(true);
  const [closeOnSpace, setCloseOnSpace] = useState<boolean>(true);
  const [clearSearchOnOpen, setClearSearchOnOpen] = useState<boolean>(true);
  const [pageSize, setPageSize] = useState<number>(100);
  const [panelScale, setPanelScale] = useState<"small" | "medium" | "large">("medium");
  const [gridFlow, setGridFlow] = useState<"vertical" | "horizontal">("vertical");
  const [columnCount, setColumnCount] = useState<number>(3);
  const [previewSide, setPreviewSide] = useState<"left" | "right">("right");

  const contextMenuRef = useRef(contextMenu);
  contextMenuRef.current = contextMenu;
  const columnCountRef = useRef(columnCount);
  columnCountRef.current = columnCount;
  const gridFlowRef = useRef(gridFlow);
  gridFlowRef.current = gridFlow;

  const unfilteredItemsRef = useRef<ClipboardItem[]>([]);
  const searchReqIdRef = useRef<number>(0);
  const hoverPreviewItemRef = useRef(hoverPreviewItem);
  hoverPreviewItemRef.current = hoverPreviewItem;
  const saveToVaultItemRef = useRef(saveToVaultItem);
  saveToVaultItemRef.current = saveToVaultItem;
  const closeOnBlurRef = useRef(closeOnBlur);
  closeOnBlurRef.current = closeOnBlur;
  const closeOnSpaceRef = useRef(closeOnSpace);
  closeOnSpaceRef.current = closeOnSpace;
  const clearSearchOnOpenRef = useRef(clearSearchOnOpen);
  clearSearchOnOpenRef.current = clearSearchOnOpen;
  const windowModeRef = useRef(windowMode);
  windowModeRef.current = windowMode;
  const pageSizeRef = useRef(pageSize);
  pageSizeRef.current = pageSize;
  const rootRef = useRef<HTMLDivElement>(null);

  const updateElementSide = useCallback((targetEl?: HTMLElement | null) => {
    // In fullscreen mode, preview popover is strictly fixed on the right side
    if (windowModeRef.current === "fullscreen") {
      setPreviewSide("right");
      return;
    }
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      if (rect.left + rect.width / 2 > window.innerWidth / 2) {
        setPreviewSide("left");
      } else {
        setPreviewSide("right");
      }
    }
  }, []);

  const handleOpenMenu = useCallback((e: React.MouseEvent, item: ClipboardItem) => {
    e.preventDefault();
    e.stopPropagation();
    setHoverPreviewItem(null);

    const menuW = 210;
    const menuH = 175;
    let x = e.clientX;
    let y = e.clientY;

    if (x + menuW > window.innerWidth - 12) {
      x = Math.max(12, window.innerWidth - menuW - 12);
    }
    if (y + menuH > window.innerHeight - 12) {
      y = Math.max(12, window.innerHeight - menuH - 12);
    }

    setContextMenu({ item, x, y });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleCloseMenu = () => setContextMenu(null);
    window.addEventListener("click", handleCloseMenu);
    return () => window.removeEventListener("click", handleCloseMenu);
  }, [contextMenu]);

  const { toasts, showToast, removeToast } = useToast();

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSettings = useCallback(() => {
    getClipboardSettings()
      .then((s) => {
        if (s) {
          if (typeof s.previewDelayMs === "number") setPreviewDelayMs(s.previewDelayMs);
          if (s.windowMode) setWindowMode(s.windowMode);
          if (typeof s.closeOnBlur === "boolean") setCloseOnBlur(s.closeOnBlur);
          if (typeof s.closeOnSpace === "boolean") setCloseOnSpace(s.closeOnSpace);
          if (typeof s.clearSearchOnOpen === "boolean") setClearSearchOnOpen(s.clearSearchOnOpen);
          if (typeof s.pageSize === "number" && s.pageSize > 0) setPageSize(s.pageSize);
          if (s.panelScale) setPanelScale(s.panelScale);
          if (s.gridFlow) setGridFlow((s.gridFlow as "vertical" | "horizontal") || "vertical");
        }
      })
      .catch(() => {});
  }, []);

  const fetchItems = useCallback(async (q: string, filter: ClipboardFilterType) => {
    const reqId = ++searchReqIdRef.current;
    try {
      setLoading(true);
      const data = await getClipboardHistory(q, filter, pageSizeRef.current);
      if (reqId !== searchReqIdRef.current) return; // Stale request, drop!
      setItems(data);
      if (!q.trim() && filter === "all") {
        unfilteredItemsRef.current = data;
      }
      setSelectedIndex(0);
      setHoverPreviewItem(null);
    } catch (err) {
      if (reqId === searchReqIdRef.current) {
        console.error("Failed to load clipboard history:", err);
      }
    } finally {
      if (reqId === searchReqIdRef.current) {
        setLoading(false);
      }
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
        if (clearSearchOnOpenRef.current) {
          setQuery("");
          fetchItems("", filterType);
        } else {
          fetchItems(query, filterType);
        }
        loadSettings();
      } else {
        setHoverPreviewItem(null);
        setSaveToVaultItem(null);
        setContextMenu(null);
        if (closeOnBlurRef.current) {
          hideClipboardLauncher();
        }
      }
    });

    // Real-time clipboard update listener
    let unlistenEvent: (() => void) | null = null;
    listen("clipboard-updated", () => {
      fetchItems(query, filterType);
    }).then((fn) => {
      unlistenEvent = fn;
    });

    let unlistenSettings: (() => void) | null = null;
    listen("clipboard-settings-updated", () => {
      loadSettings();
      fetchItems(query, filterType);
    }).then((fn) => {
      unlistenSettings = fn;
    });

    let unlistenSide: (() => void) | null = null;
    listen<string>("clipboard-launcher-side", (event) => {
      if (windowModeRef.current !== "fullscreen") {
        setPreviewSide(event.payload === "left" ? "left" : "right");
      }
    }).then((fn) => {
      unlistenSide = fn;
    });

    return () => {
      unlistenFocus.then((fn) => fn());
      if (unlistenEvent) unlistenEvent();
      if (unlistenSettings) unlistenSettings();
      if (unlistenSide) unlistenSide();
    };
  }, [fetchItems, filterType, query, loadSettings]);

  // Synchronize popup preview side on window mount/resize
  useEffect(() => {
    if (windowMode !== "fullscreen") {
      const detectSide = () => {
        try {
          const screenW = window.screen.availWidth || window.screen.width || 1920;
          const winX = window.screenX || window.screenLeft || 0;
          if (winX > screenW * 0.45 || (winX + 530 + 360) > screenW - 20) {
            setPreviewSide("left");
          } else {
            setPreviewSide("right");
          }
        } catch {}
      };
      detectSide();
      window.addEventListener("resize", detectSide);
      return () => window.removeEventListener("resize", detectSide);
    }
  }, [windowMode]);

  // Measure column count dynamically for fullscreen mode
  useEffect(() => {
    if (!listRef.current) return;
    const updateCols = () => {
      if (!listRef.current) return;
      const width = listRef.current.clientWidth || listRef.current.offsetWidth || 1200;
      const minColWidth = panelScale === "small" ? 240 : panelScale === "large" ? 320 : 280;
      const gap = panelScale === "small" ? 10 : panelScale === "large" ? 14 : 12;
      const computed = Math.max(1, Math.floor((width + gap) / (minColWidth + gap)));
      setColumnCount((prev) => (prev !== computed ? computed : prev));
    };
    updateCols();
    const ro = new ResizeObserver(updateCols);
    ro.observe(listRef.current);
    return () => ro.disconnect();
  }, [panelScale, windowMode]);

  // Group items into columns for vertical top-to-bottom layout
  const columnGroups: { item: ClipboardItem; originalIndex: number }[][] = useMemo(() => {
    if (windowMode !== "fullscreen" || gridFlow !== "vertical" || items.length === 0) {
      return [];
    }
    const cols = Math.max(1, columnCount);
    const itemsPerCol = Math.ceil(items.length / cols);
    const groups: { item: ClipboardItem; originalIndex: number }[][] = Array.from(
      { length: cols },
      () => []
    );
    items.forEach((item, index) => {
      const colIdx = Math.min(cols - 1, Math.floor(index / itemsPerCol));
      groups[colIdx].push({ item, originalIndex: index });
    });
    return groups.filter((g) => g.length > 0);
  }, [items, columnCount, windowMode, gridFlow]);

  // Handle Search Input: Instant in-memory filter + 150ms debounced backend search
  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setHoverPreviewItem(null);
    setContextMenu(null);

    // Instant local filter for 0ms perceptible delay
    const qLower = val.trim().toLowerCase();
    if (qLower && unfilteredItemsRef.current.length > 0) {
      const instant = unfilteredItemsRef.current.filter((item) => {
        const p = item.preview?.toLowerCase() || "";
        const t = item.textContent?.toLowerCase() || "";
        const f = item.filePaths?.join(" ").toLowerCase() || "";
        return p.includes(qLower) || t.includes(qLower) || f.includes(qLower);
      });
      setItems(instant);
      setSelectedIndex(0);
    } else if (!qLower && unfilteredItemsRef.current.length > 0) {
      setItems(unfilteredItemsRef.current);
      setSelectedIndex(0);
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchItems(val, filterType);
    }, 150);
  };

  const handleFilterChange = (f: ClipboardFilterType) => {
    setFilterType(f);
    setHoverPreviewItem(null);
    setContextMenu(null);
    fetchItems(query, f);
  };

  const handleOpenSaveToVault = useCallback((e: React.MouseEvent | null, item: ClipboardItem) => {
    if (e) e.stopPropagation();
    setHoverPreviewItem(null);
    setSaveToVaultItem(item);
  }, []);

  const handleSaveSuccess = (savedKeyName: string) => {
    showToast(t("clipVaultSavedSuccess", { name: savedKeyName }), "success");
  };

  const handleCopy = useCallback(async (id: number) => {
    try {
      setCopiedId(id);
      setHoverPreviewItem(null);
      await copyFromHistory(id);
    } catch (err) {
      console.error("Failed to copy item:", err);
    }
  }, []);

  const handleDelete = useCallback(async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    try {
      setHoverPreviewItem(null);
      await deleteHistoryItem(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
      unfilteredItemsRef.current = unfilteredItemsRef.current.filter((it) => it.id !== id);
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } catch (err) {
      console.error("Failed to delete item:", err);
    }
  }, []);

  const handleTogglePin = useCallback(async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    try {
      const isPinned = await togglePinHistory(id);
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, isPinned } : it))
      );
      unfilteredItemsRef.current = unfilteredItemsRef.current.map((it) =>
        it.id === id ? { ...it, isPinned } : it
      );
    } catch (err) {
      console.error("Failed to pin item:", err);
    }
  }, []);

  const handleClearAll = async () => {
    try {
      setHoverPreviewItem(null);
      await clearClipboardHistory();
      fetchItems(query, filterType);
    } catch (err) {
      console.error("Failed to clear history:", err);
    }
  };

  // Keyboard navigation with multi-column grid awareness
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If modal is open, let modal handle keyboard events
      if (saveToVaultItemRef.current !== null) {
        return;
      }

      if (contextMenuRef.current !== null) {
        if (e.key === "Escape") {
          e.preventDefault();
          setContextMenu(null);
          return;
        }
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setHoverPreviewItem(null);
        hideClipboardLauncher();
        return;
      }

      if (e.key === " " && closeOnSpaceRef.current) {
        const isTypingQuery = document.activeElement === searchRef.current && query.length > 0;
        if (!isTypingQuery) {
          e.preventDefault();
          setHoverPreviewItem(null);
          hideClipboardLauncher();
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const sel = items[selectedIndex];
        if (sel && (sel.contentType === "text" || sel.textContent)) {
          handleOpenSaveToVault(null, sel);
        }
        return;
      }

      const getGridColumnCount = (): number => {
        if (!listRef.current || listRef.current.children.length <= 1) return 1;
        const children = listRef.current.children;
        const firstTop = (children[0] as HTMLElement).offsetTop;
        let cols = 0;
        for (let i = 0; i < children.length; i++) {
          const el = children[i] as HTMLElement;
          if (Math.abs(el.offsetTop - firstTop) < 6) {
            cols++;
          } else {
            break;
          }
        }
        return Math.max(1, cols);
      };

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (windowModeRef.current === "fullscreen" && gridFlowRef.current === "vertical") {
          setSelectedIndex((prev) => Math.min(items.length - 1, prev + 1));
        } else {
          const cols = getGridColumnCount();
          setSelectedIndex((prev) => Math.min(items.length - 1, prev + cols));
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (windowModeRef.current === "fullscreen" && gridFlowRef.current === "vertical") {
          setSelectedIndex((prev) => Math.max(0, prev - 1));
        } else {
          const cols = getGridColumnCount();
          setSelectedIndex((prev) => Math.max(0, prev - cols));
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (windowModeRef.current === "fullscreen" && gridFlowRef.current === "vertical") {
          const itemsPerCol = Math.ceil(items.length / Math.max(1, columnCountRef.current));
          setSelectedIndex((prev) => Math.min(items.length - 1, prev + itemsPerCol));
        } else {
          setSelectedIndex((prev) => Math.min(items.length - 1, prev + 1));
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (windowModeRef.current === "fullscreen" && gridFlowRef.current === "vertical") {
          const itemsPerCol = Math.ceil(items.length / Math.max(1, columnCountRef.current));
          setSelectedIndex((prev) => Math.max(0, prev - itemsPerCol));
        } else {
          setSelectedIndex((prev) => Math.max(0, prev - 1));
        }
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
  }, [items, selectedIndex, query, filterType, fetchItems, handleCopy, handleOpenSaveToVault]);

  // Scroll selected into view & keyboard linger preview
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.querySelector<HTMLElement>(`[data-clip-index="${selectedIndex}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
        updateElementSide(activeEl);
      }
    }

    if (keyHoverTimerRef.current) {
      clearTimeout(keyHoverTimerRef.current);
      keyHoverTimerRef.current = null;
    }

    if (items[selectedIndex]) {
      if (hoverPreviewItemRef.current !== null) {
        setHoverPreviewItem(items[selectedIndex]);
      } else {
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
  }, [selectedIndex, items, previewDelayMs, updateElementSide]);

  // Asynchronously fetch full-res image only when item is previewed
  useEffect(() => {
    if (!hoverPreviewItem || hoverPreviewItem.contentType !== "image") {
      setFullPreviewImage(null);
      return;
    }
    let isCancelled = false;
    getClipboardFullImage(hoverPreviewItem.id)
      .then((fullImg) => {
        if (!isCancelled && fullImg) {
          setFullPreviewImage(fullImg);
        }
      })
      .catch(() => {});
    return () => {
      isCancelled = true;
    };
  }, [hoverPreviewItem]);

  // Mouse hover handlers
  const handleItemMouseEnter = useCallback((item: ClipboardItem, idx: number) => {
    setSelectedIndex(idx);
    if (listRef.current) {
      const el = listRef.current.querySelector<HTMLElement>(`[data-clip-index="${idx}"]`);
      if (el) updateElementSide(el);
    }

    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    if (hoverPreviewItemRef.current !== null) {
      setHoverPreviewItem(item);
    } else {
      if (previewDelayMs <= 0) {
        setHoverPreviewItem(item);
      } else {
        hoverTimerRef.current = setTimeout(() => {
          setHoverPreviewItem(item);
        }, previewDelayMs);
      }
    }
  }, [previewDelayMs, updateElementSide]);

  const handleItemMouseLeave = useCallback(() => {
    if (hoverPreviewItemRef.current === null && hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const handleRootMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverPreviewItem(null);
  };

  // Format relative timestamp
  const formatTime = useCallback((timeStr: string) => {
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
  }, [t]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === rootRef.current && closeOnBlurRef.current) {
      setHoverPreviewItem(null);
      hideClipboardLauncher();
    }
  };

  return (
    <div
      ref={rootRef}
      className={`clip-launcher-root ${windowMode === "fullscreen" ? "fullscreen preview-right" : `popup ${previewSide === "left" ? "preview-left" : "preview-right"}`}`}
      data-scale={panelScale}
      onClick={handleBackdropClick}
      onMouseLeave={handleRootMouseLeave}
    >
      {/* Main Launcher Window / Grid Container */}
      <div className="clip-launcher-main">
        {/* Header Search & Tabs */}
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
                  if (unfilteredItemsRef.current.length > 0) {
                    setItems(unfilteredItemsRef.current);
                    setSelectedIndex(0);
                  }
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

        {/* List / Grid Content */}
        {windowMode === "fullscreen" && gridFlow === "vertical" && items.length > 0 ? (
          <div className="clip-launcher-list flow-vertical" ref={listRef}>
            {columnGroups.map((colGroup, colIdx) => (
              <div key={colIdx} className="clip-list-column">
                {colGroup.map(({ item, originalIndex }) => (
                  <ClipboardItemCard
                    key={item.id}
                    item={item}
                    idx={originalIndex}
                    isSelected={originalIndex === selectedIndex}
                    isJustCopied={copiedId === item.id}
                    onCopy={handleCopy}
                    onMouseEnter={handleItemMouseEnter}
                    onMouseLeave={handleItemMouseLeave}
                    onOpenMenu={handleOpenMenu}
                    formatTime={formatTime}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="clip-launcher-list" ref={listRef}>
            {items.length === 0 ? (
              <div className="clip-empty-state">
                <div className="clip-empty-icon">📋</div>
                <div className="clip-empty-title">
                  {loading ? t("loading") : t("clipEmptyTitle")}
                </div>
                <div className="clip-empty-sub">
                  {query
                    ? t("clipEmptyQuery")
                    : t("clipEmptyNormal")}
                </div>
              </div>
            ) : (
              items.map((item, idx) => (
                <ClipboardItemCard
                  key={item.id}
                  item={item}
                  idx={idx}
                  isSelected={idx === selectedIndex}
                  isJustCopied={copiedId === item.id}
                  onCopy={handleCopy}
                  onMouseEnter={handleItemMouseEnter}
                  onMouseLeave={handleItemMouseLeave}
                  onOpenMenu={handleOpenMenu}
                  formatTime={formatTime}
                />
              ))
            )}
          </div>
        )}

        {/* Footer / Status bar */}
        <div className="clip-launcher-footer">
          <div className="clip-footer-hints">
            <span className="clip-kbd">↑↓</span> {t("clipHintNavigate")}
            <span className="clip-kbd">↵</span> {t("clipHintCopy")}
            <span className="clip-kbd">Ctrl+S</span> {t("clipHintVault")}
            <span className="clip-kbd">Del</span> {t("clipHintDelete")}
            <span className="clip-kbd">Esc{closeOnSpace ? " / Space" : ""}</span> {t("clipHintClose")}
          </div>
          <div className="clip-footer-right">
            <span className="clip-count-label">{t("clipRecordsCount").replace("{count}", String(items.length))}</span>
            {items.length > 0 && (
              <button
                className="clip-footer-clear-btn"
                title={t("clipClearBtnTooltip")}
                onClick={handleClearAll}
              >
                {t("clipClearBtn")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Floating / Docked Detail Preview Popover */}
      {hoverPreviewItem && (
        <div className="clip-preview-popover" onClick={(e) => e.stopPropagation()}>
          {/* Popover Header */}
          <div className="clip-preview-header">
            <div className="clip-preview-title-box">
              {hoverPreviewItem.contentType === "image" ? (
                <span className="clip-preview-badge image">{t("clipBadgeImage")}</span>
              ) : hoverPreviewItem.contentType === "files" ? (
                <span className="clip-preview-badge files">{t("clipBadgeFiles")}</span>
              ) : (
                <span className="clip-preview-badge text">{t("clipBadgeText")}</span>
              )}
              <span className="clip-preview-title">{t("clipPreviewDetailsTitle")}</span>
            </div>
            <button
              className="clip-clear-btn"
              title={t("close")}
              onClick={() => setHoverPreviewItem(null)}
            >
              ×
            </button>
          </div>

          {/* Popover Content */}
          <div className="clip-preview-body">
            {hoverPreviewItem.contentType === "image" && (fullPreviewImage || hoverPreviewItem.imageData) ? (
              <div className="clip-preview-img-box">
                <img
                  src={fullPreviewImage || hoverPreviewItem.imageData || ""}
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
              {hoverPreviewItem.charCount ? (
                <span className="clip-preview-stat-item">
                  <strong>{hoverPreviewItem.charCount.toLocaleString(lang === "tr" ? "tr-TR" : "en-US")}</strong> {t("clipStatsChars")}
                </span>
              ) : null}
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
              {hoverPreviewItem.fileCount ? (
                <span className="clip-preview-stat-item">
                  <strong>{hoverPreviewItem.fileCount}</strong> {t("clipStatsFiles")}
                </span>
              ) : null}
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

      {/* Context Menu Dropdown */}
      {contextMenu && (
        <div
          className="clip-context-menu"
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="clip-context-menu-item"
            onClick={() => {
              handleCopy(contextMenu.item.id);
              setContextMenu(null);
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span className="clip-context-label">{t("clipMenuCopy") || t("copy")}</span>
            <span className="clip-context-shortcut">↵</span>
          </button>

          <button
            className="clip-context-menu-item"
            onClick={async (e) => {
              await handleTogglePin(e, contextMenu.item.id);
              setContextMenu(null);
            }}
          >
            <span style={{ fontSize: "14px", color: contextMenu.item.isPinned ? "#f59e0b" : "inherit" }}>
              ★
            </span>
            <span className="clip-context-label">
              {contextMenu.item.isPinned
                ? (t("clipMenuUnpin") || t("clipUnpinTooltip"))
                : (t("clipMenuPin") || t("clipPinTooltip"))}
            </span>
          </button>

          {(contextMenu.item.contentType === "text" || contextMenu.item.textContent) && (
            <button
              className="clip-context-menu-item"
              onClick={(e) => {
                handleOpenSaveToVault(e, contextMenu.item);
                setContextMenu(null);
              }}
            >
              <span>🔒</span>
              <span className="clip-context-label">{t("clipMenuVault") || t("clipSaveToVault")}</span>
              <span className="clip-context-shortcut">Ctrl+S</span>
            </button>
          )}

          <div className="clip-context-menu-divider" />

          <button
            className="clip-context-menu-item delete"
            onClick={async (e) => {
              await handleDelete(e, contextMenu.item.id);
              setContextMenu(null);
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <span className="clip-context-label">{t("clipMenuDelete") || t("delete")}</span>
            <span className="clip-context-shortcut">Del</span>
          </button>
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
