"use client";
import { useRef, useState } from 'react';
import { saveIntentionGoal } from '@/lib/intentionGoal';

export default function IntentionGoal({ userId, roomId, round, text }: {
  userId: string; roomId: string; round: number; text: string;
}) {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (locked.current || saved) return;
    locked.current = true;
    setBusy(true); setError(null);
    try {
      const failure = await saveIntentionGoal(userId, roomId, round, text);
      if (failure) setError(failure); else setSaved(true);
    } catch { setError("Couldn't confirm your personal goal. Retry safely to check or save it."); }
    finally { locked.current = false; setBusy(false); }
  }
  return <section aria-label="Carry-forward personal goal" className="mt-1">
    <button type="button" disabled={busy || saved} onClick={() => void save()}
      className="min-h-11 rounded border border-line bg-surface px-2 text-xs font-semibold text-accent disabled:opacity-50">
      {saved ? 'Saved as personal goal' : busy ? 'Saving personal goal…' : 'Save as personal goal'}
    </button>
    <p className="text-[11px] text-ink">Private · Kept in your Goals after leaving this room.</p>
    {saved && <p role="status" className="text-xs text-ink">Personal goal saved. Your intention is still unfinished.</p>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </section>;
}
