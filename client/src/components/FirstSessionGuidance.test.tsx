import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import FirstSessionGuidance from "./FirstSessionGuidance";
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
it("explains solo and duo starts without requiring dismissal to proceed", () => {
  render(<FirstSessionGuidance userId="copy" />);
  expect(screen.getByText(/pick your timer settings, then choose Start solo/)).toBeVisible();
  expect(screen.getByText(/The host chooses Start session/)).toBeVisible();
  expect(screen.getByText(/Opening a room/)).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("remembers a dismissal only for this account and browser, including mounted copies", () => {
  const view = render(<><FirstSessionGuidance userId="alice" /><FirstSessionGuidance userId="alice" /></>);
  fireEvent.click(screen.getAllByRole("button")[0]);
  expect(screen.queryByRole("complementary")).toBeNull();
  view.rerender(<FirstSessionGuidance userId="bob" />); expect(screen.getByRole("complementary")).toBeVisible();
  view.rerender(<FirstSessionGuidance userId="alice" />); expect(screen.queryByRole("complementary")).toBeNull();
});
it("keeps dismissal in memory when storage writes fail", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  const first = render(<FirstSessionGuidance userId="blocked" />); fireEvent.click(screen.getByRole("button")); first.unmount();
  render(<FirstSessionGuidance userId="blocked" />); expect(screen.queryByRole("complementary")).toBeNull();
});
it("responds to dismissals from another tab", () => {
  render(<FirstSessionGuidance userId="tabs" />);
  act(() => { localStorage.setItem("duodoro:first-session-guidance:tabs", "1"); window.dispatchEvent(new StorageEvent("storage", { key: "duodoro:first-session-guidance:tabs" })); });
  expect(screen.queryByRole("complementary")).toBeNull();
});
it("has a neutral server frame and hydrates without mismatch for a dismissed account", async () => {
  const html = renderToString(<FirstSessionGuidance userId="ssr" />); expect(html).toBe("");
  localStorage.setItem("duodoro:first-session-guidance:ssr", "1");
  const container = document.createElement("div"); container.innerHTML = html; document.body.append(container);
  const errors: unknown[] = []; let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => { root = hydrateRoot(container, <FirstSessionGuidance userId="ssr" />, { onRecoverableError: error => errors.push(error) }); });
  expect(errors).toEqual([]); expect(container).toBeEmptyDOMElement();
  act(() => root.unmount()); container.remove();
});
