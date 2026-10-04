"use client";
import { useEffect, useRef, useState } from "react";
import type { RoundRecap, SessionIntentions as Intentions } from "@/lib/sessionTypes";

type Action = "done" | "undo" | "carry";
const button = "min-h-11 px-2 text-xs font-semibold text-accent disabled:opacity-50";

export default function SessionIntentions({ intentions, userId, phase, names, onSave, onEditingChange }: {
  intentions: Intentions;
  userId: string;
  phase: string;
  names: Record<string, string>;
  onSave: (text: string) => Promise<string | null>;
  onEditingChange: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const focusing = phase === "focus";
  const saved = intentions.next[userId] ?? "";
  const closeEditor = () => {
    setEditing(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  useEffect(() => {
    onEditingChange(editing || busy);
    return () => onEditingChange(false);
  }, [editing, busy, onEditingChange]);
  async function save(text: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const failure = await onSave(text);
      if (failure) setError(failure);
      else closeEditor();
    } catch { setError("Couldn't save your intention. Try again."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  if (focusing && !editing) return null;
  return (
    <section aria-label="Session intentions" className="w-full max-w-xs border border-line bg-raise px-3 py-2 text-left">
      <h2 className="text-xs font-bold text-ink">{phase === "waiting" ? "What are you focusing on?" : "Next round intention"}</h2>
      <p className="text-[11px] text-muted">Optional · Shared in this room</p>
      {Object.entries(intentions.next).filter(([id]) => names[id] && id !== userId).map(([id, text]) => (
        <p key={id} className="text-xs text-muted mt-2 break-words">{names[id]}: {text}</p>
      ))}
      {editing ? (
        <form className="mt-2" onSubmit={(event) => { event.preventDefault(); if (!focusing) void save(draft); }}>
          <label htmlFor="session-intention" className="sr-only">Your session intention</label>
          <input id="session-intention" autoFocus maxLength={160} value={draft} disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
              if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); if (!busy) closeEditor(); }
            }}
            className="w-full min-h-11 border border-line bg-bg px-2 text-sm text-ink" />
          {focusing && <p className="text-xs text-muted mt-1">Focus has started. Your draft is still here for the break.</p>}
          <div className="flex gap-2">
            <button className={button} disabled={busy || focusing} type="submit">{busy ? "Saving…" : "Save intention"}</button>
            <button className={button} disabled={busy} type="button" onClick={closeEditor}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          {saved && <p className="text-xs text-ink mt-2 break-words">You: {saved}</p>}
          <div className="flex gap-2">
            <button ref={triggerRef} className={button} disabled={busy} onClick={() => { setDraft(saved); setError(null); setEditing(true); }}>{saved ? "Edit intention" : "Add intention"}</button>
            {saved && <button className={button} disabled={busy} onClick={() => void save("")}>Clear intention</button>}
          </div>
        </>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </section>
  );
}

export function IntentionRecap({ recap, userId, next, onResolve }: {
  recap: RoundRecap;
  userId: string;
  next: string;
  onResolve: (round: number, action: Action) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const entries = Object.entries(recap.intentions ?? {});
  if (!entries.length) return null;
  async function resolve(action: Action) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try { setError(await onResolve(recap.round, action)); }
    catch { setError("Couldn't update your intention. Try again."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return (
    <section aria-label="Round intentions" className="border-t border-line mt-2 pt-2 text-left">
      {entries.map(([id, intention]) => (
        <div key={id} className="text-xs text-ink mb-1">
          <p className="break-words"><strong>{id === userId ? "You" : intention.displayName}:</strong> {intention.text}</p>
          <p className="text-muted">{intention.completed ? "Done" : "Not marked done"}</p>
          {id === userId && <div className="flex flex-wrap gap-1">
            <button className={button} disabled={busy} onClick={() => void resolve(intention.completed ? "undo" : "done")}>{intention.completed ? "Undo intention completion" : "Mark intention done"}</button>
            <button className={button} disabled={busy || Boolean(next)} onClick={() => void resolve("carry")}>{next === intention.text ? "Carried into next round" : next ? "Next round already planned" : "Carry into next round"}</button>
          </div>}
        </div>
      ))}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </section>
  );
}
