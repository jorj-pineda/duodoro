"use client";
import { useRef, useState } from "react";
import type { BreakExtensionState } from "@/lib/sessionTypes";

export default function BreakExtension({ state, userId, connected, hasTime, onRequest }: {
  state: BreakExtensionState | null; userId: string; connected: boolean; hasTime: boolean;
  onRequest: (proposalId?: string, accept?: boolean) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  if (!state?.eligibleUserIds.includes(userId)) return null;
  const disabled = !connected || !hasTime || busy;
  const send = async (accept?: boolean) => {
    if (disabled || sending.current) return;
    sending.current = true; setBusy(true); setError(null);
    try { setError(await onRequest(accept === undefined ? undefined : state.proposalId ?? undefined, accept)); }
    catch { setError("Couldn't confirm the request. Return to this tab to refresh."); }
    finally { sending.current = false; setBusy(false); }
  };
  const buttonClass = "min-h-11 rounded-lg border border-line px-3 text-xs font-bold text-accent disabled:opacity-50";
  return <section aria-label="Shared break extension" className="w-full max-w-sm rounded-xl border border-line bg-surface p-3 space-y-2">
    <h3 className="text-sm font-bold text-ink">A little more break?</h3>
    <p className="text-xs text-muted">Add two minutes only if both agree. One request per break. No reply keeps the original timer.</p>
    {state.status === "available" && <button className={buttonClass} disabled={disabled} onClick={() => void send()}>Ask for 2 more minutes</button>}
    {state.status === "pending" && (state.requesterId === userId
      ? <p role="status" className="text-xs text-muted">Waiting for your partner. The break keeps running.</p>
      : <div className="space-y-2"><p className="text-xs text-ink">Your partner would like two more minutes.</p>
        <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={disabled} onClick={() => void send(true)}>Agree · +2 minutes</button>
          <button className={buttonClass} disabled={disabled} onClick={() => void send(false)}>Keep original break</button></div></div>)}
    {state.status === "accepted" && <p role="status" className="text-xs text-go">Both agreed. Two minutes added to this break.</p>}
    {state.status === "declined" && <p role="status" className="text-xs text-muted">Original break kept. You can ask again next break.</p>}
    {!connected && <p className="text-xs text-muted">Both partners must be connected to agree.</p>}
    {busy && <p role="status" className="text-xs text-muted">Confirming with the room…</p>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </section>;
}
