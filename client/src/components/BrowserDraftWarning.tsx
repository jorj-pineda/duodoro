"use client";
import { useSyncExternalStore } from "react";
import { browserDraftCleanupFailed, subscribeBrowserDraftCleanup } from "@/lib/browserReflectionDrafts";

export default function BrowserDraftWarning() {
  const failed = useSyncExternalStore(subscribeBrowserDraftCleanup,browserDraftCleanupFailed,() => false);
  return failed ? <p role="alert" className="sticky top-0 z-50 border border-danger bg-bg p-3 text-sm text-ink">Couldn&apos;t remove browser reflection drafts. Unencrypted copies may remain in this tab after signing out or switching accounts. Clear this tab’s site data before sharing this device.</p> : null;
}
