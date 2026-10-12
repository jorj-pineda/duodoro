"use client";
import { useSyncExternalStore } from "react";
import { getSupabase } from "@/lib/supabase";
import { readConfirmedFocusTag, type FocusTagId } from "@/lib/focusTags";

// Private tags live in memory only: never in storage, URLs or logs. Each entry
// is the newest confirmed revision this tab has seen for one account and one
// session. Revisions only increase, so the larger version always wins. A stale
// calendar read or a late response therefore cannot move a round backwards.

export type SavedFocusTag = { tag: FocusTagId | null; version: number };
type Snapshot = Record<string, SavedFocusTag>;

const EMPTY: Snapshot = {};
let snapshot: Snapshot = EMPTY;
let account: string | null = null;
let epoch = 0;
const listeners = new Set<() => void>();
const inFlight = new Map<string, object>();

export type FocusTagFailureKind = "changed" | "unavailable" | "invalid" | "auth" | "unconfirmed" | "failed";
export type FocusTagFailure = { kind: FocusTagFailureKind; message: string };
export type SaveFocusTagResult = { ok: true; saved: SavedFocusTag } | { ok: false; failure: FocusTagFailure };

export const FOCUS_TAG_BUSY: FocusTagFailure = { kind: "failed", message: "This round's tag is already being saved." };
export const FOCUS_TAG_UNCONFIRMED: FocusTagFailure = {
  kind: "unconfirmed",
  message: "Couldn't confirm this change. Reload the saved tag before trying again.",
};

export function focusTagKey(userId: string, sessionId: string) {
  return `${userId}:${sessionId}`;
}

function publish(next: Snapshot) {
  snapshot = next;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot() { return snapshot; }

// Switching accounts discards every entry for the previous account and every
// in-flight request, so a late response cannot be attributed to the new one.
export function retainFocusTagAccount(userId: string) {
  if (account === userId) return;
  account = userId;
  epoch++;
  inFlight.clear();
  const prefix = `${userId}:`;
  publish(Object.fromEntries(Object.entries(snapshot).filter(([key]) => key.startsWith(prefix))));
}

// Sign-out and test helper: forget everything and invalidate pending responses.
export function resetFocusTagStore() {
  account = null;
  epoch++;
  inFlight.clear();
  publish(EMPTY);
}

// Records confirmed revisions only for the account currently in use.
export function rememberFocusTags(userId: string, saved: { sessionId: string; tag: FocusTagId | null; version: number }[]) {
  if (account !== userId || !saved.length) return;
  const next = { ...snapshot };
  let changed = false;
  for (const entry of saved) {
    const key = focusTagKey(userId, entry.sessionId);
    const current = next[key];
    if (current && current.version >= entry.version) continue;
    next[key] = { tag: entry.tag, version: entry.version };
    changed = true;
  }
  if (changed) publish(next);
}

export function useSessionFocusTagCache(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

export function readSavedFocusTag(userId: string, sessionId: string): SavedFocusTag | undefined {
  return snapshot[focusTagKey(userId, sessionId)];
}

type ErrorLike = { code?: string | null; message?: string | null };

export function classifyFocusTagError(error: ErrorLike | null | undefined): FocusTagFailure {
  switch (error?.code) {
    case "PT409":
    case "40001":
      return { kind: "changed", message: "This tag changed in another tab or device." };
    case "P0002":
      return { kind: "unavailable", message: "This round can no longer hold a private tag." };
    case "22023":
      return { kind: "invalid", message: "That tag isn't one of the choices. Pick a tag and save again." };
    case "42501":
      return { kind: "auth", message: "Sign in again to manage your private tags." };
    default:
      return { kind: "failed", message: "The tag couldn't be saved. Your selection is still here. Try again." };
  }
}

// Confirmed writes only. expectedVersion null creates a row (only when none
// exists); a number changes exactly that revision. Clearing keeps the row.
export async function saveSessionFocusTag(
  userId: string,
  sessionId: string,
  tag: FocusTagId | null,
  expectedVersion: number | null,
): Promise<SaveFocusTagResult> {
  const key = focusTagKey(userId, sessionId);
  if (inFlight.has(key)) return { ok: false, failure: FOCUS_TAG_BUSY };
  const token = {};
  const requestEpoch = epoch;
  inFlight.set(key, token);
  try {
    // Generated types omit null for these RPC arguments, but PostgREST passes
    // SQL NULL for "No tag" and for "create only when no revision exists".
    const args = { p_session_id: sessionId, p_tag: tag, p_expected_version: expectedVersion } as unknown as {
      p_session_id: string; p_tag: string; p_expected_version: number;
    };
    const { data, error } = await getSupabase().rpc("set_session_focus_tag", args);
    if (requestEpoch !== epoch) return { ok: false, failure: FOCUS_TAG_UNCONFIRMED };
    if (error) return { ok: false, failure: classifyFocusTagError(error) };
    const confirmed = readConfirmedFocusTag(data?.[0], sessionId, userId);
    if (!confirmed) return { ok: false, failure: FOCUS_TAG_UNCONFIRMED };
    rememberFocusTags(userId, [{ sessionId, tag: confirmed.tag, version: confirmed.version }]);
    return { ok: true, saved: { tag: confirmed.tag, version: confirmed.version } };
  } catch {
    // A lost response can still mean the write committed, so never report it as saved.
    return { ok: false, failure: FOCUS_TAG_UNCONFIRMED };
  } finally {
    if (inFlight.get(key) === token) inFlight.delete(key);
  }
}
