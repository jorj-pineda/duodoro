import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, makeProfileRow, makeSession } from "./useAuth.testkit";

let fake: ReturnType<typeof createFakeSupabase>;

vi.mock("@/lib/supabase", () => ({ getSupabase: () => fake.sb }));

import { useAuth } from "./useAuth";

const AVATAR = {
  skinColor: "#FDDBB4",
  hairStyle: "bob" as const,
  hairColor: "#5C3317",
  eyeStyle: "normal" as const,
  outfitColor: "#3B5BDB",
};

beforeEach(() => {
  fake = createFakeSupabase();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAuth profile resolution", () => {
  it("takes the database row over a session-derived profile", async () => {
    fake.sessionResult.session = makeSession({ id: "user-1" });
    fake.selectResults.profile = {
      data: makeProfileRow({ username: "from-database", avatar_config: AVATAR }),
      error: null,
    };

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.appStep).toBe("home"));
    // The row is authoritative: the session profile is only a fallback for a
    // missing or slow row, and it never carries a real username or avatar.
    expect(result.current.profile?.username).toBe("from-database");
    expect(fake.calls.upserts).toHaveLength(0);
  });

  it("falls back to the session profile and inserts it when the row is missing", async () => {
    fake.sessionResult.session = makeSession({
      id: "user-abc",
      email: "river@example.com",
      user_metadata: { full_name: "River Song" },
    });
    fake.selectResults.profile = { data: null, error: null };

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.profile).not.toBeNull());
    // Provisional identity comes from the OAuth metadata, sanitised.
    expect(result.current.profile?.username).toBe("river");
    expect(result.current.profile?.display_name).toBe("River Song");
    // No avatar, so the user still has to design a character.
    expect(result.current.appStep).toBe("avatar");

    // The fallback insert must be idempotent — ignoreDuplicates makes it
    // insert-if-missing, so a row created by the signup trigger is never
    // overwritten with this generated username.
    expect(fake.calls.upserts).toHaveLength(1);
    expect(fake.calls.upserts[0]).toMatchObject({
      id: "user-abc",
      display_name: "River Song",
    });
  });

  it("derives a collision-resistant handle for the fallback insert", async () => {
    fake.sessionResult.session = makeSession({ id: "abcd-1234", email: "x@y.com" });
    fake.selectResults.profile = { data: null, error: null };

    renderHook(() => useAuth());

    await waitFor(() => expect(fake.calls.upserts).toHaveLength(1));
    const upsert = fake.calls.upserts[0] as {
      username: string;
      discriminator: string;
    };
    // The generated handle is the session-derived name plus part of the id, so
    // it is unlikely to collide with a real claimed username; the
    // discriminator is derived from the id for the same reason. Neither is
    // meant to be pretty — this row exists so the user has something to own.
    expect(upsert.username).toBe("x_abcd");
    expect(upsert.discriminator).toMatch(/^\d{4}$/);
    // `ignoreDuplicates` is the whole safety property: without it the conflict
    // path would overwrite a real claimed username with this generated one,
    // and would need UPDATE rights on columns only claim_username may touch.
    expect(fake.calls.upsertOptions[0]).toMatchObject({
      onConflict: "id",
      ignoreDuplicates: true,
    });
  });

  it("sanitises an OAuth handle down to the allowed characters", async () => {
    fake.sessionResult.session = makeSession({
      id: "user-xyz",
      user_metadata: { preferred_username: "River-Song!!" },
    });
    fake.selectResults.profile = { data: null, error: null };

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.profile).not.toBeNull());
    expect(result.current.profile?.username).toBe("riversong");
  });

  it("falls back to a provisional profile when the read throws", async () => {
    fake.sessionResult.session = makeSession({ id: "user-throw", email: "t@y.com" });
    // A rejected builder rather than a resolved error object: the catch branch
    // is a different path from the "no data" branch.
    fake.sb.from = () => {
      throw new Error("network down");
    };

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.profile).not.toBeNull());
    expect(result.current.profile?.id).toBe("user-throw");
    expect(result.current.appStep).toBe("avatar");
  });
});
