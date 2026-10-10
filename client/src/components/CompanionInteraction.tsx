"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PixelReaction } from "./PixelReactions";
import type { RoomReaction } from "@/lib/sessionTypes";
export default function CompanionInteraction({ name, label, reaction, onPet, connected = false, children }: {
  name: string; label: string; reaction?: RoomReaction; onPet?: () => Promise<string | null>; connected?: boolean; children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (timeout.current) clearTimeout(timeout.current); }; }, []);
  async function pet() {
    if (!onPet || !connected || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const failure = await onPet();
      if (!mounted.current) return;
      if (failure) { setError(failure); busyRef.current = false; setBusy(false); }
      else timeout.current = setTimeout(() => { busyRef.current = false; setBusy(false); }, 3000);
    } catch {
      if (mounted.current) { setError("Couldn't pet your companion. Try again."); busyRef.current = false; setBusy(false); }
    }
  }
  return <span className="relative inline-block align-bottom">
    <span role="img" aria-label={label} className="block">{children}</span>
    {reaction && <PixelReaction key={reaction.id} reaction="heart" name={name} />}
    {onPet && <button type="button" aria-label={`Pet ${name}`} title={connected ? `Pet ${name}` : "Reconnect to pet your companion"}
      disabled={!connected || busy} onClick={() => void pet()}
      className="absolute bottom-0 left-0 w-full h-full min-w-11 min-h-11 z-30 focus-visible:outline-2 focus-visible:outline-accent" />}
    {error && <span role="alert" className="absolute bottom-full left-0 min-w-32 bg-surface text-danger text-xs p-1 border border-line">{error}</span>}
  </span>;
}
