"use client";

import { useEffect, useRef } from "react";
import type { GamePhase } from "@/components/GameWorld";
import { tabIconHref } from "@/lib/tabIcon";

/**
 * Adds a progress icon while a focus or break phase is shown, from the same
 * server-derived progress as the HUD. Removing the link restores the site icon.
 */
export function useTabIcon(
  active: boolean,
  { phase, serverMode, phaseProgress }: {
    phase: GamePhase;
    serverMode: "pomodoro" | "flow";
    phaseProgress: number;
  },
) {
  const href = active ? tabIconHref({ phase, serverMode, phaseProgress }) : null;
  const shown = href !== null;
  const link = useRef<HTMLLinkElement | null>(null);

  useEffect(() => {
    if (!shown) return;
    const element = document.createElement("link");
    element.rel = "icon";
    element.type = "image/svg+xml";
    element.dataset.duodoroTimer = "";
    document.head.appendChild(element);
    link.current = element;
    return () => {
      element.remove();
      if (link.current === element) link.current = null;
    };
  }, [shown]);

  useEffect(() => {
    if (href && link.current) link.current.href = href;
  }, [href]);
}
