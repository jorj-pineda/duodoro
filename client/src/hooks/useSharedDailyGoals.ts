"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { SharedDailyGoal } from "@/lib/types";
export type { SharedDailyGoal } from "@/lib/types";

export function useSharedDailyGoals(userId: string) {
  const sb = getSupabase();
  const [goals, setGoals] = useState<SharedDailyGoal[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const generation = useRef(0);
  const active = useRef(false);
  const requested = useRef(false);
  const running = useRef<Promise<void> | null>(null);

  const refresh = useCallback((): Promise<void> => {
    requested.current = true;
    if (running.current) return running.current;
    const read = async () => {
      do {
        requested.current = false;
        const request = ++generation.current;
        try {
          const { data, error } = await sb.rpc("get_shared_daily_goals");
          if (error || !data) throw new Error("Unavailable");
          if (active.current && request === generation.current && !requested.current) {
            setGoals(data);
            setLoadError(null);
          }
        } catch {
          if (active.current && request === generation.current && !requested.current) {
            setLoadError("Shared progress is unavailable. Retry to get the latest totals.");
          }
        }
      } while (active.current && requested.current);
    };
    running.current = read().finally(() => { running.current = null; });
    return running.current;
  }, [sb]);

  useEffect(() => {
    active.current = true;
    const lifecycle = { active, generation };
    const visibleRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    window.addEventListener("focus", visibleRefresh);
    window.addEventListener("online", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    // Scoped visible-only fallback covers missed deletes and saves from either
    // person's solo rooms without subscribing to their private session history.
    const timer = setInterval(visibleRefresh, 30_000);
    const channel = sb.channel(`shared-daily-goals:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "shared_daily_goals" }, visibleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, visibleRefresh)
      .subscribe((status) => { if (status === "SUBSCRIBED") visibleRefresh(); });
    return () => {
      lifecycle.active.current = false;
      ++lifecycle.generation.current;
      clearInterval(timer);
      window.removeEventListener("focus", visibleRefresh);
      window.removeEventListener("online", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
      void sb.removeChannel(channel);
    };
  }, [sb, userId, refresh]);

  // The database gives the next midnight in the goal's timezone, including DST.
  const nextReset = goals?.reduce((next, goal) => Math.min(next, Date.parse(goal.resets_at)), Infinity);
  useEffect(() => {
    if (!nextReset || !Number.isFinite(nextReset)) return;
    const delay = nextReset - Date.now() + 100;
    // A stale snapshot is refreshed by the visible fallback/tab return; don't
    // spin on a past midnight when offline or hidden.
    if (delay <= 0) return;
    const timer = setTimeout(() => { if (document.visibilityState === "visible") void refresh(); }, delay);
    return () => clearTimeout(timer);
  }, [nextReset, refresh]);

  const mutate = async (operation: () => PromiseLike<{ data: unknown; error: unknown }>) => {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setActionError(null);
    ++generation.current;
    try {
      const { data, error } = await operation();
      if (error || !data || (Array.isArray(data) && !data.length)) throw new Error("Unavailable");
      await refresh();
      return true;
    } catch {
      // Never display upstream error strings or treat an RLS zero-row delete as success.
      if (active.current) setActionError("Couldn't save that change. The goal may have changed; retry or refresh.");
      return false;
    } finally {
      writing.current = false;
      if (active.current) setBusy(false);
    }
  };

  return {
    goals, loadError, actionError, busy, refresh,
    create: (friendId: string, minutes: number) => mutate(() => sb.rpc("create_shared_daily_goal", {
      friend_id: friendId, minutes, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    })),
    accept: (id: string) => mutate(() => sb.rpc("accept_shared_daily_goal", { goal_id: id })),
    update: (id: string, minutes: number) => mutate(() => sb.rpc("update_shared_daily_goal", { goal_id: id, minutes })),
    remove: (id: string) => mutate(() => sb.from("shared_daily_goals").delete().eq("id", id).select("id")),
  };
}
