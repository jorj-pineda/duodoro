"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useLocalDay } from "./useDailyFocusGoal";
export interface WeeklyDuoRecap { partner_id: string; partner_name: string; focus_seconds: number; completed_rounds: number; week_start: string; week_end: string; }
export function useWeeklyDuoRecap(userId: string, connected: boolean) {
  const day = useLocalDay();
  const [snapshot, setSnapshot] = useState<{ owner: string; rows: WeeklyDuoRecap[]; loaded: boolean; error: string | null; timezone: string | null }>({ owner: userId, rows: [], loaded: false, error: null, timezone: null });
  const version = useRef(0);
  const load = useCallback(async () => {
    const request = ++version.current;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    try {
      const { data, error: failure } = await getSupabase().rpc("get_weekly_duo_recap", { tz });
      if (request !== version.current) return;
      if (failure) throw failure;
      setSnapshot({ owner: userId, rows: (data ?? []).map(row => ({ ...row, focus_seconds: Number(row.focus_seconds), completed_rounds: Number(row.completed_rounds) })), timezone: tz, loaded: true, error: null });
    } catch {
      if (request === version.current) setSnapshot(prev => ({ owner: userId, rows: prev.owner === userId ? prev.rows : [], loaded: prev.owner === userId && prev.loaded, timezone: prev.owner === userId ? prev.timezone : null, error: "Couldn't load your weekly duo recap. Try again." }));
    }
  }, [userId]);
  useEffect(() => {
    let cancelled = false;
    const requests = version;
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; ++requests.current; };
  }, [userId, day, connected, load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  return { ...(snapshot.owner === userId ? snapshot : { rows: [], loaded: false, error: null, timezone: null }), retry: load };
}
