"use client";
import { useState } from "react";
import { BUILTIN_PRESETS, useSessionPresets, type SessionPreset } from "@/hooks/useSessionPresets";
import type { TimerPrefs } from "@/lib/timerPrefs";

export default function SessionPresets({ userId, current, onApply }: {
  userId: string; current: TimerPrefs; onApply: (prefs: TimerPrefs) => void;
}) {
  const { presets, save, remove } = useSessionPresets(userId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const label = (preset: SessionPreset) => `${preset.name} · ${preset.mode === "flow" ? "open-ended" : `${preset.focus}/${preset.break}m`}`;
  return <section aria-label="Session presets" className="w-full max-w-xs space-y-2 text-ink">
    <h2 className="text-xs font-bold">Session presets</h2>
    <div className="grid grid-cols-2 gap-2">
      {BUILTIN_PRESETS.map(preset => <button key={preset.name} onClick={() => onApply(preset)}
        className="min-h-11 border border-line bg-raise px-2 text-xs hover:border-accent">{label(preset)}</button>)}
    </div>
    {presets.map(preset => <div key={preset.name} className="flex gap-2">
      <button onClick={() => onApply(preset)} className="min-h-11 flex-1 min-w-0 break-words border border-line px-2 text-xs hover:border-accent">{label(preset)}</button>
      <button aria-label={`Remove ${preset.name} preset`} onClick={() => { const persisted = remove(preset.name); setMessage(persisted ? "Favorite removed." : "Removed for this tab; browser storage is unavailable."); }}
        className="min-h-11 min-w-11 text-xs text-muted underline">Remove</button>
    </div>)}
    <p className="text-[11px] text-muted">Favorites belong to this account in this browser. Applying one changes setup; it doesn&apos;t start the timer.</p>
    {!editing ? <button className="min-h-11 text-xs underline" onClick={() => setEditing(true)}>Save current settings</button>
      : <form className="space-y-2" onSubmit={event => {
        event.preventDefault();
        const result = save(name, current);
        setMessage(result.error ?? (result.persisted ? "Favorite saved." : "Saved for this tab; browser storage is unavailable."));
        if (!result.error) { setEditing(false); setName(""); }
      }}>
        <label className="block text-xs">Preset name<input value={name} maxLength={24} onChange={event => setName(event.target.value)} autoFocus
          className="block w-full min-h-11 px-2 mt-1 bg-raise border border-line" /></label>
        <p className="text-[11px] text-muted">Saving an existing name replaces its settings.</p>
        <div className="flex gap-3"><button className="min-h-11 text-xs underline" type="submit">Save favorite</button>
          <button className="min-h-11 text-xs underline" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
      </form>}
    {message && <p role="status" className="text-xs text-muted">{message}</p>}
  </section>;
}
