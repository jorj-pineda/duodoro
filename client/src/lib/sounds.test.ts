import { describe, it, expect, vi, beforeEach } from "vitest";

// jsdom's HTMLAudioElement has no working play(), so stand in a fake that just
// records what was asked of it.
class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  currentTime = 0;
  volume = 1;
  playCalls = 0;
  pauseCalls = 0;

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
  play() {
    this.playCalls++;
    return Promise.resolve();
  }
  pause() {
    this.pauseCalls++;
  }
}

// This jsdom setup exposes no global localStorage, so stand one in. (The app
// survives its absence — every access is inside a try/catch — but these tests
// are specifically about what gets persisted.)
function fakeStorage(seed?: Record<string, string>) {
  const map = new Map(Object.entries(seed ?? {}));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

let store: Storage;

// Fresh module state per test: `muted` is initialised at import time from
// localStorage, which is exactly the behaviour worth testing.
async function loadSounds(stored?: string) {
  vi.resetModules();
  store = fakeStorage(stored === undefined ? {} : { "duodoro-muted": stored });
  vi.stubGlobal("localStorage", store);
  FakeAudio.instances = [];
  vi.stubGlobal("Audio", FakeAudio);
  return import("./sounds");
}

describe("sound mute", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("plays by default", async () => {
    const { playSound } = await loadSounds();
    playSound("click");
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].playCalls).toBe(1);
  });

  it("plays nothing at all while muted", async () => {
    const { playSound, setMuted } = await loadSounds();
    setMuted(true);
    playSound("victory");
    playSound("click");
    playSound("break-finished");
    // Not merely silenced — no element is even constructed.
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("plays and caches the break-finished asset and stops it on mute", async () => {
    const { playSound, setMuted } = await loadSounds();
    playSound("break-finished");
    const clip = FakeAudio.instances[0];
    expect(clip.src).toBe("/sounds/break-finished.wav");
    expect(clip.volume).toBe(0.65);
    clip.currentTime = 0.5;
    playSound("break-finished");
    expect(FakeAudio.instances).toHaveLength(1);
    expect(clip.currentTime).toBe(0);
    expect(clip.playCalls).toBe(2);
    setMuted(true);
    expect(clip.pauseCalls).toBe(1);
    playSound("break-finished");
    expect(clip.playCalls).toBe(2);
  });

  it("resumes playing after unmuting", async () => {
    const { playSound, setMuted } = await loadSounds();
    setMuted(true);
    playSound("click");
    setMuted(false);
    playSound("click");
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].playCalls).toBe(1);
  });

  it("stops a clip that is already playing", async () => {
    const { playSound, setMuted } = await loadSounds();
    playSound("victory");
    const clip = FakeAudio.instances[0];
    expect(clip.pauseCalls).toBe(0);
    // Muting during the victory jingle should cut it, not wait it out.
    setMuted(true);
    expect(clip.pauseCalls).toBe(1);
  });

  it("remembers the choice across a reload", async () => {
    const first = await loadSounds();
    first.setMuted(true);
    expect(store.getItem("duodoro-muted")).toBe("true");

    // Re-import with storage intact, standing in for the next page load.
    const second = await loadSounds("true");
    expect(second.isMuted()).toBe(true);
    second.playSound("click");
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("defaults to audible when storage is unreadable", async () => {
    const { isMuted } = await loadSounds("not-a-boolean");
    expect(isMuted()).toBe(false);
  });

  it("notifies subscribers so every toggle in the UI stays in sync", async () => {
    const { setMuted, subscribeMuted, isMuted } = await loadSounds();
    const seen: boolean[] = [];
    const unsubscribe = subscribeMuted(() => seen.push(isMuted()));

    setMuted(true);
    setMuted(false);
    unsubscribe();
    setMuted(true);

    expect(seen).toEqual([true, false]);
  });
});
