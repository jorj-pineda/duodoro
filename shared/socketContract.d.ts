export type ReactionType = 'heart' | 'cheer' | 'wave';
export interface RoomReaction { id: string; sessionId: string; playerId: string; reaction: ReactionType; }
export interface ReactionResponse { ok: boolean; message?: string; }

export type TimerMode = 'pomodoro' | 'flow';
export type GamePhase = 'waiting' | 'focus' | 'celebration' | 'break' | 'returning' | 'ready';
export type FocusSaveState = 'clear' | 'pending' | 'unknown' | 'unconfirmed';
export interface SessionIntention {
  text: string;
  displayName: string;
  completed: boolean;
}
export interface SessionIntentions {
  current: Record<string, SessionIntention>;
  next: Record<string, string>;
}
export interface IntentionResponse { ok: boolean; message?: string; }

export interface RoundRecap {
  intentions?: Record<string, SessionIntention>;
  round: number;
  focusSeconds: number;
  mode: TimerMode;
  saveState: 'saving' | 'saved' | 'pending' | 'unconfirmed';
}

export type PetType = 'cat' | 'dog' | 'dragon' | 'rabbit';
export type PetStage = 'young' | 'grown' | 'full';
export type HairStyle = 'bob' | 'mohawk' | 'long' | 'spiky' | 'bald';
export type EyeStyle = 'normal' | 'anime' | 'sleepy';

export interface AvatarConfig {
  skinColor: string;
  hairStyle: HairStyle;
  hairColor: string;
  eyeStyle: EyeStyle;
  outfitColor: string;
}

export interface PlayerData {
  avatar: AvatarConfig;
  displayName?: string;
  userId?: string | null;
  pet?: PetType | null;
  petStage?: PetStage | null;
  disconnected?: boolean;
}

export interface SyncPayload {
  intentions?: SessionIntentions;
  /** Private saved-focus total for this recipient, never their partner. */
  companionFocusSeconds?: number | null;
  completedRounds?: number;
  roundRecap?: RoundRecap | null;
  mode: TimerMode;
  phase: GamePhase;
  focusDuration: number;
  breakDuration: number;
  phaseStartTime: number | null;
  world: string;
  players: Record<string, PlayerData>;
  playerCount: number;
  sessionId: string;
}

export interface PhaseChangePayload {
  intentions?: SessionIntentions;
  completedRounds?: number;
  roundRecap?: RoundRecap | null;
  mode: TimerMode;
  phase: GamePhase;
  phaseStartTime: number | null;
  focusDuration: number;
  breakDuration: number;
}

export interface InviteData {
  sessionId: string;
  worldId: string | null;
  fromName: string;
  fromUserId: string | null;
}

export interface ShareInviteResponse {
  ok: boolean;
  token?: string;
  expiresAt?: number;
  message?: string;
}

export interface AccountDeletionResponse {
  ok: boolean;
  message?: string;
}

export interface ClientToServerEvents {
  send_reaction: (payload: { sessionId: string; reaction: ReactionType }, respond: (response: ReactionResponse) => void) => void;
  set_intention: (payload: { sessionId: string; text: string }, respond: (response: IntentionResponse) => void) => void;
  resolve_intention: (payload: { sessionId: string; round: number; action: "done" | "undo" | "carry" }, respond: (response: IntentionResponse) => void) => void;
  request_companion_progress: () => void;
  register_user: (payload: Record<string, never>) => void;
  get_online_friends: (
    payload: { friendIds: string[] },
    respond: (onlineIds: string[]) => void,
  ) => void;
  delete_account: (
    payload: { confirmation: string },
    respond: (response: AccountDeletionResponse) => void,
  ) => void;
  send_invite: (payload: {
    targetUserId: string;
    sessionId: string;
    fromName: string;
  }) => void;
  create_session: (payload: {
    avatar: AvatarConfig;
    displayName: string;
    pet?: PetType | null;
  }) => void;
  create_share_invite: (
    payload: { sessionId: string },
    respond: (response: ShareInviteResponse) => void,
  ) => void;
  join_session: (payload: {
    sessionId?: string;
    shareToken?: string;
    avatar: AvatarConfig;
    displayName: string;
    pet?: PetType | null;
  }) => void;
  start_session: (payload: {
    sessionId: string;
    focusDuration: number;
    breakDuration: number;
    mode: TimerMode;
  }) => void;
  finish_flow_focus: (payload: { sessionId: string }) => void;
  stop_session: (payload: { sessionId: string }) => void;
  set_pet: (payload: { sessionId: string; pet: PetType | null }) => void;
  leave_session: (payload: { sessionId: string }) => void;
  request_sync: () => void;
  request_focus_save_status: () => void;
}

export interface ServerToClientEvents {
  room_reaction: (payload: RoomReaction) => void;
  intentions_changed: (payload: { sessionId: string; intentions: SessionIntentions; recap: RoundRecap | null }) => void;
  companion_progress: (payload: { sessionId: string; focusSeconds: number | null; grewTo: PetStage | null }) => void;
  session_created: (payload: { sessionId: string }) => void;
  session_error: (payload: { message: string }) => void;
  focus_save_status: (payload: { state: FocusSaveState }) => void;
  round_recap: (payload: { sessionId: string; recap: RoundRecap }) => void;
  sync_state: (payload: SyncPayload) => void;
  phase_change: (payload: PhaseChangePayload) => void;
  player_joined: (payload: {
    playerId: string;
    userId?: string | null;
    avatar: AvatarConfig;
    displayName?: string;
    pet?: PetType | null;
    petStage?: PetStage | null;
  }) => void;
  pet_changed: (payload: {
    playerId: string;
    pet: PetType | null;
    petStage?: PetStage | null;
  }) => void;
  player_disconnected: (payload: { playerId: string }) => void;
  player_left: (payload: { playerId: string }) => void;
  session_invite: (payload: InviteData) => void;
  invite_error: (payload: { message: string }) => void;
  presence_update: (payload: { userId: string; online: boolean }) => void;
}

export const CLIENT_EVENT_NAMES: readonly (keyof ClientToServerEvents)[];
export const SERVER_EVENT_NAMES: readonly (keyof ServerToClientEvents)[];
