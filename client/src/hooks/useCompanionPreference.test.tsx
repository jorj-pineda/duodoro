import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCompanionPreference } from "./useCompanionPreference";
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("companion preference", () => {
  it("remembers separate names per companion and account and restores defaults", () => {
    const { result } = renderHook(() => useCompanionPreference("names-owner"));
    act(() => result.current.setPet("cat")); expect(result.current.petName).toBe("Mochi");
    act(() => result.current.setName("cat", "  Moon Bean  ")); expect(result.current.petName).toBe("Moon Bean");
    act(() => result.current.setPet("dog")); expect(result.current.petName).toBe("Buddy");
    act(() => result.current.setName("dog", "Sunny"));
    act(() => result.current.setPet("cat")); expect(result.current.petName).toBe("Moon Bean");
    expect(renderHook(() => useCompanionPreference("names-owner")).result.current.petName).toBe("Moon Bean");
    expect(renderHook(() => useCompanionPreference("other-account")).result.current.getName("cat")).toBe("Mochi");
    act(() => result.current.setName("cat", "")); expect(result.current.petName).toBe("Mochi");
    act(() => { localStorage.setItem("duodoro:companion-name:names-owner:cat", "Luna"); window.dispatchEvent(new StorageEvent("storage", { key: "duodoro:companion-name:names-owner:cat" })); });
    expect(result.current.petName).toBe("Luna");
    act(() => result.current.setName("cat", "x".repeat(25))); expect(result.current.petName).toBe("Luna");
  });
  it("keeps names in memory when browser storage is blocked and hides them in SSR", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const { result } = renderHook(() => useCompanionPreference("blocked-names"));
    act(() => { result.current.setPet("dragon"); result.current.setName("dragon", "Nova"); });
    expect(result.current.petName).toBe("Nova");
    expect(renderHook(() => useCompanionPreference("blocked-names")).result.current.petName).toBe("Nova");
    function Snapshot() { const pref = useCompanionPreference("blocked-names"); return <span>{pref.petName ?? "none"}</span>; }
    expect(renderToString(<Snapshot />)).toContain("none");
  });
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
