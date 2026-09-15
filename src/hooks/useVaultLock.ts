/**
 * useVaultLock.ts — Listen for idle auto-lock and keep activity alive.
 */
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { touchActivity } from "../api/vault";

export function useVaultLock(onLocked: () => void, enabled: boolean) {
  const onLockedRef = useRef(onLocked);
  onLockedRef.current = onLocked;

  useEffect(() => {
    if (!enabled) return;

    let unlisten: (() => void) | undefined;
    listen("vault-locked", () => {
      onLockedRef.current();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    let lastSent = 0;
    const bump = () => {
      const now = Date.now();
      if (now - lastSent < 5000) return;
      lastSent = now;
      void touchActivity().catch(() => onLockedRef.current());
    };

    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
    ];
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    const interval = window.setInterval(bump, 60_000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, bump));
      window.clearInterval(interval);
    };
  }, [enabled]);
}
