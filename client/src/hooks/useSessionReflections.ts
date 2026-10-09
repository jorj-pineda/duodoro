"use client";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  classifyReflectionError,
  confirmedRow,
  toSessionReflection,
  UNCONFIRMED_FAILURE,
  type ReflectionFailure,
  type SessionReflection,
} from "@/lib/sessionReflections";

// Private reflections live in an account-scoped in-memory store, never in
// storage. Every entry is keyed by account and session, so a response from one
// account cannot be shown to another. Entries are only written by responses
// that still match the current sequence, which discards out-of-order reads.

export type ReflectionEntry = {
  status: "loading" | "ready" | "error";
  reflection: SessionReflection | null;
  pending: "save" | "delete" | null;
  seq: number;
};

type Snapshot = Record<string, ReflectionEntry>;

// Keeps each batch request well under PostgREST's URL limit.
const READ_BATCH_SIZE = 50;

const EMPTY: Snapshot = {};
let snapshot: Snapshot = EMPTY;
const listeners = new Set<() => void>();

function keyFor(userId: string, sessionId: string) {
  return `${userId}:${sessionId}`;
}

function publish(next: Snapshot) {
  snapshot = next;
  listeners.forEach(listener => listener());
}

function write(key: string, entry: ReflectionEntry) {
  publish({ ...snapshot, [key]: entry });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot() { return snapshot; }

// Removes every entry that belongs to an account other than the one now in use.
export function retainReflectionAccount(userId: string) {
  const prefix = `${userId}:`;
  const next: Snapshot = {};
  let changed = false;
  for (const [key, entry] of Object.entries(snapshot)) {
    if (key.startsWith(prefix)) next[key] = entry; else changed = true;
  }
  if (changed) publish(next);
}

// Test helper and sign-out safety: drops every cached note and draft source.
export function resetSessionReflectionStore() {
  publish(EMPTY);
}

function nextSeq(key: string): number {
  return (snapshot[key]?.seq ?? 0) + 1;
}

// Loads a batch of sessions for one account. Returns once every chunk settles.
export async function loadSessionReflections(userId: string, sessionIds: string[]): Promise<void> {
  const ids = [...new Set(sessionIds)];
  const seqs = new Map<string, number>();
  for (const id of ids) {
    const key = keyFor(userId, id);
    const current = snapshot[key];
    const seq = nextSeq(key);
    seqs.set(id, seq);
    write(key, { status: current?.status === "ready" ? "ready" : "loading", reflection: current?.reflection ?? null, pending: current?.pending ?? null, seq });
  }

  for (let start = 0; start < ids.length; start += READ_BATCH_SIZE) {
    const chunk = ids.slice(start, start + READ_BATCH_SIZE);
    let byId: Map<string, SessionReflection> | null = null;
    try {
      const { data, error } = await getSupabase()
        .from("session_reflections")
        .select("session_id, user_id, reflection_text, created_at, updated_at, version")
        .eq("user_id", userId)
        .in("session_id", chunk);
      if (error || !data) throw error ?? new Error("empty response");
      const parsed = new Map<string, SessionReflection>();
      for (const row of data) {
        // Each row must belong to this account and to a session we asked for.
        if (row.user_id !== userId || !chunk.includes(row.session_id)) throw new Error("unexpected row");
        parsed.set(row.session_id, toSessionReflection(row));
      }
      byId = parsed;
    } catch {
      byId = null;
    }

    for (const id of chunk) {
      const key = keyFor(userId, id);
      const current = snapshot[key];
      const seq = seqs.get(id);
      if (!current || current.seq !== seq) continue;
      if (byId) {
        write(key, { status: "ready", reflection: byId.get(id) ?? null, pending: current.pending, seq });
      } else {
        // A failed read is never shown as an empty result.
        write(key, { status: "error", reflection: current.reflection, pending: current.pending, seq });
      }
    }
  }
}

export type SaveResult = { ok: true; reflection: SessionReflection } | { ok: false; failure: ReflectionFailure };
export type RemoveResult = { ok: true } | { ok: false; failure: ReflectionFailure };

const BUSY: ReflectionFailure = { kind: "failed", message: "A change is already being saved." };

// expectedVersion null means create. A number means update that exact version.
export async function saveSessionReflection(userId: string, sessionId: string, text: string, expectedVersion: number | null): Promise<SaveResult> {
  const key = keyFor(userId, sessionId);
  const current = snapshot[key];
  if (current?.pending) return { ok: false, failure: BUSY };
  if (current) write(key, { ...current, pending: "save", seq: nextSeq(key) });

  const sb = getSupabase();
  const result = expectedVersion === null
    ? await sb.rpc("create_session_reflection", { p_session_id: sessionId, p_text: text })
    : await sb.rpc("update_session_reflection", { p_session_id: sessionId, p_text: text, p_expected_version: expectedVersion });

  const row = result.error ? null : confirmedRow(result.data, sessionId, userId);
  const latest = snapshot[key];
  if (!row) {
    const failure = result.error ? classifyReflectionError(result.error) : UNCONFIRMED_FAILURE;
    if (latest) write(key, { ...latest, pending: null, seq: nextSeq(key) });
    return { ok: false, failure };
  }
  const reflection = toSessionReflection(row);
  if (latest) write(key, { status: "ready", reflection, pending: null, seq: nextSeq(key) });
  return { ok: true, reflection };
}

export async function deleteSessionReflection(userId: string, sessionId: string, expectedVersion: number): Promise<RemoveResult> {
  const key = keyFor(userId, sessionId);
  const current = snapshot[key];
  if (current?.pending) return { ok: false, failure: BUSY };
  if (current) write(key, { ...current, pending: "delete", seq: nextSeq(key) });

  const { data, error } = await getSupabase().rpc("delete_session_reflection", { p_session_id: sessionId, p_expected_version: expectedVersion });
  const deleted = !error && data?.[0] && data[0].session_id === sessionId && data[0].user_id === userId ? data[0] : null;
  const latest = snapshot[key];
  if (!deleted) {
    const failure = error ? classifyReflectionError(error) : UNCONFIRMED_FAILURE;
    if (latest) write(key, { ...latest, pending: null, seq: nextSeq(key) });
    return { ok: false, failure };
  }
  if (latest) write(key, { status: "ready", reflection: null, pending: null, seq: nextSeq(key) });
  return { ok: true };
}

// Loads only sessions without an entry on mount or when the visible set grows,
// and refreshes every visible session on tab focus/visibility return.
export function useLoadSessionReflections(userId: string, sessionIds: string[]) {
  const idsKey = sessionIds.join(",");
  const ids = useMemo(() => (idsKey ? idsKey.split(",") : []), [idsKey]);
  const latestIds = useRef<string[]>(ids);
  useEffect(() => { latestIds.current = ids; }, [ids]);

  useEffect(() => { retainReflectionAccount(userId); }, [userId]);

  useEffect(() => {
    const missing = ids.filter(id => !snapshot[keyFor(userId, id)]);
    if (missing.length) void loadSessionReflections(userId, missing);
  }, [userId, ids]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || !latestIds.current.length) return;
      void loadSessionReflections(userId, latestIds.current);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [userId]);
}

// Reads one session's entry for the current account only. Callers pass the
// current account, so another account's entry is never returned.
export function useSessionReflection(userId: string, sessionId: string): ReflectionEntry | undefined {
  const all = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  return all[keyFor(userId, sessionId)];
}
