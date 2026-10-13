"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { readWeeklyPlan, type WeeklyPlan } from "@/lib/weeklyPlan";

type State = { scope: object; plan: WeeklyPlan; loaded: boolean; error: string | null };
const EMPTY: WeeklyPlan = { ids: [], version: null };

export function useWeeklyPlan(userId: string, week: string) {
  const scope = useMemo(() => ({ userId, week }), [userId, week]);
  const active = useRef<typeof scope | null>(null);
  const requests = useRef(0);
  const mutation = useRef<object | null>(null);
  const [state, setState] = useState<State>({ scope, plan: EMPTY, loaded: false, error: null });
  const [savingScope, setSavingScope] = useState<object | null>(null);
  const current = state.scope === scope ? state : { scope, plan: EMPTY, loaded: false, error: null };

  useEffect(() => {
    const sequence = requests;
    active.current = scope;
    mutation.current = null;
    return () => { if (active.current === scope) active.current = null; ++sequence.current; };
  }, [scope]);

  const load = useCallback(async () => {
    if (!week || active.current !== scope || mutation.current) return;
    const request = ++requests.current;
    try {
      const { data, error } = await getSupabase().from("weekly_focus_plans")
        .select("user_id, week_start, task_ids, version").eq("user_id", userId).eq("week_start", week).maybeSingle();
      if (active.current !== scope || requests.current !== request || mutation.current) return;
      const plan = data ? readWeeklyPlan(data, userId, week) : EMPTY;
      if (error || !plan) throw new Error("read failed");
      setState({ scope, plan, loaded: true, error: null });
    } catch {
      if (active.current !== scope || requests.current !== request || mutation.current) return;
      setState(previous => ({ scope, plan: previous.scope === scope ? previous.plan : EMPTY,
        loaded: previous.scope === scope && previous.loaded, error: "Couldn't load your weekly plan. Reload to try again." }));
    }
  }, [scope, userId, week]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load(); });
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { cancelled = true; window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);

  const save = async (ids: string[]) => {
    if (active.current !== scope || mutation.current || !current.loaded || current.error || !week) return;
    const operation = {};
    mutation.current = operation;
    ++requests.current; // invalidate reads that began before this write
    setSavingScope(scope);
    const same = () => active.current === scope && mutation.current === operation;
    try {
      const { data, error } = await getSupabase().rpc("set_weekly_focus_plan", {
        p_week_start: week, p_task_ids: ids, p_expected_version: current.plan.version as number,
      });
      if (!same()) return;
      const plan = data?.length === 1 ? readWeeklyPlan(data[0], userId, week) : null;
      if (error || !plan || plan.ids.join(",") !== ids.join(",") || (plan.version ?? 0) <= (current.plan.version ?? 0)) {
        setState({ ...current, error: error?.code === "PT409"
          ? "Your plan changed elsewhere. Reload before making another change."
          : "Couldn't confirm this plan change. Reload to see what was saved." });
      } else setState({ scope, plan, loaded: true, error: null });
    } catch {
      if (same()) setState({ ...current, error: "Couldn't confirm this plan change. Reload to see what was saved." });
    } finally {
      if (same()) { mutation.current = null; setSavingScope(null); }
    }
  };
  return { ...current, saving: savingScope === scope, reload: load, save };
}
