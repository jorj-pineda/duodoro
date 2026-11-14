"use client";
import { useState } from "react";
export type PrepareReflectionIntention = (text: string) => boolean;

export default function ReflectionIntention({ text,onPrepare }: { text: string; onPrepare?: PrepareReflectionIntention }) {
  const [notice,setNotice] = useState("");
  if (!onPrepare) return null;
  return <div className="space-y-1">
    <button type="button" className="min-h-11 px-2 text-xs font-semibold text-accent" onClick={() => setNotice(onPrepare(text)
      ? "Private draft prepared. Close Stats and open Focus or return to your room to edit it. Only Save intention shares it. This draft stays in memory until saved, cancelled or signed out; refreshing loses it."
      : "Review or cancel your existing intention draft first. Nothing was replaced.")}>Use for my next focus</button>
    {notice && <p role="status" className="text-xs text-muted">{notice}</p>}
  </div>;
}
