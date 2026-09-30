"use client";

import { useEffect, useRef } from "react";
import type { GamePhase } from "./GameWorld";
import ThemeToggle from "./ThemeToggle";
import SoundToggle from "./SoundToggle";
import FocusNotificationSetting from "./FocusNotificationSetting";
import {
  UsersIcon,
  ChartIcon,
  NoteIcon,
  PencilIcon,
  StarIcon,
  SignOutIcon,
} from "./Icons";

function SessionStatusDot({ phase }: { phase: GamePhase }) {
  const color =
    phase === "focus"
      ? "bg-go"
      : phase === "waiting" || phase === "ready"
        ? "bg-faint"
        : "bg-gold";
  return (
    <div
      className={`w-2 h-2 ${color} ${phase !== "waiting" && phase !== "ready" ? "animate-pulse" : ""}`}
      role="status"
      aria-label={`Session phase: ${phase}`}
    />
  );
}

interface SessionTopBarProps {
  phase: GamePhase;
  displayName: string;
  username?: string;
  discriminator?: string;
  initial: string;
  isPremium: boolean;
  friendsOpen: boolean;
  notesOpen: boolean;
  statsOpen: boolean;
  profileMenuOpen: boolean;
  onToggleFriends: () => void;
  onToggleNotes: () => void;
  onToggleStats: () => void;
  onToggleProfileMenu: () => void;
  onGoHome: () => void;
  onEditAvatar: () => void;
  onOpenPremium: () => void;
  onSignOut: () => void;
}

export default function SessionTopBar({
  phase,
  displayName,
  username,
  discriminator,
  initial,
  isPremium,
  friendsOpen,
  notesOpen,
  statsOpen,
  profileMenuOpen,
  onToggleFriends,
  onToggleNotes,
  onToggleStats,
  onToggleProfileMenu,
  onGoHome,
  onEditAvatar,
  onOpenPremium,
  onSignOut,
}: SessionTopBarProps) {
  const profileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const onToggleProfileMenuRef = useRef(onToggleProfileMenu);
  useEffect(() => {
    onToggleProfileMenuRef.current = onToggleProfileMenu;
  }, [onToggleProfileMenu]);
  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onToggleProfileMenuRef.current();
      profileMenuButtonRef.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [profileMenuOpen]);
  const tabClass = (open: boolean) =>
    `flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
      open
        ? "bg-raise text-ink"
        : "text-muted hover:text-ink hover:bg-raise"
    }`;

  return (
    // Safe-area insets are folded into the base padding rather than added by a
    // separate utility: layout.tsx sets viewportFit "cover", so without them the
    // bar's contents sit under the notch in portrait and under the rounded
    // corner in landscape. The bar's own background still extends underneath.
    <div className="grid grid-cols-[1fr_auto_1fr] items-center pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))] bg-surface/85 backdrop-blur border-b border-line z-10">
      {/* Left: Friends */}
      <div className="flex items-center justify-end pr-2">
        <button
          aria-label="Toggle friends panel"
          aria-expanded={friendsOpen}
          aria-controls="friends-panel"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFriends();
          }}
          className={tabClass(friendsOpen)}
        >
          <UsersIcon /> <span className="hidden sm:inline">Friends</span>
        </button>
      </div>

      {/* Center: Duodoro + status dot */}
      <button
        aria-label="Return to dashboard"
        onClick={(e) => {
          e.stopPropagation();
          onGoHome();
        }}
        className="flex flex-col items-center px-3 py-0.5 rounded-lg hover:bg-raise transition-colors"
      >
        <span className="font-display text-ink tracking-wide text-base leading-tight">
          Duodoro
        </span>
        <SessionStatusDot phase={phase} />
      </button>

      {/* Right: Notes, Stats, Sound, Theme, Account */}
      <div className="flex items-center gap-1.5 pl-2">
        <button
          aria-label="Toggle notes panel"
          aria-expanded={notesOpen}
          aria-controls="notes-panel"
          onClick={(e) => {
            e.stopPropagation();
            onToggleNotes();
          }}
          className={tabClass(notesOpen)}
        >
          <NoteIcon /> <span className="hidden sm:inline">Notes</span>
        </button>
        <button
          aria-label="Toggle stats panel"
          aria-expanded={statsOpen}
          aria-controls="stats-panel"
          onClick={(e) => {
            e.stopPropagation();
            onToggleStats();
          }}
          className={tabClass(statsOpen)}
        >
          <ChartIcon /> <span className="hidden sm:inline">Stats</span>
        </button>
        <SoundToggle />
        <ThemeToggle />
        <div className="flex-1" />
        <div className="relative">
          <button
            ref={profileMenuButtonRef}
            aria-label="Toggle account menu"
            aria-haspopup="true"
            aria-expanded={profileMenuOpen}
            aria-controls="session-account-menu"
            onClick={(e) => {
              e.stopPropagation();
              onToggleProfileMenu();
            }}
            className="w-7 h-7 rounded-full bg-accent/15 border border-accent/40 flex items-center justify-center text-accent text-xs font-bold hover:bg-accent/25 transition-colors"
          >
            {initial}
          </button>
          {profileMenuOpen && (
            <div
              id="session-account-menu"
              aria-label="Account menu"
              className="absolute top-9 right-0 z-50 bg-surface border border-line rounded-xl p-3 shadow-xl min-w-48 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-5rem-env(safe-area-inset-bottom))] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-ink font-bold text-sm mb-0.5">
                {displayName}
              </p>
              <p className="text-faint text-xs font-mono mb-3">
                @{username}{discriminator ? `#${discriminator}` : ""}
              </p>
              <button
                onClick={onEditAvatar}
                className="w-full flex items-center gap-2 text-left text-xs text-muted hover:text-ink py-1.5 transition-colors"
              >
                <PencilIcon className="w-3.5 h-3.5" /> Edit character
              </button>
              {!isPremium && (
                <button
                  onClick={onOpenPremium}
                  className="w-full flex items-center gap-2 text-left text-xs text-gold hover:text-gold-deep py-1.5 transition-colors"
                >
                  <StarIcon className="w-3.5 h-3.5" /> Unlock companions — free
                </button>
              )}
              <button
                onClick={onSignOut}
                className="w-full flex items-center gap-2 text-left text-xs text-muted hover:text-danger py-1.5 transition-colors"
              >
                <SignOutIcon className="w-3.5 h-3.5" /> Sign out
              </button>
              <FocusNotificationSetting />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
