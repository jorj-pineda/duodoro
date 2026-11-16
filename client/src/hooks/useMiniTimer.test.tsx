import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MiniTimerPortal, MiniTimerToggle, MiniTimerView } from "@/components/MiniTimer";
import { useMiniTimer, useMiniTimerSupported } from "./useMiniTimer";

type FakeWindow = Window & { closed: boolean };

function fakeWindow() {
  const target = new EventTarget() as FakeWindow;
  const doc = document.implementation.createHTMLDocument("pip");
  Object.assign(target, { document: doc, closed: false });
  target.close = vi.fn(() => {
    if (target.closed) return;
    target.closed = true;
    target.dispatchEvent(new Event("pagehide"));
  });
  return target;
}

function installApi(requestWindow: () => Promise<Window>) {
  Object.defineProperty(window, "documentPictureInPicture", { configurable: true, value: { requestWindow: vi.fn(requestWindow) } });
  return (window as unknown as { documentPictureInPicture: { requestWindow: ReturnType<typeof vi.fn> } }).documentPictureInPicture;
}

afterEach(() => {
  delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture;
  document.documentElement.removeAttribute("data-theme");
  document.head.querySelectorAll("style[data-test]").forEach(node => node.remove());
});

const focus = { phase: "focus" as const, serverMode: "pomodoro" as const, timeLeft: 754, flowElapsed: 0, phaseProgress: 0.5 };

describe("useMiniTimer", () => {
  it("reports support only when the browser has Document Picture-in-Picture", () => {
    expect(renderHook(() => useMiniTimerSupported()).result.current).toBe(false);
    installApi(async () => fakeWindow());
    expect(renderHook(() => useMiniTimerSupported()).result.current).toBe(true);
  });

  it("opens a styled window that follows the page theme and renders the timer", async () => {
    const style = document.createElement("style");
    style.dataset.test = "";
    style.textContent = ".from-page { color: red; }";
    document.head.appendChild(style);
    document.documentElement.setAttribute("data-theme", "dark");
    const pip = fakeWindow();
    const api = installApi(async () => pip);
    const { result } = renderHook(() => useMiniTimer(true));
    await act(() => result.current.open());
    expect(api.requestWindow).toHaveBeenCalledWith({ width: 260, height: 150 });
    expect(result.current.window).toBe(pip);
    expect(pip.document.head.textContent).toContain(".from-page");
    expect(pip.document.documentElement.getAttribute("data-theme")).toBe("dark");
    await act(async () => { document.documentElement.setAttribute("data-theme", "light"); });
    expect(pip.document.documentElement.getAttribute("data-theme")).toBe("light");

    render(<MiniTimerPortal target={result.current.window} {...focus} partnerName="Sam" />);
    const timer = pip.document.querySelector('[role="timer"]');
    expect(timer?.textContent).toBe("12:34");
    expect(timer?.getAttribute("aria-label")).toBe("Focus 12:34");
    expect(pip.document.body.textContent).toContain("With Sam");
  });

  it("forgets the window when the person closes it", async () => {
    const pip = fakeWindow();
    installApi(async () => pip);
    const { result } = renderHook(() => useMiniTimer(true));
    await act(() => result.current.open());
    act(() => result.current.close());
    expect(pip.close).toHaveBeenCalled();
    expect(result.current.window).toBeNull();
  });

  it("closes the window when the room is no longer displayed", async () => {
    const pip = fakeWindow();
    installApi(async () => pip);
    const { result, rerender } = renderHook(({ active }) => useMiniTimer(active), { initialProps: { active: true } });
    await act(() => result.current.open());
    rerender({ active: false });
    expect(pip.closed).toBe(true);
    expect(result.current.window).toBeNull();
  });

  it("closes the window on unmount", async () => {
    const pip = fakeWindow();
    installApi(async () => pip);
    const { result, unmount } = renderHook(() => useMiniTimer(true));
    await act(() => result.current.open());
    unmount();
    expect(pip.closed).toBe(true);
  });

  it("closes a window that arrives after unmount without mirroring the theme", async () => {
    const pip = fakeWindow();
    let resolve!: (value: Window) => void;
    installApi(() => new Promise<Window>(done => { resolve = done; }));
    const { result, unmount } = renderHook(() => useMiniTimer(true));
    let opening!: Promise<void>;
    act(() => { opening = result.current.open(); });
    unmount();
    await act(async () => { resolve(pip); await opening; });
    expect(pip.closed).toBe(true);
    document.documentElement.setAttribute("data-theme", "dark");
    await act(async () => {});
    expect(pip.document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("closes a window that arrives after the room closed", async () => {
    const pip = fakeWindow();
    let resolve!: (value: Window) => void;
    installApi(() => new Promise<Window>(done => { resolve = done; }));
    const { result, rerender } = renderHook(({ active }) => useMiniTimer(active), { initialProps: { active: true } });
    let opening!: Promise<void>;
    act(() => { opening = result.current.open(); });
    rerender({ active: false });
    await act(async () => { resolve(pip); await opening; });
    expect(pip.closed).toBe(true);
    expect(result.current.window).toBeNull();
  });

  it("reports a refused window and clears the message on the next attempt", async () => {
    const pip = fakeWindow();
    let refuse = true;
    installApi(async () => { if (refuse) throw new DOMException("No gesture", "NotAllowedError"); return pip; });
    const { result } = renderHook(() => useMiniTimer(true));
    await act(() => result.current.open());
    expect(result.current.failed).toBe(true);
    expect(result.current.window).toBeNull();
    refuse = false;
    await act(() => result.current.open());
    expect(result.current.failed).toBe(false);
    expect(result.current.window).toBe(pip);
  });
});

describe("MiniTimerView", () => {
  it("shows Flow elapsed time without a progress bar", () => {
    const { container } = render(<MiniTimerView {...focus} serverMode="flow" flowElapsed={65} />);
    expect(screen.getByRole("timer")).toHaveTextContent("01:05");
    expect(screen.getByText("Flow")).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("fills the break bar from server progress", () => {
    const { container } = render(<MiniTimerView {...focus} phase="break" phaseProgress={0.25} />);
    expect(screen.getByText("Break")).toBeInTheDocument();
    const fill = container.querySelector('[aria-hidden="true"] > div') as HTMLElement;
    expect(fill.style.width).toBe("25%");
    expect(fill.className).toContain("bg-calm");
  });

  it("shows only the phase between timed phases", () => {
    render(<MiniTimerView {...focus} phase="ready" />);
    expect(screen.getByRole("timer")).toHaveTextContent("—");
    expect(screen.getByRole("timer")).toHaveAccessibleName("Ready · Go again");
  });
});

describe("MiniTimerToggle", () => {
  it("is hidden where the browser can't open a mini timer", () => {
    const { container } = render(<MiniTimerToggle opened={false} failed={false} onOpen={() => {}} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens and closes the mini timer", () => {
    installApi(async () => fakeWindow());
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<MiniTimerToggle opened={false} failed={false} onOpen={onOpen} onClose={onClose} />);
    screen.getByRole("button", { name: "Open mini timer" }).click();
    expect(onOpen).toHaveBeenCalled();
    rerender(<MiniTimerToggle opened failed={false} onOpen={onOpen} onClose={onClose} />);
    screen.getByRole("button", { name: "Close mini timer" }).click();
    expect(onClose).toHaveBeenCalled();
  });
});
