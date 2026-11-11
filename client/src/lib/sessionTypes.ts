export type {
  BreakExtensionState,
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

export type AppStep = "loading" | "unavailable" | "landing" | "avatar" | "home" | "game";
