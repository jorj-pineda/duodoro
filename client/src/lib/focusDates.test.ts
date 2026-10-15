import { afterEach, expect, it } from "vitest";
import { formatFocusDateTime, parseFocusDateTime, readFocusDate } from "./focusDates";
const prior = process.env.TZ;
afterEach(() => { process.env.TZ = prior; });
it("rejects missing DST hours and calendar rollovers and preserves local time", () => {
  process.env.TZ = "America/Chicago";
  expect(parseFocusDateTime("2027-03-14T02:30")).toBeNull();
  expect(parseFocusDateTime("2027-02-30T12:00")).toBeNull();
  expect(parseFocusDateTime("invalid")).toBeNull();
  expect(parseFocusDateTime("2027-03-14T03:30")).toBe("2027-03-14T08:30:00.000Z");
  expect(parseFocusDateTime("2026-11-01T01:30")).toBe("2026-11-01T06:30:00.000Z");
  expect(formatFocusDateTime("2026-11-01T06:30:00.000Z")).toContain("CDT");
});
it("formats the same instant in each viewer's timezone", () => {
  process.env.TZ = "Asia/Tokyo";
  expect(formatFocusDateTime("2026-10-20T15:30:00Z")).toContain("12:30:00 AM");
  process.env.TZ = "America/Chicago";
  expect(formatFocusDateTime("2026-10-20T15:30:00Z")).toContain("10:30:00 AM");
});
it("rejects foreign rows, malformed states and unsafe revisions", () => {
  const row = { id: "date", proposer_id: "a", recipient_id: "b", status: "pending", version: 1,
    starts_at: "2026-10-20T15:30:00Z", created_at: "2026-10-10T15:30:00Z" };
  expect(readFocusDate(row, "a")).toEqual(row); expect(readFocusDate(row, "b")).toEqual(row);
  expect(readFocusDate(row, "c")).toBeNull();
  for (const change of [{ status: "done" }, { version: 0 }, { version: 2 ** 53 }, { starts_at: "bad" }, { recipient_id: "a" }]) {
    expect(readFocusDate({ ...row, ...change }, "a")).toBeNull();
  }
});
