"use client";

import { useEffect } from "react";
import type { GamePhase } from "@/components/GameWorld";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { timerDisplay } from "@/lib/timerDisplay";

// Consume the same server-derived values as SessionHUD; no separate clock.
export function useGameTitle(
  active: boolean,
  game: {
    phase: GamePhase;
    serverMode: "pomodoro" | "flow";
    timeLeft: number;
    flowElapsed: number;
  },
) {
  const { label, time } = timerDisplay(game);
  const title = active ? `${time ? `${time} · ` : ""}${label} · ${SITE_NAME}` : SITE_TITLE;

  useEffect(() => {
    document.title = title;
    return () => { document.title = SITE_TITLE; };
  }, [title]);
}
