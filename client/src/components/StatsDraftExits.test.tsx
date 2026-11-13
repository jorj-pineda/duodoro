import { useEffect, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StatsPanel from "./StatsPanel";
import StatsScreen from "./StatsScreen";
vi.mock("@/lib/useStats", () => ({ useStats: () => ({ personalStats: null, duoStats: [], recentSessions: [], dailyFocus: [], loading: false, loaded: true, fetchStats: vi.fn(), retry: vi.fn(), error: null }) }));
vi.mock("./FocusInsights", () => ({ default: () => null }));
vi.mock("./ReflectionReview", () => ({ default: () => null }));
vi.mock("./FocusCalendar", () => ({ default: DraftCalendar }));
const { cleanupRecovery } = vi.hoisted(() => ({ cleanupRecovery: vi.fn() }));
beforeEach(() => { cleanupRecovery.mockReset().mockReturnValue(true); });
function DraftCalendar({ onDraftStateChange }: { onDraftStateChange?: (state: { dirty: boolean; busy: boolean; discard?: () => boolean }) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { onDraftStateChange?.({ dirty: !!text, busy, discard: cleanupRecovery }); }, [text, busy, onDraftStateChange]);
  return <><textarea aria-label="Reflection draft" value={text} onChange={e => setText(e.target.value)} />
    <button onClick={() => setBusy(!busy)}>Toggle save</button></>;
}
afterEach(() => vi.restoreAllMocks());
async function panel() {
  const onClose = vi.fn(); const onViewFullStats = vi.fn();
  const props = { open: true, userId: "alice", onClose, onViewFullStats };
  const view = render(<StatsPanel {...props} />);
  fireEvent.click(screen.getByRole("tab", { name: "calendar" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "private draft" } });
  return { ...view, props, onClose, onViewFullStats };
}
it("cancels Close, Escape and detailed-view exits without discarding a draft", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { onClose, onViewFullStats } = await panel();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "View detailed stats →" }));
  expect(confirm).toHaveBeenCalledTimes(3);
  expect(onClose).not.toHaveBeenCalled(); expect(onViewFullStats).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox")).toHaveValue("private draft");
});
it("keeps selection and keyboard focus when a tab change is cancelled", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  await panel();
  fireEvent.click(screen.getByRole("tab", { name: "personal" }));
  const calendar = screen.getByRole("tab", { name: "calendar" });
  expect(calendar).toHaveFocus(); calendar.focus();
  fireEvent.keyDown(calendar, { key: "ArrowRight" });
  expect(calendar).toHaveAttribute("aria-selected", "true"); expect(calendar).toHaveFocus();
  expect(screen.getByRole("textbox")).toHaveValue("private draft");
});
it("allows a confirmed tab change and clears the discarded editor", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  await panel();
  fireEvent.click(screen.getByRole("tab", { name: "personal" }));
  fireEvent.click(screen.getByRole("tab", { name: "calendar" }));
  expect(screen.getByRole("textbox")).toHaveValue(""); expect(confirm).toHaveBeenCalledTimes(1);
});
it("blocks exits while a reflection save is pending and allows exit after explicit discard", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const { onClose } = await panel();
  fireEvent.click(screen.getByRole("button", { name: "Toggle save" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox")).toHaveValue("private draft");
  fireEvent.click(screen.getByRole("button", { name: "Toggle save" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1); expect(confirm).toHaveBeenCalledTimes(1);
});
it("warns on browser unload only while protected and removes the listener on unmount", async () => {
  const { unmount } = await panel();
  const unload = new Event("beforeunload", { cancelable: true });
  act(() => { window.dispatchEvent(unload); }); expect(unload.defaultPrevented).toBe(true);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
  const clean = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(clean); expect(clean.defaultPrevented).toBe(false);
  unmount(); const after = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(after); expect(after.defaultPrevented).toBe(false);
});
it("resets guard state across accounts and close/reopen", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { rerender, props, onClose } = await panel();
  rerender(<StatsPanel {...props} userId="bob" />);
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1); expect(confirm).not.toHaveBeenCalled();
  rerender(<StatsPanel {...props} open={false} />);
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  rerender(<StatsPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(2); expect(confirm).not.toHaveBeenCalled();
});
it("protects full Stats Close and Escape too", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false); const onClose = vi.fn();
  render(<StatsScreen open userId="alice" onClose={onClose} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "full draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Close" })); fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled(); expect(confirm).toHaveBeenCalledTimes(2);
  confirm.mockReturnValue(true); fireEvent.click(screen.getByRole("button", { name: "Close" })); expect(onClose).toHaveBeenCalledTimes(1);
});

it("does not carry a blocked-exit notice into another account", async () => {
  const { rerender, props } = await panel();
  fireEvent.click(screen.getByRole("button", { name: "Toggle save" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByText(/Wait for your reflection/)).toBeInTheDocument();
  rerender(<StatsPanel {...props} userId="bob" />);
  fireEvent.click(screen.getByRole("button", { name: "Toggle save" }));
  expect(screen.queryByText(/Wait for your reflection/)).toBeNull();
});

it("blocks a confirmed Stats exit when browser-copy cleanup fails, then permits a retry", async () => {
  vi.spyOn(window,"confirm").mockReturnValue(true); cleanupRecovery.mockReturnValueOnce(false).mockReturnValue(true);
  const { onClose } = await panel(); fireEvent.click(screen.getByRole("button",{ name:"Close" }));
  expect(onClose).not.toHaveBeenCalled(); expect(screen.getByText(/Couldn't remove a browser recovery copy/)).toBeInTheDocument();
  expect(screen.getByRole("textbox")).toHaveValue("private draft");
  fireEvent.click(screen.getByRole("button",{ name:"Close" })); expect(onClose).toHaveBeenCalledOnce();
});
