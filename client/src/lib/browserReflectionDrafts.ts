// Opt-in recovery copies only. Confirmed reflections keep their existing server path.
export type BrowserReflectionDraft = { schema: 1; userId: string; sessionId: string; text: string; baselineText: string; version: number | null; updatedAt: number };
const PREFIX = "duodoro:reflection-draft:v1:";
const MAX_TEXT = 10_000;
const LIFETIME = 7 * 86400000;
let epoch = 0;
let cleanupFailed = false;
const cleanupListeners = new Set<() => void>();
function reportCleanupFailure(failed: boolean) {
  if (cleanupFailed === failed) return;
  cleanupFailed = failed; cleanupListeners.forEach(listener => listener());
}
export const browserDraftCleanupFailed = () => cleanupFailed;
export function subscribeBrowserDraftCleanup(listener: () => void) {
  cleanupListeners.add(listener); return () => { cleanupListeners.delete(listener); };
}
const keyFor = (userId: string, sessionId: string) => `${PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(sessionId)}`;
export const browserDraftEpoch = () => epoch;
export function removeBrowserReflectionDraft(userId: string, sessionId: string): boolean {
  try { sessionStorage.removeItem(keyFor(userId, sessionId)); return true; } catch { return false; }
}
export function readBrowserReflectionDraft(userId: string, sessionId: string): { draft: BrowserReflectionDraft | null; error: boolean } {
  let raw: string | null;
  try { raw = sessionStorage.getItem(keyFor(userId,sessionId)); } catch { return { draft:null,error:true }; }
  if (!raw) return { draft:null,error:false };
  try {
    if (raw.length > 125_000) throw new Error("oversized");
    const value = JSON.parse(raw) as BrowserReflectionDraft;
    if (value.schema !== 1 || value.userId !== userId || value.sessionId !== sessionId
      || typeof value.text !== "string" || value.text.length > MAX_TEXT || typeof value.baselineText !== "string" || value.baselineText.length > MAX_TEXT
      || value.text === value.baselineText || !(value.version === null || Number.isSafeInteger(value.version) && value.version > 0)
      || !Number.isFinite(value.updatedAt) || Date.now() - value.updatedAt > LIFETIME || value.updatedAt > Date.now() + 60_000) throw new Error("invalid");
    return { draft:value,error:false };
  } catch { return { draft:null,error:!removeBrowserReflectionDraft(userId,sessionId) }; }
}
export function writeBrowserReflectionDraft(draft: Omit<BrowserReflectionDraft,"schema" | "updatedAt">, expectedEpoch: number): boolean {
  if (expectedEpoch !== epoch || !(draft.version === null || Number.isSafeInteger(draft.version) && draft.version > 0) || draft.text.length > MAX_TEXT || draft.baselineText.length > MAX_TEXT) return false;
  if (draft.text === draft.baselineText) return removeBrowserReflectionDraft(draft.userId,draft.sessionId);
  try { sessionStorage.setItem(keyFor(draft.userId,draft.sessionId),JSON.stringify({ ...draft,schema:1,updatedAt:Date.now() })); return true; }
  catch { return false; }
}
// Also invalidate callbacks retained by an editor during sign-out/account changes.
export function clearBrowserReflectionDrafts(retainUserId?: string): boolean {
  epoch++;
  try {
    const keep = retainUserId ? `${PREFIX}${encodeURIComponent(retainUserId)}:` : null;
    const keys = Array.from({ length:sessionStorage.length },(_,index) => sessionStorage.key(index));
    for (const key of keys) if (key?.startsWith(PREFIX) && (!keep || !key.startsWith(keep))) sessionStorage.removeItem(key);
    if (!retainUserId) reportCleanupFailure(false);
    return true;
  } catch { reportCleanupFailure(true); return false; }
}
