import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { Task } from "@/lib/types";
const fake = vi.hoisted(() => ({ day: "2026-10-13", state: vi.fn(), save: vi.fn(), reload: vi.fn() }));
vi.mock("@/hooks/useDailyFocusGoal", () => ({ useLocalDay: () => fake.day }));
vi.mock("@/hooks/useWeeklyPlan", () => ({ useWeeklyPlan: fake.state }));
import WeeklyFocusPlan from "./WeeklyFocusPlan";
const goal = (id: string, extra: Partial<Task> = {}): Task => ({ id, content: `Goal ${id}`, owner_id: "owner", room_code: null,
  is_shared: false, is_done: false, created_at: "2026-10-01T00:00:00Z", completed_by: null, ...extra });
const state = (ids: string[] = [], extra = {}) => ({ plan: { ids, version: 1 }, loaded: true, saving: false, error: null,
  save: fake.save, reload: fake.reload, ...extra });
const props = () => ({ userId: "owner", tasks: [goal("a"), goal("b"), goal("c"), goal("d")], tasksLoaded: true, tasksError: null });
beforeEach(() => { vi.clearAllMocks(); fake.day = "2026-10-13"; fake.state.mockReturnValue(state()); });

it("selects only eligible personal goals without sharing or starting focus", () => {
  const focus = vi.fn();
  render(<WeeklyFocusPlan {...props()} tasks={[...props().tasks, goal("foreign", { owner_id: "partner" }), goal("room", { room_code: "room" }), goal("shared", { is_shared: true })]} onFocusGoal={focus} />);
  expect(screen.getByText("Oct 12–Oct 18 · Monday–Sunday")).toBeVisible();
  for (const name of ["Goal foreign", "Goal room", "Goal shared"]) expect(screen.queryByRole("option", { name })).toBeNull();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "a" } });
  fireEvent.click(screen.getByRole("button", { name: "Add to this week" }));
  expect(fake.save).toHaveBeenCalledWith(["a"]); expect(focus).not.toHaveBeenCalled();
});
it("caps the plan, tracks confirmed completed goals, and focuses only an unfinished goal", () => {
  fake.state.mockReturnValue(state(["a", "b", "c"]));
  const focus = vi.fn();
  render(<WeeklyFocusPlan {...props()} tasks={[goal("a", { is_done: true }), goal("b"), goal("c"), goal("d")]} onFocusGoal={focus} />);
  expect(screen.getByText("1 of 3 planned goals complete")).toBeVisible();
  expect(screen.getByRole("combobox")).toBeDisabled(); expect(screen.getByRole("button", { name: "Add to this week" })).toBeDisabled();
  const items = within(screen.getByRole("list")).getAllByRole("listitem");
  expect(within(items[0]).queryByRole("button", { name: "Focus on this" })).toBeNull();
  fireEvent.click(within(items[1]).getByRole("button", { name: "Focus on this" }));
  expect(focus).toHaveBeenCalledWith(goal("b"));
  fireEvent.click(within(items[0]).getByRole("button", { name: /Remove Goal a/ }));
  expect(fake.save).toHaveBeenCalledWith(["b", "c"]);
});
it("keeps unavailable goals removable and never exposes foreign goal content", () => {
  fake.state.mockReturnValue(state(["missing", "foreign"]));
  render(<WeeklyFocusPlan {...props()} tasks={[goal("foreign", { owner_id: "partner", content: "Secret" })]} />);
  expect(screen.queryByText("Secret")).toBeNull();
  expect(screen.getAllByText("Goal no longer available")).toHaveLength(2);
  fireEvent.click(screen.getAllByRole("button", { name: /Remove unavailable goal/ })[0]);
  expect(fake.save).toHaveBeenCalledWith([]);
});
it("does not claim an empty plan on errors and pauses changes when goals cannot be confirmed", () => {
  fake.state.mockReturnValue(state([], { loaded: false, error: "Read failed" }));
  const { rerender } = render(<WeeklyFocusPlan {...props()} />);
  expect(screen.queryByText(/Choose a small starting point/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reload plan" })); expect(fake.reload).toHaveBeenCalledOnce();
  fake.state.mockReturnValue(state(["a"]));
  rerender(<WeeklyFocusPlan {...props()} tasksError="Read failed" onFocusGoal={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Focus on this" })).toBeDisabled();
  expect(screen.getByRole("button", { name: /Remove Goal a/ })).toBeDisabled();
});
it("gates focus on connection and starts a new scoped plan when the week rolls over", () => {
  fake.state.mockImplementation((_owner, week) => state(week === "2026-10-12" ? ["a"] : []));
  const { rerender } = render(<WeeklyFocusPlan {...props()} focusDisabled onFocusGoal={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Focus on this" })).toBeDisabled();
  fake.day = "2026-10-19"; rerender(<WeeklyFocusPlan {...props()} />);
  expect(screen.getByText(/Choose a small starting point/)).toBeVisible();
  expect(screen.queryByRole("listitem")).toBeNull();
  expect(fake.state).toHaveBeenLastCalledWith("owner", "2026-10-19");
});
it("has a neutral server frame before the local date is known", () => {
  fake.day = ""; fake.state.mockReturnValue(state([], { loaded: false }));
  expect(renderToString(<WeeklyFocusPlan {...props()} />)).toContain("Loading your weekly plan");
  expect(fake.state).toHaveBeenCalledWith("owner", "");
});
it("loads review only after opening it and closes it on account or week changes", () => {
  const { rerender } = render(<WeeklyFocusPlan {...props()} />);
  expect(fake.state).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("region", { name: "Private weekly plan review" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review last week" }));
  expect(screen.getByRole("region", { name: "Private weekly plan review" })).toBeVisible();
  expect(fake.state).toHaveBeenCalledWith("owner", "2026-10-05");
  fake.day = "2026-10-19"; rerender(<WeeklyFocusPlan {...props()} />);
  expect(screen.queryByRole("region", { name: "Private weekly plan review" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review last week" }));
  rerender(<WeeklyFocusPlan {...props()} userId="other" />);
  expect(screen.queryByRole("region", { name: "Private weekly plan review" })).toBeNull();
  expect(screen.getByRole("button", { name: "Review last week" })).toHaveAttribute("aria-expanded", "false");
});
