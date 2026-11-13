import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { browserDraftEpoch, clearBrowserReflectionDrafts, readBrowserReflectionDraft, writeBrowserReflectionDraft, removeBrowserReflectionDraft } from "./browserReflectionDrafts";
const draft = { userId:"a",sessionId:"round",text:"unsaved",baselineText:"saved",version:2 };
beforeEach(() => { sessionStorage.clear(); clearBrowserReflectionDrafts(); });
afterEach(() => vi.restoreAllMocks());
it("keeps exact writing and its frozen revision in tab storage, isolated by account and session", () => {
  expect(writeBrowserReflectionDraft(draft,browserDraftEpoch())).toBe(true);
  expect(readBrowserReflectionDraft("a","round").draft).toMatchObject(draft);
  expect(readBrowserReflectionDraft("b","round").draft).toBeNull(); expect(readBrowserReflectionDraft("a","other").draft).toBeNull();
  expect(localStorage.getItem("duodoro:reflection-draft:v1:a:round")).toBeNull();
});
it("clears only recovery copies on sign-out and rejects callbacks from the old session", () => {
  const epoch = browserDraftEpoch(); writeBrowserReflectionDraft(draft,epoch); sessionStorage.setItem("duodoro:session","room");
  clearBrowserReflectionDrafts(); expect(readBrowserReflectionDraft("a","round").draft).toBeNull();
  expect(sessionStorage.getItem("duodoro:session")).toBe("room"); expect(writeBrowserReflectionDraft(draft,epoch)).toBe(false);
});
it("retains the signed-in account after refresh and removes other accounts", () => {
  writeBrowserReflectionDraft(draft,browserDraftEpoch()); writeBrowserReflectionDraft({ ...draft,userId:"b" },browserDraftEpoch());
  clearBrowserReflectionDrafts("a"); expect(readBrowserReflectionDraft("a","round").draft).not.toBeNull(); expect(readBrowserReflectionDraft("b","round").draft).toBeNull();
});
it("rejects malformed, mismatched or expired copies and never truncates oversized writing", () => {
  const key = "duodoro:reflection-draft:v1:a:round";
  for (const raw of ["not json",JSON.stringify({ ...draft,schema:1,userId:"b",updatedAt:Date.now() }),JSON.stringify({ ...draft,schema:1,updatedAt:Date.now()-8*86400000 })]) {
    sessionStorage.setItem(key,raw); expect(readBrowserReflectionDraft("a","round").draft).toBeNull(); expect(sessionStorage.getItem(key)).toBeNull();
  }
  expect(writeBrowserReflectionDraft({ ...draft,text:"x".repeat(10001) },browserDraftEpoch())).toBe(false);
  expect(writeBrowserReflectionDraft({ ...draft,version:NaN },browserDraftEpoch())).toBe(false);
});
it("reports storage errors and removes clean or explicitly discarded drafts", () => {
  writeBrowserReflectionDraft(draft,browserDraftEpoch()); expect(removeBrowserReflectionDraft("a","round")).toBe(true);
  writeBrowserReflectionDraft({ ...draft,text:draft.baselineText },browserDraftEpoch()); expect(readBrowserReflectionDraft("a","round").draft).toBeNull();
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(() => { throw new Error("quota"); });
  expect(writeBrowserReflectionDraft(draft,browserDraftEpoch())).toBe(false);
});
