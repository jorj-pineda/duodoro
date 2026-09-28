import { describe, expect, it } from 'vitest';
import { nextPhaseFor } from './phaseSequence.js';

describe('phase sequence', () => {
  it('finishes a pomodoro cycle in the same room without scheduling another focus', () => {
    const session = { mode: 'pomodoro', phase: 'focus', breakDuration: 5 * 60 };
    const steps = [];
    for (let i = 0; i < 4; i++) {
      const next = nextPhaseFor(session);
      steps.push(next);
      session.phase = next.phase;
    }
    expect(steps).toEqual([
      { phase: 'celebration', delay: 4000 },
      { phase: 'break', delay: 5 * 60 * 1000 },
      { phase: 'returning', delay: 3500 },
      { phase: 'ready', delay: null },
    ]);
    expect(nextPhaseFor(session)).toBeNull();
  });

  it('keeps flow focus open-ended after the break', () => {
    expect(nextPhaseFor({ mode: 'flow', phase: 'returning' })).toEqual({
      phase: 'focus', delay: null,
    });
  });
});
