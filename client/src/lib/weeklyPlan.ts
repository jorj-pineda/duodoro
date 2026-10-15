export const WEEKLY_GOAL_LIMIT = 3;
export type WeeklyPlan = { ids: string[]; version: number | null };

/** Local civil date in, Monday civil date out; no UTC/local timezone conversion. */
export function weekStart(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return "";
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function previousWeek(start: string): string {
  if (!start || weekStart(start) !== start) return "";
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}

export function weekLabel(start: string): string {
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const format = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${format.format(new Date(`${start}T00:00:00Z`))}–${format.format(end)}`;
}

export function readWeeklyPlan(row: unknown, userId: string, week: string): WeeklyPlan | null {
  if (!row || typeof row !== "object") return null;
  const value = row as Record<string, unknown>;
  const ids = value.task_ids;
  if (value.user_id !== userId || value.week_start !== week || !Array.isArray(ids) || ids.length > WEEKLY_GOAL_LIMIT
    || ids.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    || new Set(ids).size !== ids.length || typeof value.version !== "number" || !Number.isSafeInteger(value.version) || value.version < 1) return null;
  return { ids, version: value.version };
}
