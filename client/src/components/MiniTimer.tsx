"use client";

import { createPortal } from "react-dom";
import type { GamePhase } from "./GameWorld";
import { useMiniTimerSupported } from "@/hooks/useMiniTimer";
import { timerDisplay } from "@/lib/timerDisplay";

type TimerState = {
  phase: GamePhase;
  serverMode: "pomodoro" | "flow";
  timeLeft: number;
  flowElapsed: number;
  phaseProgress: number;
};

export function MiniTimerView(state: TimerState & { partnerName?: string | null }) {
  const { label, time, flow } = timerDisplay(state);
  const progress = Number.isFinite(state.phaseProgress) ? Math.min(1, Math.max(0, state.phaseProgress)) : 0;
  const bar = time && !flow;
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p role="timer" aria-label={time ? `${label} ${time}` : label} className="font-mono text-4xl font-bold tabular-nums">
        {time ?? "—"}
      </p>
      {bar && <div className="h-2 w-full max-w-48 overflow-hidden rounded-full bg-raise" aria-hidden="true">
        <div className={`h-full ${state.phase === "break" ? "bg-calm" : "bg-accent"}`} style={{ width: `${progress * 100}%` }} />
      </div>}
      {state.partnerName && <p className="max-w-full truncate text-xs text-faint">With {state.partnerName}</p>}
    </main>
  );
}

/** Renders the view into the open mini window, if any. */
export function MiniTimerPortal({ target, ...state }: TimerState & { target: Window | null; partnerName?: string | null }) {
  return target ? createPortal(<MiniTimerView {...state} />, target.document.body) : null;
}

export function MiniTimerToggle({ opened, failed, onOpen, onClose }: {
  opened: boolean;
  failed: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const supported = useMiniTimerSupported();
  if (!supported) return null;
  return (
    <div className="w-full max-w-xs flex flex-col items-center">
      <button type="button" onClick={opened ? onClose : onOpen}
        className="min-h-11 rounded-lg px-3 text-xs font-semibold text-muted underline-offset-4 hover:text-ink hover:underline">
        {opened ? "Close mini timer" : "Open mini timer"}
      </button>
      {failed
        ? <p role="status" className="text-center text-xs text-muted">Your browser didn&apos;t open the mini timer. Try again.</p>
        : <p className="text-center text-xs text-faint">Stays on top while you work in other apps.</p>}
    </div>
  );
}
