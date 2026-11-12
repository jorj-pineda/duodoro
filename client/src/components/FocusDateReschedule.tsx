"use client";
import { useState, type FormEvent } from "react";
import { formatFocusDateTime, parseFocusDateTime, type FocusDate, type RescheduleAction } from "@/lib/focusDates";
const control = "min-h-11 max-w-full rounded-lg border border-line bg-raise px-3 py-2 text-xs text-ink disabled:opacity-50";
export default function FocusDateReschedule({ date, userId, disabled, onChange }: {
  date: FocusDate; userId: string; disabled: boolean;
  onChange: (date: FocusDate, action: RescheduleAction, startsAt?: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false), [time, setTime] = useState(""), [error, setError] = useState("");
  const parsed = parseFocusDateTime(time);
  async function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    if (!parsed || Date.parse(parsed) <= now || Date.parse(parsed) > now + 90 * 86400000 || Date.parse(parsed) === Date.parse(date.starts_at)) {
      setError("Choose a different future local time within 90 days."); return;
    }
    setError(""); await onChange(date, "propose", parsed);
  }
  return <div role="group" aria-label="Reschedule focus date" className="space-y-2 border-t border-line pt-3">
    <p className="text-xs text-muted">The agreed time stays until both of you accept a replacement. Respond before the current date passes. After a change, update any downloaded calendar copies yourself.</p>
    {date.proposed_starts_at ? <>
      <p className="text-xs text-ink">Proposed replacement: <time dateTime={date.proposed_starts_at}>{formatFocusDateTime(date.proposed_starts_at)}</time></p>
      {date.reschedule_by === userId ? <>
        <p className="text-xs text-muted">Waiting for your friend to agree. Your current date is still accepted.</p>
        <button className={control} disabled={disabled} onClick={() => void onChange(date, "withdraw")}>Withdraw time proposal</button>
      </> : <div className="flex flex-wrap gap-2">
        <button className={control} disabled={disabled} onClick={() => void onChange(date, "accept")}>Accept new time</button>
        <button className={control} disabled={disabled} onClick={() => void onChange(date, "decline")}>Keep current time</button>
      </div>}
    </> : <>
      <button className={control} disabled={disabled} aria-expanded={open} onClick={() => setOpen(value => !value)}>Propose a new time</button>
      {open && <form onSubmit={propose} className="space-y-2">
        <label className="block text-xs text-muted">Replacement local date and time<input required className={`${control} block w-full mt-1`} type="datetime-local" value={time} disabled={disabled} onChange={event => { setTime(event.target.value); setError(""); }} /></label>
        {parsed && <p className="text-xs text-ink">Propose: {formatFocusDateTime(parsed)}</p>}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <button className={control} disabled={disabled || !parsed}>Send new time proposal</button>
      </form>}
    </>}
  </div>;
}
