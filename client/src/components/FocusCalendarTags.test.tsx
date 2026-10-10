import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { CalendarDay, CalendarSession } from "@/lib/focusCalendar";

const hook = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useFocusCalendar", () => ({ useFocusCalendar: (...args: unknown[]) => hook(...args) }));
vi.mock("@/hooks/useDailyFocusGoal", () => ({ useLocalDay: () => "2026-10-07" }));

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }) }),
  }),
}));

import { resetFocusTagStore, retainFocusTagAccount } from "@/hooks/useSessionFocusTags";
import FocusCalendar from "./FocusCalendar";

type Tag = CalendarSession["private_tag"];
const round = (id: string, tag: Tag, options: { duo?: boolean; seconds?: number; minute?: number; version?: number | null } = {}): CalendarSession => {
  const minute = options.minute ?? 0;
  return {
    id, focus_seconds: options.seconds ?? 600, world: "forest",
    ended_at: `2026-10-07T10:${String(minute).padStart(2, "0")}:00Z`,
    is_duo: options.duo ?? false, partner_name: "Bob",
    private_tag: tag, private_tag_version: options.version === undefined ? (tag ? 1 : null) : options.version,
  };
};
const day = (sessions: CalendarSession[], extra: Partial<CalendarDay> = {}): CalendarDay => ({
  day: "2026-10-07",
  solo_seconds: sessions.filter(s => !s.is_duo).reduce((n, s) => n + s.focus_seconds, 0),
  duo_seconds: sessions.filter(s => s.is_duo).reduce((n, s) => n + s.focus_seconds, 0),
  solo_rounds: sessions.filter(s => !s.is_duo).length,
  duo_rounds: sessions.filter(s => s.is_duo).length,
  sessions, ...extra,
});

function calendar(rows: CalendarDay[], overrides: Record<string, unknown> = {}) {
  hook.mockReturnValue({ rows, loaded: true, error: null, timezone: "UTC", retry: vi.fn(async () => true), tagsAvailable: true, ...overrides });
}
const tagFilter = () => screen.getByRole("combobox", { name: "Filter by private tag" });
const article = (label: string) => screen.getByText(label).closest("article") as HTMLElement;

beforeEach(() => {
  hook.mockReset();
  rpc.mockReset();
  resetFocusTagStore();
  retainFocusTagAccount("alice");
});

it("combines the tag filter with Solo/Duo across totals, day cells, details and empty states", () => {
  calendar([day([
    round("s1", null, { minute: 0 }), round("s2", "work", { minute: 10 }),
    round("d1", "work", { duo: true, seconds: 1500, minute: 20 }), round("d2", "study", { duo: true, seconds: 1500, minute: 40 }),
  ])]);
  render(<FocusCalendar userId="alice" />);
  expect(screen.getByText("1h 10m · 4 completed rounds this month")).toBeVisible();

  fireEvent.change(tagFilter(), { target: { value: "work" } });
  expect(screen.getByText("35m · 2 matching rounds this month")).toBeVisible();
  expect(screen.getByText(/Matching rounds only: rounds tagged Work/)).toBeVisible();
  expect(screen.getByRole("button", { name: /^2026-10-07: 35m matching focus, 2 rounds$/ })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Duo" }));
  expect(screen.getByText("25m · 1 matching round this month")).toBeVisible();
  expect(screen.getByText("25m · With Bob")).toBeVisible();

  fireEvent.change(tagFilter(), { target: { value: "study" } });
  fireEvent.click(screen.getByRole("button", { name: "Solo" }));
  expect(screen.getByText("0s · 0 matching rounds this month")).toBeVisible();
  expect(screen.getByText("No completed solo rounds tagged Study on this day.")).toBeVisible();

  fireEvent.change(tagFilter(), { target: { value: "untagged" } });
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  expect(screen.getByText("10m · 1 matching round this month")).toBeVisible();
  expect(screen.getByText(/rounds without a private tag/)).toBeVisible();
});

it("applies the tag filter to the complete month before the 20-round display page", () => {
  const sessions = Array.from({ length: 25 }, (_, index) => round(`r${index}`, index === 22 ? "work" : null, { minute: index % 60, seconds: 60 }));
  calendar([day(sessions)]);
  render(<FocusCalendar userId="alice" />);
  expect(screen.getByRole("button", { name: "Show more rounds (5 remaining)" })).toBeVisible();

  fireEvent.change(tagFilter(), { target: { value: "work" } });
  expect(screen.getByText("1m · 1 matching round this month")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Show more rounds/ })).toBeNull();
  expect(screen.getAllByRole("article")).toHaveLength(1);
});

it("keeps the selected day, resets the display limit to 20, and keeps the filter while changing it", () => {
  const sessions = Array.from({ length: 45 }, (_, index) => round(`u${index}`, null, { minute: index % 60, seconds: 60 }));
  calendar([day(sessions)]);
  render(<FocusCalendar userId="alice" />);
  fireEvent.click(screen.getByRole("button", { name: "Show more rounds (25 remaining)" }));
  expect(screen.getByRole("button", { name: "Show more rounds (5 remaining)" })).toBeVisible();

  fireEvent.change(tagFilter(), { target: { value: "untagged" } });
  expect(screen.getByRole("button", { name: "Show more rounds (25 remaining)" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "2026-10-07" })).toBeVisible();

  fireEvent.change(tagFilter(), { target: { value: "work" } });
  expect(screen.getByText("No completed focus rounds tagged Work on this day.")).toBeVisible();
  expect(screen.getByText("No completed focus rounds tagged Work this month.")).toBeVisible();
  expect(tagFilter()).toHaveValue("work");
});

it("disables the filter and explains unavailability when the API omits tag fields", () => {
  calendar([day([round("s1", null, { version: null })])], { tagsAvailable: false });
  render(<FocusCalendar userId="alice" />);
  expect(tagFilter()).toBeDisabled();
  expect(screen.getByText("Private tags are unavailable right now. Your rounds and totals are unaffected.")).toBeVisible();
  expect(screen.queryByRole("combobox", { name: "Private tag" })).toBeNull();
});

it("moves focus to the selected day and says so when a save removes its round from the filter", async () => {
  rpc.mockResolvedValue({ data: [{ session_id: "s1", user_id: "alice", tag: "work", version: 12, updated_at: "2026-10-09T10:00:00Z" }], error: null });
  calendar([day([round("s1", null, { version: null, minute: 0 }), round("s2", "study", { minute: 10 })])]);
  render(<FocusCalendar userId="alice" />);
  fireEvent.change(tagFilter(), { target: { value: "untagged" } });
  const row = article("10m · Solo focus");
  fireEvent.change(within(row).getByRole("combobox", { name: "Private tag" }), { target: { value: "work" } });
  expect(rpc).not.toHaveBeenCalled();
  fireEvent.click(within(row).getByRole("button", { name: "Save tag" }));

  await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_session_focus_tag", { p_session_id: "s1", p_tag: "work", p_expected_version: null }));
  await waitFor(() => expect(screen.queryAllByRole("article")).toHaveLength(0));
  expect(screen.getByText(/That round no longer matches the current filters/)).toBeVisible();
  await waitFor(() => expect(document.getElementById("focus-calendar-alice-2026-10-07")).toHaveFocus());
});

it("keeps a round's reflection draft when its private tag is saved", async () => {
  rpc.mockResolvedValue({ data: [{ session_id: "s1", user_id: "alice", tag: "reading", version: 3, updated_at: "2026-10-09T10:00:00Z" }], error: null });
  calendar([day([round("s1", null, { version: null })])]);
  render(<FocusCalendar userId="alice" />);
  const row = article("10m · Solo focus");
  fireEvent.click(within(row).getByRole("button", { name: "Add reflection" }));
  fireEvent.change(within(row).getByRole("textbox", { name: "How did this session go?" }), { target: { value: "still typing" } });
  fireEvent.change(within(row).getByRole("combobox", { name: "Private tag" }), { target: { value: "reading" } });
  await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Save tag" })); });
  expect(await within(row).findByText("Tag saved")).toBeVisible();
  expect(within(row).getByRole("textbox", { name: "How did this session go?" })).toHaveValue("still typing");
});

it("shows a conflict for a stale revision and keeps the user's selection", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "PT409", message: "Focus tag changed elsewhere" } });
  calendar([day([round("s1", "work", { minute: 0, version: 4 })])]);
  render(<FocusCalendar userId="alice" />);
  const row = article("10m · Solo focus");
  fireEvent.change(within(row).getByRole("combobox", { name: "Private tag" }), { target: { value: "other" } });
  fireEvent.click(within(row).getByRole("button", { name: "Save tag" }));
  expect(await within(row).findByText(/nothing was overwritten/)).toBeVisible();
  expect(rpc).toHaveBeenCalledWith("set_session_focus_tag", { p_session_id: "s1", p_tag: "other", p_expected_version: 4 });
  expect(within(row).getByRole("combobox", { name: "Private tag" })).toHaveValue("other");
});
