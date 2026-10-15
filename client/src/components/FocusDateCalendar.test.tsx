import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { FocusDate } from "@/lib/focusDates";
const fake = vi.hoisted(() => ({ read: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: fake.read }) }) }) }) }));
vi.mock("@/lib/focusDateCalendar", async original => ({ ...await original<typeof import("@/lib/focusDateCalendar")>(), downloadCalendarFile: fake.download }));
import FocusDateCalendar from "./FocusDateCalendar";
const row: FocusDate = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", proposer_id: "a", recipient_id: "b", status: "accepted", version: 2,
  starts_at: "2099-10-20T15:30:00Z", created_at: "2026-10-10T15:30:00Z" };
beforeEach(() => { vi.clearAllMocks(); fake.read.mockResolvedValue({ data: row, error: null }); });
const open = () => fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
const download = () => fireEvent.click(screen.getByRole("button", { name: "Download .ics file" }));
it("has a neutral SSR frame, reads only on explicit download and never claims calendar import", async () => {
  expect(renderToString(<FocusDateCalendar userId="a" date={row} disabled={false} />)).toContain("Add to calendar");
  render(<FocusDateCalendar userId="a" date={row} disabled={false} />); open();
  expect(fake.read).not.toHaveBeenCalled(); expect(fake.download).not.toHaveBeenCalled();
  expect(screen.getByText(/remove or update the event in your calendar yourself/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Calendar block length"), { target: { value: "50" } });
  const button = screen.getByRole("button", { name: "Download .ics file" });
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(fake.download).toHaveBeenCalledOnce()); expect(fake.read).toHaveBeenCalledOnce();
  const file = fake.download.mock.calls[0][0];
  expect(file.content).toContain("DTEND:20991020T162000Z");
  expect(screen.getByRole("status")).toHaveTextContent("Open the download in your calendar to import it");
});
it("never exports a pending, stale, cancelled, expired or foreign date", async () => {
  const view = render(<FocusDateCalendar userId="a" date={{ ...row, status: "pending" }} disabled={false} />);
  expect(screen.queryByRole("button", { name: "Add to calendar" })).toBeNull();
  view.rerender(<FocusDateCalendar userId="a" date={row} disabled={false} />); open();
  for (const data of [null, { ...row, version: 3, status: "cancelled" }, { ...row, status: "pending" },
    { ...row, starts_at: "2020-01-01T00:00:00Z" }, { ...row, proposer_id: "outsider", recipient_id: "other" }]) {
    fake.read.mockResolvedValueOnce({ data, error: null }); download();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Reload focus dates/));
  }
  expect(fake.download).not.toHaveBeenCalled();
});
it("reports read and browser failures honestly and permits a deliberate retry", async () => {
  fake.read.mockRejectedValueOnce(new Error("offline"));
  render(<FocusDateCalendar userId="a" date={row} disabled={false} />); open(); download();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Couldn't prepare/)); expect(fake.download).not.toHaveBeenCalled();
  fake.download.mockImplementationOnce(() => { throw new Error("blocked"); }); download();
  await waitFor(() => expect(fake.download).toHaveBeenCalledOnce()); expect(screen.queryByRole("status")).toBeNull();
  download(); await waitFor(() => expect(screen.getByRole("status")).toBeVisible());
});
it("drops late responses after unmount, account changes, or a pending date mutation", async () => {
  let finish!: (value: unknown) => void;
  fake.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<FocusDateCalendar userId="a" date={row} disabled={false} />); open(); download();
  view.rerender(<FocusDateCalendar userId="a" date={row} disabled />);
  await act(async () => finish({ data: row, error: null })); expect(fake.download).not.toHaveBeenCalled();
  view.rerender(<FocusDateCalendar userId="a" date={row} disabled={false} />); download();
  view.rerender(<FocusDateCalendar userId="outsider" date={row} disabled={false} />);
  await act(async () => finish({ data: row, error: null })); expect(fake.download).not.toHaveBeenCalled();
  view.rerender(<FocusDateCalendar userId="a" date={row} disabled={false} />); download(); view.unmount();
  await act(async () => finish({ data: row, error: null })); expect(fake.download).not.toHaveBeenCalled();
});
