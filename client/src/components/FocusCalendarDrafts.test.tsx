import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CalendarDay } from "@/lib/focusCalendar";
const fake = vi.hoisted(() => ({ today: "2026-10-07", hook: vi.fn(), rpc: vi.fn() }));
vi.mock("@/hooks/useDailyFocusGoal", () => ({ useLocalDay: () => fake.today }));
vi.mock("@/hooks/useFocusCalendar", () => ({ useFocusCalendar: (...args: unknown[]) => fake.hook(...args) }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc: fake.rpc, from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }) }) }) }));
import { resetSessionReflectionStore, retainReflectionAccount } from "@/hooks/useSessionReflections";
import FocusCalendar from "./FocusCalendar";
const rows: CalendarDay[] = [{ day: "2026-10-07", solo_seconds: 600, solo_rounds: 1, duo_seconds: 0, duo_rounds: 0,
  sessions: [{ id: "round-1", ended_at: "2026-10-07T12:00:00Z", focus_seconds: 600, world: "forest", is_duo: false, partner_name: "", private_tag: null, private_tag_version: null }] }];
const day = (date: string) => screen.getByRole("button", { name: new RegExp(`^${date}:`) });
const editor = () => screen.getByRole("textbox", { name: "How did this session go?" });
async function draft() {
  fireEvent.click(await screen.findByRole("button", { name: "Add reflection" }));
  fireEvent.change(editor(), { target: { value: "Keep this private draft" } });
}
beforeEach(() => {
  fake.today = "2026-10-07";
  fake.rpc.mockReset(); fake.hook.mockReset();
  fake.hook.mockImplementation((_id, month) => ({ rows: month === "2026-10" ? rows : [], loaded: true, error: null, retry: vi.fn(), tagsAvailable: true, timezone: "UTC" }));
  resetSessionReflectionStore(); retainReflectionAccount("alice");
});
afterEach(() => vi.restoreAllMocks());

it("keeps the draft and day when day navigation is cancelled", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<FocusCalendar userId="alice" />); await draft();
  fireEvent.click(day("2026-10-08"));
  expect(editor()).toHaveValue("Keep this private draft");
  expect(day("2026-10-07")).toHaveAttribute("aria-pressed", "true");
  expect(fake.rpc).not.toHaveBeenCalled();
});

it("does not fetch another month when discarding is cancelled", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<FocusCalendar userId="alice" />); await draft();
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  expect(editor()).toHaveValue("Keep this private draft");
  expect(fake.hook.mock.calls.every(call => call[1] === "2026-10")).toBe(true);
});

it("changes months only after explicit discard and does not write the discarded draft", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<FocusCalendar userId="alice" />); await draft();
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  expect(confirm).toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "September 2026" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(await screen.findByRole("button", { name: "Add reflection" })).toBeVisible();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(fake.rpc).not.toHaveBeenCalled();
});

it("keeps keyboard focus and the selected day after cancelled arrow navigation", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<FocusCalendar userId="alice" />); await draft();
  day("2026-10-07").focus();
  fireEvent.keyDown(day("2026-10-07"), { key: "ArrowRight" });
  expect(day("2026-10-07")).toHaveFocus();
  expect(editor()).toHaveValue("Keep this private draft");
});

it("guards filters too and discards the editor even if the round still matches", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<FocusCalendar userId="alice" />); await draft();
  fireEvent.click(screen.getByRole("button", { name: "Solo" }));
  expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  expect(editor()).toHaveValue("Keep this private draft");
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Solo" }));
  expect(await screen.findByRole("button", { name: "Add reflection" })).toBeVisible();
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("keeps an edited day selected across the local date rollover", async () => {
  const { rerender } = render(<FocusCalendar userId="alice" />); await draft();
  fake.today = "2026-10-08";
  rerender(<FocusCalendar userId="alice" />);
  expect(editor()).toHaveValue("Keep this private draft");
  expect(day("2026-10-07")).toHaveAttribute("aria-pressed", "true");
});

it("waits for an in-flight save instead of discarding a pending write", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  let finish!: (value: unknown) => void;
  fake.rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<FocusCalendar userId="alice" />); await draft();
  fireEvent.click(screen.getByRole("button", { name: "Save reflection" }));
  await waitFor(() => expect(fake.rpc).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  expect(confirm).not.toHaveBeenCalled();
  expect(editor()).toBeDisabled();
  await act(async () => { finish({ data: [{ session_id: "round-1", user_id: "alice", reflection_text: "Keep this private draft", version: 1, created_at: "2026-10-07T12:00:00Z", updated_at: "2026-10-07T12:00:00Z" }], error: null }); });
  await waitFor(() => expect(screen.getByText("Reflection saved")).toBeVisible());
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  expect(screen.getByRole("heading", { name: "September 2026" })).toBeVisible();
});
