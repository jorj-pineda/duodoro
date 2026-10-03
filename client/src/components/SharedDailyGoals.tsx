"use client";
import { useState } from "react";
import { DAILY_GOALS } from "@/hooks/useDailyFocusGoal";
import { useSharedDailyGoals, type SharedDailyGoal } from "@/hooks/useSharedDailyGoals";
import { formatDuration } from "@/lib/format";
import type { Profile } from "@/lib/types";

const control = "bg-raise border border-line rounded px-3 py-2 text-xs text-ink min-h-10 disabled:opacity-50";
function TargetOptions() {
  return DAILY_GOALS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes combined</option>);
}

function GoalCard({ goal, userId, actions }: {
  goal: SharedDailyGoal;
  userId: string;
  actions: ReturnType<typeof useSharedDailyGoals>;
}) {
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState(goal.target_minutes);
  const mine = goal.created_by === userId;
  const seconds = Number(goal.my_seconds ?? 0) + Number(goal.partner_seconds ?? 0);
  const progress = Math.min(100, Math.max(0, Math.round(seconds / (goal.target_minutes * 60) * 100)));
  return (
    <article aria-label={`Shared goal with ${goal.partner_name}`} className="border border-line rounded-lg p-3 space-y-2">
      <h3 className="text-sm font-semibold text-ink break-words">You + {goal.partner_name}</h3>
      {goal.accepted ? (
        <>
          <p role="status" className="text-sm text-ink">{formatDuration(seconds)} / {formatDuration(goal.target_minutes * 60)} {actions.loadError ? "last loaded" : "today"}{seconds >= goal.target_minutes * 60 ? " · Goal reached!" : ""}</p>
          <div role="progressbar" aria-label={`Shared focus with ${goal.partner_name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}
            aria-valuetext={`${formatDuration(seconds)} of ${formatDuration(goal.target_minutes * 60)}`} className="h-2 bg-raise rounded overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-muted break-words">You: {formatDuration(Number(goal.my_seconds))} · {goal.partner_name}: {formatDuration(Number(goal.partner_seconds))}</p>
          {editing ? (
            <form className="flex flex-wrap gap-2" onSubmit={async (event) => { event.preventDefault(); if (await actions.update(goal.id, target)) setEditing(false); }}>
              <label className="text-xs text-muted">Combined target
                <select aria-label="Edit shared target" disabled={actions.busy} value={target} onChange={(event) => setTarget(Number(event.target.value))} className={`${control} block mt-1`}><TargetOptions /></select>
              </label>
              <button className={control} disabled={actions.busy}>Save target</button>
              <button type="button" className={control} disabled={actions.busy} onClick={() => setEditing(false)}>Cancel</button>
            </form>
          ) : <button className={control} disabled={actions.busy} onClick={() => { setTarget(goal.target_minutes); setEditing(true); }}>Edit target</button>}
        </>
      ) : (
        <>
          <p className="text-xs text-muted">{goal.target_minutes} minutes combined each day. {mine ? "Waiting for your friend to accept." : "Accept to share today’s saved focus totals with this friend."}</p>
          {!mine && <button className={control} disabled={actions.busy} onClick={() => void actions.accept(goal.id)}>Accept goal</button>}
        </>
      )}
      <p className="text-[11px] text-faint break-words">Day: {goal.day}. Resets at midnight in {goal.timezone}. {goal.accepted && "Either person can edit the target."}</p>
      <button className={`${control} text-muted`} disabled={actions.busy} onClick={() => void actions.remove(goal.id)}>
        {goal.accepted ? "End shared goal" : mine ? "Cancel invitation" : "Decline goal"}
      </button>
    </article>
  );
}

export default function SharedDailyGoals({ userId, friends, friendsError, friendsLoaded, onOpenFriends }: {
  userId: string;
  friends: Profile[];
  friendsError: string | null;
  friendsLoaded: boolean;
  onOpenFriends: () => void;
}) {
  const actions = useSharedDailyGoals(userId);
  const [friendId, setFriendId] = useState("");
  const [target, setTarget] = useState(120);
  const available = friends.filter((friend) => !actions.goals?.some((goal) => goal.partner_id === friend.id));
  const selected = available.some((friend) => friend.id === friendId) ? friendId : available[0]?.id ?? "";
  return (
    <section aria-label="Shared daily goals" className="bg-surface border border-line rounded-xl p-4 space-y-3">
      <h2 className="text-sm font-semibold text-ink">Shared daily goals</h2>
      <p className="text-xs text-muted">Work toward a daily target with a friend, together or on your own. Saved, completed focus counts for each person: 25 minutes each adds 50 minutes.</p>
      {actions.loadError && <p role="alert" className="text-xs text-danger">{actions.loadError} <button className={control} onClick={() => void actions.refresh()}>Refresh shared goals</button></p>}
      {actions.actionError && <p role="alert" className="text-xs text-danger">{actions.actionError}</p>}
      {actions.goals === null ? (!actions.loadError && <p role="status" className="text-xs text-muted">Loading shared goals…</p>) : (
        <>
          {actions.goals.map((goal) => <GoalCard key={goal.id} goal={goal} userId={userId} actions={actions} />)}
          {friendsError ? <p className="text-xs text-muted">Friends are unavailable. Retry the friend list to invite someone.</p> : !friendsLoaded ? <p className="text-xs text-muted">Loading friends…</p> : available.length > 0 ? (
            <form className="space-y-2" onSubmit={async (event) => { event.preventDefault(); if (selected) await actions.create(selected, target); }}>
              <div className="flex flex-wrap gap-2">
                <label className="text-xs text-muted min-w-0">Friend
                  <select aria-label="Shared goal friend" disabled={actions.busy} value={selected} onChange={(event) => setFriendId(event.target.value)} className={`${control} block mt-1 max-w-full`}>
                    {available.map((friend) => <option key={friend.id} value={friend.id}>{friend.display_name ?? friend.username ?? "Friend"}</option>)}
                  </select>
                </label>
                <label className="text-xs text-muted">Combined target
                  <select aria-label="Shared daily target" disabled={actions.busy} value={target} onChange={(event) => setTarget(Number(event.target.value))} className={`${control} block mt-1`}><TargetOptions /></select>
                </label>
              </div>
              <button className={control} disabled={actions.busy || Boolean(actions.loadError)}>Invite to daily goal</button>
              <p className="text-[11px] text-faint">Uses your timezone for both people’s daily reset. Daily totals are shared after your friend accepts.</p>
            </form>
          ) : friends.length === 0 ? <button className={control} onClick={onOpenFriends}>Add a friend to share a goal</button> : null}
        </>
      )}
    </section>
  );
}
