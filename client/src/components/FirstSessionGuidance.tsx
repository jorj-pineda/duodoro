"use client";
import { useCallback, useSyncExternalStore } from "react";

const changed = "duodoro:first-session-guidance";
const fallback = new Set<string>();
// A neutral first frame avoids reading browser storage during SSR/hydration.
const serverSnapshot = () => true;

export default function FirstSessionGuidance({ userId }: { userId: string }) {
  const key = `duodoro:first-session-guidance:${userId}`;
  const subscribe = useCallback((notify: () => void) => {
    const storage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) { fallback.delete(key); notify(); }
    };
    window.addEventListener("storage", storage);
    window.addEventListener(changed, notify);
    return () => { window.removeEventListener("storage", storage); window.removeEventListener(changed, notify); };
  }, [key]);
  const read = useCallback(() => {
    if (fallback.has(key)) return true;
    try { return localStorage.getItem(key) === "1"; } catch { return false; }
  }, [key]);
  const dismissed = useSyncExternalStore(subscribe, read, serverSnapshot);
  function dismiss() {
    try { localStorage.setItem(key, "1"); } catch { fallback.add(key); }
    window.dispatchEvent(new Event(changed));
  }
  if (dismissed) return null;
  return <aside aria-label="First-session guidance" className="rounded-xl border border-line bg-surface p-4 space-y-2 text-sm text-muted">
    <h2 className="font-semibold text-ink">Your first focus session</h2>
    <p>Choose Focus to open a room, pick your timer settings, then choose Start solo.</p>
    <p>For two people, copy an invite link and wait for your friend to join. The host chooses Start session when you&apos;re both ready.</p>
    <p>Opening a room doesn&apos;t start the timer.</p>
    <button type="button" className="min-h-11 rounded-lg border border-line px-3 text-ink" onClick={dismiss}>Dismiss getting-started tip</button>
  </aside>;
}
