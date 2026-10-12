import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc }) }));

import {
  classifyFocusTagError, focusTagKey, readSavedFocusTag, rememberFocusTags, resetFocusTagStore,
  retainFocusTagAccount, saveSessionFocusTag,
} from "./useSessionFocusTags";

const alice = "aaaaaaaa-0000-4000-8000-000000000001";
const bob = "bbbbbbbb-0000-4000-8000-000000000002";
const session = "cccccccc-0000-4000-8000-000000000003";

const confirmed = (tag: string | null, version: number, owner = alice, id = session) => ({ data: [{ session_id: id, user_id: owner, tag, version, updated_at: "2026-10-09T10:00:00Z" }], error: null });

beforeEach(() => {
  rpc.mockReset();
  resetFocusTagStore();
  retainFocusTagAccount(alice);
});

describe("saving a private tag", () => {
  it("creates only when no revision is supplied and remembers the confirmed row", async () => {
    rpc.mockResolvedValueOnce(confirmed("work", 4));
    const result = await saveSessionFocusTag(alice, session, "work", null);
    expect(rpc).toHaveBeenCalledWith("set_session_focus_tag", { p_session_id: session, p_tag: "work", p_expected_version: null });
    expect(result).toEqual({ ok: true, saved: { tag: "work", version: 4 } });
    expect(readSavedFocusTag(alice, session)).toEqual({ tag: "work", version: 4 });
  });

  it("sends null for No tag and keeps the cleared revision for the next assignment", async () => {
    rpc.mockResolvedValueOnce(confirmed("study", 4));
    await saveSessionFocusTag(alice, session, "study", null);
    rpc.mockResolvedValueOnce(confirmed(null, 9));
    const cleared = await saveSessionFocusTag(alice, session, null, 4);
    expect(rpc).toHaveBeenLastCalledWith("set_session_focus_tag", { p_session_id: session, p_tag: null, p_expected_version: 4 });
    expect(cleared).toEqual({ ok: true, saved: { tag: null, version: 9 } });
    rpc.mockResolvedValueOnce(confirmed("reading", 12));
    await saveSessionFocusTag(alice, session, "reading", 9);
    expect(rpc).toHaveBeenLastCalledWith("set_session_focus_tag", { p_session_id: session, p_tag: "reading", p_expected_version: 9 });
  });

  it("never reports success for a row that names another owner, session or malformed tag", async () => {
    for (const bad of [
      confirmed("work", 4, bob),
      confirmed("work", 4, alice, "dddddddd-0000-4000-8000-000000000004"),
      confirmed("coding", 4),
      confirmed("work", 0),
      { data: [], error: null },
      { data: null, error: null },
    ]) {
      rpc.mockResolvedValueOnce(bad);
      const result = await saveSessionFocusTag(alice, session, "work", null);
      expect(result).toEqual({ ok: false, failure: expect.objectContaining({ kind: "unconfirmed" }) });
    }
    expect(readSavedFocusTag(alice, session)).toBeUndefined();
  });

  it("maps PT409 and HTTP-409 conflicts to a changed tag, and the other errors to specific guidance", () => {
    expect(classifyFocusTagError({ code: "PT409" }).kind).toBe("changed");
    expect(classifyFocusTagError({ code: "40001" }).kind).toBe("changed");
    expect(classifyFocusTagError({ code: "P0002" }).kind).toBe("unavailable");
    expect(classifyFocusTagError({ code: "22023" }).kind).toBe("invalid");
    expect(classifyFocusTagError({ code: "42501" }).kind).toBe("auth");
    expect(classifyFocusTagError({ code: "XX000" }).kind).toBe("failed");
  });

  it("returns the conflict kind without changing the cache", async () => {
    rpc.mockResolvedValueOnce(confirmed("work", 4));
    await saveSessionFocusTag(alice, session, "work", null);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409", message: "Focus tag changed elsewhere" } });
    const result = await saveSessionFocusTag(alice, session, "study", 1);
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ kind: "changed" }) });
    expect(readSavedFocusTag(alice, session)).toEqual({ tag: "work", version: 4 });
  });
});

describe("pending state and duplicate submissions", () => {
  it("releases the lock after a rejected network request so a retry is allowed", async () => {
    rpc.mockRejectedValueOnce(new Error("offline"));
    const first = await saveSessionFocusTag(alice, session, "work", null);
    expect(first).toEqual({ ok: false, failure: expect.objectContaining({ kind: "unconfirmed" }) });
    rpc.mockResolvedValueOnce(confirmed("work", 4));
    expect((await saveSessionFocusTag(alice, session, "work", null)).ok).toBe(true);
  });

  it("blocks a second submission for the same round while the first is pending", async () => {
    let resolve!: (value: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = saveSessionFocusTag(alice, session, "work", null);
    const second = await saveSessionFocusTag(alice, session, "study", null);
    expect(second).toEqual({ ok: false, failure: expect.objectContaining({ kind: "failed" }) });
    expect(rpc).toHaveBeenCalledTimes(1);
    resolve(confirmed("work", 4));
    expect((await first).ok).toBe(true);
  });
});

describe("account scope", () => {
  it("does not remember responses for an account that is no longer in use", async () => {
    let resolve!: (value: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = saveSessionFocusTag(alice, session, "work", null);
    retainFocusTagAccount(bob);
    resolve(confirmed("work", 4));
    expect(await pending).toEqual({ ok: false, failure: expect.objectContaining({ kind: "unconfirmed" }) });
    expect(readSavedFocusTag(alice, session)).toBeUndefined();
    expect(readSavedFocusTag(bob, session)).toBeUndefined();
  });

  it("removes another account's entries and keeps the newest revision per session", () => {
    rememberFocusTags(alice, [{ sessionId: session, tag: "work", version: 5 }]);
    rememberFocusTags(alice, [{ sessionId: session, tag: "study", version: 3 }]);
    expect(readSavedFocusTag(alice, session)).toEqual({ tag: "work", version: 5 });
    retainFocusTagAccount(bob);
    expect(readSavedFocusTag(alice, session)).toBeUndefined();
    rememberFocusTags(alice, [{ sessionId: session, tag: "other", version: 9 }]);
    expect(readSavedFocusTag(alice, session)).toBeUndefined();
    expect(focusTagKey(alice, session)).toBe(`${alice}:${session}`);
  });
});
