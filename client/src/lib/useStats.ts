"use client";
import { useState, useCallback, useEffect } from "react";
import { getSupabase } from "@/lib/supabase";
import type {
  SessionWithPartner,
  PersonalStats,
  DuoStats,
  DailyFocus,
} from "@/lib/types";

// Everything is aggregated in Postgres now (migration 015). This used to pull
// the user's entire session history — no LIMIT — aggregate it in JS, then send
// every session id back as an .in() list to find co-participants; a `sessions`
// row is written per focus phase, so that query outgrew PostgREST's URL limit
// with ordinary use.

type Snapshot = {
  personalStats: PersonalStats | null;
  duoStats: DuoStats[];
  recentSessions: SessionWithPartner[];
  dailyFocus: DailyFocus[];
};

const EMPTY: Snapshot = {
  personalStats: null,
  duoStats: [],
  recentSessions: [],
  dailyFocus: [],
};

// HomeDashboard, StatsPanel and StatsScreen each mount their own useStats, so
// opening the app fired the whole thing three times over. Share one in-flight
// request and a short-lived result between them.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; data: Snapshot }>();
type Request = { promise: Promise<Snapshot> };
const inFlight = new Map<string, Request>();
// Retain the newest settled request while consumers exist: an older completion
// must follow its outcome even after it has left the in-flight map.
const latest = new Map<string, Request>();
const consumers = new Map<string, number>();

function startRequest(userId: string): Request {
  const request = {} as Request;
  request.promise = loadSnapshot().then(data => {
    if (latest.get(userId) === request) cache.set(userId, { at: Date.now(), data });
    return data;
  }).finally(() => {
    if (inFlight.get(userId) === request) inFlight.delete(userId);
  });
  latest.set(userId, request);
  inFlight.set(userId, request);
  return request;
}

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// No userId parameter: every RPC derives the caller from auth.uid() server-side.
async function loadSnapshot(): Promise<Snapshot> {
  const sb = getSupabase();
  const tz = localTimeZone();

  const [stats, duos, recent, daily] = await Promise.all([
    sb.rpc("get_focus_stats", { tz }),
    sb.rpc("get_duo_stats"),
    sb.rpc("get_recent_sessions", { lim: 20 }),
    sb.rpc("get_daily_focus", { days: 7, tz }),
  ]);

  const firstError =
    stats.error ?? duos.error ?? recent.error ?? daily.error ?? null;
  if (firstError) throw firstError;

  // get_focus_stats returns a single row; bigints arrive as strings
  const row = (stats.data ?? [])[0];
  const num = (v: unknown) => Number(v ?? 0);

  return {
    personalStats: row
      ? {
          totalFocusTime: num(row.total_focus_time),
          weeklyFocusTime: num(row.weekly_focus_time),
          sessionsCompleted: num(row.sessions_completed),
          currentStreak: num(row.current_streak),
          longestStreak: num(row.longest_streak),
          avgSessionLength: num(row.avg_session_length),
        }
      : null,
    duoStats: (duos.data ?? []).map((d) => ({
      partnerId: d.partner_id,
      partnerName: d.partner_name,
      totalCoFocusTime: num(d.total_co_focus_time),
      sessionsTogether: num(d.sessions_together),
    })),
    recentSessions: recent.data ?? [],
    dailyFocus: (daily.data ?? []).map((d) => ({
      day: d.day,
      focusSeconds: num(d.focus_seconds),
      sessionCount: num(d.session_count),
    })),
  };
}

export function useStats(userId: string | undefined) {
  const [scope, setScope] = useState(() => ({ userId, active: false, sequence: 0 }));
  const [state, setState] = useState({ snapshot: EMPTY, loading: false, error: null as string | null, loaded: false });
  // Reset before children render another account's snapshot.
  if (scope.userId !== userId) {
    setScope({ userId, active: false, sequence: 0 });
    setState({ snapshot: EMPTY, loading: false, error: null, loaded: false });
  }
  useEffect(() => {
    scope.active = true;
    const id = scope.userId;
    if (id) consumers.set(id, (consumers.get(id) ?? 0) + 1);
    return () => {
      scope.active = false;
      scope.sequence++;
      if (!id) return;
      const remaining = (consumers.get(id) ?? 1) - 1;
      if (remaining) consumers.set(id, remaining);
      else {
        consumers.delete(id);
        cache.delete(id);
        latest.delete(id);
        inFlight.delete(id);
      }
    };
  }, [scope]);

  const fetchStats = useCallback(
    async (force = false) => {
      const id = scope.userId;
      if (!id || !scope.active) return;
      const sequence = ++scope.sequence;
      const current = () => scope.active && scope.sequence === sequence;
      // Join an active refresh before considering an older cached snapshot.
      let pending = inFlight.get(id);
      const fresh = cache.get(id);
      if (!force && !pending && fresh && Date.now() - fresh.at < CACHE_TTL_MS) {
        setState({ snapshot: fresh.data, loading: false, error: null, loaded: true });
        return;
      }
      setState(previous => ({ ...previous, loading: true, error: null }));
      try {
        if (!pending || force) pending = startRequest(id);
        // Recheck request identity after every await. Other consumers can force
        // a newer refresh; follow its success or failure before updating this UI.
        for (;;) {
          try {
            const data = await pending.promise;
            const newest = latest.get(id);
            if (!newest) return;
            if (newest !== pending) { pending = newest; continue; }
            if (current()) setState({ snapshot: data, loading: false, error: null, loaded: true });
            break;
          } catch (err) {
            const newest = latest.get(id);
            if (!newest) return;
            if (newest !== pending) { pending = newest; continue; }
            throw err;
          }
        }
      } catch (err) {
        if (current()) {
          console.error("Failed to fetch stats:", err);
          setState(previous => ({ ...previous, error:
            err instanceof Error && err.message ? err.message : "Couldn't load your stats.",
          }));
        }
      } finally {
        if (current()) setState(previous => ({ ...previous, loading: false }));
      }
    },
    [scope],
  );
  const { snapshot, loading, error, loaded } = state;

  const retry = useCallback(() => fetchStats(true), [fetchStats]);

  return {
    personalStats: snapshot.personalStats,
    duoStats: snapshot.duoStats,
    recentSessions: snapshot.recentSessions,
    dailyFocus: snapshot.dailyFocus,
    loading,
    /** Non-null when the last attempt failed. Zeros are not trustworthy. */
    error,
    /** True once a fetch has succeeded — only then do zeros mean "no data". */
    loaded,
    retry,
    fetchStats,
  };
}
