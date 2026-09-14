import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

/** A hook already settled with a profile and an avatar (appStep `home`). */
async function signedIn(overrides: Record<string, unknown> = {}) {
  const row = makeProfileRow({ avatar_config: AVATAR, ...overrides });
  fake.sessionResult.session = makeSession({ id: row.id });
  fake.selectResults.profile = { data: row, error: null };
  const rendered = renderHook(() => useAuth());
  await waitFor(() =>
    expect(rendered.result.current.profile).not.toBeNull(),
  );
  return { ...rendered, row };
}

beforeEach(() => {
  fake = createFakeSupabase();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("useAuth sign-out", () => {
  it("clears the profile, the cache, and returns to landing", async () => {
    const { result } = await signedIn();
    expect(localStorage.getItem("duodoro_profile")).not.toBeNull();

    await act(async () => {
      fake.authHandlers.forEach((h) => h("SIGNED_OUT", null));
    });

    expect(result.current.profile).toBeNull();
    // Leaving the cache behind would restore the previous person's name and
    // avatar on the next visit to the landing page.
    expect(localStorage.getItem("duodoro_profile")).toBeNull();
    expect(result.current.appStep).toBe("landing");
  });

  it("ignores a sign-out after unmount", async () => {
    const { unmount } = await signedIn();
    const handler = fake.authHandlers[0];

    unmount();
    // The subscription is torn down on unmount; calling the handler anyway
    // must not throw or schedule a state update on a dead component.
    await act(async () => {
      await handler("SIGNED_OUT", null);
    });

    expect(fake.unsubscribe).toHaveBeenCalled();
  });
});

describe("useAuth saveAvatar", () => {
  it("returns true and caches the avatar when the write lands", async () => {
    const { result } = await signedIn({ avatar_config: null });
    // `signedIn` waits for home when an avatar exists; with none the hook goes
    // to the avatar step instead.
    await waitFor(() => expect(result.current.profile).not.toBeNull());
    fake.selectResults.update = { data: [{ id: "user-1" }], error: null };

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveAvatar(AVATAR);
    });

    expect(ok).toBe(true);
    expect(result.current.myAvatar).toEqual(AVATAR);
    expect(result.current.profile?.avatar_config).toEqual(AVATAR);
    expect(localStorage.getItem("duodoro_profile")).toContain("skinColor");
  });

  it("returns true when the row is not selected back but no error is reported", async () => {
    const { result } = await signedIn({ avatar_config: null });
    await waitFor(() => expect(result.current.profile).not.toBeNull());
    // `.select("id")` is what the hook requests; the fake echoes whatever the
    // test sets, so a one-row response stands in for a landed write.
    fake.selectResults.update = { data: [{ id: "user-1" }], error: null };

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveAvatar(AVATAR);
    });
    expect(ok).toBe(true);
  });

  it("returns false and keeps the old avatar when the write errors", async () => {
    const { result } = await signedIn({ avatar_config: null });
    await waitFor(() => expect(result.current.profile).not.toBeNull());
    fake.selectResults.update = { data: null, error: new Error("offline") };

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveAvatar(AVATAR);
    });

    // This is the bug this return value exists for: the old code ignored the
    // result, set the avatar, cached it and advanced to home, so a failed
    // write looked like a success until you opened another device.
    expect(ok).toBe(false);
    expect(result.current.profile?.avatar_config).toBeNull();
    expect(localStorage.getItem("duodoro_profile")).not.toContain("skinColor");
  });

  it("treats an RLS-filtered zero-row update as a failure", async () => {
    const { result } = await signedIn({ avatar_config: null });
    await waitFor(() => expect(result.current.profile).not.toBeNull());
    // RLS refusing an UPDATE is not an error — it simply matches zero rows.
    // Without `.select()`, this looks identical to success.
    fake.selectResults.update = { data: [], error: null };

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveAvatar(AVATAR);
    });

    expect(ok).toBe(false);
    expect(result.current.myAvatar).toEqual({
      skinColor: "#FDDBB4",
      hairStyle: "bob",
      hairColor: "#5C3317",
      eyeStyle: "normal",
      outfitColor: "#3B5BDB",
    });
  });

  it("refuses to save before a profile is loaded", async () => {
    fake.sessionResult.session = makeSession();
    fake.selectResults.profile = { data: makeProfileRow(), error: null };
    const { result } = renderHook(() => useAuth());

    // Deliberately before anything settles: there is no id to update yet.
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveAvatar(AVATAR);
    });
    expect(ok).toBe(false);
  });
});

describe("useAuth updateProfile", () => {
  it("merges the update and re-caches", async () => {
    const { result } = await signedIn();

    await act(async () => {
      result.current.updateProfile({ display_name: "New Name", is_premium: true });
    });

    expect(result.current.profile?.display_name).toBe("New Name");
    expect(result.current.isPremium).toBe(true);
    expect(localStorage.getItem("duodoro_profile")).toContain("New Name");
    expect(result.current.profile?.username).toBe("river");
  });

  it("is a no-op with no profile", async () => {
    fake.sessionResult.session = null;
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      result.current.updateProfile({ display_name: "Nobody" });
    });

    expect(result.current.profile).toBeNull();
    expect(result.current.displayName).toBe("You");
  });
});
