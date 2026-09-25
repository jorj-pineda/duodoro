"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type {
  AccountDeletionResponse,
  DuodoroSocket,
} from "@/lib/socketContract";
import { useModalAccessibility } from "@/hooks/useModalAccessibility";
import { CloseIcon } from "./Icons";

interface Props {
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
  socketRef: { current: DuodoroSocket | null };
}

export default function AccountSettingsModal({
  onClose,
  onDeleted,
  socketRef,
}: Props) {
  const dialogRef = useModalAccessibility<HTMLDivElement>(true, onClose);
  const [marketingOptIn, setMarketingOptIn] = useState<boolean | null>(null);
  const [loadingConsent, setLoadingConsent] = useState(true);
  const [savingConsent, setSavingConsent] = useState(false);
  const [consentMessage, setConsentMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getSupabase()
      .from("premium_grants")
      .select("marketing_opt_in")
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setLoadingConsent(false);
        if (error) {
          setConsentMessage("Couldn’t load your email preference.");
          return;
        }
        setMarketingOptIn(data?.marketing_opt_in ?? null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const updateMarketingConsent = async (next: boolean) => {
    setSavingConsent(true);
    setConsentMessage(null);
    const { error } = await getSupabase().rpc("claim_premium", {
      p_marketing_opt_in: next,
    });
    setSavingConsent(false);
    if (error) {
      setConsentMessage("Couldn’t update your email preference. Try again.");
      return;
    }
    setMarketingOptIn(next);
    setConsentMessage(next ? "Marketing email on." : "Marketing email off.");
  };

  const deleteAccount = async () => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setDeletionError("Reconnect to Duodoro before deleting your account.");
      return;
    }

    setDeleting(true);
    setDeletionError(null);
    socket.timeout(15_000).emit(
      "delete_account",
      { confirmation },
      async (timeoutError: Error | null, response?: AccountDeletionResponse) => {
        if (timeoutError || !response?.ok) {
          setDeleting(false);
          setDeletionError(
            response?.message || "Couldn’t delete your account. Try again.",
          );
          return;
        }
        await onDeleted();
      },
    );
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
        aria-label="Close account settings"
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-settings-title"
        className="relative bg-surface border border-line rounded-2xl p-6 max-w-md w-full max-h-[90dvh] overflow-y-auto shadow-2xl"
      >
        <button
          data-autofocus
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-10 h-10 flex items-center justify-center text-faint hover:text-ink"
        >
          <CloseIcon className="w-5 h-5" />
        </button>

        <h2 id="account-settings-title" className="font-display text-2xl text-ink">
          Privacy & account
        </h2>
        <p className="text-sm text-muted mt-1 pr-8">
          Review how Duodoro handles your data and control what stays.
        </p>

        <div className="flex gap-4 text-sm mt-4">
          <Link className="text-accent hover:underline" href="/privacy">
            Privacy Policy
          </Link>
          <Link className="text-accent hover:underline" href="/terms">
            Terms
          </Link>
        </div>

        <section className="border-t border-line mt-5 pt-5">
          <h3 className="font-bold text-ink">Email preference</h3>
          {loadingConsent ? (
            <p className="text-sm text-muted mt-2">Loading…</p>
          ) : marketingOptIn === null ? (
            <p className="text-sm text-muted mt-2">
              You have not opted in to Duodoro marketing email.
            </p>
          ) : (
            <label className="flex items-start gap-3 mt-3 cursor-pointer">
              <input
                type="checkbox"
                checked={marketingOptIn}
                disabled={savingConsent}
                onChange={(event) => updateMarketingConsent(event.target.checked)}
                className="mt-0.5 accent-accent w-4 h-4"
              />
              <span className="text-sm text-muted">
                Email me occasionally about Duodoro. Turning this off does not
                remove companion access or your pets.
              </span>
            </label>
          )}
          {consentMessage && (
            <p role="status" className="text-xs text-muted mt-2">
              {consentMessage}
            </p>
          )}
        </section>

        <section className="border-t border-line mt-5 pt-5">
          <h3 className="font-bold text-danger">Delete account</h3>
          <p className="text-sm text-muted mt-2">
            Permanently removes your sign-in, profile, friendships, tasks,
            participant links, companion access record, marketing consent, and
            matching waitlist address. Session records needed for another
            participant’s history may remain without a link to your deleted
            identity. A shared round still waiting to save is discarded for both
            participants.
          </p>
          <label className="block text-xs font-semibold text-muted mt-4">
            Type DELETE to confirm
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={deleting}
              autoComplete="off"
              className="mt-1.5 w-full bg-bg border border-line rounded-lg px-3 py-2 text-ink font-mono"
            />
          </label>
          <button
            onClick={deleteAccount}
            disabled={confirmation !== "DELETE" || deleting}
            className="mt-3 w-full bg-danger text-white font-bold py-2.5 px-4 disabled:opacity-50 disabled:pointer-events-none"
          >
            {deleting ? "Deleting…" : "Permanently delete my account"}
          </button>
          {deletionError && (
            <p role="alert" className="text-danger text-xs mt-2">
              {deletionError}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
