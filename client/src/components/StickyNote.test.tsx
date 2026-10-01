import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskRow } from "./StickyNote";
import type { Task } from "@/lib/types";

const task: Task = { id: "goal", owner_id: "owner", room_code: "room", content: "Original goal", is_shared: true, is_done: true, completed_by: "partner", created_at: "2026-09-30T00:00:00Z" };
const props = () => ({ task, isOwn: true, nameFor: () => "Alex", onToggle: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn().mockResolvedValue(null) });
const startEditing = () => {
  fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
  return screen.getByRole("textbox", { name: "Edit note text" });
};

describe("inline note editor", () => {
  it("shows editing only for the owner", () => {
    render(<TaskRow {...props()} isOwn={false} />);
    expect(screen.queryByRole("button", { name: "Edit note" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete note" })).toBeNull();
  });

  it("saves trimmed text with Enter and retains the completion byline", async () => {
    const p = props();
    render(<TaskRow {...p} />);
    const input = startEditing();
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "  Updated goal  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(p.onEdit).toHaveBeenCalledWith("goal", "Updated goal"));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit note" })).toHaveFocus());
    expect(screen.getByText("✓ by Alex")).toBeInTheDocument();
    expect(p.onToggle).not.toHaveBeenCalled();
  });

  it.each(["Escape", "Cancel"])("cancels with %s without dismissing the containing dialog or writing", async (method) => {
    const p = props();
    const dismiss = vi.fn();
    render(<div onKeyDown={dismiss}><TaskRow {...p} /></div>);
    const input = startEditing();
    fireEvent.change(input, { target: { value: "Discard this" } });
    if (method === "Escape") fireEvent.keyDown(input, { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(p.onEdit).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit note" })).toHaveFocus());
  });

  it("preserves a draft through background updates and a refused save, allowing retry", async () => {
    const p = props();
    p.onEdit.mockResolvedValueOnce("Couldn't save your changes. Try again.");
    const { rerender } = render(<TaskRow {...p} />);
    fireEvent.change(startEditing(), { target: { value: "My draft" } });
    rerender(<TaskRow {...p} task={{ ...task, content: "Refreshed text" }} />);
    expect(screen.getByRole("textbox")).toHaveValue("My draft");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save"));
    expect(screen.getByRole("textbox")).toHaveValue("My draft");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(p.onEdit).toHaveBeenCalledTimes(2);
  });

  it("blocks empty saves, IME Enter, and duplicate submits during a pending save", async () => {
    let finish!: (value: null) => void;
    const p = props();
    p.onEdit.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<TaskRow {...p} />);
    const input = startEditing();
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "New text" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(p.onEdit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(p.onEdit).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => finish(null));
  });
});
