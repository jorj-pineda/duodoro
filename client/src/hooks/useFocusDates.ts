"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { readFocusDate, type DateResponse, type FocusDate } from "@/lib/focusDates";

type State = { scope: object; dates: FocusDate[] | null; loadError: string | null; actionError: string | null };
export function useFocusDates(userId: string) {
  const scope = useMemo(() => ({ userId }), [userId]);
  const active = useRef<object | null>(null);
  const sequence = useRef(0);
  const mutation = useRef<object | null>(null);
  const blocked = useRef(false);
  const [state, setState] = useState<State>({ scope, dates: null, loadError: null, actionError: null });
  const [busyScope, setBusyScope] = useState<object | null>(null);
  const current = state.scope === scope ? state : { scope, dates: null, loadError: null, actionError: null };
  useEffect(() => {
    const requests = sequence;
    active.current = scope; mutation.current = null; blocked.current = false;
    return () => { if (active.current === scope) active.current = null; ++requests.current; };
  }, [scope]);
  const refresh = useCallback(async (explicit = false) => {
    if (active.current !== scope || mutation.current || (blocked.current && !explicit)) return;
    const request = ++sequence.current;
    try {
      const { data, error } = await getSupabase().from("focus_dates").select("*")
        .or(`proposer_id.eq.${userId},recipient_id.eq.${userId}`).in("status", ["pending", "accepted"])
        .gt("starts_at", new Date().toISOString()).order("starts_at").order("id").limit(11);
      if (active.current !== scope || sequence.current !== request || mutation.current) return;
      const dates = data?.map(row => readFocusDate(row, userId));
      if (error || !dates || dates.length > 10 || dates.some(row => !row)) throw new Error("read failed");
      blocked.current = false;
      setState({ scope, dates: dates as FocusDate[], loadError: null, actionError: null });
    } catch {
      if (active.current !== scope || sequence.current !== request || mutation.current) return;
      setState(previous => ({ scope, dates: previous.scope === scope ? previous.dates : null,
        actionError: previous.scope === scope ? previous.actionError : null,
        loadError: "Couldn't load focus dates. Reload to try again." }));
    }
  }, [scope, userId]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void refresh(); });
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(visible, 30_000);
    window.addEventListener("focus", visible); window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener("focus", visible);
      window.removeEventListener("online", visible); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);

  async function write(run: () => PromiseLike<{ data: FocusDate[] | null; error: { code?: string } | null }>,
    confirm: (date: FocusDate) => boolean) {
    if (active.current !== scope || mutation.current || blocked.current || !current.dates || current.loadError) return false;
    const operation = {}; mutation.current = operation; ++sequence.current; setBusyScope(scope);
    const same = () => active.current === scope && mutation.current === operation;
    try {
      const { data, error } = await run();
      if (!same()) return false;
      const date = data?.length === 1 ? readFocusDate(data[0], userId) : null;
      if (error || !date || !confirm(date)) {
        blocked.current = true;
        const message = error?.code === "PT409" ? "This focus date changed elsewhere. Reload before trying again."
          : error?.code === "PT429" ? "A date limit was reached (10 upcoming per person, 20 proposals per day). Reload before trying again."
          : error?.code === "P0002" ? "This friend or date is unavailable. Reload before trying again."
          : error?.code === "22023" ? "Choose a future time within 90 days. Reload before trying again."
          : "Couldn't confirm this change. Reload to see what was saved.";
        setState(previous => ({ ...previous, actionError: message }));
        return false;
      }
      setState(previous => ({ scope, dates: [...(previous.scope === scope ? previous.dates ?? [] : []).filter(row => row.id !== date.id),
        ...(["pending", "accepted"].includes(date.status) && Date.parse(date.starts_at) > Date.now() ? [date] : [])]
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id)), loadError: null, actionError: null }));
      return true;
    } catch {
      if (same()) { blocked.current = true; setState(previous => ({ ...previous, actionError: "Couldn't confirm this change. Reload to see what was saved." })); }
      return false;
    } finally { if (same()) { mutation.current = null; setBusyScope(null); } }
  }
  const propose = (id: string, recipient: string, startsAt: string) => write(
    () => getSupabase().rpc("propose_focus_date", { p_id: id, p_recipient_id: recipient, p_starts_at: startsAt }),
    row => row.id === id && row.proposer_id === userId && row.recipient_id === recipient && Date.parse(row.starts_at) === Date.parse(startsAt));
  const respond = (date: FocusDate, status: DateResponse) => write(
    () => getSupabase().rpc("respond_focus_date", { p_id: date.id, p_expected_version: date.version, p_status: status }),
    row => row.id === date.id && row.proposer_id === date.proposer_id && row.recipient_id === date.recipient_id
      && row.starts_at === date.starts_at && row.status === status && row.version === date.version + 1);
  return { ...current, busy: busyScope === scope, disabled: busyScope === scope || !!current.loadError || !!current.actionError || !current.dates,
    reload: () => refresh(true), propose, respond };
}
