"use client";
import { useState } from "react";
import { useBreakActivities } from "@/hooks/useBreakActivities";

const IDEAS = [
  { name: "Water", text: "Have a sip of water if you’d like." },
  { name: "Gentle stretch", text: "Choose a comfortable stretch, or simply relax your hands." },
  { name: "Look away", text: "Let your gaze wander somewhere away from the screen." },
  { name: "Quiet rest", text: "Take a moment to sit quietly. You don’t need to do anything." },
];

export default function BreakActivities({ userId, breakId }: { userId: string; breakId: string }) {
  const { enabled, dismissed, enable, disable, dismiss } = useBreakActivities(userId, breakId);
  const [idea, setIdea] = useState(0);
  const [message, setMessage] = useState("");
  const visible = enabled && !dismissed;
  return <section aria-label="Break ideas" className="w-full max-w-xs border border-line bg-raise p-3 space-y-2 text-ink">
    <h2 className="text-xs font-bold">Optional break ideas</h2>
    {visible ? <>
      <h3 className="text-sm font-semibold">{IDEAS[idea].name}</h3>
      <p className="text-xs text-muted">{IDEAS[idea].text}</p>
      <p className="text-[11px] text-muted">Choose an idea or keep resting. Nothing to complete.</p>
      <div className="grid grid-cols-2 gap-2">
        <button className="min-h-11 border border-line px-2 text-xs" onClick={() => setIdea(previous => (previous + 1) % IDEAS.length)}>Another idea</button>
        <button className="min-h-11 border border-line px-2 text-xs" onClick={() => { dismiss(); setMessage(""); }}>Hide for this break</button>
      </div>
      <button className="min-h-11 text-xs text-muted underline" onClick={() => { disable(); setMessage(""); }}>Turn off break ideas</button>
    </> : <>
      <p className="text-xs text-muted">{dismissed && enabled ? "Ideas are hidden for this break." : "Water, a stretch, looking away, or quiet rest—if you feel like it."}</p>
      <button className="min-h-11 text-xs underline" onClick={() => {
        const persisted = enable();
        setMessage(persisted ? "" : "Enabled for this tab; browser storage is unavailable.");
      }}>Show break ideas</button>
    </>}
    {message && <p role="status" className="text-xs text-muted">{message}</p>}
  </section>;
}
