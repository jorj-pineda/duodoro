import type { Json } from "./database.types";
import { normalizeCompanionName } from "./companionNames";
import { companionDeviceValues, writeCompanionSetting } from "@/hooks/useCompanionPreference";
import { parseSessionPresets, presetDeviceValue, writePresetDeviceValue, type SessionPreset } from "@/hooks/useSessionPresets";
import { DAILY_GOALS, dailyGoalDeviceValue, writeDailyGoalDeviceValue } from "@/hooks/useDailyFocusGoal";
import { quietDeviceValue, writeQuietDeviceValue } from "@/hooks/useQuietFocus";

export const PREFERENCE_KEYS = ["pet","name_cat","name_dog","name_dragon","name_rabbit","presets","daily_goal","quiet_focus"] as const;
export type PreferenceKey = typeof PREFERENCE_KEYS[number];
export type PreferenceRow = { user_id: string; key: PreferenceKey; value: Json; version: number };
export const PREFERENCE_LABELS: Record<PreferenceKey,string> = { pet:"Companion", name_cat:"Cat name", name_dog:"Dog name", name_dragon:"Dragon name", name_rabbit:"Rabbit name", presets:"Favorite presets", daily_goal:"Daily focus target", quiet_focus:"Quiet focus" };
export const defaults: Record<PreferenceKey,Json> = { pet:null,name_cat:null,name_dog:null,name_dragon:null,name_rabbit:null,presets:[],daily_goal:60,quiet_focus:false };
export function isPreferenceKey(key: unknown): key is PreferenceKey { return PREFERENCE_KEYS.some(value => value === key); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}
export function samePreference(a: unknown,b: unknown): boolean { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
export function validPreference(key: PreferenceKey,value: unknown): value is Json {
  if (key === "pet") return value === null || ["cat","dog","dragon","rabbit"].includes(value as string);
  if (key.startsWith("name_")) return value === null || (typeof value === "string" && !!value && normalizeCompanionName(value) === value);
  if (key === "quiet_focus") return typeof value === "boolean";
  if (key === "daily_goal") return DAILY_GOALS.some(goal => goal === value);
  return Array.isArray(value) && value.length <= 5 && samePreference(parseSessionPresets(JSON.stringify(value)),value);
}
export function readPreferenceRow(raw: unknown,userId: string): PreferenceRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as PreferenceRow;
  return row.user_id === userId && isPreferenceKey(row.key) && validPreference(row.key,row.value)
    && Number.isSafeInteger(row.version) && row.version > 0 ? row : null;
}
export function devicePreferences(userId: string): Partial<Record<PreferenceKey,Json>> {
  const values = { ...companionDeviceValues(userId), presets:presetDeviceValue(userId), daily_goal:dailyGoalDeviceValue(userId),quiet_focus:quietDeviceValue(userId) };
  return Object.fromEntries(Object.entries(values).filter(([key,value]) => isPreferenceKey(key) && validPreference(key,value)));
}
export function applyDevicePreference(userId: string,key: PreferenceKey,value: Json): void {
  if (!validPreference(key,value)) return;
  if (key === "presets") writePresetDeviceValue(userId,value as unknown as SessionPreset[]);
  else if (key === "daily_goal") writeDailyGoalDeviceValue(userId,value as number);
  else if (key === "quiet_focus") writeQuietDeviceValue(userId,value as boolean);
  else writeCompanionSetting(userId,key,value as string | null);
}
export function storagePreferenceKey(key: string,userId: string): PreferenceKey | null {
  if (key === `duodoro:companion:${userId}`) return "pet";
  if (key === `duodoro:session-presets:${userId}`) return "presets";
  if (key === `duodoro:daily-goal:${userId}`) return "daily_goal";
  if (key === `duodoro:quiet-focus:${userId}`) return "quiet_focus";
  for (const pet of ["cat","dog","dragon","rabbit"]) if (key === `duodoro:companion-name:${userId}:${pet}`) return `name_${pet}` as PreferenceKey;
  return null;
}

// Per-key outbox entries retain the observed revision across reloads. A tab
// only deletes the entry it last observed/wrote, leaving newer tab edits alone.
export function preferenceOutbox(userId: string) {
  const owned = new Map<PreferenceKey,string>();
  const keyFor = (key: PreferenceKey)=>`duodoro:preferences-outbox:${userId}:${key}`;
  type Value = { key: PreferenceKey; value: Json; base: number | null | undefined; conflict?: boolean };
  return {
    read(): Value[] {
      const result: Value[] = [];
      for (const key of PREFERENCE_KEYS) try {
        const raw = localStorage.getItem(keyFor(key)); if (!raw || raw.length > 4096) continue;
        const data = JSON.parse(raw);
        if (!validPreference(key,data?.value) || !(data.base === undefined || data.base === null || (Number.isSafeInteger(data.base) && data.base > 0))) continue;
        owned.set(key,raw); result.push({key,value:data.value,base:data.base,conflict:data.conflict === true});
      } catch { /* Corrupt or blocked browser storage is never uploaded. */ }
      return result;
    },
    save(values: Value[]) {
      const present = new Set(values.map(value=>value.key));
      for (const value of values) {
        const raw = JSON.stringify({value:value.value,base:value.base,conflict:value.conflict ?? false});
        if (owned.get(value.key) === raw) continue;
        try { localStorage.setItem(keyFor(value.key),raw); owned.set(value.key,raw); } catch { /* Keep the in-memory edit. */ }
      }
      for (const [key,raw] of owned) if (!present.has(key)) {
        try { if (localStorage.getItem(keyFor(key)) === raw) localStorage.removeItem(keyFor(key)); owned.delete(key); } catch { /* Retained until a future reconciliation. */ }
      }
    },
  };
}
