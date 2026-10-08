"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useLocalDay } from "./useDailyFocusGoal";
import type { CalendarDay, CalendarSession } from "@/lib/focusCalendar";

export function useFocusCalendar(userId: string, month: string) {
  const day = useLocalDay();
  const owner = `${userId}:${month}`;
  const [state, setState] = useState<{ owner: string; rows: CalendarDay[]; loaded: boolean; error: string | null; timezone: string | null }>({ owner, rows: [], loaded: false, error: null, timezone: null });
  const requests = useRef(0);
  const load = useCallback(async () => {
    if (!month) return;
    const request = ++requests.current;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    try {
      const { data, error } = await getSupabase().rpc("get_focus_calendar", { month_start: `${month}-01`, tz });
      if (request !== requests.current) return;
      if (error) throw error;
      const rows = (data ?? []).map(row => ({
        ...row, solo_seconds: Number(row.solo_seconds), duo_seconds: Number(row.duo_seconds),
        solo_rounds: Number(row.solo_rounds), duo_rounds: Number(row.duo_rounds),
        sessions: (Array.isArray(row.sessions) ? row.sessions : []) as unknown as CalendarSession[],
      }));
      setState({ owner, rows, loaded: true, error: null, timezone: tz });
    } catch {
      if (request === requests.current) setState({ owner, rows: [], loaded: false, error: "Couldn't load your focus calendar. Try again.", timezone: tz });
    }
  }, [month, owner]);
  useEffect(() => {
    let cancelled = false;
    const version = requests;
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; ++version.current; };
  }, [load, day]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  return { ...(state.owner === owner ? state : { rows: [], loaded: false, error: null, timezone: null }), retry: load };
}
