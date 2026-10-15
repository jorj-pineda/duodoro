"use client";
import { useState } from "react";
import { useLocalDay } from "@/hooks/useDailyFocusGoal";
import { useWeeklyPlan } from "@/hooks/useWeeklyPlan";
import { WEEKLY_GOAL_LIMIT, weekLabel, weekStart } from "@/lib/weeklyPlan";
import type { Task } from "@/lib/types";
import WeeklyPlanReview from "./WeeklyPlanReview";

type Props = { userId: string; tasks: Task[]; tasksLoaded: boolean; tasksError: string | null;
  onFocusGoal?: (task: Task) => void; focusDisabled?: boolean };

export default function WeeklyFocusPlan(props: Props) {
  const week = weekStart(useLocalDay());
  return <Plan key={`${props.userId}:${week}`} {...props} week={week} />;
}

function Plan({ userId, week, tasks, tasksLoaded, tasksError, onFocusGoal, focusDisabled }: Props & { week: string }) {
  const { plan, loaded, saving, error, reload, save } = useWeeklyPlan(userId, week);
  const [choice, setChoice] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const own = tasks.filter(task => task.owner_id === userId && task.room_code === null && !task.is_shared);
  const planned = plan.ids.map(id => own.find(task => task.id === id));
  const done = planned.filter(task => task?.is_done).length;
  const choices = own.filter(task => !task.is_done && !plan.ids.includes(task.id));
  const blocked = !loaded || saving || !!error || !tasksLoaded || !!tasksError;
  const validIds = () => plan.ids.filter(id => own.some(task => task.id === id));
  const add = async () => {
    if (blocked || plan.ids.length >= WEEKLY_GOAL_LIMIT || !choices.some(task => task.id === choice)) return;
    await save([...validIds(), choice]);
  };

  return <section aria-label="Private weekly focus plan" className="space-y-3 rounded-xl border border-line bg-surface p-4">
    <h2 className="font-display text-lg text-ink">This week&apos;s focus</h2>
    <p className="text-xs text-muted">Choose up to three personal goals. Your plan is private and saved to your account. Focus opens a draft; Save intention shares its text in the room.</p>
    {week && <p className="text-xs font-bold text-muted">{weekLabel(week)} · Monday–Sunday</p>}
    {!loaded && !error && <p role="status" className="text-sm text-muted">Loading your weekly plan…</p>}
    {error && <div role="alert" className="text-sm text-muted">{error}
      <button disabled={saving} onClick={() => void reload()} className="min-h-11 px-2 font-bold text-accent">Reload plan</button>
    </div>}
    {loaded && !tasksLoaded && !tasksError && <p role="status" className="text-sm text-muted">Loading your personal goals…</p>}
    {tasksError && <p role="alert" className="text-sm text-muted">Goals couldn&apos;t be confirmed. Your saved plan is kept; plan changes are paused until goals load successfully.</p>}
    {loaded && tasksLoaded && <>
      <p role="status" className="text-sm text-muted">{done} of {plan.ids.length} planned goals complete{error || tasksError ? " · last loaded goals" : ""}</p>
      {plan.ids.length === 0 && !error && !tasksError && <p className="text-sm text-muted">Choose a small starting point for this week. Add personal goals below if you need one.</p>}
      <ul className="space-y-2" aria-label="This week's planned goals">
        {plan.ids.map((id, index) => {
          const task = planned[index];
          return <li key={id} className="rounded-lg border border-line p-3 space-y-2">
            <p className={`break-words text-sm text-ink ${task?.is_done ? "line-through" : ""}`}>{task?.content ?? "Goal no longer available"}</p>
            {task?.is_done && <p className="text-xs font-bold text-go">Complete</p>}
            <div className="flex flex-wrap gap-2">
              {task && !task.is_done && onFocusGoal && <button disabled={blocked || focusDisabled} onClick={() => onFocusGoal(task)}
                className="min-h-11 rounded-lg border border-line px-3 text-xs font-bold text-accent disabled:opacity-50">Focus on this</button>}
              <button disabled={blocked} onClick={() => void save(validIds().filter(value => value !== id))}
                aria-label={`Remove ${task?.content ?? "unavailable goal"} from weekly plan`}
                className="min-h-11 rounded-lg border border-line px-3 text-xs text-muted disabled:opacity-50">Remove from week</button>
            </div>
          </li>;
        })}
      </ul>
      <label className="block text-xs text-muted">Personal goal for this week
        <select value={choices.some(task => task.id === choice) ? choice : ""} disabled={blocked || plan.ids.length >= WEEKLY_GOAL_LIMIT}
          onChange={event => setChoice(event.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-2 text-sm text-ink">
          <option value="">Choose a goal</option>{choices.map(task => <option key={task.id} value={task.id}>{task.content}</option>)}
        </select>
      </label>
      <button disabled={blocked || !choices.some(task => task.id === choice) || plan.ids.length >= WEEKLY_GOAL_LIMIT} onClick={() => void add()}
        className="min-h-11 rounded-lg border border-line px-3 text-sm font-bold text-accent disabled:opacity-50">Add to this week</button>
      {plan.ids.length >= WEEKLY_GOAL_LIMIT && <p className="text-xs text-muted">Three goals selected. Remove one to make room for another.</p>}
    </>}
    {saving && <p role="status" className="text-xs text-muted">Saving your plan…</p>}
    <p className="text-xs text-muted">A new week starts with an empty plan. Removing a goal from the week keeps the original personal goal.</p>
    {week && <div className="border-t border-line pt-3 space-y-3">
      <button aria-expanded={reviewOpen} onClick={() => setReviewOpen(open => !open)} className="min-h-11 px-2 text-sm font-bold text-accent">
        {reviewOpen ? "Close weekly review" : "Review last week"}
      </button>
      {reviewOpen && <WeeklyPlanReview userId={userId} week={week} tasks={tasks} tasksLoaded={tasksLoaded} tasksError={tasksError}
        current={plan} currentBlocked={!loaded || saving || !!error} currentError={!!error} onCarry={save} />}
    </div>}
  </section>;
}
