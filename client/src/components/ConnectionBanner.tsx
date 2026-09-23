"use client";
import { motion, AnimatePresence } from "framer-motion";

export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline";

interface Props {
  state: ConnectionState;
  /** Reconnection is urgent during a session; an offline state also needs Retry at home. */
  inSession: boolean;
  onRetry: () => void;
}

/**
 * Tells you when *your own* connection dropped. The countdown on screen is
 * driven by an absolute server timestamp so it stays accurate while offline,
 * but phase changes won't arrive until the socket is back.
 *
 * "Retry" reconnects in place. It used to reload the page, which was the only
 * recovery available when nothing could re-open the socket — a full reload
 * costs the React tree and re-runs auth for what is usually a brief outage.
 */
export default function ConnectionBanner({ state, inSession, onRetry }: Props) {
  const visible = state === "offline" || (inSession && state === "reconnecting");
  const offline = state === "offline";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-2.5 rounded-xl px-4 py-2.5 shadow-lg font-mono text-xs font-bold text-white bg-black/80 backdrop-blur-sm"
        >
          <span
            aria-hidden="true"
            className={`w-2 h-2 rounded-full ${
              offline ? "bg-danger" : "bg-amber-400 animate-pulse"
            }`}
          />
          {offline ? (
            <>
              <span>CONNECTION LOST</span>
              <button
                onClick={onRetry}
                className="underline underline-offset-2 hover:no-underline"
              >
                Retry
              </button>
            </>
          ) : (
            <span>RECONNECTING…</span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
