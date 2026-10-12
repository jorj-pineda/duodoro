import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const save = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useSessionFocusTags", () => ({ saveSessionFocusTag: (...args: unknown[]) => save(...args) }));

import SessionFocusTag from "./SessionFocusTag";

const sessionId = "session-1";
const base = {
  userId: "alice", sessionId, available: true,
};

beforeEach(() => { save.mockReset(); });

function setup(saved: { tag: "work" | "study" | "creative" | "reading" | "planning" | "other" | null; version: number } | null, reload = vi.fn(async () => true), onSaved = vi.fn()) {
  const view = render(<SessionFocusTag {...base} saved={saved} onSaved={onSaved} reload={reload} />);
  const select = () => screen.getByRole("combobox", { name: "Private tag" }) as HTMLSelectElement;
  return { ...view, select, reload, onSaved, rerenderWith: (next: typeof saved) => view.rerender(<SessionFocusTag {...base} saved={next} onSaved={onSaved} reload={reload} />) };
}

it("uses a labeled native select and never saves when an option is chosen", () => {
  const { select } = setup({ tag: null, version: 4 });
  expect(select()).toHaveValue("");
  fireEvent.change(select(), { target: { value: "work" } });
  expect(select()).toHaveValue("work");
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Save tag" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
  expect(screen.getByText("Only you can see this.")).toHaveAttribute("id", expect.any(String));
  expect(select()).toHaveAccessibleDescription("Only you can see this.");
});

it("saves the chosen tag with the revision frozen at the first change, and Cancel restores the saved value", async () => {
  save.mockResolvedValue({ ok: true, saved: { tag: "study", version: 5 } });
  const { select, onSaved } = setup({ tag: "work", version: 4 });
  fireEvent.change(select(), { target: { value: "study" } });
  fireEvent.click(screen.getByRole("button", { name: "Save tag" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("alice", sessionId, "study", 4));
  expect(await screen.findByText("Tag saved")).toBeVisible();
  expect(onSaved).toHaveBeenCalledWith(sessionId);
  expect(select()).toHaveValue("study");
  expect(select()).toHaveFocus();

  fireEvent.change(select(), { target: { value: "other" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(select()).toHaveValue("study");
  expect(save).toHaveBeenCalledTimes(1);
});

it("keeps the draft and the submitted revision when a background refresh changes the saved copy", async () => {
  save.mockResolvedValue({ ok: false, failure: { kind: "changed", message: "changed" } });
  const { select, rerenderWith, reload } = setup({ tag: "work", version: 4 });
  fireEvent.change(select(), { target: { value: "planning" } });
  rerenderWith({ tag: "reading", version: 9 });
  expect(select()).toHaveValue("planning");
  expect(screen.getByText(/changed in another tab or device/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save tag" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("alice", sessionId, "planning", 4));
  expect(select()).toHaveValue("planning");
  expect(screen.getByText(/Your selection is still here; nothing was overwritten/)).toBeVisible();
  expect(reload).toHaveBeenCalled();
});

it("keeps the selection after a conflict, and only a successful explicit reload replaces it", async () => {
  save.mockResolvedValue({ ok: false, failure: { kind: "changed", message: "changed" } });
  // The first read is the background refresh that the conflict triggers.
  const reload = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const { select, rerenderWith } = setup({ tag: "work", version: 4 }, reload);
  fireEvent.change(select(), { target: { value: "creative" } });
  fireEvent.click(screen.getByRole("button", { name: "Save tag" }));
  await screen.findByText(/nothing was overwritten/);

  fireEvent.click(screen.getByRole("button", { name: /Reload saved tag/ }));
  expect(await screen.findByText(/Couldn't reload the saved tag/)).toBeVisible();
  expect(select()).toHaveValue("creative");

  rerenderWith({ tag: "reading", version: 9 });
  fireEvent.click(screen.getByRole("button", { name: /Reload saved tag/ }));
  expect(await screen.findByText("Saved tag reloaded.")).toBeVisible();
  expect(select()).toHaveValue("reading");
});

it("releases pending state after a rejected save and offers a retry that submits the same revision", async () => {
  save.mockResolvedValueOnce({ ok: false, failure: { kind: "unconfirmed", message: "Couldn't confirm" } })
    .mockResolvedValueOnce({ ok: true, saved: { tag: "work", version: 5 } });
  const { select } = setup({ tag: null, version: 3 });
  fireEvent.change(select(), { target: { value: "work" } });
  fireEvent.click(screen.getByRole("button", { name: "Save tag" }));
  expect(await screen.findByText("Couldn't confirm")).toBeVisible();
  expect(screen.getByRole("button", { name: "Reload saved tag" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save tag" }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith("alice", sessionId, "work", 3));
  expect(await screen.findByText("Tag saved")).toBeVisible();
});

it("shows pending status and ignores duplicate submissions until the first one finishes", async () => {
  let finish!: (value: unknown) => void;
  save.mockImplementationOnce(() => new Promise(done => { finish = done; }));
  const { select } = setup({ tag: null, version: 2 });
  fireEvent.change(select(), { target: { value: "reading" } });
  fireEvent.click(screen.getByRole("button", { name: "Save tag" }));
  expect(await screen.findByText("Saving tag…")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save tag" }));
  fireEvent.click(screen.getByRole("button", { name: "Save tag" }));
  expect(save).toHaveBeenCalledTimes(1);
  finish({ ok: true, saved: { tag: "reading", version: 6 } });
  expect(await screen.findByText("Tag saved")).toBeVisible();
});

it("offers No tag as a real clear, not as a tag identifier", async () => {
  save.mockResolvedValue({ ok: true, saved: { tag: null, version: 8 } });
  const { select } = setup({ tag: "other", version: 7 });
  fireEvent.change(select(), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save tag" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("alice", sessionId, null, 7));
  expect(await screen.findByText("Tag removed")).toBeVisible();
});

it("renders nothing when private tags are unavailable, so no editor is offered", () => {
  render(<SessionFocusTag {...base} available={false} saved={null} onSaved={vi.fn()} reload={vi.fn()} />);
  expect(screen.queryByRole("combobox", { name: "Private tag" })).toBeNull();
});

it("survives unmounting while a save is pending: the confirmed result still reaches the parent and nothing throws", async () => {
  let finish!: (value: unknown) => void;
  save.mockImplementationOnce(() => new Promise(done => { finish = done; }));
  const onSaved = vi.fn();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const view = render(<SessionFocusTag {...base} saved={{ tag: null, version: 2 }} onSaved={onSaved} reload={vi.fn()} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Private tag" }), { target: { value: "other" } });
  fireEvent.click(screen.getByRole("button", { name: "Save tag" }));
  view.unmount();
  finish({ ok: true, saved: { tag: "other", version: 3 } });
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(sessionId));
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});
