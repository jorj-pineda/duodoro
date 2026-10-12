import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { expectNoAxeViolations } from "@/test/axe";
import SessionIntentions, { IntentionRecap } from "./SessionIntentions";

afterEach(cleanup);
const empty = { current: {}, next: {} };
const props = { intentions: empty, userId: "alice", phase: "waiting", names: { alice: "Alice", bob: "Bob" }, onSave: vi.fn(async () => null), onEditingChange: vi.fn() };

describe("session intentions", () => {
  it("keeps intentions optional and supports keyboard save, clear, and cancellation", async () => {
    const { rerender } = render(<SessionIntentions {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Add intention" }));
    const input = screen.getByRole("textbox", { name: "Your session intention" });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("maxLength", "160");
    fireEvent.change(input, { target: { value: "Read notes" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add intention" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Write chapter" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(props.onSave).toHaveBeenCalledWith("Write chapter");
    rerender(<SessionIntentions {...props} intentions={{ current: {}, next: { alice: "Write chapter", bob: "Read notes" } }} />);
    expect(screen.getByText("Bob: Read notes")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear intention" }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(""));
  });
  it("preserves a failed draft and an open draft through remote updates or a phase race", async () => {
    const onSave = vi.fn(async () => "Offline. Try again.");
    const { rerender } = render(<SessionIntentions {...props} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Add intention" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep my draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save intention" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("textbox")).toHaveValue("Keep my draft");
    rerender(<SessionIntentions {...props} phase="focus" intentions={{ current: {}, next: { bob: "Partner plan" } }} onSave={onSave} />);
    expect(screen.getByRole("textbox")).toHaveValue("Keep my draft");
    expect(screen.getByRole("button", { name: "Save intention" })).toBeDisabled();
    rerender(<SessionIntentions {...props} phase="break" onSave={onSave} />);
    expect(screen.getByRole("button", { name: "Save intention" })).toBeEnabled();
  });
  it("lets only the owner resolve their intention, without implying timer completion did it", async () => {
    const onResolve = vi.fn(async () => null);
    const recap = { round: 1, focusSeconds: 1500, mode: "pomodoro" as const, saveState: "saved" as const,
      intentions: { alice: { text: "Write chapter", displayName: "Alice", completed: false }, bob: { text: "Read notes", displayName: "Bob", completed: true } } };
    const { rerender } = render(<IntentionRecap recap={recap} userId="alice" next="" onResolve={onResolve} />);
    expect(screen.getByText("Not marked done")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Mark intention done" })).toHaveLength(1);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Mark intention done" })));
    expect(onResolve).toHaveBeenCalledWith(1, "done");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Carry into next round" })));
    expect(onResolve).toHaveBeenCalledWith(1, "carry");
    rerender(<IntentionRecap recap={recap} userId="alice" next="Write chapter" onResolve={onResolve} />);
    expect(screen.getByRole("button", { name: "Carried into next round" })).toBeDisabled();
  });
  it("renders neutral SSR and accessible inputs and recap actions", async () => {
    expect(renderToString(<SessionIntentions {...props} />)).toContain("Optional");
    const { container } = render(<SessionIntentions {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Add intention" }));
    await expectNoAxeViolations(container);
  });
});
it('stages goal text privately, preserves long text for review, and publishes only after Save', async () => {
  const onSave = vi.fn(async () => null); const onGoalDismiss = vi.fn();
  render(<SessionIntentions {...props} goalDraft={'x'.repeat(200)} onSave={onSave} onGoalDismiss={onGoalDismiss} />);
  expect(screen.getByRole('textbox')).toHaveValue('x'.repeat(200));
  expect(screen.getByRole('button',{ name: 'Save intention' })).toBeDisabled();
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'),{ target: { value: 'Reviewed goal' } });
  fireEvent.click(screen.getByRole('button',{ name: 'Save intention' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('Reviewed goal'));
  expect(onGoalDismiss).toHaveBeenCalled();
});
it('cancels a goal draft without sharing or editing the underlying goal', () => {
  const onSave = vi.fn(); const onGoalDismiss = vi.fn();
  render(<SessionIntentions {...props} goalDraft="Private goal" onSave={onSave} onGoalDismiss={onGoalDismiss} />);
  fireEvent.click(screen.getByRole('button',{ name: 'Cancel' }));
  expect(onSave).not.toHaveBeenCalled(); expect(onGoalDismiss).toHaveBeenCalled();
});
it('keeps a selected goal private while an existing focus round is running, then allows review during break', () => {
  const onSave = vi.fn();
  const { rerender } = render(<SessionIntentions {...props} phase="focus" goalDraft="Next private goal" onSave={onSave} />);
  expect(screen.getByRole('textbox')).toHaveValue('Next private goal');
  expect(screen.getByRole('button',{ name: 'Save intention' })).toBeDisabled();
  expect(onSave).not.toHaveBeenCalled();
  rerender(<SessionIntentions {...props} phase="break" goalDraft="Next private goal" onSave={onSave} />);
  expect(screen.getByRole('textbox')).toHaveValue('Next private goal');
  expect(screen.getByRole('button',{ name: 'Save intention' })).toBeEnabled();
});
