export type {
  ReactionType,
  RoomReaction,
  SessionIntentions,
  IntentionResponse,
  FocusSaveState,
  RoundRecap,
  InviteData,
  PhaseChangePayload,
  PlayerData,
  SyncPayload,
} from "../../../shared/socketContract";

export type AppStep = "loading" | "landing" | "avatar" | "home" | "game";
