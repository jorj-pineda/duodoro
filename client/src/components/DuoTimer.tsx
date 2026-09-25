"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import AvatarCreator from "./AvatarCreator";
import GameWorld from "./GameWorld";
import LandingPage from "./LandingPage";
import FriendsPanel from "./FriendsPanel";
import StickyNote from "./StickyNote";
import PremiumModal from "./PremiumModal";
import StatsPanel from "./StatsPanel";
import StatsScreen from "./StatsScreen";
import HomeDashboard from "./HomeDashboard";
import InvitePopup from "./InvitePopup";
import ConnectionBanner from "./ConnectionBanner";
import SessionTopBar from "./SessionTopBar";
import SessionHUD from "./SessionHUD";
import UsernameChangeModal from "./UsernameChangeModal";
import DisplayNameChangeModal from "./DisplayNameChangeModal";
import { useAuth } from "@/hooks/useAuth";
import { useGameSession } from "@/hooks/useGameSession";
import {
  clearPendingShareInvite,
  readPendingShareInvite,
  shareInviteUrl,
} from "@/lib/shareInvite";

export default function DuoTimer() {
  const router = useRouter();
  const auth = useAuth();
  const game = useGameSession(auth.profile);
  const gameConnectionState = game.connectionState;
  const joinShareInvite = game.joinShareInvite;

  // ── UI panel state ──────────────────────────────────────────────────────
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [fullStatsOpen, setFullStatsOpen] = useState(false);
  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const [displayNameModalOpen, setDisplayNameModalOpen] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [shareInviteBusy, setShareInviteBusy] = useState(false);
  const [shareInviteCopied, setShareInviteCopied] = useState(false);
  const [pendingShareInvite, setPendingShareInvite] = useState<string | null>(
    () => readPendingShareInvite(),
  );
  const shareJoinAttemptRef = useRef<string | null>(null);
  const resumingRef = useRef(false);
  const attemptedPresenceResumeRef = useRef<string | null>(null);

  const showError = (message: string) => {
    setErrorToast(message);
    window.setTimeout(() => setErrorToast(null), 4000);
  };

  const { appStep, setAppStep, profile, myAvatar, isPremium, displayName, sb, refreshProfilePresence } =
    auth;
  const initial = displayName.charAt(0).toUpperCase();

  // ── Wrappers that bridge auth + game ────────────────────────────────────
  const handleCreateSession = () => {
    if (game.connectionState !== "connected") {
      showError("Still connecting — try again in a moment");
      return;
    }
    game.createSession(myAvatar);
    setAppStep("game");
  };

  const handleJoinSession = (sid: string) => {
    if (game.connectionState !== "connected") {
      showError("Still connecting — try again in a moment");
      return;
    }
    game.joinSession(sid, myAvatar);
    setAppStep("game");
  };

  const handleFocus = () => {
    if (game.sessionId) {
      setAppStep("game");
      return;
    }
    const resumeId =
      game.resumeSessionId || profile?.current_session_id || null;
    if (resumeId) {
      handleJoinSession(resumeId);
      return;
    }
    handleCreateSession();
  };

  const handleRejoinSession = () => {
    const sid =
      game.sessionId || game.resumeSessionId || profile?.current_session_id;
    if (!sid) return;
    if (!game.sessionId) handleJoinSession(sid);
    else setAppStep("game");
  };

  const handleLeaveSession = () => {
    game.leaveSession();
    setAppStep("home");
  };

  const handleSendInvite = (targetUserId: string) => {
    game.sendInvite(targetUserId, myAvatar);
    if (!game.sessionId) setAppStep("game");
  };

  const handleShareInvite = async () => {
    setShareInviteBusy(true);
    try {
      const token = await game.createShareInvite();
      const url = token ? shareInviteUrl(token, window.location.origin) : null;
      if (!url) return;
      if (!navigator.clipboard?.writeText) {
        showError("Clipboard access is unavailable in this browser");
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareInviteCopied(true);
      window.setTimeout(() => setShareInviteCopied(false), 2500);
    } catch {
      showError("Couldn't copy the invite link. Please try again.");
    } finally {
      setShareInviteBusy(false);
    }
  };

  // ── Socket-reported errors ──────────────────────────────────────────────
  // A refused or stale join used to be console-only, stranding the user on an
  // empty game screen reading "Setting up…". Show it and send them home.
  useEffect(() => {
    if (!game.sessionError) return;
    if (attemptedPresenceResumeRef.current) {
      attemptedPresenceResumeRef.current = null;
    }
    const expiredShareLink =
      game.sessionError === "Invite link is invalid or expired";
    const fallbackSid =
      expiredShareLink
        ? game.resumeSessionId || profile?.current_session_id || null
        : null;
    if (shareJoinAttemptRef.current) {
      shareJoinAttemptRef.current = null;
      clearPendingShareInvite();
      setPendingShareInvite(null);
    }
    // This effect deliberately promotes an external socket event from the
    // session hook into parent-owned toast/navigation state.
    if (fallbackSid) {
      game.clearSessionError();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- socket error to join
      handleJoinSession(fallbackSid);
      return;
    }
    showError(
      game.sessionError === "Session not found"
        ? "This room has ended. Start a new session; check History for saved focus."
        : game.sessionError,
    );
    game.clearSessionError();
    if (!game.sessionId) setAppStep((step) => (step === "game" ? "home" : step));
    // showError/setAppStep are stable; re-running on sessionId would re-fire
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.sessionError]);

  // A /join/<token> route stores the opaque token in sessionStorage before it
  // reaches this page. That survives OAuth and first-run avatar setup; as soon
  // as auth, profile, avatar, and the socket are ready, redeem it once.
  useEffect(() => {
    if (
      appStep !== "home" ||
      !pendingShareInvite ||
      gameConnectionState !== "connected" ||
      shareJoinAttemptRef.current === pendingShareInvite
    ) {
      return;
    }
    shareJoinAttemptRef.current = pendingShareInvite;
    joinShareInvite(pendingShareInvite, myAvatar);
    setAppStep("game");
  }, [
    appStep,
    pendingShareInvite,
    gameConnectionState,
    joinShareInvite,
    myAvatar,
    setAppStep,
  ]);
  useEffect(() => {
    if (!shareJoinAttemptRef.current || !game.sessionId) return;
    shareJoinAttemptRef.current = null;
    clearPendingShareInvite();
    setPendingShareInvite(null);
  }, [game.sessionId]);

  // ── Resume after a page reload ──────────────────────────────────────────
  // The server holds our spot during its reconnect grace window; once we're
  // back on home with an avatar loaded, silently rejoin the stored session —
  // and jump straight back into the game screen if the timer is running.
  useEffect(() => {
    if (appStep !== "home" || pendingShareInvite) return;
    if (game.connectionState !== "connected") return;
    const storedId = game.resumeSessionId;
    const presenceId = profile?.current_session_id ?? null;
    const sid = storedId || presenceId;
    if (!sid) return;
    // Share-invite redeem already waits for a live socket. Resume used to
    // emit immediately, consume the stored id, and miss the 60s grace window
    // whenever connectSocket() was still awaiting getSession(). A closed tab
    // also wipes sessionStorage, so fall back to localStorage and the profile
    // presence column the server still holds during grace. Retry if a stale
    // cached profile pointed at a different session than the live row.
    if (!storedId) {
      if (attemptedPresenceResumeRef.current === sid) return;
      attemptedPresenceResumeRef.current = sid;
    }
    resumingRef.current = true;
    game.joinSession(sid, myAvatar);
    if (storedId) game.consumeResumeSession();
  }, [appStep, game, myAvatar, pendingShareInvite, profile?.current_session_id]);
  useEffect(() => {
    if (resumingRef.current && game.sessionId && appStep === "home") {
      resumingRef.current = false;
      setAppStep("game");
    }
  }, [game.sessionId, appStep, setAppStep]);

  // Cached profiles drop presence fields; refresh them whenever home loads so
  // a new tab can see the session the server still holds during grace.
  useEffect(() => {
    if (appStep !== "home" || !profile?.id) return;
    void refreshProfilePresence();
  }, [appStep, profile?.id, refreshProfilePresence]);

  // Danger-styled sibling of the "Invite sent!" toast; rendered on every
  // screen that can produce an error (avatar/home/game)
  const errorToastEl = (
    <AnimatePresence>
      {errorToast && (
        <motion.div
          role="alert"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] bg-danger text-white text-sm font-bold px-4 py-2.5 rounded-xl shadow-lg"
        >
          {errorToast}
        </motion.div>
      )}
    </AnimatePresence>
  );

  // ── Overlays shared by the home and game screens ────────────────────────
  const sharedOverlays = (
    <>
      {errorToastEl}
      <ConnectionBanner
        state={game.connectionState}
        inSession={Boolean(game.sessionId)}
        onRetry={game.reconnect}
      />

      {game.focusSaveStatus !== "clear" && (
        <div
          role={game.focusSaveStatus === "unconfirmed" ? "alert" : "status"}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[70] max-w-[min(90vw,32rem)] rounded-xl bg-black/85 px-4 py-3 text-center text-xs font-bold text-white shadow-lg"
        >
          {game.focusSaveStatus === "pending"
            ? "Your focus history is waiting to save. We'll retry automatically."
            : game.focusSaveStatus === "unknown"
              ? "We can't check your focus history right now. Please check History later."
              : "A focus round may be missing from History. Please check History."}
        </div>
      )}

      {game.pendingInvite && (
        <InvitePopup
          invite={game.pendingInvite}
          onAccept={() => {
            if (game.pendingInvite?.sessionId)
              handleJoinSession(game.pendingInvite.sessionId);
            game.dismissInvite();
          }}
          onDismiss={game.dismissInvite}
        />
      )}
      <AnimatePresence>
        {(game.inviteSentName || shareInviteCopied) && (
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-go text-white text-sm font-bold px-4 py-2.5 rounded-xl shadow-lg"
          >
            {shareInviteCopied ? "Invite link copied!" : "Invite sent!"}
          </motion.div>
        )}
      </AnimatePresence>
      {profile && (
        <>
          <FriendsPanel
            open={friendsOpen}
            onClose={() => setFriendsOpen(false)}
            myProfile={profile}
            socketRef={game.socketRef}
            connectionState={game.connectionState}
            onJoinSession={handleJoinSession}
            onInviteFriend={handleSendInvite}
          />
          <StatsPanel
            open={statsOpen}
            onClose={() => setStatsOpen(false)}
            userId={profile.id}
            onViewFullStats={() => {
              setStatsOpen(false);
              setFullStatsOpen(true);
            }}
          />
          <StatsScreen
            open={fullStatsOpen}
            onClose={() => setFullStatsOpen(false)}
            userId={profile.id}
          />
          <PremiumModal
            open={premiumOpen}
            onClose={() => setPremiumOpen(false)}
            isPremium={isPremium}
            // The RPC has already flipped the column; this brings the local
            // copy into line so PetPicker unlocks without a reload.
            onClaimed={() => auth.updateProfile({ is_premium: true })}
          />
        </>
      )}
    </>
  );

  // ── Loading ─────────────────────────────────────────────────────────────
  if (appStep === "loading") {
    return (
      <div className="min-h-dvh bg-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-5">
          <div className="font-display text-4xl text-ink tracking-wide">
            Duodoro
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full bg-accent animate-bounce"
              style={{ animationDelay: "0ms" }}
            />
            <div
              className="w-2 h-2 rounded-full bg-accent animate-bounce"
              style={{ animationDelay: "150ms" }}
            />
            <div
              className="w-2 h-2 rounded-full bg-accent animate-bounce"
              style={{ animationDelay: "300ms" }}
            />
          </div>
          <span className="text-faint text-xs">signing you in...</span>
        </div>
      </div>
    );
  }

  // ── Landing ─────────────────────────────────────────────────────────────
  if (appStep === "landing") {
    return <LandingPage />;
  }

  // ── Avatar creator ──────────────────────────────────────────────────────
  if (appStep === "avatar") {
    const isEditing = !!profile?.avatar_config;
    return (
      <div className="min-h-dvh bg-bg texture-dots flex items-center justify-center p-6">
        <AvatarCreator
          initialConfig={myAvatar}
          initialDisplayName={profile?.display_name ?? ""}
          onBack={isEditing ? () => setAppStep("home") : undefined}
          onSave={async (config, name, username) => {
            // Claim username (first setup only)
            if (username && profile) {
              try {
                const { data, error } = await sb.rpc("claim_username", {
                  desired_username: username,
                });
                if (error) throw error;
                const tag = data as { username: string; discriminator: string };
                auth.updateProfile({
                  username: tag.username,
                  discriminator: tag.discriminator,
                });
              } catch (err) {
                showError(
                  err instanceof Error
                    ? err.message
                    : "Failed to claim username",
                );
                return;
              }
            }
            // Don't leave the editor on a failed write — the old behaviour
            // advanced to home either way, so a dropped save looked identical
            // to a successful one until you opened another device.
            if (!(await auth.saveAvatar(config))) {
              showError("Couldn't save your character. Please try again.");
              return;
            }
            if (name && profile) {
              // RLS refusing this matches zero rows rather than erroring, so
              // .select() is what distinguishes "saved" from "silently declined".
              const { data, error } = await sb
                .from("profiles")
                .update({ display_name: name })
                .eq("id", profile.id)
                .select("id");
              if (error || !data || data.length === 0) {
                showError("Couldn't save your display name. Please try again.");
                return;
              }
              auth.updateProfile({
                display_name: name,
                avatar_config: config,
              });
            }
            setAppStep("home");
          }}
        />
        {errorToastEl}
      </div>
    );
  }

  // ── Home Dashboard ──────────────────────────────────────────────────────
  if (appStep === "home") {
    return (
      <>
        <HomeDashboard
          profile={profile!}
          activeSessionId={
            game.sessionId ||
            game.resumeSessionId ||
            profile?.current_session_id ||
            undefined
          }
          socketRef={game.socketRef}
          connectionState={game.connectionState}
          onFocus={handleFocus}
          onOpenPremium={() => setPremiumOpen(true)}
          onRejoinSession={handleRejoinSession}
          onJoinSession={handleJoinSession}
          onInvite={handleSendInvite}
          onEditAvatar={() => setAppStep("avatar")}
          onChangeUsername={() => setUsernameModalOpen(true)}
          onChangeDisplayName={() => setDisplayNameModalOpen(true)}
          onSignOut={async () => {
            const { signOut } = await import("@/lib/supabase");
            await signOut();
          }}
          onAccountDeleted={async () => {
            localStorage.removeItem("duodoro_profile");
            localStorage.removeItem("duodoro:session");
            sessionStorage.removeItem("duodoro:session");
            await sb.auth.signOut({ scope: "local" });
            router.replace("/");
          }}
          onOpenFriends={() => {
            setFriendsOpen(true);
            setStatsOpen(false);
          }}
          onOpenStats={() => {
            setStatsOpen((o) => !o);
            setFriendsOpen(false);
          }}
        />
        {sharedOverlays}
        <UsernameChangeModal
          open={usernameModalOpen}
          currentUsername={profile?.username ?? ""}
          onClose={() => setUsernameModalOpen(false)}
          onSubmit={async (newUsername) => {
            const { data, error } = await sb.rpc("claim_username", {
              desired_username: newUsername,
            });
            if (error) throw error;
            const tag = data as { username: string; discriminator: string };
            auth.updateProfile({
              username: tag.username,
              discriminator: tag.discriminator,
              username_changed: true,
            });
            setUsernameModalOpen(false);
          }}
        />
        <DisplayNameChangeModal
          open={displayNameModalOpen}
          currentName={profile?.display_name ?? profile?.username ?? ""}
          changedAt={profile?.display_name_changed_at ?? null}
          onClose={() => setDisplayNameModalOpen(false)}
          onSubmit={async (newName) => {
            const { data, error } = await sb.rpc("change_display_name", {
              new_name: newName,
            });
            if (error) throw error;
            const result = data as {
              display_name: string;
              display_name_changed_at: string;
            };
            auth.updateProfile({
              display_name: result.display_name,
              display_name_changed_at: result.display_name_changed_at,
            });
            setDisplayNameModalOpen(false);
          }}
        />
      </>
    );
  }

  // ── Game Screen ─────────────────────────────────────────────────────────
  return (
    <div
      className="h-dvh bg-bg text-white relative overflow-hidden"
      onClick={() => setProfileMenuOpen(false)}
    >
      {/* ── Game World (full-screen background) ── */}
      <div className="absolute inset-0">
        <GameWorld
          worldId={game.myWorld}
          phase={game.phase}
          focusProgress={game.focusProgress}
          returningProgress={game.returningProgress}
          me={{ id: game.myId, avatar: myAvatar }}
          partner={game.partner}
          myPet={game.myPet}
          partnerPet={game.partnerPet}
          myPetStage={game.myPetStage}
          partnerPetStage={game.partnerPetStage}
          partnerDisconnected={game.partnerDisconnected}
          myName={profile?.display_name ?? profile?.username}
          partnerName={game.partnerName}
        />
      </div>

      {/* ── Overlay UI ── */}
      <div className="relative z-10 flex flex-col h-full">
        <SessionTopBar
          phase={game.phase}
          displayName={displayName}
          username={profile?.username}
          discriminator={profile?.discriminator}
          initial={initial}
          isPremium={isPremium}
          friendsOpen={friendsOpen}
          notesOpen={notesOpen}
          statsOpen={statsOpen}
          profileMenuOpen={profileMenuOpen}
          onToggleFriends={() => {
            setFriendsOpen((o) => !o);
            setNotesOpen(false);
            setStatsOpen(false);
          }}
          onToggleNotes={() => {
            setNotesOpen((o) => !o);
            setFriendsOpen(false);
            setStatsOpen(false);
          }}
          onToggleStats={() => {
            setStatsOpen((o) => !o);
            setNotesOpen(false);
            setFriendsOpen(false);
          }}
          onToggleProfileMenu={() => setProfileMenuOpen((o) => !o)}
          onGoHome={() => setAppStep("home")}
          onEditAvatar={() => {
            setAppStep("avatar");
            setProfileMenuOpen(false);
          }}
          onOpenPremium={() => {
            setPremiumOpen(true);
            setProfileMenuOpen(false);
          }}
          onSignOut={async () => {
            const { signOut } = await import("@/lib/supabase");
            await signOut();
            setProfileMenuOpen(false);
          }}
        />

        <SessionHUD
          phase={game.phase}
          serverMode={game.serverMode}
          sessionStarted={game.sessionStarted}
          playerCount={game.playerCount}
          timeLeft={game.timeLeft}
          flowElapsed={game.flowElapsed}
          phaseProgress={game.phaseProgress}
          timerMode={game.timerMode}
          focusDuration={game.focusDuration}
          breakDuration={game.breakDuration}
          onTimerModeChange={game.setTimerMode}
          onFocusDurationChange={game.setFocusDuration}
          onBreakDurationChange={game.setBreakDuration}
          myPet={game.myPet}
          onPetSelect={game.setMyPet}
          isPremium={isPremium}
          onPremiumClick={() => setPremiumOpen(true)}
          onStart={game.startSession}
          onStop={game.stopSession}
          onFinishFlow={game.finishFlowFocus}
          onShareInvite={handleShareInvite}
          shareInviteBusy={shareInviteBusy}
          onLeave={handleLeaveSession}
        />
      </div>

      {sharedOverlays}
      {profile && (
        <StickyNote
          open={notesOpen}
          onClose={() => setNotesOpen(false)}
          userId={profile.id}
          roomCode={game.sessionId || null}
          partnerUserId={game.partnerUserId}
          partnerName={game.partnerName}
        />
      )}
    </div>
  );
}
