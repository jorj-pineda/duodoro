"use client";
import { useAccountPreferenceSync } from "@/hooks/useAccountPreferenceSync";
import { PREFERENCE_LABELS } from "@/lib/accountPreferences";
import type { Json } from "@/lib/database.types";
const control = "min-h-11 rounded border border-line bg-raise px-3 text-xs text-ink disabled:opacity-50";
function label(value: Json) { return value === null ? "Default / none" : Array.isArray(value) ? JSON.stringify(value) : String(value); }
export default function PreferenceSyncStatus({ userId }: { userId: string }) {
  const sync = useAccountPreferenceSync(userId);
  const status = sync.error ? "Preferences available here; account sync needs a retry."
    : sync.conflicts.length ? "A preference changed on another device. Choose which value to keep."
    : sync.saving || sync.pending.length ? "Using device preferences; syncing to your account…"
    : sync.loaded ? "Preferences are up to date across devices." : "Checking your account preferences…";
  return <details aria-label="Preferences across devices" className="text-xs text-muted max-w-full">
    <summary className="min-h-11 flex items-center cursor-pointer text-left"><span role="status">{status}</span></summary>
    <div className="space-y-3 border border-line rounded-lg p-3 bg-surface">
      <p>Companion choice and names, favorite presets, daily target, and quiet focus sync privately to your account. Changes work here immediately. Refreshing or going online checks for updates.</p>
      <p>Saved preferences belong to your account. Your companion and its name still appear in shared rooms. Syncing favorites never applies them to a running timer.</p>
      {sync.error && <p role="alert">Account sync is unavailable or unconfirmed. Your device values remain usable. Retry checks what was saved before sending anything again.</p>}
      <button className={control} disabled={sync.loading || sync.saving} onClick={()=>void sync.reload()}>Retry preference sync</button>
      {sync.conflicts.map(conflict=><section key={conflict.key} aria-label={`${PREFERENCE_LABELS[conflict.key]} conflict`} className="space-y-2">
        <h3 className="font-bold text-ink">{PREFERENCE_LABELS[conflict.key]}</h3>
        <p className="break-words whitespace-pre-wrap">This device: {label(conflict.device)}</p>
        <p className="break-words whitespace-pre-wrap">Account: {label(conflict.account)}</p>
        <div className="flex flex-wrap gap-2">
          <button className={control} disabled={sync.error || sync.loading || sync.saving} onClick={()=>sync.resolve(conflict.key,"account")}>Use account value</button>
          <button className={control} disabled={sync.error || sync.loading || sync.saving} onClick={()=>sync.resolve(conflict.key,"device")}>Keep this device&apos;s value</button>
        </div>
      </section>)}
    </div>
  </details>;
}
