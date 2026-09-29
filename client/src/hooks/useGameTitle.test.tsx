import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SITE_TITLE } from "@/lib/site";
import { useGameTitle } from "./useGameTitle";

const focus = {
  phase: "focus" as const,
  serverMode: "pomodoro" as const,
  timeLeft: 1122,
  flowElapsed: 492,
};

afterEach(() => { document.title = SITE_TITLE; });

describe("browser-tab title", () => {
  it("updates the countdown and switches to Flow elapsed time", () => {
    const { rerender } = renderHook(
      (game) => useGameTitle(true, game),
      { initialProps: { ...focus, serverMode: "pomodoro" as "pomodoro" | "flow" } },
    );
    expect(document.title).toBe("18:42 · Focus · Duodoro");
    rerender({ ...focus, timeLeft: 1121 });
    expect(document.title).toBe("18:41 · Focus · Duodoro");
    rerender({ ...focus, serverMode: "flow" });
    expect(document.title).toBe("08:12 · Flow · Duodoro");
    rerender({ ...focus, serverMode: "flow", flowElapsed: 7205 });
    expect(document.title).toBe("120:05 · Flow · Duodoro");
  });

  it.each(["pomodoro", "flow"] as const)("shows the break countdown in %s mode", (serverMode) => {
    renderHook(() => useGameTitle(true, { ...focus, phase: "break", serverMode, timeLeft: 299 }));
    expect(document.title).toBe("04:59 · Break · Duodoro");
  });

  it.each([
    ["waiting", "Ready to start"],
    ["celebration", "Celebration"],
    ["returning", "Returning"],
    ["ready", "Ready · Go again"],
  ] as const)("labels %s without a stale countdown", (phase, label) => {
    renderHook(() => useGameTitle(true, { ...focus, phase }));
    expect(document.title).toBe(`${label} · Duodoro`);
  });

  it("clamps an expired countdown", () => {
    renderHook(() => useGameTitle(true, { ...focus, timeLeft: -4 }));
    expect(document.title).toBe("00:00 · Focus · Duodoro");
  });

  it("restores the site title when leaving the game or signing out, and can re-enter", () => {
    const { rerender } = renderHook((active) => useGameTitle(active, focus), { initialProps: true });
    expect(document.title).toBe("18:42 · Focus · Duodoro");
    rerender(false);
    expect(document.title).toBe(SITE_TITLE);
    rerender(true);
    expect(document.title).toBe("18:42 · Focus · Duodoro");
  });

  it("restores the title on unmount after Strict Mode's effect replay", () => {
    const { unmount } = renderHook(() => useGameTitle(true, focus), { wrapper: StrictMode });
    expect(document.title).toBe("18:42 · Focus · Duodoro");
    unmount();
    expect(document.title).toBe(SITE_TITLE);
  });

  it("does not change the title during server rendering", () => {
    document.title = SITE_TITLE;
    function ServerRender() {
      useGameTitle(true, focus);
      return null;
    }
    expect(renderToString(<ServerRender />)).toBe("");
    expect(document.title).toBe(SITE_TITLE);
  });
});
