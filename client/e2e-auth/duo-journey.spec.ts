import { randomUUID } from "node:crypto";
import type { Page, WebSocketRoute } from "@playwright/test";
import type { SyncPayload, PhaseChangePayload } from "../src/lib/sessionTypes";
import { test, expect, AUTH_STORAGE_KEY, requireSuccess } from "./duoFixture";
import { APP_ORIGIN, SOCKET_ORIGIN } from "./localEnvironment";

// A transparent WebSocket proxy observes the shipping protocol and lets us drop
// a real transport. It never fabricates auth responses, room state or phases.
class RoomTransport {
  socket?: WebSocketRoute;
  upgrades = 0;
  syncs = 0;
  snapshot?: SyncPayload;
  phase?: PhaseChangePayload;

  async observe(page: Page) {
    await page.routeWebSocket((url) => url.port === "3301" && url.pathname === "/socket.io/", (socket) => {
      this.socket = socket;
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        if (message === "5") this.upgrades++;
        server.send(message);
      });
      server.onMessage((message) => {
        if (typeof message === "string" && message.startsWith("42[")) {
          const [event, payload] = JSON.parse(message.slice(2));
          if (event === "sync_state") { this.snapshot = payload; this.syncs++; }
          if (event === "phase_change") this.phase = payload;
        }
        socket.send(message);
      });
    });
  }
}

async function onboard(page: Page, name: string, username: string) {
  await expect(page.getByRole("heading", { name: "Design your hero" })).toBeVisible();
  await page.getByRole("textbox", { name: "Display name" }).fill(name);
  await page.getByRole("textbox", { name: "Username", exact: true }).fill(username);
  await page.getByRole("button", { name: "Ready to focus →" }).click();
}

test("two users preserve an invite, complete focus once, reconnect and go again", async ({ duo, request }) => {
  const { a, b, admin, roomCodes } = duo;
  const alpha = "Duo Alpha";
  const beta = "Duo Beta";
  const usernameSuffix = randomUUID().slice(0, 8);
  const transportA = new RoomTransport();
  const transportB = new RoomTransport();
  await transportA.observe(a.page);
  await transportB.observe(b.page);
  const pageErrors: string[] = [];
  a.page.on("pageerror", () => pageErrors.push("actor A page error"));
  b.page.on("pageerror", () => pageErrors.push("actor B page error"));

  const ready = await request.get(`${SOCKET_ORIGIN}/ready`);
  expect(ready.ok()).toBe(true);
  expect(await ready.json()).toMatchObject({ ok: true, dependencies: { database: "ready" } });

  await test.step("A onboards and creates a real room and bearer invite", async () => {
    await a.page.goto("/");
    await onboard(a.page, alpha, `e2ea_${usernameSuffix}`);
    await expect(a.page.getByRole("button", { name: "Focus", exact: true })).toBeVisible();
    await expect.poll(() => transportA.upgrades).toBeGreaterThan(0);
    await a.page.getByRole("button", { name: "Focus", exact: true }).click();
    await expect(a.page.getByRole("button", { name: "Start solo", exact: true })).toBeVisible();
    await a.page.getByRole("button", { name: "Copy invite link" }).click();
    await expect(a.page.getByText("Invite link copied!")).toBeVisible();
  });
  const roomId = await a.page.evaluate(() => localStorage.getItem("duodoro:session"));
  if (!roomId) throw new Error("A did not receive a server room ID.");
  roomCodes.add(roomId);
  const inviteUrl = await a.page.evaluate(() => navigator.clipboard.readText());
  expect(inviteUrl).toMatch(/^http:\/\/127\.0\.0\.1:3300\/join\/[A-Za-z0-9_-]{43}$/);

  await test.step("signed-out B preserves the invite through real Auth bootstrap and onboarding", async () => {
    await b.page.goto(inviteUrl);
    await expect(b.page.getByRole("heading", { name: "Focus together" })).toBeVisible();
    await expect.poll(() => b.page.evaluate(() => !!sessionStorage.getItem("duodoro:pending-share-invite"))).toBe(true);
    // Only the external OAuth exchange is replaced. This is a real local Auth
    // session; the browser and socket server still load/verify it normally.
    await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
    await b.page.reload();
    await onboard(b.page, beta, `e2eb_${usernameSuffix}`);
    await expect(a.page.getByRole("button", { name: "Start session", exact: true })).toBeVisible();
    await expect(b.page.getByRole("button", { name: "Start session", exact: true })).toBeVisible();
    await expect(a.page.getByText(beta, { exact: true })).toBeVisible();
    await expect(b.page.getByText(alpha, { exact: true })).toBeVisible();
    expect(await b.page.evaluate(() => localStorage.getItem("duodoro:session"))).toBe(roomId);
    expect(await b.page.evaluate(() => sessionStorage.getItem("duodoro:pending-share-invite"))).toBeNull();
    expect(transportA.snapshot?.world).toBe(transportB.snapshot?.world);
  });

  let startedAt: number | null = null;
  await test.step("the UI starts a synchronized five-minute Pomodoro and one-minute break", async () => {
    await a.page.getByRole("slider", { name: "Focus", exact: true }).fill("5");
    await a.page.getByRole("slider", { name: "Break", exact: true }).fill("1");
    await a.page.getByRole("button", { name: "Start session", exact: true }).click();
    for (const actor of [a, b]) {
      await expect(actor.page.getByRole("status", { name: "Session phase: focus" })).toBeVisible();
      await expect(actor.page.getByRole("timer")).toContainText(/4:5\d|5:00/);
    }
    await expect.poll(() => transportB.phase?.phase).toBe("focus");
    expect(transportA.phase).toEqual(transportB.phase);
    expect(transportB.phase).toMatchObject({ mode: "pomodoro", focusDuration: 300, breakDuration: 60, completedRounds: 0 });
    startedAt = transportB.phase!.phaseStartTime;
  });

  await test.step("B refreshes and recovers a dropped transport without resetting the round", async () => {
    const beforeReload = transportB.syncs;
    await b.page.reload();
    await expect(b.page.getByRole("status", { name: "Session phase: focus" })).toBeVisible();
    await expect.poll(() => transportB.syncs).toBeGreaterThan(beforeReload);
    expect(transportB.snapshot).toMatchObject({ sessionId: roomId, phase: "focus", phaseStartTime: startedAt, completedRounds: 0 });
    expect(Object.keys(transportB.snapshot!.players)).toHaveLength(2);
    await expect.poll(() => transportB.upgrades).toBeGreaterThan(1);
    const beforeDrop = transportB.upgrades;
    const beforeSync = transportB.syncs;
    await transportB.socket!.close({ code: 1012, reason: "Local test connection interruption" });
    await expect.poll(() => transportB.upgrades, { timeout: 30_000 }).toBeGreaterThan(beforeDrop);
    await expect.poll(() => transportB.syncs).toBeGreaterThan(beforeSync);
    expect(transportB.snapshot).toMatchObject({ sessionId: roomId, phase: "focus", phaseStartTime: startedAt, completedRounds: 0 });
    expect(Object.keys(transportB.snapshot!.players)).toHaveLength(2);
    await expect(b.page.getByText("RECONNECTING…", { exact: true })).toBeHidden();
    await expect(a.page.getByRole("button", { name: /Start/ })).toHaveCount(0);
  });

  await test.step("real completion is recorded once and exposed in each user's history", async () => {
    await Promise.all([a, b].map((actor) =>
      expect(actor.page.getByRole("status", { name: "Session phase: celebration" })).toBeVisible({ timeout: 330_000 }),
    ));
    for (const actor of [a, b]) {
      await expect(actor.page.getByText("1 round completed in this room", { exact: true })).toBeVisible();
    }
    await expect.poll(async () => {
      const result = await admin.from("sessions").select("id").eq("room_code", roomId).eq("completed", true);
      requireSuccess(result.error, "Read completed test sessions");
      return result.data?.length;
    }).toBe(1);
    const recorded = await admin.from("sessions").select("id, actual_focus, focus_duration, break_duration").eq("room_code", roomId).eq("completed", true).single();
    requireSuccess(recorded.error, "Read completed focus record");
    expect(recorded.data).toMatchObject({ actual_focus: 300, focus_duration: 300, break_duration: 60 });
    const participants = await admin.from("session_participants").select("user_id").eq("session_id", recorded.data!.id);
    requireSuccess(participants.error, "Read focus participants");
    expect(participants.data?.map((row) => row.user_id).sort()).toEqual([a.id, b.id].sort());
    for (const [actor, partnerName] of [[a, beta], [b, alpha]] as const) {
      const history = await actor.client.rpc("get_recent_sessions", { lim: 20 });
      requireSuccess(history.error, "Read user history through RLS");
      const rows = history.data?.filter((row) => row.room_code === roomId);
      expect(rows).toHaveLength(1);
      expect(rows![0]).toMatchObject({ id: recorded.data!.id, completed: true, actual_focus: 300, partner_name: partnerName });
      const stats = await actor.client.rpc("get_focus_stats", { tz: "UTC" });
      requireSuccess(stats.error, "Read user stats");
      expect(Number(stats.data?.[0].sessions_completed)).toBe(1);
      await actor.page.getByRole("button", { name: "Toggle stats panel" }).click();
      await actor.page.getByRole("tab", { name: /^history$/i }).click();
      await expect(actor.page.getByRole("tabpanel")).toContainText(`5m focus with ${partnerName}`);
      await expect(actor.page.getByRole("tabpanel").getByText(`5m focus with ${partnerName}`, { exact: true })).toHaveCount(1);
      await actor.page.getByRole("button", { name: "Close", exact: true }).click();
    }
  });

  await test.step("the break returns both users to ready and B can Go again with the same settings", async () => {
    for (const actor of [a, b]) {
      await expect(actor.page.getByRole("status", { name: "Session phase: ready" })).toBeVisible({ timeout: 90_000 });
      await expect(actor.page.getByRole("button", { name: "Go again", exact: true })).toBeVisible();
    }
    await b.page.getByRole("button", { name: "Go again", exact: true }).click();
    for (const actor of [a, b]) await expect(actor.page.getByRole("status", { name: "Session phase: focus" })).toBeVisible();
    await expect.poll(() => transportB.phase?.phase).toBe("focus");
    expect(transportB.phase).toMatchObject({ completedRounds: 1, mode: "pomodoro", focusDuration: 300, breakDuration: 60 });
    expect(transportB.phase!.phaseStartTime).toBeGreaterThan(startedAt!);
    expect(await b.page.evaluate(() => localStorage.getItem("duodoro:session"))).toBe(roomId);
    await a.page.getByRole("button", { name: "Stop timer", exact: true }).click();
    for (const actor of [a, b]) await expect(actor.page.getByRole("status", { name: "Session phase: waiting" })).toBeVisible();
    await expect.poll(async () => {
      const result = await admin.from("sessions").select("completed").eq("room_code", roomId);
      requireSuccess(result.error, "Read stopped repeat round");
      return result.data?.map((row) => row.completed).sort();
    }).toEqual([false, true]);
  });

  await test.step("leaving clears membership and restores both tab titles", async () => {
    for (const actor of [a, b]) {
      await actor.page.getByRole("button", { name: /Leave room/ }).click();
      await expect(actor.page.getByRole("button", { name: "Focus", exact: true })).toBeVisible();
      await expect(actor.page).toHaveTitle("Duodoro — Focus together, anywhere.");
    }
    await expect.poll(async () => {
      const profiles = await admin.from("profiles").select("current_session_id").in("id", [a.id, b.id]);
      requireSuccess(profiles.error, "Read test presence");
      return profiles.data?.length === 2 && profiles.data.every((profile) => profile.current_session_id === null);
    }).toBe(true);
    expect(pageErrors).toEqual([]);
    expect(a.page.url()).toBe(`${APP_ORIGIN}/`);
  });
});
