import type { ReactNode } from "react";
import type { GamePhase } from "./GameWorld";
import type { PetType } from "@/lib/types";
import { formatTime } from "@/lib/format";
import PetPicker from "./PetPicker";
import Button from "./Button";
import TimerProgress from "./TimerProgress";

function DurationSlider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
}) {
  return (
    <label className="flex items-center gap-3 w-full">
      <span className="text-muted text-xs font-medium w-14 text-right shrink-0">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1.5"
        style={{ accentColor: "var(--accent)" }}
      />
      <span aria-hidden="true" className="text-accent text-xs font-mono font-bold w-12 shrink-0">
        {value}
        {unit}
      </span>
    </label>
  );
}

interface SessionHUDProps {
  quietFocus?: boolean;
  quietFocusSetting?: ReactNode;
  timerPresets?: ReactNode;
  reactions?: ReactNode;
  startBlocked?: boolean;
  intentionPrompt?: ReactNode;
  recap?: ReactNode;
  companionGrowth?: ReactNode;
  companionNames?: ReactNode;
  phase: GamePhase;
  serverMode: "pomodoro" | "flow";
  breakActivities?: ReactNode;
  sessionStarted: boolean;
  playerCount: number;
  completedRounds: number;
  timeLeft: number;
  flowElapsed: number;
  /** 0–1 through the current focus/break phase */
  phaseProgress: number;
  // Session config
  timerMode: "pomodoro" | "flow";
  focusDuration: number;
  breakDuration: number;
  onTimerModeChange: (mode: "pomodoro" | "flow") => void;
  onFocusDurationChange: (v: number) => void;
  onBreakDurationChange: (v: number) => void;
  // Pet
  myPet: PetType | null;
  onPetSelect: (pet: PetType | null) => void;
  isPremium: boolean;
  onPremiumClick: () => void;
  // Actions
  onStart: () => void;
  onGoAgain: () => void;
  onStop: () => void;
  onFinishFlow: () => void;
  onShareInvite: () => void;
  shareInviteBusy: boolean;
  onLeave: () => void;
}

const phaseLabel: Record<GamePhase, (playerCount: number) => string> = {
  waiting: (pc) => (pc < 1 ? "Setting up..." : "Ready to focus"),
  focus: () => "Focus time",
  celebration: () => "You met!",
  break: () => "Break time",
  returning: () => "Heading back...",
  ready: () => "Ready for another round?",
};

export default function SessionHUD({
  quietFocus = false,
  quietFocusSetting,
  timerPresets,
  reactions,
  startBlocked = false,
  intentionPrompt,
  recap,
  companionGrowth,
  companionNames,
  phase,
  serverMode,
  breakActivities,
  sessionStarted,
  playerCount,
  completedRounds,
  timeLeft,
  flowElapsed,
  phaseProgress,
  timerMode,
  focusDuration,
  breakDuration,
  onTimerModeChange,
  onFocusDurationChange,
  onBreakDurationChange,
  myPet,
  onPetSelect,
  isPremium,
  onPremiumClick,
  onStart,
  onGoAgain,
  onStop,
  onFinishFlow,
  onShareInvite,
  shareInviteBusy,
  onLeave,
}: SessionHUDProps) {
  const quiet = quietFocus && phase === "focus";
  const showTimer = phase === "focus" || phase === "break";
  const idle = phase === "waiting" || phase === "ready";
  const canStart = playerCount >= 1 && !sessionStarted && idle;
  const canStop = sessionStarted && !idle;

  return (
    // The bottom inset goes on the scroll container, not the card, so the last
    // controls ("Stop timer" / "Leave room") can scroll clear of the home
    // indicator instead of sitting under it.
    <div className="session-hud-scroll min-h-0 flex-1 flex items-start justify-center px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] overflow-y-auto">
      <div className="hud-card bg-surface border-2 border-line border-b-4 px-6 sm:px-8 py-5 flex flex-col items-center gap-3 mb-4">
        <div role="status" aria-live="polite" className="font-display text-lg tracking-wide text-ink">
          {phaseLabel[phase](playerCount)}
        </div>

        {!quiet && <p className="text-xs text-muted">
          {completedRounds} {completedRounds === 1 ? "round" : "rounds"} completed in this room
        </p>}

        {showTimer && (
          <div
            role="timer"
            aria-label={`${phase === "break" ? "Break" : "Focus"} time ${
              phase === "focus" && serverMode === "flow"
                ? formatTime(Math.round(flowElapsed))
                : formatTime(timeLeft)
            }`}
            className="hud-timer text-5xl sm:text-6xl font-display font-bold tabular-nums tracking-wide flex flex-col items-center"
          >
            {phase === "focus" && serverMode === "flow" && (
              <span className="text-xs text-calm mb-1 tracking-widest font-bold uppercase">
                Flow elapsed
              </span>
            )}
            <span className={phase === "break" ? "text-calm" : "text-accent"}>
              {phase === "focus" && serverMode === "flow"
                ? formatTime(Math.round(flowElapsed))
                : formatTime(timeLeft)}
            </span>
          </div>
        )}

        {(phase === "break" || (phase === "focus" && serverMode === "pomodoro")) && (
          <TimerProgress key={phase} progress={phaseProgress} phase={phase} />
        )}

        {phase === "break" && breakActivities}

        {phase !== "focus" && phase !== "waiting" && recap}

        {!sessionStarted && phase === "waiting" && (
          <div className="w-full max-w-xs space-y-4 mt-1">
            <div className="flex bg-raise p-1 border-2 border-line">
              <button
                aria-pressed={timerMode === "pomodoro"}
                onClick={() => onTimerModeChange("pomodoro")}
                className={`flex-1 py-2 sm:py-1 text-xs font-bold transition-colors ${
                  timerMode === "pomodoro"
                    ? "bg-accent text-white"
                    : "text-muted hover:text-ink"
                }`}
              >
                Pomodoro
              </button>
              <button
                aria-pressed={timerMode === "flow"}
                onClick={() => onTimerModeChange("flow")}
                className={`flex-1 py-2 sm:py-1 text-xs font-bold transition-colors ${
                  timerMode === "flow"
                    ? "bg-calm text-white"
                    : "text-muted hover:text-ink"
                }`}
              >
                Flowmodoro
              </button>
            </div>
            {timerMode === "pomodoro" ? (
              <>
                <DurationSlider
                  label="Focus"
                  value={focusDuration}
                  onChange={onFocusDurationChange}
                  min={5}
                  max={120}
                  step={5}
                  unit="m"
                />
                <DurationSlider
                  label="Break"
                  value={breakDuration}
                  onChange={onBreakDurationChange}
                  min={1}
                  max={30}
                  step={1}
                  unit="m"
                />
              </>
            ) : (
              <div className="text-center text-xs text-muted px-4 py-2 bg-raise rounded-lg border border-line">
                Focus as long as you want. When you&apos;re done, you&apos;ll
                earn a break tailored to how long you worked (5:1 ratio).
              </div>
            )}
          </div>
        )}

        {!sessionStarted && phase === "waiting" && timerPresets}

        {intentionPrompt}

        {idle && (
          <PetPicker
            selected={myPet}
            onSelect={onPetSelect}
            isPremium={isPremium}
            onPremiumClick={onPremiumClick}
          />
        )}

        {!quiet && companionNames}

        {!quiet && (phase === "waiting" || phase === "focus" || !recap) && companionGrowth}

        {/* Player indicators */}
        {!quiet && <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 ${playerCount >= 1 ? "bg-go" : "bg-faint"}`}
          />
          <span className="text-muted text-xs font-medium uppercase tracking-wide">
            You
          </span>
          {playerCount >= 2 && (
            <>
              <div className="w-8 h-px bg-line" />
              <div className="w-2 h-2 bg-go" />
              <span className="text-muted text-xs font-medium uppercase tracking-wide">
                Partner
              </span>
            </>
          )}
          {playerCount < 2 && phase === "waiting" && (
            <>
              <div className="w-8 h-px bg-line" />
              <div className="w-2 h-2 bg-faint" />
              <span className="text-faint text-xs font-medium uppercase tracking-wide">
                Waiting...
              </span>
            </>
          )}
        </div>}

        {!quiet && reactions}

        {(idle || phase === "focus") && quietFocusSetting && (
          <div key="quiet-focus-setting" className="w-full flex justify-center">
            {quietFocusSetting}
          </div>
        )}

        {/* Start / stop */}
        <div className="flex flex-col items-center gap-2">
          {canStart && phase === "waiting" && (
            <Button
              variant={timerMode === "flow" ? "calm" : "accent"}
              disabled={startBlocked}
              onClick={onStart}
            >
              Start{playerCount < 2 ? " solo" : " session"}
            </Button>
          )}
          {canStart && phase === "ready" && (
            <Button variant="accent" onClick={onGoAgain} disabled={startBlocked}>
              Go again
            </Button>
          )}
          {playerCount < 2 && idle && (
            <div className="flex flex-col items-center gap-1.5">
              <Button
                variant="surface"
                size="sm"
                onClick={onShareInvite}
                disabled={shareInviteBusy}
              >
                {shareInviteBusy ? "Creating link…" : "Copy invite link"}
              </Button>
              <p className="text-faint text-xs text-center">
                One use · expires in 15 minutes
              </p>
            </div>
          )}
          {phase === "focus" && serverMode === "flow" && (
            <Button variant="calm" className="mt-2" onClick={onFinishFlow}>
              Take break
            </Button>
          )}
          {/* These are the two most consequential controls in the app and were
              bare 12px text. Padded to a thumb-sized target on touch, back to
              the tight original from sm up. Matches Button/AvatarCreator's
              existing `w-11 h-11 sm:w-7 sm:h-7` pattern. */}
          {canStop && (
            <button
              onClick={onStop}
              className="text-muted hover:text-danger text-xs transition-colors mt-2 px-4 py-2.5 sm:px-0 sm:py-0 rounded-lg"
            >
              Stop timer
            </button>
          )}
          <button
            onClick={onLeave}
            className="text-xs text-danger/60 hover:text-danger transition-colors mt-2 px-4 py-2.5 sm:px-0 sm:py-0 rounded-lg"
          >
            {"←"} Leave room
          </button>
        </div>
      </div>
    </div>
  );
}
