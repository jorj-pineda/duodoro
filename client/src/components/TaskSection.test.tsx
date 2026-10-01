import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TaskSection from "./TaskSection";
import type { Task } from "@/lib/types";

const task: Task = {
  id: "goal", owner_id: "owner", room_code: null, content: "Original goal",
  is_done: true, is_shared: false, completed_by: null, created_at: "2026-10-01",
};
const props = () => ({
  tasks: [task], pendingTasks: [], completedTasks: [task], newTask: "",
  setNewTask: vi.fn(), addTask: vi.fn(), toggleTask: vi.fn(), deleteTask: vi.fn(),
  clearCompleted: vi.fn(), editTask: vi.fn().mockResolvedValue(null),
});

describe("Home goal editing", () => {
  it("edits completed goals without toggling or deleting them and restores focus", async () => {
    const p = props();
    render(<TaskSection {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit goal" }));
    const input = screen.getByRole("textbox", { name: "Edit goal text" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "  Updated goal  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(p.editTask).toHaveBeenCalledWith("goal", "Updated goal"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit goal" })).toHaveFocus());
    expect(screen.getByRole("button", { name: "Mark Original goal incomplete" })).toBeInTheDocument();
    expect(p.toggleTask).not.toHaveBeenCalled();
    expect(p.deleteTask).not.toHaveBeenCalled();
  });

  it.each(["Escape", "Cancel"])("discards a Home draft using %s", async (method) => {
    const p = props();
    render(<TaskSection {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit goal" }));
    const input = screen.getByRole("textbox", { name: "Edit goal text" });
    fireEvent.change(input, { target: { value: "Discard me" } });
    if (method === "Escape") fireEvent.keyDown(input, { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "Edit goal text" })).toBeNull();
    expect(p.editTask).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit goal" })).toHaveFocus());
  });

  it("retains the draft after a failed save and lets the user retry", async () => {
    const p = props();
    p.editTask.mockResolvedValueOnce("Couldn't save your changes. Try again.");
    render(<TaskSection {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit goal" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit goal text" }), { target: { value: "My draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save"));
    expect(screen.getByRole("textbox", { name: "Edit goal text" })).toHaveValue("My draft");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Edit goal text" })).toBeNull());
    expect(p.editTask).toHaveBeenCalledTimes(2);
  });
});
