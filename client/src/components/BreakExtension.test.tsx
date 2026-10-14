import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import BreakExtension from "./BreakExtension";
import type { BreakExtensionState } from "@/lib/sessionTypes";

const state: BreakExtensionState = { eligibleUserIds: ["alice", "bob"], status: "available", proposalId: null, requesterId: null, extraSeconds: 0 };
const proposal = { ...state, status: "pending" as const, proposalId: "00000000-0000-4000-8000-000000000001", requesterId: "alice" };

describe("break extension consent", () => {
  it("asks once and reports confirmation failure without claiming extra time", async () => {
    const onRequest = vi.fn().mockResolvedValue("Couldn't confirm");
    render(<BreakExtension state={state} userId="alice" connected hasTime onRequest={onRequest} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Ask for 2 more minutes" })));
    expect(onRequest).toHaveBeenCalledWith(undefined, undefined);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't confirm");
    expect(screen.queryByText(/Two minutes added/)).toBeNull();
  });
  it("allows only the other person to answer with explicit accept or decline", async () => {
    const onRequest = vi.fn().mockResolvedValue(null);
    const { rerender } = render(<BreakExtension state={proposal} userId="alice" connected hasTime onRequest={onRequest} />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<BreakExtension state={proposal} userId="bob" connected hasTime onRequest={onRequest} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Keep original break" })));
    expect(onRequest).toHaveBeenCalledWith(proposal.proposalId, false);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Agree · +2 minutes" })));
    expect(onRequest).toHaveBeenCalledWith(proposal.proposalId, true);
  });
  it("blocks disconnected and expired replies and hides ineligible solo rooms", () => {
    const onRequest = vi.fn();
    const { rerender } = render(<BreakExtension state={proposal} userId="bob" connected={false} hasTime onRequest={onRequest} />);
    expect(screen.getByRole("button", { name: "Agree · +2 minutes" })).toBeDisabled();
    rerender(<BreakExtension state={proposal} userId="bob" connected hasTime={false} onRequest={onRequest} />);
    expect(screen.getByRole("button", { name: "Keep original break" })).toBeDisabled();
    rerender(<BreakExtension state={{ ...state, eligibleUserIds: [] }} userId="bob" connected hasTime onRequest={onRequest} />);
    expect(screen.queryByRole("region")).toBeNull();
  });
});
