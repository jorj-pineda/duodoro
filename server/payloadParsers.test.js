import { describe, expect, it } from 'vitest';
import {
  MAX_BREAK,
  MAX_FOCUS,
  parseCreateSession,
  parseDeleteAccount,
  parseJoinSession,
  parseOnlineFriends,
  parseSendInvite,
  parseSessionReference,
  parseSetPet,
  parseShareInvite,
  parseStartSession,
} from './payloadParsers.js';

const AVATAR = {
  skinColor: '#F1C27D',
  hairStyle: 'bob',
  hairColor: '#3B2314',
  eyeStyle: 'normal',
  outfitColor: '#4A6FA5',
};

describe('account and social payload parsers', () => {
  it('requires the exact account-deletion phrase', () => {
    expect(parseDeleteAccount({ confirmation: 'DELETE' })).toEqual({
      ok: true,
      value: { confirmation: 'DELETE' },
    });
    expect(parseDeleteAccount({ confirmation: 'delete' })).toEqual({
      ok: false,
      reason: 'confirmation',
    });
  });

  it('bounds online-friend lookups to 100 string ids', () => {
    expect(parseOnlineFriends({ friendIds: ['a', 'b'] })).toEqual({
      ok: true,
      value: { friendIds: ['a', 'b'] },
    });
    expect(parseOnlineFriends({ friendIds: 'a' }).ok).toBe(false);
    expect(parseOnlineFriends({ friendIds: [null] }).ok).toBe(false);
    expect(parseOnlineFriends({ friendIds: Array(101).fill('a') }).ok).toBe(false);
  });

  it('requires an invite target and normalizes untrusted presentation fields', () => {
    expect(parseSendInvite({ targetUserId: '' }).ok).toBe(false);
    expect(parseSendInvite({
      targetUserId: 'friend',
      sessionId: 42,
      fromName: 42,
    })).toEqual({
      ok: true,
      value: {
        targetUserId: 'friend',
        sessionId: null,
        fromName: 'Someone',
      },
    });
  });
});

describe('session entry payload parsers', () => {
  it('sanitizes create-session identity fields and ignores unknown fields', () => {
    expect(parseCreateSession({
      avatar: AVATAR,
      displayName: 'x'.repeat(60),
      pet: 'griffin',
      world: 'space',
      petStage: 'full',
    })).toEqual({
      ok: true,
      value: {
        avatar: AVATAR,
        displayName: 'x'.repeat(50),
        pet: null,
        petName: null,
      },
    });
  });

  it.each([
    null,
    [],
    { ...AVATAR, skinColor: 'red' },
    { ...AVATAR, hairStyle: 'unknown' },
  ])('rejects invalid avatar %#', (avatar) => {
    expect(parseCreateSession({ avatar })).toEqual({
      ok: false,
      reason: 'avatar',
    });
  });

  it('accepts either a session id or a bounded bearer token when joining', () => {
    expect(parseJoinSession({ sessionId: 'room', avatar: AVATAR })).toEqual({
      ok: true,
      value: {
        sessionId: 'room',
        shareToken: null,
        joiningByLink: false,
        avatar: AVATAR,
        displayName: 'Player',
        pet: null,
        petName: null,
      },
    });
    expect(parseJoinSession({
      sessionId: 'ignored',
      shareToken: 'a'.repeat(20),
      avatar: AVATAR,
    }).value).toMatchObject({
      sessionId: null,
      shareToken: 'a'.repeat(20),
      joiningByLink: true,
    });
    expect(parseJoinSession({ shareToken: 'short', avatar: AVATAR })).toEqual({
      ok: false,
      reason: 'share_token',
    });
    expect(parseJoinSession({ avatar: AVATAR })).toEqual({
      ok: false,
      reason: 'session_id',
    });
  });

  it('requires a string session id for share invites', () => {
    expect(parseShareInvite({ sessionId: 'room' }).ok).toBe(true);
    expect(parseShareInvite({ sessionId: null })).toEqual({
      ok: false,
      reason: 'session_id',
    });
  });
});

describe('live-session payload parsers', () => {
  it('defaults and clamps timer settings at the protocol boundary', () => {
    expect(parseStartSession({ sessionId: 'room' }).value).toEqual({
      sessionId: 'room',
      focusDuration: 25 * 60,
      breakDuration: 5 * 60,
      mode: 'pomodoro',
    });
    expect(parseStartSession({
      sessionId: 'room',
      focusDuration: Infinity,
      breakDuration: -1,
      mode: 'flow',
    }).value).toEqual({
      sessionId: 'room',
      focusDuration: MAX_FOCUS,
      breakDuration: 30,
      mode: 'flow',
    });
  });

  it('parses session-only events without accepting coerced ids', () => {
    expect(parseSessionReference({ sessionId: 'room' }).ok).toBe(true);
    expect(parseSessionReference({ sessionId: 42 }).ok).toBe(false);
  });

  it('allowlists pets and treats an unknown pet as no pet', () => {
    expect(parseSetPet({ sessionId: 'room', pet: 'cat' }).value)
      .toEqual({ sessionId: 'room', pet: 'cat', petName: 'Mochi' });
    expect(parseSetPet({ sessionId: 'room', pet: 'griffin' }).value)
      .toEqual({ sessionId: 'room', pet: null, petName: null });
  });
});
