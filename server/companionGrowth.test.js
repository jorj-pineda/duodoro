import { describe, expect, it, vi } from 'vitest';
import { createCompanionGrowth } from './companionGrowth.js';
function setup(totalFocusSeconds) {
  const players = {
    a: { userId: 'alice', pet: 'cat', petStage: 'young', focusSeconds: 10700 },
    b: { userId: 'bob', pet: 'dog', petStage: 'full', focusSeconds: 54000 },
  };
  const emitted = [];
  const io = { to: (target) => ({ emit: (event, payload) => emitted.push({ target, event, payload }) }) };
  const sessions = { room: { players, focusRoundId: 'a-newer-round' } };
  return { players, sessions, emitted, growth: createCompanionGrowth({ sessions, io, totalFocusSeconds }) };
}
describe('confirmed companion growth', () => {
  it('publishes private progress and public growth after an older queued round saves', async () => {
    const { growth, players, emitted } = setup(vi.fn(async () => 10900));
    await growth.refresh(['alice'], { celebrate: true });
    expect(players.a.petStage).toBe('grown');
    expect(emitted).toEqual([
      { target: 'room', event: 'pet_changed', payload: { playerId: 'a', pet: 'cat', petStage: 'grown' } },
      { target: 'a', event: 'companion_progress', payload: { sessionId: 'room', focusSeconds: 10900, grewTo: 'grown' } },
    ]);
    await growth.refresh(['alice'], { celebrate: true });
    expect(players.a.focusSeconds).toBe(10900);
    expect(emitted.at(-1).payload.grewTo).toBeNull();
    expect(emitted.filter((e) => e.event === 'pet_changed')).toHaveLength(1);
  });
  it('preserves veteran art and reports unavailable progress on failure', async () => {
    const { growth, players, emitted } = setup(vi.fn(async () => null));
    await growth.refresh(['bob']);
    expect(players.b.petStage).toBe('full');
    expect(emitted).toEqual([{ target: 'b', event: 'companion_progress', payload: { sessionId: 'room', focusSeconds: null, grewTo: null } }]);
  });
  it('does not double-count history already loaded during a reconnect', async () => {
    const { growth, players } = setup(vi.fn(async () => 10900));
    players.a.focusSeconds = 10900;
    players.a.petStage = 'grown';
    await growth.refresh(['alice'], { celebrate: true });
    expect(players.a.focusSeconds).toBe(10900);
  });
  it('ignores out-of-order reads and deleted rooms', async () => {
    let resolve;
    const read = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValue(10900);
    const { growth, players, sessions, emitted } = setup(read);
    const old = growth.refresh(['alice']);
    await growth.refresh(['alice']);
    resolve(10700);
    await old;
    expect(players.a.focusSeconds).toBe(10900);
    expect(emitted).toHaveLength(2);
    delete sessions.room;
    await growth.refresh(['alice']);
    expect(emitted).toHaveLength(2);
  });
  it('does not celebrate snapshots, missing totals, or users without a companion', async () => {
    const { growth, players, emitted } = setup(vi.fn(async () => 54000));
    players.a.focusSeconds = null;
    await growth.refresh(['alice']);
    expect(emitted.at(-1).payload.grewTo).toBeNull();
    players.a.pet = null;
    await growth.refresh(['alice'], { celebrate: true });
    expect(emitted.at(-1).payload.grewTo).toBeNull();
  });
});
