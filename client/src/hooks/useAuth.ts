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
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const retryAuth = useCallback(() => {
    setAppStep("loading");
    setBootstrapAttempt(attempt => attempt + 1);
  }, []);

  useEffect(() => {
    if (appStep !== "unavailable") return;
    window.addEventListener("online", retryAuth);
    return () => window.removeEventListener("online", retryAuth);
  }, [appStep, retryAuth]);

  // Kept beside `profile` so callbacks can read the latest value without
  // listing `profile` as a dependency — a dependency on it would change the
  // callback's identity on every presence update and re-fire its callers.
  const profileRef = useRef<Profile | null>(null);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    let mounted = true;
    let handledUser: string | null = null;
    let sessionGeneration = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const hasOAuthCode = window.location.search.includes("code=");
    const startedAt = Date.now();
    const current = (generation: number) => mounted && generation === sessionGeneration;
    const unavailable = (generation: number) => {
      if (current(generation)) setAppStep("unavailable");
    };
    async function bounded<T>(operation: PromiseLike<T>, milliseconds = 4000): Promise<T> {
      let timer!: ReturnType<typeof setTimeout>;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Account request timed out")), milliseconds);
        timers.add(timer);
      });
      try { return await Promise.race([operation, deadline]); }
      finally { clearTimeout(timer); timers.delete(timer); }
    }

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
      if (!mounted || handledUser === session.user.id) return;
      handledUser = session.user.id;
      const generation = ++sessionGeneration;
      const cached = getCachedProfile();
      if (cached && cached.id === session.user.id && cached.avatar_config) {
        applyProfile(cached);
        try {
          const { data, error } = await bounded(sb.from("profiles").select("*").eq("id", session.user.id).single());
          if (!error && data && current(generation)) {
            const fresh = profileFromRow(data);
            setProfile(fresh);
            cacheProfile(fresh);
            if (fresh.avatar_config) setMyAvatar(fresh.avatar_config);
          }
        } catch {
          // A failed background refresh does not invalidate a usable account cache.
        }
        return;
      }

      setProfile(null);
      setAppStep("loading");
      try {
        let { data, error } = await bounded(sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle());
        if (!current(generation)) return;
        if (error) throw error;
        if (!data) {
          // Only a successful empty read may repair a missing signup row.
          // Confirm the write and re-read the authoritative row before setup.
          const provisional = profileFromSession(session);
          const inserted = await bounded(sb.from("profiles").upsert({
            id: provisional.id,
            username: provisional.username + "_" + provisional.id.slice(0, 4),
            discriminator: fallbackDiscriminator(provisional.id),
            display_name: provisional.display_name,
          }, { onConflict: "id", ignoreDuplicates: true }));
          if (!current(generation)) return;
          if (inserted.error) throw inserted.error;
          const confirmed = await bounded(sb.from("profiles").select("*").eq("id", session.user.id).single());
          if (!current(generation)) return;
          data = confirmed.data;
          error = confirmed.error;
        }
        if (error || !data) throw error ?? new Error("Profile unavailable");
        applyProfile(profileFromRow(data));
      } catch {
        unavailable(generation);
      }
    };

    const loadUser = async () => {
      const generation = sessionGeneration;
      try {
        const { data: { session }, error } = await bounded(sb.auth.getSession(), hasOAuthCode ? 20000 : 8000);
        // Auth events can settle sign-in or sign-out before this snapshot returns.
        if (!current(generation)) return;
        if (error) throw error;
        if (!session) {
          if (!hasOAuthCode) setAppStep("landing");
          else {
            // Allow an in-flight PKCE callback to deliver its auth event.
            const timer = setTimeout(() => {
              timers.delete(timer);
              unavailable(generation);
            }, Math.max(0, 20000 - (Date.now() - startedAt)));
            timers.add(timer);
          }
          return;
        }
        await handleSession(session);
      } catch {
        unavailable(generation);
      }
    };

    loadUser();

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (!mounted) return;
        if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
          // Profile queries acquire Supabase's auth lock too. Returning before
          // they finish releases the callback lock on a fresh browser.
          void handleSession(session);
        } else if (event === "SIGNED_OUT") {
          ++sessionGeneration;
          handledUser = null;
          setProfile(null);
          clearCachedProfile();
          setAppStep("landing");
        }
      },
    );

    return () => {
      mounted = false;
      for (const timer of timers) clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [bootstrapAttempt, sb]);

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
    retryAuth,
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
