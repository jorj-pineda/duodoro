import { readFocusDate, type FocusDate } from "./focusDates";
import { SITE_NAME, SITE_URL } from "./site";

export const CALENDAR_LENGTHS = [25, 50, 60] as const;
export type CalendarFile = { content: string; filename: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const utc = (value: number) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const text = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");

// RFC 5545 section 3.1: CRLF lines, at most 75 UTF-8 octets including
// continuation whitespace, without splitting a multi-byte character.
function fold(line: string): string {
  const encoder = new TextEncoder();
  let result = "", length = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (length + bytes > 75) { result += "\r\n "; length = 1; }
    result += character; length += bytes;
  }
  return result;
}

export function buildFocusDateCalendar(date: FocusDate, userId: string, minutes: number, now: number): CalendarFile | null {
  const row = readFocusDate(date, userId);
  const start = row ? Date.parse(row.starts_at) : NaN;
  const end = start + minutes * 60_000;
  const validYear = (value: number) => { const year = new Date(value).getUTCFullYear(); return year >= 1 && year <= 9999; };
  if (!row || row.status !== "accepted" || !UUID.test(row.id) || !Number.isFinite(now) || start <= now
    || !CALENDAR_LENGTHS.some(value => value === minutes) || !Number.isFinite(end)
    || !validYear(now) || !validYear(start) || !validYear(end)) return null;
  const description = [
    `A time to focus together on ${SITE_NAME}.`,
    "Calendar copy only; check Duodoro for the latest date status before starting.",
    "If the date is cancelled or replaced in Duodoro, delete or update this calendar event yourself.",
    `Calendar block: ${minutes} minutes. This does not change your focus timer.`,
  ].join("\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${SITE_NAME}//Focus dates//EN`, "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT", `UID:focus-date-${row.id.toLowerCase()}@${new URL(SITE_URL).hostname}`,
    `DTSTAMP:${utc(now)}`, `DTSTART:${utc(start)}`, `DTEND:${utc(end)}`,
    `SUMMARY:${text(`Focus together · ${SITE_NAME}`)}`, `DESCRIPTION:${text(description)}`,
    `URL:${SITE_URL}`, "CLASS:PRIVATE", "STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT", "END:VCALENDAR"];
  return { content: lines.map(fold).join("\r\n") + "\r\n", filename: `duodoro-focus-${utc(start).slice(0, 8)}.ics` };
}

// Called only by a browser click handler. No DOM or object URLs at module load.
export function downloadCalendarFile(file: CalendarFile): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: "text/calendar;charset=utf-8" }));
  const anchor = document.createElement("a");
  try {
    anchor.href = url; anchor.download = file.filename; anchor.hidden = true;
    document.body.append(anchor); anchor.click();
  } catch (error) {
    URL.revokeObjectURL(url); throw error;
  } finally { anchor.remove(); }
  // Give the browser time to consume the blob, then release it even if the
  // card is unmounted. This timer only cleans up the downloaded resource.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
