import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Fake socket.io ───────────────────────────────────────────────────────────
// Enough of the surface useGameSession touches: per-event listener lists, a
// manager (`io`) with its own listeners, and connect/disconnect that flip state
// and fire the right events.
function createFakeSocket() {
  const handlers = new Map<string, ((...a: unknown[]) => void)[]>();
  const managerHandlers = new Map<string, ((...a: unknown[]) => void)[]>();
  const add = (m: Map<string, ((...a: unknown[]) => void)[]>) =>
    (ev: string, fn: (...a: unknown[]) => void) => {
      m.set(ev, [...(m.get(ev) ?? []), fn]);
    };
  const remove = (m: Map<string, ((...a: unknown[]) => void)[]>) =>
    (ev: string, fn: (...a: unknown[]) => void) => {
      m.set(ev, (m.get(ev) ?? []).filter((f) => f !== fn));
    };

  const socket = {
    id: "sock-1",
    connected: false,
    auth: {} as Record<string, unknown>,
    emitted: [] as {
      ev: string;
      payload: unknown;
      callback?: (...args: unknown[]) => void;
    }[],
    connectCalls: 0,

    on: add(handlers),
    off: remove(handlers),
    once: add(handlers),
    emit(ev: string, payload?: unknown, callback?: (...args: unknown[]) => void) {
      socket.emitted.push({ ev, payload, callback });
    },
    disconnect() {
      socket.connected = false;
      socket.fire("disconnect");
    },
    connect() {
      socket.connectCalls++;
      socket.connected = true;
      socket.fire("connect");
    },
    io: {
      on: add(managerHandlers),
      off: remove(managerHandlers),
      fire(ev: string, ...args: unknown[]) {
        (managerHandlers.get(ev) ?? []).forEach((f) => f(...args));
      },
    },

    // test helpers
    fire(ev: string, ...args: unknown[]) {
      (handlers.get(ev) ?? []).forEach((f) => f(...args));
    },
    listenerCount(ev: string) {
      return (handlers.get(ev) ?? []).length;
    },
    emittedNames() {
      return socket.emitted.map((e) => e.ev);
    },
  };
  return socket;
}

let fakeSocket: ReturnType<typeof createFakeSocket>;

vi.mock("socket.io-client", () => ({
  io: () => fakeSocket,
  Socket: class {},
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "tok" } },
      }),
      refreshSession: async () => ({
        data: { session: { access_token: "tok" } },
      }),
    },
  }),
}));

vi.mock("@/lib/sounds", () => ({ playSound: () => {} }));

import { useGameSession } from "./useGameSession";
import type { Profile } from "@/lib/types";

const profile: Profile = {
  id: "user-1",
  username: "jorge",
  discriminator: "0001",
  username_changed: false,
  display_name: "Jorge",
  display_name_changed_at: null,
  avatar_config: null,
  is_premium: false,
  current_room: null,
  current_session_id: null,
  current_world_id: null,
  updated_at: "2026-08-12T00:00:00Z",
};

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
};

describe("useGameSession connection lifecycle", () => {
  beforeEach(() => {
    fakeSocket = createFakeSocket();
    setVisibility("visible");
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  // The socket is created after an await inside connectSocket(), so any effect
  // that reads socketRef.current on mount sees null. Handlers registered that
  // way are silently never attached.
  it("reads a closed-tab resume id from localStorage", () => {
    localStorage.setItem("duodoro:session", "3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    const { result } = renderHook(() => useGameSession(null));
    expect(result.current.resumeSessionId).toBe(
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    );
  });

  it("refuses to resume a stored id that is not a session id", () => {
    // A value that is not a UUID cannot name a live session — they are keyed by
    // the UUID the server generated — so resuming it only produces a doomed
    // join and a "Session not found" toast for something that was never a
    // session. It is dropped, and cleared so the next read is cheap.
    localStorage.setItem("duodoro:session", "kept-room");
    const { result } = renderHook(() => useGameSession(null));
    expect(result.current.resumeSessionId).toBeNull();
    expect(localStorage.getItem("duodoro:session")).toBeNull();
    expect(sessionStorage.getItem("duodoro:session")).toBeNull();
  });

  it("keeps a valid sessionStorage id when localStorage has none", () => {
    sessionStorage.setItem("duodoro:session", "3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    const { result } = renderHook(() => useGameSession(null));
    expect(result.current.resumeSessionId).toBe(
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    );
  });

  it("registers presence after the socket exists, not on the first mount", async () => {
    renderHook(() => useGameSession(profile));
    expect(fakeSocket.emittedNames()).not.toContain("register_user");

    await waitFor(() => expect(fakeSocket.listenerCount("connect")).toBeGreaterThan(0));
    act(() => fakeSocket.connect());

    await waitFor(() => expect(fakeSocket.emittedNames()).toContain("register_user"));
  });

  it("wires tab-wake and reconnect handlers to the socket once it exists", async () => {
    renderHook(() => useGameSession(null));
    await waitFor(() => expect(fakeSocket.listenerCount("connect")).toBeGreaterThan(0));
    expect(fakeSocket.listenerCount("disconnect")).toBeGreaterThan(0);
  });

  it("asks the server to resync when the tab becomes visible mid-session", async () => {
    const { result } = renderHook(() => useGameSession(null));
    await waitFor(() => expect(fakeSocket.listenerCount("connect")).toBeGreaterThan(0));

    // Get into a session: connect, then let the server confirm one.
    act(() => fakeSocket.connect());
    act(() => fakeSocket.fire("session_created", { sessionId: "sess-1" }));
    await waitFor(() => expect(result.current.sessionId).toBe("sess-1"));

    fakeSocket.emitted.length = 0;
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await waitFor(() =>
      expect(fakeSocket.emittedNames()).toContain("request_sync"),
    );
  });

  it("clears the old room when the server ends it for a restart", async () => {
    const { result } = renderHook(() => useGameSession(null));
    await waitFor(() => expect(fakeSocket.listenerCount("connect")).toBeGreaterThan(0));
    act(() => fakeSocket.connect());
    act(() => fakeSocket.fire("session_created", { sessionId: "sess-1" }));
    await waitFor(() => expect(result.current.sessionId).toBe("sess-1"));

    act(() => fakeSocket.fire("session_error", {
      message: "Room ended during a server restart. Check History for your focus time.",
    }));

    expect(result.current.sessionId).toBe("");
    expect(result.current.sessionStarted).toBe(false);
    expect(result.current.sessionError).toContain("Room ended");
    expect(localStorage.getItem("duodoro:session")).toBeNull();
  });

  // The core bug: after reconnect_failed nothing ever called socket.connect()
  // again, so a tab backgrounded past the retry budget was stranded even
  // though the server still held the slot.
  it("reconnects when the tab returns after the retry budget is exhausted", async () => {
    const { result } = renderHook(() => useGameSession(null));
    await waitFor(() => expect(fakeSocket.listenerCount("connect")).toBeGreaterThan(0));

    act(() => fakeSocket.connect());
    act(() => fakeSocket.fire("session_created", { sessionId: "sess-1" }));
    await waitFor(() => expect(result.current.sessionId).toBe("sess-1"));

    // Drop, then exhaust socket.io's automatic retries.
    act(() => fakeSocket.disconnect());
    act(() => fakeSocket.io.fire("reconnect_failed"));
    await waitFor(() => expect(result.current.connectionState).toBe("offline"));

    const before = fakeSocket.connectCalls;
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await waitFor(() =>
      expect(fakeSocket.connectCalls).toBeGreaterThan(before),
    );
  });

  it("reconnects when the browser reports the network is back", async () => {
    const { result } = renderHook(() => useGameSession(null));
    await waitFor(() => expect(fakeSocket.listenerCount("connect")).toBeGreaterThan(0));

    act(() => fakeSocket.connect());
    act(() => fakeSocket.fire("session_created", { sessionId: "sess-1" }));
    await waitFor(() => expect(result.current.sessionId).toBe("sess-1"));

    act(() => fakeSocket.disconnect());
    act(() => fakeSocket.io.fire("reconnect_failed"));
    await waitFor(() => expect(result.current.connectionState).toBe("offline"));

    const before = fakeSocket.connectCalls;
    act(() => window.dispatchEvent(new Event("online")));

    await waitFor(() => expect(fakeSocket.connectCalls).toBeGreaterThan(before));
  });

  // Manual reconnects don't emit the manager's "reconnect" event, so rejoin
  // must hang off plain "connect" or the player silently isn't in the session.
  it("rejoins the session on a manual reconnect, not just an automatic one", async () => {
    const { result } = renderHook(() => useGameSession(null));
    await waitFor(() => expect(fakeSocket.listenerCount("connect")).toBeGreaterThan(0));

    act(() => fakeSocket.connect());
    act(() =>
      fakeSocket.fire("sync_state", {
        mode: "pomodoro",
        phase: "waiting",
        focusDuration: 1500,
        breakDuration: 300,
        phaseStartTime: null,
        world: "forest",
        players: {},
        playerCount: 1,
        sessionId: "sess-1",
      }),
    );
    await waitFor(() => expect(result.current.sessionId).toBe("sess-1"));

    // joinSession caches the avatar/name the rejoin needs
    act(() =>
      result.current.joinSession("sess-1", {
        skinColor: "#e0ac69",
        hairStyle: "bob",
        hairColor: "#222222",
        eyeStyle: "normal",
        outfitColor: "#3355aa",
      }),
    );

    act(() => fakeSocket.disconnect());
    fakeSocket.emitted.length = 0;
    act(() => fakeSocket.connect());

    await waitFor(() =>
      expect(fakeSocket.emittedNames()).toContain("join_session"),
    );
  });

  // The banner's action used to be a full page reload — the only recovery
  // available when nothing could re-open the socket.
  it("exposes a reconnect() the connection banner can call", async () => {
    const { result } = renderHook(() => useGameSession(null));
    await waitFor(() => expect(fakeSocket.listenerCount("connect")).toBeGreaterThan(0));

    act(() => fakeSocket.connect());
    act(() => fakeSocket.disconnect());
    act(() => fakeSocket.io.fire("reconnect_failed"));
    await waitFor(() => expect(result.current.connectionState).toBe("offline"));

    const before = fakeSocket.connectCalls;
    act(() => result.current.reconnect());
    await waitFor(() => expect(fakeSocket.connectCalls).toBeGreaterThan(before));
  });

  it("clears an optimistic room id when the room is full", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useGameSession(null));
    await waitFor(() => expect(fakeSocket.listenerCount("connect")).toBeGreaterThan(0));
    act(() => fakeSocket.connect());

    act(() =>
      result.current.joinSession("full-room", {
        skinColor: "#e0ac69",
        hairStyle: "bob",
        hairColor: "#222222",
        eyeStyle: "normal",
        outfitColor: "#3355aa",
      }),
    );
    expect(result.current.sessionId).toBe("full-room");

    act(() => fakeSocket.fire("session_error", { message: "Session is full" }));

    await waitFor(() => expect(result.current.sessionId).toBe(""));
    expect(result.current.sessionError).toBe("Session is full");
    expect(result.current.playerCount).toBe(0);
  });

  it("restores the current room when switching to a full one is rejected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useGameSession(null));
    await waitFor(() => expect(fakeSocket.listenerCount("connect")).toBeGreaterThan(0));
    act(() => fakeSocket.connect());
    act(() =>
      fakeSocket.fire("sync_state", {
        mode: "pomodoro",
        phase: "waiting",
        focusDuration: 1500,
        breakDuration: 300,
        phaseStartTime: null,
        world: "forest",
        players: {},
        playerCount: 1,
        sessionId: "current-room",
      }),
    );
    await waitFor(() => expect(result.current.sessionId).toBe("current-room"));

    act(() =>
      result.current.joinSession("full-room", {
        skinColor: "#e0ac69",
        hairStyle: "bob",
        hairColor: "#222222",
        eyeStyle: "normal",
        outfitColor: "#3355aa",
      }),
    );
    // A visibility-triggered sync from the current room can arrive while the
    // attempted join is still awaiting authorization.
    act(() =>
      fakeSocket.fire("sync_state", {
        mode: "pomodoro",
        phase: "waiting",
        focusDuration: 1500,
        breakDuration: 300,
        phaseStartTime: null,
        world: "forest",
        players: {},
        playerCount: 1,
        sessionId: "current-room",
      }),
    );
    act(() => fakeSocket.fire("session_error", { message: "Session is full" }));

    await waitFor(() => expect(result.current.sessionId).toBe("current-room"));
    expect(sessionStorage.getItem("duodoro:session")).toBe("current-room");
    expect(localStorage.getItem("duodoro:session")).toBe("current-room");
    expect(fakeSocket.emittedNames()).toContain("request_sync");
  });

  it("joins with an opaque share token without treating it as a room id", async () => {
    const { result } = renderHook(() => useGameSession(null));
    await waitFor(() => expect(fakeSocket.listenerCount("connect")).toBeGreaterThan(0));
    act(() => fakeSocket.connect());

    act(() =>
      result.current.joinShareInvite("A".repeat(43), {
        skinColor: "#e0ac69",
        hairStyle: "bob",
        hairColor: "#222222",
        eyeStyle: "normal",
        outfitColor: "#3355aa",
      }),
    );

    const join = fakeSocket.emitted.find((entry) => entry.ev === "join_session");
    expect(join?.payload).toMatchObject({ shareToken: "A".repeat(43) });
    expect(join?.payload).not.toHaveProperty("sessionId");
    expect(result.current.sessionId).toBe("");
  });

  it("requests a share token for the current server-confirmed room", async () => {
    const { result } = renderHook(() => useGameSession(null));
    await waitFor(() => expect(fakeSocket.listenerCount("connect")).toBeGreaterThan(0));
    act(() => fakeSocket.connect());
    act(() => fakeSocket.fire("session_created", { sessionId: "sess-1" }));
    await waitFor(() => expect(result.current.sessionId).toBe("sess-1"));

    let tokenPromise!: Promise<string | null>;
    act(() => {
      tokenPromise = result.current.createShareInvite();
    });
    const request = fakeSocket.emitted.find(
      (entry) => entry.ev === "create_share_invite",
    );
    expect(request?.payload).toEqual({ sessionId: "sess-1" });
    act(() => request?.callback?.({ ok: true, token: "A".repeat(43) }));
    await expect(tokenPromise).resolves.toBe("A".repeat(43));
  });
});

describe("useGameSession pet stage", () => {
  beforeEach(() => {
    fakeSocket = createFakeSocket();
    sessionStorage.clear();
    localStorage.clear();
  });

  const sync = (players: Record<string, unknown>) => ({
    mode: "pomodoro" as const,
    phase: "waiting" as const,
    focusDuration: 1500,
    breakDuration: 300,
    phaseStartTime: null,
    world: "forest",
    players,
    playerCount: Object.keys(players).length,
    sessionId: "sess-1",
  });

  it("takes own petStage from sync_state", async () => {
    const { result } = renderHook(() => useGameSession(null));
    await waitFor(() => expect(fakeSocket.listenerCount("connect")).toBeGreaterThan(0));
    act(() => fakeSocket.connect());
    act(() =>
      fakeSocket.fire(
        "sync_state",
        sync({
          "sock-1": {
            avatar: {},
            displayName: "Me",
            pet: "cat",
            petStage: "full",
          },
        }),
      ),
    );
    await waitFor(() => expect(result.current.myPetStage).toBe("full"));
  });

  it("updates own stage when the server emits pet_changed for this socket", async () => {
    const { result } = renderHook(() => useGameSession(null));
    await waitFor(() => expect(fakeSocket.listenerCount("connect")).toBeGreaterThan(0));
    act(() => fakeSocket.connect());
    act(() =>
      fakeSocket.fire("pet_changed", {
        playerId: "sock-1",
        pet: "cat",
        petStage: "grown",
      }),
    );
    await waitFor(() => expect(result.current.myPetStage).toBe("grown"));
  });

  it("reads the partner's stage off their slot", async () => {
    const { result } = renderHook(() => useGameSession(null));
    await waitFor(() => expect(fakeSocket.listenerCount("connect")).toBeGreaterThan(0));
    act(() => fakeSocket.connect());
    act(() =>
      fakeSocket.fire(
        "sync_state",
        sync({
          "sock-1": { avatar: {}, displayName: "Me", pet: "cat", petStage: "young" },
          "sock-2": { avatar: {}, displayName: "Them", pet: "dog", petStage: "full" },
        }),
      ),
    );
    await waitFor(() => expect(result.current.partnerPet).toBe("dog"));
    expect(result.current.partnerPetStage).toBe("full");
  });
});
