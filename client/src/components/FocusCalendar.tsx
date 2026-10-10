"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocalDay } from "@/hooks/useDailyFocusGoal";
import { useFocusCalendar } from "@/hooks/useFocusCalendar";
import { useLoadSessionReflections } from "@/hooks/useSessionReflections";
import { focusTagKey, readSavedFocusTag, useSessionFocusTagCache, type SavedFocusTag } from "@/hooks/useSessionFocusTags";
import { filteredDayTotals, focusLabel, monthDays, monthLabel, sessionMatches, shiftMonth, type CalendarDay, type CalendarFilter } from "@/lib/focusCalendar";
import { focusTagLabel, isTagFilter, TAG_FILTER_OPTIONS, type TagFilter } from "@/lib/focusTags";
import SessionFocusTag from "./SessionFocusTag";
import SessionReflection from "./SessionReflection";
import WorldThumb from "./WorldThumb";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PAGE = 20;

// Newer confirmed tags from this tab override a calendar read that began earlier.
function withSavedTags(rows: CalendarDay[], userId: string, cache: Record<string, SavedFocusTag>): CalendarDay[] {
  return rows.map(row => ({
    ...row,
    sessions: row.sessions.map(session => {
      const saved = cache[focusTagKey(userId, session.id)];
      if (!saved || saved.version <= (session.private_tag_version ?? 0)) return session;
      return { ...session, private_tag: saved.tag, private_tag_version: saved.version };
    }),
  }));
}

function tagPhrase(tag: TagFilter): string {
  if (tag === "all") return "";
  if (tag === "untagged") return " without a tag";
  return ` tagged ${focusTagLabel(tag)}`;
}

export default function FocusCalendar({ userId }: { userId: string }) {
  const today = useLocalDay();
  const [chosenMonth, setChosenMonth] = useState("");
  const [chosenDay, setChosenDay] = useState("");
  const [filter, setFilter] = useState<CalendarFilter>("all");
  const [tagFilter, setTagFilter] = useState<TagFilter>("all");
  const [shown, setShown] = useState(PAGE);
  const [dirtyReflections, setDirtyReflections] = useState<ReadonlySet<string>>(() => new Set());
  const reflectionChanged = useCallback((sessionId: string, dirty: boolean) => {
    setDirtyReflections(previous => {
      if (previous.has(sessionId) === dirty) return previous;
      const next = new Set(previous);
      if (dirty) next.add(sessionId); else next.delete(sessionId);
      return next;
    });
  }, []);
  const [announcement, setAnnouncement] = useState("");
  const pendingFocus = useRef<string | null>(null);
  // Bumped after each save so the focus check runs once the removed round has rendered.
  const [focusRequest, setFocusRequest] = useState(0);
  const month = chosenMonth || today.slice(0, 7);
  const selected = chosenDay.startsWith(`${month}-`) ? chosenDay : (today.startsWith(`${month}-`) ? today : `${month}-01`);
  const { rows: savedRows, loaded, error, timezone, retry, tagsAvailable } = useFocusCalendar(userId, month);
  const cache = useSessionFocusTagCache();
  const rows = useMemo(() => withSavedTags(savedRows, userId, cache), [savedRows, userId, cache]);
  const activeTag: TagFilter = tagsAvailable ? tagFilter : "all";
  const tagged = activeTag !== "all";
  const byDay = new Map(rows.map(row => [row.day, row]));
  const totals = rows.reduce((sum, row) => {
    const next = filteredDayTotals(row, filter, activeTag);
    return { seconds: sum.seconds + next.seconds, rounds: sum.rounds + next.rounds };
  }, { seconds: 0, rounds: 0 });
  // Filtering uses the complete day from the server before the display limit.
  const details = (byDay.get(selected)?.sessions ?? []).filter(session => sessionMatches(session, filter, activeTag));
  // Keep dirty editors mounted when a tag change excludes their round.
  // These exceptions do not contribute to matching totals or pagination.
  const retainedDrafts = (byDay.get(selected)?.sessions ?? []).filter(session => dirtyReflections.has(session.id) && !sessionMatches(session, filter, activeTag));
  const visibleDetails = [...details.slice(0, shown), ...retainedDrafts];
  const detailIds = visibleDetails.map(session => session.id).join(",");
  // One bounded batch for the rounds on screen, not one request per round.
  useLoadSessionReflections(userId, visibleDetails.map(session => session.id));

  const buttonId = (day: string) => `focus-calendar-${userId}-${day}`;

  // A save can move its round out of the filtered list. Once the list has
  // rendered without it, keep focus on the selected day instead of <body>.
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id || detailIds.split(",").includes(id)) return;
    pendingFocus.current = null;
    document.getElementById(`focus-calendar-${userId}-${selected}`)?.focus();
  }, [focusRequest, detailIds, selected, userId]);

  const select = (day: string) => { setChosenDay(day); setShown(PAGE); };
  const changeMonth = (offset: number) => { setChosenMonth(shiftMonth(month, offset)); setShown(PAGE); };
  const tagFilterId = useId();
  const typeWord = filter === "all" ? "focus" : filter;
  // Runs after a confirmed save, when the cache already holds the new tag.
  const onTagSaved = (sessionId: string) => {
    const round = details.find(session => session.id === sessionId);
    const nextTag = readSavedFocusTag(userId, sessionId)?.tag ?? null;
    const stillMatches = !round || sessionMatches({ ...round, private_tag: nextTag }, filter, activeTag);
    if (stillMatches) {
      setAnnouncement("");
    } else {
      pendingFocus.current = sessionId;
      setAnnouncement("Tag saved. That round no longer matches the current filters.");
    }
    setFocusRequest(count => count + 1);
    void retry();
  };

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
          onClick={() => { setFilter(value); setShown(PAGE); }} className={`min-h-11 flex-1 text-xs border border-line capitalize ${filter === value ? "bg-accent text-white" : "bg-raise"}`}>{value.charAt(0).toUpperCase() + value.slice(1)}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={tagFilterId} className="text-xs text-ink">Filter by private tag</label>
        <select id={tagFilterId} value={activeTag} disabled={!tagsAvailable}
          onChange={event => { if (isTagFilter(event.target.value)) { setTagFilter(event.target.value); setShown(PAGE); } }}
          className="min-h-11 border border-line bg-bg px-2 text-xs text-ink disabled:opacity-50">
          {TAG_FILTER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {loaded && !tagsAvailable && <p role="status" className="text-xs text-muted basis-full">Private tags are unavailable right now. Your rounds and totals are unaffected.</p>}
      </div>
      <p role="status" className="text-xs text-ink empty:hidden">{announcement}</p>
      <p className="text-xs text-muted">Completed, saved focus{timezone ? ` · ${timezone}` : ""}</p>
      {!loaded && error ? <div role="alert" className="text-sm text-danger">{error} <button className="min-h-11 underline" onClick={() => void retry()}>Retry calendar</button></div>
        : !loaded ? <p role="status" className="text-sm text-muted">Loading calendar…</p> : <>
          {error && <div role="alert" className="text-sm text-danger">{error} <button className="min-h-11 underline" onClick={() => void retry()}>Retry calendar</button></div>}
          <p className="text-sm font-mono">{focusLabel(totals.seconds)} · {totals.rounds} {tagged ? "matching" : "completed"} {totals.rounds === 1 ? "round" : "rounds"} this month</p>
          {tagged && <p className="text-[11px] text-muted">Matching rounds only{activeTag === "untagged" ? ": rounds without a private tag" : `: rounds tagged ${focusTagLabel(activeTag)}`}. Your focus history is unchanged.</p>}
          <p id={`calendar-help-${userId}`} className="text-[11px] text-muted">Select a day for details. Arrow keys move between days.</p>
          <div className="overflow-x-auto pb-1">
            <div role="group" aria-label={`Days in ${monthLabel(month)}`} aria-describedby={`calendar-help-${userId}`} className="grid grid-cols-7 gap-0.5 min-w-80">
              {WEEKDAYS.map(day => <span key={day} className="text-center text-[10px] text-muted py-1">{day}</span>)}
              {monthDays(month).map((date, index) => {
                if (!date) return <span key={`blank-${index}`} aria-hidden />;
                const { seconds, rounds } = filteredDayTotals(byDay.get(date), filter, activeTag);
                const fill = seconds >= 3600 ? "bg-accent/30" : seconds >= 1500 ? "bg-accent/20" : seconds > 0 ? "bg-accent/10" : "bg-raise";
                return <button key={date} id={buttonId(date)} aria-label={`${date}: ${focusLabel(seconds)} ${tagged ? "matching" : "saved"} focus, ${rounds} rounds`} aria-pressed={selected === date}
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
          {!totals.rounds && <p className="text-sm text-muted">No completed {typeWord} rounds{tagPhrase(activeTag)} this month.</p>}
          <div className="border-t border-line pt-3 space-y-2">
            <h3 className="text-sm font-semibold">{selected}</h3>
            {!visibleDetails.length ? <p className="text-xs text-muted">No completed {typeWord} rounds{tagPhrase(activeTag)} on this day.</p> : <>
              {visibleDetails.map(session => <article key={`round-${userId}-${session.id}`} className="space-y-2 bg-raise p-2 rounded-lg">
                <div className="flex gap-2 items-center">
                  <WorldThumb worldId={session.world} /><div className="min-w-0 text-xs">
                    <p className="break-words">{focusLabel(session.focus_seconds)} · {session.is_duo ? `With ${session.partner_name}` : "Solo focus"}</p>
                    <p className="text-muted">{new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone ?? undefined }).format(new Date(session.ended_at))}</p>
                  </div>
                </div>
                <SessionFocusTag key={`tag-${userId}-${session.id}`} userId={userId} sessionId={session.id}
                  saved={session.private_tag_version === null ? null : { tag: session.private_tag, version: session.private_tag_version }}
                  available={tagsAvailable} onSaved={onTagSaved} reload={retry} />
                {!sessionMatches(session, filter, activeTag) && <p role="status" className="text-xs text-muted">This round stays here while you finish your reflection draft. It is excluded from matching totals.</p>}
                <SessionReflection key={`reflection-${userId}-${session.id}`} userId={userId} sessionId={session.id} onDirtyChange={dirty => reflectionChanged(session.id, dirty)} />
              </article>)}
              {shown < details.length && <button className="min-h-11 text-xs underline" onClick={() => setShown(count => count + PAGE)}>Show more rounds ({details.length - shown} remaining)</button>}
            </>}
          </div>
        </>}
    </>}
  </section>;
}
