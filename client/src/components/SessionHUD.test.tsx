import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import SessionHUD from "./SessionHUD";

function renderReady(onGoAgain = vi.fn(), overrides: Partial<ComponentProps<typeof SessionHUD>> = {}) {
  render(
    <SessionHUD
      phase="ready"
      serverMode="pomodoro"
      sessionStarted={false}
      playerCount={2}
      completedRounds={2}
      timeLeft={0}
      flowElapsed={0}
      phaseProgress={0}
      timerMode="pomodoro"
      focusDuration={25}
      breakDuration={5}
      onTimerModeChange={vi.fn()}
      onFocusDurationChange={vi.fn()}
      onBreakDurationChange={vi.fn()}
      myPet={null}
      onPetSelect={vi.fn()}
      isPremium={false}
      onPremiumClick={vi.fn()}
      onStart={vi.fn()}
      onGoAgain={onGoAgain}
      onStop={vi.fn()}
      onFinishFlow={vi.fn()}
      onShareInvite={vi.fn()}
      shareInviteBusy={false}
      onLeave={vi.fn()}
      {...overrides}
    />,
  );
  return onGoAgain;
}

describe("completed Pomodoro cycle", () => {
  it("offers Go again in the same room and starts when clicked", () => {
    const onGoAgain = renderReady();
    expect(screen.getByText("Ready for another round?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go again" }));
    expect(onGoAgain).toHaveBeenCalledOnce();
    expect(screen.getByText("2 rounds completed in this room")).toBeTruthy();
    expect(screen.getByRole("button", { name: "← Leave room" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pomodoro" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop timer" })).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("phase progress in the HUD", () => {
  it.each([["focus", "pomodoro"], ["break", "pomodoro"], ["break", "flow"]] as const)("labels %s progress below the timer in %s mode", (phase, serverMode) => {
    renderReady(vi.fn(), { phase, serverMode, sessionStarted: true, phaseProgress: 0.58 });
    const bar = screen.getByRole("progressbar", { name: `${phase === "focus" ? "Focus" : "Break"} progress` });
    expect(bar).toHaveAttribute("aria-valuenow", "58");
    expect(screen.getByRole("timer").compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("keeps Flow focus open-ended with elapsed time", () => {
    renderReady(vi.fn(), { phase: "focus", serverMode: "flow", sessionStarted: true, flowElapsed: 492 });
    expect(screen.getByRole("timer")).toHaveTextContent("8:12");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
