"use client";
import { useEffect, useId, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { readFocusDate, type FocusDate } from "@/lib/focusDates";
import { buildFocusDateCalendar, CALENDAR_LENGTHS, downloadCalendarFile } from "@/lib/focusDateCalendar";
const control = "min-h-11 max-w-full rounded-lg border border-line bg-raise px-3 py-2 text-xs text-ink disabled:opacity-50";

export default function FocusDateCalendar({ date, userId, disabled }: { date: FocusDate; userId: string; disabled: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState<number>(25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(false), pending = useRef(false);
  const generation = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { ++generation.current; }, [userId, date.id, date.version, date.starts_at, date.status, date.proposer_id, date.recipient_id, disabled]);

  async function download() {
    if (disabled || pending.current || date.status !== "accepted") return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    const request = generation.current;
    const current = () => mounted.current && generation.current === request;
    try {
      const result = await getSupabase().from("focus_dates").select("id,proposer_id,recipient_id,starts_at,status,version,created_at").eq("id", date.id).maybeSingle();
      if (!current()) return;
      if (result.error) throw new Error("read failed");
      const fresh = readFocusDate(result.data, userId);
      if (!fresh || fresh.id !== date.id || fresh.version !== date.version || fresh.starts_at !== date.starts_at
        || fresh.proposer_id !== date.proposer_id || fresh.recipient_id !== date.recipient_id) {
        setError("This date changed or is unavailable. Reload focus dates before exporting."); return;
      }
      const file = buildFocusDateCalendar(fresh, userId, minutes, Date.now());
      if (!file) { setError("This date is no longer accepted and upcoming. Reload focus dates before exporting."); return; }
      downloadCalendarFile(file);
      setNotice("Calendar file ready. Open the download in your calendar to import it.");
    } catch {
      if (current()) setError("Couldn't prepare the calendar file. Try again when you're connected.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (date.status !== "accepted") return null;
  return <div className="space-y-2">
    <button className={control} disabled={disabled || busy} aria-expanded={open} aria-controls={id}
      onClick={() => { setOpen(value => !value); setError(""); setNotice(""); }}>Add to calendar</button>
    {open && <div id={id} role="group" aria-label="Calendar export" className="space-y-2 border-t border-line pt-3">
      <label className="text-xs text-muted block">Calendar block length
        <select value={minutes} disabled={disabled || busy} onChange={event => { setMinutes(Number(event.target.value)); setNotice(""); }} className={`${control} block mt-1`}>
          {CALENDAR_LENGTHS.map(value => <option key={value} value={value}>{value} minutes</option>)}
        </select>
      </label>
      <p className="text-xs text-muted">Only changes your calendar block, not your Duodoro timer.</p>
      <p className="text-xs text-muted">This is a calendar copy. If the date is cancelled or replaced, remove or update the event in your calendar yourself.</p>
      <p className="text-[11px] text-faint">Includes the time and public Duodoro link, without names or private goals. Your calendar&apos;s sharing settings apply.</p>
      <button className={control} disabled={disabled || busy} onClick={() => void download()}>{busy ? "Preparing calendar file…" : "Download .ics file"}</button>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {notice && !disabled && <p role="status" className="text-xs text-accent">{notice}</p>}
    </div>}
  </div>;
}
