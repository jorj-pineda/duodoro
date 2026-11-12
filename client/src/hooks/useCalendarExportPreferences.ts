"use client";
import { useCallback, useSyncExternalStore } from "react";
import { CALENDAR_LENGTHS, CALENDAR_REMINDERS } from "@/lib/focusDateCalendar";
export type CalendarExportPreferences = { minutes: number; reminder: number };
const DEFAULT = '{"minutes":25,"reminder":0}';
const eventName = "duodoro:calendar-export-preferences";
const fallback = new Map<string, string>();
function normalize(raw: string | null): string {
  try {
    const value = JSON.parse(raw ?? "null");
    if (CALENDAR_LENGTHS.some(option => option === value?.minutes) && CALENDAR_REMINDERS.some(option => option === value?.reminder)) {
      return JSON.stringify({ minutes: value.minutes, reminder: value.reminder });
    }
  } catch { /* Ignore malformed browser preferences. */ }
  return DEFAULT;
}
export function useCalendarExportPreferences(userId: string) {
  const key = `duodoro:calendar-export:${userId}`;
  const subscribe = useCallback((notify: () => void) => {
    const storage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) { fallback.delete(key); notify(); }
    };
    window.addEventListener("storage", storage); window.addEventListener(eventName, notify);
    return () => { window.removeEventListener("storage", storage); window.removeEventListener(eventName, notify); };
  }, [key]);
  const read = useCallback(() => {
    const memory = fallback.get(key);
    if (memory) return memory;
    try { return normalize(localStorage.getItem(key)); } catch { return DEFAULT; }
  }, [key]);
  const snapshot = useSyncExternalStore(subscribe, read, () => DEFAULT);
  const value: CalendarExportPreferences = JSON.parse(snapshot);
  function save(next: CalendarExportPreferences) {
    const raw = normalize(JSON.stringify(next));
    try { localStorage.setItem(key, raw); fallback.delete(key); } catch { fallback.set(key, raw); }
    window.dispatchEvent(new Event(eventName));
  }
  return { ...value, save };
}
