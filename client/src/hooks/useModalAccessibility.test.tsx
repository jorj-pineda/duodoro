import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useModalAccessibility } from "./useModalAccessibility";

function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useModalAccessibility<HTMLDivElement>(open, onClose);
  return open ? (
    <div ref={ref} role="dialog" tabIndex={-1}>
      <button>First</button>
      <button data-autofocus>Preferred</button>
      <button>Last</button>
    </div>
  ) : null;
}

describe("useModalAccessibility", () => {
  it("moves focus inside and restores the opener when closed", async () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { rerender } = render(<Harness open onClose={onClose} />);

    await vi.waitFor(() => expect(screen.getByText("Preferred")).toHaveFocus());
    rerender(<Harness open={false} onClose={onClose} />);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("leaves the modal open when an editor has already handled Escape", () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    document.dispatchEvent(event);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("wraps Tab at both ends", () => {
    render(<Harness open onClose={() => {}} />);
    const first = screen.getByText("First");
    const last = screen.getByText("Last");

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });
});
