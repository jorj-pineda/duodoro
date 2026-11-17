import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import FocusDateReschedule from "./FocusDateReschedule";
import type { FocusDate } from "@/lib/focusDates";
const date: FocusDate = { id: "date", proposer_id: "a", recipient_id: "b", starts_at: "2099-01-01T00:00:00Z", status: "accepted", version: 2, created_at: "2026-01-01T00:00:00Z", proposed_starts_at: "2099-01-02T00:00:00Z", reschedule_by: "a" };
it("lets only the partner accept or keep the agreed time", () => {
  const change = vi.fn().mockResolvedValue(true);
  render(<FocusDateReschedule date={date} userId="b" disabled={false} onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Keep current time" })); expect(change).toHaveBeenCalledWith(date, "decline");
  fireEvent.click(screen.getByRole("button", { name: "Accept new time" })); expect(change).toHaveBeenCalledWith(date, "accept");
  expect(screen.queryByRole("button", { name: "Withdraw time proposal" })).toBeNull();
});
it("lets the proposer withdraw without self-accepting and respects busy states", () => {
  const change = vi.fn().mockResolvedValue(true);
  const view = render(<FocusDateReschedule date={date} userId="a" disabled={false} onChange={change} />);
  expect(screen.queryByRole("button", { name: "Accept new time" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Withdraw time proposal" })); expect(change).toHaveBeenCalledWith(date, "withdraw");
  view.rerender(<FocusDateReschedule date={date} userId="a" disabled onChange={change} />);
  expect(screen.getByRole("button", { name: "Withdraw time proposal" })).toBeDisabled();
});
