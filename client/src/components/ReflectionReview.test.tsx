import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { CalendarSession } from "@/lib/focusCalendar";
import type { ReflectionEntry } from "@/hooks/useSessionReflections";

const fake = vi.hoisted(() => ({ day: "2026-10-12", calendar: vi.fn(), entries: vi.fn(), retry: vi.fn(), load: vi.fn() }));
vi.mock("@/hooks/useDailyFocusGoal", () => ({ useLocalDay: () => fake.day }));
vi.mock("@/hooks/useFocusCalendar", () => ({ useFocusCalendar: fake.calendar }));
vi.mock("@/hooks/useSessionReflections", () => ({ useSessionReflections: fake.entries, loadSessionReflections: fake.load }));
import ReflectionReview from "./ReflectionReview";
import { rememberFocusTags, resetFocusTagStore, retainFocusTagAccount } from "@/hooks/useSessionFocusTags";

const round = (id: string, overrides: Partial<CalendarSession> = {}): CalendarSession => ({
  id, focus_seconds: 600, world: "forest", ended_at: "2026-10-12T12:00:00Z", is_duo: false,
  partner_name: "Partner", private_tag: "work", private_tag_version: 1, ...overrides,
});
const entry = (id: string, text: string, overrides: Partial<ReflectionEntry> = {}): ReflectionEntry => ({
  status: "ready", pending: null, seq: 1,
  reflection: { sessionId: id, userId: "owner", text, createdAt: "2026-10-12T12:00:00Z", updatedAt: "2026-10-12T12:00:00Z", version: 1 },
  ...overrides,
});
const state = (sessions: CalendarSession[] = [], overrides = {}) => ({
  loaded: true, error: null, timezone: "America/Chicago", tagsAvailable: true, retry: fake.retry,
  rows: [{ day: "2026-10-12", sessions }], ...overrides,
});
beforeEach(() => {
  vi.clearAllMocks(); resetFocusTagStore(); retainFocusTagAccount("owner");
  fake.day = "2026-10-12"; fake.calendar.mockReturnValue(state()); fake.entries.mockReturnValue({}); fake.retry.mockResolvedValue(true);
});

it("loads the complete month and filters notes before pagination, including older notes", () => {
  const sessions = Array.from({ length: 25 }, (_, i) => round(`s${i}`, { ended_at: `2026-10-12T12:${String(59 - i).padStart(2, "0")}:00Z` }));
  sessions[24].is_duo = true; sessions[24].private_tag = "study";
  fake.calendar.mockReturnValue(state(sessions));
  fake.entries.mockReturnValue(Object.fromEntries(sessions.map(s => [s.id, entry(s.id, s.id === "s24" ? "Older useful note" : `Saved note ${s.id}`)])));
  render(<ReflectionReview userId="owner" />);
  expect(fake.entries).toHaveBeenCalledWith("owner", sessions.map(s => s.id));
  expect(screen.getAllByRole("article")).toHaveLength(20);
  fireEvent.click(screen.getByRole("button", { name: "Show more reflections (5 remaining)" }));
  expect(screen.getAllByRole("article")).toHaveLength(25);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  OLDER useful  " } });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  fireEvent.change(screen.getByRole("combobox", { name: "Round type" }), { target: { value: "duo" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Private tag" }), { target: { value: "study" } });
  expect(screen.getByText("Older useful note")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Show more reflections/ })).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "Round type" }), { target: { value: "solo" } });
  expect(screen.getByText(/No reflections match/)).toBeVisible();
});

it("orders by round completion, keeps multiline plain text, and excludes partner or mismatched notes", () => {
  const sessions = [round("old"), round("new", { ended_at: "2026-10-12T14:00:00Z" }), round("partner"), round("wrong")];
  fake.calendar.mockReturnValue(state(sessions));
  fake.entries.mockReturnValue({ old: entry("old", "Old note"), new: entry("new", "<script>plain text</script>\nSecond line"),
    partner: entry("partner", "Partner secret", { reflection: { ...entry("partner", "Partner secret").reflection!, userId: "partner" } }),
    wrong: entry("wrong", "Wrong session", { reflection: entry("other", "Wrong session").reflection }),
  });
  const { container } = render(<ReflectionReview userId="owner" />);
  const articles = screen.getAllByRole("article");
  expect(articles[0]).toHaveTextContent("<script>plain text</script>");
  expect(articles[0].querySelector("p.whitespace-pre-wrap")?.textContent).toBe("<script>plain text</script>\nSecond line");
  expect(articles[1]).toHaveTextContent("Old note");
  expect(container.querySelector("script")).toBeNull();
  expect(screen.queryByText("Partner secret")).toBeNull(); expect(screen.queryByText("Wrong session")).toBeNull();
});

it("never calls a failed or partial note read an empty month and retries both rounds and notes", async () => {
  fake.calendar.mockReturnValue(state([round("s1"), round("s2")]));
  fake.entries.mockReturnValue({ s1: entry("s1", "Previously loaded", { status: "error" }) });
  const { rerender } = render(<ReflectionReview userId="owner" />);
  expect(screen.getByRole("alert")).toHaveTextContent("list may be incomplete");
  expect(screen.getByText("Previously loaded")).toBeVisible();
  expect(screen.getByText(/Loading your reflections/)).toBeVisible();
  expect(screen.queryByText(/No saved reflections/)).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry reflections" })));
  expect(fake.load).toHaveBeenCalledWith("owner", ["s1", "s2"]);
  fake.entries.mockReturnValue({ s1: entry("s1", "", { reflection: null }), s2: entry("s2", "", { reflection: null }) });
  rerender(<ReflectionReview userId="owner" />);
  expect(screen.getByText(/No saved reflections this month/)).toBeVisible();
});

it("waits for the local month and does not show stale-month empty states after refresh failures", () => {
  fake.day = ""; fake.calendar.mockReturnValue(state([], { loaded: false }));
  const { rerender } = render(<ReflectionReview userId="owner" />);
  expect(screen.getByText("Your local month")).toBeVisible();
  expect(screen.getByRole("button", { name: "Previous reflection month" })).toBeDisabled();
  expect(screen.queryByText(/No saved reflections/)).toBeNull();
  fake.day = "2026-10-12"; fake.calendar.mockReturnValue(state([], { error: "refresh failed" }));
  rerender(<ReflectionReview userId="owner" />);
  expect(screen.getByRole("alert")).toHaveTextContent("Showing the last loaded rounds");
  expect(screen.queryByText(/No saved reflections/)).toBeNull();
});

it("labels last confirmed notes while a change is pending and never calls them an empty result", () => {
  fake.calendar.mockReturnValue(state([round("s1")]));
  fake.entries.mockReturnValue({ s1: entry("s1", "Last confirmed note", { pending: "save" }) });
  render(<ReflectionReview userId="owner" />);
  expect(screen.getByText(/A reflection change is still being saved/)).toBeVisible();
  expect(screen.getByRole("article")).toHaveTextContent("Last confirmed note");
  expect(screen.getByText("1 loaded matching reflection")).toBeVisible();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "unsaved draft" } });
  expect(screen.queryByText(/No reflections match/)).toBeNull();
});

it("shows unavailable tags honestly and uses newer confirmed private edits", () => {
  fake.calendar.mockReturnValue(state([round("s1")])); fake.entries.mockReturnValue({ s1: entry("s1", "Saved") });
  const { rerender } = render(<ReflectionReview userId="owner" />);
  act(() => rememberFocusTags("owner", [{ sessionId: "s1", tag: "creative", version: 2 }]));
  expect(within(screen.getByRole("article")).getByText("Creative")).toBeVisible();
  act(() => rememberFocusTags("partner", [{ sessionId: "s1", tag: "study", version: 3 }]));
  expect(within(screen.getByRole("article")).queryByText("Study")).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "Private tag" }), { target: { value: "untagged" } });
  expect(screen.queryByRole("article")).toBeNull();
  fake.calendar.mockReturnValue(state([round("s1")], { tagsAvailable: false }));
  rerender(<ReflectionReview userId="owner" />);
  expect(screen.getByRole("combobox", { name: "Private tag" })).toBeDisabled();
  expect(screen.getByText(/Private tags are unavailable/)).toBeVisible();
  expect(screen.getByRole("article")).toHaveTextContent("Saved");
  expect(screen.getByRole("article")).not.toHaveTextContent("No tag");
});

it("clears controls and notes immediately when the account changes", () => {
  fake.calendar.mockImplementation((owner: string) => owner === "owner" ? state([round("s1")]) : state([], { loaded: false }));
  fake.entries.mockImplementation((owner: string) => owner === "owner" ? { s1: entry("s1", "Owner secret") } : {});
  const { rerender } = render(<ReflectionReview userId="owner" />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Owner secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Previous reflection month" }));
  rerender(<ReflectionReview userId="partner" />);
  expect(screen.getByRole("searchbox")).toHaveValue("");
  expect(screen.queryByText("Owner secret")).toBeNull();
  expect(fake.calendar).toHaveBeenLastCalledWith("partner", "2026-10");
});

it("does not launch a reflection read when a retained month refresh is rejected", async () => {
  fake.calendar.mockReturnValue(state([round("s1")], { error: "failed" }));
  fake.retry.mockResolvedValue(false);
  render(<ReflectionReview userId="owner" />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry reflections" })));
  expect(fake.load).not.toHaveBeenCalled();
});
