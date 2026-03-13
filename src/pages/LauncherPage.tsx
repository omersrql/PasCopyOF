/**
 * LauncherPage.tsx — The Spotlight-style search launcher.
 *
 * This is the primary interface. Features:
 *  - Global shortcut (Ctrl+Shift+Space) shows/hides this window
 *  - Typing instantly filters credentials by key_name
 *  - Arrow keys navigate the list
 *  - Enter / click copies the password to clipboard
 *  - Escape hides the window
 *  - Clipboard is auto-cleared after 15 seconds (handled in Rust)
 */
import React, { useState, useEffect, useRef } from "react";
import { MasterPasswordAuth } from "../components/MasterPasswordAuth";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { searchCredentials, copyPassword, hideLauncher, openManager, lockVault, isVaultUnlocked } from "../api/vault";
import type { CredentialSafe } from "../api/vault";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Debounce delay for search input in ms
const SEARCH_DEBOUNCE = 80;

export default function LauncherPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CredentialSafe[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copying, setCopying] = useState(false);
  const [clipboardActive, setClipboardActive] = useState(false);
  const [clipboardCountdown, setClipboardCountdown] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { toasts, showToast, removeToast } = useToast();

  // Check if already unlocked on mount
  useEffect(() => {
    isVaultUnlocked().then((ok) => {
      if (ok) setUnlocked(true);
    });
  }, []);

  // Focus search when window becomes visible
  useEffect(() => {
    if (!unlocked) return;

    const win = getCurrentWindow();
    const unlisten = win.onFocusChanged(({ payload: focused }: { payload: boolean }) => {
      if (focused) {
        setTimeout(() => {
          searchRef.current?.focus();
        }, 10);
        // Re-search to refresh results
        doSearch(query);
      }
    });

    return () => {
      unlisten.then((fn: () => void) => fn());
    };
  }, [unlocked, query]);

  // Focus on mount / unlock
  useEffect(() => {
    if (unlocked) {
      setTimeout(() => searchRef.current?.focus(), 50);
      doSearch("");
    }
  }, [unlocked]);

  // Keyboard shortcut listener
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        handleClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ── Search ──────────────────────────────────────────────────────────────────

  async function doSearch(q: string) {
    if (!unlocked) return;
    try {
      const res = await searchCredentials(q);
      setResults(res);
      setSelectedIndex(0);
    } catch {
      // Vault was locked externally; re-lock the UI
      setUnlocked(false);
    }
  }

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    // Debounce search for fast typing
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), SEARCH_DEBOUNCE);
  }

  // ── Keyboard navigation ─────────────────────────────────────────────────────

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
      if (results[selectedIndex]) {
        handleCopy(results[selectedIndex]);
      }
    }
  }

  function scrollSelectedIntoView() {
    // Small delay to let state update first
    setTimeout(() => {
      const el = listRef.current?.querySelector(".result-item.selected");
      el?.scrollIntoView({ block: "nearest" });
    }, 10);
  }

  // ── Copy behavior ───────────────────────────────────────────────────────────

  async function handleCopy(cred: CredentialSafe) {
    if (copying) return;
    setCopying(true);
    try {
      await copyPassword(cred.id);

      showToast(`🔑  "${cred.keyName}" copied — clears in 15s`, "success");

      // Start countdown display
      startClipboardCountdown();

      // Close the launcher window after a short delay
      setTimeout(async () => {
        await handleClose();
      }, 600);
    } catch (err) {
      showToast(`Failed to copy: ${String(err)}`, "error");
    } finally {
      setCopying(false);
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

  // ── Window ──────────────────────────────────────────────────────────────────

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

  // ── Render ──────────────────────────────────────────────────────────────────

  // Get initials for the icon badge
  function getInitials(name: string) {
    if (!name) return "??";
    return name.slice(0, 2).toLowerCase();
  }

  return (
    <div className="launcher-root" data-tauri-drag-region>
      {/* Master password gate */}
      {!unlocked && <MasterPasswordAuth onUnlocked={() => setUnlocked(true)} />}

      {/* Launcher panel */}
      {unlocked && (
        <div className="launcher-panel" onClick={(e) => e.stopPropagation()}>
          {/* ── Search bar ───────────────────────────────────────────────────── */}
          <div className="search-wrap">
            {/* Search icon */}
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>

            <input
              ref={searchRef}
              id="launcher-search-input"
              type="text"
              className="search-input"
              placeholder="Search credentials…"
              value={query}
              onChange={handleQueryChange}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              spellCheck={false}
            />

            {/* Clipboard badge */}
            {clipboardActive && (
              <div className="clipboard-badge">
                <div className="clipboard-dot" />
                {clipboardCountdown}s
              </div>
            )}

            {!clipboardActive && (
              <span className="search-hint">ESC</span>
            )}
          </div>

          {/* ── Results ──────────────────────────────────────────────────────── */}
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
                  onClick={() => handleCopy(cred)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  {/* Icon badge */}
                  <div className="result-icon">{getInitials(cred.keyName)}</div>

                  {/* Info */}
                  <div className="result-info">
                    <div className="result-keyname">{cred.keyName}</div>
                    <div className="result-username">
                      {cred.username || <span style={{ fontStyle: "italic", opacity: 0.6 }}>No username</span>}
                    </div>
                  </div>

                  {/* Copy hint */}
                  <div className="result-copy-hint">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── Footer ───────────────────────────────────────────────────────── */}
          <div className="launcher-footer">
            <div className="footer-hints">
              <div className="footer-hint">
                <span className="kbd">↑↓</span> Navigate
              </div>
              <div className="footer-hint">
                <span className="kbd">↵</span> Copy
              </div>
              <div className="footer-hint">
                <span className="kbd">Esc</span> Close
              </div>
            </div>

            <div className="footer-actions">
              {/* Lock button */}
              <button
                id="launcher-lock-btn"
                className="btn btn-icon"
                title="Lock vault"
                onClick={handleLock}
              >
                🔒
              </button>

              {/* Open manager */}
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

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
