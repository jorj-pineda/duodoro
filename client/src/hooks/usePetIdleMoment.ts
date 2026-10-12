"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { PetIdleMoment } from "@/lib/petIdle";

const subscribe = (notify: () => void) => {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
};
const visible = () => document.visibilityState === "visible";
const serverVisible = () => false;
const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (notify: () => void) => {
  const media = window.matchMedia?.(motionQuery);
  media?.addEventListener("change", notify);
  return () => media?.removeEventListener("change", notify);
};
const reduced = () => window.matchMedia?.(motionQuery).matches ?? false;
const serverReduced = () => true;

export function usePetIdleMoment(enabled: boolean, identity: string) {
  const pageVisible = useSyncExternalStore(subscribe, visible, serverVisible);
  const reducedMotion = useSyncExternalStore(subscribeMotion, reduced, serverReduced);
  const active = enabled && pageVisible && reducedMotion !== true;
  // A new phase, companion or visibility lifetime cannot revive an old pose.
  const scope = useMemo(() => ({ active, identity }), [active, identity]);
  const [pose, setPose] = useState<{ scope: object; moment: PetIdleMoment } | null>(null);
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const schedule = (moment: PetIdleMoment, delay: number, next: () => void) => {
      timer = setTimeout(() => {
        if (cancelled) return;
        setPose({ scope, moment });
        next();
      }, delay);
    };
    const cycle = () => schedule("blink", 7000 + Math.random() * 5000, () =>
      schedule("rest", 180, () =>
        schedule("fidget", 1200, () => schedule("rest", 320, cycle))));
    cycle();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, scope]);
  return active && pose?.scope === scope ? pose.moment : "rest";
}
