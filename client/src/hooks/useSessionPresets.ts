"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { normalizeTimerPrefs, type TimerPrefs } from "@/lib/timerPrefs";

export interface SessionPreset extends TimerPrefs { name: string }
export const BUILTIN_PRESETS: SessionPreset[] = [
  { name: "Classic", mode: "pomodoro", focus: 25, break: 5 },
  { name: "Deep focus", mode: "pomodoro", focus: 50, break: 10 },
  { name: "Quick focus", mode: "pomodoro", focus: 15, break: 3 },
  { name: "Flow", mode: "flow", focus: 25, break: 5 },
];
export const MAX_PRESETS = 5;
const CHANGED = "duodoro:presets-changed";
const memory = new Map<string, string>();

export function parseSessionPresets(raw: string | null): SessionPreset[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const names = new Set<string>();
    return parsed.flatMap((row: unknown): SessionPreset[] => {
      if (!row || typeof row !== "object") return [];
      const value = row as Partial<SessionPreset>;
      if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 24) return [];
      const prefs = normalizeTimerPrefs(value);
      if (prefs.mode !== value.mode || prefs.focus !== value.focus || prefs.break !== value.break) return [];
      const name = value.name.trim();
      if (names.has(name.toLowerCase()) || names.size >= MAX_PRESETS) return [];
      names.add(name.toLowerCase());
      return [{ name, ...prefs }];
    });
  } catch { return []; }
}

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, presets: SessionPreset[]): boolean {
  const raw = JSON.stringify(presets);
  let persisted = true;
  try { localStorage.setItem(key, raw); memory.delete(key); }
  catch { memory.set(key, raw); persisted = false; }
  window.dispatchEvent(new Event(CHANGED));
  return persisted;
}

export function useSessionPresets(userId: string) {
  const key = `duodoro:session-presets:${userId}`;
  const subscribe = useCallback((notify: () => void) => {
    const storage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) { memory.delete(key); notify(); }
    };
    window.addEventListener("storage", storage);
    window.addEventListener(CHANGED, notify);
    return () => { window.removeEventListener("storage", storage); window.removeEventListener(CHANGED, notify); };
  }, [key]);
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  const presets = useMemo(() => parseSessionPresets(raw), [raw]);
  function save(name: string, prefs: TimerPrefs): { error?: string; persisted?: boolean } {
    name = name.trim();
    if (!name || name.length > 24) return { error: "Choose a name of 1–24 characters." };
    const current = parseSessionPresets(read(key));
    const index = current.findIndex(preset => preset.name.toLowerCase() === name.toLowerCase());
    if (index < 0 && current.length >= MAX_PRESETS) return { error: "Remove a favorite before saving another (maximum 5)." };
    const next = { name, ...normalizeTimerPrefs(prefs) };
    if (index >= 0) current[index] = next; else current.push(next);
    return { persisted: write(key, current) };
  }
  return { presets, save, remove: (name: string) => write(key, parseSessionPresets(read(key)).filter(row => row.name !== name)) };
}
