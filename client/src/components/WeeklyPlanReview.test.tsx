import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Task } from "@/lib/types";
const fake = vi.hoisted(() => ({ state: vi.fn(), reload: vi.fn(), carry: vi.fn() }));
vi.mock("@/hooks/useWeeklyPlan", () => ({ useWeeklyPlan: fake.state }));
import WeeklyPlanReview from "./WeeklyPlanReview";

const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, content: `Goal ${id}`, owner_id: "owner", room_code: null,
  is_shared: false, is_done: false, created_at: "2026-10-01T00:00:00Z", completed_by: null, ...extra });
const past = (extra = {}) => ({ plan: { ids: ["a", "b", "c"], version: 1 }, loaded: true, saving: false, error: null, reload: fake.reload, ...extra });
const props = () => ({ userId: "owner", week: "2026-10-12", tasks: [task("a"), task("b"), task("c")], tasksLoaded: true,
  tasksError: null, current: { ids: [] as string[], version: null as number | null }, currentBlocked: false, currentError: false, onCarry: fake.carry });
beforeEach(() => { vi.clearAllMocks(); fake.state.mockReturnValue(past()); fake.carry.mockImplementation(async ids => ({ ids, version: 2 })); });

it("reviews current statuses and adds only explicitly selected unfinished personal goals", async () => {
  const { rerender } = render(<WeeklyPlanReview {...props()} tasks={[task("a"), task("b", { is_done: true }), task("c")]} current={{ ids: ["c"], version: 1 }} />);
  expect(fake.state).toHaveBeenCalledWith("owner", "2026-10-05");
  expect(screen.getByText("Oct 5–Oct 11 · Monday–Sunday")).toBeVisible();
  expect(screen.getByText("Complete now")).toBeVisible();
  expect(screen.getByText("Already in this week's plan")).toBeVisible();
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  expect(fake.carry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Goal a" }));
  expect(fake.carry).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add selected goals to this week" })));
  expect(fake.carry).toHaveBeenCalledExactlyOnceWith(["c", "a"]);
  rerender(<WeeklyPlanReview {...props()} tasks={[task("a"), task("b", { is_done: true }), task("c")]} current={{ ids: ["c", "a"], version: 2 }} />);
  expect(screen.getByText("Selected goals added to this week's plan.")).toBeVisible();
  rerender(<WeeklyPlanReview {...props()} current={{ ids: [], version: 3 }} />);
  expect(screen.queryByText("Selected goals added to this week's plan.")).toBeNull();
});
it("preserves current goals, enforces remaining capacity, and resets choices when plan revisions change", () => {
  const p = props();
  const { rerender } = render(<WeeklyPlanReview {...p} current={{ ids: ["existing", "another"], version: 1 }} tasks={[...p.tasks, task("existing"), task("another")]} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Goal a" }));
  expect(screen.getByRole("checkbox", { name: "Goal b" })).toBeDisabled();
  rerender(<WeeklyPlanReview {...p} current={{ ids: ["existing", "another"], version: 2 }} tasks={[...p.tasks, task("existing"), task("another")]} />);
  expect(screen.getByRole("checkbox", { name: "Goal a" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Add selected goals to this week" })).toBeDisabled();
  rerender(<WeeklyPlanReview {...p} current={{ ids: ["a", "b", "c"], version: 3 }} />);
  expect(screen.getByText(/three places are filled/)).toBeVisible();
});
it("does not disclose foreign, shared, room or missing goal contents and never prunes current unavailable IDs", () => {
  fake.state.mockReturnValue(past({ plan: { ids: ["foreign", "room", "shared"], version: 1 } }));
  render(<WeeklyPlanReview {...props()} tasks={[task("foreign", { owner_id: "partner", content: "Secret" }), task("room", { room_code: "room" }), task("shared", { is_shared: true })]}
    current={{ ids: ["missing"], version: 1 }} />);
  expect(screen.queryByText("Secret")).toBeNull(); expect(screen.queryByText("Goal room")).toBeNull();
  expect(screen.queryByText("Goal shared")).toBeNull(); expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.getAllByText("Goal no longer available")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Add selected goals to this week" })).toBeDisabled();
  expect(fake.carry).not.toHaveBeenCalled();
});
it("keeps read failures distinct from empty history and pauses on goal or current-plan errors", () => {
  fake.state.mockReturnValue(past({ loaded: false, error: "Failed" }));
  const { rerender } = render(<WeeklyPlanReview {...props()} />);
  expect(screen.queryByText(/No goals saved/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reload last week" })); expect(fake.reload).toHaveBeenCalledOnce();
  fake.state.mockReturnValue(past());
  rerender(<WeeklyPlanReview {...props()} currentBlocked currentError />);
  expect(screen.getByRole("checkbox", { name: "Goal a" })).toBeDisabled();
  rerender(<WeeklyPlanReview {...props()} tasksError="Failed" />);
  expect(screen.getByRole("checkbox", { name: "Goal a" })).toBeDisabled();
});
it("does not claim a carry succeeded on an unconfirmed response and does not submit duplicate clicks", async () => {
  let finish!: (value: undefined) => void;
  fake.carry.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<WeeklyPlanReview {...props()} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Goal a" }));
  const button = screen.getByRole("button", { name: "Add selected goals to this week" });
  fireEvent.click(button); fireEvent.click(button);
  expect(fake.carry).toHaveBeenCalledTimes(1); expect(button).toBeDisabled();
  await act(async () => finish(undefined));
  expect(screen.queryByText("Selected goals added to this week's plan.")).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent("Change not confirmed");
});
it("drops choices if a goal completes while the review is open", () => {
  const { rerender } = render(<WeeklyPlanReview {...props()} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Goal a" }));
  rerender(<WeeklyPlanReview {...props()} tasks={[task("a", { is_done: true }), task("b"), task("c")]} />);
  expect(screen.queryByRole("checkbox", { name: "Goal a" })).toBeNull();
  expect(screen.getByRole("button", { name: "Add selected goals to this week" })).toBeDisabled();
});
