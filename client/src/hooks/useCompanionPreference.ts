"use client";
import { useCallback, useSyncExternalStore } from "react";
import { PET_OPTIONS, type PetType } from "@/lib/types";
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
      if (event.key === key || event.key === null) { memory.delete(key); notify(); }
    };
    window.addEventListener("storage", storage);
    window.addEventListener(changed, notify);
    return () => { window.removeEventListener("storage", storage); window.removeEventListener(changed, notify); };
  }, [key]);
  const pet = useSyncExternalStore(subscribe, () => userId ? read(key) : null, () => null);
  const setPet = useCallback((value: PetType | null) => {
    if (!userId || (value !== null && !PET_OPTIONS.some((pet) => pet.type === value))) return;
    try {
      if (value) localStorage.setItem(key, value); else localStorage.removeItem(key);
      memory.delete(key);
    } catch { memory.set(key, value); }
    window.dispatchEvent(new Event(changed));
  }, [key, userId]);
  return { pet, setPet };
}
