"use client";
import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { readFocusDate, type FocusDate } from "@/lib/focusDates";

export default function FocusDateStart({ date, userId, disabled, onOpenRoom }: {
  date: FocusDate; userId: string; disabled: boolean; onOpenRoom: () => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef(false), mounted = useRef(false), generation = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { ++generation.current; }, [userId, date.id, date.version, date.starts_at, date.status, date.proposer_id, date.recipient_id, disabled]);
  async function open() {
    if (disabled || pending.current || date.status !== "accepted") return;
    pending.current = true; setBusy(true); setError("");
    const request = generation.current;
    const current = () => mounted.current && request === generation.current;
    try {
      const result = await getSupabase().from("focus_dates").select("id,proposer_id,recipient_id,starts_at,status,version,created_at").eq("id",date.id).maybeSingle();
      if (!current()) return;
      if (result.error) throw new Error("unavailable");
      const fresh = readFocusDate(result.data,userId);
      if (!fresh || fresh.id !== date.id || fresh.status !== "accepted" || fresh.version !== date.version
        || fresh.starts_at !== date.starts_at || fresh.proposer_id !== date.proposer_id || fresh.recipient_id !== date.recipient_id
        || Date.parse(fresh.starts_at) <= Date.now()) {
        setError("This date changed or is no longer upcoming and accepted. Reload focus dates before opening a room."); return;
      }
      onOpenRoom();
    } catch {
      if (current()) setError("Couldn't check this date. Reconnect and try again.");
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  if (date.status !== "accepted") return null;
  return <div className="space-y-2 border-t border-line pt-3">
    <button type="button" className="min-h-11 rounded-lg border border-line bg-raise px-3 py-2 text-xs text-ink disabled:opacity-50" disabled={disabled || busy} onClick={() => void open()}>{busy ? "Checking date…" : "Open room setup"}</button>
    <p className="text-xs text-muted">In the room, use Copy invite link to invite this friend. The host chooses Start session when both of you are ready.</p>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </div>;
}
