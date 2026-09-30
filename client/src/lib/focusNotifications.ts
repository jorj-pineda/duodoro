import { SITE_NAME } from "./site";

const STORAGE_KEY = "duodoro-focus-notifications";
const TAG = "duodoro-focus-complete";
let memoryPreference = false;
let memoryOnly = false;
let preferenceVersion = 0;
const listeners = new Set<() => void>();

export type FocusNotificationState = "off" | "on" | "blocked" | "unavailable";

function supported() {
  return typeof window !== "undefined" && window.isSecureContext &&
    typeof Notification !== "undefined" &&
    typeof Notification.requestPermission === "function";
}

function optedIn() {
  if (memoryOnly) return memoryPreference;
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return memoryPreference;
  }
}

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function getFocusNotificationState(): FocusNotificationState {
  if (!supported()) return "unavailable";
  if (Notification.permission === "denied") return "blocked";
  return optedIn() && Notification.permission === "granted" ? "on" : "off";
}

export function subscribeFocusNotifications(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      preferenceVersion++;
      emitChange();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", listener);
  document.addEventListener("visibilitychange", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", listener);
    document.removeEventListener("visibilitychange", listener);
  };
}

function savePreference(enabled: boolean) {
  memoryPreference = enabled;
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // The switch still works for this page when browser storage is blocked.
    memoryOnly = true;
  }
  emitChange();
}

// Called only by the switch's click handler; never prompt at mount or completion.
export async function setFocusNotificationsEnabled(enabled: boolean): Promise<boolean> {
  const version = ++preferenceVersion;
  if (!enabled) {
    savePreference(false);
    return false;
  }
  if (!supported() || Notification.permission === "denied") return false;
  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (version !== preferenceVersion) return false;
  savePreference(permission === "granted");
  return permission === "granted";
}

// A live focus → celebration event is the only caller. Recheck after asynchronous
// worker lookup so a foreground return, opt-out, room exit or sign-out cancels it.
export async function notifyFocusComplete(isCurrentSession: () => boolean): Promise<void> {
  const eligible = () => getFocusNotificationState() === "on" &&
    document.visibilityState === "hidden" && isCurrentSession();
  if (!eligible()) return;
  const title = `Focus complete · ${SITE_NAME}`;
  const options: NotificationOptions = {
    body: "Your focus round is complete. Time for a break!",
    tag: TAG,
    icon: "/icon.svg",
    // Sound remains owned by the app's sound manager and its mute preference.
    silent: true,
  };
  try {
    const registration = "serviceWorker" in navigator
      ? await navigator.serviceWorker.getRegistration("/")
      : undefined;
    if (!eligible()) return;
    if (registration?.active && typeof registration.showNotification === "function") {
      await registration.showNotification(title, options);
      return;
    }
  } catch {
    // Desktop notifications can still work if the worker is unavailable.
  }
  if (!eligible()) return;
  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      notification.close();
      window.focus();
    };
  } catch {
    // Browser/OS delivery is best effort; never interrupt the timer.
  }
}
