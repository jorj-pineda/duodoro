"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useModalAccessibility } from "@/hooks/useModalAccessibility";
import { getSupabase } from "@/lib/supabase";
import { PREMIUM_IS_FREE } from "@/lib/billing";
import Button from "./Button";
import PetCharacter from "./PetCharacter";
import { CloseIcon } from "./Icons";

interface Props {
  open: boolean;
  onClose: () => void;
  isPremium: boolean;
  /** Called after the grant lands, so the app can flip its own copy of the flag. */
  onClaimed: () => void;
}

// Only what actually exists. The old list promised premium character skins,
// stats and history (open to everyone), friend notifications (never implemented)
// and all world themes (PR #38 removed the choice entirely).
// Pets are the feature; saying so is
// better than four claims and one truth.
const FEATURES = [
  "Four pixel companions that walk with you",
  "They stay with you across every session",
  "They grow as you complete focus sessions",
];

export default function PremiumModal({
  open,
  onClose,
  isPremium,
  onClaimed,
}: Props) {
  const dialogRef = useModalAccessibility<HTMLDivElement>(open, onClose);
  const [email, setEmail] = useState<string | null>(null);
  const [optIn, setOptIn] = useState(true);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  // The address is read from the session rather than typed. It is the one
  // Google or Discord already verified, which is the whole basis for granting
  // on it — see migration 020.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getSupabase()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setEmail(data.user?.email ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const claim = async () => {
    setStatus("loading");
    setMessage(null);
    const { error } = await getSupabase().rpc("claim_premium", {
      p_marketing_opt_in: optIn,
    });
    if (error) {
      // Check the error on the write, and say what actually happened rather
      // than leaving the button spinning or pretending it worked.
      console.error("claim_premium failed:", error);
      setStatus("error");
      setMessage(
        error.message.includes("confirmed email")
          ? "Your account doesn't have a confirmed email address yet."
          : "Couldn't unlock companions just now. Try again in a moment.",
      );
      return;
    }
    setStatus("done");
    onClaimed();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/70 z-50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", duration: 0.4 }}
          >
            <div
              ref={dialogRef}
              tabIndex={-1}
              className="bg-surface border border-line rounded-2xl p-8 max-w-sm w-full shadow-2xl relative"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Companions"
            >
              <button
                data-autofocus
                onClick={onClose}
                aria-label="Close"
                className="absolute top-2 right-2 sm:top-4 sm:right-4 w-10 h-10 sm:w-auto sm:h-auto flex items-center justify-center text-faint hover:text-ink transition-colors"
              >
                <CloseIcon className="w-5 h-5" />
              </button>

              <div className="text-center mb-6">
                <div className="flex justify-center mb-3">
                  <PetCharacter type="cat" stage="grown" />
                </div>
                <h2 className="font-display text-2xl text-ink">Companions</h2>
                <p className="text-muted text-sm mt-1">
                  {isPremium || status === "done"
                    ? "You're all set — pick a pet in your next session."
                    : PREMIUM_IS_FREE
                      ? "Free while we're small. Your signed-in email unlocks them; marketing is optional."
                      : "Unlock companions for your sessions."}
                </p>
              </div>

              <ul className="space-y-2.5 mb-7">
                {FEATURES.map((label) => (
                  <li
                    key={label}
                    className="flex items-start gap-3 text-sm text-ink"
                  >
                    <span className="text-gold flex-shrink-0 leading-5">◆</span>
                    <span>{label}</span>
                  </li>
                ))}
              </ul>

              {isPremium || status === "done" ? (
                <Button variant="accent" size="lg" fullWidth onClick={onClose}>
                  Done
                </Button>
              ) : (
                <>
                  <div className="rounded-xl border border-line bg-raise px-3 py-2.5 mb-3">
                    <p className="text-[10px] font-semibold text-faint uppercase tracking-wider">
                      Your account email
                    </p>
                    <p className="text-sm text-ink font-mono break-all mt-0.5">
                      {email ?? "…"}
                    </p>
                    <p className="text-[11px] text-muted mt-1">
                      Already verified when you signed in.
                    </p>
                  </div>

                  <label className="flex items-start gap-2.5 mb-4 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={optIn}
                      onChange={(e) => setOptIn(e.target.checked)}
                      className="mt-0.5 accent-accent w-4 h-4 flex-shrink-0"
                    />
                    <span className="text-xs text-muted">
                      Email me occasionally about Duodoro. This is optional and
                      does not affect companion access.
                    </span>
                  </label>

                  <Button
                    variant="gold"
                    size="lg"
                    fullWidth
                    disabled={status === "loading" || !email}
                    onClick={claim}
                  >
                    {status === "loading" ? "Unlocking…" : "Unlock companions"}
                  </Button>
                </>
              )}

              {message && (
                <p role="alert" className="text-danger text-xs text-center mt-3">{message}</p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
