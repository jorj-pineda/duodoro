"use client";
import { useRef, useState, type RefObject } from 'react';
import { useBreakCheckIns } from '@/hooks/useBreakCheckIns';

type Energy = 'Low' | 'Steady' | 'High';
type Mode = 'pomodoro' | 'flow';
const suggestions: Record<Energy, string> = {
  Low: "It's okay to finish for now or keep resting. Use Stop timer for more time, or Leave room to finish.",
  Steady: 'Take the rest of this break, then consider whether another round feels right.',
  High: 'Enjoy the break. If you still feel ready afterward, consider another round.',
};
const button = 'min-h-11 rounded border border-line bg-surface px-2 text-xs text-ink';

function EnergyPrompt({ mode, firstRef, onSkip, onDisable }: {
  mode: Mode; firstRef: RefObject<HTMLButtonElement | null>; onSkip: () => void; onDisable: () => void;
}) {
  // No storage, API or socket write. Hiding or disabling unmounts the answer,
  // including when another tab changes the preference.
  const [energy, setEnergy] = useState<Energy | null>(null);
  return <>
    <div role="group" aria-label="How is your energy?" className="space-y-2">
      <p className="text-xs font-semibold">How is your energy?</p>
      <div className="grid grid-cols-3 gap-2">
        {(['Low', 'Steady', 'High'] as const).map(value => <button key={value} type="button" ref={value === 'Low' ? firstRef : undefined}
          aria-pressed={energy === value} className={`${button} ${energy === value ? 'border-ink font-bold' : ''}`}
          onClick={() => setEnergy(value)}>{value}</button>)}
      </div>
    </div>
    {energy && <p role="status" className="text-xs">{suggestions[energy]}</p>}
    <p className="text-xs text-muted">{mode === 'flow'
      ? 'Flow resumes automatically after this break. Stop timer stops the room’s timer for everyone.'
      : 'Pomodoro waits for Go again after this break. Stop timer stops the room’s timer for everyone.'}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} onClick={onSkip}>Skip this break</button>
      <button type="button" className={button} onClick={onDisable}>Turn off check-ins</button>
    </div>
  </>;
}

export default function BreakCheckIn({ userId, breakId, mode }: {
  userId: string; breakId: string; mode: Mode;
}) {
  const { enabled, dismissed, enable, disable, dismiss } = useBreakCheckIns(userId, breakId);
  const [message, setMessage] = useState('');
  const firstRef = useRef<HTMLButtonElement>(null);
  const enableRef = useRef<HTMLButtonElement>(null);
  const returnFocus = () => requestAnimationFrame(() => enableRef.current?.focus());
  return <section aria-label="Private break check-in" className="w-full max-w-xs border border-line bg-surface p-3 space-y-2 text-ink">
    <h2 className="text-sm font-bold">Optional break check-in</h2>
    <p className="text-xs text-muted">Just for you. Answers are not saved or shared.</p>
    {enabled && !dismissed ? <EnergyPrompt key={`${userId}:${breakId}`} mode={mode} firstRef={firstRef}
      onSkip={() => { dismiss(); returnFocus(); }}
      onDisable={() => { disable(); setMessage(''); returnFocus(); }} /> : <>
      <p className="text-xs text-muted">{enabled && dismissed ? 'Skipped for this break.' : 'A quick energy check, if you feel like it.'}</p>
      <button type="button" ref={enableRef} className={button} onClick={() => {
        setMessage(enable() ? '' : 'Enabled for this tab; browser storage is unavailable.');
        requestAnimationFrame(() => firstRef.current?.focus());
      }}>{enabled ? 'Show this check-in' : 'Enable break check-ins'}</button>
    </>}
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
