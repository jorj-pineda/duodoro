"use client";
import { useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useStats } from "@/lib/useStats";
import { useModalAccessibility } from "@/hooks/useModalAccessibility";
import FocusCalendar from "./FocusCalendar";
import StatsErrorState from "./StatsErrorState";
import type { DailyFocus } from "@/lib/types";
import WorldThumb from "./WorldThumb";
import { CloseIcon } from "./Icons";

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Weekly Bar Chart ────────────────────────────────────────────────────────

function WeeklyChart({ days }: { days: DailyFocus[] }) {
  // Fed by get_daily_focus, which aggregates server-side over the caller's
  // whole history in their own timezone. This used to be derived from
  // recentSessions — capped at 20 rows — so anyone doing more than 20 focus
  // rounds in a week saw a silently undercounted chart, with the day buckets
  // computed in UTC against a local "today" on top of that.
  const dailyData = useMemo(
    () =>
      days.map((d) => ({
        date: d.day,
        // Parse as local, not UTC: new Date("2026-08-07") is midnight UTC and
        // renders as the previous weekday for anyone behind it.
        label: new Date(`${d.day}T00:00:00`).toLocaleDateString("en-US", {
          weekday: "short",
        }),
        minutes: Math.round(d.focusSeconds / 60),
      })),
    [days],
  );

  const maxMinutes = Math.max(...dailyData.map((d) => d.minutes), 1);

  return (
    <div className="bg-surface border border-line rounded-xl p-4">
      <p className="text-faint text-[10px] font-semibold uppercase tracking-wider mb-3">
        Last 7 Days
      </p>
      <div className="flex items-end gap-2 h-24">
        {dailyData.map((day) => (
          <div
            key={day.date}
            className="flex-1 flex flex-col items-center gap-1"
          >
            <span className="text-[9px] text-faint font-mono">
              {day.minutes > 0 ? `${day.minutes}m` : ""}
            </span>
            <div className="w-full flex items-end" style={{ height: "60px" }}>
              <div
                className="w-full rounded-t transition-all"
                style={{
                  height: `${Math.max((day.minutes / maxMinutes) * 100, day.minutes > 0 ? 8 : 2)}%`,
                  backgroundColor:
                    day.minutes > 0 ? "var(--accent)" : "var(--line)",
                }}
              />
            </div>
            <span className="text-[9px] text-faint">
              {day.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Large Stat Card ─────────────────────────────────────────────────────────

function BigStatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-surface border border-line rounded-xl px-4 py-3 text-center">
      <p className="text-faint text-[10px] font-semibold uppercase tracking-wider">
        {label}
      </p>
      <p
        className={`text-2xl font-bold font-mono tabular-nums mt-1 ${
          accent ? "text-accent" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function StatsScreen({ open, onClose, userId }: Props) {
  const dialogRef = useModalAccessibility<HTMLDivElement>(open, onClose);
  const {
    personalStats, duoStats, recentSessions, dailyFocus, loading, fetchStats,
    error: statsError, loaded, retry,
  } = useStats(userId);

  useEffect(() => {
    if (open) fetchStats();
  }, [open, fetchStats]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="stats-screen-title"
          tabIndex={-1}
          className="fixed inset-0 z-50 bg-bg overflow-y-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Header */}
          <div className="sticky top-0 z-10 bg-surface/90 backdrop-blur border-b border-line px-6 py-4 flex items-center justify-between">
            <h1 id="stats-screen-title" className="font-display text-ink tracking-wide text-xl">
              Your stats
            </h1>
            <button
              data-autofocus
              onClick={onClose}
              aria-label="Close"
              className="text-faint hover:text-ink transition-colors"
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
            <FocusCalendar key={userId} userId={userId} />
            {loading && (
              <p className="text-faint text-sm text-center py-12">
                Loading stats...
              </p>
            )}

            {!loading && personalStats && (
              <>
                {/* Personal Stats Grid */}
                <div>
                  <p className="text-faint text-xs font-semibold uppercase tracking-wider mb-3">
                    Personal
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <BigStatCard
                      label="Total Focus"
                      value={formatDuration(personalStats.totalFocusTime)}
                      accent
                    />
                    <BigStatCard
                      label="This Week"
                      value={formatDuration(personalStats.weeklyFocusTime)}
                    />
                    <BigStatCard
                      label="Sessions"
                      value={String(personalStats.sessionsCompleted)}
                    />
                    <BigStatCard
                      label="Avg Length"
                      value={formatDuration(personalStats.avgSessionLength)}
                    />
                    <BigStatCard
                      label="Current Streak"
                      value={`${personalStats.currentStreak}d`}
                      accent
                    />
                    <BigStatCard
                      label="Best Streak"
                      value={`${personalStats.longestStreak}d`}
                    />
                  </div>
                </div>

                {/* Weekly Chart */}
                <WeeklyChart days={dailyFocus} />

                {/* Duo Stats */}
                {duoStats.length > 0 && (
                  <div>
                    <p className="text-faint text-xs font-semibold uppercase tracking-wider mb-3">
                      Focus Partners
                    </p>
                    <div className="space-y-2">
                      {duoStats.map((duo, i) => (
                        <div
                          key={duo.partnerId}
                          className="flex items-center gap-3 bg-surface border border-line rounded-xl px-4 py-3"
                        >
                          <span
                            className={`text-sm font-bold ${
                              i === 0 ? "text-gold" : "text-faint"
                            }`}
                          >
                            {i === 0 ? "★" : `#${i + 1}`}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-ink truncate">
                              {duo.partnerName}
                            </p>
                            <p className="text-xs text-faint">
                              {duo.sessionsTogether} sessions together
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-accent text-sm font-mono font-bold">
                              {formatDuration(duo.totalCoFocusTime)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Session History */}
                <div>
                  <p className="text-faint text-xs font-semibold uppercase tracking-wider mb-3">
                    Recent Sessions
                  </p>
                  {recentSessions.length === 0 ? (
                    <p className="text-faint text-sm text-center py-6">
                      No sessions recorded yet
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {recentSessions.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center gap-3 bg-surface border border-line rounded-xl px-4 py-2.5"
                        >
                          <WorldThumb worldId={s.world} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-ink">
                              {formatDuration(s.actual_focus)}
                              {s.partner_name && (
                                <span className="text-muted font-normal text-xs">
                                  {" "}
                                  with {s.partner_name}
                                </span>
                              )}
                            </p>
                            <p className="text-[10px] text-faint font-mono">
                              {formatDate(s.ended_at)}
                            </p>
                          </div>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              s.completed
                                ? "bg-go/15 text-go"
                                : "bg-danger/15 text-danger"
                            }`}
                          >
                            {s.completed ? "Completed" : "Stopped"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {!loading && statsError && <StatsErrorState onRetry={retry} />}

            {/* Requires `loaded`: "no stats yet" is only true once a fetch has
                actually succeeded. */}
            {!loading && !personalStats && loaded && !statsError && (
              <div className="text-center py-16">
                <p className="text-muted text-lg font-display mb-2">
                  No stats yet
                </p>
                <p className="text-faint text-sm">
                  Complete your first focus session to start tracking!
                </p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
