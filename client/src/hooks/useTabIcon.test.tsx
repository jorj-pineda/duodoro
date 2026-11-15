import { renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { tabIconHref, TAB_ICON_STEPS } from "@/lib/tabIcon";
import { TAB_BREAK, TAB_FOCUS } from "@/lib/site";
import { useTabIcon } from "./useTabIcon";

type Game = Parameters<typeof useTabIcon>[1];
const focus: Game = { phase: "focus", serverMode: "pomodoro", phaseProgress: 0.25 };
const svg = (href: string | null) => decodeURIComponent(href!.replace("data:image/svg+xml,", ""));
/** Height of the coloured fill in viewBox units, or 0 for the plain mark. */
const fill = (href: string | null) => {
  const match = svg(href).match(/<rect y="(\d+)" width="512" height="(\d+)"/);
  if (!match) return 0;
  expect(Number(match[1]) + Number(match[2])).toBe(512);
  return Number(match[2]);
};
const icons = () => document.head.querySelectorAll("link[data-duodoro-timer]");
const icon = () => icons()[0] as HTMLLinkElement | undefined;

afterEach(() => { document.head.querySelectorAll("link[data-duodoro-timer]").forEach(link => link.remove()); });

describe("tab icon", () => {
  it("draws whole steps of focus and break progress in their colours", () => {
    expect(fill(tabIconHref({ ...focus, phaseProgress: 0 }))).toBe(0);
    expect(fill(tabIconHref({ ...focus, phaseProgress: 0.062 }))).toBe(0);
    expect(fill(tabIconHref({ ...focus, phaseProgress: 0.25 }))).toBe(4 * 32);
    expect(fill(tabIconHref({ ...focus, phaseProgress: 1 }))).toBe(TAB_ICON_STEPS * 32);
    expect(fill(tabIconHref({ ...focus, phaseProgress: Number.NaN }))).toBe(0);
    expect(svg(tabIconHref(focus))).toContain(TAB_FOCUS);
    const pause = tabIconHref({ ...focus, phase: "break", phaseProgress: 0.5 });
    expect(fill(pause)).toBe(8 * 32);
    expect(svg(pause)).toContain(TAB_BREAK);
    expect(svg(pause)).not.toContain(TAB_FOCUS);
  });

  it("shows open-ended Flow focus as a full tile, but its break as progress", () => {
    expect(fill(tabIconHref({ ...focus, serverMode: "flow", phaseProgress: 0.01 }))).toBe(TAB_ICON_STEPS * 32);
    expect(fill(tabIconHref({ phase: "break", serverMode: "flow", phaseProgress: 0.3 }))).toBe(4 * 32);
  });

  it.each(["waiting", "celebration", "returning", "ready"] as const)("leaves the site icon alone while %s", (phase) => {
    expect(tabIconHref({ ...focus, phase })).toBeNull();
    renderHook(() => useTabIcon(true, { ...focus, phase }));
    expect(icons()).toHaveLength(0);
  });

  it("follows progress with one link and only changes it per whole step", () => {
    const { rerender } = renderHook(({ game }) => useTabIcon(true, game), { initialProps: { game: focus } });
    const first = icon()!;
    expect(first.rel).toBe("icon");
    expect(first.type).toBe("image/svg+xml");
    expect(first.href).toBe(tabIconHref(focus));
    rerender({ game: { ...focus, phaseProgress: 0.31 } });
    expect(icon()!.href).toBe(tabIconHref(focus));
    rerender({ game: { ...focus, phaseProgress: 0.32 } });
    expect(icons()).toHaveLength(1);
    expect(icon()).toBe(first);
    expect(fill(icon()!.href)).toBe(5 * 32);
    rerender({ game: { ...focus, phase: "break", phaseProgress: 0.5 } });
    expect(icon()).toBe(first);
    expect(svg(icon()!.href)).toContain(TAB_BREAK);
  });

  it("removes the icon when the round ends, the game closes or the hook unmounts", () => {
    const { rerender, unmount } = renderHook(({ active, game }) => useTabIcon(active, game), { initialProps: { active: true, game: focus } });
    rerender({ active: true, game: { ...focus, phase: "returning" } });
    expect(icons()).toHaveLength(0);
    rerender({ active: true, game: focus });
    expect(icons()).toHaveLength(1);
    rerender({ active: false, game: focus });
    expect(icons()).toHaveLength(0);
    rerender({ active: true, game: focus });
    expect(icons()).toHaveLength(1);
    unmount();
    expect(icons()).toHaveLength(0);
  });

  it("renders nothing on the server", () => {
    function Probe() { useTabIcon(true, focus); return <p>ok</p>; }
    expect(renderToString(<Probe />)).toBe("<p>ok</p>");
    expect(icons()).toHaveLength(0);
  });
});
