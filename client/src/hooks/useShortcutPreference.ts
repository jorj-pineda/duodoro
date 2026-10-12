"use client";

import { useCallback, useSyncExternalStore } from "react";

const changeEvent = "duodoro:keyboard-shortcuts-change";
const fallback = new Map<string, boolean>();
const serverSnapshot = () => false;

export function useShortcutPreference(userId?: string) {
  const key = userId ? `duodoro:keyboard-shortcuts:${userId}` : null;
  const getSnapshot = useCallback(() => {
    if (!key || typeof window === "undefined") return false;
    if (fallback.has(key)) return fallback.get(key)!;
    try { return window.localStorage.getItem(key) === "true"; }
    catch { return false; }
  }, [key]);
  const subscribe = useCallback((notify: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) return;
      if (key) fallback.delete(key);
      notify();
    };
    window.addEventListener(changeEvent, notify);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(changeEvent, notify);
      window.removeEventListener("storage", onStorage);
    };
  }, [key]);
  const enabled = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const setEnabled = useCallback((value: boolean) => {
    if (!key) return false;
    let persisted = false;
    fallback.set(key, value);
    try {
      window.localStorage.setItem(key, String(value));
      fallback.delete(key);
      persisted = true;
    } catch { /* Keep the choice for this page when browser storage is blocked. */ }
    window.dispatchEvent(new Event(changeEvent));
    return persisted;
  }, [key]);
  return { enabled, setEnabled };
}
