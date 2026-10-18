"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useModalAccessibility } from "@/hooks/useModalAccessibility";
import { handleTabKeyNavigation } from "@/lib/tabKeyboard";
import { WORLDS } from "@/lib/avatarData";
import type { Profile, ProfileSearchResult } from "@/lib/types";
import { formatTag } from "@/lib/format";
import { useFriendsList } from "@/hooks/useFriendsList";
import { useFriendSearch } from "@/hooks/useFriendSearch";
import { useOnlineFriends } from "@/hooks/useOnlineFriends";
import type { DuodoroSocket } from "@/lib/socketContract";
import type { ConnectionState } from "@/hooks/useSessionConnection";
import WorldThumb from "./WorldThumb";
import { CheckIcon, CloseIcon } from "./Icons";

interface Props {
  open: boolean;
  onClose: () => void;
  myProfile: Profile;
  socketRef: { current: DuodoroSocket | null };
  connectionState?: ConnectionState;
  onJoinSession: (sessionId: string) => void;
  onInviteFriend: (friendId: string) => void;
}

type Tab = "friends" | "requests" | "find";
const TABS: readonly Tab[] = ["friends", "requests", "find"];

const WORLD_LABEL: Record<string, string> = Object.fromEntries(
  WORLDS.map((w) => [w.id, w.label]),
);

function StatusDot({
  online,
  inSession,
}: {
  online: boolean;
  inSession: boolean;
}) {
  return (
    <div
      className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
        inSession ? "bg-go animate-pulse" : online ? "bg-gold" : "bg-faint"
      }`}
      title={inSession ? "In session" : online ? "Online" : "Offline"}
    />
  );
}

function FriendRow({
  friend,
  online,
  onJoin,
  onInvite,
}: {
  friend: Profile;
  online: boolean;
  onJoin: (sessionId: string) => void;
  onInvite: () => void;
}) {
  const inSession = !!friend.current_session_id;
  const worldLabel = friend.current_world_id
    ? WORLD_LABEL[friend.current_world_id]
    : null;
  const name = friend.display_name ?? friend.username;

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-raise transition-colors group">
      <StatusDot online={online} inSession={inSession} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-ink truncate">{name}</p>
        {inSession && worldLabel && friend.current_world_id ? (
          <p className="text-xs text-go truncate flex items-center gap-1.5">
            <WorldThumb worldId={friend.current_world_id} />
            In {worldLabel}
          </p>
        ) : (
          <p className="text-xs text-faint font-mono truncate">
            @{friend.discriminator ? formatTag(friend.username, friend.discriminator) : friend.username}
          </p>
        )}
      </div>
      {inSession && friend.current_session_id ? (
        <button
          onClick={() => onJoin(friend.current_session_id!)}
          className="text-xs bg-go/15 hover:bg-go/30 text-go font-bold px-2.5 py-1 rounded-lg transition-colors"
        >
          Join
        </button>
      ) : (
        <button
          onClick={onInvite}
          className="text-xs bg-raise hover:bg-line text-muted font-bold px-2.5 py-1 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
        >
          Invite
        </button>
      )}
    </div>
  );
}

function RequestRow({
  requester,
  friendshipId,
  onAccept,
  onDecline,
}: {
  requester: ProfileSearchResult;
  friendshipId: string;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-raise">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-ink truncate">
          {requester.display_name ?? requester.username}
        </p>
        <p className="text-xs text-faint">wants to be friends</p>
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={() => onAccept(friendshipId)}
          aria-label="Accept"
          className="text-xs bg-go hover:brightness-105 text-white font-bold px-2.5 py-1 rounded-lg transition-all"
        >
          <CheckIcon className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDecline(friendshipId)}
          aria-label="Decline"
          className="text-xs bg-line hover:bg-faint text-ink font-bold px-2.5 py-1 rounded-lg transition-colors"
        >
          <CloseIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export default function FriendsPanel({
  open,
  onClose,
  myProfile,
  socketRef,
  connectionState = "connecting",
  onJoinSession,
  onInviteFriend,
}: Props) {
  const dialogRef = useModalAccessibility<HTMLDivElement>(open, onClose);
  const [tab, setTab] = useState<Tab>("friends");
  const {
    friends,
    requests,
    acceptRequest,
    declineRequest,
    loading: listLoading,
    loaded: listLoaded,
    loadError,
    retry: retryList,
    error: listError,
    clearError: clearListError,
  } = useFriendsList(myProfile.id, open);
  const { onlineFriendIds } = useOnlineFriends(
    myProfile.id,
    socketRef,
    connectionState,
  );
  const { searchQuery, setSearchQuery, searchResults, loading, handleSearch, sentRequests, sendRequest, error: searchError, clearError: clearSearchError } = useFriendSearch(myProfile.id);

  const friendIds = new Set(friends.map((f) => f.id));
  const error = listError ?? searchError;
  const dismissError = () => {
    clearListError();
    clearSearchError();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-30 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {/* Vertically-centered panel on the left */}
          <div className="fixed inset-x-2 sm:inset-x-auto sm:left-4 top-0 bottom-0 z-40 flex items-stretch py-3 pointer-events-none">
            <motion.div
              ref={dialogRef}
              id="friends-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="friends-panel-title"
              tabIndex={-1}
              className="pointer-events-auto w-full sm:w-80 bg-surface border border-line flex flex-col shadow-2xl rounded-2xl overflow-hidden"
              initial={{ x: -60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -60, opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-4 border-b border-line">
                <h2 id="friends-panel-title" className="font-display text-lg text-ink tracking-wide">
                  Friends
                </h2>
                <button
                  data-autofocus
                  onClick={onClose}
                  aria-label="Close"
                  className="text-faint hover:text-ink transition-colors"
                >
                  <CloseIcon />
                </button>
              </div>

              {/* Tabs */}
              <div role="tablist" aria-label="Friends sections" className="flex border-b border-line">
                {TABS.map((t) => (
                  <button
                    key={t}
                    id={`friends-tab-${t}`}
                    role="tab"
                    aria-selected={tab === t}
                    aria-controls="friends-tab-panel"
                    tabIndex={tab === t ? 0 : -1}
                    onKeyDown={(event) =>
                      handleTabKeyNavigation(
                        event,
                        TABS,
                        tab,
                        setTab,
                        (next) => `friends-tab-${next}`,
                      )
                    }
                    onClick={() => setTab(t)}
                    className={`flex-1 py-2.5 text-xs font-bold capitalize transition-colors ${
                      tab === t
                        ? "text-accent border-b-2 border-accent"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {t}
                    {t === "requests" && requests.length > 0 && (
                      <span className="ml-1 bg-red-500 text-white rounded-full px-1 text-[10px]">
                        {requests.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Action errors — these operations used to fail silently */}
              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 px-3 py-2.5 bg-danger/10 border-b border-danger/30 text-danger text-xs"
                >
                  <span className="flex-1">{error}</span>
                  <button
                    onClick={dismissError}
                    aria-label="Dismiss error"
                    className="font-bold hover:opacity-70"
                  >
                    <CloseIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {loadError && (
                <div
                  role="alert"
                  className="flex items-center gap-2 px-3 py-2.5 bg-danger/10 border-b border-danger/30 text-xs"
                >
                  <span className="flex-1 text-danger">{loadError}</span>
                  <button
                    onClick={retryList}
                    disabled={listLoading}
                    className="font-bold text-danger hover:opacity-70 disabled:opacity-40"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Content */}
              <div
                id="friends-tab-panel"
                role="tabpanel"
                aria-labelledby={`friends-tab-${tab}`}
                className="flex-1 overflow-y-auto p-3"
              >
                {/* Friends tab */}
                {tab === "friends" && (
                  <div>
                    {!listLoaded ? (
                      <p className="text-faint text-sm text-center py-8">
                        {listLoading || !loadError
                          ? "Loading friends…"
                          : "Friends are unavailable right now."}
                      </p>
                    ) : friends.length === 0 ? (
                      <p className="text-faint text-sm text-center py-8">
                        No friends yet.
                        <br />
                        Use the &quot;Find&quot; tab to add some!
                      </p>
                    ) : (
                      friends.map((f) => (
                        <FriendRow
                          key={f.id}
                          friend={f}
                          online={onlineFriendIds.has(f.id)}
                          onJoin={onJoinSession}
                          onInvite={() => onInviteFriend(f.id)}
                        />
                      ))
                    )}
                  </div>
                )}

                {/* Requests tab */}
                {tab === "requests" && (
                  <div className="space-y-2">
                    {!listLoaded ? (
                      <p className="text-faint text-sm text-center py-8">
                        {listLoading || !loadError
                          ? "Loading requests…"
                          : "Requests are unavailable right now."}
                      </p>
                    ) : requests.length === 0 ? (
                      <p className="text-faint text-sm text-center py-8">
                        No pending requests
                      </p>
                    ) : (
                      requests.map((r) => (
                        <RequestRow
                          key={r.id}
                          requester={r.requester}
                          friendshipId={r.id}
                          onAccept={acceptRequest}
                          onDecline={declineRequest}
                        />
                      ))
                    )}
                  </div>
                )}

                {/* Find tab */}
                {tab === "find" && (
                  <div>
                    <div className="flex gap-2 mb-3">
                      <input
                        aria-label="Search for friends"
                        className="flex-1 bg-raise border border-line rounded-xl px-3 py-2 text-ink text-sm placeholder-faint focus:outline-none focus:border-accent"
                        placeholder="Search name or tag#0000"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                      />
                      <button
                        onClick={handleSearch}
                        disabled={loading}
                        className="bg-accent hover:brightness-105 text-white font-bold px-3 py-2 rounded-xl text-sm transition-all disabled:opacity-40"
                      >
                        {loading ? "…" : "Go"}
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {searchResults.map((user) => {
                        const alreadyFriend = friendIds.has(user.id);
                        const sent = sentRequests.has(user.id);
                        return (
                          <div
                            key={user.id}
                            className="flex items-center gap-3 py-2 px-3 rounded-xl bg-raise"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-ink truncate">
                                {user.display_name ?? user.username}
                              </p>
                              <p className="text-xs text-faint font-mono">
                                @{user.discriminator ? formatTag(user.username, user.discriminator) : user.username}
                              </p>
                            </div>
                            {alreadyFriend ? (
                              <span className="text-xs text-faint">
                                Friends
                              </span>
                            ) : sent ? (
                              <span className="text-xs text-go">
                                Sent ✓
                              </span>
                            ) : (
                              <button
                                onClick={() => sendRequest(user.id)}
                                className="text-xs bg-accent/15 hover:bg-accent/30 text-accent font-bold px-2.5 py-1 rounded-lg transition-colors"
                              >
                                + Add
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer: my profile */}
              <div className="border-t border-line px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/15 border border-accent/40 flex items-center justify-center text-accent text-sm font-bold">
                  {(myProfile.display_name ?? myProfile.username)
                    .charAt(0)
                    .toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-ink truncate">
                    {myProfile.display_name ?? myProfile.username}
                  </p>
                  <button
                    onClick={() => {
                      const tag = myProfile.discriminator
                        ? formatTag(myProfile.username, myProfile.discriminator)
                        : myProfile.username;
                      navigator.clipboard.writeText(tag);
                    }}
                    className="text-xs text-faint font-mono hover:text-accent transition-colors"
                    title="Copy tag to clipboard"
                  >
                    @{myProfile.discriminator ? formatTag(myProfile.username, myProfile.discriminator) : myProfile.username}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
