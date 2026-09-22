/**
 * LauncherPage.tsx — Spotlight-style search launcher.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { MasterPasswordAuth } from "../components/MasterPasswordAuth";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { useVaultLock } from "../hooks/useVaultLock";
import {
  searchCredentials,
  copyPassword,
  copyUsername,
  toggleFavorite,
  hideLauncher,
  openManager,
  lockVault,
  isVaultUnlocked,
  getCategories,
} from "../api/vault";
import type { CredentialSafe, Category } from "../api/vault";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../context/AppContext";

const SEARCH_DEBOUNCE = 80;

export default function LauncherPage() {
  const { t } = useApp();
  const [unlocked, setUnlocked] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CredentialSafe[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copying, setCopying] = useState(false);
  const [clipboardActive, setClipboardActive] = useState(false);
  const [clipboardCountdown, setClipboardCountdown] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { toasts, showToast, removeToast } = useToast();

  const handleAutoLock = useCallback(() => {
    setUnlocked(false);
    setQuery("");
    setResults([]);
  }, []);

  useVaultLock(handleAutoLock, unlocked);

  useEffect(() => {
    isVaultUnlocked().then((ok) => {
      if (ok) {
        setUnlocked(true);
        loadCategories();
      }
    });
  }, []);

  const loadCategories = async () => {
    try {
      const cats = await getCategories();
      setCategories(cats);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (!unlocked) return;

    const win = getCurrentWindow();
    const unlisten = win.onFocusChanged(({ payload: focused }: { payload: boolean }) => {
      if (focused) {
        setTimeout(() => {
          searchRef.current?.focus();
        }, 10);
        doSearch(query, selectedCategoryId);
        loadCategories();
      }
    });

    return () => {
      unlisten.then((fn: () => void) => fn());
    };
  }, [unlocked, query, selectedCategoryId]);

  useEffect(() => {
    if (unlocked) {
      setTimeout(() => searchRef.current?.focus(), 50);
      doSearch("", selectedCategoryId);
      loadCategories();
    }
  }, [unlocked]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        handleClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  async function doSearch(q: string, catId: number | null = null) {
    if (!unlocked) return;
    try {
      const res = await searchCredentials(q, catId);
      setResults(res);
      setSelectedIndex(0);
    } catch {
      setUnlocked(false);
    }
  }

  function handleCategorySelect(catId: number | null) {
    setSelectedCategoryId(catId);
    doSearch(query, catId);
  }

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q, selectedCategoryId), SEARCH_DEBOUNCE);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      scrollSelectedIntoView();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      scrollSelectedIntoView();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cred = results[selectedIndex];
      if (!cred) return;
      if (e.ctrlKey || e.metaKey) {
        handleCopyUsername(cred);
      } else {
        handleCopyPassword(cred);
      }
    }
  }

  function scrollSelectedIntoView() {
    setTimeout(() => {
      const el = listRef.current?.querySelector(".result-item.selected");
      el?.scrollIntoView({ block: "nearest" });
    }, 10);
  }

  async function handleCopyPassword(cred: CredentialSafe) {
    if (copying) return;
    setCopying(true);
    try {
      await copyPassword(cred.id);
      showToast(`🔑  "${cred.keyName}" password copied — clears in 15s`, "success");
      startClipboardCountdown();
      setTimeout(async () => {
        await handleClose();
      }, 600);
    } catch (err) {
      showToast(`Failed to copy: ${String(err)}`, "error");
    } finally {
      setCopying(false);
    }
  }

  async function handleCopyUsername(cred: CredentialSafe) {
    if (copying) return;
    setCopying(true);
    try {
      await copyUsername(cred.id);
      showToast(`👤  "${cred.keyName}" username copied — clears in 15s`, "success");
      startClipboardCountdown();
      setTimeout(async () => {
        await handleClose();
      }, 600);
    } catch (err) {
      showToast(`Failed to copy username: ${String(err)}`, "error");
    } finally {
      setCopying(false);
    }
  }

  async function handleToggleFavorite(e: React.MouseEvent, cred: CredentialSafe) {
    e.stopPropagation();
    try {
      const next = await toggleFavorite(cred.id);
      setResults((list) =>
        list.map((item) => (item.id === cred.id ? { ...item, isFavorite: next } : item))
      );
      showToast(next ? "Added to favorites" : "Removed from favorites", "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  function startClipboardCountdown() {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setClipboardActive(true);
    setClipboardCountdown(15);
    countdownRef.current = setInterval(() => {
      setClipboardCountdown((c) => {
        if (c <= 1) {
          clearInterval(countdownRef.current!);
          setClipboardActive(false);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  async function handleClose() {
    setQuery("");
    setResults([]);
    setSelectedIndex(0);
    await hideLauncher();
  }

  async function handleOpenManager() {
    await openManager();
    await handleClose();
  }

  async function handleLock() {
    await lockVault();
    setUnlocked(false);
    setQuery("");
    setResults([]);
  }

  function getInitials(name: string) {
    if (!name) return "??";
    return name.slice(0, 2).toLowerCase();
  }

  return (
    <div className="launcher-root" data-tauri-drag-region>
      {!unlocked && <MasterPasswordAuth onUnlocked={() => setUnlocked(true)} />}

      {unlocked && (
        <div className="launcher-panel" onClick={(e) => e.stopPropagation()}>
          <div className="search-wrap">
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>

            <input
              ref={searchRef}
              id="launcher-search-input"
              type="text"
              className="search-input"
              placeholder={t("launcherSearchPlaceholder")}
              value={query}
              onChange={handleQueryChange}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              spellCheck={false}
            />

            {clipboardActive && (
              <div className="clipboard-badge">
                <div className="clipboard-dot" />
                {clipboardCountdown}s
              </div>
            )}

            {!clipboardActive && <span className="search-hint">ESC</span>}
          </div>

          {categories.length > 0 && (
            <div className="category-filter-bar">
              <div
                className={`category-filter-item ${selectedCategoryId === null ? "active" : ""}`}
                onClick={() => handleCategorySelect(null)}
              >
                {t("all")}
              </div>
              {categories.map((cat) => (
                <div
                  key={cat.id}
                  className={`category-filter-item ${selectedCategoryId === cat.id ? "active" : ""}`}
                  onClick={() => handleCategorySelect(cat.id)}
                >
                  <div className="category-dot" style={{ color: cat.color }} />
                  {cat.name}
                </div>
              ))}
            </div>
          )}

          <div className="results-list" ref={listRef}>
            {results.length === 0 ? (
              <div className="results-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {query ? `No credentials matching "${query}"` : "Type to search your vault"}
              </div>
            ) : (
              results.map((cred, index) => (
                <div
                  key={cred.id}
                  id={`result-item-${cred.id}`}
                  className={`result-item ${index === selectedIndex ? "selected" : ""}`}
                  onClick={() => handleCopyPassword(cred)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <button
                    type="button"
                    className={`favorite-btn ${cred.isFavorite ? "active" : ""}`}
                    title={cred.isFavorite ? "Unpin favorite" : "Pin favorite"}
                    onClick={(e) => handleToggleFavorite(e, cred)}
                  >
                    {cred.isFavorite ? "★" : "☆"}
                  </button>

                  <div
                    className="result-icon"
                    style={{
                      background: cred.categoryId
                        ? categories.find((c) => c.id === cred.categoryId)?.color + "22"
                        : "transparent",
                      color: cred.categoryId
                        ? categories.find((c) => c.id === cred.categoryId)?.color
                        : "inherit",
                    }}
                  >
                    {getInitials(cred.keyName)}
                  </div>

                  <div className="result-info">
                    <div className="result-keyname">{cred.keyName}</div>
                    <div className="result-username">
                      {cred.username || (
                        <span style={{ fontStyle: "italic", opacity: 0.6 }}>No username</span>
                      )}
                      {cred.categoryId && (
                        <span
                          className="credential-category-tag"
                          style={{
                            marginLeft: 8,
                            padding: "0 4px",
                            fontSize: 9,
                            opacity: 0.7,
                            border: "1px solid currentColor",
                          }}
                        >
                          {categories.find((c) => c.id === cred.categoryId)?.name}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="result-copy-hint">
                    <span className="copy-password-hint">↵ Pass</span>
                    <span className="copy-user-hint">Ctrl+↵ User</span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="launcher-footer">
            <div className="footer-hints">
              <div className="footer-hint">
                <span className="kbd">↑↓</span> Navigate
              </div>
              <div className="footer-hint">
                <span className="kbd">↵</span> Password
              </div>
              <div className="footer-hint">
                <span className="kbd">Ctrl+↵</span> Username
              </div>
              <div className="footer-hint">
                <span className="kbd">Esc</span> Close
              </div>
            </div>

            <div className="footer-actions">
              <button id="launcher-lock-btn" className="btn btn-icon" title="Lock vault" onClick={handleLock}>
                🔒
              </button>
              <button
                id="launcher-manager-btn"
                className="btn btn-icon"
                title="Open Vault Manager"
                onClick={handleOpenManager}
              >
                ⚙️
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
