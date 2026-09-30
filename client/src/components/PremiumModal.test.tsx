import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PremiumModal from "./PremiumModal";

// Premium is granted by an RPC, not by a table write — `is_premium` is not
// writable by `authenticated` and must never become writable (migration 010).
// What these check is that the client actually calls it, reads the error, and
// never reports success it didn't get.

const rpc = vi.fn();
const getUser = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ rpc, auth: { getUser } }),
}));

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: {}, error: null });
  getUser
    .mockReset()
    .mockResolvedValue({ data: { user: { email: "jorge@example.com" } } });
});

function open(props: Partial<React.ComponentProps<typeof PremiumModal>> = {}) {
  const onClaimed = props.onClaimed ?? vi.fn();
  const onClose = props.onClose ?? vi.fn();
  const utils = render(
    <PremiumModal
      open
      onClose={onClose}
      isPremium={props.isPremium ?? false}
      onClaimed={onClaimed}
    />,
  );
  return { ...utils, onClaimed, onClose };
}

describe("PremiumModal", () => {
  it("shows the account email rather than asking for one", async () => {
    // The address is the one Google or Discord already verified. Letting
    // someone type one would make the confirmed-email check meaningless —
    // you'd be confirming whatever they just typed.
    open();
    expect(await screen.findByText("jorge@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("claims premium through the RPC, passing the opt-in", async () => {
    const { onClaimed } = open();
    await screen.findByText("jorge@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Unlock companions" }));
    await waitFor(() => expect(onClaimed).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith("claim_premium", {
      p_marketing_opt_in: true,
    });
  });

  it("unlocks even when they decline the mailing list", async () => {
    // The copy promises this, so it needs to be true: opting out of email is
    // not opting out of pets.
    const { onClaimed } = open();
    await screen.findByText("jorge@example.com");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Unlock companions" }));
    await waitFor(() => expect(onClaimed).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith("claim_premium", {
      p_marketing_opt_in: false,
    });
  });

  it("reports a failure instead of claiming success", async () => {
    // A modal that closes on a failed grant tells someone they have pets and
    // then shows them padlocks. Check the error on the write.
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { onClaimed } = open();
    await screen.findByText("jorge@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Unlock companions" }));
    expect(await screen.findByText(/Couldn't unlock companions/)).toBeInTheDocument();
    expect(onClaimed).not.toHaveBeenCalled();
  });

  it("explains an unconfirmed address specifically", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "your account has no confirmed email address" },
    });
    open();
    await screen.findByText("jorge@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Unlock companions" }));
    expect(
      await screen.findByText(/doesn't have a confirmed email address/),
    ).toBeInTheDocument();
  });

  it("does not offer to unlock what someone already has", async () => {
    open({ isPremium: true });
    expect(
      screen.queryByRole("button", { name: "Unlock companions" }),
    ).toBeNull();
    expect(screen.getByText(/You're all set/)).toBeInTheDocument();
  });

  it("only promises features that exist", async () => {
    // The old list claimed premium skins, stats and history, friend
    // notifications, and all world themes. Stats are open to everyone, the
    // focus-completion notifications are free, world themes stopped
    // being a choice in PR #38, and there are no premium skins.
    open();
    await screen.findByText("jorge@example.com");
    for (const fiction of [
      /world themes/i,
      /session history/i,
      /notification/i,
      /skins/i,
    ]) {
      expect(screen.queryByText(fiction)).toBeNull();
    }
    expect(
      screen.getByRole("heading", { name: "Companions" }),
    ).toBeInTheDocument();
  });

  it("never mentions a price, because there isn't one", async () => {
    // billing.ts is a seam, not a product. Nothing here may imply a charge.
    const { container } = open();
    await screen.findByText("jorge@example.com");
    expect(container.textContent).not.toMatch(/\$|\/mo|subscri|payment|card/i);
    expect(container.textContent).toMatch(/free/i);
  });

  it("does not present companion access as a paid tier", async () => {
    const { container } = open();
    await screen.findByText("jorge@example.com");
    expect(container.textContent).not.toMatch(/premium|upgrade|pro\b/i);
    expect(container.textContent).toMatch(/marketing is optional/i);
  });

  it("draws a companion instead of a paw-print emoji", () => {
    // A/B — the previous commit opened with 🐾.
    const { container } = open();
    expect(container.textContent).not.toMatch(/🐾/);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
