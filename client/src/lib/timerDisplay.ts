import type { GamePhase } from "@/components/GameWorld";
import { formatTime } from "./format";

const phaseLabels: Record<GamePhase, string> = {
  waiting: "Ready to start",
  focus: "Focus",
  celebration: "Celebration",
  break: "Break",
  returning: "Returning",
  ready: "Ready · Go again",
};

/**
 * The phase label and clock shared by the tab title and the mini timer. It
 * reads the server-derived values SessionHUD shows; there is no second clock.
 * `time` is null outside focus and break.
 */
export function timerDisplay({ phase, serverMode, timeLeft, flowElapsed }: {
  phase: GamePhase;
  serverMode: "pomodoro" | "flow";
  timeLeft: number;
  flowElapsed: number;
}): { label: string; time: string | null; flow: boolean } {
  const flow = phase === "focus" && serverMode === "flow";
  const time = phase === "focus" || phase === "break"
    ? formatTime(flow ? flowElapsed : timeLeft).padStart(5, "0")
    : null;
  return { label: flow ? "Flow" : phaseLabels[phase], time, flow };
}
