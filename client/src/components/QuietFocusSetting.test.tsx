import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import QuietFocusSetting from "./QuietFocusSetting";
import { useQuietFocus } from "@/hooks/useQuietFocus";
import { expectNoAxeViolations } from "@/test/axe";
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
it("synchronizes consumers, reloads, accounts and cross-tab changes", () => {
  const first = renderHook(({ id }) => useQuietFocus(id), { initialProps: { id: "alpha" } });
  const second = renderHook(() => useQuietFocus("alpha"));
  act(() => { expect(first.result.current.setEnabled(true)).toBe(true); });
  expect(second.result.current.enabled).toBe(true);
  first.rerender({ id: "beta" }); expect(first.result.current.enabled).toBe(false);
  first.rerender({ id: "alpha" }); expect(first.result.current.enabled).toBe(true);
  second.unmount(); expect(renderHook(() => useQuietFocus("alpha")).result.current.enabled).toBe(true);
  act(() => {
    localStorage.setItem("duodoro:quiet-focus:alpha", "false");
    window.dispatchEvent(new StorageEvent("storage", { key: "duodoro:quiet-focus:alpha" }));
  });
  expect(first.result.current.enabled).toBe(false);
});
it("keeps a usable memory choice and explains failed storage", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  render(<QuietFocusSetting userId="blocked" />);
  const checkbox = screen.getByRole("checkbox", { name: "Quiet focus mode" });
  fireEvent.click(checkbox); expect(checkbox).toBeChecked();
  expect(screen.getByRole("status")).toHaveTextContent("Saved for this page only");
  fireEvent.click(checkbox); expect(checkbox).not.toBeChecked();
});
it("has a neutral server snapshot and accessible opt-in", async () => {
  localStorage.setItem("duodoro:quiet-focus:server", "true");
  expect(renderToString(<QuietFocusSetting userId="server" />)).not.toContain('checked=""');
  const { container } = render(<QuietFocusSetting userId="server" />);
  expect(screen.getByRole("checkbox")).toBeChecked(); await expectNoAxeViolations(container);
});
it("does not read or write preferences when signed out", () => {
  const read = vi.spyOn(Storage.prototype, "getItem"), write = vi.spyOn(Storage.prototype, "setItem");
  const { result } = renderHook(() => useQuietFocus());
  act(() => { expect(result.current.setEnabled(true)).toBe(false); });
  expect(result.current.enabled).toBe(false); expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
});

it("hydrates a persisted enabled choice without a mismatch", async () => {
  localStorage.setItem("duodoro:quiet-focus:hydration", "true");
  const container = document.createElement("div");
  container.innerHTML = renderToString(<QuietFocusSetting userId="hydration" />);
  document.body.append(container);
  expect(container.querySelector("input")).not.toBeChecked();
  const onRecoverableError = vi.fn();
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => { root = hydrateRoot(container, <QuietFocusSetting userId="hydration" />, { onRecoverableError }); });
  expect(container.querySelector("input")).toBeChecked();
  expect(onRecoverableError).not.toHaveBeenCalled();
  await act(async () => root.unmount()); container.remove();
});
