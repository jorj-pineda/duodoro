import { formatDuration } from "./format";
export interface SharedFocus { partnerId: string; partnerName: string; seconds: number; rounds: number }
export interface SharedMilestone { id: string; metric: "rounds" | "seconds"; target: number; label: string }
export const SHARED_MILESTONES: readonly SharedMilestone[] = [
  ...[1, 10, 25, 50, 100].map(rounds => ({ id: `rounds:${rounds}`, metric: "rounds" as const, target: rounds, label: rounds === 1 ? "First shared round" : `${rounds} rounds together` })),
  ...[1, 10, 25, 50].map(hours => ({ id: `hours:${hours}`, metric: "seconds" as const, target: hours * 3600, label: hours === 1 ? "First shared hour" : `${hours} hours together` })),
];
export function sharedMilestones(total: Pick<SharedFocus, "seconds" | "rounds">) {
  return {
    achieved: SHARED_MILESTONES.filter(milestone => total[milestone.metric] >= milestone.target),
    nextRounds: SHARED_MILESTONES.find(milestone => milestone.metric === "rounds" && total.rounds < milestone.target),
    nextHours: SHARED_MILESTONES.find(milestone => milestone.metric === "seconds" && total.seconds < milestone.target),
  };
}
export function sharedFocusLabel(seconds: number): string {
  return seconds < 60 ? `${Math.floor(seconds)}s` : formatDuration(seconds);
}
