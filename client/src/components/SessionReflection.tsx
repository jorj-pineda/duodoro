"use client";
import { useId, useRef, useState } from "react";
import { deleteSessionReflection, loadSessionReflections, saveSessionReflection, useSessionReflection } from "@/hooks/useSessionReflections";
import { REFLECTION_MAX_CODE_POINTS, validateReflectionText } from "@/lib/sessionReflections";

const button = "min-h-11 px-2 text-xs font-semibold text-accent disabled:opacity-50";
const danger = "min-h-11 px-2 text-xs font-semibold text-danger disabled:opacity-50";

type Mode = "view" | "edit" | "confirm-delete";
type Notice = { tone: "status" | "alert"; text: string; reload?: "edit" | "view" } | null;

// The editor shows the latest saved text while it is clean. The first keystroke
// freezes the baseline version it was opened from. Later saved changes from
// another tab or device then stay out of the draft, and a save from the stale
// baseline is rejected by the server.
export default function SessionReflection({ userId, sessionId }: { userId: string; sessionId: string }) {
  const entry = useSessionReflection(userId, sessionId);
  const saved = entry?.reflection ?? null;
  const status = entry?.status ?? "loading";
  const busy = entry?.pending != null;
  const [mode, setMode] = useState<Mode>("view");
  const [following, setFollowing] = useState(true);
  const [draftValue, setDraftValue] = useState("");
  const [baseline, setBaseline] = useState<{ text: string; version: number | null }>({ text: "", version: null });
  const [attempted, setAttempted] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const ids = {
    heading: useId(), textarea: useId(), help: useId(), count: useId(), problem: useId(),
  };

  const latest = { text: saved?.text ?? "", version: saved?.version ?? null };
  const draft = following ? latest.text : draftValue;
  const base = following ? latest : baseline;
  const validation = validateReflectionText(draft);
  const dirty = mode === "edit" && !following && draft !== base.text;
  const changedElsewhere = mode === "edit" && !following && (saved?.version ?? null) !== base.version;
  const showProblem = !validation.ok && (validation.reason !== "blank" || attempted || draft !== "");
  const describedBy = [ids.help, ids.count, showProblem ? ids.problem : null].filter(Boolean).join(" ");

  const focusTrigger = () => requestAnimationFrame(() => triggerRef.current?.focus());
  const focusDelete = () => requestAnimationFrame(() => deleteTriggerRef.current?.focus());

  function openEditor() {
    setFollowing(true); setDraftValue(""); setAttempted(false); setDiscarding(false); setNotice(null); setMode("edit");
  }
  function closeEditor() {
    setMode("view"); setDiscarding(false); setAttempted(false); setFollowing(true); focusTrigger();
  }
  function requestClose() {
    if (dirty) { setDiscarding(true); return; }
    closeEditor();
  }
  function onDraftChange(value: string) {
    if (following) { setBaseline(latest); setFollowing(false); }
    setDraftValue(value);
    setNotice(null);
  }

  async function save() {
    setAttempted(true);
    if (inFlight.current || busy || !validation.ok) return;
    inFlight.current = true;
    try {
      const result = await saveSessionReflection(userId, sessionId, validation.text, base.version);
      if (result.ok) {
        setMode("view"); setFollowing(true); setDiscarding(false); setAttempted(false);
        setNotice({ tone: "status", text: "Reflection saved" });
        focusTrigger();
      } else if (result.failure.kind === "changed" || result.failure.kind === "exists") {
        // Refresh the saved copy as a read so the banner can offer an explicit reload.
        // The draft is untouched and nothing is written.
        setNotice({ tone: "alert", text: "Your draft is still here. Nothing was overwritten." });
        void loadSessionReflections(userId, [sessionId]);
      } else {
        setNotice({ tone: "alert", text: result.failure.message });
      }
    } finally {
      inFlight.current = false;
    }
  }

  async function confirmDelete() {
    if (inFlight.current || busy || saved === null) return;
    inFlight.current = true;
    try {
      const result = await deleteSessionReflection(userId, sessionId, saved.version);
      if (result.ok) {
        setMode("view"); setNotice({ tone: "status", text: "Reflection deleted" }); focusTrigger();
      } else if (result.failure.kind === "changed") {
        setMode("view");
        setNotice({ tone: "alert", text: "This reflection changed in another tab or device. Reload it before deleting.", reload: "view" });
      } else {
        setNotice({ tone: "alert", text: "Reflection couldn't be deleted. It is still saved. Try again." });
      }
    } finally {
      inFlight.current = false;
    }
  }

  // Explicit reload replaces the draft with the saved text. The user chooses it.
  async function reloadSaved(nextMode: "edit" | "view") {
    await loadSessionReflections(userId, [sessionId]);
    setFollowing(true); setDraftValue(""); setDiscarding(false); setAttempted(false); setNotice(null);
    setMode(nextMode);
    if (nextMode === "view") focusTrigger();
  }

  const label = <h4 id={ids.heading} className="text-xs font-semibold text-ink">Private reflection</h4>;

  if (status === "error" && !entry?.reflection) {
    return <section aria-labelledby={ids.heading} className="space-y-1 border-t border-line pt-2">
      {label}
      <p role="alert" className="text-xs text-danger">Couldn&apos;t load your reflection. Other rounds are unaffected.</p>
      <button className={button} onClick={() => void loadSessionReflections(userId, [sessionId])}>Retry reflection</button>
    </section>;
  }
  if (!entry || status === "loading") {
    return <section aria-labelledby={ids.heading} className="space-y-1 border-t border-line pt-2">
      {label}
      <p role="status" className="text-xs text-muted">Loading reflection…</p>
    </section>;
  }

  if (mode === "edit") {
    return <section aria-labelledby={ids.heading} className="space-y-2 border-t border-line pt-2">
      {label}
      <label htmlFor={ids.textarea} className="block text-xs font-semibold text-ink">How did this session go?</label>
      <textarea id={ids.textarea} rows={4} value={draft} disabled={busy}
        aria-describedby={describedBy} aria-invalid={!validation.ok && showProblem ? true : undefined}
        onChange={event => onDraftChange(event.target.value)}
        className="block w-full min-h-24 border border-line bg-bg px-2 py-1 text-sm text-ink [overflow-wrap:anywhere] whitespace-pre-wrap" />
      <p id={ids.help} className="text-[11px] text-muted">Only you can see this.</p>
      <p id={ids.count} className={`text-[11px] text-right ${validation.length > REFLECTION_MAX_CODE_POINTS ? "text-danger" : "text-muted"}`}>
        {validation.length}/{REFLECTION_MAX_CODE_POINTS} characters
      </p>
      {showProblem && !validation.ok && <p id={ids.problem} role="alert" className="text-xs text-danger">{validation.message}</p>}
      {changedElsewhere && <div role="alert" className="space-y-1">
        <p className="text-xs text-danger">This reflection changed in another tab or device. Your draft is still here; nothing was overwritten.</p>
        <button className={button} disabled={busy} onClick={() => void reloadSaved("edit")}>Reload saved reflection (replaces your draft)</button>
      </div>}
      {busy && <p role="status" className="text-xs text-muted">Saving reflection…</p>}
      {discarding ? <div role="group" aria-label="Discard draft?" className="space-y-1">
        <p className="text-xs text-ink">Discard this draft? Unsaved text will be lost.</p>
        <div className="flex flex-wrap gap-1">
          <button className={danger} onClick={closeEditor}>Discard draft</button>
          <button className={button} onClick={() => setDiscarding(false)}>Keep editing</button>
        </div>
      </div> : <div className="flex flex-wrap gap-1">
        <button className={button} disabled={busy || !dirty || !validation.ok} onClick={() => void save()}>Save reflection</button>
        <button className={button} disabled={busy} onClick={requestClose}>Cancel</button>
      </div>}
      {notice && <p role={notice.tone} className={`text-xs ${notice.tone === "alert" ? "text-danger" : "text-ink"}`}>{notice.text}</p>}
    </section>;
  }

  if (mode === "confirm-delete" && saved) {
    return <section aria-labelledby={ids.heading} className="space-y-2 border-t border-line pt-2">
      {label}
      <div role="group" aria-label="Delete reflection?" className="space-y-1">
        <p className="text-xs text-ink">Delete this reflection? This can&apos;t be undone.</p>
        <div className="flex flex-wrap gap-1">
          <button className={danger} disabled={busy} onClick={() => void confirmDelete()}>{busy ? "Deleting…" : "Delete reflection"}</button>
          <button className={button} disabled={busy} onClick={() => { setMode("view"); focusDelete(); }}>Keep reflection</button>
        </div>
      </div>
      {notice && <p role={notice.tone} className="text-xs text-danger">{notice.text}</p>}
    </section>;
  }

  return <section aria-labelledby={ids.heading} className="space-y-2 border-t border-line pt-2">
    {label}
    {status === "error" && <p role="alert" className="text-xs text-danger">Couldn&apos;t refresh your reflection. This is your last saved copy.</p>}
    {saved ? <>
      <p className="text-xs text-ink whitespace-pre-wrap [overflow-wrap:anywhere]">{saved.text}</p>
      <p className="text-[11px] text-muted">Only you can see this.</p>
      <div className="flex flex-wrap gap-1">
        <button ref={triggerRef} className={button} disabled={busy} onClick={openEditor}>Edit reflection</button>
        <button ref={deleteTriggerRef} className={danger} disabled={busy} onClick={() => { setNotice(null); setMode("confirm-delete"); }}>Delete reflection</button>
      </div>
    </> : <>
      <p className="text-[11px] text-muted">Only you can see this.</p>
      <button ref={triggerRef} className={button} disabled={busy} onClick={openEditor}>Add reflection</button>
    </>}
    {notice && <div className="space-y-1">
      <p role={notice.tone} className={`text-xs ${notice.tone === "alert" ? "text-danger" : "text-ink"}`}>{notice.text}</p>
      {notice.reload && <button className={button} onClick={() => void reloadSaved(notice.reload!)}>Reload saved reflection</button>}
    </div>}
  </section>;
}
