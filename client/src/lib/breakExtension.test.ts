import { describe, expect, it } from "vitest";
import { readBreakExtension } from "./breakExtension";

const state = { eligibleUserIds: ["alice", "bob"], status: "accepted", proposalId: "00000000-0000-4000-8000-000000000001", requesterId: "alice", extraSeconds: 120 };
describe("server break-extension snapshots", () => {
  it("accepts valid consensus and rejects fabricated time, identities and incomplete consent", () => {
    expect(readBreakExtension(state)).toEqual(state);
    for (const value of [null, {}, { ...state, extraSeconds: 999 }, { ...state, eligibleUserIds: ["alice", "alice"] },
      { ...state, requesterId: "outsider" }, { ...state, proposalId: "" }, { ...state, status: "pending" },
      { ...state, status: "available", extraSeconds: 0 }]) expect(readBreakExtension(value)).toBeNull();
  });
});
