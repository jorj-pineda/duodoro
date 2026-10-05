import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import TimerProgress from "./TimerProgress";

afterEach(cleanup);
describe("timer progress", () => {
  it("shows real progress without reporting completion before the endpoint", () => {
    const { rerender } = render(<TimerProgress phase="focus" progress={0.425} />);
    expect(screen.getByRole("progressbar", { name: "Focus progress" })).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("42%")).toBeVisible();
    rerender(<TimerProgress phase="focus" progress={0.58} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "58");
    rerender(<TimerProgress phase="focus" progress={0.9999} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "99");
    rerender(<TimerProgress phase="focus" progress={1} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
  it("keeps invalid/out-of-range snapshots bounded and changes the phase label", () => {
    const { rerender } = render(<TimerProgress phase="break" progress={-0.1} />);
    expect(screen.getByRole("progressbar", { name: "Break progress" })).toHaveAttribute("aria-valuenow", "0");
    for (const progress of [NaN, Infinity]) {
      rerender(<TimerProgress phase="break" progress={progress} />);
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    }
    rerender(<TimerProgress phase="break" progress={1.2} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
  it("uses a stable SSR render and accessible phase/percentage descriptions", async () => {
    expect(renderToString(<TimerProgress phase="focus" progress={0} />)).toContain("0% of focus completed");
    const { container } = render(<TimerProgress phase="break" progress={0.5} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "50% of break completed");
    await expectNoAxeViolations(container);
  });
});
