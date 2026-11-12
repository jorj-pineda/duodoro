"use client";
import { useId, useState } from "react";
import { useLocalDay } from "@/hooks/useDailyFocusGoal";
import { useFocusCalendar } from "@/hooks/useFocusCalendar";
import { loadSessionReflections, useSessionReflections } from "@/hooks/useSessionReflections";
import { focusTagKey, useSessionFocusTagCache } from "@/hooks/useSessionFocusTags";
import { focusLabel, monthLabel, sessionMatches, shiftMonth, type CalendarFilter } from "@/lib/focusCalendar";
import { focusTagLabel, isTagFilter, TAG_FILTER_OPTIONS, type TagFilter } from "@/lib/focusTags";
import { reflectionRangeMonths, type ReflectionDateRange } from "@/lib/reflectionRange";
import WorldThumb from "./WorldThumb";

const PAGE = 20;

// Account changes discard search text, filters and the selected month as well
// as the notes. These controls are intentionally never persisted or shared.
export default function ReflectionReview({ userId }: { userId: string }) {
  return <Review key={userId} userId={userId} />;
}

function Review({ userId }: { userId: string }) {
  const today = useLocalDay();
  const [chosenMonth, setChosenMonth] = useState("");
  const [rangeMode, setRangeMode] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [appliedRange, setAppliedRange] = useState<ReflectionDateRange | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<CalendarFilter>("all");
  const [tagFilter, setTagFilter] = useState<TagFilter>("all");
  const [shown, setShown] = useState(PAGE);
  const month = chosenMonth || today.slice(0, 7);
  const ready = rangeMode ? !!appliedRange : !!month;
  const { rows, loaded: calendarLoaded, error, retry, timezone, tagsAvailable } = useFocusCalendar(userId, rangeMode ? "" : month, rangeMode && appliedRange ? appliedRange : undefined);
  const loaded = ready && calendarLoaded;
  const sessions = ready ? rows.flatMap(row => row.sessions) : [];
  const ids = sessions.map(session => session.id);
  const entries = useSessionReflections(userId, ids);
  const tags = useSessionFocusTagCache();
  const reading = ids.some(id => !entries[id] || entries[id]?.status === "loading");
  const failed = ids.some(id => entries[id]?.status === "error");
  const pending = ids.some(id => entries[id]?.pending);
  const complete = loaded && !error && !reading && !failed && !pending;
  const needle = search.trim().toLocaleLowerCase();
  const notes = sessions.flatMap(session => {
    const reflection = entries[session.id]?.reflection;
    if (!reflection || reflection.userId !== userId || reflection.sessionId !== session.id) return [];
    const saved = tags[focusTagKey(userId, session.id)];
    const round = saved && saved.version > (session.private_tag_version ?? 0)
      ? { ...session, private_tag: saved.tag, private_tag_version: saved.version } : session;
    return [{ round, reflection }];
  }).sort((a, b) => Date.parse(b.round.ended_at) - Date.parse(a.round.ended_at) || a.round.id.localeCompare(b.round.id));
  const matching = notes.filter(({ round, reflection }) => sessionMatches(round, typeFilter, tagsAvailable ? tagFilter : "all")
    && reflection.text.toLocaleLowerCase().includes(needle));
  const filtered = !!needle || typeFilter !== "all" || (tagsAvailable && tagFilter !== "all");
  const changeMonth = (offset: number) => { setChosenMonth(shiftMonth(month, offset)); setShown(PAGE); };
  const refresh = async () => {
    // A stale account/month callback cannot start a new reflection read.
    if (await retry()) await loadSessionReflections(userId, ids);
  };
  const searchId = useId();
  const typeId = useId();
  const tagId = useId();

  return <section aria-label="Private reflection review" className="space-y-4">
    <h2 className="font-display text-lg text-ink">Your reflections</h2>
    <p className="text-xs text-muted">Your saved reflections and tags are private, even on duo rounds. Edit or delete notes in Calendar.</p>
    <button className="min-h-11 px-2 text-sm font-bold text-accent" onClick={() => { setRangeMode(value => !value); setAppliedRange(null); setShown(PAGE); }}>{rangeMode ? "Back to monthly review" : "Search a date range"}</button>
    {rangeMode ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (reflectionRangeMonths({ from, to })) { setAppliedRange({ from, to }); setShown(PAGE); } }}>
      <p className="text-xs text-muted">Search up to 366 local calendar days. Keyword, tag and round-type filters apply to the whole range before pagination.</p>
      <div className="flex flex-wrap gap-2">
        <label className="text-xs text-muted">From date<input type="date" value={from} onChange={event => setFrom(event.target.value)} className="block min-h-11 max-w-full rounded border border-line bg-surface px-2 text-ink" /></label>
        <label className="text-xs text-muted">Through date<input type="date" value={to} onChange={event => setTo(event.target.value)} className="block min-h-11 max-w-full rounded border border-line bg-surface px-2 text-ink" /></label>
      </div>
      <button className="min-h-11 px-2 text-sm font-bold text-accent" disabled={!reflectionRangeMonths({ from, to })}>Search this date range</button>
      {(from || to) && !reflectionRangeMonths({ from, to }) && <p className="text-xs text-muted">Choose valid dates in order, covering at most 366 days including both dates.</p>}
      {appliedRange ? <p className="text-xs text-muted">Showing {appliedRange.from} through {appliedRange.to}, inclusive.</p> : <p className="text-xs text-muted">Choose dates, then search to load your reflections.</p>}
    </form> : <div className="flex items-center justify-between gap-2">
      <button disabled={!month} onClick={() => changeMonth(-1)} aria-label="Previous reflection month"
        className="min-h-11 min-w-11 rounded-lg border border-line text-ink disabled:opacity-40">←</button>
      <p className="text-sm font-bold text-ink text-center" aria-live="polite">{month ? monthLabel(month) : "Your local month"}</p>
      <button disabled={!month} onClick={() => changeMonth(1)} aria-label="Next reflection month"
        className="min-h-11 min-w-11 rounded-lg border border-line text-ink disabled:opacity-40">→</button>
    </div>}
    {timezone && <p className="text-xs text-muted">{timezone}</p>}
    <div className="space-y-2">
      <label htmlFor={searchId} className="block text-xs font-bold text-muted">Search your reflections</label>
      <input id={searchId} type="search" value={search} onChange={event => { setSearch(event.target.value); setShown(PAGE); }}
        className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-sm text-ink" />
      <div className="grid grid-cols-2 gap-2">
        <label htmlFor={typeId} className="text-xs text-muted">Round type
          <select id={typeId} value={typeFilter} onChange={event => { setTypeFilter(event.target.value as CalendarFilter); setShown(PAGE); }}
            className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-2 text-ink">
            <option value="all">All rounds</option><option value="solo">Solo</option><option value="duo">Duo</option>
          </select>
        </label>
        <label htmlFor={tagId} className="text-xs text-muted">Private tag
          <select id={tagId} disabled={!tagsAvailable} value={tagsAvailable ? tagFilter : "all"} onChange={event => {
            if (isTagFilter(event.target.value)) { setTagFilter(event.target.value); setShown(PAGE); }
          }} className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-2 text-ink disabled:opacity-50">
            {TAG_FILTER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
    </div>
    {loaded && !tagsAvailable && <p className="text-xs text-muted">Private tags are unavailable. Your reflections are still shown without tag filtering.</p>}
    {(error || failed) && <div role="alert" className="text-sm text-muted">
      {error && <p>{loaded ? "Couldn't refresh your rounds. Showing the last loaded rounds." : "Couldn't load your rounds."}</p>}
      {failed && <p>Some reflections couldn&apos;t be loaded. Previously loaded notes may be out of date; the list may be incomplete.</p>}
      <button onClick={() => void refresh()} className="min-h-11 px-2 font-bold text-accent">Retry reflections</button>
    </div>}
    {(ready && !loaded && !error || loaded && reading) && <p role="status" className="text-sm text-muted">Loading your reflections…</p>}
    {pending && <p role="status" className="text-sm text-muted">A reflection change is still being saved. Showing the last confirmed notes.</p>}
    {loaded && <>
      {complete && matching.length === 0 ? <p className="text-sm text-muted">{filtered
        ? "No reflections match these filters. Try another search, tag or round type."
        : rangeMode ? "No saved reflections in this date range. You can add a private note to a completed round in Calendar." : "No saved reflections this month. You can add a private note to a completed round in Calendar."}</p> : <>
        {matching.length > 0 && <p role="status" className="text-xs text-muted">{matching.length} {complete ? "matching" : "loaded matching"} {matching.length === 1 ? "reflection" : "reflections"}</p>}
        <ol aria-label="Saved private reflections" className="space-y-3">
          {matching.slice(0, shown).map(({ round, reflection }) => <li key={round.id}>
            <article className="rounded-xl border border-line bg-surface p-3 space-y-2">
              <div className="flex gap-2 items-center">
                <WorldThumb worldId={round.world} />
                <div className="min-w-0 text-xs text-muted">
                  <p className="font-bold text-ink">{focusLabel(round.focus_seconds)} · {round.is_duo ? "Duo" : "Solo"}</p>
                  <time dateTime={round.ended_at}>{new Intl.DateTimeFormat("en-US", {
                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone ?? undefined,
                  }).format(new Date(round.ended_at))}</time>
                </div>
              </div>
              {tagsAvailable && <p className="text-xs text-muted">{round.private_tag ? focusTagLabel(round.private_tag) : "No tag"}</p>}
              <p className="whitespace-pre-wrap break-words text-sm text-ink">{reflection.text}</p>
            </article>
          </li>)}
        </ol>
        {matching.length > shown && <button onClick={() => setShown(value => value + PAGE)}
          className="min-h-11 w-full rounded-lg border border-line text-sm font-bold text-accent">Show more reflections ({matching.length - shown} remaining)</button>}
      </>}
    </>}
  </section>;
}
