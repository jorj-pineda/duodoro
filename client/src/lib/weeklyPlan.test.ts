import { expect, it } from "vitest";
import { readWeeklyPlan, weekStart, weekLabel, previousWeek } from "./weeklyPlan";

it("finds the preceding civil week without DST or year-boundary shifts", () => {
  expect(previousWeek("2026-01-05")).toBe("2025-12-29");
  expect(previousWeek("2026-03-09")).toBe("2026-03-02");
  expect(previousWeek("2026-11-02")).toBe("2026-10-26");
  for (const value of ["", "2026-02-30", "2026-10-13"]) expect(previousWeek(value)).toBe("");
});

it("uses local civil Mondays across Sunday, year and DST boundaries", () => {
  expect(weekStart("2026-10-18")).toBe("2026-10-12");
  expect(weekStart("2026-10-19")).toBe("2026-10-19");
  expect(weekStart("2026-01-01")).toBe("2025-12-29");
  expect(weekStart("2026-03-08")).toBe("2026-03-02");
  expect(weekStart("2026-03-09")).toBe("2026-03-09");
  expect(weekLabel("2025-12-29")).toBe("Dec 29–Jan 4");
  for (const day of ["", "nonsense", "2026-02-30"]) expect(weekStart(day)).toBe("");
});
it("accepts only coherent account/week rows and safe non-reused revisions", () => {
  const row = { user_id: "owner", week_start: "2026-10-12", task_ids: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"], version: 1 };
  expect(readWeeklyPlan(row, "owner", "2026-10-12")).toEqual({ ids: row.task_ids, version: 1 });
  for (const change of [{ user_id: "partner" }, { week_start: "2026-10-19" }, { version: 0 }, { version: Number.MAX_SAFE_INTEGER + 1 },
    { task_ids: [null] }, { task_ids: ["bad"] }, { task_ids: [...row.task_ids, ...row.task_ids] }]) {
    expect(readWeeklyPlan({ ...row, ...change }, "owner", "2026-10-12")).toBeNull();
  }
});
