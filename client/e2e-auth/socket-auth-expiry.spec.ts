import { createHmac, randomUUID } from "node:crypto";
import { test, expect, AUTH_STORAGE_KEY } from "./duoFixture";
import { localEnvironment } from "./localEnvironment";
import { onboard } from "./onboard";
import { RoomTransport } from "./roomTransport";

test("a real local token expires and refresh/rejoin preserves an active Flow round", async ({ duo }) => {
  test.setTimeout(90_000);
  localEnvironment(); // Fail closed: test signing is restricted to the local stack.
  const secret = process.env.SUPABASE_TEST_JWT_SECRET;
  if (!secret) throw new Error("Local signing configuration is missing. Run npm run test:e2e:auth.");
  const { a, roomCodes } = duo;
  const transport = new RoomTransport(); await transport.observe(a.page);
  await a.page.goto("/"); await onboard(a.page, "Expiry Alpha", `exa_${randomUUID().slice(0,8)}`);
  await a.page.getByRole("button", { name: "Focus", exact: true }).click();
  await a.page.getByRole("button", { name: "Flowmodoro", exact: true }).click();
  await a.page.getByRole("button", { name: "Start solo", exact: true }).click();
  await expect(a.page.getByRole("status", { name: "Session phase: focus" })).toBeVisible();
  const roomId = await a.page.evaluate(() => localStorage.getItem("duodoro:session"));
  expect(roomId).toBeTruthy(); roomCodes.add(roomId!);
  await expect.poll(() => transport.phase?.phase).toBe("focus");
  const phaseStartTime = transport.phase!.phaseStartTime;

  const body = a.session.access_token.split(".")[1];
  // The local Auth stack also accepts its CLI-provided legacy HS256 key.
  // Preserve the real user's claims/session ID while shortening only expiry.
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now()/1000);
  const payload = { ...JSON.parse(Buffer.from(body,"base64url").toString()), exp: now+15 };
  const unsigned = `${header}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  const access_token = `${unsigned}.${createHmac("sha256",secret).update(unsigned).digest("base64url")}`;
  // Keep the browser's storage freshness hint long-lived so its proactive
  // refresh does not mask the server's actual verified JWT expiry deadline.
  await a.page.evaluate(({ key, session }) => localStorage.setItem(key,JSON.stringify(session)), {
    key: AUTH_STORAGE_KEY, session: { ...a.session, access_token, expires_at: now+3600 },
  });
  const beforeReload = transport.syncs;
  await a.page.reload();
  await expect.poll(() => transport.syncs).toBeGreaterThan(beforeReload);
  await expect(a.page.getByRole("status", { name: "Session phase: focus" })).toBeVisible();
  const beforeExpiry = transport.syncs;
  await expect.poll(() => transport.authenticationExpirations, { timeout: 30_000 }).toBe(1);
  await expect.poll(() => transport.syncs, { timeout: 20_000 }).toBeGreaterThan(beforeExpiry);
  expect(transport.snapshot).toMatchObject({ sessionId: roomId, phase: "focus", phaseStartTime, completedRounds: 0, playerCount: 1 });
  await expect(a.page.getByText("RECONNECTING…", { exact: true })).toBeHidden();
  await expect(a.page.getByRole("button", { name: /Stop timer/ })).toBeEnabled();
});
