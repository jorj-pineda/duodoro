import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import KeepAwakeSetting from "@/components/KeepAwakeSetting";
import { useKeepAwakePreference, useScreenWakeLock } from "./useKeepAwake";
import { expectNoAxeViolations } from "@/test/axe";

class FakeSentinel extends EventTarget {
  released = false;
  release = vi.fn(async () => {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event("release"));
  });
}

let visibility: DocumentVisibilityState = "visible";
let locks: FakeSentinel[] = [];
let request: ReturnType<typeof vi.fn>;

function installWakeLock() {
  request = vi.fn(async () => { const lock = new FakeSentinel(); locks.push(lock); return lock; });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
}
function setVisibility(value: DocumentVisibilityState) {
  visibility = value;
  document.dispatchEvent(new Event("visibilitychange"));
}
const held = () => locks.filter(lock => !lock.released);

beforeEach(() => {
  localStorage.clear();
  locks = [];
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  installWakeLock();
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as { wakeLock?: unknown }).wakeLock;
});

it("persists per account, syncs consumers and ignores signed-out writes", () => {
  const first = renderHook(({ id }) => useKeepAwakePreference(id), { initialProps: { id: "alpha" as string | undefined } });
  const second = renderHook(() => useKeepAwakePreference("alpha"));
  act(() => { expect(first.result.current.setEnabled(true)).toBe(true); });
  expect(second.result.current.enabled).toBe(true);
  expect(localStorage.getItem("duodoro:keep-awake:alpha")).toBe("true");
  first.rerender({ id: "beta" }); expect(first.result.current.enabled).toBe(false);
  first.rerender({ id: undefined });
  act(() => { expect(first.result.current.setEnabled(true)).toBe(false); });
  expect(localStorage.getItem("duodoro:keep-awake:undefined")).toBeNull();
});

it("holds the lock only while active and releases it when focus ends or unmounts", async () => {
  const { rerender, unmount } = renderHook(({ active }) => useScreenWakeLock(active), { initialProps: { active: false } });
  await act(async () => {});
  expect(request).not.toHaveBeenCalled();
  rerender({ active: true });
  await act(async () => {});
  expect(request).toHaveBeenCalledWith("screen");
  expect(held()).toHaveLength(1);
  rerender({ active: false });
  await act(async () => {});
  expect(held()).toHaveLength(0);
  rerender({ active: true });
  await act(async () => {});
  expect(held()).toHaveLength(1);
  unmount();
  await act(async () => {});
  expect(held()).toHaveLength(0);
});

it("requests the lock again when a backgrounded tab becomes visible", async () => {
  renderHook(() => useScreenWakeLock(true));
  await act(async () => {});
  expect(request).toHaveBeenCalledTimes(1);
  // Browsers release screen locks themselves when the tab is hidden.
  await act(async () => { setVisibility("hidden"); await locks[0].release(); });
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => { setVisibility("visible"); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(held()).toHaveLength(1);
  // A visible tab that still holds its lock does not stack another one.
  await act(async () => { setVisibility("visible"); });
  expect(request).toHaveBeenCalledTimes(2);
});

it("does not request while hidden and releases a lock granted after deactivation", async () => {
  visibility = "hidden";
  const hidden = renderHook(() => useScreenWakeLock(true));
  await act(async () => {});
  expect(request).not.toHaveBeenCalled();
  hidden.unmount();
  visibility = "visible";
  let grant!: (lock: FakeSentinel) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
  const { rerender } = renderHook(({ active }) => useScreenWakeLock(active), { initialProps: { active: true } });
  rerender({ active: false });
  const late = new FakeSentinel();
  await act(async () => { grant(late); });
  expect(late.release).toHaveBeenCalled();
});

it("reports a refused lock only while active, and clears it after a later grant", async () => {
  request.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
  const { result, rerender } = renderHook(({ active }) => useScreenWakeLock(active), { initialProps: { active: true } });
  await act(async () => {});
  expect(result.current.failed).toBe(true);
  rerender({ active: false });
  expect(result.current.failed).toBe(false);
  rerender({ active: true });
  await act(async () => {});
  expect(result.current.failed).toBe(false);
  expect(held()).toHaveLength(1);
});

it("is a no-op without browser support", async () => {
  delete (navigator as { wakeLock?: unknown }).wakeLock;
  const { result } = renderHook(() => useScreenWakeLock(true));
  await act(async () => {});
  expect(result.current.failed).toBe(false);
  render(<KeepAwakeSetting userId="old-browser" failed={false} />);
  expect(screen.getByRole("checkbox", { name: "Keep screen awake while focusing" })).toBeDisabled();
  expect(screen.getByText("This browser can't keep the screen awake.")).toBeInTheDocument();
});

it("is an accessible opt-in that explains refusals and storage fallback", async () => {
  const { container, rerender } = render(<KeepAwakeSetting userId="ui" failed={false} />);
  const checkbox = screen.getByRole("checkbox", { name: "Keep screen awake while focusing" });
  expect(checkbox).not.toBeChecked();
  fireEvent.click(checkbox);
  expect(checkbox).toBeChecked();
  rerender(<KeepAwakeSetting userId="ui" failed />);
  expect(screen.getByRole("status")).toHaveTextContent("didn't allow it right now");
  await expectNoAxeViolations(container);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  fireEvent.click(checkbox);
  expect(checkbox).not.toBeChecked();
  expect(screen.getByText(/Browser storage is unavailable/)).toBeInTheDocument();
});

it("hydrates a saved choice without a mismatch", async () => {
  localStorage.setItem("duodoro:keep-awake:hydration", "true");
  const html = renderToString(<KeepAwakeSetting userId="hydration" failed={false} />);
  expect(html).not.toContain('checked=""');
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  const onRecoverableError = vi.fn();
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => { root = hydrateRoot(container, <KeepAwakeSetting userId="hydration" failed={false} />, { onRecoverableError }); });
  expect(container.querySelector("input")).toBeChecked();
  expect(onRecoverableError).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  container.remove();
});
