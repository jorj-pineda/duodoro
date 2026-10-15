import type { Database } from "./database.types";
export type FocusDate = Database["public"]["Tables"]["focus_dates"]["Row"];
export type DateResponse = "accepted" | "declined" | "cancelled";

export function readFocusDate(value: unknown, userId: string): FocusDate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as FocusDate;
  return typeof row.id === "string" && typeof row.proposer_id === "string" && typeof row.recipient_id === "string"
    && row.proposer_id !== row.recipient_id && [row.proposer_id, row.recipient_id].includes(userId)
    && ["pending", "accepted", "declined", "cancelled"].includes(row.status)
    && Number.isSafeInteger(row.version) && row.version > 0
    && typeof row.starts_at === "string" && Number.isFinite(Date.parse(row.starts_at))
    && typeof row.created_at === "string" && Number.isFinite(Date.parse(row.created_at)) ? row : null;
}

// datetime-local has no timezone. Reject calendar rollovers and missing DST hours
// rather than silently proposing a different wall time. Ambiguous fall-back hours
// use the browser's first occurrence; the preview includes its timezone/offset.
export function parseFocusDateTime(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value);
  const [year, month, day, hour, minute] = value.split(/[-T:]/).map(Number);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== year || date.getMonth() + 1 !== month
    || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) return null;
  return date.toISOString();
}

export function formatFocusDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "long" }).format(new Date(value));
}
