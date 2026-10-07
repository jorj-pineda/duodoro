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


it.each(['waiting', 'ready', 'focus', 'celebration', 'returning'] as const)('keeps break ideas out of %s', phase => {
  renderReady(vi.fn(), { phase, breakActivities: <span>Optional ideas here</span> });
  expect(screen.queryByText('Optional ideas here')).toBeNull();
});
it('shows break ideas alongside the existing server-derived break timer', () => {
  renderReady(vi.fn(), { phase: 'break', sessionStarted: true, timeLeft: 59, breakActivities: <span>Optional ideas here</span> });
  expect(screen.getByText('Optional ideas here')).toBeVisible();
  expect(screen.getByRole('timer')).toHaveTextContent('0:59');
});

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

it.each(['ready', 'focus', 'break', 'celebration', 'returning'] as const)('hides setup presets during %s', phase => {
  renderReady(vi.fn(), { phase, timerPresets: <span>Preset setup controls</span> });
  expect(screen.queryByText('Preset setup controls')).toBeNull();
});
it('shows presets during waiting setup', () => {
  renderReady(vi.fn(), { phase: 'waiting', timerPresets: <span>Preset setup controls</span> });
  expect(screen.getByText('Preset setup controls')).toBeVisible();
});

it.each(['waiting', 'ready', 'break', 'celebration', 'returning'] as const)('restores extras during %s with quiet mode enabled', phase => {
  renderReady(vi.fn(), { phase, quietFocus: true, reactions: <span>Reaction choices</span>, companionNames: <span>Companion names</span> });
  expect(screen.getByText('Reaction choices')).toBeVisible(); expect(screen.getByText('Companion names')).toBeVisible();
  expect(screen.getByText('2 rounds completed in this room')).toBeVisible();
});
it.each(['pomodoro', 'flow'] as const)('keeps %s timer and essential actions usable in quiet focus', serverMode => {
  const onStop = vi.fn(), onLeave = vi.fn(), onFinishFlow = vi.fn();
  renderReady(vi.fn(), { phase: 'focus', serverMode, sessionStarted: true, quietFocus: true,
    quietFocusSetting: <span>Quiet choice</span>, reactions: <span>Reaction choices</span>,
    companionGrowth: <span>Companion growth</span>, companionNames: <span>Companion names</span>,
    intentionPrompt: <span>Intention draft</span>, timeLeft: 123, flowElapsed: 123, phaseProgress: .4,
    onStop, onLeave, onFinishFlow });
  expect(screen.getByRole('timer')).toHaveTextContent('2:03');
  for (const text of ['Reaction choices', 'Companion growth', 'Companion names', '2 rounds completed in this room']) expect(screen.queryByText(text)).toBeNull();
  expect(screen.getByText('Intention draft')).toBeVisible(); expect(screen.getByText('Quiet choice')).toBeVisible();
  if (serverMode === 'pomodoro') expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
  else { fireEvent.click(screen.getByRole('button', { name: 'Take break' })); expect(onFinishFlow).toHaveBeenCalledOnce(); }
  fireEvent.click(screen.getByRole('button', { name: 'Stop timer' })); expect(onStop).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '← Leave room' })); expect(onLeave).toHaveBeenCalledOnce();
});
