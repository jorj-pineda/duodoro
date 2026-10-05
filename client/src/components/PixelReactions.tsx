"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import PixelSprite from "./PixelSprite";
import { useArtPx } from "./SceneScale";
import { HEART, HEART_PALETTE, SPARKLE_PALETTE } from "@/lib/uiSprites";
import { WAVE_PALETTE } from "@/lib/palette";
import type { ReactionType } from "@/lib/sessionTypes";

export const WAVE = [".H.H.H..", ".H.H.HH.", ".H.H.HH.", ".HHHHHH.", "HHHHHHH.", ".HHHHHh.", "..HHHh..", "..hhh..."] as const;
export const CHEER = ["..S.......S..", ".SSS.....SSS.", "..S...S...S..", ".....SsS.....", "....SsssS....", ".....SsS.....", "......S......"] as const;
export const REACTION_ART = {
  heart: { map: HEART, palette: HEART_PALETTE },
  cheer: { map: CHEER, palette: SPARKLE_PALETTE },
  wave: { map: WAVE, palette: WAVE_PALETTE },
};
const labels = { heart: "Heart", cheer: "Cheer", wave: "Wave" };

export function PixelReaction({ reaction, name, side = "left" }: { reaction: ReactionType; name: string; side?: "left" | "right" }) {
  const artPx = useArtPx();
  const art = REACTION_ART[reaction];
  return (
    <div role="img" aria-label={`${name} sent a ${reaction} reaction`}
      className={`absolute bottom-full ${side === "right" ? "right-0" : "left-0"} mb-2 pointer-events-none`}
      style={{ "--reaction-px": `${artPx}px` } as CSSProperties}>
      <div className={`pixel-reaction pixel-reaction-${reaction} bg-surface/95 border border-line p-1`}>
        <PixelSprite map={art.map} palette={art.palette} scale={artPx} />
      </div>
    </div>
  );
}

export function ReactionControls({ connected, onSend }: {
  connected: boolean; onSend: (reaction: ReactionType) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); }; }, []);
  async function send(reaction: ReactionType) {
    if (busyRef.current || !connected) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const error = await onSend(reaction);
      if (!mounted.current) return;
      setMessage(error ?? `${labels[reaction]} sent`);
      if (error) { busyRef.current = false; setBusy(false); return; }
      timer.current = setTimeout(() => { busyRef.current = false; setBusy(false); setMessage(null); }, 3000);
    } catch {
      if (!mounted.current) return;
      setMessage("Couldn't send your reaction. Try again.");
      busyRef.current = false;
      setBusy(false);
    }
  }
  return <div role="group" aria-label="Pixel reactions" className="text-center">
    <div className="flex justify-center gap-2">
      {(Object.keys(REACTION_ART) as ReactionType[]).map((reaction) => <button key={reaction} aria-label={`Send ${reaction}`} title={labels[reaction]}
        disabled={!connected || busy} onClick={() => void send(reaction)}
        className="min-w-11 min-h-11 border-2 border-line bg-raise px-2 flex items-center justify-center disabled:opacity-50 hover:border-accent focus-visible:outline-accent">
        <span aria-hidden="true"><PixelSprite {...REACTION_ART[reaction]} scale={2} /></span>
      </button>)}
    </div>
    <p role="status" className="min-h-4 mt-1 text-[11px] text-muted">{message ?? (connected ? "Send a little encouragement" : "Reconnect to send reactions")}</p>
  </div>;
}
