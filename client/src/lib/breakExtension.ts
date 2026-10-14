import type { BreakExtensionState } from "@/lib/sessionTypes";

export function readBreakExtension(value: unknown): BreakExtensionState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as BreakExtensionState;
  if (!Array.isArray(state.eligibleUserIds) || ![0, 2].includes(state.eligibleUserIds.length) ||
    state.eligibleUserIds.some(id => typeof id !== "string" || !id) || new Set(state.eligibleUserIds).size !== state.eligibleUserIds.length ||
    !["available", "pending", "accepted", "declined"].includes(state.status) ||
    state.extraSeconds !== (state.status === "accepted" ? 120 : 0)) return null;
  if (state.status === "available") {
    if (state.proposalId !== null || state.requesterId !== null) return null;
  } else if (state.eligibleUserIds.length !== 2 || typeof state.proposalId !== "string" || state.proposalId.length !== 36 || !state.eligibleUserIds.includes(state.requesterId ?? "")) return null;
  return state;
}
