import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/types";
const fake = vi.hoisted(() => ({ hook: vi.fn(), propose: vi.fn(), respond: vi.fn(), reload: vi.fn() }));
vi.mock("@/hooks/useFocusDates", () => ({ useFocusDates: fake.hook }));
import SharedFocusDates from "./SharedFocusDates";
const row = { id: "date", proposer_id: "a", recipient_id: "b", status: "pending", version: 1,
  starts_at: "2099-10-20T15:30:00Z", created_at: "2026-10-10T15:30:00Z" };
const state = (dates = [row], extra = {}) => ({ dates, disabled: false, busy: false, loadError: null, actionError: null,
  propose: fake.propose, respond: fake.respond, reload: fake.reload, ...extra });
const props = { userId: "a", friends: [{ id: "b", display_name: "Partner" }] as Profile[], friendsLoaded: true, friendsError: null, onOpenFriends: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); fake.hook.mockReturnValue(state()); fake.propose.mockResolvedValue(true); fake.respond.mockResolvedValue(true); });
it("shows pending consent and lets only the recipient accept or decline", async () => {
  const { rerender } = render(<SharedFocusDates {...props} />);
  expect(screen.getByText("Waiting for your friend to accept")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Accept date" })).toBeNull();
  rerender(<SharedFocusDates {...props} userId="b" friends={[{ id: "a", display_name: "Proposer" }] as Profile[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Accept date" }));
  await waitFor(() => expect(fake.respond).toHaveBeenCalledWith(row, "accepted"));
  expect(screen.getByText("Focus date accepted.")).toBeVisible();
});
it("does not send a proposal until explicit submit and retries an unconfirmed creation with the same ID", async () => {
  fake.propose.mockResolvedValueOnce(false);
  render(<SharedFocusDates {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Propose a focus date" }));
  fireEvent.change(screen.getByLabelText("Your local date and time"), { target: { value: "2099-10-20T15:30" } });
  expect(fake.propose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send date proposal" }));
  expect(screen.getByRole("alert")).toHaveTextContent("future local time within 90 days");
  const day = new Date(Date.now() + 2 * 86_400_000);
  const value = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,"0")}-${String(day.getDate()).padStart(2,"0")}T12:30`;
  fireEvent.change(screen.getByLabelText("Your local date and time"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Send date proposal" }));
  await waitFor(() => expect(fake.propose).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(/request confirmed/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reload focus dates" }));
  fireEvent.click(screen.getByRole("button", { name: "Send date proposal" }));
  await waitFor(() => expect(fake.propose).toHaveBeenCalledTimes(2));
  expect(fake.propose.mock.calls[0]).toEqual(fake.propose.mock.calls[1]);
  expect(screen.getByText(/request confirmed/)).toBeVisible();
});
it("keeps errors explicit, blocks writes and hides drafts when accounts change", () => {
  fake.hook.mockReturnValue(state([], { dates: null, loadError: "Unavailable", disabled: true }));
  const { rerender } = render(<SharedFocusDates {...props} />);
  expect(screen.queryByText("No upcoming focus dates.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Propose a focus date" }));
  expect(screen.getByRole("button", { name: "Send date proposal" })).toBeDisabled();
  rerender(<SharedFocusDates {...props} userId="b" />);
  expect(screen.queryByLabelText("Your local date and time")).toBeNull();
});
it("has a neutral server frame and gives either participant cancellation after acceptance", () => {
  fake.hook.mockReturnValue(state([], { dates: null, disabled: true }));
  const html = renderToString(<SharedFocusDates {...props} />);
  expect(html).toContain("Loading focus dates"); expect(html).not.toContain("<time");
  fake.hook.mockReturnValue(state([{ ...row, status: "accepted" }]));
  render(<SharedFocusDates {...props} userId="b" />);
  const card = screen.getByRole("article");
  expect(within(card).getByText("Accepted by both of you")).toBeVisible();
  fireEvent.click(within(card).getByRole("button", { name: "Cancel date" }));
  expect(fake.respond).toHaveBeenCalledWith({ ...row, status: "accepted" }, "cancelled");
});
it("labels the old list honestly after an unconfirmed write", () => {
  fake.hook.mockReturnValue(state([], { actionError: "Couldn't confirm this change.", disabled: true }));
  render(<SharedFocusDates {...props} />);
  expect(screen.queryByText("No upcoming focus dates.")).toBeNull();
  expect(screen.getByText("No dates in the last loaded list.")).toBeVisible();
  expect(screen.getByText("Showing the last loaded dates.")).toBeVisible();
});
