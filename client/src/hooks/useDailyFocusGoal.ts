"use client";
import { useCallback, useSyncExternalStore } from "react";

export const DAILY_GOALS = [25, 30, 50, 60, 90, 120, 180, 240] as const;
const DEFAULT_GOAL = 60;
const GOAL_CHANGED = "duodoro:daily-goal-changed";
const memoryGoals = new Map<string, number>();

function readGoal(key: string): number {
  const fallback = memoryGoals.get(key);
  if (fallback !== undefined) return fallback;
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) {
      const value = Number(stored);
      if (DAILY_GOALS.some((goal) => goal === value)) return value;
    }
  } catch { /* Keep the control usable when browser storage is unavailable. */ }
  return DEFAULT_GOAL;
}

export function useDailyFocusGoal(userId: string) {
  const key = `duodoro:daily-goal:${userId}`;
  const subscribe = useCallback((notify: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) {
        memoryGoals.delete(key);
        notify();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(GOAL_CHANGED, notify);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(GOAL_CHANGED, notify);
    };
  }, [key]);
  const goal = useSyncExternalStore(subscribe, () => readGoal(key), () => DEFAULT_GOAL);
  const setGoal = (minutes: number) => {
    if (!DAILY_GOALS.some((value) => value === minutes)) return;
    try {
      localStorage.setItem(key, String(minutes));
      memoryGoals.delete(key);
    } catch { memoryGoals.set(key, minutes); }
    window.dispatchEvent(new Event(GOAL_CHANGED));
  };
  return { goal, setGoal };
}

export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function subscribeDay(notify: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  const update = () => {
    notify();
    clearTimeout(timer);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    timer = setTimeout(update, midnight.getTime() - now.getTime() + 50);
  };
  const onVisible = () => { if (document.visibilityState === "visible") update(); };
  update();
  window.addEventListener("focus", update);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", update);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** Uses the same local calendar day as the timezone-aware stats RPC. */
export function useLocalDay() {
  return useSyncExternalStore(subscribeDay, localDay, () => "");
}
