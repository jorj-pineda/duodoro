import { expect, it } from "vitest";
import { reflectionRangeMonths } from "./reflectionRange";
it("enumerates only the months intersecting inclusive dates, including leap years and year boundaries", () => {
  expect(reflectionRangeMonths({ from:"2026-12-31",to:"2027-01-01" })).toEqual(["2026-12","2027-01"]);
  expect(reflectionRangeMonths({ from:"2024-02-29",to:"2024-02-29" })).toEqual(["2024-02"]);
  expect(reflectionRangeMonths({ from:"2026-01-31",to:"2027-01-31" })).toHaveLength(13);
});
it("rejects invalid, reversed, overlong and year-zero ranges", () => {
  for (const [from,to] of [["2026-02-29","2026-03-01"],["2026-01-02","2026-01-01"],["2024-01-01","2026-01-01"],["0000-01-01","0000-02-01"],["","2026-01-01"]]) expect(reflectionRangeMonths({ from,to })).toBeNull();
});
