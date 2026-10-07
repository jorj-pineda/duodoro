"use client";
import { useState } from "react";
import { useLocalDay } from "@/hooks/useDailyFocusGoal";
import { useFocusCalendar } from "@/hooks/useFocusCalendar";
import { dayTotals, focusLabel, monthDays, monthLabel, shiftMonth, type CalendarFilter } from "@/lib/focusCalendar";
import WorldThumb from "./WorldThumb";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export default function FocusCalendar({ userId }: { userId: string }) {
  const today = useLocalDay();
  const [chosenMonth, setChosenMonth] = useState("");
  const [chosenDay, setChosenDay] = useState("");
  const [filter, setFilter] = useState<CalendarFilter>("all");
  const [shown, setShown] = useState(20);
  const month = chosenMonth || today.slice(0, 7);
  const selected = chosenDay.startsWith(`${month}-`) ? chosenDay : (today.startsWith(`${month}-`) ? today : `${month}-01`);
  const { rows, loaded, error, timezone, retry } = useFocusCalendar(userId, month);
  const byDay = new Map(rows.map(row => [row.day, row]));
  const totals = rows.reduce((sum, row) => { const next = dayTotals(row, filter); return { seconds: sum.seconds + next.seconds, rounds: sum.rounds + next.rounds }; }, { seconds: 0, rounds: 0 });
  const details = (byDay.get(selected)?.sessions ?? []).filter(row => filter === "all" || row.is_duo === (filter === "duo"));
  const select = (day: string) => { setChosenDay(day); setShown(20); };
  const changeMonth = (offset: number) => { setChosenMonth(shiftMonth(month, offset)); setShown(20); };
  const buttonId = (day: string) => `focus-calendar-${userId}-${day}`;
  return <section aria-label="Focus calendar" className="space-y-3 text-ink">
    <h2 className="font-display text-lg">Focus calendar</h2>
    {!month ? <p role="status" className="text-sm text-muted">Loading calendar…</p> : <>
      <div className="flex items-center justify-between gap-2">
        <button aria-label="Previous month" className="min-h-11 min-w-11 border border-line" onClick={() => changeMonth(-1)}>←</button>
        <h3 className="text-sm font-semibold text-center">{monthLabel(month)}</h3>
        <button aria-label="Next month" className="min-h-11 min-w-11 border border-line disabled:opacity-40" disabled={month >= today.slice(0, 7)} onClick={() => changeMonth(1)}>→</button>
      </div>
      <div role="group" aria-label="Focus type" className="flex gap-2">
        {(["all", "solo", "duo"] as const).map(value => <button key={value} aria-pressed={filter === value}
          onClick={() => { setFilter(value); setShown(20); }} className={`min-h-11 flex-1 text-xs border border-line capitalize ${filter === value ? "bg-accent text-white" : "bg-raise"}`}>{value.charAt(0).toUpperCase() + value.slice(1)}</button>)}
      </div>
      <p className="text-xs text-muted">Completed, saved focus{timezone ? ` · ${timezone}` : ""}</p>
      {error ? <div role="alert" className="text-sm text-danger">{error} <button className="min-h-11 underline" onClick={() => void retry()}>Retry calendar</button></div>
        : !loaded ? <p role="status" className="text-sm text-muted">Loading calendar…</p> : <>
          <p className="text-sm font-mono">{focusLabel(totals.seconds)} · {totals.rounds} completed {totals.rounds === 1 ? "round" : "rounds"} this month</p>
          <p id={`calendar-help-${userId}`} className="text-[11px] text-muted">Select a day for details. Arrow keys move between days.</p>
          <div className="overflow-x-auto pb-1">
            <div role="group" aria-label={`Days in ${monthLabel(month)}`} aria-describedby={`calendar-help-${userId}`} className="grid grid-cols-7 gap-0.5 min-w-80">
              {WEEKDAYS.map(day => <span key={day} className="text-center text-[10px] text-muted py-1">{day}</span>)}
              {monthDays(month).map((date, index) => {
                if (!date) return <span key={`blank-${index}`} aria-hidden />;
                const { seconds, rounds } = dayTotals(byDay.get(date), filter);
                const fill = seconds >= 3600 ? "bg-accent/30" : seconds >= 1500 ? "bg-accent/20" : seconds > 0 ? "bg-accent/10" : "bg-raise";
                return <button key={date} id={buttonId(date)} aria-label={`${date}: ${focusLabel(seconds)} saved focus, ${rounds} rounds`} aria-pressed={selected === date}
                  tabIndex={selected === date ? 0 : -1} onClick={() => select(date)} onKeyDown={event => {
                    const offset = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[event.key];
                    if (offset === undefined) return;
                    event.preventDefault();
                    const target = new Date(`${date}T12:00:00Z`); target.setUTCDate(target.getUTCDate() + offset);
                    const next = target.toISOString().slice(0, 10);
                    if (next.startsWith(`${month}-`)) { select(next); document.getElementById(buttonId(next))?.focus(); }
                  }} className={`min-h-11 min-w-11 flex flex-col items-center justify-center border text-xs ${fill} ${selected === date ? "border-accent ring-1 ring-inset ring-accent" : "border-transparent"}`}>
                  <span>{Number(date.slice(-2))}</span><span className="text-[9px]">{seconds ? focusLabel(seconds) : "·"}</span>
                </button>;
              })}
            </div>
          </div>
          {!totals.rounds && <p className="text-sm text-muted">No completed {filter === "all" ? "focus" : filter} rounds this month.</p>}
          <div className="border-t border-line pt-3 space-y-2">
            <h3 className="text-sm font-semibold">{selected}</h3>
            {!details.length ? <p className="text-xs text-muted">No completed {filter === "all" ? "focus" : filter} rounds on this day.</p> : <>
              {details.slice(0, shown).map(session => <article key={session.id} className="flex gap-2 items-center bg-raise p-2 rounded-lg">
                <WorldThumb worldId={session.world} /><div className="min-w-0 text-xs">
                  <p className="break-words">{focusLabel(session.focus_seconds)} · {session.is_duo ? `With ${session.partner_name}` : "Solo focus"}</p>
                  <p className="text-muted">{new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone ?? undefined }).format(new Date(session.ended_at))}</p>
                </div>
              </article>)}
              {shown < details.length && <button className="min-h-11 text-xs underline" onClick={() => setShown(count => count + 20)}>Show more rounds ({details.length - shown} remaining)</button>}
            </>}
          </div>
        </>}
    </>}
  </section>;
}
