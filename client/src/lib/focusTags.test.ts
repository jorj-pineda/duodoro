import { describe, expect, it } from "vitest";
import {
  FOCUS_TAGS, focusTagLabel, isFocusTagId, isRevision, isTagFilter, matchesTagFilter,
  readCalendarTag, readConfirmedFocusTag, TAG_FILTER_OPTIONS,
} from "./focusTags";
import { filteredDayTotals, sessionMatches, type CalendarDay, type CalendarSession } from "./focusCalendar";

describe("preset tags", () => {
  it("defines exactly the six preset identifiers with their labels", () => {
    expect(FOCUS_TAGS.map(tag => [tag.id, tag.label])).toEqual([
      ["work", "Work"], ["study", "Study"], ["creative", "Creative"],
      ["reading", "Reading"], ["planning", "Planning"], ["other", "Other"],
    ]);
    for (const tag of FOCUS_TAGS) {
      expect(isFocusTagId(tag.id)).toBe(true);
      expect(focusTagLabel(tag.id)).toBe(tag.label);
    }
  });

  it("rejects No tag as an identifier, and rejects malformed or unknown values", () => {
    for (const value of ["Work", " work", "work ", "", "coding", "__proto__", "constructor", "toString", null, undefined, 1, {}]) {
      expect(isFocusTagId(value)).toBe(false);
    }
  });

  it("offers All, Untagged and each preset as filter options", () => {
    expect(TAG_FILTER_OPTIONS.map(option => option.value)).toEqual(["all", "untagged", "work", "study", "creative", "reading", "planning", "other"]);
    expect(isTagFilter("untagged")).toBe(true);
    expect(isTagFilter("nope")).toBe(false);
  });
});

describe("tag filters", () => {
  it("All matches everything, Untagged matches only null, and an exact tag matches only itself", () => {
    expect(matchesTagFilter(null, "all")).toBe(true);
    expect(matchesTagFilter("study", "all")).toBe(true);
    expect(matchesTagFilter(null, "untagged")).toBe(true);
    expect(matchesTagFilter("study", "untagged")).toBe(false);
    expect(matchesTagFilter("study", "study")).toBe(true);
    expect(matchesTagFilter("work", "study")).toBe(false);
    expect(matchesTagFilter(null, "study")).toBe(false);
  });
});

describe("calendar tag reads", () => {
  it("normalizes every preset, cleared rounds and never-tagged rounds", () => {
    for (const tag of FOCUS_TAGS) {
      expect(readCalendarTag({ private_tag: tag.id, private_tag_version: 7 })).toEqual({ kind: "ok", tag: tag.id, version: 7 });
    }
    expect(readCalendarTag({ private_tag: null, private_tag_version: 9 })).toEqual({ kind: "ok", tag: null, version: 9 });
    expect(readCalendarTag({ private_tag: null, private_tag_version: null })).toEqual({ kind: "ok", tag: null, version: null });
  });

  it("treats absent fields as an older API and rejects malformed values instead of calling them untagged", () => {
    expect(readCalendarTag({ id: "x" })).toEqual({ kind: "absent" });
    expect(readCalendarTag({ private_tag: "work" })).toEqual({ kind: "malformed" });
    expect(readCalendarTag({ private_tag: "coding", private_tag_version: 1 })).toEqual({ kind: "malformed" });
    expect(readCalendarTag({ private_tag: "Work", private_tag_version: 1 })).toEqual({ kind: "malformed" });
    expect(readCalendarTag({ private_tag: "work", private_tag_version: null })).toEqual({ kind: "malformed" });
    expect(readCalendarTag({ private_tag: null, private_tag_version: 0 })).toEqual({ kind: "malformed" });
    expect(readCalendarTag({ private_tag: null, private_tag_version: 1.5 })).toEqual({ kind: "malformed" });
    expect(readCalendarTag({ private_tag: null, private_tag_version: "3" })).toEqual({ kind: "malformed" });
    expect(readCalendarTag({ private_tag: null, private_tag_version: Number.MAX_SAFE_INTEGER + 1 })).toEqual({ kind: "malformed" });
  });

  it("accepts only positive safe integers as revisions", () => {
    expect(isRevision(1)).toBe(true);
    expect(isRevision(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isRevision(0)).toBe(false);
    expect(isRevision(-1)).toBe(false);
    expect(isRevision(2 ** 60)).toBe(false);
  });
});

describe("confirmed writes", () => {
  const session = "11111111-1111-4111-8111-111111111111";
  const user = "22222222-2222-4222-8222-222222222222";

  it("accepts only a row for this owner and session", () => {
    expect(readConfirmedFocusTag({ session_id: session, user_id: user, tag: "study", version: 4 }, session, user))
      .toEqual({ sessionId: session, userId: user, tag: "study", version: 4 });
    expect(readConfirmedFocusTag({ session_id: session, user_id: user, tag: null, version: 5 }, session, user))
      .toEqual({ sessionId: session, userId: user, tag: null, version: 5 });
  });

  it("rejects missing rows, mismatched owners or sessions, bad tags and bad revisions", () => {
    expect(readConfirmedFocusTag(undefined, session, user)).toBeNull();
    expect(readConfirmedFocusTag({ session_id: "other", user_id: user, tag: "work", version: 1 }, session, user)).toBeNull();
    expect(readConfirmedFocusTag({ session_id: session, user_id: "other", tag: "work", version: 1 }, session, user)).toBeNull();
    expect(readConfirmedFocusTag({ session_id: session, user_id: user, tag: "coding", version: 1 }, session, user)).toBeNull();
    expect(readConfirmedFocusTag({ session_id: session, user_id: user, tag: "work", version: 0 }, session, user)).toBeNull();
  });
});

describe("filtered calendar totals", () => {
  const solo = (id: string, tag: CalendarSession["private_tag"], seconds = 600): CalendarSession => ({
    id, focus_seconds: seconds, world: "forest", ended_at: "2026-10-07T10:00:00Z", is_duo: false, partner_name: "Partner", private_tag: tag, private_tag_version: tag ? 1 : null,
  });
  const duo = (id: string, tag: CalendarSession["private_tag"], seconds = 1500): CalendarSession => ({ ...solo(id, tag, seconds), is_duo: true, partner_name: "Bob" });
  const row: CalendarDay = { day: "2026-10-07", solo_seconds: 1200, duo_seconds: 3000, solo_rounds: 2, duo_rounds: 2, sessions: [
    solo("a", "work"), solo("b", null), duo("c", "work"), duo("d", "study"),
  ] };

  it("keeps the server aggregates when no tag filter is active", () => {
    expect(filteredDayTotals(row, "all", "all")).toEqual({ seconds: 4200, rounds: 4 });
    expect(filteredDayTotals(row, "solo", "all")).toEqual({ seconds: 1200, rounds: 2 });
  });

  it("combines the tag with the Solo/Duo filter and agrees with the matching session list", () => {
    const cases = [
      ["all", "work", 2100, 2], ["solo", "work", 600, 1], ["duo", "work", 1500, 1],
      ["all", "untagged", 600, 1], ["duo", "untagged", 0, 0], ["all", "study", 1500, 1], ["solo", "other", 0, 0],
    ] as const;
    for (const [type, tag, seconds, rounds] of cases) {
      const matching = row.sessions.filter(session => sessionMatches(session, type, tag));
      expect(filteredDayTotals(row, type, tag)).toEqual({ seconds, rounds });
      expect(matching.length).toBe(rounds);
      expect(matching.reduce((sum, session) => sum + session.focus_seconds, 0)).toBe(seconds);
    }
  });

  it("returns zero for an absent day", () => {
    expect(filteredDayTotals(undefined, "all", "work")).toEqual({ seconds: 0, rounds: 0 });
  });
});
