import type { AvatarConfig } from "./avatarData";
import type { Database, Tables } from "./database.types";

export type { AvatarConfig };

// SQL intentionally withholds totals until an invitation is accepted. Generated
// RPC return types don't capture nullable OUT fields.
export type SharedDailyGoal = Omit<
  Database["public"]["Functions"]["get_shared_daily_goals"]["Returns"][number],
  "my_seconds" | "partner_seconds"
> & { my_seconds: number | null; partner_seconds: number | null };

type ProfileRow = Tables<"profiles">;

/** UI-safe profile shape after nullable database defaults are normalized. */
export type Profile = Omit<
  ProfileRow,
  "avatar_config" | "is_premium" | "updated_at" | "username_changed"
> & {
  avatar_config: AvatarConfig | null;
  is_premium: boolean;
  updated_at: string;
  username_changed: boolean;
};

export function profileFromRow(row: ProfileRow): Profile {
  return {
    ...row,
    avatar_config: row.avatar_config as AvatarConfig | null,
    is_premium: row.is_premium ?? false,
    updated_at: row.updated_at ?? new Date(0).toISOString(),
    username_changed: row.username_changed ?? false,
  };
}

export type FriendshipStatus = "pending" | "accepted";

export type Friendship = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
  // Joined profile (the friend's profile, not ours)
  friend: Profile;
};

type TaskRow = Tables<"tasks">;

export type Task = Omit<
  TaskRow,
  "created_at" | "is_done" | "is_shared" | "session_id"
> & {
  is_done: boolean;
  is_shared: boolean;
  created_at: string;
  /** Who ticked it off. Only ever set on shared goals, and only by the
   *  toggle_shared_task RPC — migration 017 revokes the column from clients. */
  completed_by: string | null;
};

export function taskFromRow(row: TaskRow): Task {
  return {
    id: row.id,
    owner_id: row.owner_id,
    room_code: row.room_code,
    content: row.content,
    completed_by: row.completed_by,
    created_at: row.created_at ?? new Date(0).toISOString(),
    is_done: row.is_done ?? false,
    is_shared: row.is_shared ?? false,
  };
}

export type { PetStage } from "./petLevel";

export type PetType = "cat" | "dog" | "dragon" | "rabbit";

export const PET_OPTIONS: { type: PetType; label: string }[] = [
  { type: "cat",    label: "Cat" },
  { type: "dog",    label: "Dog" },
  { type: "dragon", label: "Dragon" },
  { type: "rabbit", label: "Rabbit" },
];

// ── Session Stats ─────────────────────────────────────────────────────────────

export type Session = {
  id: string;
  room_code: string;
  world: string;
  focus_duration: number;
  break_duration: number;
  actual_focus: number;
  completed: boolean;
  started_at: string;
  ended_at: string;
};

export type SessionParticipant = {
  id: string;
  session_id: string;
  user_id: string;
  created_at: string;
};

export type SessionWithPartner =
  Database["public"]["Functions"]["get_recent_sessions"]["Returns"][number];

export type ProfileSearchResult =
  Database["public"]["Functions"]["search_profiles"]["Returns"][number];

export type PersonalStats = {
  totalFocusTime: number;
  weeklyFocusTime: number;
  sessionsCompleted: number;
  currentStreak: number;
  longestStreak: number;
  avgSessionLength: number;
};

/** One day of the activity chart, straight from get_daily_focus. */
export type DailyFocus = {
  day: string;          // YYYY-MM-DD in the caller's timezone
  focusSeconds: number;
  sessionCount: number;
};

export type DuoStats = {
  partnerId: string;
  partnerName: string;
  totalCoFocusTime: number;
  sessionsTogether: number;
};
