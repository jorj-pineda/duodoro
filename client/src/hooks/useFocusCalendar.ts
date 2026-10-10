"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useLocalDay } from "./useDailyFocusGoal";
import type { CalendarDay, CalendarSession } from "@/lib/focusCalendar";
import { readCalendarTag } from "@/lib/focusTags";
import { rememberFocusTags, retainFocusTagAccount } from "./useSessionFocusTags";

type State = { owner: string; rows: CalendarDay[]; loaded: boolean; error: string | null; timezone: string | null; tagsAvailable: boolean };
type RpcRow = {
  day: string; solo_seconds: number | string; duo_seconds: number | string;
  solo_rounds: number | string; duo_rounds: number | string; sessions: unknown;
};

const LOAD_ERROR = "Couldn't load your focus calendar. Try again.";
const REFRESH_ERROR = "Couldn't refresh your focus calendar. Showing the rounds loaded last.";

// Tag fields are all-or-nothing. Rows without them come from an older API, which
// makes tags unavailable. Partly present or malformed fields fail the load so a
// broken value is never shown as "Untagged".
function parseRows(rows: RpcRow[]): { rows: CalendarDay[]; tagsAvailable: boolean } {
  let present = 0;
  let absent = 0;
  const parsed = rows.map(row => {
    const sessions = (Array.isArray(row.sessions) ? row.sessions : []) as Record<string, unknown>[];
    return {
      day: row.day,
      solo_seconds: Number(row.solo_seconds),
      duo_seconds: Number(row.duo_seconds),
      solo_rounds: Number(row.solo_rounds),
      duo_rounds: Number(row.duo_rounds),
      sessions: sessions.map(raw => {
        const read = readCalendarTag(raw);
        if (read.kind === "malformed") throw new Error("malformed private tag");
        if (read.kind === "absent") absent++; else present++;
        return {
          ...(raw as unknown as CalendarSession),
          private_tag: read.kind === "ok" ? read.tag : null,
          private_tag_version: read.kind === "ok" ? read.version : null,
        };
      }),
    };
  });
  if (present && absent) throw new Error("mixed private tag fields");
  return { rows: parsed, tagsAvailable: present > 0 || absent === 0 };
}

export function useFocusCalendar(userId: string, month: string) {
  const day = useLocalDay();
  const owner = `${userId}:${month}`;
  const [state, setState] = useState<State>({ owner, rows: [], loaded: false, error: null, timezone: null, tagsAvailable: false });
  const requests = useRef(0);
  // Every owner gets a separate lifetime, including callbacks retained by an old editor.
  const scope = useMemo(() => ({ owner }), [owner]);
  const activeScope = useRef<typeof scope | null>(null);

  // Declared before the load effect so the account is current before any response is recorded.
  useEffect(() => {
    activeScope.current = scope;
    retainFocusTagAccount(userId);
    return () => { if (activeScope.current === scope) activeScope.current = null; };
  }, [userId, scope]);

  // Resolves true only when this request succeeded and is still the latest.
  const load = useCallback(async (): Promise<boolean> => {
    if (!month || activeScope.current !== scope) return false;
    const request = ++requests.current;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    try {
      const { data, error } = await getSupabase().rpc("get_focus_calendar", { month_start: `${month}-01`, tz });
      if (activeScope.current !== scope || request !== requests.current) return false;
      if (error) throw error;
      const parsed = parseRows((data ?? []) as RpcRow[]);
      if (parsed.tagsAvailable) {
        // Recorded before the caller resolves, so a reload can read the confirmed tag immediately.
        rememberFocusTags(userId, parsed.rows.flatMap(row => row.sessions
          .filter(session => session.private_tag_version !== null)
          .map(session => ({ sessionId: session.id, tag: session.private_tag, version: session.private_tag_version as number }))));
      }
      setState({ owner, rows: parsed.rows, loaded: true, error: null, timezone: tz, tagsAvailable: parsed.tagsAvailable });
      return true;
    } catch {
      if (activeScope.current !== scope || request !== requests.current) return false;
      // A failed refresh keeps the last loaded rounds on screen, marked as stale.
      setState(previous => previous.owner === owner && previous.loaded
        ? { ...previous, error: REFRESH_ERROR, timezone: tz }
        : { owner, rows: [], loaded: false, error: LOAD_ERROR, timezone: tz, tagsAvailable: false });
      return false;
    }
  }, [month, owner, userId, scope]);

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

  return {
    ...(state.owner === owner ? state : { rows: [], loaded: false, error: null, timezone: null, tagsAvailable: false }),
    retry: load,
  };
}
