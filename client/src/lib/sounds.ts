// ─────────────────────────────────────────────────────────────────────────────
// Sound Manager
//
// DROP your audio files into:  client/public/sounds/
//
// Expected files (see FILES below for the exact name each key maps to):
//   victory.mp3       — celebration jingle (played when focus session ends)
//   break-start.mp3   — short chime for break start
//   break-finished.wav — short chime when the break ends
//   session-start.mp3 — short chime for focus start
//   click.wav         — UI click feedback
//
// Files are loaded on first play and cached. Missing files are silently ignored.
//
// To swap any of these for your own, drop the file in and update FILES —
// the extension is explicit precisely so formats can be mixed.
// ─────────────────────────────────────────────────────────────────────────────

type SoundName = 'victory' | 'break-start' | 'session-start' | 'break-finished' | 'click';

const FILES: Record<SoundName, string> = {
  victory: 'victory.mp3',
  'break-start': 'break-start.mp3',
  'break-finished': 'break-finished.wav',
  'session-start': 'session-start.mp3',
  click: 'click.wav',
};

// Clicks fire constantly; at full volume the tick gets tiring fast.
const DEFAULT_VOLUME: Partial<Record<SoundName, number>> = { click: 0.25, 'break-finished': 0.65 };

const cache: Partial<Record<SoundName, HTMLAudioElement>> = {};

// ── Mute ─────────────────────────────────────────────────────────────────────
// One module-level flag rather than a React context: playSound is called from
// useGameSession's socket handlers, which aren't inside a provider and can fire
// while nothing is mounted. Kept in sync across every toggle instance by the
// listener set below, which useSound subscribes to.

const MUTE_KEY = "duodoro-muted";

let muted = readStoredMute();
const listeners = new Set<() => void>();

function readStoredMute(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "true";
  } catch {
    // SSR, or localStorage blocked in private mode — default to audible.
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, String(next));
  } catch {
    // Unavailable — the choice still holds for this page's lifetime.
  }
  // Stop whatever is already playing, or muting mid-jingle does nothing until
  // the current clip finishes.
  if (next) {
    for (const audio of Object.values(cache)) {
      audio?.pause();
    }
  }
  listeners.forEach((fn) => fn());
}

export function subscribeMuted(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function playSound(name: SoundName, volume?: number): void {
  if (muted) return;
  try {
    if (!cache[name]) {
      cache[name] = new Audio(`/sounds/${FILES[name]}`);
    }
    const audio = cache[name]!;
    audio.currentTime = 0;
    audio.volume = volume ?? DEFAULT_VOLUME[name] ?? 0.8;
    audio.play().catch(() => {
      // File missing or autoplay blocked — silently skip
    });
  } catch {
    // DOM not available (SSR) or other error — silently skip
  }
}
