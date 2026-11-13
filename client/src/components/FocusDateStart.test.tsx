import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { FocusDate } from "@/lib/focusDates";
const { read } = vi.hoisted(() => ({ read:vi.fn() }));
vi.mock("@/lib/supabase",() => ({ getSupabase:() => ({ from:() => ({ select:() => ({ eq:() => ({ maybeSingle:read }) }) }) }) }));
import FocusDateStart from "./FocusDateStart";
const date: FocusDate = { id:"date",proposer_id:"a",recipient_id:"b",version:2,status:"accepted",starts_at:"2099-01-01T00:00:00Z",created_at:"2026-01-01T00:00:00Z" };
beforeEach(() => { vi.resetAllMocks(); read.mockResolvedValue({ data:date,error:null }); });
it("checks the accepted date on explicit click before opening ordinary room setup", async () => {
  const open = vi.fn(); render(<FocusDateStart date={date} userId="a" disabled={false} onOpenRoom={open} />);
  expect(read).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(open).toHaveBeenCalledOnce()); expect(read).toHaveBeenCalledOnce();
});
it("blocks stale, cancelled, expired, missing or foreign dates", async () => {
  const open = vi.fn(); render(<FocusDateStart date={date} userId="a" disabled={false} onOpenRoom={open} />);
  for (const data of [null,{ ...date,version:3 },{ ...date,status:"cancelled" },{ ...date,starts_at:"2020-01-01T00:00:00Z" },{ ...date,proposer_id:"other",recipient_id:"outside" }]) {
    read.mockResolvedValueOnce({ data,error:null }); fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Reload focus dates"));
  }
  expect(open).not.toHaveBeenCalled();
});
it("allows an explicit retry after an unavailable read", async () => {
  read.mockRejectedValueOnce(new Error("offline")); const open = vi.fn();
  render(<FocusDateStart date={date} userId="a" disabled={false} onOpenRoom={open} />); fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("alert"); expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button")); await waitFor(() => expect(open).toHaveBeenCalledOnce());
});
it("drops late reads when room creation becomes disabled or the component unmounts", async () => {
  let resolve!: (value: unknown) => void; read.mockImplementation(() => new Promise(done => { resolve = done; }));
  const open = vi.fn(); const view = render(<FocusDateStart date={date} userId="a" disabled={false} onOpenRoom={open} />);
  fireEvent.click(screen.getByRole("button")); view.rerender(<FocusDateStart date={date} userId="a" disabled onOpenRoom={open} />);
  await act(async () => resolve({ data:date,error:null })); expect(open).not.toHaveBeenCalled();
  view.rerender(<FocusDateStart date={date} userId="a" disabled={false} onOpenRoom={open} />); fireEvent.click(screen.getByRole("button")); view.unmount();
  await act(async () => resolve({ data:date,error:null })); expect(open).not.toHaveBeenCalled();
});
