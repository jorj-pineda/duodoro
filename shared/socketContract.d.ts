export type TimerMode = 'pomodoro' | 'flow';
export type GamePhase = 'waiting' | 'focus' | 'celebration' | 'break' | 'returning';
export type FocusSaveState = 'clear' | 'pending' | 'unknown' | 'unconfirmed';
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
  session_created: (payload: { sessionId: string }) => void;
  session_error: (payload: { message: string }) => void;
  focus_save_status: (payload: { state: FocusSaveState }) => void;
  sync_state: (payload: SyncPayload) => void;
  phase_change: (payload: PhaseChangePayload) => void;
  player_joined: (payload: {
    playerId: string;
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
