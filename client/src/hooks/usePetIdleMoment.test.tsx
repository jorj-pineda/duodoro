import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePetIdleMoment } from "./usePetIdleMoment";

describe("companion idle lifetimes", () => {
  let hidden: boolean;
  let reduce: boolean;
  let media: EventTarget;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    hidden = false; reduce = false; media = new EventTarget();
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => hidden ? "hidden" : "visible");
    vi.stubGlobal("matchMedia", () => ({
      get matches() { return reduce; },
      addEventListener: media.addEventListener.bind(media),
      removeEventListener: media.removeEventListener.bind(media),
    }));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
  const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  it("occasionally blinks, rests, fidgets and returns to rest with one pending timer", () => {
    const { result, unmount } = renderHook(() => usePetIdleMoment(true, "cat:grown:idle"));
    expect(result.current).toBe("rest");
    tick(6999); expect(result.current).toBe("rest");
    tick(1); expect(result.current).toBe("blink");
    tick(180); expect(result.current).toBe("rest");
    tick(1200); expect(result.current).toBe("fidget");
    tick(320); expect(result.current).toBe("rest");
    expect(vi.getTimerCount()).toBe(1);
    unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels a pose on phase or companion change and never revives it", () => {
    const { result, rerender } = renderHook(({ enabled, identity }) => usePetIdleMoment(enabled, identity),
      { initialProps: { enabled: true, identity: "cat:grown:idle" } });
    tick(7000); expect(result.current).toBe("blink");
    rerender({ enabled: false, identity: "cat:grown:walk" });
    expect(result.current).toBe("rest"); expect(vi.getTimerCount()).toBe(0);
    rerender({ enabled: true, identity: "cat:grown:idle" });
    expect(result.current).toBe("rest");
    tick(7000); expect(result.current).toBe("blink");
    rerender({ enabled: true, identity: "rabbit:full:idle" });
    expect(result.current).toBe("rest"); tick(6999); expect(result.current).toBe("rest");
  });
  it("stops immediately in hidden tabs and on live reduced-motion changes", () => {
    const { result } = renderHook(() => usePetIdleMoment(true, "cat"));
    tick(7000); expect(result.current).toBe("blink");
    act(() => { hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
    expect(result.current).toBe("rest"); expect(vi.getTimerCount()).toBe(0);
    tick(60000);
    act(() => { hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
    expect(result.current).toBe("rest");
    tick(7000); expect(result.current).toBe("blink");
    act(() => { reduce = true; media.dispatchEvent(new Event("change")); });
    expect(result.current).toBe("rest"); expect(vi.getTimerCount()).toBe(0);
    act(() => { reduce = false; media.dispatchEvent(new Event("change")); });
    expect(result.current).toBe("rest"); tick(7000); expect(result.current).toBe("blink");
  });
  it("renders a neutral server pose without browser globals", () => {
    function Pose() { return <span>{usePetIdleMoment(true, "cat")}</span>; }
    vi.stubGlobal("window", undefined); vi.stubGlobal("document", undefined);
    expect(renderToString(<Pose />)).toBe("<span>rest</span>");
    expect(vi.getTimerCount()).toBe(0);
  });
});
