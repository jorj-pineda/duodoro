import type { GamePhase } from "@/components/GameWorld";
import { DARK_BG, PAPER, TAB_BREAK, TAB_FOCUS } from "./site";

/** Sixteen whole-pixel steps at 16px: each step is 32 units of the 512 viewBox. */
export const TAB_ICON_STEPS = 16;
const STEP = 32;

/**
 * The duo mark, its tile filling from the bottom with focus or break progress.
 * Other phases return null so the normal site icon shows. Flow focus has no
 * end, so its tile is full.
 */
export function tabIconHref({ phase, serverMode, phaseProgress }: {
  phase: GamePhase;
  serverMode: "pomodoro" | "flow";
  phaseProgress: number;
}): string | null {
  if (phase !== "focus" && phase !== "break") return null;
  const flow = phase === "focus" && serverMode === "flow";
  const bounded = Number.isFinite(phaseProgress) ? Math.min(1, Math.max(0, phaseProgress)) : 0;
  const height = (flow ? TAB_ICON_STEPS : Math.floor(bounded * TAB_ICON_STEPS)) * STEP;
  const fill = phase === "break" ? TAB_BREAK : TAB_FOCUS;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">`
    + `<clipPath id="t"><rect width="512" height="512" rx="112"/></clipPath>`
    + `<g clip-path="url(#t)"><rect width="512" height="512" fill="${DARK_BG}"/>`
    + (height ? `<rect y="${512 - height}" width="512" height="${height}" fill="${fill}"/>` : "")
    + `</g>`
    + `<circle cx="180" cy="256" r="72" fill="${PAPER}"/>`
    + `<circle cx="332" cy="256" r="72" fill="${PAPER}"/>`
    + `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
