const CELEBRATION_MS = 4000;
const RETURNING_MS = 3500;

function nextPhaseFor(session) {
  switch (session.phase) {
    case 'focus':
      return { phase: 'celebration', delay: CELEBRATION_MS };
    case 'celebration':
      return { phase: 'break', delay: session.breakDuration * 1000 };
    case 'break':
      return { phase: 'returning', delay: RETURNING_MS };
    case 'returning':
      return session.mode === 'pomodoro'
        ? { phase: 'ready', delay: null }
        : { phase: 'focus', delay: null };
    default:
      return null;
  }
}

module.exports = { nextPhaseFor };
