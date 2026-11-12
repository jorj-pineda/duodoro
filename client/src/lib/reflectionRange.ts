export type ReflectionDateRange = { from: string; to: string };
// Date-only arithmetic validates local calendar labels without DST-hour drift.
export function reflectionRangeMonths(range: ReflectionDateRange): string[] | null {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return NaN;
    const time = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value ? time : NaN;
  };
  const from = parse(range.from), to = parse(range.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 365 * 86400000) return null;
  const months: string[] = [];
  let year = Number(range.from.slice(0,4)), month = Number(range.from.slice(5,7));
  const last = range.to.slice(0,7);
  for (;;) {
    const key = `${String(year).padStart(4,"0")}-${String(month).padStart(2,"0")}`;
    months.push(key); if (key === last) return months;
    if (++month === 13) { month = 1; year++; }
  }
}
