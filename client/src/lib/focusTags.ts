// Private focus tags: one optional preset per person per saved focus round.
// Identifiers here must match the CHECK constraint and RPC validation in
// supabase/migrations/20261009150000_session_focus_tags.sql. "No tag" is null,
// never an identifier of its own.

export const FOCUS_TAGS = [
  { id: "work", label: "Work" },
  { id: "study", label: "Study" },
  { id: "creative", label: "Creative" },
  { id: "reading", label: "Reading" },
  { id: "planning", label: "Planning" },
  { id: "other", label: "Other" },
] as const;

export type FocusTagId = (typeof FOCUS_TAGS)[number]["id"];

const TAG_LABELS: Record<FocusTagId, string> = Object.fromEntries(
  FOCUS_TAGS.map(tag => [tag.id, tag.label]),
) as Record<FocusTagId, string>;

export function isFocusTagId(value: unknown): value is FocusTagId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TAG_LABELS, value);
}

export function focusTagLabel(tag: FocusTagId): string {
  return TAG_LABELS[tag];
}

// Calendar filter values. "untagged" means a saved round with no tag (null),
// which is distinct from an unavailable or malformed tag.
export type TagFilter = "all" | "untagged" | FocusTagId;

export const TAG_FILTER_OPTIONS: readonly { value: TagFilter; label: string }[] = [
  { value: "all", label: "All tags" },
  { value: "untagged", label: "Untagged" },
  ...FOCUS_TAGS.map(tag => ({ value: tag.id, label: tag.label })),
];

export function isTagFilter(value: unknown): value is TagFilter {
  return value === "all" || value === "untagged" || isFocusTagId(value);
}

export function matchesTagFilter(tag: FocusTagId | null, filter: TagFilter): boolean {
  if (filter === "all") return true;
  if (filter === "untagged") return tag === null;
  return tag === filter;
}

// A revision is an opaque optimistic-concurrency token: a positive safe integer.
export function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

export type CalendarTagRead =
  | { kind: "absent" }
  | { kind: "malformed" }
  | { kind: "ok"; tag: FocusTagId | null; version: number | null };

// Validates the two tag fields on one calendar round. Missing fields mean an
// older API response; malformed fields are never treated as "untagged".
export function readCalendarTag(raw: Record<string, unknown>): CalendarTagRead {
  const hasTag = "private_tag" in raw;
  const hasVersion = "private_tag_version" in raw;
  if (!hasTag && !hasVersion) return { kind: "absent" };
  if (!hasTag || !hasVersion) return { kind: "malformed" };
  const tag = raw.private_tag;
  const version = raw.private_tag_version;
  if (tag !== null && !isFocusTagId(tag)) return { kind: "malformed" };
  if (version !== null && !isRevision(version)) return { kind: "malformed" };
  // A tag always has a revision; a revision without a tag is a cleared round.
  // Null for both means the round was never tagged.
  if (tag !== null && version === null) return { kind: "malformed" };
  return { kind: "ok", tag, version };
}

// Confirmed row returned by the write RPC. The caller must match owner, session
// and the expected output shape before reporting a save as confirmed.
export type ConfirmedFocusTag = {
  sessionId: string;
  userId: string;
  tag: FocusTagId | null;
  version: number;
};

export function readConfirmedFocusTag(
  row: { session_id?: unknown; user_id?: unknown; tag?: unknown; version?: unknown } | null | undefined,
  sessionId: string,
  userId: string,
): ConfirmedFocusTag | null {
  if (!row || row.session_id !== sessionId || row.user_id !== userId) return null;
  if (row.tag !== null && !isFocusTagId(row.tag)) return null;
  if (!isRevision(row.version)) return null;
  return { sessionId, userId, tag: row.tag, version: row.version };
}
