"use client";
import { useEffect, useRef, useState } from "react";
import { downloadFocusCsv, focusCsv, loadFocusExport } from "@/lib/focusExport";

export default function FocusHistoryExport({ userId }: { userId: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reflections, setReflections] = useState(false);
  const [tags, setTags] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, [userId]);
  function cancel(message: string) {
    active.current?.abort(); active.current = null;
    setBusy(false); setMessage(message);
  }
  async function run() {
    if (active.current) return;
    const request = new AbortController(); active.current = request;
    const timeout = window.setTimeout(() => { if (active.current === request) cancel("Export timed out. No file was downloaded."); }, 120_000);
    setBusy(true); setMessage("");
    const options = { from, to, reflections, tags };
    try {
      const rows = await loadFocusExport(userId, options, request.signal);
      request.signal.throwIfAborted();
      if (!rows.length) setMessage("No saved rounds ended in this UTC date range.");
      else { downloadFocusCsv(focusCsv(rows, options), options); setMessage(`Download requested for ${rows.length} saved rounds.`); }
    } catch (error) {
      if (active.current === request) setMessage(request.signal.aborted ? "Export cancelled or timed out. No file was downloaded." : error instanceof Error ? error.message : "Couldn't export your history. Try again.");
    } finally {
      window.clearTimeout(timeout);
      if (active.current === request) { active.current = null; setBusy(false); }
    }
  }
  return <section aria-label="Export focus history" className="rounded-xl border border-line p-4 space-y-3">
    <h2 className="font-bold text-ink">Export your focus history</h2>
    <p className="text-sm text-muted">Download saved completed and stopped rounds as CSV. Dates use UTC and match when a round ended. Up to 366 days per export.</p>
    <p className="text-sm text-muted">Partner names and identifiers are excluded. Reflections and tags are private and optional. The downloaded file is yours to keep safe. History may change while an export is loading; pending saves are not included.</p>
    <fieldset disabled={busy} className="space-y-3">
      <div className="flex flex-wrap gap-3"><label className="text-sm">From (UTC)<input aria-label="Export from (UTC)" type="date" value={from} onChange={e => setFrom(e.target.value)} className="block min-h-11 rounded border border-line bg-surface px-2 max-w-full" /></label>
      <label className="text-sm">Through (UTC)<input aria-label="Export through (UTC)" type="date" value={to} onChange={e => setTo(e.target.value)} className="block min-h-11 rounded border border-line bg-surface px-2 max-w-full" /></label></div>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={reflections} onChange={e => setReflections(e.target.checked)} />Include my private reflections</label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={tags} onChange={e => setTags(e.target.checked)} />Include my private tags</label>
      <button type="button" onClick={run} disabled={!from || !to} className="min-h-11 rounded-lg bg-accent px-4 text-white disabled:opacity-50">{busy ? "Preparing export…" : "Download CSV"}</button>
    </fieldset>
    {busy && <button onClick={() => cancel("Export cancelled. No file was downloaded.")} className="min-h-11 text-sm text-accent">Cancel export</button>}
    {message && <p role="status" className="text-sm text-ink">{message}</p>}
  </section>;
}
