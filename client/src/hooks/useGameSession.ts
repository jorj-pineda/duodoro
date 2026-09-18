"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import type { GamePhase } from "@/components/GameWorld";
import type { AvatarConfig, WorldId } from "@/lib/avatarData";
import type { Profile, PetType } from "@/lib/types";
import type { PetStage } from "@/lib/petLevel";
import type {
  PlayerData,
  SyncPayload,
  PhaseChangePayload,
  InviteData,
} from "@/lib/sessionTypes";
import type {
  DuodoroSocket,
} from "@/lib/socketContract";
import { useSessionConnection } from "@/hooks/useSessionConnection";
import { playSound } from "@/lib/sounds";
import { worldAt } from "@/lib/rotation";
import { readTimerPrefs, writeTimerPrefs } from "@/lib/timerPrefs";
import { isSessionId } from "@/lib/storedData";

// sessionStorage key mirroring the active session id, so a full page reload
// can silently rejoin within the server's reconnect grace window. localStorage
// is the source of truth so a closed tab can still resume; sessionStorage is
// kept as a same-tab mirror.
const RESUME_KEY = "duodoro:session";

function readResumeSession() {
  if (typeof window === "undefined") return null;
  try {
    const stored =
      localStorage.getItem(RESUME_KEY) ?? sessionStorage.getItem(RESUME_KEY);
    // A stored value that is not a session id cannot name a live session, so
    // resuming it only produces a doomed join and a "Session not found" toast
    // for something that was never a session. Drop it instead, and clear it so
    // the next read is cheap.
    if (!isSessionId(stored)) {
      if (stored !== null) clearResumeSession();
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

function writeResumeSession(sessionId: string) {
  try {
    localStorage.setItem(RESUME_KEY, sessionId);
    sessionStorage.setItem(RESUME_KEY, sessionId);
  } catch {}
}

function clearResumeSession() {
  try {
    localStorage.removeItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
  } catch {}
}
const SHARE_JOIN_PENDING = "__share_invite__";

export type { InviteData };

export function useGameSession(profile: Profile | null) {
  // ── Avatar & world ──────────────────────────────────────────────────────
  // myWorld is a mirror of the server's answer, not a choice: createSession
  // seeds it from the rotation so the scene doesn't flash forest, and
  // sync_state overwrites it with the authoritative value. Kept as a plain
  // literal rather than worldAt() so nothing reads the clock during render —
  // Next renders this component on the server too, where "now" is a different
  // number.
  const [myWorld, setMyWorld] = useState<WorldId>("forest");
  const [myPet, setMyPetState] = useState<PetType | null>(null);
  const [myPetStage, setMyPetStage] = useState<PetStage | null>(null);
  // Ref mirrors so the socket handlers — registered once with [] deps — read
  // current values instead of whatever was captured at mount. Without this, an
  // invite sent before a session exists is relayed by the session_created
  // handler using profile=null, i.e. from "Someone".
  const myPetRef = useRef<PetType | null>(null);
  const profileRef = useRef<Profile | null>(null);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  const inviterName = useCallback(
    () =>
      profileRef.current?.display_name ??
      profileRef.current?.username ??
      "Someone",
    [],
  );

  // ── Session ─────────────────────────────────────────────────────────────
  const [sessionId, setSessionId] = useState<string>("");

  // ── Session config ──────────────────────────────────────────────────────
  // Seeded from storage rather than a literal, so a Flowmodoro user and their
  // 50/10 survive a reload. `useState` is lazy, so the read happens once, and
  // it is SSR-safe (no storage on the server → the defaults). Persisting is
  // done by the wrapped setters below, not by an effect, because an effect
  // would also fire on mount and write back the value it just read.
  const [timerMode, setTimerModeState] = useState<"pomodoro" | "flow">(
    () => readTimerPrefs().mode,
  );
  const [focusDuration, setFocusDurationState] = useState(
    () => readTimerPrefs().focus,
  );
  const [breakDuration, setBreakDurationState] = useState(
    () => readTimerPrefs().break,
  );

  // Persisted setters. The HUD's handlers keep their `(value) => void` shape, so
  // the write lives here rather than at each call site — one place to see that
  // these three are the persisted ones, and one place to change if that stops
  // being true.
  const setTimerMode = useCallback((mode: "pomodoro" | "flow") => {
    setTimerModeState(mode);
    writeTimerPrefs({ mode });
  }, []);
  const setFocusDuration = useCallback((minutes: number) => {
    setFocusDurationState(minutes);
    writeTimerPrefs({ focus: minutes });
  }, []);
  const setBreakDuration = useCallback((minutes: number) => {
    setBreakDurationState(minutes);
    writeTimerPrefs({ break: minutes });
  }, []);

  // ── Game state ──────────────────────────────────────────────────────────
  const [serverMode, setServerMode] = useState<"pomodoro" | "flow">("pomodoro");
  const [phase, setPhase] = useState<GamePhase>("waiting");
  const [phaseStartTime, setPhaseStartTime] = useState<number | null>(null);
  const [serverFocusDuration, setServerFocusDuration] = useState(25 * 60);
  const [serverBreakDuration, setServerBreakDuration] = useState(5 * 60);
  const [players, setPlayers] = useState<Record<string, PlayerData>>({});
  const [sessionStarted, setSessionStarted] = useState(false);

  // ── Timer tick ──────────────────────────────────────────────────────────
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  // ── UI state ────────────────────────────────────────────────────────────
  const [pendingInvite, setPendingInvite] = useState<InviteData | null>(null);
  // Surfaced as a toast by DuoTimer — these used to be console-only, which left
  // a refused join sitting on an empty game screen with no explanation.
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [inviteSentName, setInviteSentName] = useState<string | null>(null);

  // Pending outbound invite
  const pendingOutboundInvite = useRef<string | null>(null);

  // ── Resume-sync snapshot ────────────────────────────────────────────────
  // Mirrors the current session membership so we can re-join after a mobile
  // tab resume closes the WebSocket. The server removes the player on
  // disconnect, so without these we can't re-enter silently.
  const sessionIdRef = useRef<string>("");
  // Joining is optimistic. If the server refuses a different room, keep the
  // room this socket is still actually in so a failed switch does not orphan
  // the client from its live session.
  const previousSessionIdRef = useRef<string>("");
  const pendingJoinSessionIdRef = useRef<string>("");
  const lastAvatarRef = useRef<AvatarConfig | null>(null);
  const lastDisplayNameRef = useRef<string>("Player");
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // ── Refresh resume ──────────────────────────────────────────────────────
  // A reload or closed tab wipes React state but the server holds the player's
  // spot during its reconnect grace window; the stored id lets DuoTimer rejoin
  // silently. localStorage survives a closed tab; sessionStorage is a mirror.
  // Lazy init: only rendered on the client after hydration effects, and no
  // DOM output depends on it, so reading storage here is hydration-safe.
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(() =>
    readResumeSession(),
  );
  useEffect(() => {
    if (sessionId) writeResumeSession(sessionId);
  }, [sessionId]);
  const consumeResumeSession = useCallback(
    () => setResumeSessionId(null),
    [],
  );

  // ── Sound tracking ─────────────────────────────────────────────────────
  const prevPhaseRef = useRef<GamePhase>("waiting");

  // Room/game listeners stay here; the connection hook owns transport,
  // authentication refresh, retry state, tab recovery, and rejoin ordering.
  const getResumeSnapshot = useCallback(() => {
    const sessionId = sessionIdRef.current;
    const avatar = lastAvatarRef.current;
    if (!sessionId) return null;
    return {
      sessionId,
      avatar,
      displayName: lastDisplayNameRef.current,
      pet: myPetRef.current,
    };
  }, []);

  const registerSocketHandlers = useCallback((socket: DuodoroSocket) => {
    socket.on(
      "session_created",
      ({ sessionId: sid }) => {
        setSessionId(sid);
        const target = pendingOutboundInvite.current;
        if (target) {
          pendingOutboundInvite.current = null;
          socket.emit("send_invite", {
            targetUserId: target,
            sessionId: sid,
            fromName: inviterName(),
          });
        }
      },
    );

    socket.on("session_error", ({ message }) => {
      console.error("Session error:", message);
      setSessionError(message);
      // These reject a join attempt. Restore the room the socket was already
      // in, or clear the optimistic id when there was no previous room, so
      // the UI never sits in a session the server refused.
      if (
        message === "Session not found" ||
        message === "This session is private" ||
        message === "Session is full" ||
        message === "Invite link is invalid or expired"
      ) {
        const previousSessionId = previousSessionIdRef.current;
        previousSessionIdRef.current = "";
        pendingJoinSessionIdRef.current = "";
        if (previousSessionId) {
          setSessionId(previousSessionId);
          writeResumeSession(previousSessionId);
          socket.emit("request_sync");
          return;
        }
        // Stale resume attempt or expired invite — the server has already
        // confirmed there is no room to restore, so clear the optimistic id.
        clearResumeSession();
        setResumeSessionId(null);
        setSessionId("");
        setSessionStarted(false);
        setPlayers({});
      }
    });

    socket.on("sync_state", (data: SyncPayload) => {
      // A sync for the attempted room confirms the switch. A sync for the
      // previous room can race with the join response and must not erase the
      // rollback target.
      const pendingTarget = pendingJoinSessionIdRef.current;
      const sharedJoinConfirmed =
        pendingTarget === SHARE_JOIN_PENDING &&
        data.sessionId !== previousSessionIdRef.current;
      if (!pendingTarget || data.sessionId === pendingTarget || sharedJoinConfirmed) {
        previousSessionIdRef.current = "";
        pendingJoinSessionIdRef.current = "";
      }
      if (data.mode) setServerMode(data.mode);
      setPhase(data.phase);
      setPhaseStartTime(data.phaseStartTime);
      setServerFocusDuration(data.focusDuration);
      setServerBreakDuration(data.breakDuration);
      setPlayers(data.players || {});
      if (data.world) setMyWorld(data.world as WorldId);
      if (data.sessionId) setSessionId(data.sessionId);
      // Own stage comes from the slot, not a local guess: useStats is stale
      // during a session, and a client-sent stage is ignored by the server.
      const self = socket.id ? data.players?.[socket.id] : undefined;
      if (self) {
        setMyPetStage(self.pet ? (self.petStage ?? "grown") : null);
      }
      // Mirror the phase in both directions. Only ever setting this to true
      // left the *other* player stuck after someone pressed end-session:
      // phase went back to "waiting" but sessionStarted stayed true, which
      // makes both canStart and canStop false in SessionHUD — no Start
      // button, no mode toggle, no sliders, only "leave session".
      setSessionStarted(data.phase !== "waiting");
    });

    socket.on("phase_change", (data: PhaseChangePayload) => {
      if (data.mode) setServerMode(data.mode);
      setPhase(data.phase);
      setPhaseStartTime(data.phaseStartTime);
      setServerFocusDuration(data.focusDuration);
      setServerBreakDuration(data.breakDuration);
      setSessionStarted(data.phase !== "waiting");
    });

    socket.on(
      "player_joined",
      ({
        playerId,
        avatar,
        displayName,
        pet,
        petStage,
      }) => {
        setPlayers((prev) => ({
          ...prev,
          [playerId]: {
            avatar,
            displayName,
            pet: pet ?? null,
            petStage: pet ? (petStage ?? "grown") : null,
          },
        }));
      },
    );

    socket.on(
      "pet_changed",
      ({
        playerId,
        pet,
        petStage,
      }) => {
        setPlayers((prev) =>
          prev[playerId]
            ? {
                ...prev,
                [playerId]: {
                  ...prev[playerId],
                  pet,
                  petStage: pet ? (petStage ?? "grown") : null,
                },
              }
            : prev,
        );
        // The server emits to the whole room, including the picker, so the
        // originator sees the derived size rather than guessing from stats.
        if (playerId === socket.id) {
          setMyPetStage(pet ? (petStage ?? "grown") : null);
        }
      },
    );

    // Partner's socket dropped; the server is holding their spot during
    // the reconnect grace window (player_joined or player_left follows).
    socket.on(
      "player_disconnected",
      ({ playerId }) => {
        setPlayers((prev) =>
          prev[playerId]
            ? {
                ...prev,
                [playerId]: { ...prev[playerId], disconnected: true },
              }
            : prev,
        );
      },
    );

    socket.on("player_left", ({ playerId }) => {
      setPlayers((prev) => {
        const next = { ...prev };
        delete next[playerId];
        return next;
      });
    });

    socket.on("session_invite", (data: InviteData) => {
      setPendingInvite(data);
    });

    socket.on("invite_error", ({ message }) => {
      setInviteSentName(null);
      console.warn("Invite error:", message);
      setSessionError(message);
    });

  }, [inviterName]);

  const { socketRef, myId, connectionState, reconnect } =
    useSessionConnection({
      getResumeSnapshot,
      registerSocketHandlers,
    });

  // ── Register presence ───────────────────────────────────────────────────
  // connectionState is the signal that socketRef.current exists. The first
  // mount runs before connectSocket() finishes its await, so a null check
  // here used to skip register_user forever.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !profile?.id) return;
    if (socket.connected) {
      socket.emit("register_user", {});
    }
    const onConnect = () => {
      socket.emit("register_user", {});
    };
    socket.on("connect", onConnect);
    return () => {
      socket.off("connect", onConnect);
    };
  }, [profile?.id, socketRef, connectionState]);

  // ── Sound effects on phase transitions ──────────────────────────────────
  useEffect(() => {
    if (prevPhaseRef.current === phase) return;
    if (phase === "focus") playSound("session-start");
    if (phase === "celebration") playSound("victory");
    if (phase === "break") playSound("break-start");
    prevPhaseRef.current = phase;
  }, [phase]);

  // ── Derived values ──────────────────────────────────────────────────────
  const currentPhaseDuration =
    phase === "focus" ? serverFocusDuration : serverBreakDuration;

  const timeLeft = phaseStartTime
    ? Math.max(0, currentPhaseDuration - (now - phaseStartTime) / 1000)
    : currentPhaseDuration;

  const flowElapsed = phaseStartTime
    ? Math.max(0, (now - phaseStartTime) / 1000)
    : 0;

  const focusProgress =
    phase === "focus" && phaseStartTime
      ? serverMode === "flow"
        ? Math.min(1, flowElapsed / (120 * 60))
        : Math.min(1, (now - phaseStartTime) / (serverFocusDuration * 1000))
      : 0;

  const returningProgress =
    phase === "returning" && phaseStartTime
      ? Math.min(1, (now - phaseStartTime) / 3500)
      : 0;

  // 0–1 through the current focus/break phase (meaningless for flow focus,
  // where the "duration" is just the server's safety cap — HUD hides it)
  const phaseProgress =
    (phase === "focus" || phase === "break") && phaseStartTime
      ? Math.min(1, (now - phaseStartTime) / (currentPhaseDuration * 1000))
      : 0;

  const partnerEntry = Object.entries(players).find(([id]) => id !== myId);
  const partner = partnerEntry
    ? { id: partnerEntry[0], avatar: partnerEntry[1].avatar }
    : null;
  const partnerName = partnerEntry?.[1].displayName;
  const partnerUserId = partnerEntry?.[1].userId ?? null;
  const partnerPet = partnerEntry?.[1].pet ?? null;
  const partnerPetStage = partnerEntry?.[1].petStage ?? null;
  const partnerDisconnected = partnerEntry?.[1].disconnected ?? false;

  const playerCount = Object.keys(players).length;

  // ── Session actions ─────────────────────────────────────────────────────
  const createSession = useCallback(
    (avatar: AvatarConfig) => {
      const socket = socketRef.current;
      if (!socket) return;
      if (sessionId) {
        socket.emit("leave_session", { sessionId });
        setSessionStarted(false);
        setPhase("waiting");
        setPlayers({});
        setSessionId("");
      }
      // Optimistic, so the scene doesn't flash forest while sync_state is in
      // flight. The server assigns the real one from the same clock and it
      // arrives moments later; the only way the two disagree is a create that
      // straddles a rotation boundary, and then the server's answer wins.
      setMyWorld(worldAt());
      const displayName = profile?.display_name ?? profile?.username ?? "Player";
      lastAvatarRef.current = avatar;
      lastDisplayNameRef.current = displayName;
      socket.emit("create_session", {
        avatar,
        displayName,
        pet: myPetRef.current,
      });
    },
    [profile, sessionId, socketRef],
  );

  const joinSession = useCallback(
    (sid: string, avatar: AvatarConfig) => {
      const socket = socketRef.current;
      if (!socket) return;
      previousSessionIdRef.current = sessionIdRef.current;
      pendingJoinSessionIdRef.current = sid;
      setSessionId(sid);
      const displayName = profile?.display_name ?? profile?.username ?? "Player";
      lastAvatarRef.current = avatar;
      lastDisplayNameRef.current = displayName;
      socket.emit("join_session", {
        sessionId: sid,
        avatar,
        displayName,
        pet: myPetRef.current,
      });
    },
    [profile, socketRef],
  );

  const joinShareInvite = useCallback(
    (shareToken: string, avatar: AvatarConfig) => {
      const socket = socketRef.current;
      if (!socket) return;
      previousSessionIdRef.current = sessionIdRef.current;
      pendingJoinSessionIdRef.current = SHARE_JOIN_PENDING;
      const displayName = profile?.display_name ?? profile?.username ?? "Player";
      lastAvatarRef.current = avatar;
      lastDisplayNameRef.current = displayName;
      socket.emit("join_session", {
        shareToken,
        avatar,
        displayName,
        pet: myPetRef.current,
      });
    },
    [profile, socketRef],
  );

  const createShareInvite = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        const socket = socketRef.current;
        if (!socket || !sessionId) {
          setSessionError("Create a session before sharing an invite");
          resolve(null);
          return;
        }

        const timeout = window.setTimeout(() => {
          setSessionError("Invite link request timed out");
          resolve(null);
        }, 5_000);
        socket.emit(
          "create_share_invite",
          { sessionId },
          (response) => {
            window.clearTimeout(timeout);
            if (response?.ok && response.token) {
              resolve(response.token);
              return;
            }
            setSessionError(response?.message || "Couldn't create invite link");
            resolve(null);
          },
        );
      }),
    [sessionId, socketRef],
  );

  const leaveSession = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("leave_session", { sessionId });
    setSessionStarted(false);
    setPhase("waiting");
    setPlayers({});
    setSessionId("");
    previousSessionIdRef.current = "";
    pendingJoinSessionIdRef.current = "";
    lastAvatarRef.current = null;
    clearResumeSession();
    setResumeSessionId(null);
  }, [sessionId, socketRef]);

  const startSession = useCallback(() => {
    socketRef.current?.emit("start_session", {
      sessionId,
      focusDuration: focusDuration * 60,
      breakDuration: breakDuration * 60,
      mode: timerMode,
    });
    playSound("click");
  }, [sessionId, focusDuration, breakDuration, timerMode, socketRef]);

  const finishFlowFocus = useCallback(() => {
    socketRef.current?.emit("finish_flow_focus", { sessionId });
    playSound("click");
  }, [sessionId, socketRef]);

  const stopSession = useCallback(() => {
    socketRef.current?.emit("stop_session", { sessionId });
    setSessionStarted(false);
    playSound("click");
  }, [sessionId, socketRef]);

  // Set/change pet — keeps the ref mirror in sync and relays mid-session
  const setMyPet = useCallback((pet: PetType | null) => {
    setMyPetState(pet);
    myPetRef.current = pet;
    const sid = sessionIdRef.current;
    if (sid) socketRef.current?.emit("set_pet", { sessionId: sid, pet });
  }, [socketRef]);

  const sendInvite = useCallback(
    (targetUserId: string, avatar: AvatarConfig) => {
      const socket = socketRef.current;
      if (!socket) return;

      setInviteSentName(targetUserId);
      setTimeout(() => setInviteSentName(null), 2500);

      if (sessionId) {
        // No worldId: the server reads it off the session it's inviting to.
        socket.emit("send_invite", {
          targetUserId,
          sessionId,
          fromName: profile?.display_name ?? profile?.username ?? "Someone",
        });
      } else {
        pendingOutboundInvite.current = targetUserId;
        setMyWorld(worldAt());
        socket.emit("create_session", {
          avatar,
          displayName: profile?.display_name ?? profile?.username ?? "Player",
          pet: myPetRef.current,
        });
      }
    },
    [sessionId, profile, socketRef],
  );

  const dismissInvite = useCallback(() => setPendingInvite(null), []);

  return {
    // World & pet. myWorld is read-only to callers: the world is the server's,
    // and a setter here is a way to put the client back in charge of it.
    myWorld,
    myPet,
    myPetStage,
    setMyPet,
    // Session config
    timerMode,
    setTimerMode,
    focusDuration,
    setFocusDuration,
    breakDuration,
    setBreakDuration,
    // Game state
    serverMode,
    phase,
    sessionStarted,
    myId,
    socketRef,
    connectionState,
    reconnect,
    // Derived
    timeLeft,
    flowElapsed,
    focusProgress,
    returningProgress,
    phaseProgress,
    partner,
    partnerName,
    partnerUserId,
    partnerPet,
    partnerPetStage,
    partnerDisconnected,
    playerCount,
    // Session actions
    sessionId,
    resumeSessionId,
    consumeResumeSession,
    createSession,
    joinSession,
    joinShareInvite,
    createShareInvite,
    leaveSession,
    startSession,
    finishFlowFocus,
    stopSession,
    sendInvite,
    // Invite state
    pendingInvite,
    dismissInvite,
    sessionError,
    clearSessionError: useCallback(() => setSessionError(null), []),
    inviteSentName,
  };
}
