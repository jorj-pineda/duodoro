"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

// Device-only preference: whether a screen can stay awake is a property of
// this browser, so it is deliberately not synced across devices.
const changeEvent = "duodoro:keep-awake-change";
const fallback = new Map<string, boolean>();
const serverSnapshot = () => false;
const keyFor = (userId: string) => `duodoro:keep-awake:${userId}`;

export function useKeepAwakePreference(userId?: string) {
  const key = userId ? keyFor(userId) : null;
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
  /** Returns false when only the in-memory fallback could store the value. */
  const setEnabled = useCallback((value: boolean) => {
    if (!key) return false;
    let persisted = false;
    fallback.set(key, value);
    try { window.localStorage.setItem(key, String(value)); fallback.delete(key); persisted = true; }
    catch { /* Memory remains usable for this page. */ }
    window.dispatchEvent(new Event(changeEvent));
    return persisted;
  }, [key]);
  return { enabled, setEnabled };
}

const noopSubscribe = () => () => {};

/** Server and first client frame assume support so hydration matches. */
export function useWakeLockSupported() {
  return useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator !== "undefined" && "wakeLock" in navigator,
    () => true,
  );
}

/**
 * Holds a screen wake lock while `active`. Browsers release the lock when the
 * tab is hidden, so it is requested again when the tab becomes visible.
 */
export function useScreenWakeLock(active: boolean) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    let pending = false;
    const acquire = async () => {
      if (disposed || sentinel || pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (disposed) { void lock.release().catch(() => {}); return; }
        sentinel = lock;
        lock.addEventListener("release", () => { if (sentinel === lock) sentinel = null; });
        setFailed(false);
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        pending = false;
      }
    };
    const onVisibility = () => { if (document.visibilityState === "visible") void acquire(); };
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const lock = sentinel;
      sentinel = null;
      void lock?.release().catch(() => {});
    };
  }, [active]);
  return { failed: active && failed };
}
