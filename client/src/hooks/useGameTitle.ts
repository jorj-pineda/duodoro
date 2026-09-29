"use client";

import { useEffect } from "react";
import type { GamePhase } from "@/components/GameWorld";
import { formatTime } from "@/lib/format";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";

const phaseLabels: Record<GamePhase, string> = {
  waiting: "Ready to start",
  focus: "Focus",
  celebration: "Celebration",
  break: "Break",
  returning: "Returning",
  ready: "Ready · Go again",
};

// Consume the same server-derived values as SessionHUD; no separate clock.
export function useGameTitle(
  active: boolean,
  { phase, serverMode, timeLeft, flowElapsed }: {
    phase: GamePhase;
    serverMode: "pomodoro" | "flow";
    timeLeft: number;
    flowElapsed: number;
  },
) {
  const flowFocus = phase === "focus" && serverMode === "flow";
  const label = flowFocus ? "Flow" : phaseLabels[phase];
  const timer = phase === "focus" || phase === "break"
    ? `${formatTime(flowFocus ? flowElapsed : timeLeft).padStart(5, "0")} · `
    : "";
  const title = active ? `${timer}${label} · ${SITE_NAME}` : SITE_TITLE;

  useEffect(() => {
    document.title = title;
    return () => { document.title = SITE_TITLE; };
  }, [title]);
}
