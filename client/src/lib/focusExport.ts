import { getSupabase } from "./supabase";

export type ExportOptions = { from: string; to: string; reflections: boolean; tags: boolean };
export type ExportRound = { id: string; started_at: string; ended_at: string | null; actual_focus: number; completed: boolean | null; world: string; reflection?: string; tag?: string | null };
const PAGE = 200;
const MAX_ROWS = 100_000;

export function exportRange(from: string, to: string): { start: string; end: string } {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose valid dates.");
    const time = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error("Choose valid dates.");
    return time;
  };
  const start = parse(from), last = parse(to);
  if (last < start || last - start > 365 * 86400000) throw new Error("Choose a range of up to 366 days, with the end on or after the start.");
  return { start: new Date(start).toISOString(), end: new Date(last + 86400000).toISOString() };
}

// Quoting alone does not prevent spreadsheet formula execution.
export function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(raw) || /^[\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function focusCsv(rows: ExportRound[], options: ExportOptions): string {
  const header = ["Started at (UTC)", "Ended at (UTC)", "Status", "Focus seconds", "World", ...(options.reflections ? ["Private reflection"] : []), ...(options.tags ? ["Private tag"] : [])];
  return "\uFEFF" + [header, ...rows.map(row => [row.started_at, row.ended_at, row.completed ? "Completed" : "Stopped", row.actual_focus, row.world, ...(options.reflections ? [row.reflection ?? ""] : []), ...(options.tags ? [row.tag ?? ""] : [])])].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export async function loadFocusExport(userId: string, options: ExportOptions, signal: AbortSignal): Promise<ExportRound[]> {
  const { start, end } = exportRange(options.from, options.to);
  const sb = getSupabase();
  const checkAccount = async () => {
    signal.throwIfAborted();
    const { data, error } = await sb.auth.getUser();
    if (error || data.user?.id !== userId) throw new Error("Your account changed. Reopen Stats and try again.");
    signal.throwIfAborted();
  };
  await checkAccount();
  const rows: ExportRound[] = [];
  let cursor: string | undefined;
  for (;;) {
    signal.throwIfAborted();
    let query = sb.from("sessions").select("id,started_at,ended_at,actual_focus,completed,world,session_participants!inner(user_id)")
      .eq("session_participants.user_id", userId).gte("ended_at", start).lt("ended_at", end).order("id").limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query.abortSignal(signal);
    if (error || !data) throw new Error("Couldn't read all your focus history. No file was downloaded. Try again.");
    if (!data.length) break;
    if (rows.length + data.length > MAX_ROWS) throw new Error("This export is too large. Choose a shorter date range.");
    const page: ExportRound[] = data.map(({ id, started_at, ended_at, actual_focus, completed, world }) => ({ id, started_at, ended_at, actual_focus, completed, world }));
    const ids = page.map(row => row.id);
    if (options.reflections) {
      const result = await sb.from("session_reflections").select("session_id,reflection_text").eq("user_id", userId).in("session_id", ids).abortSignal(signal);
      if (result.error || !result.data) throw new Error("Couldn't read your reflections. No file was downloaded.");
      const notes = new Map(result.data.map(row => [row.session_id, row.reflection_text]));
      page.forEach(row => { row.reflection = notes.get(row.id); });
    }
    if (options.tags) {
      const result = await sb.from("session_focus_tags").select("session_id,tag").eq("user_id", userId).in("session_id", ids).abortSignal(signal);
      if (result.error || !result.data) throw new Error("Couldn't read your tags. No file was downloaded.");
      const tags = new Map(result.data.map(row => [row.session_id, row.tag]));
      page.forEach(row => { row.tag = tags.get(row.id); });
    }
    rows.push(...page);
    // Always ask for the next page, even if the API imposed a smaller limit.
    const next = page[page.length - 1].id;
    if (next === cursor) throw new Error("Couldn't finish your export. Try again.");
    cursor = next;
  }
  await checkAccount();
  return rows.sort((a, b) => a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id));
}

export function downloadFocusCsv(content: string, options: ExportOptions): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  try {
    anchor.href = url; anchor.download = `duodoro-focus-${options.from}-to-${options.to}-UTC.csv`;
    anchor.hidden = true; document.body.append(anchor); anchor.click();
  } catch (error) { URL.revokeObjectURL(url); throw error; }
  finally { anchor.remove(); }
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
