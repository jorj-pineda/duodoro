import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => "granted");
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(public title: string, public options: NotificationOptions) {
    FakeNotification.instances.push(this);
  }
}

function visibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
}

async function load(stored = false) {
  vi.resetModules();
  if (stored) localStorage.setItem("duodoro-focus-notifications", "true");
  return import("./focusNotifications");
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("Notification", FakeNotification);
  FakeNotification.permission = "granted";
  FakeNotification.instances = [];
  FakeNotification.requestPermission.mockReset().mockResolvedValue("granted");
  visibility("hidden");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  visibility("visible");
});

describe("focus notification preferences", () => {
  it("defaults off even when permission is already granted, without prompting", async () => {
    const notifications = await load();
    expect(notifications.getFocusNotificationState()).toBe("off");
    await notifications.notifyFocusComplete(() => true);
    expect(FakeNotification.instances).toHaveLength(0);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it("requests permission on enable and persists grant and opt-out", async () => {
    FakeNotification.permission = "default";
    FakeNotification.requestPermission.mockImplementation(async () => {
      FakeNotification.permission = "granted";
      return "granted";
    });
    const notifications = await load();
    await notifications.setFocusNotificationsEnabled(true);
    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce();
    expect(notifications.getFocusNotificationState()).toBe("on");
    expect((await load()).getFocusNotificationState()).toBe("on");
    await notifications.setFocusNotificationsEnabled(false);
    expect(localStorage.getItem("duodoro-focus-notifications")).toBe("false");
    expect((await load()).getFocusNotificationState()).toBe("off");
  });

  it.each(["default", "denied"] as const)("does not enable after a %s permission result", async (permission) => {
    FakeNotification.permission = "default";
    FakeNotification.requestPermission.mockImplementation(async () => {
      FakeNotification.permission = permission;
      return permission;
    });
    const notifications = await load();
    expect(await notifications.setFocusNotificationsEnabled(true)).toBe(false);
    expect(notifications.getFocusNotificationState()).toBe(permission === "denied" ? "blocked" : "off");
  });

  it("never re-prompts a denied browser", async () => {
    FakeNotification.permission = "denied";
    const notifications = await load(true);
    expect(notifications.getFocusNotificationState()).toBe("blocked");
    expect(await notifications.setFocusNotificationsEnabled(true)).toBe(false);
    await notifications.notifyFocusComplete(() => true);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("reports unavailable on unsupported browsers or insecure origins", async () => {
    const notifications = await load();
    vi.stubGlobal("Notification", undefined);
    expect(notifications.getFocusNotificationState()).toBe("unavailable");
    expect(await notifications.setFocusNotificationsEnabled(true)).toBe(false);
    vi.stubGlobal("Notification", FakeNotification);
    vi.stubGlobal("isSecureContext", false);
    expect(notifications.getFocusNotificationState()).toBe("unavailable");
  });

  it("keeps a memory fallback when storage can be read but not written", async () => {
    const notifications = await load();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await notifications.setFocusNotificationsEnabled(true);
    expect(notifications.getFocusNotificationState()).toBe("on");
    await notifications.setFocusNotificationsEnabled(false);
    expect(notifications.getFocusNotificationState()).toBe("off");
  });

  it("does not overwrite opt-out while a permission request is pending", async () => {
    FakeNotification.permission = "default";
    let resolve!: (value: NotificationPermission) => void;
    FakeNotification.requestPermission.mockReturnValue(new Promise((r) => { resolve = r; }));
    const notifications = await load();
    const enable = notifications.setFocusNotificationsEnabled(true);
    await notifications.setFocusNotificationsEnabled(false);
    FakeNotification.permission = "granted";
    resolve("granted");
    expect(await enable).toBe(false);
    expect(notifications.getFocusNotificationState()).toBe("off");
  });

  it("refreshes subscribers on another tab's opt-out and browser permission changes", async () => {
    const notifications = await load(true);
    const listener = vi.fn();
    const unsubscribe = notifications.subscribeFocusNotifications(listener);
    localStorage.setItem("duodoro-focus-notifications", "false");
    window.dispatchEvent(new StorageEvent("storage", { key: "duodoro-focus-notifications" }));
    expect(listener).toHaveBeenCalled();
    expect(notifications.getFocusNotificationState()).toBe("off");
    FakeNotification.permission = "denied";
    window.dispatchEvent(new Event("focus"));
    expect(notifications.getFocusNotificationState()).toBe("blocked");
    unsubscribe();
    listener.mockClear();
    window.dispatchEvent(new Event("focus"));
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("focus notification delivery", () => {
  it("shows a silent, private notification in a hidden tab and focuses the tab on click", async () => {
    const notifications = await load(true);
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    await notifications.notifyFocusComplete(() => true);
    expect(FakeNotification.instances).toHaveLength(1);
    const notification = FakeNotification.instances[0];
    expect(notification.title).toBe("Focus complete · Duodoro");
    expect(notification.options).toEqual({ body: "Your focus round is complete. Time for a break!", tag: "duodoro-focus-complete", icon: "/icon.svg", silent: true });
    notification.onclick?.();
    expect(notification.close).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("does not notify a visible tab or an ended session", async () => {
    const notifications = await load(true);
    visibility("visible");
    await notifications.notifyFocusComplete(() => true);
    visibility("hidden");
    await notifications.notifyFocusComplete(() => false);
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("uses an active service worker for delivery without a desktop duplicate", async () => {
    const showNotification = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: vi.fn().mockResolvedValue({ active: {}, showNotification }) } });
    const notifications = await load(true);
    await notifications.notifyFocusComplete(() => true);
    expect(showNotification).toHaveBeenCalledWith("Focus complete · Duodoro", expect.objectContaining({ silent: true }));
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it.each(["foreground", "opt-out", "session-ended"])("cancels delivery after worker lookup on %s", async (change) => {
    let resolve!: (value: undefined) => void;
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: () => new Promise((r) => { resolve = r; }) } });
    const notifications = await load(true);
    let current = true;
    const delivery = notifications.notifyFocusComplete(() => current);
    if (change === "foreground") visibility("visible");
    if (change === "opt-out") await notifications.setFocusNotificationsEnabled(false);
    if (change === "session-ended") current = false;
    resolve(undefined);
    await delivery;
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("falls back on worker failure and absorbs unsupported desktop delivery", async () => {
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: vi.fn().mockRejectedValue(new Error("unavailable")) } });
    const notifications = await load(true);
    await notifications.notifyFocusComplete(() => true);
    expect(FakeNotification.instances).toHaveLength(1);
    vi.stubGlobal("Notification", class extends FakeNotification {
      constructor(title: string, options: NotificationOptions) { super(title, options); throw new TypeError("unsupported"); }
    });
    await expect(notifications.notifyFocusComplete(() => true)).resolves.toBeUndefined();
  });
});
