import { describe, it, expect } from "vitest";
import {
  createSessionState,
  SHARE_INVITE_TTL_MS,
  createShareInvite,
  hasValidShareInvite,
  findSessionByShareInvite,
  consumeShareInvite,
  beginFocusRound,
  completeFocusRound,
  updateRoundRecap,
  addPlayer,
  removePlayer,
  setPlayerPet,
  creditFocus,
  creditFocusRound,
  findPlayerByUserId,
  reservePlayerSlot,
  releasePlayerSlot,
  hasOpenPlayerSlot,
  markPlayerDisconnected,
  inviteUser,
  isInvited,
  sessionParticipantIds,
  findUserSessions,
  buildSyncPayload,
} from "./session.js";

describe("createSessionState", () => {
  it("creates a session with default values", () => {
    const s = createSessionState("forest", "socket-1");
    expect(s.id).toBeTruthy();
    expect(s.phase).toBe("waiting");
    expect(s.focusDuration).toBe(25 * 60);
    expect(s.breakDuration).toBe(5 * 60);
    expect(s.world).toBe("forest");
    expect(s.hostId).toBe("socket-1");
    expect(Object.keys(s.players)).toHaveLength(0);
  });

  it("defaults world to forest when not provided", () => {
    const s = createSessionState(null, "socket-1");
    expect(s.world).toBe("forest");
  });

  it("generates unique session IDs", () => {
    const a = createSessionState("space", "s1");
    const b = createSessionState("space", "s2");
    expect(a.id).not.toBe(b.id);
  });
});

describe("focus round identity", () => {
  it("creates one stable private key when a focus round begins", () => {
    const s = createSessionState("forest", "host");

    expect(beginFocusRound(s, 1234, "round-1")).toBe("round-1");
    expect(s.phase).toBe("focus");
    expect(s.phaseStartTime).toBe(1234);
    expect(s.focusRoundId).toBe("round-1");
    expect(buildSyncPayload(s)).not.toHaveProperty("focusRoundId");
    expect(buildSyncPayload(s)).not.toHaveProperty("creditedFocusRoundIds");
  });

  it("uses a new key for the next focus round", () => {
    const s = createSessionState("forest", "host");
    const first = beginFocusRound(s);
    const second = beginFocusRound(s);

    expect(first).not.toBe(second);
    expect(s.focusRoundId).toBe(second);
  });
});

describe("addPlayer / removePlayer", () => {
  it("adds a player and returns the count", () => {
    const s = createSessionState("forest", "host");
    const count = addPlayer(s, "player-1", {
      avatar: { skin: "#fff" },
      displayName: "Alice",
      userId: "uid-1",
    });
    expect(count).toBe(1);
    expect(s.players["player-1"].displayName).toBe("Alice");
    expect(s.players["player-1"].userId).toBe("uid-1");
  });

  it("defaults displayName to Player", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", { avatar: {}, displayName: "", userId: null });
    expect(s.players["p1"].displayName).toBe("Player");
  });

  it("removes a player and returns the count", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", { avatar: {}, displayName: "A", userId: "u1" });
    addPlayer(s, "p2", { avatar: {}, displayName: "B", userId: "u2" });
    expect(Object.keys(s.players)).toHaveLength(2);

    const remaining = removePlayer(s, "p1");
    expect(remaining).toBe(1);
    expect(s.players["p1"]).toBeUndefined();
    expect(s.players["p2"]).toBeDefined();
  });
});

describe("buildSyncPayload", () => {
  it("builds correct sync payload", () => {
    const s = createSessionState("beach", "host");
    addPlayer(s, "p1", { avatar: { skin: "#aaa" }, displayName: "Test", userId: "u1" });

    const payload = buildSyncPayload(s);
    expect(payload.phase).toBe("waiting");
    expect(payload.world).toBe("beach");
    expect(payload.playerCount).toBe(1);
    expect(payload.sessionId).toBe(s.id);
    expect(payload.players["p1"].displayName).toBe("Test");
  });
});

describe("sessionParticipantIds", () => {
  it("collects the authenticated userIds in the session", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", { avatar: {}, displayName: "A", userId: "u1" });
    addPlayer(s, "p2", { avatar: {}, displayName: "B", userId: "u2" });
    expect(sessionParticipantIds(s).sort()).toEqual(["u1", "u2"]);
  });

  it("skips anonymous players", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", { avatar: {}, displayName: "A", userId: "u1" });
    addPlayer(s, "p2", { avatar: {}, displayName: "B", userId: null });
    expect(sessionParticipantIds(s)).toEqual(["u1"]);
  });

  // session_participants has a unique (session_id, user_id) index, so a
  // repeated id would fail the batch insert and lose the whole record
  it("dedupes a userId holding two slots", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", { avatar: {}, displayName: "A", userId: "u1" });
    addPlayer(s, "p2", { avatar: {}, displayName: "A", userId: "u1" });
    expect(sessionParticipantIds(s)).toEqual(["u1"]);
  });

  it("returns an empty array for an empty session", () => {
    expect(sessionParticipantIds(createSessionState("forest", "host"))).toEqual([]);
  });

  // The abandoned-focus bug: the last player is removed before recording, so
  // the live map is empty by then and a snapshot is the only source of truth.
  it("snapshot survives removal of the last player", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", { avatar: {}, displayName: "A", userId: "u1" });
    const snapshot = sessionParticipantIds(s);
    expect(removePlayer(s, "p1")).toBe(0);
    expect(sessionParticipantIds(s)).toEqual([]);
    expect(snapshot).toEqual(["u1"]);
  });
});

describe("invite allowlist", () => {
  it("a new session has nobody invited", () => {
    const s = createSessionState("forest", "host");
    expect(s.invitedUserIds.size).toBe(0);
    expect(isInvited(s, "u1")).toBe(false);
  });

  it("records an invited user", () => {
    const s = createSessionState("forest", "host");
    expect(inviteUser(s, "u1")).toBe(true);
    expect(isInvited(s, "u1")).toBe(true);
    expect(isInvited(s, "u2")).toBe(false);
  });

  it("is idempotent", () => {
    const s = createSessionState("forest", "host");
    inviteUser(s, "u1");
    inviteUser(s, "u1");
    expect(s.invitedUserIds.size).toBe(1);
  });

  it("ignores a null userId rather than allowlisting everyone", () => {
    const s = createSessionState("forest", "host");
    expect(inviteUser(s, null)).toBe(false);
    expect(isInvited(s, null)).toBe(false);
    expect(isInvited(s, undefined)).toBe(false);
  });

  it("stays out of the sync payload", () => {
    const s = createSessionState("forest", "host");
    inviteUser(s, "u1");
    expect(buildSyncPayload(s)).not.toHaveProperty("invitedUserIds");
  });
});

describe("share invite tokens", () => {
  it("creates a 256-bit opaque invite with a bounded lifetime", () => {
    const s = createSessionState("forest", "host");
    const invite = createShareInvite(s, 1_000);

    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invite.expiresAt).toBe(1_000 + SHARE_INVITE_TTL_MS);
    expect(hasValidShareInvite(s, invite.token, invite.expiresAt - 1)).toBe(true);
    expect(hasValidShareInvite(s, invite.token, invite.expiresAt)).toBe(false);
  });

  it("rotates the previous link and finds only the live token", () => {
    const s = createSessionState("forest", "host");
    const sessions = { [s.id]: s };
    const first = createShareInvite(s, 1_000, "first-token");
    const second = createShareInvite(s, 2_000, "second-token");

    expect(findSessionByShareInvite(sessions, first.token, 2_001)).toBe(null);
    expect(findSessionByShareInvite(sessions, second.token, 2_001)).toBe(s);
  });

  it("is single-use and stays out of sync payloads", () => {
    const s = createSessionState("forest", "host");
    const invite = createShareInvite(s, 1_000, "one-use-token");

    expect(buildSyncPayload(s)).not.toHaveProperty("shareInvite");
    expect(consumeShareInvite(s, invite.token, 1_001)).toBe(true);
    expect(consumeShareInvite(s, invite.token, 1_002)).toBe(false);
  });
});

describe("findPlayerByUserId", () => {
  it("finds the socket id for a user in the session", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "sock-a", { avatar: {}, displayName: "A", userId: "u1" });
    addPlayer(s, "sock-b", { avatar: {}, displayName: "B", userId: "u2" });
    expect(findPlayerByUserId(s, "u2")).toBe("sock-b");
  });

  it("returns null when the user is not in the session", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "sock-a", { avatar: {}, displayName: "A", userId: "u1" });
    expect(findPlayerByUserId(s, "u9")).toBe(null);
  });

  it("returns null for a null userId even if anonymous players exist", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "sock-a", { avatar: {}, displayName: "A", userId: null });
    expect(findPlayerByUserId(s, null)).toBe(null);
  });
});

describe("two-person seat reservations", () => {
  it("reserves the second seat and reports the room full", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "host", { avatar: {}, displayName: "A", userId: "u1" });

    expect(hasOpenPlayerSlot(s)).toBe(true);
    expect(reservePlayerSlot(s, "u2")).toEqual({ ok: true, reserved: true });
    expect(hasOpenPlayerSlot(s)).toBe(false);
    expect(reservePlayerSlot(s, "u3")).toEqual({ ok: false, reserved: false });
  });

  it("allows an existing participant to reconnect to a full room", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "host", { avatar: {}, displayName: "A", userId: "u1" });
    addPlayer(s, "partner", { avatar: {}, displayName: "B", userId: "u2" });

    expect(hasOpenPlayerSlot(s)).toBe(false);
    expect(reservePlayerSlot(s, "u2")).toEqual({ ok: true, reserved: false });
  });

  it("releases a failed join so another user can take the seat", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "host", { avatar: {}, displayName: "A", userId: "u1" });
    expect(reservePlayerSlot(s, "u2").ok).toBe(true);

    expect(releasePlayerSlot(s, "u2")).toBe(true);
    expect(hasOpenPlayerSlot(s)).toBe(true);
    expect(reservePlayerSlot(s, "u3").ok).toBe(true);
  });

  it("does not let duplicate in-flight joins reserve twice", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "host", { avatar: {}, displayName: "A", userId: "u1" });

    expect(reservePlayerSlot(s, "u2").ok).toBe(true);
    expect(reservePlayerSlot(s, "u2")).toEqual({ ok: false, reserved: false });
    expect(s.pendingJoinUserIds.size).toBe(1);
  });

  it("does not expose reservations in the sync payload", () => {
    const s = createSessionState("forest", "host");
    reservePlayerSlot(s, "u2");
    expect(buildSyncPayload(s)).not.toHaveProperty("pendingJoinUserIds");
  });
});

describe("markPlayerDisconnected", () => {
  it("players start connected and can be marked disconnected and back", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", { avatar: {}, displayName: "A", userId: "u1" });
    expect(s.players["p1"].disconnected).toBe(false);
    expect(markPlayerDisconnected(s, "p1", true)).toBe(true);
    expect(s.players["p1"].disconnected).toBe(true);
    expect(markPlayerDisconnected(s, "p1", false)).toBe(true);
    expect(s.players["p1"].disconnected).toBe(false);
  });

  it("returns false for a socket that is not a player", () => {
    const s = createSessionState("forest", "host");
    expect(markPlayerDisconnected(s, "ghost", true)).toBe(false);
  });

  it("disconnected flag survives into the sync payload", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", { avatar: {}, displayName: "A", userId: "u1" });
    markPlayerDisconnected(s, "p1", true);
    expect(buildSyncPayload(s).players["p1"].disconnected).toBe(true);
  });
});

describe("setPlayerPet", () => {
  it("stores a pet on join and defaults to null", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", { avatar: {}, displayName: "A", userId: "u1", pet: "cat" });
    addPlayer(s, "p2", { avatar: {}, displayName: "B", userId: "u2" });
    expect(s.players["p1"].pet).toBe("cat");
    expect(s.players["p1"].petStage).toBe("young");
    expect(s.players["p2"].pet).toBe(null);
    expect(s.players["p2"].petStage).toBe(null);
  });

  it("keeps a caller-supplied stage rather than inventing one", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", {
      avatar: {},
      displayName: "A",
      userId: "u1",
      pet: "cat",
      petStage: "full",
      focusSeconds: 20 * 3600,
    });
    expect(s.players["p1"].petStage).toBe("full");
    expect(s.players["p1"].focusSeconds).toBe(20 * 3600);
  });

  it("updates an existing player's pet", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", { avatar: {}, displayName: "A", userId: "u1" });
    expect(setPlayerPet(s, "p1", "dragon", "grown")).toBe(true);
    expect(s.players["p1"].pet).toBe("dragon");
    expect(s.players["p1"].petStage).toBe("grown");
    expect(setPlayerPet(s, "p1", null)).toBe(true);
    expect(s.players["p1"].pet).toBe(null);
    expect(s.players["p1"].petStage).toBe(null);
  });

  it("returns false for a socket that is not a player", () => {
    const s = createSessionState("forest", "host");
    expect(setPlayerPet(s, "ghost", "cat")).toBe(false);
  });

  it("does not put focusSeconds on the wire", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", {
      avatar: {},
      displayName: "A",
      userId: "u1",
      pet: "cat",
      focusSeconds: 10800,
    });
    const payload = buildSyncPayload(s);
    expect(payload.players["p1"].pet).toBe("cat");
    expect(payload.players["p1"].petStage).toBe("young");
    expect(payload.players["p1"]).not.toHaveProperty("focusSeconds");
  });
});

describe("creditFocus", () => {
  it("grows a pet that crosses a threshold and leaves the rest", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", {
      avatar: {},
      displayName: "A",
      userId: "u1",
      pet: "cat",
      petStage: "young",
      focusSeconds: 10700,
    });
    addPlayer(s, "p2", {
      avatar: {},
      displayName: "B",
      userId: "u2",
      pet: "dog",
      petStage: "young",
      focusSeconds: 0,
    });

    const changed = creditFocus(s, ["u1", "u2"], 200);
    expect(changed).toEqual([{ playerId: "p1", pet: "cat", petStage: "grown" }]);
    expect(s.players["p1"].petStage).toBe("grown");
    expect(s.players["p1"].focusSeconds).toBe(10900);
    expect(s.players["p2"].petStage).toBe("young");
    expect(s.players["p2"].focusSeconds).toBe(200);
  });

  it("still accumulates for a player with no pet", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", { avatar: {}, displayName: "A", userId: "u1" });
    expect(creditFocus(s, ["u1"], 10800)).toEqual([]);
    expect(s.players["p1"].focusSeconds).toBe(10800);
    expect(s.players["p1"].petStage).toBe(null);
  });

  it("ignores users who are not in the credit list", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", {
      avatar: {},
      displayName: "A",
      userId: "u1",
      pet: "cat",
      focusSeconds: 10700,
    });
    expect(creditFocus(s, ["u9"], 200)).toEqual([]);
    expect(s.players["p1"].focusSeconds).toBe(10700);
  });

  it("does not shrink or re-emit a pet that is already there", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", {
      avatar: {},
      displayName: "A",
      userId: "u1",
      pet: "cat",
      petStage: "full",
      focusSeconds: 54000,
    });
    expect(creditFocus(s, ["u1"], 3600)).toEqual([]);
    expect(s.players["p1"].petStage).toBe("full");
  });

  it("credits a successfully persisted round only once", () => {
    const s = createSessionState("forest", "host");
    addPlayer(s, "p1", {
      avatar: {},
      displayName: "A",
      userId: "u1",
      pet: "cat",
      focusSeconds: 10700,
    });

    expect(creditFocusRound(s, "round-1", ["u1"], 200)).toEqual([
      { playerId: "p1", pet: "cat", petStage: "grown" },
    ]);
    expect(creditFocusRound(s, "round-1", ["u1"], 200)).toEqual([]);
    expect(s.players.p1.focusSeconds).toBe(10900);
  });
});

describe("findUserSessions", () => {
  const withPlayers = (...users) => {
    const s = createSessionState("forest", "host");
    users.forEach((u, i) =>
      addPlayer(s, `sock-${u}-${i}`, { avatar: {}, displayName: u, userId: u }),
    );
    return s;
  };

  it("finds the one session a user is in", () => {
    const sessions = { a: withPlayers("u1"), b: withPlayers("u2") };
    expect(findUserSessions(sessions, "u1")).toEqual(["a"]);
  });

  // The multi-tab case: presence must not be cleared while another tab is
  // still in a live session.
  it("finds every session a user holds a slot in", () => {
    const sessions = { a: withPlayers("u1"), b: withPlayers("u1", "u2") };
    expect(findUserSessions(sessions, "u1").sort()).toEqual(["a", "b"]);
  });

  it("returns empty for a user who is in none", () => {
    expect(findUserSessions({ a: withPlayers("u1") }, "u9")).toEqual([]);
  });

  it("returns empty for a null userId", () => {
    expect(findUserSessions({ a: withPlayers("u1") }, null)).toEqual([]);
  });

  it("handles no sessions at all", () => {
    expect(findUserSessions({}, "u1")).toEqual([]);
  });
});

 describe("room round count", () => {
  it("counts completion once, preserves it for another round and syncs it", () => {
    const s = createSessionState("forest", "host");
    expect(completeFocusRound(s)).toBe(false);
    beginFocusRound(s, 1, "round-1");
    expect(completeFocusRound(s)).toBe(true);
    expect(completeFocusRound(s)).toBe(false);
    s.phase = "ready";
    beginFocusRound(s, 2, "round-2");
    expect(buildSyncPayload(s).completedRounds).toBe(1);
    completeFocusRound(s);
    expect(buildSyncPayload(s).completedRounds).toBe(2);
    expect(createSessionState("forest", "host").completedRounds).toBe(0);
  });
  it("does not count an interrupted round", () => {
    const s = createSessionState("forest", "host");
    beginFocusRound(s);
    s.phase = "waiting";
    s.focusRoundId = null;
    expect(completeFocusRound(s)).toBe(false);
    expect(s.completedRounds).toBe(0);
  });
});


describe("round recap snapshots", () => {
  it("uses configured Pomodoro duration and bounded server elapsed Flow time", () => {
    const s = createSessionState("forest", "host");
    beginFocusRound(s, 1000, "private-one");
    completeFocusRound(s, 1504000);
    expect(s.roundRecap).toEqual({ intentions: {}, round: 1, focusSeconds: 1500, mode: "pomodoro", saveState: "saving" });
    expect(completeFocusRound(s)).toBe(false);
    s.mode = "flow";
    beginFocusRound(s, 1000, "private-two");
    expect(s.roundRecap).toBeNull();
    completeFocusRound(s, 493200);
    expect(s.roundRecap.focusSeconds).toBe(492);
    expect(JSON.stringify(buildSyncPayload(s))).not.toContain("private-two");
  });

  it("keeps save status after ready, and ignores an earlier round's delayed write", () => {
    const s = createSessionState("forest", "host");
    beginFocusRound(s, 1000, "one");
    completeFocusRound(s);
    s.phase = "ready";
    s.focusRoundId = null;
    expect(updateRoundRecap(s, "one", "saved").saveState).toBe("saved");
    expect(buildSyncPayload(s).roundRecap.saveState).toBe("saved");
    beginFocusRound(s, 2000, "two");
    expect(updateRoundRecap(s, "one", "saved")).toBeNull();
    completeFocusRound(s);
    expect(updateRoundRecap(s, "one", "unconfirmed")).toBeNull();
    expect(s.roundRecap).toMatchObject({ round: 2, saveState: "saving" });
  });
});

describe('private companion snapshots', () => {
  it('only includes the recipient total and keeps unknown progress distinct from zero', () => {
    const session = createSessionState('forest', 'a');
    addPlayer(session, 'a', { avatar: {}, userId: 'alice', focusSeconds: 10800 });
    addPlayer(session, 'b', { avatar: {}, userId: 'bob', focusSeconds: 54000 });
    const snapshot = buildSyncPayload(session, 'a');
    expect(snapshot.companionFocusSeconds).toBe(10800);
    expect(snapshot.players.a).not.toHaveProperty('focusSeconds');
    expect(snapshot.players.b).not.toHaveProperty('focusSeconds');
    expect(buildSyncPayload(session, 'b').companionFocusSeconds).toBe(54000);
    session.players.a.focusSeconds = null;
    expect(buildSyncPayload(session, 'a').companionFocusSeconds).toBeNull();
  });
});
