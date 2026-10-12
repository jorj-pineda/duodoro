"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStats } from "@/lib/useStats";
import { formatDuration, formatTag } from "@/lib/format";
import { useTasks } from "@/hooks/useTasks";
import { useOnlineFriends } from "@/hooks/useOnlineFriends";
import DailyFocusGoal from "./DailyFocusGoal";
import SharedDailyGoals from "./SharedDailyGoals";
import { useLocalDay } from "@/hooks/useDailyFocusGoal";
import TaskSection from "./TaskSection";
import SharedMilestones from "./SharedMilestones";
import FriendsOnlineSection from "./FriendsOnlineSection";
import ThemeToggle from "./ThemeToggle";
import SoundToggle from "./SoundToggle";
import FocusNotificationSetting from "./FocusNotificationSetting";
import WeeklyDuoRecap from "./WeeklyDuoRecap";
import WorldNowCard from "./WorldNowCard";
import Button from "./Button";
import AccountSettingsModal from "./AccountSettingsModal";
import {
  UsersIcon,
  ChartIcon,
  PencilIcon,
  StarIcon,
  SignOutIcon,
} from "./Icons";
import type { Profile } from "@/lib/types";
import type { DuodoroSocket } from "@/lib/socketContract";
import type { ConnectionState } from "@/hooks/useSessionConnection";

interface Props {
  profile: Profile;
  activeSessionId?: string;
  socketRef: { current: DuodoroSocket | null };
  connectionState?: ConnectionState;
  /** Starts a session in whatever world the rotation is on — see WorldNowCard. */
  onFocus: () => void;
  /**
   * Opens the premium modal. Home had no such prop at all: its Upgrade button
   * called setProfileMenuOpen(false) and stopped there, so the primary
   * monetization surface silently did nothing while the in-session one worked.
   */
  onOpenPremium: () => void;
  onRejoinSession: () => void;
  onJoinSession: (sessionId: string) => void;
  onInvite: (friendId: string) => void;
  onEditAvatar: () => void;
  onChangeUsername: () => void;
  onChangeDisplayName: () => void;
  onSignOut: () => void;
  onAccountDeleted: () => void | Promise<void>;
  onOpenFriends: () => void;
  onOpenStats: () => void;
  onOpenShortcuts?: () => void;
}

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const subscribeToGreeting = () => () => {};
const getServerGreeting = () => "Hello";
const getLocalGreeting = () => greetingForHour(new Date().getHours());

function useLocalGreeting() {
  return useSyncExternalStore(
    subscribeToGreeting,
    getLocalGreeting,
    getServerGreeting,
  );
}

function QuickStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-surface border border-line rounded-xl px-3 py-3 text-center flex-1">
      <p className="text-faint text-[10px] font-semibold uppercase tracking-wider">
        {label}
      </p>
      <p
        className={`text-xl font-bold font-mono tabular-nums mt-0.5 ${
          accent ? "text-accent" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default function HomeDashboard({
  profile,
  activeSessionId,
  socketRef,
  connectionState = "connecting",
  onFocus,
  onOpenPremium,
  onRejoinSession,
  onJoinSession,
  onInvite,
  onEditAvatar,
  onChangeUsername,
  onChangeDisplayName,
  onSignOut,
  onAccountDeleted,
  onOpenFriends,
  onOpenStats,
  onOpenShortcuts,
}: Props) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const greeting = useLocalGreeting();

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setProfileMenuOpen(false);
      profileMenuButtonRef.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [profileMenuOpen]);
  const {
    personalStats,
    dailyFocus,
    loading,
    fetchStats,
    error: statsError,
    loaded,
    retry: retryStats,
  } = useStats(profile.id);

  const {
    tasks,
    newTask,
    setNewTask,
    addTask,
    toggleTask,
    deleteTask,
    editTask,
    pendingTasks,
    completedTasks,
    clearCompleted,
    error: taskError,
    clearError: clearTaskError,
  } = useTasks(profile.id);

  const {
    friends,
    onlineFriendIds,
    error: friendsError,
    loaded: friendsLoaded,
    retry: retryFriends,
  } = useOnlineFriends(profile.id, socketRef, connectionState);

  const displayName = profile.display_name ?? profile.username ?? "You";
  const initial = displayName.charAt(0).toUpperCase();
  const isPremium = profile.is_premium ?? false;

  const today = useLocalDay();
  useEffect(() => {
    if (!today) return;
    // Refresh after returning from a round, even inside the shared cache TTL.
    void fetchStats(true);
    const refresh = () => { if (document.visibilityState === "visible") void fetchStats(true); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [fetchStats, today]);

  const onlineFriends = friends.filter(
    (f) => onlineFriendIds.has(f.id) || !!f.current_session_id,
  );

  return (
    <div
      className="min-h-dvh bg-bg texture-dots flex flex-col"
      onClick={() => setProfileMenuOpen(false)}
    >
      {/* Top bar — safe-area insets folded into the padding, see SessionTopBar */}
      <div className="flex items-center justify-between pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))] bg-surface/80 backdrop-blur border-b border-line">
        <div className="flex items-center gap-2">
          <span className="font-display text-lg text-ink tracking-wide">
            Duodoro
          </span>
          {activeSessionId && (
            <div
              className="w-2 h-2 rounded-full bg-gold animate-pulse"
              title="Session in progress"
              role="status"
              aria-label="Session in progress"
            />
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            aria-label="Open friends"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFriends();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-muted hover:text-ink hover:bg-raise transition-colors"
          >
            <UsersIcon /> <span className="hidden sm:inline">Friends</span>
          </button>
          <button
            aria-label="Open stats"
            onClick={(e) => {
              e.stopPropagation();
              onOpenStats();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-muted hover:text-ink hover:bg-raise transition-colors"
          >
            <ChartIcon /> <span className="hidden sm:inline">Stats</span>
          </button>
          {onOpenShortcuts && <button aria-label="Keyboard shortcuts" onClick={onOpenShortcuts} className="hidden sm:inline-flex items-center justify-center min-h-11 min-w-11 text-muted text-sm">?</button>}
          <SoundToggle />
          <ThemeToggle />
          <div className="relative ml-1">
            <button
              ref={profileMenuButtonRef}
              aria-label="Open account menu"
              aria-haspopup="true"
              aria-expanded={profileMenuOpen}
              aria-controls="home-account-menu"
              onClick={(e) => {
                e.stopPropagation();
                setProfileMenuOpen((o) => !o);
              }}
              className="w-8 h-8 rounded-full bg-accent/15 border border-accent/40 flex items-center justify-center text-accent text-sm font-bold hover:bg-accent/25 transition-colors"
            >
              {initial}
            </button>
            {profileMenuOpen && (
              <div
                id="home-account-menu"
                aria-label="Account menu"
                className="absolute top-10 right-0 z-50 bg-surface border border-line rounded-xl p-3 shadow-xl min-w-48 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-5rem-env(safe-area-inset-bottom))] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-ink font-bold text-sm mb-0.5">
                  {displayName}
                </p>
                <p className="text-faint text-xs font-mono mb-3">
                  @{profile.discriminator ? formatTag(profile.username, profile.discriminator) : profile.username}
                </p>
                <button
                  onClick={() => {
                    onEditAvatar();
                    setProfileMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 text-left text-xs text-muted hover:text-ink py-1.5 transition-colors"
                >
                  <PencilIcon className="w-3.5 h-3.5" /> Edit character
                </button>
                {!profile.username_changed && (
                  <button
                    onClick={() => {
                      onChangeUsername();
                      setProfileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 text-left text-xs text-accent hover:text-accent-deep py-1.5 transition-colors"
                  >
                    <PencilIcon className="w-3.5 h-3.5" /> Change username (1x)
                  </button>
                )}
                <button
                  onClick={() => {
                    onChangeDisplayName();
                    setProfileMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 text-left text-xs text-muted hover:text-ink py-1.5 transition-colors"
                >
                  <PencilIcon className="w-3.5 h-3.5" /> Change display name
                </button>
                {!isPremium && (
                  <button
                    onClick={() => {
                      onOpenPremium();
                      setProfileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 text-left text-xs text-gold hover:text-gold-deep py-1.5 transition-colors"
                  >
                    <StarIcon className="w-3.5 h-3.5" /> Unlock companions — free
                  </button>
                )}
                <button
                  onClick={() => {
                    setAccountSettingsOpen(true);
                    setProfileMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 text-left text-xs text-muted hover:text-ink py-1.5 transition-colors"
                >
                  Privacy & account
                </button>
                <button
                  onClick={() => {
                    onSignOut();
                    setProfileMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 text-left text-xs text-muted hover:text-danger py-1.5 transition-colors"
                >
                  <SignOutIcon className="w-3.5 h-3.5" /> Sign out
                </button>
{onOpenShortcuts && <button onClick={() => { setProfileMenuOpen(false); onOpenShortcuts(); }} className="sm:hidden w-full min-h-11 text-left text-xs text-muted">Keyboard shortcuts</button>}
                <FocusNotificationSetting />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
          <div>
            <h1 className="font-display text-3xl text-ink">
              {greeting}, {displayName}
            </h1>
            <p className="text-muted text-sm mt-1">Ready to focus?</p>
          </div>

          {!loading && personalStats && (
            <div className="flex gap-2">
              <QuickStat
                label="Total"
                value={formatDuration(personalStats.totalFocusTime)}
                accent
              />
              <QuickStat
                label="This Week"
                value={formatDuration(personalStats.weeklyFocusTime)}
              />
              <QuickStat
                label="Streak"
                value={`${personalStats.currentStreak}d`}
                accent
              />
            </div>
          )}

          {/* Zeros are only shown once a fetch has actually succeeded. Before,
              a failed load rendered "0m / 0m / 0d" — identical to a brand-new
              account — so someone with a 40-day streak and one bad request was
              told their history was gone. */}
          {!loading && !personalStats && loaded && !statsError && (
            <div className="flex gap-2">
              <QuickStat label="Total" value="0m" />
              <QuickStat label="This Week" value="0m" />
              <QuickStat label="Streak" value="0d" />
            </div>
          )}

          {!loading && statsError && (
            <div
              role="alert"
              className="flex items-center gap-3 bg-surface border border-danger/30 rounded-xl px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-danger text-xs font-semibold">
                  Couldn&apos;t load your stats
                </p>
                <p className="text-faint text-[11px] mt-0.5">
                  Your history is safe — this was a connection problem.
                </p>
              </div>
              <Button variant="surface" size="sm" onClick={retryStats}>
                Retry
              </Button>
            </div>
          )}

          <DailyFocusGoal key={profile.id} userId={profile.id} today={today} dailyFocus={dailyFocus}
            loading={loading} loaded={loaded} error={statsError} />

          <SharedDailyGoals key={`shared:${profile.id}`} userId={profile.id} friends={friends}
            friendsError={friendsError} friendsLoaded={friendsLoaded} onOpenFriends={onOpenFriends} />

          <WeeklyDuoRecap key={`weekly:${profile.id}`} userId={profile.id} connected={connectionState === "connected"} />

          <SharedMilestones key={`milestones:${profile.id}`} userId={profile.id} connected={connectionState === "connected"} />

          <TaskSection
            tasks={tasks}
            pendingTasks={pendingTasks}
            completedTasks={completedTasks}
            newTask={newTask}
            setNewTask={setNewTask}
            addTask={addTask}
            toggleTask={toggleTask}
            deleteTask={deleteTask}
            editTask={editTask}
            clearCompleted={clearCompleted}
            error={taskError}
            onDismissError={clearTaskError}
          />

          <FriendsOnlineSection
            onlineFriends={onlineFriends}
            error={friendsError}
            retry={retryFriends}
            onOpenFriends={onOpenFriends}
            onJoinSession={onJoinSession}
            onInvite={onInvite}
          />

          <WorldNowCard />

          <div className="space-y-2 pt-2">
            {activeSessionId && (
              <Button variant="gold" size="lg" fullWidth onClick={onRejoinSession}>
                Return to session
              </Button>
            )}
            <Button
              variant={activeSessionId ? "surface" : "accent"}
              size={activeSessionId ? "md" : "lg"}
              fullWidth
              onClick={() => onFocus()}
            >
              {activeSessionId ? "New session" : "Focus"}
            </Button>
          </div>
        </div>
      </div>
      {accountSettingsOpen ? (
        <AccountSettingsModal
          onClose={() => setAccountSettingsOpen(false)}
          onDeleted={onAccountDeleted}
          socketRef={socketRef}
        />
      ) : null}
    </div>
  );
}
