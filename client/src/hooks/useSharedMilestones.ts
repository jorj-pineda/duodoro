"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { SharedFocus } from "@/lib/sharedMilestones";

export function useSharedMilestones(userId: string, connected: boolean) {
  const [state, setState] = useState<{ owner: string; rows: SharedFocus[]; loaded: boolean; error: string | null }>({ owner: userId, rows: [], loaded: false, error: null });
  const requests = useRef(0);
  const load = useCallback(async () => {
    const request = ++requests.current;
    try {
      const { data, error } = await getSupabase().rpc("get_duo_stats");
      if (request !== requests.current) return;
      if (error) throw error;
      setState({ owner: userId, rows: (data ?? []).map(row => ({ partnerId: row.partner_id, partnerName: row.partner_name, seconds: Number(row.total_co_focus_time), rounds: Number(row.sessions_together) })), loaded: true, error: null });
    } catch {
      if (request === requests.current) setState({ owner: userId, rows: [], loaded: false, error: "Couldn't load your shared milestones. Try again." });
    }
  }, [userId]);
  useEffect(() => {
    let cancelled = false;
    const version = requests;
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; ++version.current; };
  }, [load, connected]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    const interval = setInterval(refresh, 30_000);
    return () => { clearInterval(interval); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  return { ...(state.owner === userId ? state : { rows: [], loaded: false, error: null }), retry: load };
}
