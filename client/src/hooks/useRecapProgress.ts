"use client";
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useLocalDay } from "./useDailyFocusGoal";

/** Read persisted progress only; a completed but unsaved round is not credit. */
export function useRecapProgress(userId: string, round: number, saveState: string) {
  const today = useLocalDay();
  const [progress, setProgress] = useState<{ seconds: number | null; error: boolean }>({ seconds: null, error: false });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!today) return;
    let active = true;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      setProgress({ seconds: null, error: false });
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const { data, error } = await getSupabase().rpc("get_daily_focus", { days: 1, tz });
        if (error) throw error;
        if (active && current === request) {
          setProgress({ seconds: Number(data?.find((row) => row.day === today)?.focus_seconds ?? 0), error: false });
        }
      } catch {
        if (active && current === request) setProgress({ seconds: null, error: true });
      }
    };
    const onReturn = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    window.addEventListener("focus", onReturn);
    window.addEventListener("online", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      active = false;
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("online", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [userId, today, round, saveState, attempt]);
  return { ...progress, retry };
}
