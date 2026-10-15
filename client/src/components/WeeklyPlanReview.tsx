"use client";
import { useEffect, useRef, useState } from "react";
import { useWeeklyPlan } from "@/hooks/useWeeklyPlan";
import { previousWeek, WEEKLY_GOAL_LIMIT, weekLabel, type WeeklyPlan } from "@/lib/weeklyPlan";
import type { Task } from "@/lib/types";

export default function WeeklyPlanReview({ userId, week, tasks, tasksLoaded, tasksError, current, currentBlocked, currentError, onCarry }: {
  userId: string; week: string; tasks: Task[]; tasksLoaded: boolean; tasksError: string | null;
  current: WeeklyPlan; currentBlocked: boolean; currentError: boolean;
  onCarry: (ids: string[]) => Promise<WeeklyPlan | undefined>;
}) {
  const lastWeek = previousWeek(week);
  const past = useWeeklyPlan(userId, lastWeek);
  const own = tasks.filter(task => task.owner_id === userId && task.room_code === null && !task.is_shared);
  const eligible = past.plan.ids.filter(id => own.some(task => task.id === id && !task.is_done) && !current.ids.includes(id));
  const capacity = Math.max(0, WEEKLY_GOAL_LIMIT - current.ids.length);
  const scope = `${past.plan.version}:${current.version}:${eligible.join(",")}`;
  const [choices, setChoices] = useState<{ scope: string; ids: string[] } | null>(null);
  const selected = choices?.scope === scope ? choices.ids : [];
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const mounted = useRef(true);
  const [notice, setNotice] = useState<{ error: boolean; text: string; version: number | null } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const unavailableCurrent = current.ids.some(id => !own.some(task => task.id === id));
  const blocked = currentBlocked || !past.loaded || !!past.error || !tasksLoaded || !!tasksError || busy || unavailableCurrent;

  const carry = async () => {
    if (blocked || sending.current || !selected.length || selected.length > capacity) return;
    sending.current = true; setBusy(true); setNotice(null);
    try {
      const confirmed = await onCarry([...current.ids, ...selected]);
      if (!mounted.current) return;
      if (confirmed) {
        setChoices(null);
        setNotice({ error: false, text: "Selected goals added to this week's plan.", version: confirmed.version });
      } else setNotice({ error: true, text: "Change not confirmed. Reload this week's plan to see what was saved.", version: current.version });
    } catch {
      if (mounted.current) setNotice({ error: true, text: "Change not confirmed. Reload this week's plan to see what was saved.", version: current.version });
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return <section aria-label="Private weekly plan review" className="space-y-3 rounded-lg border border-line p-3">
    <h3 className="text-sm font-bold text-ink">Last week&apos;s plan</h3>
    {lastWeek && <p className="text-xs text-muted">{weekLabel(lastWeek)} · Monday–Sunday</p>}
    <p className="text-xs text-muted">Private to you. {tasksError ? "Showing last loaded goal statuses." : "Statuses reflect your goals now."} Choose unfinished goals to bring into this week.</p>
    {!past.loaded && !past.error && <p role="status" className="text-sm text-muted">Loading last week&apos;s plan…</p>}
    {past.error && <div role="alert" className="text-sm text-danger">Last week&apos;s plan couldn&apos;t be confirmed.
      <button onClick={() => void past.reload()} className="min-h-11 px-2 font-bold text-accent">Reload last week</button></div>}
    {currentError && <p role="alert" className="text-xs text-danger">Reload this week&apos;s plan above before carrying goals.</p>}
    {tasksError && <p role="alert" className="text-xs text-danger">Goal statuses couldn&apos;t be confirmed. Choices are paused until your goals load successfully.</p>}
    {past.loaded && !tasksLoaded && !tasksError && <p role="status" className="text-xs text-muted">Loading your personal goals…</p>}
    {past.loaded && tasksLoaded && <>
      {past.plan.ids.length === 0 && !past.error && <p className="text-sm text-muted">No goals saved in last week&apos;s plan.</p>}
      <ul aria-label="Last week's planned goals" className="space-y-2">
        {past.plan.ids.map(id => {
          const task = own.find(goal => goal.id === id);
          const canChoose = eligible.includes(id);
          const checked = selected.includes(id);
          return <li key={id} className="space-y-1 rounded-lg border border-line px-3 py-2">
            {canChoose ? <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
              <input type="checkbox" checked={checked} disabled={blocked || (!checked && selected.length >= capacity)}
                onChange={() => { setChoices({ scope, ids: checked ? selected.filter(value => value !== id) : [...selected, id] }); setNotice(null); }}
                className="h-5 w-5 shrink-0 accent-accent" />
              <span className="min-w-0 break-words">{task!.content}</span>
            </label> : <p className="break-words text-sm text-ink">{task?.content ?? "Goal no longer available"}</p>}
            <p className="text-xs text-muted">{!task ? "Unavailable" : task.is_done ? (tasksError ? "Complete · last loaded" : "Complete now") : current.ids.includes(id) ? "Already in this week's plan" : tasksError ? "Unfinished · last loaded" : "Unfinished"}</p>
          </li>;
        })}
      </ul>
      {past.plan.ids.length > 0 && <>
        <p className="text-xs text-muted">{capacity} {capacity === 1 ? "place" : "places"} available in this week&apos;s plan.</p>
        {unavailableCurrent && <p className="text-xs text-muted">Remove unavailable goals from this week&apos;s plan before adding more.</p>}
        {capacity === 0 && <p className="text-xs text-muted">This week&apos;s three places are filled. Remove a goal above to make room.</p>}
        <button disabled={blocked || selected.length === 0 || selected.length > capacity} onClick={() => void carry()}
          className="min-h-11 rounded-lg border border-line px-3 text-sm font-bold text-accent disabled:opacity-50">Add selected goals to this week</button>
        <p className="text-xs text-muted">Keeps the same personal goals and leaves last week&apos;s plan as saved.</p>
      </>}
    </>}
    {busy && <p role="status" className="text-xs text-muted">Confirming your weekly plan…</p>}
    {notice && notice.version === current.version && <p role={notice.error ? "alert" : "status"} className={`text-xs ${notice.error ? "text-danger" : "text-go"}`}>{notice.text}</p>}
  </section>;
}
