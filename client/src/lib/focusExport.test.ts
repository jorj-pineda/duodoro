import { beforeEach, expect, it, vi } from "vitest";
import { csvCell, exportRange, focusCsv, loadFocusExport } from "./focusExport";
const { from, getUser } = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn() }));
vi.mock("./supabase", () => ({ getSupabase: () => ({ from, auth: { getUser } }) }));
const options = { from: "2026-01-01", to: "2026-01-31", reflections: false, tags: false };
const round = { id: "a", started_at: "2026-01-01T23:00:00Z", ended_at: "2026-01-02T00:00:00Z", actual_focus: 600, completed: true, world: "forest" };
function query(data: unknown, error: unknown = null) {
  const q = { select: vi.fn(), eq: vi.fn(), gte: vi.fn(), lt: vi.fn(), order: vi.fn(), limit: vi.fn(), gt: vi.fn(), in: vi.fn(), abortSignal: vi.fn() };
  Object.values(q).forEach(fn => fn.mockReturnValue(q));
  q.abortSignal.mockResolvedValue({ data, error }); return q;
}
beforeEach(() => { vi.resetAllMocks(); getUser.mockResolvedValue({ data: { user: { id: "me" } }, error: null }); });
it("validates inclusive UTC day bounds, leap days and a bounded range", () => {
  expect(exportRange("2024-02-29", "2024-02-29")).toEqual({ start: "2024-02-29T00:00:00.000Z", end: "2024-03-01T00:00:00.000Z" });
  for (const dates of [["2026-02-29", "2026-03-01"], ["2026-01-02", "2026-01-01"], ["2024-01-01", "2026-01-01"]]) expect(() => exportRange(...dates as [string,string])).toThrow();
});
it("escapes spreadsheet formulas, quotes, commas, Unicode and multiline text", () => {
  expect(csvCell(' =HYPERLINK("x")')).toBe('"\' =HYPERLINK(""x"")"');
  expect(csvCell("\tplain")).toBe('"\'\tplain"');
  const csv = focusCsv([{ ...round, reflection: '私,\n"note"', tag: "study" }, { ...round, completed: false }], { ...options, reflections: true, tags: true });
  expect(csv).toContain('"私,\n""note"""'); expect(csv).toContain('"Stopped"'); expect(csv).toContain("(UTC)");
});
it("omits optional private content and all identifiers from CSV by default", () => {
  const csv = focusCsv([{ ...round, reflection: "SECRET", tag: "study" }], options);
  expect(csv).not.toContain("SECRET"); expect(csv).not.toContain("study"); expect(csv).not.toContain('"a"');
});
it("continues after short API pages, filters ownership, and never reads private tables without opt-in", async () => {
  const first = query([round]); const second = query([{ ...round, id: "b", completed: false }]); const end = query([]);
  from.mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(end);
  const rows = await loadFocusExport("me", options, new AbortController().signal);
  expect(rows).toHaveLength(2); expect(first.eq).toHaveBeenCalledWith("session_participants.user_id", "me");
  expect(second.gt).toHaveBeenCalledWith("id", "a"); expect(end.gt).toHaveBeenCalledWith("id", "b");
  expect(from.mock.calls.flat()).toEqual(["sessions", "sessions", "sessions"]);
});
it("joins only explicitly opted-in metadata belonging to the caller", async () => {
  const notes = query([{ session_id: "a", reflection_text: "mine" }]); const tags = query([{ session_id: "a", tag: "study" }]);
  from.mockReturnValueOnce(query([round])).mockReturnValueOnce(notes).mockReturnValueOnce(tags).mockReturnValueOnce(query([]));
  const rows = await loadFocusExport("me", { ...options, reflections: true, tags: true }, new AbortController().signal);
  expect(rows[0]).toMatchObject({ reflection: "mine", tag: "study" });
  expect(notes.eq).toHaveBeenCalledWith("user_id", "me"); expect(tags.eq).toHaveBeenCalledWith("user_id", "me");
});
it("rejects a failed later page instead of returning a partial export", async () => {
  from.mockReturnValueOnce(query([round])).mockReturnValueOnce(query(null, new Error("offline")));
  await expect(loadFocusExport("me", options, new AbortController().signal)).rejects.toThrow("No file");
});
it("rejects changed accounts and cancellation before returning any records", async () => {
  from.mockReturnValueOnce(query([]));
  getUser.mockResolvedValueOnce({ data: { user: { id: "me" } } }).mockResolvedValueOnce({ data: { user: { id: "other" } } });
  await expect(loadFocusExport("me", options, new AbortController().signal)).rejects.toThrow("account changed");
  const controller = new AbortController(); controller.abort();
  await expect(loadFocusExport("me", options, controller.signal)).rejects.toThrow();
});
