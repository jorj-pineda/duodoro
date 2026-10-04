import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCompanionPreference } from "./useCompanionPreference";
beforeEach(() => localStorage.clear());
afterEach(cleanup);
describe("companion preference", () => {
  it("persists the selected companion for account-scoped refresh recovery", () => {
    const first = renderHook(() => useCompanionPreference("hero"));
    act(() => first.result.current.setPet("cat"));
    first.unmount();
    const second = renderHook(() => useCompanionPreference("hero"));
    expect(second.result.current.pet).toBe("cat");
    const other = renderHook(() => useCompanionPreference("other"));
    expect(other.result.current.pet).toBeNull();
    act(() => second.result.current.setPet(null));
    expect(second.result.current.pet).toBeNull();
  });
  it("rejects invalid stored choices and keeps the SSR snapshot neutral", () => {
    localStorage.setItem("duodoro:companion:hero", "forged-full");
    expect(renderHook(() => useCompanionPreference("hero")).result.current.pet).toBeNull();
    localStorage.setItem("duodoro:companion:hero", "dragon");
    function Snapshot() { return <span>{useCompanionPreference("hero").pet ?? "none"}</span>; }
    expect(renderToString(<Snapshot />)).toContain("none");
  });
});
