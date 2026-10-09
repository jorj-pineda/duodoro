import type { Database } from "./database.types";

// Mirrors the session_reflections_text_valid check and the RPC validation in
// supabase/migrations/20261008120000_session_reflections.sql. The whitespace
// class is JavaScript's \s, which is also written out in the SQL, so "blank"
// means the same thing in both places.
export const REFLECTION_MAX_CODE_POINTS = 500;

const CONTROL_CHARACTERS = /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export type SessionReflection = {
  sessionId: string;
  userId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type ReflectionRow = Pick<
  Database["public"]["Tables"]["session_reflections"]["Row"],
  "session_id" | "user_id" | "reflection_text" | "created_at" | "updated_at" | "version"
>;

export function countReflectionCodePoints(text: string): number {
  return [...text].length;
}

// Line endings become LF, then the outer whitespace is removed. Internal
// spaces and newlines are preserved byte for byte.
export function normalizeReflectionText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").trim();
}

export type ReflectionValidation =
  | { ok: true; text: string; length: number }
  | { ok: false; reason: "blank" | "too-long" | "control"; message: string; length: number };

export function validateReflectionText(raw: string): ReflectionValidation {
  const text = normalizeReflectionText(raw);
  const length = countReflectionCodePoints(text);
  if (!text) {
    return { ok: false, reason: "blank", message: "Write a reflection before saving. Use Delete reflection to remove a saved one.", length };
  }
  if (length > REFLECTION_MAX_CODE_POINTS) {
    return {
      ok: false,
      reason: "too-long",
      message: `${length - REFLECTION_MAX_CODE_POINTS} ${length - REFLECTION_MAX_CODE_POINTS === 1 ? "character" : "characters"} over the ${REFLECTION_MAX_CODE_POINTS}-character limit. Shorten it to save.`,
      length,
    };
  }
  if (CONTROL_CHARACTERS.test(text)) {
    return { ok: false, reason: "control", message: "Reflections can only contain plain text.", length };
  }
  return { ok: true, text, length };
}

export function toSessionReflection(row: ReflectionRow): SessionReflection {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    text: row.reflection_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
  };
}

// Failures are classified by SQLSTATE, not by message text. The messages from
// the database are fixed strings, but the client still shows its own copy.
export type ReflectionFailureKind = "changed" | "exists" | "unavailable" | "invalid" | "auth" | "unconfirmed" | "failed";

export type ReflectionFailure = { kind: ReflectionFailureKind; message: string };

type ErrorLike = { code?: string | null; message?: string | null };

export function classifyReflectionError(error: ErrorLike | null | undefined): ReflectionFailure {
  switch (error?.code) {
    case "40001":
      return { kind: "changed", message: "This reflection changed in another tab or device." };
    case "23505":
      return { kind: "exists", message: "A reflection for this session was saved elsewhere." };
    case "P0002":
      return { kind: "unavailable", message: "This session can no longer hold a reflection." };
    case "22023":
      return { kind: "invalid", message: error?.message ?? "This reflection is not valid." };
    case "42501":
      return { kind: "auth", message: "Sign in again to manage your reflections." };
    default:
      return { kind: "failed", message: "Reflection couldn't be saved. Your draft is still here. Try again." };
  }
}

// A successful write is trusted only when the returned row names this session
// and this owner. Zero rows or a mismatch means the server did not confirm it.
export function confirmedRow(rows: ReflectionRow[] | null | undefined, sessionId: string, userId: string): ReflectionRow | null {
  const row = rows?.[0];
  return row && row.session_id === sessionId && row.user_id === userId ? row : null;
}

export const UNCONFIRMED_FAILURE: ReflectionFailure = {
  kind: "unconfirmed",
  message: "The server did not confirm this change. Reload your reflection before trying again.",
};
