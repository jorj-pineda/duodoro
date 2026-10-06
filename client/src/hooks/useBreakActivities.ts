"use client";
import { useCallback, useSyncExternalStore } from "react";

const CHANGED = "duodoro:break-ideas-changed";
const memory = new Map<string, string | null>();
type StorageKind = "localStorage" | "sessionStorage";
function read(kind: StorageKind, key: string): string | null {
  const memoryKey = `${kind}:${key}`;
  if (memory.has(memoryKey)) return memory.get(memoryKey)!;
  try { return window[kind].getItem(key); } catch { return null; }
}
function write(kind: StorageKind, key: string, value: string | null): boolean {
  const memoryKey = `${kind}:${key}`;
  let persisted = true;
  try {
    if (value === null) window[kind].removeItem(key); else window[kind].setItem(key, value);
    memory.delete(memoryKey);
  } catch { memory.set(memoryKey, value); persisted = false; }
  window.dispatchEvent(new Event(CHANGED));
  return persisted;
}

/** Opt-in is per account/browser; dismissing applies only to this server break. */
export function useBreakActivities(userId: string, breakId: string) {
  const preferenceKey = `duodoro:break-ideas:${userId}`;
  const dismissedKey = `duodoro:break-dismissed:${userId}`;
  const subscribe = useCallback((notify: () => void) => {
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key === preferenceKey || event.key === dismissedKey) {
        if (event.key === null || event.key === preferenceKey) memory.delete(`localStorage:${preferenceKey}`);
        if (event.key === null || event.key === dismissedKey) memory.delete(`sessionStorage:${dismissedKey}`);
        notify();
      }
    };
    window.addEventListener("storage", storage); window.addEventListener(CHANGED, notify);
    return () => { window.removeEventListener("storage", storage); window.removeEventListener(CHANGED, notify); };
  }, [preferenceKey, dismissedKey]);
  const getSnapshot = () => JSON.stringify([
    read("localStorage", preferenceKey) === "1", read("sessionStorage", dismissedKey) === breakId,
  ]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => "[false,false]");
  const [enabled, dismissed] = JSON.parse(snapshot) as [boolean, boolean];
  return {
    enabled, dismissed,
    enable: () => {
      write("sessionStorage", dismissedKey, null);
      return write("localStorage", preferenceKey, "1");
    },
    disable: () => write("localStorage", preferenceKey, "0"),
    dismiss: () => write("sessionStorage", dismissedKey, breakId),
  };
}
