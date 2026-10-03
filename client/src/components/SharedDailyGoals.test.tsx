import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import SharedDailyGoals from "./SharedDailyGoals";
import type { SharedDailyGoal } from "@/hooks/useSharedDailyGoals";
import type { Profile } from "@/lib/types";
const mocks = vi.hoisted(() => {
  const rpc = vi.fn(), select = vi.fn(), on = vi.fn(), subscribe = vi.fn();
  const channel = { on, subscribe };
  on.mockReturnValue(channel);
  const sb = { rpc, from: vi.fn(() => ({ delete: () => ({ eq: () => ({ select }) }) })), channel: vi.fn(() => channel), removeChannel: vi.fn() };
  return { rpc, select, subscribe, sb };
});
vi.mock("@/lib/supabase", () => ({ getSupabase: () => mocks.sb }));
const friend = { id: "friend", display_name: "Alex", username: "alex" } as Profile;
const goal = (overrides: Partial<SharedDailyGoal> = {}): SharedDailyGoal => ({
  id: "goal", partner_id: "friend", partner_name: "Alex", created_by: "me", target_minutes: 60,
  timezone: "America/Chicago", accepted: true, day: "2026-10-03", resets_at: new Date(Date.now() + 3600000).toISOString(),
  my_seconds: 1200, partner_seconds: 600, ...overrides,
});
const response = (goals: SharedDailyGoal[]) => ({ data: goals, error: null });
const props = { userId: "me", friends: [friend], friendsError: null, friendsLoaded: true, onOpenFriends: vi.fn() };
beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue(response([goal()]));
  mocks.select.mockReset().mockResolvedValue({ data: [{ id: "goal" }], error: null });
  mocks.subscribe.mockReset();
  mocks.sb.removeChannel.mockClear();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("shared daily goals", () => {
  it("has accessible goal controls and progress", async () => {
    const { container } = render(<SharedDailyGoals {...props} />);
    await screen.findByText("30m / 1h 0m today");
    await expectNoAxeViolations(container);
  });
  it("uses a neutral SSR snapshot and loads both saved contributions", async () => {
    expect(renderToString(<SharedDailyGoals {...props} />)).toContain("Loading shared goals…");
    expect(mocks.rpc).not.toHaveBeenCalled();
    render(<SharedDailyGoals {...props} />);
    await screen.findByText("30m / 1h 0m today");
    expect(screen.getByText("You: 20m · Alex: 10m")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });
  it("invites a friend with the combined target and browser timezone", async () => {
    mocks.rpc.mockResolvedValueOnce(response([])).mockResolvedValueOnce({ data: "goal", error: null }).mockResolvedValue(response([goal({ accepted: false, my_seconds: null, partner_seconds: null })]));
    render(<SharedDailyGoals {...props} />);
    const invite = await screen.findByRole("button", { name: "Invite to daily goal" });
    fireEvent.change(screen.getByLabelText("Shared daily target"), { target: { value: "90" } });
    fireEvent.click(invite);
    await screen.findByText(/Waiting for your friend to accept/);
    expect(mocks.rpc).toHaveBeenCalledWith("create_shared_daily_goal", { friend_id: "friend", minutes: 90, tz: expect.any(String) });
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept goal" })).toBeNull();
  });
  it("asks the recipient to accept before showing contributions", async () => {
    mocks.rpc.mockResolvedValueOnce(response([goal({ accepted: false, created_by: "friend", my_seconds: null, partner_seconds: null })])).mockResolvedValueOnce({ data: "goal", error: null }).mockResolvedValue(response([goal()]));
    render(<SharedDailyGoals {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept goal" }));
    await screen.findByText("30m / 1h 0m today");
    expect(mocks.rpc).toHaveBeenCalledWith("accept_shared_daily_goal", { goal_id: "goal" });
  });
  it("keeps a failed target draft for retry and reports zero-row deletes", async () => {
    render(<SharedDailyGoals {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit target" }));
    fireEvent.change(screen.getByLabelText("Edit shared target"), { target: { value: "90" } });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: {} });
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Edit shared target")).toHaveValue("90");
    mocks.rpc.mockResolvedValueOnce({ data: "goal", error: null }).mockResolvedValue(response([goal({ target_minutes: 90 })]));
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));
    await screen.findByText("30m / 1h 30m today");
    expect(screen.queryByLabelText("Edit shared target")).toBeNull();
    mocks.select.mockResolvedValueOnce({ data: [], error: null });
    fireEvent.click(screen.getByRole("button", { name: "End shared goal" }));
    await screen.findByRole("alert");
    expect(screen.getByText("You + Alex")).toBeVisible();
  });
  it("doesn't turn a failed read into an empty goal list or zero progress", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: {} });
    render(<SharedDailyGoals {...props} />);
    const retry = await screen.findByRole("button", { name: "Refresh shared goals" });
    expect(screen.queryByRole("button", { name: "Invite to daily goal" })).toBeNull();
    fireEvent.click(retry);
    await screen.findByText("30m / 1h 0m today");
  });
  it("coalesces return events, discards stale reads, and cleans listeners", async () => {
    let resolveOld!: (value: ReturnType<typeof response>) => void;
    mocks.rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { unmount } = render(<SharedDailyGoals {...props} />);
    act(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    await act(async () => resolveOld(response([])));
    await screen.findByText("30m / 1h 0m today");
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    unmount();
    act(() => window.dispatchEvent(new Event("focus")));
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.sb.removeChannel).toHaveBeenCalled();
  });
  it("refreshes at shared midnight and polls only while visible", async () => {
    vi.useFakeTimers();
    mocks.rpc.mockResolvedValue(response([goal({ resets_at: new Date(Date.now() + 1000).toISOString() })]));
    render(<SharedDailyGoals {...props} />);
    await act(async () => {});
    mocks.rpc.mockResolvedValue(response([goal({ my_seconds: 0, partner_seconds: 0 })]));
    await act(async () => vi.advanceTimersByTimeAsync(1100));
    expect(screen.getByText("0m / 1h 0m today")).toBeVisible();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const before = mocks.rpc.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.rpc).toHaveBeenCalledTimes(before);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    mocks.rpc.mockResolvedValue(response([]));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(screen.queryByText("You + Alex")).toBeNull();
  });
  it("refreshes after realtime reconnection and labels failed progress reads", async () => {
    render(<SharedDailyGoals {...props} />);
    await screen.findByText("30m / 1h 0m today");
    mocks.rpc.mockResolvedValueOnce({ data: null, error: {} });
    act(() => mocks.subscribe.mock.calls[0][0]("SUBSCRIBED"));
    await screen.findByRole("alert");
    expect(screen.getByText("30m / 1h 0m last loaded")).toBeVisible();
    mocks.rpc.mockResolvedValue(response([goal({ my_seconds: 3600 })]));
    fireEvent.click(screen.getByRole("button", { name: "Refresh shared goals" }));
    await screen.findByText(/Goal reached!/);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});
