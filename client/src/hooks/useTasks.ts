"use client";
import { useState, useCallback, useEffect } from "react";
import { getSupabase } from "@/lib/supabase";
import { taskFromRow, type Task } from "@/lib/types";

export function useTasks(ownerId: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState("");
  // Writes can legitimately be refused now that migration 016 scopes them, and
  // an RLS refusal on update/delete is not an error — it matches zero rows. So
  // these check what actually happened instead of assuming success.
  const [error, setError] = useState<string | null>(null);
  const sb = getSupabase();

  const fetchTasks = useCallback(async () => {
    const { data, error: err } = await sb
      .from("tasks")
      .select("*")
      .eq("owner_id", ownerId)
      .is("room_code", null)
      .order("created_at", { ascending: true });
    // A failed read used to fall through to `if (data)` and leave the list
    // empty, so a broken query was indistinguishable from having no tasks.
    // That is exactly how the 42P17 policy recursion fixed in migration 018
    // stayed invisible: every read was erroring and the UI said "No tasks yet".
    if (err) {
      setError("Couldn't load your tasks.");
      return;
    }
    setError(null);
    if (data) setTasks(data.map(taskFromRow));
  }, [sb, ownerId]);

  useEffect(() => {
    // The rule can't see through the async boundary: these fetchers await a
    // network round trip before any setState, so nothing here is a synchronous
    // cascading render. Suppressed rather than restructured — the alternative
    // is a data-fetching library, which is a bigger change than this earns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTasks();
  }, [fetchTasks]);

  const addTask = async () => {
    const text = newTask.trim();
    if (!text) return;
    setError(null);
    const { data, error: err } = await sb
      .from("tasks")
      .insert({ owner_id: ownerId, content: text })
      .select()
      .single();
    if (err || !data) {
      setError("Couldn't save that task.");
      return;
    }
    setTasks((p) => [...p, taskFromRow(data)]);
    setNewTask("");
  };

  const toggleTask = async (id: string, done: boolean) => {
    setError(null);
    const { data, error: err } = await sb
      .from("tasks")
      .update({ is_done: done })
      .eq("id", id)
      .select("id");
    if (err || !data || data.length === 0) {
      setError("Couldn't update that task.");
      return;
    }
    setTasks((p) => p.map((t) => (t.id === id ? { ...t, is_done: done } : t)));
  };

  const editTask = async (id: string, content: string): Promise<string | null> => {
    const text = content.trim();
    const task = tasks.find((row) => row.id === id);
    if (!task || task.owner_id !== ownerId || task.room_code !== null) {
      return "You can only edit your own goals.";
    }
    if (!text || text.length > 500) return "Use between 1 and 500 characters.";
    try {
      const { data, error: err } = await sb
        .from("tasks")
        .update({ content: text })
        .eq("id", id)
        .eq("owner_id", ownerId)
        .is("room_code", null)
        .select("id, content");
      if (err || data?.length !== 1 || data[0].id !== id) {
        return "Couldn't save your changes. Try again.";
      }
      const content = data[0].content;
      setTasks((rows) => rows.map((row) => row.id === id ? { ...row, content } : row));
      return null;
    } catch {
      return "Couldn't save your changes. Try again.";
    }
  };

  const deleteTask = async (id: string) => {
    setError(null);
    const { data, error: err } = await sb
      .from("tasks")
      .delete()
      .eq("id", id)
      .select("id");
    if (err || !data || data.length === 0) {
      setError("Couldn't delete that task.");
      return;
    }
    setTasks((p) => p.filter((t) => t.id !== id));
  };

  const pendingTasks = tasks.filter((t) => !t.is_done);
  const completedTasks = tasks.filter((t) => t.is_done);

  const clearCompleted = async () => {
    const ids = completedTasks.map((t) => t.id);
    if (ids.length === 0) return;
    setError(null);
    // RLS can turn a refused DELETE into a successful zero-row response. Ask
    // PostgREST to return the rows it actually removed and only drop those
    // ids locally; a stale or unauthorized row must remain visible.
    const { data, error: err } = await sb
      .from("tasks")
      .delete()
      .in("id", ids)
      .select("id");
    if (err || !data) {
      setError("Couldn't clear those tasks.");
      return;
    }
    const deletedIds = new Set(data.map((row) => row.id));
    setTasks((p) => p.filter((task) => !deletedIds.has(task.id)));
    if (deletedIds.size !== ids.length) {
      setError("Couldn't clear all completed tasks.");
    }
  };

  return {
    tasks,
    newTask,
    setNewTask,
    addTask,
    toggleTask,
    deleteTask,
    editTask,
    pendingTasks,
    completedTasks,
    clearCompleted,
    error,
    clearError: () => setError(null),
  };
}
