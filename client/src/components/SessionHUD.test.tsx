import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SessionHUD from "./SessionHUD";

function renderReady(onGoAgain = vi.fn()) {
  render(
    <SessionHUD
      phase="ready"
      serverMode="pomodoro"
      sessionStarted={false}
      playerCount={2}
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
    expect(screen.queryByRole("button", { name: "Pomodoro" })).toBeNull();
    expect(screen.queryByRole("button", { name: "end session" })).toBeNull();
  });
});
