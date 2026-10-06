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
    if (!userId || (value !== null && !PET_OPTIONS.some((pet) => pet.type === value))) return;
    try {
      if (value) localStorage.setItem(key, value); else localStorage.removeItem(key);
      memory.delete(key);
    } catch { memory.set(key, value); }
    window.dispatchEvent(new Event(changed));
  }, [key, userId]);
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
    const nameKey = `duodoro:companion-name:${userId}:${type}`;
    try {
      if (name) localStorage.setItem(nameKey, name); else localStorage.removeItem(nameKey);
      nameMemory.delete(nameKey);
    } catch { nameMemory.set(nameKey, name); }
    window.dispatchEvent(new Event(changed));
    return true;
  }, [userId]);
  return { pet, setPet, petName, setName, getName };
}
