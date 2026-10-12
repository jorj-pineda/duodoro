"use client";
import { useModalAccessibility } from '@/hooks/useModalAccessibility';
import { useRecapProgress } from '@/hooks/useRecapProgress';
import { focusLabel } from '@/lib/focusCalendar';
import { unfinishedIntentions } from '@/lib/sessionWrapUp';
import type { RoundRecap, SessionIntentions } from '@/lib/sessionTypes';

export default function SessionWrapUp({ userId, phase, completedRounds, intentions, recap, saveStatus, draftOpen, onClose, onLeave }: {
  userId: string; phase: string; completedRounds: number; intentions: SessionIntentions; recap: RoundRecap | null;
  saveStatus: string; draftOpen: boolean; onClose: () => void; onLeave: () => void;
}) {
  const ref = useModalAccessibility<HTMLDivElement>(true, onClose);
  const { seconds, error, retry } = useRecapProgress(userId, completedRounds, recap?.saveState ?? saveStatus);
  const remaining = unfinishedIntentions(userId, phase, intentions, recap);
  const saving = saveStatus !== 'clear' || (recap && recap.saveState !== 'saved');
  return <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4">
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="wrap-up-title" tabIndex={-1}
      className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-line bg-surface p-5 text-ink space-y-4">
      <h2 id="wrap-up-title" className="font-display text-lg">Done for today?</h2>
      <p className="text-xs text-muted">Private summary · Opening this view doesn’t complete goals or intentions.</p>
      <dl className="grid grid-cols-2 gap-3">
        <div><dt className="text-xs text-muted">Room rounds completed</dt><dd className="font-mono font-bold">{completedRounds}</dd></div>
        <div><dt className="text-xs text-muted">Your saved focus today</dt><dd className="font-mono font-bold">
          {error ? <button className="min-h-11 text-sm underline" onClick={retry}>Retry today’s focus</button> : seconds === null ? 'Loading…' : focusLabel(seconds)}
        </dd></div>
      </dl>
      {error && <p role="alert" className="text-xs">Today’s focus is unavailable. Your history has not been changed.</p>}
      {saving && <p role="status" className="text-xs">Some focus is still saving or unconfirmed. Today’s total includes only confirmed, completed records.</p>}
      <section aria-label="Your unfinished room intentions" className="space-y-2">
        <h3 className="text-sm font-bold">Your unfinished room intentions</h3>
        <p className="text-xs text-muted">Current focus, latest recap and next plan. Earlier room intentions aren’t kept here.</p>
        {remaining.length ? <ul className="list-disc pl-5 text-sm space-y-1">{remaining.map(text => <li key={text} className="break-words whitespace-pre-wrap">{text}</li>)}</ul>
          : <p className="text-xs text-muted">No unfinished intention text in the current room state.</p>}
      </section>
      {remaining.length > 0 && <p className="text-xs text-muted">Room intentions are temporary. Copy any text you want to keep before leaving.</p>}
      {phase === 'focus' && <p className="text-xs">A focus round is still running. Leaving ends your participation.</p>}
      {draftOpen && <p role="alert" className="text-xs">An intention draft is open. Return to the room to save or cancel it before leaving.</p>}
      <div className="flex flex-wrap gap-2">
        <button data-autofocus className="min-h-11 px-3 rounded border border-line text-sm" onClick={onClose}>Return to room</button>
        <button disabled={draftOpen} className="min-h-11 px-3 rounded border border-line text-sm disabled:opacity-50" onClick={onLeave}>Finish and leave room</button>
      </div>
    </div>
  </div>;
}
