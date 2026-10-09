import { describe, expect, it } from "vitest";
import {
  classifyReflectionError,
  confirmedRow,
  countReflectionCodePoints,
  normalizeReflectionText,
  REFLECTION_MAX_CODE_POINTS,
  validateReflectionText,
} from "./sessionReflections";

const ROW = {
  session_id: "s1", user_id: "alice", reflection_text: "Good", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", version: 1,
};

describe("reflection text rules", () => {
  it("rejects empty and whitespace-only text, including Unicode spaces the database also rejects", () => {
    for (const blank of ["", "   ", "\n\t", "\u00a0\u3000", "\ufeff", " \r\n "]) {
      const result = validateReflectionText(blank);
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ reason: "blank" });
    }
  });

  it("accepts exactly 500 code points and rejects 501", () => {
    expect(validateReflectionText("x".repeat(500)).ok).toBe(true);
    const over = validateReflectionText("x".repeat(501));
    expect(over).toMatchObject({ ok: false, reason: "too-long", length: 501 });
    if (!over.ok) expect(over.message).toContain("1 character over the 500-character limit");
  });

  it("counts emoji and combined characters by code point, not UTF-16 unit", () => {
    const emoji = "\u{1F600}".repeat(REFLECTION_MAX_CODE_POINTS);
    expect(emoji.length).toBe(1000);
    expect(countReflectionCodePoints(emoji)).toBe(500);
    expect(validateReflectionText(emoji).ok).toBe(true);
    expect(validateReflectionText(`${emoji}x`)).toMatchObject({ ok: false, reason: "too-long", length: 501 });
  });

  it("normalizes CRLF and CR line endings, keeps internal newlines and spacing, and trims only the outside", () => {
    expect(normalizeReflectionText("  first\r\n\r\nsecond\rthird  \n")).toBe("first\n\nsecond\nthird");
    const result = validateReflectionText("line one\r\n    indented   words\n");
    expect(result).toMatchObject({ ok: true, text: "line one\n    indented   words" });
  });

  it("rejects control characters while keeping tabs and newlines", () => {
    expect(validateReflectionText("bell\u0007")).toMatchObject({ ok: false, reason: "control" });
    expect(validateReflectionText("a\u007fb")).toMatchObject({ ok: false, reason: "control" });
    expect(validateReflectionText("col\tcol\nnext")).toMatchObject({ ok: true });
  });

  it("does not transform HTML-like text; it is only data for React to escape", () => {
    expect(validateReflectionText("<img src=x onerror=alert(1)>")).toMatchObject({ ok: true, text: "<img src=x onerror=alert(1)>" });
  });
});

describe("error classification", () => {
  it("maps conflicts, duplicates, ineligible sessions and auth without leaking details", () => {
    expect(classifyReflectionError({ code: "40001", message: "Reflection changed elsewhere" }).kind).toBe("changed");
    expect(classifyReflectionError({ code: "23505", message: "Reflection already exists" }).kind).toBe("exists");
    expect(classifyReflectionError({ code: "P0002", message: "Session reflection unavailable" }).kind).toBe("unavailable");
    expect(classifyReflectionError({ code: "42501", message: "permission denied" }).kind).toBe("auth");
    expect(classifyReflectionError({ code: "22023", message: "Reflection cannot be blank" })).toEqual({ kind: "invalid", message: "Reflection cannot be blank" });
  });

  it("treats unknown or transport failures as generic failures that keep the draft", () => {
    expect(classifyReflectionError({ message: "Failed to fetch" })).toMatchObject({ kind: "failed" });
    expect(classifyReflectionError(null)).toMatchObject({ kind: "failed" });
  });
});

describe("confirmed write rows", () => {
  it("only trusts a returned row for the requested session and current owner", () => {
    expect(confirmedRow([ROW], "s1", "alice")).toEqual(ROW);
    expect(confirmedRow([], "s1", "alice")).toBeNull();
    expect(confirmedRow(null, "s1", "alice")).toBeNull();
    expect(confirmedRow([{ ...ROW, session_id: "other" }], "s1", "alice")).toBeNull();
    expect(confirmedRow([{ ...ROW, user_id: "bob" }], "s1", "alice")).toBeNull();
  });
});
