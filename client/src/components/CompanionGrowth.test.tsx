import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import CompanionGrowth from "./CompanionGrowth";
afterEach(cleanup);
const props = { grewTo: null, onRetry: vi.fn(), onDismiss: vi.fn() };
describe("companion growth progress", () => {
  it("shows progress within each level and rounds remaining time up", () => {
    const { rerender } = render(<CompanionGrowth {...props} seconds={10799} />);
    expect(screen.getByText("1m until Level 2")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "99");
    rerender(<CompanionGrowth {...props} seconds={10800} />);
    expect(screen.getByText("Level 2 · Grown")).toBeVisible();
    expect(screen.getByText("12h 0m until Level 3")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    rerender(<CompanionGrowth {...props} seconds={32400} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });
  it("reports fully grown without another target and allows dismissal of a milestone", () => {
    render(<CompanionGrowth {...props} grewTo="full" seconds={54000} />);
    expect(screen.getByText("Level 3 · Fully grown")).toBeVisible();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Your companion grew to Level 3");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss growth milestone" }));
    expect(props.onDismiss).toHaveBeenCalled();
  });
  it("keeps missing totals distinct from successful zero and offers retry", () => {
    const { rerender } = render(<CompanionGrowth {...props} seconds={null} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry growth" }));
    expect(props.onRetry).toHaveBeenCalled();
    rerender(<CompanionGrowth {...props} seconds={0} />);
    expect(screen.getByText("Level 1 · Young")).toBeVisible();
    expect(screen.getByText("3h 0m until Level 2")).toBeVisible();
  });
  it("renders a stable SSR snapshot and accessible progress", async () => {
    expect(renderToString(<CompanionGrowth {...props} seconds={null} />)).toContain("Growth progress unavailable");
    const { container } = render(<CompanionGrowth {...props} seconds={9000} />);
    await expectNoAxeViolations(container);
  });
});
