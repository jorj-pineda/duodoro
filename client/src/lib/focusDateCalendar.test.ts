import { afterEach, expect, it, vi } from "vitest";
import { buildFocusDateCalendar, downloadCalendarFile } from "./focusDateCalendar";
import { SITE_URL } from "./site";
import type { FocusDate } from "./focusDates";
const row: FocusDate = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", proposer_id: "account-a", recipient_id: "account-b",
  version: 2, status: "accepted", starts_at: "2026-11-01T01:30:00-05:00", created_at: "2026-10-15T10:00:00Z" };
const now = Date.parse("2026-10-15T11:23:45.678Z");
const unfold = (content: string) => content.replace(/\r\n[ \t]/g, "");
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("exports one UTC event at the agreed instant with a chosen calendar-only duration", () => {
  const file = buildFocusDateCalendar(row, "account-a", 60, now)!;
  const content = unfold(file.content);
  expect(content).toContain("DTSTAMP:20261015T112345Z\r\n");
  expect(content).toContain("DTSTART:20261101T063000Z\r\n");
  expect(content).toContain("DTEND:20261101T073000Z\r\n");
  expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(1); expect(content.match(/END:VEVENT/g)).toHaveLength(1);
  expect(content).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2.0\r\n/); expect(content).toMatch(/END:VCALENDAR\r\n$/);
  expect(content).toContain("CLASS:PRIVATE\r\nSTATUS:CONFIRMED\r\n");
  expect(content).toContain(`URL:${SITE_URL}\r\n`);
  expect(file.filename).toBe("duodoro-focus-20261101.ics");
  expect(row.starts_at).toBe("2026-11-01T01:30:00-05:00"); expect(row.version).toBe(2);
});
it("keeps the same event identity across participants, repeat exports and calendar lengths", () => {
  const uid = (user: string, minutes: number, stamp: number) => unfold(buildFocusDateCalendar(row, user, minutes, stamp)!.content).match(/^UID:(.+)$/m)![1];
  expect(uid("account-a", 25, now)).toBe(uid("account-b", 50, now + 1000));
  expect(uid("account-a", 25, now)).toMatch(/^focus-date-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa@duodoro.live/);
});
it("uses CRLF, escaped TEXT and 75-octet content lines without exporting identities or invitations", () => {
  const file = buildFocusDateCalendar(row, "account-b", 25, now)!;
  for (const line of file.content.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  expect(file.content.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  const content = unfold(file.content);
  expect(content).toContain("SUMMARY:Focus together · Duodoro\r\n");
  expect(content).toContain("copy only\\; check"); expect(content).toContain("Duodoro\\, delete"); expect(content).toContain("\\nCalendar block: 25 minutes.");
  expect(content).toContain("delete or update this calendar event yourself");
  for (const secret of [row.proposer_id, row.recipient_id, "ATTENDEE", "ORGANIZER", "METHOD:", "VALARM", "/join/", "mailto:", "TZID", "DTSTART;VALUE=DATE"]) expect(content).not.toContain(secret);
});
it("rejects unaccepted, expired, foreign or malformed data and unsupported calendar lengths", () => {
  for (const change of [{ status: "pending" }, { status: "declined" }, { status: "cancelled" }, { starts_at: new Date(now).toISOString() },
    { starts_at: "invalid" }, { id: "bad\r\nATTENDEE:injected" }, { version: NaN }, { starts_at: "+275760-09-13T00:00:00.000Z" }]) {
    expect(buildFocusDateCalendar({ ...row, ...change }, "account-a", 25, now)).toBeNull();
  }
  expect(buildFocusDateCalendar(row, "outsider", 25, now)).toBeNull();
  for (const length of [0,-1,24,25.5,NaN,Infinity]) expect(buildFocusDateCalendar(row, "account-a", length, now)).toBeNull();
  for (const stamp of [NaN,Infinity,-1e20]) expect(buildFocusDateCalendar(row, "account-a", 25, stamp)).toBeNull();
});
it("downloads a UTF-8 calendar blob and releases its object URL after the browser consumes it", async () => {
  vi.useFakeTimers();
  const file = buildFocusDateCalendar(row, "account-a", 50, now)!;
  const create = vi.fn().mockReturnValue("blob:calendar"), revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe(file.filename); expect(this.href).toBe("blob:calendar"); expect(this.isConnected).toBe(true);
  });
  downloadCalendarFile(file);
  expect(click).toHaveBeenCalledOnce(); expect(create.mock.calls[0][0].type).toBe("text/calendar;charset=utf-8");
  expect(document.querySelector('a[download]')).toBeNull(); expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(30_000); expect(revoke).toHaveBeenCalledWith("blob:calendar");
});
it("cleans up the anchor and blob if the browser cannot start the download", () => {
  const revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn().mockReturnValue("blob:failed"), revokeObjectURL: revoke }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw new Error("blocked"); });
  expect(() => downloadCalendarFile({ content: "calendar", filename: "focus.ics" })).toThrow("blocked");
  expect(revoke).toHaveBeenCalledWith("blob:failed"); expect(document.querySelector('a[download]')).toBeNull();
});
