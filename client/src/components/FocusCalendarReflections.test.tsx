import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const hook = vi.fn();
vi.mock("@/hooks/useFocusCalendar", () => ({ useFocusCalendar: (...args: unknown[]) => hook(...args) }));
vi.mock("@/hooks/useDailyFocusGoal", () => ({ useLocalDay: () => "2026-10-07" }));

const reads = vi.hoisted(() => ({ batches: [] as string[][], notes: new Map<string, string>() }));
vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, userId: string) => ({
          in: async (_column2: string, ids: string[]) => {
            reads.batches.push(ids);
            const data = ids.filter(id => reads.notes.has(id)).map(id => ({
              session_id: id, user_id: userId, reflection_text: reads.notes.get(id), created_at: "2026-10-07T10:00:00Z", updated_at: "2026-10-07T10:00:00Z", version: 1,
            }));
            return { data, error: null };
          },
        }),
      }),
    }),
  }),
}));

import FocusCalendar from "./FocusCalendar";

const session = (id: string, minute: number, isDuo = false) => ({
  id, focus_seconds: 1500, world: "forest", ended_at: `2026-10-07T${String(10 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00Z`, is_duo: isDuo, partner_name: "Bob",
});

beforeEach(() => {
  hook.mockReset();
  reads.batches.length = 0;
  reads.notes.clear();
});

it("loads the visible rounds in one batch, shows each person's own note under its round, and never another round's note", async () => {
  reads.notes.set("duo", "my duo note");
  hook.mockReturnValue({ rows: [{ day: "2026-10-07", solo_seconds: 1500, duo_seconds: 1500, solo_rounds: 1, duo_rounds: 1, sessions: [session("solo", 0), session("duo", 30, true)] }], loaded: true, error: null, timezone: "UTC", retry: vi.fn() });
  render(<FocusCalendar userId="alice" />);
  const duoRound = (await screen.findByText("25m · With Bob")).closest("article") as HTMLElement;
  expect(await within(duoRound).findByText("my duo note")).toBeVisible();
  const soloRound = screen.getByText("25m · Solo focus").closest("article") as HTMLElement;
  expect(within(soloRound).getByRole("button", { name: "Add reflection" })).toBeVisible();
  expect(within(soloRound).queryByText("my duo note")).toBeNull();
  expect(reads.batches).toEqual([["solo", "duo"]]);
});

it("loads only newly revealed rounds when the list is expanded past the first 20", async () => {
  const sessions = Array.from({ length: 25 }, (_, index) => session(`round-${index}`, index));
  hook.mockReturnValue({ rows: [{ day: "2026-10-07", solo_seconds: 37500, duo_seconds: 0, solo_rounds: 25, duo_rounds: 0, sessions }], loaded: true, error: null, timezone: "UTC", retry: vi.fn() });
  render(<FocusCalendar userId="alice" />);
  await waitFor(() => expect(reads.batches).toHaveLength(1));
  expect(reads.batches[0]).toHaveLength(20);
  fireEvent.click(screen.getByRole("button", { name: "Show more rounds (5 remaining)" }));
  await waitFor(() => expect(reads.batches).toHaveLength(2));
  expect(reads.batches[1]).toEqual(["round-20", "round-21", "round-22", "round-23", "round-24"]);
});
