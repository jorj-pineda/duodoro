import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DailyFocusGoal from "./DailyFocusGoal";
import { expectNoAxeViolations } from "@/test/axe";

const props = { userId: "goal-user", today: "2026-09-29", dailyFocus: [
  { day: "2026-09-28", focusSeconds: 7200, sessionCount: 4 },
  { day: "2026-09-29", focusSeconds: 1500, sessionCount: 1 },
], loading: false, loaded: true, error: null };

beforeEach(() => localStorage.clear());

describe("daily focus goal", () => {
  it("uses today's completed focus and updates the saved target", () => {
    const { unmount } = render(<DailyFocusGoal {...props} />);
    expect(screen.getByText("25m / 1h 0m today")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42");
    fireEvent.change(screen.getByLabelText("Daily focus target"), { target: { value: "25" } });
    expect(screen.getByText(/Goal reached!/)).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    expect(localStorage.getItem("duodoro:daily-goal:goal-user")).toBe("25");
    unmount();
    render(<DailyFocusGoal {...props} />);
    expect((screen.getByLabelText("Daily focus target") as HTMLSelectElement).value).toBe("25");
  });
  it("keeps targets separate between accounts and rejects invalid stored values", () => {
    localStorage.setItem("duodoro:daily-goal:goal-user", "120");
    localStorage.setItem("duodoro:daily-goal:other-user", "-5");
    const { rerender } = render(<DailyFocusGoal {...props} />);
    expect(screen.getByText("25m / 2h 0m today")).toBeTruthy();
    rerender(<DailyFocusGoal {...props} userId="other-user" />);
    expect(screen.getByText("25m / 1h 0m today")).toBeTruthy();
  });
  it("caps progress while showing the actual total and treats a missing day as zero", () => {
    const { rerender } = render(<DailyFocusGoal {...props} dailyFocus={[{ day: props.today, focusSeconds: 5400, sessionCount: 3 }]} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByText(/1h 30m \/ 1h 0m today/)).toBeTruthy();
    rerender(<DailyFocusGoal {...props} today="2026-09-30" />);
    expect(screen.getByText("0m / 1h 0m today")).toBeTruthy();
  });
  it("does not present zero progress when stats are loading or failed", () => {
    const { rerender } = render(<DailyFocusGoal {...props} loading />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    rerender(<DailyFocusGoal {...props} error="offline" />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText(/progress is unavailable/)).toBeTruthy();
    rerender(<DailyFocusGoal {...props} loaded={false} dailyFocus={[]} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
  it("updates across tabs and remains usable when storage writes are blocked", () => {
    render(<DailyFocusGoal {...props} userId="blocked-user" />);
    localStorage.setItem("duodoro:daily-goal:blocked-user", "90");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "duodoro:daily-goal:blocked-user" })));
    expect((screen.getByLabelText("Daily focus target") as HTMLSelectElement).value).toBe("90");
    localStorage.removeItem("duodoro:daily-goal:blocked-user");
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    fireEvent.change(screen.getByLabelText("Daily focus target"), { target: { value: "30" } });
    expect((screen.getByLabelText("Daily focus target") as HTMLSelectElement).value).toBe("30");
    spy.mockRestore();
  });
  it("is accessible and server rendering does not reveal browser preferences", async () => {
    localStorage.setItem("duodoro:daily-goal:goal-user", "120");
    expect(renderToStaticMarkup(<DailyFocusGoal {...props} />)).toContain('value="60" selected');
    const { container } = render(<DailyFocusGoal {...props} />);
    await expectNoAxeViolations(container);
  });
});
