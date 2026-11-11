import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, makeProfileRow, makeSession, type QueryResult } from "./useAuth.testkit";

let fake: ReturnType<typeof createFakeSupabase>;
vi.mock("@/lib/supabase", () => ({ getSupabase: () => fake.sb }));
import { useAuth } from "./useAuth";

const avatar = { skinColor: "#FDDBB4", hairStyle: "bob", hairColor: "#5C3317", eyeStyle: "normal", outfitColor: "#3B5BDB" };
beforeEach(() => {
  fake = createFakeSupabase();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  fake.sessionResult.session = makeSession();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("account loading recovery", () => {
  it("shows an unavailable state rather than avatar setup after a profile API error", async () => {
    fake.selectResults.profile = { data: null, error: { code: "503", message: "unavailable" } };
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.appStep).toBe("unavailable"));
    expect(result.current.profile).toBeNull();
    expect(fake.calls.upserts).toEqual([]);
    expect(localStorage.getItem("duodoro_profile")).toBeNull();
  });

  it("can retry a failed profile read and restore the real saved avatar", async () => {
    fake.selectResults.profile = { data: null, error: new Error("offline") };
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.appStep).toBe("unavailable"));
    fake.selectResults.profile = { data: makeProfileRow({ avatar_config: avatar }), error: null };
    act(() => result.current.retryAuth());
    await waitFor(() => expect(result.current.appStep).toBe("home"));
    expect(result.current.myAvatar).toEqual(avatar);
    expect(fake.calls.upserts).toEqual([]);
  });

  it("does not apply a timed-out profile after retry resolves a newer profile", async () => {
    vi.useFakeTimers();
    let finish!: (value: QueryResult) => void;
    const original = fake.sb.from;
    const read = vi.spyOn(fake.sb, "from").mockImplementation(() => {
      const builder = original();
      builder.single = () => new Promise(resolve => { finish = resolve; });
      return builder;
    });
    const { result } = renderHook(() => useAuth());
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(result.current.appStep).toBe("unavailable");
    expect(fake.calls.upserts).toEqual([]);
    read.mockRestore();
    fake.selectResults.profile = { data: makeProfileRow({ display_name: "Current", avatar_config: avatar }), error: null };
    await act(async () => { result.current.retryAuth(); });
    expect(result.current.appStep).toBe("home");
    await act(async () => { finish({ data: makeProfileRow({ display_name: "Stale" }), error: null }); });
    expect(result.current.profile?.display_name).toBe("Current");
    expect(result.current.myAvatar).toEqual(avatar);
  });

  it("allows online recovery and distinguishes a successful signed-out session check", async () => {
    fake.setGetSessionError(new Error("offline"));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.appStep).toBe("unavailable"));
    fake.setGetSessionError(null);
    fake.sessionResult.session = null;
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(result.current.appStep).toBe("landing"));
  });

  it("ignores an old session snapshot that resolves after sign-out", async () => {
    let finish!: (value: { data: { session: ReturnType<typeof makeSession> } }) => void;
    vi.spyOn(fake.sb.auth, "getSession").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useAuth());
    await act(async () => { await fake.authHandlers[0]("SIGNED_OUT", null); });
    await act(async () => { finish({ data: { session: makeSession() } }); });
    expect(result.current.appStep).toBe("landing");
    expect(result.current.profile).toBeNull();
    expect(fake.calls.selectColumns).toEqual([]);
  });

  it("ignores a previous account's profile after another account signs in", async () => {
    let finish!: (value: QueryResult) => void;
    const original = fake.sb.from;
    let reads = 0;
    vi.spyOn(fake.sb, "from").mockImplementation(() => {
      const builder = original();
      if (++reads === 1) builder.single = () => new Promise(resolve => { finish = resolve; });
      return builder;
    });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(reads).toBe(1));
    fake.selectResults.profile = { data: makeProfileRow({ id: "user-2", avatar_config: avatar }), error: null };
    await act(async () => { await fake.authHandlers[0]("SIGNED_IN", makeSession({ id: "user-2" })); });
    await waitFor(() => expect(result.current.profile?.id).toBe("user-2"));
    await act(async () => { finish({ data: makeProfileRow({ id: "user-1" }), error: null }); });
    expect(result.current.profile?.id).toBe("user-2");
    expect(result.current.appStep).toBe("home");
  });

  it("does not enter setup when a missing-row repair is rejected", async () => {
    const original = fake.sb.from;
    vi.spyOn(fake.sb, "from").mockImplementation(() => {
      const builder = original();
      builder.upsert = () => Promise.resolve({ error: { code: "42501" } });
      return builder;
    });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.appStep).toBe("unavailable"));
    expect(result.current.profile).toBeNull();
    expect(localStorage.getItem("duodoro_profile")).toBeNull();
  });

  it("uses the existing authoritative profile if it appears during a repair", async () => {
    const original = fake.sb.from;
    vi.spyOn(fake.sb, "from").mockImplementation(() => {
      const builder = original();
      const insert = builder.upsert;
      builder.upsert = (values: unknown, options: unknown) => {
        fake.selectResults.profile = { data: makeProfileRow({ username: "Saved", avatar_config: avatar }), error: null };
        return insert(values, options);
      };
      return builder;
    });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.appStep).toBe("home"));
    expect(result.current.profile?.username).toBe("Saved");
    expect(result.current.myAvatar).toEqual(avatar);
  });

  it("keeps a usable same-account cache on a failed background refresh", async () => {
    const cached = makeProfileRow({ avatar_config: avatar });
    localStorage.setItem("duodoro_profile", JSON.stringify(cached));
    fake.selectResults.profile = { data: null, error: new Error("offline") };
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.appStep).toBe("home"));
    expect(result.current.myAvatar).toEqual(avatar);
    expect(fake.calls.upserts).toEqual([]);
  });
});
