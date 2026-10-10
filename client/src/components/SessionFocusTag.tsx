"use client";
import { useId, useRef, useState } from "react";
import { FOCUS_TAGS, focusTagLabel, isFocusTagId, type FocusTagId } from "@/lib/focusTags";
import { saveSessionFocusTag, type SavedFocusTag } from "@/hooks/useSessionFocusTags";

const button = "min-h-11 px-2 text-xs font-semibold text-accent aria-disabled:opacity-50";
const NO_TAG = "";

type Override = { tag: FocusTagId | null; baseVersion: number | null };
type Notice = { tone: "status" | "alert"; text: string; reload?: boolean } | null;

// Only you can see this. Choosing an option never saves by itself: the user
// presses Save. The first change freezes the saved revision the draft was made
// against, so later background refreshes cannot change what Save submits.
// Pending controls use aria-disabled rather than disabled so focus is kept.
export default function SessionFocusTag({ userId, sessionId, saved, available, onSaved, reload }: {
  userId: string;
  sessionId: string;
  saved: SavedFocusTag | null;
  available: boolean;
  onSaved: (sessionId: string) => void;
  reload: () => Promise<boolean>;
}) {
  // A confirmed save is shown immediately. A newer parent read still wins by revision.
  const [confirmed, setConfirmed] = useState<SavedFocusTag | null>(null);
  const current = confirmed && (!saved || confirmed.version > saved.version) ? confirmed : saved;
  const savedTag = current?.tag ?? null;
  const savedVersion = current?.version ?? null;
  const [override, setOverride] = useState<Override | null>(null);
  const [pending, setPending] = useState<null | "save" | "reload">(null);
  const [notice, setNotice] = useState<Notice>(null);
  const inFlight = useRef(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const ids = { select: useId(), help: useId(), status: useId() };

  const dirty = override !== null && override.tag !== savedTag;
  const selected = override ? override.tag : savedTag;
  const changedElsewhere = dirty && override?.baseVersion !== savedVersion;
  const busy = pending !== null;

  function onChange(value: string) {
    if (busy) return;
    if (value !== NO_TAG && !isFocusTagId(value)) return;
    const tag = value === NO_TAG ? null : value;
    setNotice(null);
    if (tag === savedTag) { setOverride(null); return; }
    setOverride(previous => ({ tag, baseVersion: previous ? previous.baseVersion : savedVersion }));
  }

  async function save() {
    if (inFlight.current || busy || !dirty || !override) return;
    inFlight.current = true;
    setPending("save");
    setNotice(null);
    try {
      const result = await saveSessionFocusTag(userId, sessionId, override.tag, override.baseVersion);
      if (result.ok) {
        setConfirmed(result.saved);
        setOverride(null);
        setNotice({ tone: "status", text: result.saved.tag ? "Tag saved" : "Tag removed" });
        // Save removes the button that had focus; keep focus on the select.
        selectRef.current?.focus();
        onSaved(sessionId);
      } else if (result.failure.kind === "changed") {
        // Keep the selection. Refresh the saved copy in the background without
        // replacing the draft; the user chooses whether to reload.
        setNotice({ tone: "alert", text: "This tag changed in another tab or device. Your selection is still here; nothing was overwritten.", reload: true });
        void reload();
      } else {
        setNotice({ tone: "alert", text: result.failure.message, reload: result.failure.kind === "unconfirmed" });
      }
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  // The explicit reload is the only action that discards the local selection,
  // and only after the saved copy has been read successfully.
  async function reloadSaved() {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setPending("reload");
    try {
      const ok = await reload();
      if (ok) {
        setOverride(null);
        setNotice({ tone: "status", text: "Saved tag reloaded." });
      } else {
        setNotice({ tone: "alert", text: "Couldn't reload the saved tag. Your selection is still here. Try again.", reload: true });
      }
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  // The calendar explains unavailability once; no editor is offered without it.
  if (!available) return null;

  const pendingText = pending === "save" ? "Saving tag…" : pending === "reload" ? "Reloading saved tag…" : null;
  const describedBy = [ids.help, pendingText || notice ? ids.status : null].filter(Boolean).join(" ");

  return <section className="space-y-2 border-t border-line pt-2">
    <label htmlFor={ids.select} className="block text-xs font-semibold text-ink">Private tag</label>
    <div className="flex flex-wrap items-center gap-2">
      <select id={ids.select} ref={selectRef} value={selected ?? NO_TAG} aria-describedby={describedBy} aria-busy={busy || undefined}
        onChange={event => onChange(event.target.value)}
        className="min-h-11 border border-line bg-bg px-2 text-sm text-ink">
        <option value={NO_TAG}>No tag</option>
        {FOCUS_TAGS.map(tag => <option key={tag.id} value={tag.id}>{focusTagLabel(tag.id)}</option>)}
      </select>
      {dirty && <>
        <button type="button" className={button} aria-disabled={busy || undefined} onClick={() => void save()}>Save tag</button>
        <button type="button" className={button} aria-disabled={busy || undefined} onClick={() => { if (!busy) { setOverride(null); setNotice(null); selectRef.current?.focus(); } }}>Cancel</button>
      </>}
    </div>
    <p id={ids.help} className="text-[11px] text-muted">Only you can see this.</p>
    {changedElsewhere && !notice && <p role="alert" className="text-xs text-danger">This tag changed in another tab or device. Your selection is still here.</p>}
    {pendingText && <p id={ids.status} role="status" className="text-xs text-muted">{pendingText}</p>}
    {!pendingText && notice && <div className="space-y-1">
      <p id={ids.status} role={notice.tone} className={`text-xs ${notice.tone === "alert" ? "text-danger" : "text-ink"}`}>{notice.text}</p>
      {notice.reload && <button type="button" className={button} aria-disabled={busy || undefined} onClick={() => void reloadSaved()}>
        {changedElsewhere ? "Reload saved tag (replaces your selection)" : "Reload saved tag"}
      </button>}
    </div>}
  </section>;
}
