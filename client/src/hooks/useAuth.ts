"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_AVATAR,
  type AvatarConfig,
} from "@/lib/avatarData";
import { getSupabase } from "@/lib/supabase";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { profileFromRow, type Profile } from "@/lib/types";
import type { Json } from "@/lib/database.types";
import { normalizeAvatarConfig } from "@/lib/storedData";
import type { AppStep } from "@/lib/sessionTypes";

const PROFILE_CACHE_KEY = "duodoro_profile";

function fallbackDiscriminator(userId: string): string {
  const seed = Number.parseInt(userId.replaceAll("-", "").slice(0, 8), 16);
  return (seed % 10_000).toString().padStart(4, "0");
}

function cacheProfile(p: Profile) {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p));
  } catch {}
}

/**
 * The cached profile, normalized rather than cast.
 *
 * This was `JSON.parse(raw) as Profile`, which trusts three things that are not
 * guaranteed: that the blob is the *current* shape (it survives deploys, so an
 * older version's fields are plausible), that it has not been hand-edited, and
 * that its `avatar_config` is a valid one. That last one matters most — the
 * cached avatar is what `createSession`/`joinSession`/`sendInvite` send, so a
 * malformed value is a character the partner renders differently from its owner
 * until the server's own validation rejects it.
 *
 * The repair mirrors `profileFromRow`: apply the same nullable-column defaults
 * the database row would have, and drop an avatar that does not validate. A
 * cache that cannot be repaired to something coherent is discarded, because the
 * fetch that follows will supply the real row.
 *
 * `id` is the one field that cannot be defaulted — it is what the cache is
 * keyed against — so a cached profile without one is not usable.
 */
function getCachedProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const row = parsed as Record<string, unknown>;
    // `id` is the one field that cannot be defaulted — the cache is keyed
    // against it — so a blob without one is not usable. Everything else has a
    // sensible null and is normalized by `profileFromRow`, exactly as it is for
    // a database row.
    if (typeof row.id !== "string" || row.id.length === 0) return null;
    const avatar = normalizeAvatarConfig(row.avatar_config);
    return profileFromRow({
      id: row.id,
      username: typeof row.username === "string" ? row.username : "",
      discriminator:
        typeof row.discriminator === "string" ? row.discriminator : "",
      username_changed:
        typeof row.username_changed === "boolean" ? row.username_changed : null,
      display_name:
        typeof row.display_name === "string" ? row.display_name : null,
      display_name_changed_at:
        typeof row.display_name_changed_at === "string"
          ? row.display_name_changed_at
          : null,
      // An avatar that fails validation becomes null, which sends the user
      // through the avatar step again rather than into a broken character.
      avatar_config: avatar as Json | null,
      is_premium: typeof row.is_premium === "boolean" ? row.is_premium : null,
      current_room: typeof row.current_room === "string" ? row.current_room : null,
      current_session_id:
        typeof row.current_session_id === "string"
          ? row.current_session_id
          : null,
      current_world_id:
        typeof row.current_world_id === "string" ? row.current_world_id : null,
      updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
    });
  } catch {
    return null;
  }
}

function clearCachedProfile() {
  try {
    localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {}
}

export function useAuth() {
  const [appStep, setAppStep] = useState<AppStep>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [myAvatar, setMyAvatar] = useState<AvatarConfig>(DEFAULT_AVATAR);

  const sb = getSupabase();

  // Kept beside `profile` so callbacks can read the latest value without
  // listing `profile` as a dependency — a dependency on it would change the
  // callback's identity on every presence update and re-fire its callers.
  const profileRef = useRef<Profile | null>(null);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    let mounted = true;
    let sessionHandled = false;
    const hasOAuthCode = window.location.search.includes("code=");
    const timeoutId = setTimeout(
      () => {
        if (mounted) setAppStep("landing");
      },
      hasOAuthCode ? 20000 : 8000,
    );

    const profileFromSession = (session: Session): Profile => {
      const { id, user_metadata, email } = session.user;
      const raw =
        (
          user_metadata?.preferred_username ||
          user_metadata?.user_name ||
          (email ?? "").split("@")[0] ||
          "user"
        )
          .replace(/[^a-zA-Z0-9_]/g, "")
          .toLowerCase() || "user";
      return {
        id,
        username: raw,
        discriminator: "",
        username_changed: false,
        display_name: user_metadata?.full_name ?? user_metadata?.name ?? raw,
        display_name_changed_at: null,
        avatar_config: null,
        is_premium: false,
        current_room: null,
        current_session_id: null,
        current_world_id: null,
        updated_at: new Date().toISOString(),
      };
    };

    const applyProfile = (prof: Profile) => {
      if (!mounted) return;
      if (window.location.search.includes("code=")) {
        window.history.replaceState({}, "", window.location.pathname);
      }
      setProfile(prof);
      cacheProfile(prof);
      if (prof.avatar_config) {
        setMyAvatar(prof.avatar_config);
        setAppStep("home");
      } else {
        setAppStep("avatar");
      }
    };

    const handleSession = async (session: Session) => {
      if (sessionHandled) return;
      sessionHandled = true;
      clearTimeout(timeoutId);
      if (!mounted) return;

      const cached = getCachedProfile();
      if (cached && cached.id === session.user.id && cached.avatar_config) {
        applyProfile(cached);
        sb.from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .single()
          .then(({ data }) => {
            if (data && mounted) {
              const fresh = profileFromRow(data);
              setProfile(fresh);
              cacheProfile(fresh);
              if (fresh.avatar_config) setMyAvatar(fresh.avatar_config);
            }
          });
        return;
      }

      try {
        const result = await Promise.race([
          sb.from("profiles").select("*").eq("id", session.user.id).single(),
          new Promise<{ data: null }>((resolve) =>
            setTimeout(() => resolve({ data: null }), 4000),
          ),
        ]);
        if (!mounted) return;

        if (result.data) {
          applyProfile(profileFromRow(result.data));
        } else {
          const provisional = profileFromSession(session);
          applyProfile(provisional);
          // Fallback only: the handle_new_user() trigger already creates this
          // row at signup, and we also land here when the SELECT above merely
          // timed out on a slow connection. ignoreDuplicates makes this a
          // pure insert-if-missing (ON CONFLICT DO NOTHING) — without it, the
          // conflict path would overwrite a real username with this generated
          // one, and would need UPDATE rights on columns only the
          // claim_username RPC should touch.
          sb.from("profiles")
            .upsert(
              {
                id: provisional.id,
                username:
                  provisional.username + "_" + provisional.id.slice(0, 4),
                discriminator: fallbackDiscriminator(provisional.id),
                display_name: provisional.display_name,
              },
              { onConflict: "id", ignoreDuplicates: true },
            )
            .then(() => {});
        }
      } catch {
        const provisional = profileFromSession(session);
        applyProfile(provisional);
      }
    };

    const loadUser = async () => {
      try {
        const {
          data: { session },
        } = await sb.auth.getSession();
        if (!mounted) return;
        if (!session) {
          if (!window.location.search.includes("code=")) setAppStep("landing");
          return;
        }
        await handleSession(session);
      } catch {
        if (mounted) setAppStep("landing");
      }
    };

    loadUser();

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange(
      async (event: AuthChangeEvent, session: Session | null) => {
        if (!mounted) return;
        if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
          await handleSession(session);
        } else if (event === "SIGNED_OUT") {
          setProfile(null);
          clearCachedProfile();
          setAppStep("landing");
        }
      },
    );

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Persists the avatar. Returns false if the write didn't land.
   *
   * This used to ignore the result entirely and still call setMyAvatar, cache
   * to localStorage and let the caller advance to home — so a failed write
   * looked exactly like a success until you opened another device and found the
   * old character. `.select("id")` is what makes a refusal visible: RLS
   * declining an UPDATE is not an error, it matches zero rows.
   */
  const saveAvatar = async (config: AvatarConfig): Promise<boolean> => {
    if (!profile) return false;
    const { data, error } = await sb
      .from("profiles")
      .update({ avatar_config: config })
      .eq("id", profile.id)
      .select("id");
    if (error || !data || data.length === 0) {
      console.error("Failed to save avatar:", error);
      return false;
    }
    setMyAvatar(config);
    const updated = { ...profile, avatar_config: config };
    setProfile(updated);
    cacheProfile(updated);
    return true;
  };

  const updateProfile = (updates: Partial<Profile>) => {
    if (!profile) return;
    const updated = { ...profile, ...updates };
    setProfile(updated);
    cacheProfile(updated);
  };

  /**
   * Re-read the presence columns from `profiles` and fold them into state.
   *
   * Returns the merged profile, or null when there is nothing to refresh or the
   * read failed. The return value has to be built *outside* the state updater:
   * an updater can run later than the `await` that follows it (and can run
   * twice under StrictMode), so assigning to a closure variable inside it made
   * this function return null even on success. Nothing used the value yet, but
   * the type promised one, and a future caller would have silently got nothing.
   */
  const refreshProfilePresence = useCallback(async (): Promise<Profile | null> => {
    const current = profileRef.current;
    const userId = current?.id;
    if (!userId) return null;
    const { data, error } = await sb
      .from("profiles")
      .select("current_session_id, current_world_id, current_room, updated_at")
      .eq("id", userId)
      .single();
    if (error || !data) return null;
    const merged: Profile = {
      ...current,
      current_session_id: data.current_session_id,
      current_world_id: data.current_world_id,
      current_room: data.current_room,
      updated_at: data.updated_at ?? current.updated_at,
    };
    // Guard the stale-account case in the updater, but do the caching and the
    // return once, outside it.
    setProfile((latest) =>
      !latest || latest.id !== userId ? latest : merged,
    );
    cacheProfile(merged);
    return merged;
  }, [sb]);

  const isPremium = profile?.is_premium ?? false;
  const displayName = profile?.display_name ?? profile?.username ?? "You";

  return {
    appStep,
    setAppStep,
    profile,
    setProfile,
    myAvatar,
    setMyAvatar,
    saveAvatar,
    updateProfile,
    refreshProfilePresence,
    isPremium,
    displayName,
    sb,
  };
}
