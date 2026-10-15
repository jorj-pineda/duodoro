import { EventEmitter } from "node:events";
import type { Page, WebSocketRoute } from "@playwright/test";
import { expect, it, vi } from "vitest";
import { RoomTransport } from "./roomTransport";

it("observes a real Socket.IO snapshot delivered in a batched polling response before WebSocket upgrade", async () => {
  const page = Object.assign(new EventEmitter(), { routeWebSocket: vi.fn() });
  const transport = new RoomTransport();
  await transport.observe(page as unknown as Page);
  const snapshot = { sessionId: "room", phase: "focus", phaseStartTime: 123 };
  page.emit("response", {
    url: () => "http://127.0.0.1:3301/socket.io/?EIO=4&transport=polling&sid=opaque",
    request: () => ({ method: () => "GET" }),
    text: async () => `2\x1e42${JSON.stringify(["sync_state", snapshot])}\x1e42${JSON.stringify(["phase_change", { phase: "focus" }])}`,
  });
  await vi.waitFor(() => expect(transport.syncs).toBe(1));
  expect(transport.snapshot).toEqual(snapshot); expect(transport.phase).toEqual({ phase: "focus" });
  expect(transport.upgrades).toBe(0);
});
it("keeps the WebSocket proxy transparent, counts upgrades and exposes the socket for real interruption", async () => {
  let connect!: (socket: WebSocketRoute) => void;
  const page = { on: vi.fn(), routeWebSocket: vi.fn((_match, callback) => { connect = callback; }) };
  const transport = new RoomTransport(); await transport.observe(page as unknown as Page);
  let fromBrowser!: (message: string) => void, fromServer!: (message: string) => void;
  const server = { send: vi.fn(), onMessage: vi.fn(callback => { fromServer = callback; }) };
  const socket = { connectToServer: () => server, send: vi.fn(), onMessage: vi.fn(callback => { fromBrowser = callback; }) };
  connect(socket as unknown as WebSocketRoute);
  fromBrowser("5"); expect(server.send).toHaveBeenCalledWith("5"); expect(transport.upgrades).toBe(1);
  const packet = '42["sync_state",{"phase":"break"}]';
  fromServer(packet); expect(socket.send).toHaveBeenCalledWith(packet);
  expect(transport.syncs).toBe(1); expect(transport.snapshot).toEqual({ phase: "break" }); expect(transport.socket).toBe(socket);
});
