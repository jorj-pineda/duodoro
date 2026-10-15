import type { Page, WebSocketRoute } from "@playwright/test";
import type { SyncPayload, PhaseChangePayload } from "../src/lib/sessionTypes";

// Observe both Engine.IO transports: recovery may arrive over polling before
// the WebSocket probe finishes. The proxy also lets a journey drop a real socket.
// Neither path fabricates auth responses, room state or phases.
export class RoomTransport {
  socket?: WebSocketRoute;
  upgrades = 0;
  syncs = 0;
  snapshot?: SyncPayload;
  snapshots: SyncPayload[] = [];
  phase?: PhaseChangePayload;

  async observe(page: Page) {
    page.on("response", async response => {
      const url = new URL(response.url());
      if (url.port !== "3301" || url.pathname !== "/socket.io/" || url.searchParams.get("transport") !== "polling"
        || response.request().method() !== "GET") return;
      // Navigation can cancel an old polling response before its body is read.
      const body = await response.text().catch(() => null);
      if (body !== null) this.receive(body);
    });
    await page.routeWebSocket((url) => url.port === "3301" && url.pathname === "/socket.io/", (socket) => {
      this.socket = socket;
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        if (message === "5") this.upgrades++;
        server.send(message);
      });
      server.onMessage((message) => {
        if (typeof message === "string") this.receive(message);
        socket.send(message);
      });
    });
  }

  private receive(body: string) {
    for (const packet of body.split("\x1e")) {
      if (!packet.startsWith("42[")) continue;
      const [event, payload] = JSON.parse(packet.slice(2));
      if (event === "sync_state") { this.snapshot = payload; this.snapshots.push(payload); this.syncs++; }
      if (event === "phase_change") this.phase = payload;
    }
  }
}
