import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDay } from "@/hooks/useDailyFocusGoal";
import RoundRecap from "./RoundRecap";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc }) }));
const recap = { round: 1, focusSeconds: 492, mode: "flow" as const, saveState: "pending" as const };
const rows = (seconds: number) => ({ data: [{ day: localDay(), focus_seconds: seconds, session_count: 1 }], error: null });
beforeEach(() => {
  rpc.mockReset().mockResolvedValue(rows(1200));
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("round recap", () => {
  it("shows exact Flow duration and only persisted goal progress until confirmed", async () => {
    const { rerender } = render(<RoundRecap recap={recap} userId="recap-test" />);
    expect(screen.getByText("8:12 Flow completed")).toBeVisible();
    expect(screen.getByText(/Save pending/)).toBeVisible();
    await screen.findByText("20m / 1h 0m saved today");
    rpc.mockResolvedValue(rows(1692));
    rerender(<RoundRecap recap={{ ...recap, saveState: "saved" }} userId="recap-test" />);
    await screen.findByText("28m / 1h 0m saved today");
    expect(screen.getByText("Round saved")).toBeVisible();
    expect(rpc).toHaveBeenLastCalledWith("get_daily_focus", { days: 1, tz: expect.any(String) });
  });

  it("does not present failed reads as zero progress and allows retry", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Unavailable" } });
    render(<RoundRecap recap={{ ...recap, saveState: "unconfirmed" }} userId="recap-test" />);
    expect(screen.getByText(/Save unconfirmed/)).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: "Retry progress" }));
    await screen.findByText("20m / 1h 0m saved today");
    expect(screen.queryByText(/^0m \/ 1h/)).toBeNull();
  });

  it("refreshes on tab return and prevents an older request from replacing fresh progress", async () => {
    let resolveOld!: (value: ReturnType<typeof rows>) => void;
    rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    render(<RoundRecap recap={recap} userId="recap-test" />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    act(() => window.dispatchEvent(new Event("focus")));
    await screen.findByText("20m / 1h 0m saved today");
    await act(async () => resolveOld(rows(0)));
    expect(screen.getByText("20m / 1h 0m saved today")).toBeVisible();
    rpc.mockResolvedValue(rows(3600));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await screen.findByText(/Goal reached!/);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("uses the account's target and accepts successful empty history", async () => {
    localStorage.setItem("duodoro:daily-goal:recap-test", "25");
    rpc.mockResolvedValue({ data: [], error: null });
    render(<RoundRecap recap={{ ...recap, mode: "pomodoro", focusSeconds: 1500, saveState: "saving" }} userId="recap-test" />);
    expect(screen.getByText("25:00 focus completed")).toBeVisible();
    expect(screen.getByText("Saving round…")).toBeVisible();
    await screen.findByText("0m / 25m saved today");
  });

  it("uses a neutral SSR progress snapshot without browser reads", () => {
    const markup = renderToString(<RoundRecap recap={recap} userId="recap-test" />);
    expect(markup).toContain("Loading today’s progress…");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("removes refresh listeners on unmount", async () => {
    const { unmount } = render(<RoundRecap recap={recap} userId="recap-test" />);
    await screen.findByText("20m / 1h 0m saved today");
    const before = rpc.mock.calls.length;
    unmount();
    act(() => window.dispatchEvent(new Event("focus")));
    expect(rpc).toHaveBeenCalledTimes(before);
  });
});
