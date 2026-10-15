"use client";
import { useRef, useState, type FormEvent } from "react";
import { useFocusDates } from "@/hooks/useFocusDates";
import { formatFocusDateTime, parseFocusDateTime } from "@/lib/focusDates";
import type { Profile } from "@/lib/types";
import FocusDateCalendar from "./FocusDateCalendar";
const control = "min-h-11 max-w-full min-w-0 rounded-lg border border-line bg-raise px-3 py-2 text-xs text-ink disabled:opacity-50";

type Props = { userId: string; friends: Profile[]; friendsLoaded: boolean; friendsError: string | null; onOpenFriends: () => void };
export default function SharedFocusDates(props: Props) {
  return <FocusDates key={props.userId} {...props} />;
}
function FocusDates({ userId, friends, friendsLoaded, friendsError, onOpenFriends }: Props) {
  const actions = useFocusDates(userId);
  const stale = !!(actions.loadError || actions.actionError);
  const [open, setOpen] = useState(false);
  const [friendId, setFriendId] = useState("");
  const [time, setTime] = useState("");
  const [notice, setNotice] = useState("");
  const [validation, setValidation] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null);
  const selected = friends.some(friend => friend.id === friendId) ? friendId : friends[0]?.id ?? "";
  const parsed = parseFocusDateTime(time);
  const friendName = (id: string) => {
    const friend = friends.find(row => row.id === id);
    return friend?.display_name ?? friend?.username ?? "Friend";
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice("");
    // Read the clock only on explicit submit, never during rendering.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    if (!parsed || Date.parse(parsed) <= now || Date.parse(parsed) > now + 90 * 86_400_000) {
      setValidation("Choose a valid future local time within 90 days."); return;
    }
    setValidation(""); const key = `${selected}:${parsed}`;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    if (await actions.propose(request.current.id, selected, parsed)) {
      request.current = null; setOpen(false); setTime(""); setNotice("Focus date request confirmed. Check its status above.");
    }
  }
  return <section aria-label="Shared focus dates" className="bg-surface border border-line rounded-xl p-4 space-y-3">
    <h2 className="text-sm font-semibold text-ink">Shared focus dates</h2>
    <p className="text-xs text-muted">Make time to focus together. Only you and your invited friend can see a date. Times are shown in your local timezone.</p>
    <p className="text-[11px] text-faint">Dates don&apos;t start sessions or send reminders. Open Duodoro when it&apos;s time to focus.</p>
    {(actions.loadError || actions.actionError) && <p role="alert" className="text-xs text-danger">{actions.loadError ?? actions.actionError}</p>}
    <button className={control} disabled={actions.busy} onClick={() => { setNotice(""); void actions.reload(); }}>Reload focus dates</button>
    {actions.dates === null ? !actions.loadError && <p role="status" className="text-xs text-muted">Loading focus dates…</p> : <>
      {!actions.dates.length && <p className="text-xs text-muted">{stale ? "No dates in the last loaded list." : "No upcoming focus dates."}</p>}
      {stale && <p className="text-xs text-muted">Showing the last loaded dates.</p>}
      {actions.dates.map(date => {
        const mine = date.proposer_id === userId;
        const partner = mine ? date.recipient_id : date.proposer_id;
        return <article key={date.id} aria-label={`Focus date with ${friendName(partner)}`} className="border border-line rounded-lg p-3 space-y-2">
          <h3 className="text-sm font-semibold text-ink break-words">You + {friendName(partner)}</h3>
          <p className="text-xs text-ink break-words"><time dateTime={date.starts_at}>{formatFocusDateTime(date.starts_at)}</time></p>
          <p className="text-xs text-muted">{date.status === "accepted" ? "Accepted by both of you" : mine ? "Waiting for your friend to accept" : "Your friend proposed this time"}</p>
          <div className="flex flex-wrap gap-2">
            {!mine && date.status === "pending" && <>
              <button className={control} disabled={actions.disabled || !!friendsError || !friendsLoaded || !friends.some(row => row.id === partner)} onClick={async () => { setNotice(""); if (await actions.respond(date, "accepted")) setNotice("Focus date accepted."); }}>Accept date</button>
              <button className={control} disabled={actions.disabled} onClick={async () => { setNotice(""); if (await actions.respond(date, "declined")) setNotice("Focus date declined."); }}>Decline date</button>
            </>}
            {(mine || date.status === "accepted") && <button className={control} disabled={actions.disabled} onClick={async () => { setNotice(""); if (await actions.respond(date, "cancelled")) setNotice("Focus date cancelled."); }}>Cancel date</button>}
          </div>
          {date.status === "accepted" && <FocusDateCalendar key={`${date.id}:${date.version}`} date={date} userId={userId} disabled={actions.disabled} />}
        </article>;
      })}
    </>}
    {notice && !actions.actionError && !actions.loadError && <p role="status" className="text-xs text-accent">{notice}</p>}
    {friendsError ? <p className="text-xs text-muted">Friends are unavailable. Retry the friend list before proposing a date.</p>
      : !friendsLoaded ? <p className="text-xs text-muted">Loading friends…</p>
      : !friends.length ? <button className={control} onClick={onOpenFriends}>Add a friend to plan a focus date</button>
      : <>
        <button className={control} aria-expanded={open} onClick={() => { setOpen(value => !value); setValidation(""); }}>Propose a focus date</button>
        {open && <form className="space-y-3" onSubmit={submit}>
          <label className="block text-xs text-muted">Focus date friend
            <select className={`${control} block w-full mt-1`} value={selected} disabled={actions.busy} onChange={event => { setFriendId(event.target.value); setNotice(""); }}>
              {friends.map(friend => <option key={friend.id} value={friend.id}>{friendName(friend.id)}</option>)}
            </select>
          </label>
          <label className="block text-xs text-muted">Your local date and time
            <input required type="datetime-local" className={`${control} block w-full mt-1`} value={time} disabled={actions.busy} onChange={event => { setTime(event.target.value); setValidation(""); setNotice(""); }} />
          </label>
          {parsed && <p className="text-xs text-ink break-words">Propose: {formatFocusDateTime(parsed)}</p>}
          <p className="text-[11px] text-faint">Choose a time within 90 days. Your friend must accept; changing the time means cancelling and proposing again.</p>
          {validation && <p role="alert" className="text-xs text-danger">{validation}</p>}
          <button className={control} disabled={actions.disabled || actions.dates!.length >= 10 || !selected || !parsed}>Send date proposal</button>
        </form>}
      </>}
  </section>;
}
