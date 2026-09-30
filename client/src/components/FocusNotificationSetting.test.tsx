import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FocusNotificationSetting from "./FocusNotificationSetting";
import { setFocusNotificationsEnabled } from "@/lib/focusNotifications";
import { expectNoAxeViolations } from "@/test/axe";

const requestPermission = vi.fn();
const fakeNotification = { permission: "default" as NotificationPermission, requestPermission };
beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal("isSecureContext", true);
  fakeNotification.permission = "default";
  vi.stubGlobal("Notification", fakeNotification);
  requestPermission.mockReset().mockImplementation(async () => {
    fakeNotification.permission = "granted";
    return "granted";
  });
  await setFocusNotificationsEnabled(false);
});
afterEach(() => vi.unstubAllGlobals());

describe("focus notification switch", () => {
  it("requests permission only after clicking and permits opt-out", async () => {
    render(<FocusNotificationSetting />);
    const toggle = screen.getByRole("switch", { name: "Focus notifications" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(requestPermission).toHaveBeenCalledOnce();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("explains a denied or dismissed request and stays off", async () => {
    requestPermission.mockImplementation(async () => { fakeNotification.permission = "denied"; return "denied"; });
    render(<FocusNotificationSetting />);
    fireEvent.click(screen.getByRole("switch"));
    expect(await screen.findByText(/Blocked by your browser/)).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("reports a dismissed permission request", async () => {
    requestPermission.mockResolvedValue("default");
    render(<FocusNotificationSetting />);
    fireEvent.click(screen.getByRole("switch"));
    expect(await screen.findByRole("status")).toHaveTextContent("Permission wasn’t granted");
    expect(screen.getByRole("switch")).not.toBeDisabled();
  });

  it("recovers after a failed permission request", async () => {
    requestPermission.mockRejectedValueOnce(new Error("failed"));
    render(<FocusNotificationSetting />);
    fireEvent.click(screen.getByRole("switch"));
    expect(await screen.findByRole("status")).toHaveTextContent("Couldn’t enable notifications");
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("disables the switch while permission is pending", async () => {
    let resolve!: (value: string) => void;
    requestPermission.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<FocusNotificationSetting />);
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).toBeDisabled();
    await act(async () => { resolve("default"); });
    expect(screen.getByRole("switch")).not.toBeDisabled();
  });

  it("explains unsupported browsers", () => {
    vi.stubGlobal("Notification", undefined);
    render(<FocusNotificationSetting />);
    expect(screen.getByText(/aren’t available/)).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("renders a neutral off state on the server, without requesting permission", () => {
    localStorage.setItem("duodoro-focus-notifications", "true");
    fakeNotification.permission = "granted";
    const html = renderToString(<FocusNotificationSetting />);
    expect(html).toContain('aria-checked="false"');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("exposes an accessible switch and description", async () => {
    const { container } = render(<FocusNotificationSetting />);
    await expectNoAxeViolations(container);
  });
});
