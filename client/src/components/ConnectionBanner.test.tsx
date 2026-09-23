import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ConnectionBanner from "./ConnectionBanner";

describe("ConnectionBanner", () => {
  it("offers Retry when connection recovery fails before joining a room", () => {
    const onRetry = vi.fn();
    render(<ConnectionBanner state="offline" inSession={false} onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps transient reconnection notices inside an active room", () => {
    render(<ConnectionBanner state="reconnecting" inSession={false} onRetry={() => {}} />);

    expect(screen.queryByText("RECONNECTING…")).toBeNull();
  });
});
