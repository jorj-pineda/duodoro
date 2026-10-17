"use client";
import { useCallback, useSyncExternalStore } from "react";
import { PET_OPTIONS, type PetType } from "@/lib/types";
import { companionName, normalizeCompanionName } from "@/lib/companionNames";
const nameMemory = new Map<string, string | null>();
const changed = "duodoro:companion-changed";
const memory = new Map<string, PetType | null>();
function read(key: string): PetType | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    const value = localStorage.getItem(key);
    return PET_OPTIONS.some((pet) => pet.type === value) ? value as PetType : null;
  } catch { return null; }
}
export function useCompanionPreference(userId?: string) {
  const key = `duodoro:companion:${userId ?? "signed-out"}`;
  const subscribe = useCallback((notify: () => void) => {
    const storage = (event: StorageEvent) => {
      if (event.key === key || event.key?.startsWith(`duodoro:companion-name:${userId}:`) || event.key === null) {
        memory.delete(key);
        if (event.key === null) nameMemory.clear(); else nameMemory.delete(event.key);
        notify();
      }
    };
    window.addEventListener("storage", storage);
    window.addEventListener(changed, notify);
    return () => { window.removeEventListener("storage", storage); window.removeEventListener(changed, notify); };
  }, [key, userId]);
  const pet = useSyncExternalStore(subscribe, () => userId ? read(key) : null, () => null);
  const setPet = useCallback((value: PetType | null) => {
    if (userId && (value === null || PET_OPTIONS.some(p => p.type === value))) writeCompanionSetting(userId, "pet", value);
  }, [userId]);
  const getName = useCallback((type: PetType | null) => {
    if (!userId || !type) return null;
    const nameKey = `duodoro:companion-name:${userId}:${type}`;
    let stored: string | null = null;
    try { stored = nameMemory.has(nameKey) ? nameMemory.get(nameKey)! : localStorage.getItem(nameKey); } catch { stored = nameMemory.get(nameKey) ?? null; }
    return companionName(type, stored);
  }, [userId]);
  const petName = useSyncExternalStore(subscribe, () => getName(pet), () => null);
  const setName = useCallback((type: PetType, value: string) => {
    const name = normalizeCompanionName(value);
    if (!userId || name === null || !PET_OPTIONS.some(p => p.type === type)) return false;
    writeCompanionSetting(userId, `name_${type}`, name || null);
    return true;
  }, [userId]);
  return { pet, setPet, petName, setName, getName };
}

export function companionDeviceValues(userId: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const key = `duodoro:companion:${userId}`;
  const has = (key: string) => { try { return localStorage.getItem(key) !== null; } catch { return false; } };
  if (memory.has(key)) result.pet = memory.get(key);
  else try { const value = localStorage.getItem(key); if (PET_OPTIONS.some(pet => pet.type === value)) result.pet = value; } catch { /* No explicit valid value. */ }
  for (const pet of PET_OPTIONS) {
    const nameKey = `duodoro:companion-name:${userId}:${pet.type}`;
    if (nameMemory.has(nameKey) || has(nameKey)) {
      let raw = nameMemory.get(nameKey);
      if (raw === undefined) { try { raw = localStorage.getItem(nameKey); } catch { raw = null; } }
      const name = normalizeCompanionName(raw ?? "");
      if (name !== null) result[`name_${pet.type}`] = name || null;
    }
  }
  return result;
}
export function writeCompanionSetting(userId: string, setting: string, value: PetType | string | null) {
  const isPet = setting === "pet";
  const key = isPet ? `duodoro:companion:${userId}` : `duodoro:companion-name:${userId}:${setting.slice(5)}`;
  try {
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    if (isPet) memory.delete(key); else nameMemory.delete(key);
  } catch { if (isPet) memory.set(key, value as PetType | null); else nameMemory.set(key, value); }
  window.dispatchEvent(new CustomEvent(changed, { detail: { userId, key: setting, value } }));
}
