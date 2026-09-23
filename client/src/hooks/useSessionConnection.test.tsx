import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionConnection } from "./useSessionConnection";

function createFakeSocket() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const managerHandlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const on = (map: typeof handlers) =>
    (event: string, handler: (...args: unknown[]) => void) => {
      map.set(event, [...(map.get(event) ?? []), handler]);
    };
  const off = (map: typeof handlers) =>
    (event: string, handler: (...args: unknown[]) => void) => {
      map.set(event, (map.get(event) ?? []).filter((item) => item !== handler));
    };
  const socket = {
    id: "socket-1",
    connected: false,
    active: false,
    auth: {} as Record<string, unknown>,
    emitted: [] as { event: string; payload: unknown }[],
    connect: vi.fn(),
    disconnect: vi.fn(() => { socket.connected = false; }),
    emit: vi.fn((event: string, payload?: unknown) => {
      socket.emitted.push({ event, payload });
    }),
    on: on(handlers),
    off: off(handlers),
    io: {
      on: on(managerHandlers),
      off: off(managerHandlers),
    },
    fire(event: string, ...args: unknown[]) {
      if (event === "connect") socket.connected = true;
      if (event === "connect_error") socket.connected = false;
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
  };
  return socket;
}

let socket: ReturnType<typeof createFakeSocket>;
const getSession = vi.fn();
const refreshSession = vi.fn();

vi.mock("socket.io-client", () => ({ io: () => socket }));
vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ auth: { getSession, refreshSession } }),
}));

const options = () => ({
  getResumeSnapshot: () => null,
  registerSocketHandlers: vi.fn(),
});

describe("useSessionConnection", () => {
  beforeEach(() => {
    socket = createFakeSocket();
    getSession.mockReset().mockResolvedValue({
      data: { session: { access_token: "initial-token" } },
    });
    refreshSession.mockReset().mockResolvedValue({
      data: { session: { access_token: "fresh-token" } },
    });
  });

  it("reconnects explicitly after the server rejects an expired token", async () => {
    const config = options();
    const { result } = renderHook(() => useSessionConnection(config));
    await waitFor(() => expect(config.registerSocketHandlers).toHaveBeenCalled());

    await act(async () => {
      socket.fire("connect_error", new Error("Invalid or expired token"));
    });

    await waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(socket.auth).toEqual({ token: "fresh-token" }));
    expect(socket.connect).toHaveBeenCalledTimes(1);
    act(() => socket.fire("connect"));
    expect(result.current.connectionState).toBe("connected");
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("stops automatic recovery after a second authentication rejection", async () => {
    const config = options();
    const { result } = renderHook(() => useSessionConnection(config));
    await waitFor(() => expect(config.registerSocketHandlers).toHaveBeenCalled());

    await act(async () => {
      socket.fire("connect_error", new Error("Invalid or expired token"));
    });
    expect(socket.connect).toHaveBeenCalledTimes(1);

    act(() => socket.fire("connect_error", new Error("Invalid or expired token")));
    expect(result.current.connectionState).toBe("offline");
    expect(refreshSession).toHaveBeenCalledTimes(1);

    await act(async () => result.current.reconnect());
    expect(refreshSession).toHaveBeenCalledTimes(2);
    expect(socket.connect).toHaveBeenCalledTimes(2);
  });

  it("shows Retry when the token refresh fails, then recovers on Retry", async () => {
    refreshSession
      .mockResolvedValueOnce({ data: { session: null }, error: new Error("Unavailable") })
      .mockResolvedValueOnce({
        data: { session: { access_token: "recovered-token" } },
        error: null,
      });
    const config = options();
    const { result } = renderHook(() => useSessionConnection(config));
    await waitFor(() => expect(config.registerSocketHandlers).toHaveBeenCalled());

    await act(async () => {
      socket.fire("connect_error", new Error("Authentication required"));
    });
    expect(result.current.connectionState).toBe("offline");
    expect(socket.connect).not.toHaveBeenCalled();

    await act(async () => result.current.reconnect());
    expect(socket.auth).toEqual({ token: "recovered-token" });
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it("shows Retry when refresh throws", async () => {
    refreshSession.mockRejectedValueOnce(new Error("Network down"));
    const config = options();
    const { result } = renderHook(() => useSessionConnection(config));
    await waitFor(() => expect(config.registerSocketHandlers).toHaveBeenCalled());

    await act(async () => {
      socket.fire("connect_error", new Error("Invalid or expired token"));
    });
    expect(result.current.connectionState).toBe("offline");
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it("does not reconnect after unmount while refresh is pending", async () => {
    let finishRefresh!: (value: unknown) => void;
    refreshSession.mockReturnValueOnce(new Promise((resolve) => {
      finishRefresh = resolve;
    }));
    const config = options();
    const hook = renderHook(() => useSessionConnection(config));
    await waitFor(() => expect(config.registerSocketHandlers).toHaveBeenCalled());

    act(() => socket.fire("connect_error", new Error("Invalid or expired token")));
    hook.unmount();
    await act(async () => {
      finishRefresh({ data: { session: { access_token: "late-token" } }, error: null });
    });

    expect(socket.connect).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it("coalesces a manual Retry while token refresh is in flight", async () => {
    let finishRefresh!: (value: unknown) => void;
    refreshSession.mockReturnValueOnce(new Promise((resolve) => {
      finishRefresh = resolve;
    }));
    const config = options();
    const { result } = renderHook(() => useSessionConnection(config));
    await waitFor(() => expect(config.registerSocketHandlers).toHaveBeenCalled());

    act(() => socket.fire("connect_error", new Error("Invalid or expired token")));
    act(() => result.current.reconnect());
    expect(refreshSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishRefresh({ data: { session: { access_token: "fresh-token" } }, error: null });
    });
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it("disconnects its one socket when the consumer unmounts", async () => {
    const config = options();
    const hook = renderHook(() => useSessionConnection(config));
    await waitFor(() => expect(config.registerSocketHandlers).toHaveBeenCalledWith(socket));

    hook.unmount();

    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });
});
