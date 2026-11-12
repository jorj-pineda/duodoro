import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import FocusHistoryExport from "./FocusHistoryExport";
const { load, download } = vi.hoisted(() => ({ load: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/focusExport", async importOriginal => ({ ...await importOriginal<object>(), loadFocusExport: load, downloadFocusCsv: download }));
beforeEach(() => { vi.resetAllMocks(); });
function setup() {
  const view = render(<FocusHistoryExport userId="me" />);
  fireEvent.change(screen.getByLabelText("Export from (UTC)"), { target: { value: "2026-01-01" } });
  fireEvent.change(screen.getByLabelText("Export through (UTC)"), { target: { value: "2026-01-31" } });
  return view;
}
it("keeps private content opt-in and offers an explicit download", async () => {
  load.mockResolvedValue([{ id: "a", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:10:00Z", completed: false, actual_focus: 600, world: "forest" }]);
  setup(); expect(load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
  await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
  expect(load.mock.calls[0][1]).toMatchObject({ reflections: false, tags: false });
  expect(download.mock.calls[0][0]).toContain("Stopped");
});
it("does not download an empty or failed export", async () => {
  load.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("No file was downloaded."));
  setup(); fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
  await screen.findByText(/No saved rounds/);
  fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
  await screen.findByText("No file was downloaded."); expect(download).not.toHaveBeenCalled();
});
it("aborts and prevents a late download on unmount", async () => {
  let resolve!: (rows: unknown[]) => void; load.mockReturnValue(new Promise(done => { resolve = done; }));
  const view = setup(); fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
  const signal: AbortSignal = load.mock.calls[0][2]; view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => { resolve([{ id: "a" }]); }); expect(download).not.toHaveBeenCalled();
});

it("cancels immediately even while authentication is waiting and ignores its late response", async () => {
  let resolve!: (rows: unknown[]) => void; load.mockReturnValue(new Promise(done => { resolve = done; }));
  setup(); fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
  expect(screen.getByRole("button", { name: "Download CSV" })).toBeEnabled();
  await act(async () => { resolve([{ id: "a" }]); }); expect(download).not.toHaveBeenCalled();
});
