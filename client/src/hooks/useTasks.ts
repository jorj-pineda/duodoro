"use client";
import { useState, useEffect, useRef } from "react";
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

  const writeRevision = useRef(0);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let queued = false;
    const refresh = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      queued = true;
      if (inFlight) return;
      inFlight = true;
      try {
        while (queued && !disposed && document.visibilityState === "visible") {
          queued = false;
          const revision = writeRevision.current;
          try {
            const { data, error: err } = await sb
              .from("tasks")
              .select("*")
              .eq("owner_id", ownerId)
              .is("room_code", null)
              .order("created_at", { ascending: true });
            if (disposed) return;
            // A read started before a successful write must not roll it back.
            // Re-read once, also coalescing events received during this request.
            if (revision !== writeRevision.current) {
              queued = true;
              continue;
            }
            if (err || !data) {
              setError("Couldn't load your tasks.");
              continue;
            }
            setTasks(data.map(taskFromRow));
            setError((current) => current === "Couldn't load your tasks." ? null : current);
          } catch {
            if (!disposed) setError("Couldn't load your tasks.");
          }
          if (document.visibilityState !== "visible") queued = false;
        }
      } finally {
        inFlight = false;
      }
    };
    const invalidate = () => {
      writeRevision.current += 1;
      void refresh();
    };
    const channel = sb
      .channel(`tasks-personal-${ownerId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "tasks",
        filter: `owner_id=eq.${ownerId}`,
      }, invalidate)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refresh();
      });
    // Filtered DELETE events may contain only the primary key. Reconcile with
    // an owner-scoped read while Home is visible, and catch up after tab return.
    const interval = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    // The initial read updates React state only after its network await.
    void refresh();
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      void sb.removeChannel(channel);
    };
  }, [sb, ownerId]);

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
    writeRevision.current += 1;
    setTasks((rows) => rows.some((row) => row.id === data.id) ? rows : [...rows, taskFromRow(data)]);
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
    writeRevision.current += 1;
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
      writeRevision.current += 1;
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
    writeRevision.current += 1;
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
    writeRevision.current += 1;
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
