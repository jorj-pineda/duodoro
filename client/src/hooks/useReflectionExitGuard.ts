"use client";
import { useCallback, useEffect, useState } from "react";

export type ReflectionDraftState = { dirty: boolean; busy: boolean };

// Only flags cross the Calendar boundary. Private draft text stays in its editor.
export function useReflectionExitGuard(open: boolean, userId: string) {
  const [state, setState] = useState({ open, userId, dirty: false, busy: false, blocked: false });
  // Reset a view/account scope before its children commit, including reopen.
  if (state.open !== open || state.userId !== userId) {
    setState({ open, userId, dirty: false, busy: false, blocked: false });
  }
  const onDraftStateChange = useCallback((next: ReflectionDraftState) => {
    if (!open) return;
    setState(previous => {
      if (previous.open !== open || previous.userId !== userId) return previous;
      const blocked = next.busy && previous.blocked;
      if (previous.dirty === next.dirty && previous.busy === next.busy && previous.blocked === blocked) return previous;
      return { ...previous, ...next, blocked };
    });
  }, [open, userId]);
  const protectedView = open && state.open === open && state.userId === userId && (state.dirty || state.busy);
  useEffect(() => {
    if (!protectedView) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [protectedView]);

  function leave(action: () => void): boolean {
    if (protectedView && state.busy) {
      setState(previous => previous.busy ? { ...previous, blocked: true } : previous);
      return false;
    }
    if (protectedView && !window.confirm("Discard your unsaved reflection drafts and leave this view? Choose Cancel to keep editing.")) return false;
    setState({ open, userId, dirty: false, busy: false, blocked: false });
    action();
    return true;
  }
  return {
    onDraftStateChange,
    leave,
    message: state.blocked && protectedView && state.busy ? "Wait for your reflection to finish saving or reloading before leaving this view." : null,
  };
}
