import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  makeProfileRow,
  makeSession,
} from "./useAuth.testkit";

let fake: ReturnType<typeof createFakeSupabase>;

vi.mock("@/lib/supabase", () => ({ getSupabase: () => fake.sb }));

import { useAuth } from "./useAuth";

beforeEach(() => {
  fake = createFakeSupabase();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAuth bootstrap", () => {
  it("starts on loading and settles on landing with no session", async () => {
    const { result } = renderHook(() => useAuth());

    // The first paint is `loading`, not `landing`: the landing page and the
    // game screen must not flash before the session check finishes.
    expect(result.current.appStep).toBe("loading");
    await waitFor(() => expect(result.current.appStep).toBe("landing"));
  });

  it("still reaches landing when getSession throws", async () => {
    fake.setGetSessionError(new Error("offline"));
    const { result } = renderHook(() => useAuth());

    // A thrown session check must not strand the user on the loading screen.
    await waitFor(() => expect(result.current.appStep).toBe("landing"));
  });

  it("waits longer for an OAuth code than for an ordinary load", async () => {
    // 8s is the ordinary wait; an in-flight code exchange gets 20s, because
    // landing the user back on the marketing page mid-callback is worse than a
    // spinner. This is the whole reason the timeout is not a constant.
    vi.useFakeTimers();
    fake.sessionResult.session = null;
    window.history.replaceState({}, "", "/?code=abc");

    const { result, unmount } = renderHook(() => useAuth());

    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    // Past the short timeout, still not landed — the callback is still running.
    expect(result.current.appStep).not.toBe("landing");

    await act(async () => {
      vi.advanceTimersByTime(12000);
    });
    expect(result.current.appStep).toBe("landing");

    unmount();
    window.history.replaceState({}, "", "/");
    vi.useRealTimers();
  });

  it("goes straight to home when the cache has an avatar", async () => {
    const cached = makeProfileRow({
      avatar_config: {
        skinColor: "#FDDBB4",
        hairStyle: "bob",
        hairColor: "#5C3317",
        eyeStyle: "normal",
        outfitColor: "#3B5BDB",
      },
    });
    localStorage.setItem("duodoro_profile", JSON.stringify(cached));
    fake.sessionResult.session = makeSession({ id: cached.id });

    const { result } = renderHook(() => useAuth());

    // The cached path is what stops a refresh from re-showing the avatar
    // creator; it must land on home without waiting for the database.
    await waitFor(() => expect(result.current.appStep).toBe("home"));
    expect(result.current.profile?.id).toBe(cached.id);
  });

  it("sends a cached profile without an avatar to the avatar step", async () => {
    const cached = makeProfileRow({ avatar_config: null });
    localStorage.setItem("duodoro_profile", JSON.stringify(cached));
    fake.sessionResult.session = makeSession({ id: cached.id });
    fake.selectResults.profile = { data: cached, error: null };

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.appStep).toBe("avatar"));
  });

  it("ignores a cache belonging to a different user", async () => {
    const cached = makeProfileRow({
      id: "someone-else",
      avatar_config: { skinColor: "#FDDBB4" },
    });
    localStorage.setItem("duodoro_profile", JSON.stringify(cached));
    fake.sessionResult.session = makeSession({ id: "user-1" });
    fake.selectResults.profile = {
      data: makeProfileRow({ id: "user-1", avatar_config: { skinColor: "#000000" } }),
      error: null,
    };

    const { result } = renderHook(() => useAuth());

    // Using another account's cached avatar would render the previous person's
    // character against this session's data.
    await waitFor(() => expect(result.current.profile?.id).toBe("user-1"));
  });

  it("tolerates corrupt cache JSON", async () => {
    localStorage.setItem("duodoro_profile", "{not json");
    fake.sessionResult.session = makeSession();
    fake.selectResults.profile = { data: makeProfileRow(), error: null };

    const { result } = renderHook(() => useAuth());

    // A parse failure has to fall through to the network path rather than
    // throw inside the effect and leave the app on `loading` forever.
    await waitFor(() => expect(result.current.profile).not.toBeNull());
  });
});
