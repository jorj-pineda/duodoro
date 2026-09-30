import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(path.join(__dirname, "../../public/sw.js"), "utf8");

describe("notification click in the shipped service worker", () => {
  it.each([true, false])("focuses an open Duodoro tab or opens Home (existing: %s)", async (existing) => {
    let click!: (event: { notification: { close: () => void }; waitUntil: (work: Promise<unknown>) => void }) => void;
    const focus = vi.fn().mockResolvedValue(undefined);
    const openWindow = vi.fn().mockResolvedValue(undefined);
    const self = {
      addEventListener: (event: string, handler: typeof click) => { if (event === "notificationclick") click = handler; },
      location: { origin: "https://duodoro.live" },
      clients: {
        matchAll: vi.fn().mockResolvedValue([
          { url: "https://other.example/", focus: vi.fn() },
          { url: "https://duodoro.live/terms", focus: vi.fn() },
          ...(existing ? [{ url: "https://duodoro.live/", focus }] : []),
        ]),
        openWindow,
      },
    };
    runInNewContext(source, { self, URL });
    const close = vi.fn();
    let work!: Promise<unknown>;
    click({ notification: { close }, waitUntil: (promise) => { work = promise; } });
    await work;
    expect(close).toHaveBeenCalledOnce();
    expect(self.clients.matchAll).toHaveBeenCalledWith({ type: "window", includeUncontrolled: true });
    if (existing) {
      expect(focus).toHaveBeenCalledOnce();
      expect(openWindow).not.toHaveBeenCalled();
    } else expect(openWindow).toHaveBeenCalledWith("/");
  });
});
