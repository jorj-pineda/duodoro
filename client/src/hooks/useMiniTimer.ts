"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

type PictureInPictureApi = {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
};

function pictureInPicture(): PictureInPictureApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { documentPictureInPicture?: PictureInPictureApi }).documentPictureInPicture;
}

const noopSubscribe = () => () => {};

/** Document Picture-in-Picture is Chromium-only; the server frame assumes no. */
export function useMiniTimerSupported() {
  return useSyncExternalStore(noopSubscribe, () => Boolean(pictureInPicture()), () => false);
}

/** Copies the page's styles so the mini window uses the same Tailwind tokens. */
export function copyStyles(source: Document, target: Document) {
  for (const sheet of Array.from(source.styleSheets)) {
    try {
      const style = target.createElement("style");
      style.textContent = Array.from(sheet.cssRules, rule => rule.cssText).join("\n");
      target.head.appendChild(style);
    } catch {
      // Cross-origin sheets cannot be read; link them instead.
      if (!sheet.href) continue;
      const link = target.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      target.head.appendChild(link);
    }
  }
}

/** Mirrors the root's theme attribute and font classes as they change. */
function mirrorRoot(source: Document, target: Document) {
  const sync = () => {
    target.documentElement.className = source.documentElement.className;
    const theme = source.documentElement.getAttribute("data-theme");
    if (theme === null) target.documentElement.removeAttribute("data-theme");
    else target.documentElement.setAttribute("data-theme", theme);
    target.body.className = `${source.body.className} bg-bg text-ink`;
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(source.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
  observer.observe(source.body, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/**
 * An always-on-top window for the room's timer. It must be opened from a user
 * gesture, and it closes when the room is no longer displayed.
 */
export function useMiniTimer(active: boolean) {
  const [pip, setPip] = useState<Window | null>(null);
  const [failed, setFailed] = useState(false);
  // A window can arrive after unmount, after the room closes, or after a newer
  // request; only the latest request from a live, active room may keep it.
  const live = useRef(false);
  const activeRef = useRef(active);
  const latest = useRef(0);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const open = useCallback(async () => {
    const api = pictureInPicture();
    if (!api) return;
    const request = ++latest.current;
    setFailed(false);
    try {
      const next = await api.requestWindow({ width: 260, height: 150 });
      if (!live.current || !activeRef.current || request !== latest.current) {
        next.close();
        return;
      }
      next.document.title = "Duodoro timer";
      copyStyles(document, next.document);
      const stopMirroring = mirrorRoot(document, next.document);
      next.addEventListener("pagehide", () => {
        stopMirroring();
        setPip(current => current === next ? null : current);
      }, { once: true });
      setPip(next);
    } catch {
      if (live.current && request === latest.current) setFailed(true);
    }
  }, []);

  const close = useCallback(() => { pip?.close(); }, [pip]);

  useEffect(() => {
    if (pip && !active) pip.close();
  }, [pip, active]);
  // Closes the window when the hook unmounts or another window replaces it.
  useEffect(() => () => { pip?.close(); }, [pip]);

  const shown = active && pip && !pip.closed ? pip : null;
  return { window: shown, open, close, failed: active && failed };
}
