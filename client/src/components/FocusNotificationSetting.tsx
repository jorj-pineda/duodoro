"use client";

import { useId, useState, useSyncExternalStore } from "react";
import {
  getFocusNotificationState,
  setFocusNotificationsEnabled,
  subscribeFocusNotifications,
} from "@/lib/focusNotifications";

export default function FocusNotificationSetting() {
  const descriptionId = useId();
  const state = useSyncExternalStore(
    subscribeFocusNotifications,
    getFocusNotificationState,
    () => "off",
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const enabled = state === "on";

  const toggle = async () => {
    setPending(true);
    setMessage(null);
    try {
      const granted = await setFocusNotificationsEnabled(!enabled);
      if (!enabled && !granted) setMessage("Permission wasn’t granted. Notifications remain off.");
    } catch {
      setMessage("Couldn’t enable notifications. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-2 pt-3 border-t border-line">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-describedby={descriptionId}
        disabled={pending || state === "blocked" || state === "unavailable"}
        onClick={(event) => { event.stopPropagation(); void toggle(); }}
        className="w-full min-h-11 flex items-center justify-between gap-3 text-left text-xs font-semibold text-ink disabled:text-muted"
      >
        Focus notifications
        <span aria-hidden="true" className={enabled ? "text-go" : "text-muted"}>
          {pending ? "…" : enabled ? "On" : "Off"}
        </span>
      </button>
      <p id={descriptionId} className="text-xs text-muted max-w-56 leading-relaxed">
        {state === "blocked"
          ? "Blocked by your browser. Allow notifications in site settings to enable them."
          : state === "unavailable"
            ? "Notifications aren’t available in this browser."
            : "When focus ends in a background tab. Keep Duodoro open. Saved in this browser."}
      </p>
      {message && <p role="status" className="text-xs text-muted mt-1 max-w-56">{message}</p>}
    </div>
  );
}
