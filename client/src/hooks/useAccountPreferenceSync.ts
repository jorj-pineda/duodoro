"use client";
import { useEffect, useSyncExternalStore } from "react";
import { getSupabase } from "@/lib/supabase";
import { applyDevicePreference, preferenceOutbox, defaults, devicePreferences, isPreferenceKey, storagePreferenceKey, validPreference, type PreferenceKey } from "@/lib/accountPreferences";
import { createPreferenceSync, EMPTY_SYNC } from "@/lib/preferenceSync";

function entryFor(userId: string) {
  let applying = false;
  async function token() {
    const { data,error } = await getSupabase().auth.getSession();
    if (error || data.session?.user.id !== userId) throw new Error("Account changed");
    return data.session.access_token;
  }
  const outbox = preferenceOutbox(userId);
  const sync = createPreferenceSync(userId,{
    async read() {
      const authorization = await token();
      const { data,error } = await getSupabase().from("account_preferences").select("user_id,key,value,version").eq("user_id",userId).limit(9)
        .setHeader("Authorization",`Bearer ${authorization}`);
      if (error || !data) throw new Error("Read unavailable"); return data;
    },
    async write(key,value,version) {
      const authorization = await token();
      const { data,error } = await getSupabase().rpc("set_account_preference",{ p_key:key,p_value:value,p_expected_version:version as number })
        .setHeader("Authorization",`Bearer ${authorization}`);
      if (error) throw error;
      if (data?.length !== 1) throw new Error("Unconfirmed"); return data[0];
    },
  },{
    read:()=>devicePreferences(userId),
    imported(key) { try { return localStorage.getItem(`duodoro:preferences-imported:${userId}:${key}`) === "true"; } catch { return false; } },
    confirmed(key) { try { localStorage.setItem(`duodoro:preferences-imported:${userId}:${key}`,"true"); } catch { /* Account confirmation still holds for this page. */ } },
    readPending:outbox.read,savePending:outbox.save,
    apply(key,value) { applying = true; try { applyDevicePreference(userId,key,value); } finally { applying = false; } },
  });
  const events = ["duodoro:companion-changed","duodoro:presets-changed","duodoro:daily-goal-changed","duodoro:quiet-focus-change"];
  const changed = (event: Event) => {
    if (applying || !(event instanceof CustomEvent)) return;
    const detail = event.detail as { userId?: string; key?: unknown; value?: unknown } | null;
    if (detail?.userId === userId && isPreferenceKey(detail.key) && validPreference(detail.key,detail.value)) sync.change(detail.key,detail.value);
  };
  const storage = (event: StorageEvent) => {
    if (!event.key) return; // Clearing browser data must never reset account data.
    const key = storagePreferenceKey(event.key,userId);
    if (!key) return;
    // Existing hook storage listeners discard their memory fallbacks first.
    queueMicrotask(()=>sync.change(key,devicePreferences(userId)[key] ?? defaults[key]));
  };
  const visible = () => { if (document.visibilityState === "visible") void sync.reload(); };
  let timer: number | undefined;
  let users = 0;
  return { sync, retain() {
    if (++users === 1) {
      events.forEach(event=>window.addEventListener(event,changed)); window.addEventListener("storage",storage);
      window.addEventListener("focus",visible); window.addEventListener("online",visible); document.addEventListener("visibilitychange",visible);
      timer = window.setInterval(visible,30_000); sync.start();
    }
    return () => { if (--users === 0) {
      sync.stop(); clearInterval(timer);
      events.forEach(event=>window.removeEventListener(event,changed)); window.removeEventListener("storage",storage);
      window.removeEventListener("focus",visible); window.removeEventListener("online",visible); document.removeEventListener("visibilitychange",visible);
    } };
  } };
}
const entries = new Map<string,ReturnType<typeof entryFor>>();
const idleSubscribe = () => () => {};
const empty = () => EMPTY_SYNC;
export function useAccountPreferenceSync(userId?: string) {
  // Creating an inert entry has no network, DOM, timers, or storage reads.
  const entry = typeof window !== "undefined" && userId ? entries.get(userId) ?? (()=>{ const value = entryFor(userId); entries.set(userId,value); return value; })() : null;
  const state = useSyncExternalStore(entry?.sync.subscribe ?? idleSubscribe,entry?.sync.getSnapshot ?? empty,empty);
  useEffect(()=>entry?.retain(),[entry]);
  return { ...state,reload:()=>entry?.sync.reload(),resolve:(key: PreferenceKey,choice: "account" | "device")=>entry?.sync.resolve(key,choice) };
}
