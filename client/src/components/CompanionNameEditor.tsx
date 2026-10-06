"use client";
import { useRef, useState } from "react";
import type { PetType } from "@/lib/types";
import { DEFAULT_COMPANION_NAMES, normalizeCompanionName } from "@/lib/companionNames";
export default function CompanionNameEditor({ pet, name, connected, onSave }: {
  pet: PetType; name: string; connected: boolean; onSave: (name: string) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  async function save(value: string) {
    if (busy.current) return;
    if (normalizeCompanionName(value) === null) { setError("Use a name of 24 characters or fewer."); return; }
    busy.current = true; setSaving(true); setError(null);
    try {
      const failure = await onSave(value);
      if (failure) setError(failure); else setEditing(false);
    } catch { setError("Couldn't save the name. Try again."); }
    finally { busy.current = false; setSaving(false); }
  }
  return <section aria-label="Your companion name" className="w-full max-w-xs text-center text-xs">
    {!editing ? <div className="flex flex-wrap items-center justify-center gap-1">
      <span className="break-words min-w-0">Your companion · <strong>{name}</strong></span>
      <button className="min-h-11 px-2 underline text-muted" disabled={!connected} onClick={() => { setDraft(name); setError(null); setEditing(true); }}>Rename companion</button>
    </div> : <form onSubmit={event => { event.preventDefault(); void save(draft); }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); if (!busy.current) setEditing(false); } }}>
      <label className="block text-left">Companion name
        <input autoFocus value={draft} maxLength={48} disabled={saving} onChange={event => setDraft(event.target.value)} className="w-full min-h-11 border border-line bg-bg px-2 text-sm" />
      </label>
      <p className="mt-1 text-muted">Up to 24 characters. Leave blank for {DEFAULT_COMPANION_NAMES[pet]}.</p>
      <div className="flex flex-wrap justify-center gap-1">
        <button type="submit" disabled={saving || !connected} className="min-h-11 px-3 text-go">{saving ? "Saving…" : "Save name"}</button>
        <button type="button" disabled={saving} onClick={() => setEditing(false)} className="min-h-11 px-3 text-muted">Cancel</button>
        <button type="button" disabled={saving || !connected} onClick={() => void save("")} className="min-h-11 px-3 text-muted">Use default name</button>
      </div>
      {error && <p role="alert" className="text-danger">{error}</p>}
    </form>}
  </section>;
}
