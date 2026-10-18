import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };

function createFakeSupabase() {
  const results: Record<string, Result> = {
    friends: { data: [], error: null },
    requests: { data: [], error: null },
    update: { data: [{ id: "friendship-1" }], error: null },
    delete: { data: [{ id: "friendship-1" }], error: null },
  };
  const realtimeHandlers: Array<() => void> = [];

  const makeBuilder = (kind: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    builder.select = () => builder;
    builder.eq = (column: string, value: string) => {
      if (kind === "select" && column === "status") {
        builder.resultKey = value === "accepted" ? "friends" : "requests";
      }
      return builder;
    };
    builder.then = (
      resolve: (result: Result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(results[builder.resultKey ?? kind]).then(resolve, reject);
    return builder;
  };

  const channel = {
    on: (_event: string, _filter: unknown, handler: () => void) => {
      realtimeHandlers.push(handler);
      return channel;
    },
    subscribe: () => channel,
  };

  const sb = {
    rpc: vi.fn(async () => results.requests),
    from: () => ({
      select: () => makeBuilder("select"),
      update: () => makeBuilder("update"),
      delete: () => makeBuilder("delete"),
    }),
    channel: () => channel,
    removeChannel: vi.fn(),
  };

  return { sb, results, realtimeHandlers };
}

let fake: ReturnType<typeof createFakeSupabase>;

vi.mock("@/lib/supabase", () => ({ getSupabase: () => fake.sb }));

import { useFriendsList } from "./useFriendsList";

describe("useFriendsList read and mutation integrity", () => {
  beforeEach(() => {
    fake = createFakeSupabase();
  });

  it("does not report a failed read as an empty friend list", async () => {
    fake.results.friends = { data: null, error: new Error("offline") };
    const { result } = renderHook(() => useFriendsList("me", true));

    await waitFor(() => expect(result.current.loadError).not.toBeNull());

    expect(result.current.loaded).toBe(false);
    expect(result.current.friends).toEqual([]);
    expect(result.current.loadError).toContain("Couldn't load");
  });

  it("marks a successful empty result as genuinely loaded", async () => {
    const { result } = renderHook(() => useFriendsList("me", true));

    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.friends).toEqual([]);
    expect(result.current.requests).toEqual([]);
    expect(result.current.loadError).toBeNull();
  });

  it("recovers when a realtime event follows a failed read", async () => {
    fake.results.requests = { data: null, error: new Error("offline") };
    const { result } = renderHook(() => useFriendsList("me", true));
    await waitFor(() => expect(result.current.loadError).not.toBeNull());

    fake.results.requests = { data: [], error: null };
    await act(async () => {
      await fake.realtimeHandlers[0]();
    });

    expect(result.current.loaded).toBe(true);
    expect(result.current.loadError).toBeNull();
  });


  it("loads pending identity from the scoped RPC without retaining presence fields", async () => {
    fake.results.requests = { data: [{ id: "request-1", requester_id: "sender", username: "alpha", discriminator: "1234", display_name: "Alpha", is_premium: false,
      current_session_id: "must-not-survive", current_world_id: "forest" }], error: null };
    const { result } = renderHook(() => useFriendsList("me", true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(fake.sb.rpc).toHaveBeenCalledWith("get_friend_requests");
    expect(result.current.requests).toEqual([{ id: "request-1", requester: {
      id: "sender", username: "alpha", discriminator: "1234", display_name: "Alpha", is_premium: false,
    } }]);
  });

  it("treats an accepted-request update that matched no row as a failure", async () => {
    fake.results.update = { data: [], error: null };
    const { result } = renderHook(() => useFriendsList("me", false));

    await act(async () => {
      await result.current.acceptRequest("friendship-1");
    });

    expect(result.current.error).toContain("may not have permission");
  });
});
