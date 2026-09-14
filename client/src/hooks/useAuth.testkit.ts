import { vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// A fake Supabase client for `useAuth`, shaped like the pieces the hook
// actually touches.
//
// The hook owns every screen transition in the app and had no tests at all, so
// these are not one-off fixtures: the fake is shared across the auth suites and
// deliberately models the *awkward* parts of the real client — the query
// builders are thenable but not promises, `single()` resolves rather than
// throws, and `onAuthStateChange` returns an unsubscribe that the hook's
// cleanup must call.
// ─────────────────────────────────────────────────────────────────────────────

export type QueryResult = { data: unknown; error: unknown };

export interface FakeUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

export function makeSession(user: Partial<FakeUser> = {}): Session {
  return {
    access_token: "token",
    refresh_token: "refresh",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: {
      id: "user-1",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
      ...user,
    },
  } as Session;
}

export function makeProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    username: "river",
    discriminator: "0001",
    username_changed: false,
    display_name: "River",
    display_name_changed_at: null,
    avatar_config: null,
    is_premium: false,
    current_room: null,
    current_session_id: null,
    current_world_id: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createFakeSupabase() {
  /** Result returned by the next `from(...).select(...)...` chain. */
  const selectResults = {
    profile: { data: null, error: null } as QueryResult,
    presence: { data: null, error: null } as QueryResult,
    update: { data: null, error: null } as QueryResult,
  };

  const calls = {
    upserts: [] as unknown[],
    updates: [] as { values: unknown }[],
    selectColumns: [] as string[],
  };

  let selectKind: "profile" | "presence" = "profile";
  let lastUpdate: unknown = null;

  function builder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    b.select = (columns?: string) => {
      if (columns) {
        calls.selectColumns.push(columns);
        // `useAuth` reads two different shapes from `profiles`: the whole row
        // for the session, and these four presence columns for a refresh. The
        // column list is what tells them apart, so the fake routes on it.
        if (columns.includes("current_session_id")) selectKind = "presence";
      }
      return b;
    };
    b.eq = () => b;
    b.single = () =>
      Promise.resolve(
        selectKind === "presence" ? selectResults.presence : selectResults.profile,
      );
    b.update = (values: unknown) => {
      lastUpdate = values;
      calls.updates.push({ values });
      return b;
    };
    // A Supabase query builder is thenable without being a Promise; the hook
    // awaits it either way, so the fake has to be too.
    b.then = (
      resolve: (r: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(selectResults.update).then(resolve, reject);
    return b;
  }

  const sessionResult: { session: Session | null } = { session: null };
  let getSessionRejects: Error | null = null;

  const authHandlers: Array<
    (event: string, session: Session | null) => void | Promise<void>
  > = [];
  const unsubscribe = vi.fn();

  const sb = {
    from: () => {
      selectKind = "profile";
      const b = builder();
      b.upsert = (values: unknown) => {
        calls.upserts.push(values);
        return Promise.resolve({ error: null });
      };
      return b;
    },
    auth: {
      getSession: () =>
        getSessionRejects
          ? Promise.reject(getSessionRejects)
          : Promise.resolve({ data: { session: sessionResult.session } }),
      onAuthStateChange: (
        handler: (event: string, session: Session | null) => void | Promise<void>,
      ) => {
        authHandlers.push(handler);
        return { data: { subscription: { unsubscribe } } };
      },
    },
  };

  return {
    sb,
    selectResults,
    calls,
    sessionResult,
    authHandlers,
    unsubscribe,
    setGetSessionError: (error: Error | null) => {
      getSessionRejects = error;
    },
    get lastUpdate() {
      return lastUpdate;
    },
  };
}
