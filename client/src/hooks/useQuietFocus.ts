"use client";

import { useCallback, useSyncExternalStore } from "react";

const changeEvent = "duodoro:quiet-focus-change";
const fallback = new Map<string, boolean>();
const serverSnapshot = () => false;

export function useQuietFocus(userId?: string) {
  const key = userId ? `duodoro:quiet-focus:${userId}` : null;
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
    return writeQuietDeviceValue(userId!, value);
  }, [key, userId]);
  return { enabled, setEnabled };
}

export function quietDeviceValue(userId: string): boolean | undefined {
  const key = `duodoro:quiet-focus:${userId}`;
  if (fallback.has(key)) return fallback.get(key);
  try { const raw = localStorage.getItem(key); return raw === "true" ? true : raw === "false" ? false : undefined; } catch { return undefined; }
}
export function writeQuietDeviceValue(userId: string, value: boolean): boolean {
  const key = `duodoro:quiet-focus:${userId}`;
  let persisted = false; fallback.set(key, value);
  try { localStorage.setItem(key, String(value)); fallback.delete(key); persisted = true; } catch { /* Memory remains usable. */ }
  window.dispatchEvent(new CustomEvent(changeEvent, { detail: { userId, key: "quiet_focus", value } }));
  return persisted;
}
