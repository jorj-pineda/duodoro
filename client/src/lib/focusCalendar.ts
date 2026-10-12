import { matchesTagFilter, type FocusTagId, type TagFilter } from "./focusTags";

export type CalendarFilter = "all" | "solo" | "duo";
export interface CalendarSession {
  id: string;
  focus_seconds: number;
  world: string;
  ended_at: string;
  is_duo: boolean;
  partner_name: string;
  // The caller's own private tag and revision. Never a partner's metadata.
  private_tag: FocusTagId | null;
  private_tag_version: number | null;
}
export interface CalendarDay { day: string; solo_seconds: number; duo_seconds: number; solo_rounds: number; duo_rounds: number; sessions: CalendarSession[] }

export function monthDays(month: string): (string | null)[] {
  const [year, number] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const result: (string | null)[] = Array(offset).fill(null);
  for (let day = 1; day <= count; day++) result.push(`${month}-${String(day).padStart(2, "0")}`);
  while (result.length % 7) result.push(null);
  return result;
}
export function shiftMonth(month: string, offset: number): string {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}
export function dayTotals(row: CalendarDay | undefined, filter: CalendarFilter) {
  return {
    seconds: (filter !== "duo" ? row?.solo_seconds ?? 0 : 0) + (filter !== "solo" ? row?.duo_seconds ?? 0 : 0),
    rounds: (filter !== "duo" ? row?.solo_rounds ?? 0 : 0) + (filter !== "solo" ? row?.duo_rounds ?? 0 : 0),
  };
}

// One predicate drives totals, day cells, details, empty states and show-more
// counts, so every figure describes the same set of rounds.
export function sessionMatches(session: CalendarSession, typeFilter: CalendarFilter, tagFilter: TagFilter): boolean {
  return (typeFilter === "all" || session.is_duo === (typeFilter === "duo"))
    && matchesTagFilter(session.private_tag, tagFilter);
}

// With no tag filter the server's day aggregates stay authoritative. With a tag
// filter, totals come from the complete month's sessions for that day.
export function filteredDayTotals(row: CalendarDay | undefined, typeFilter: CalendarFilter, tagFilter: TagFilter) {
  if (tagFilter === "all") return dayTotals(row, typeFilter);
  const matching = (row?.sessions ?? []).filter(session => sessionMatches(session, typeFilter, tagFilter));
  return { seconds: matching.reduce((sum, session) => sum + session.focus_seconds, 0), rounds: matching.length };
}

export function focusLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
