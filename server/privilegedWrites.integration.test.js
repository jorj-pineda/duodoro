import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { recordFocusSession } from "./focusRecorder.js";
import { fetchTotalFocusSeconds } from "./focusTotal.js";

// ─────────────────────────────────────────────────────────────────────────────
// The privileged writes, against a real database.
//
// `focusRecorder.test.js` and `focusTotal.test.js` prove what the server does
// with a *mock* client: it retries transient errors, parses the row, returns
// null when the total is unknowable. None of that shows the migration actually
// does what its comment says. The schema was inspected in production for both
// 020 and 022, but the round trip — an authenticated user claiming companion
// access, and a completed focus being recorded once — had never run anywhere
// except a unit test with a fake response.
//
// This closes that gap against the local stack from `supabase start`, using
// real `auth.users` rows (created with confirmed emails, exactly the state
// every OAuth user arrives in) and the real generated RPC contracts. It also
// drives `server/focusRecorder.js` and `server/focusTotal.js` themselves, not
// copies of their logic, so the module under test is the one that ships.
//
// Opt-in: skipped unless a local Supabase is reachable, because CI has no
// local stack. Set SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY to point it
// elsewhere (a staging project), never production — this creates and deletes
// real users.
//
//   cd server && npm run test:integration
//
// Everything it creates is tracked and removed in afterAll, including on
// failure. The email domain is example.com per RFC 2606, and no test asserts
// on a real person's data.
// ─────────────────────────────────────────────────────────────────────────────

const URL =
  process.env.SUPABASE_TEST_URL ?? "http://127.0.0.1:55321";
const SERVICE_KEY =
  process.env.SUPABASE_TEST_SERVICE_KEY ??
  // The published local development service-role key. Not a secret: it is the
  // shared default every `supabase start` emits, and it is useless against any
  // deployed project.
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON_KEY =
  process.env.SUPABASE_TEST_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const admin = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const createdUserIds = [];
/**
 * Sessions the harness wrote. Deleting a user cascades `session_participants`
 * but not `sessions` — a session has no owner column — so a run that only
 * deleted users would leave orphan rows behind. The checklist asks for
 * controlled test rows to be removed, and this is where that happens.
 */
const createdSessionIds = [];

/** A real confirmed user, the state every OAuth sign-in produces. */
async function makeUser(label) {
  const email = `duodoro-int-${label}-${Date.now()}-${createdUserIds.length}@example.com`;
  const password = "integration-test-password";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser(${label}): ${error.message}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email, password };
}

/** A client acting as that user, so RPCs run with the `authenticated` role. */
async function asUser(user) {
  const client = createClient(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw new Error(`signIn(${user.email}): ${error.message}`);
  return client;
}

let reachable = false;

beforeAll(async () => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${URL}/auth/v1/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    reachable = res.ok;
    if (!res.ok) throw new Error(`health returned ${res.status}`);
  } catch (error) {
    console.warn(
      `[integration] local Supabase not reachable at ${URL} — skipping. ` +
        `Run \`supabase start\` in the repository root. (${error.message})`,
    );
  }
});

afterAll(async () => {
  // Sessions first: deleting a user removes their participant links, but the
  // session row itself survives (no owner column), so it has to be removed
  // explicitly or every run leaves debris.
  for (const id of createdSessionIds) {
    await admin.from("session_participants").delete().eq("session_id", id);
    await admin.from("sessions").delete().eq("id", id);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

/**
 * Every test below needs the live stack. Vitest decides `runIf` at collection
 * time, which is before `beforeAll`, so the gate cannot be a `runIf` — it is
 * a per-test skip that still *fails* the one test whose job is to report that
 * nothing ran. A silent skip would be indistinguishable from a pass.
 */
function liveIt(name, fn) {
  it(name, async (ctx) => {
    if (!reachable) ctx.skip();
    await fn();
  });
}

describe("privileged writes, live", () => {
  it("is reachable, or says so", () => {
    // Passes when the stack is up. When it is not, this is the only test that
    // runs and it says so loudly rather than reporting a green empty suite.
    expect(reachable).toBe(true);
  });
});

describe("companion access (migration 020)", () => {
  liveIt("grants premium for a confirmed email and records the grant", async () => {
    const user = await makeUser("premium");
    const client = await asUser(user);

    const before = await admin
      .from("profiles")
      .select("is_premium")
      .eq("id", user.id)
      .single();
    expect(before.error).toBeNull();
    expect(before.data.is_premium).toBe(false);

    const { data: grant, error } = await client.rpc("claim_premium", {
      p_marketing_opt_in: false,
    });
    expect(error).toBeNull();
    expect(grant).toMatchObject({
      user_id: user.id,
      email: user.email,
      marketing_opt_in: false,
      source: "free_email_unlock",
    });

    // Both halves have to move together: a grant row without the flag is a
    // user who paid attention and got nothing, and the flag without a row is
    // premium with no record of where it came from.
    const after = await admin
      .from("profiles")
      .select("is_premium")
      .eq("id", user.id)
      .single();
    expect(after.data.is_premium).toBe(true);

    const row = await admin
      .from("premium_grants")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    expect(row.data).toMatchObject({
      user_id: user.id,
      email: user.email,
      source: "free_email_unlock",
    });
  });

  liveIt("is idempotent and lets consent change without touching granted_at", async () => {
    const user = await makeUser("premium-twice");
    const client = await asUser(user);

    const first = await client.rpc("claim_premium", {
      p_marketing_opt_in: false,
    });
    expect(first.error).toBeNull();
    const grantedAt = first.data.granted_at;

    const second = await client.rpc("claim_premium", {
      p_marketing_opt_in: true,
    });
    expect(second.error).toBeNull();
    expect(second.data.marketing_opt_in).toBe(true);
    // granted_at keeps meaning "when they first claimed", not "when they last
    // pressed the button".
    expect(second.data.granted_at).toBe(grantedAt);

    const count = await admin
      .from("premium_grants")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", user.id);
    expect(count.count).toBe(1);
  });

  liveIt("refuses a client write to the grant table directly", async () => {
    const user = await makeUser("premium-rls");
    const client = await asUser(user);

    // The RPC is the only way in (migration 010's convention). An insert that
    // succeeds here would make premium self-servable without a recorded email.
    const { error } = await client
      .from("premium_grants")
      .insert({ user_id: user.id, email: user.email });
    expect(error).not.toBeNull();
  });
});

describe("completed focus recording (migration 022)", () => {
  /** The exact payload `app.js` builds for one focus round. */
  function roundPayload(userIds, overrides = {}) {
    return {
      p_recording_key: crypto.randomUUID(),
      p_room_code: crypto.randomUUID(),
      p_world: "forest",
      p_focus_duration: 1500,
      p_break_duration: 300,
      p_actual_focus: 1500,
      p_completed: true,
      p_started_at: new Date().toISOString(),
      p_user_ids: userIds,
      ...overrides,
    };
  }

  /**
   * The shipping recorder, plus cleanup bookkeeping. Tests still call the real
   * module — this only remembers what it wrote so `afterAll` can remove it.
   */
  async function recordTracked(payload, options) {
    const result = await recordFocusSession(admin, payload, options);
    createdSessionIds.push(result.sessionId);
    return result;
  }

  liveIt("records one round for both participants through the shipping module", async () => {
    const a = await makeUser("focus-a");
    const b = await makeUser("focus-b");
    const payload = roundPayload([a.id, b.id]);

    const result = await recordTracked(payload);
    expect(result.inserted).toBe(true);

    const session = await admin
      .from("sessions")
      .select("id, room_code, world, actual_focus, completed, recording_key")
      .eq("recording_key", payload.p_recording_key)
      .single();
    expect(session.error).toBeNull();
    expect(session.data).toMatchObject({
      room_code: payload.p_room_code,
      world: "forest",
      actual_focus: 1500,
      completed: true,
    });

    // Both people, once each — the whole reason this is a transaction rather
    // than two requests.
    const participants = await admin
      .from("session_participants")
      .select("user_id")
      .eq("session_id", session.data.id);
    expect(participants.error).toBeNull();
    expect(
      participants.data.map((r) => r.user_id).sort(),
    ).toEqual([a.id, b.id].sort());
  });

  liveIt("is idempotent: a retry returns the same row, not a second one", async () => {
    const a = await makeUser("focus-idem");
    const payload = roundPayload([a.id]);

    const first = await recordTracked(payload);
    const retry = await recordTracked(payload);

    expect(first.inserted).toBe(true);
    expect(retry.inserted).toBe(false);
    // Same row — this is what makes a lost response safe to retry.
    expect(retry.sessionId).toBe(first.sessionId);

    const count = await admin
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("recording_key", payload.p_recording_key);
    expect(count.count).toBe(1);
  });

  liveIt("rejects the same key reused with different data", async () => {
    const a = await makeUser("focus-conflict");
    const payload = roundPayload([a.id]);

    await recordTracked(payload);

    // The key identifies one immutable round. Accepting different credit under
    // it would let a bug duplicate or inflate someone's history.
    await expect(
      recordFocusSession(
        admin,
        { ...payload, p_actual_focus: 900 },
        { retryDelays: [] },
      ),
    ).rejects.toThrow();
  });

  liveIt("feeds the pet total, and an incomplete round does not", async () => {
    const a = await makeUser("focus-total");

    await recordTracked(roundPayload([a.id]));
    const afterComplete = await fetchTotalFocusSeconds(admin, a.id);
    expect(afterComplete).toBe(1500);

    await recordTracked(
      roundPayload([a.id], { p_completed: false, p_actual_focus: 600 }),
    );
    // Only completed rows count, so the early stop's 600s must not appear.
    // This is the assertion that ties the recording path to pet growth.
    const afterIncomplete = await fetchTotalFocusSeconds(admin, a.id);
    expect(afterIncomplete).toBe(1500);
  });

  liveIt("shows the completed round once in the participant's own stats", async () => {
    const a = await makeUser("focus-stats");
    const payload = roundPayload([a.id], { p_actual_focus: 1200, p_focus_duration: 1200 });
    await recordTracked(payload);

    const client = await asUser(a);
    // The user's own surface — get_focus_stats reads auth.uid() and needs no
    // argument, which is why it (not total_focus_seconds) is what a client calls.
    const { data, error } = await client.rpc("get_focus_stats", { tz: "UTC" });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(Number(row.total_focus_time)).toBe(1200);
    expect(Number(row.sessions_completed)).toBe(1);
  });
});


