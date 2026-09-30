import { randomUUID } from "node:crypto";
import { test as base, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types";
import { APP_ORIGIN, localEnvironment } from "./localEnvironment";

export const AUTH_STORAGE_KEY = "sb-127-auth-token";
type LocalClient = SupabaseClient<Database>;
type Actor = { id: string; client: LocalClient; session: Session; page: Page };

export function requireSuccess(error: unknown, operation: string) {
  if (error) throw new Error(`${operation} failed against local Supabase.`);
}

export const test = base.extend<{
  duo: { a: Actor; b: Actor; admin: LocalClient; roomCodes: Set<string> };
}>({
  duo: async ({ browser }, provideDuo, testInfo) => {
    const local = localEnvironment();
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    const admin = createClient<Database>(local.url, local.serviceKey, options);
    const userIds: string[] = [];
    const roomCodes = new Set<string>();
    const contexts: { label: string; context: BrowserContext; page: Page }[] = [];
    const runId = randomUUID();

    async function actor(label: "a" | "b", authenticated: boolean): Promise<Actor> {
      const email = `duodoro-browser-${runId}-${label}@example.com`;
      const password = randomUUID();
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      requireSuccess(created.error, "Create disposable user");
      if (!created.data.user) throw new Error("Local Auth did not create a user.");
      const id = created.data.user.id;
      userIds.push(id);
      const client = createClient<Database>(local.url, local.anonKey, options);
      const signedIn = await client.auth.signInWithPassword({ email, password });
      requireSuccess(signedIn.error, "Sign in disposable user");
      const session = signedIn.data.session;
      if (!session) throw new Error("Local Auth did not issue a session.");
      const context = await browser.newContext({
        baseURL: APP_ORIGIN,
        viewport: { width: 1280, height: 800 },
        storageState: {
          cookies: [],
          origins: [{ origin: APP_ORIGIN, localStorage: [
            { name: "duodoro-muted", value: "true" },
            ...(authenticated ? [{ name: AUTH_STORAGE_KEY, value: JSON.stringify(session) }] : []),
          ] }],
        },
      });
      const page = await context.newPage();
      contexts.push({ label, context, page });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP_ORIGIN });
      return { id, client, session, page };
    }

    try {
      const a = await actor("a", true);
      const b = await actor("b", false);
      await provideDuo({ a, b, admin, roomCodes });
    } finally {
      // Save per-actor evidence before cleanup changes the page. Auth state stays
      // in memory; retained traces only contain disposable local credentials.
      const failures: string[] = [];
      for (const { label, context, page } of contexts) {
        try {
          const failed = testInfo.status !== testInfo.expectedStatus;
          if (failed && !page.isClosed()) {
            const path = testInfo.outputPath(`actor-${label}.png`);
            await page.screenshot({ path, fullPage: true });
            await testInfo.attach(`actor-${label}`, { path, contentType: "image/png" });
          }
          const tracePath = failed ? testInfo.outputPath(`actor-${label}-trace.zip`) : undefined;
          await context.tracing.stop({ path: tracePath });
          if (tracePath) await testInfo.attach(`actor-${label}-trace`, { path: tracePath, contentType: "application/zip" });
        } catch { failures.push("capture browser evidence"); }
        try {
          const leave = page.getByRole("button", { name: /Leave room/ });
          if (!page.isClosed() && await leave.count()) await leave.click({ timeout: 5000 });
        } catch { failures.push("leave test room"); }
        try { await context.close(); } catch { failures.push("close browser context"); }
      }

      // A user cascade removes participant links, but not sessions. Find only
      // rows linked to this run's users/rooms and remove sessions first.
      const sessionIds = new Set<string>();
      if (userIds.length) {
        const linked = await admin.from("session_participants").select("session_id").in("user_id", userIds);
        if (linked.error) failures.push("find participant records");
        linked.data?.forEach((row) => sessionIds.add(row.session_id));
      }
      if (roomCodes.size) {
        const rooms = await admin.from("sessions").select("id").in("room_code", [...roomCodes]);
        if (rooms.error) failures.push("find room records");
        rooms.data?.forEach((row) => sessionIds.add(row.id));
      }
      if (sessionIds.size) {
        const deleted = await admin.from("sessions").delete().in("id", [...sessionIds]).select("id");
        if (deleted.error || deleted.data?.length !== sessionIds.size) failures.push("delete session records");
      }
      for (const id of userIds) {
        const deleted = await admin.auth.admin.deleteUser(id);
        if (deleted.error) failures.push("delete disposable user");
      }
      if (roomCodes.size) {
        const remaining = await admin.from("sessions").select("id").in("room_code", [...roomCodes]);
        if (remaining.error || remaining.data?.length !== 0) failures.push("verify session cleanup");
      }
      if (userIds.length) {
        const remaining = await admin.from("profiles").select("id").in("id", userIds);
        if (remaining.error || remaining.data?.length !== 0) failures.push("verify user cleanup");
      }
      if (failures.length) throw new Error(`Local browser fixture cleanup failed: ${failures.join(", ")}.`);
    }
  },
});

export { expect } from "@playwright/test";
