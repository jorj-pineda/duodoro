import type { Json } from "./database.types";
import { defaults, isPreferenceKey, readPreferenceRow, samePreference, validPreference, type PreferenceKey, type PreferenceRow } from "./accountPreferences";
export type PreferenceTransport = {
  read: () => Promise<unknown[]>;
  write: (key: PreferenceKey,value: Json,version: number | null) => Promise<unknown>;
};
type Pending = { value: Json; base: number | null | undefined; conflict: boolean; tag: number };
export type PreferenceSyncState = { loaded: boolean; loading: boolean; saving: boolean; error: boolean; pending: PreferenceKey[];
  conflicts: { key: PreferenceKey; device: Json; account: Json }[] };
export const EMPTY_SYNC: PreferenceSyncState = { loaded:false,loading:false,saving:false,error:false,pending:[],conflicts:[] };

// Transport and local adapters are injected so race/error behavior is tested
// without auth mocks, DOM, timers, or a second source of preference values.
export function createPreferenceSync(userId: string, transport: PreferenceTransport, local: {
  read: () => Partial<Record<PreferenceKey,Json>>; apply: (key: PreferenceKey,value: Json) => void;
  imported?: (key: PreferenceKey) => boolean;
  confirmed?: (key: PreferenceKey) => void;
  readPending?: () => { key: PreferenceKey; value: Json; base: number | null | undefined; conflict?: boolean }[];
  savePending?: (values: { key: PreferenceKey; value: Json; base: number | null | undefined; conflict?: boolean }[]) => void;
}) {
  let active = false, epoch = 0, serial = 0, revision = 0, writing: PreferenceKey | null = null, loading = false, reloadAfterWrite = false;
  let state = EMPTY_SYNC, restored = false;
  const remote = new Map<PreferenceKey,PreferenceRow>();
  const pending = new Map<PreferenceKey,Pending>();
  const listeners = new Set<() => void>();
  const notify = (patch: Partial<PreferenceSyncState> = {}) => {
    local.savePending?.([...pending].map(([key,p])=>({key,value:p.value,base:p.base,conflict:p.conflict})));
    state = { ...state,...patch,pending:[...pending.keys()],conflicts:[...pending].filter(([,p])=>p.conflict)
      .map(([key,p])=>({ key,device:p.value,account:remote.get(key)?.value ?? defaults[key] })) };
    listeners.forEach(fn=>fn());
  };
  const apply = (key: PreferenceKey,value: Json) => local.apply(key,value);
  async function load() {
    if (!active || loading) return;
    if (writing) { reloadAfterWrite = true; return; }
    const generation = epoch, request = revision;
    loading = true; notify({ loading:true });
    try {
      const raw = await transport.read();
      if (!active || generation !== epoch || request !== revision) return;
      const rows = raw.map(value=>readPreferenceRow(value,userId));
      if (rows.some(row=>!row) || new Set(rows.map(row=>row!.key)).size !== rows.length) throw new Error("invalid read");
      remote.clear(); rows.forEach(row=>remote.set(row!.key,row!));
      // Import only explicitly configured legacy values and only into missing
      // account keys. A successful empty read is required before any creation.
      if (!state.loaded) for (const [key,value] of Object.entries(local.read())) {
        if (!isPreferenceKey(key) || !validPreference(key,value) || pending.has(key)) continue;
        const row = remote.get(key);
        if (!row) pending.set(key,{ value,base:null,conflict:false,tag:++serial });
        else if (local.imported && !local.imported(key) && !samePreference(row.value,value)) {
          pending.set(key,{ value,base:row.version,conflict:true,tag:++serial });
        }
      }
      for (const [key,p] of pending) {
        const row = remote.get(key);
        if (row && samePreference(row.value,p.value)) { pending.delete(key); apply(key,row.value); local.confirmed?.(key); }
        else if (p.base === undefined) { p.base = row?.version ?? null; p.conflict = !!row; }
        else if ((row?.version ?? null) !== p.base) p.conflict = true;
      }
      for (const [key,row] of remote) if (!pending.has(key)) { apply(key,row.value); local.confirmed?.(key); }
      notify({ loaded:true,error:false });
    } catch { if (active && generation === epoch && request === revision) notify({ error:true }); }
    finally {
      if (active && generation === epoch) { loading = false; notify({ loading:false }); void drain(); }
    }
  }
  async function drain() {
    if (!active || loading || writing || !state.loaded || state.error) return;
    const next = [...pending].find(([,p])=>!p.conflict);
    if (!next) { notify({ saving:false }); return; }
    const [key,p] = next, generation = epoch, tag = p.tag;
    writing = key; ++revision; notify({ saving:true });
    let reconcile = false;
    try {
      const result = await transport.write(key,p.value,p.base ?? null);
      if (!active || epoch !== generation) return;
      const row = readPreferenceRow(result,userId);
      if (!row || row.key !== key || !samePreference(row.value,p.value) || row.version <= (p.base ?? 0)) throw new Error("unconfirmed");
      remote.set(key,row); local.confirmed?.(key);
      const latest = pending.get(key);
      if (latest?.tag === tag) pending.delete(key);
      else if (latest) { latest.base = row.version; latest.conflict = false; }
      notify({ error:false });
    } catch (error) {
      if (active && epoch === generation) {
        notify({ error:true });
        reconcile = !!error && typeof error === "object" && "code" in error && error.code === "PT409";
      }
    } finally {
      if (active && epoch === generation) {
        writing = null; notify({ saving:false });
        if (reconcile || reloadAfterWrite) { reloadAfterWrite = false; void load(); } else void drain();
      }
    }
  }
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    start: () => {
      active = true; ++epoch;
      if (!restored) {
        restored = true;
        for (const value of local.readPending?.() ?? []) {
          pending.set(value.key,{ ...value,conflict:value.conflict ?? false,tag:++serial }); apply(value.key,value.value);
        }
      }
      void load();
    },
    stop: () => { active = false; ++epoch; writing = null; loading = false; },
    reload: load,
    change(key: PreferenceKey,value: Json) {
      if (!active || !validPreference(key,value)) return;
      const row = remote.get(key);
      if (writing !== key && row && samePreference(row.value,value)) pending.delete(key);
      else pending.set(key,{ value,base:state.loaded ? row?.version ?? null : undefined,conflict:pending.get(key)?.conflict ?? false,tag:++serial });
      notify();
      if (!state.loaded && !loading) void load(); else void drain();
    },
    resolve(key: PreferenceKey,choice: "account" | "device") {
      if (!active || state.error || writing || loading || !pending.get(key)?.conflict) return;
      if (choice === "account") { pending.delete(key); apply(key,remote.get(key)?.value ?? defaults[key]); local.confirmed?.(key); }
      else { const p = pending.get(key)!; p.base = remote.get(key)?.version ?? null; p.conflict = false; p.tag = ++serial; }
      notify(); void drain();
    },
  };
}
