"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { getSupabase } from "@/lib/supabase";
import { taskFromRow, type Task } from "@/lib/types";

type Tab = "mine" | "shared";

export function useStickyNotes(
  open: boolean,
  userId: string,
  roomCode: string | null,
) {
  const [tab, setTab] = useState<Tab>("mine");
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [sharedTasks, setSharedTasks] = useState<Task[]>([]);
  // Writes can legitimately be refused now that migration 016 scopes shared
  // notes to the session you're in; these used to update local state blindly.
  const [error, setError] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [colorIdx, setColorIdx] = useState(0);
  const optionsRef = useRef<HTMLDivElement>(null);
  const sb = getSupabase();

  // A failed read used to fall through to `if (data)` and leave the list empty,
  // making a broken query indistinguishable from an empty board. That is how
  // the 42P17 policy recursion fixed in migration 018 stayed invisible for so
  // long: every read was erroring and the panel just said "No tasks yet".
  const fetchMine = useCallback(async () => {
    const { data, error: err } = await sb
      .from("tasks")
      .select("*")
      .eq("owner_id", userId)
      .is("room_code", null)
      .order("created_at", { ascending: true });
    if (err) {
      setError("Couldn't load your notes.");
      return;
    }
    if (data) setMyTasks(data.map(taskFromRow));
  }, [sb, userId]);

  const fetchShared = useCallback(async () => {
    if (!roomCode) return;
    const { data, error: err } = await sb
      .from("tasks")
      .select("*")
      .eq("room_code", roomCode)
      .eq("is_shared", true)
      .order("created_at", { ascending: true });
    if (err) {
      setError("Couldn't load your shared goals.");
      return;
    }
    if (data) setSharedTasks(data.map(taskFromRow));
  }, [sb, roomCode]);

  useEffect(() => {
    // The rule can't see through the async boundary: these fetchers await a
    // network round trip before any setState, so nothing here is a synchronous
    // cascading render. Suppressed rather than restructured — the alternative
    // is a data-fetching library, which is a bigger change than this earns.
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchMine();
      fetchShared();
    }
  }, [open, fetchMine, fetchShared]);

  useEffect(() => {
    if (!roomCode) return;
    const channel = sb
      .channel(`tasks-shared-${roomCode}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `room_code=eq.${roomCode}`,
        },
        fetchShared,
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [sb, roomCode, fetchShared]);

  useEffect(() => {
    if (!open || tab !== "shared" || !roomCode) return;
    // Filtered Postgres Changes can miss DELETEs when the old row only carries
    // its primary key. Reconcile the visible board through its scoped RLS read,
    // rather than subscribe to every user's task deletions. Also catch up after
    // a background tab returns. Never poll closed, hidden or personal boards.
    let inFlight = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try { await fetchShared(); } finally { inFlight = false; }
    };
    const interval = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [open, tab, roomCode, fetchShared]);

  useEffect(() => {
    if (!showOptions) return;
    const handler = (e: MouseEvent) => {
      if (
        optionsRef.current &&
        !optionsRef.current.contains(e.target as Node)
      ) {
        setShowOptions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showOptions]);

  const addTask = async (content: string, shared = false) => {
    const row = {
      owner_id: userId,
      content,
      is_shared: shared,
      room_code: shared ? roomCode : null,
    };
    const { data, error: err } = await sb
      .from("tasks")
      .insert(row)
      .select()
      .single();
    if (err || !data) {
      // Shared writes are scoped to the session you're actually in (016), so
      // this can fail for a real reason rather than a transient one.
      setError(
        shared
          ? "Couldn't add that shared goal. Are you still in the session?"
          : "Couldn't save that note.",
      );
      return;
    }
    const task = taskFromRow(data);
    if (shared) setSharedTasks((p) => [...p, task]);
    else setMyTasks((p) => [...p, task]);
  };

  const toggleTask = async (id: string, done: boolean) => {
    setError(null);
    const shared = sharedTasks.some((t) => t.id === id);

    // Shared goals go through the RPC (migration 017), because a *shared* goal
    // has to be completable by either partner and tasks_update is owner-only.
    // A direct UPDATE here matched zero rows whenever the note wasn't yours.
    if (shared) {
      const { data, error: err } = await sb.rpc("toggle_shared_task", {
        p_task_id: id,
        p_done: done,
      });
      // The function is declared RETURNS tasks, so PostgREST sends the row as a
      // bare object; unwrap an array too rather than depend on that.
      const returned = Array.isArray(data) ? data[0] : data;
      if (err || !returned) {
        setError(
          "Couldn't update that shared goal. Are you both still in the session?",
        );
        return;
      }
      const row = taskFromRow(returned);
      // Trust the returned row rather than patching optimistically — the RPC
      // owns completed_by, so it's the only thing that knows who gets credit.
      setSharedTasks((p) => p.map((t) => (t.id === id ? row : t)));
      return;
    }

    // RLS refusing this is not an error — it matches zero rows.
    const { data, error: err } = await sb
      .from("tasks")
      .update({ is_done: done })
      .eq("id", id)
      .select("id");
    if (err || !data || data.length === 0) {
      setError("Couldn't update that note.");
      return;
    }
    setMyTasks((p) =>
      p.map((t) => (t.id === id ? { ...t, is_done: done } : t)),
    );
  };

  const deleteTask = async (id: string) => {
    setError(null);
    const { data, error: err } = await sb
      .from("tasks")
      .delete()
      .eq("id", id)
      .select("id");
    if (err || !data || data.length === 0) {
      setError("Couldn't delete that note.");
      return;
    }
    setMyTasks((p) => p.filter((t) => t.id !== id));
    setSharedTasks((p) => p.filter((t) => t.id !== id));
  };

  const clearCompleted = async () => {
    const list = tab === "mine" ? myTasks : sharedTasks;
    const ids = list.filter((t) => t.is_done).map((t) => t.id);
    if (ids.length > 0) {
      setError(null);
      // RLS can report success while deleting only the caller-owned subset.
      // Return the affected ids and keep every refused partner row locally.
      const { data, error: err } = await sb
        .from("tasks")
        .delete()
        .in("id", ids)
        .select("id");
      if (err || !data) {
        setError("Couldn't clear those notes.");
        return;
      }
      const deletedIds = new Set(data.map((row) => row.id));
      const drop = (list: Task[]) =>
        list.filter((task) => !deletedIds.has(task.id));
      setMyTasks(drop);
      setSharedTasks(drop);
      if (deletedIds.size !== ids.length) {
        setError("Couldn't clear all completed notes.");
      }
    }
    setShowOptions(false);
  };

  const activeTasks = tab === "mine" ? myTasks : sharedTasks;
  const completedCount = activeTasks.filter((t) => t.is_done).length;

  return {
    tab,
    setTab,
    showOptions,
    setShowOptions,
    colorIdx,
    setColorIdx,
    optionsRef,
    activeTasks,
    completedCount,
    addTask,
    toggleTask,
    deleteTask,
    clearCompleted,
    error,
    clearError: () => setError(null),
  };
}
