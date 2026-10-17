import { expect,it,vi } from "vitest";
import { createPreferenceSync } from "./preferenceSync";
import type { PreferenceKey,PreferenceRow } from "./accountPreferences";
import type { Json } from "./database.types";
function setup(legacy: Partial<Record<PreferenceKey,Json>> = {}, initial: PreferenceRow[] = []) {
  const rows = new Map(initial.map(row=>[row.key,row]));
  const apply = vi.fn((key: PreferenceKey,value: Json)=>{ legacy[key]=value; });
  const transport = {
    read:vi.fn(async()=>[...rows.values()]),
    write:vi.fn(async(key: PreferenceKey,value: Json,version: number | null)=>{
      const old = rows.get(key);
      if ((old?.version ?? null) !== version) throw { code:"PT409" };
      const result = { user_id:"owner",key,value,version:(version ?? 0)+1 }; rows.set(key,result); return result;
    }),
  };
  const sync = createPreferenceSync("owner",transport,{ read:()=>legacy,apply });
  const ready = async()=>{ sync.start(); await vi.waitFor(()=>expect(sync.getSnapshot().loaded).toBe(true)); };
  const settled = async()=>vi.waitFor(()=>{ expect(sync.getSnapshot().saving).toBe(false); expect(sync.getSnapshot().pending).toEqual([]); });
  return { sync,transport,rows,legacy,apply,ready,settled };
}
const row = (key: PreferenceKey,value: Json,version=1): PreferenceRow=>({user_id:"owner",key,value,version});
it("imports explicit legacy keys only after a successful missing-row read and never overwrites account settings", async()=>{
  const f=setup({pet:"cat",daily_goal:120},[row("pet","dog")]); await f.ready(); await f.settled();
  expect(f.transport.write).toHaveBeenCalledExactlyOnceWith("daily_goal",120,null);
  expect(f.apply).toHaveBeenCalledWith("pet","dog"); expect(f.rows.size).toBe(2);
  f.sync.stop();
});
it("keeps existing preferences usable when initial reads fail and does not upload defaults", async()=>{
  const f=setup({pet:"cat"}); f.transport.read.mockRejectedValueOnce(new Error("offline")); f.sync.start();
  await vi.waitFor(()=>expect(f.sync.getSnapshot().error).toBe(true)); expect(f.transport.write).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
  await f.sync.reload(); await f.settled(); expect(f.rows.get("pet")?.value).toBe("cat"); f.sync.stop();
});
it("serializes rapid edits and preserves a reversal while an older write is in flight", async()=>{
  const f=setup({},[row("pet","cat")]); await f.ready();
  let finish!: (value: PreferenceRow)=>void;
  f.transport.write.mockImplementationOnce(()=>new Promise(resolve=>{ finish=resolve; }));
  f.sync.change("pet","dog"); f.sync.change("pet","cat");
  finish(row("pet","dog",2)); await f.settled();
  expect(f.transport.write).toHaveBeenLastCalledWith("pet","cat",2); expect(f.rows.get("pet")?.value).toBe("cat"); f.sync.stop();
});
it("uses independent revisions and requires an explicit choice for a conflicting setting", async()=>{
  const f=setup({},[row("daily_goal",60),row("quiet_focus",false)]); await f.ready();
  f.rows.set("daily_goal",row("daily_goal",120,2)); f.sync.change("daily_goal",90);
  await vi.waitFor(()=>expect(f.sync.getSnapshot().conflicts).toEqual([{key:"daily_goal",device:90,account:120}]));
  f.sync.change("quiet_focus",true);
  await vi.waitFor(()=>expect(f.rows.get("quiet_focus")?.value).toBe(true));
  f.sync.resolve("daily_goal","device"); await f.settled(); expect(f.rows.get("daily_goal")).toEqual(row("daily_goal",90,3));
  f.rows.set("daily_goal",row("daily_goal",180,4)); f.sync.change("daily_goal",240);
  await vi.waitFor(()=>expect(f.sync.getSnapshot().conflicts).toHaveLength(1));
  f.sync.resolve("daily_goal","account"); await f.settled(); expect(f.apply).toHaveBeenLastCalledWith("daily_goal",180); expect(f.rows.get("daily_goal")?.version).toBe(4); f.sync.stop();
});
it("reconciles a committed write whose acknowledgement was lost without creating a second write", async()=>{
  const f=setup({},[row("quiet_focus",false)]); await f.ready();
  f.transport.write.mockImplementationOnce(async(key,value)=>{ f.rows.set(key,row(key,value,2)); throw new Error("lost response"); });
  f.sync.change("quiet_focus",true); await vi.waitFor(()=>expect(f.sync.getSnapshot().error).toBe(true));
  await f.sync.reload(); await f.settled(); expect(f.transport.write).toHaveBeenCalledTimes(1); expect(f.sync.getSnapshot().error).toBe(false); f.sync.stop();
});
it("retries a failed uncommitted write only after reading its revision, and protects newer remote edits", async()=>{
  const f=setup({},[row("pet","cat")]); await f.ready(); f.transport.write.mockRejectedValueOnce(new Error("offline"));
  f.sync.change("pet","dog"); await vi.waitFor(()=>expect(f.sync.getSnapshot().error).toBe(true));
  f.sync.change("name_cat","Local name"); expect(f.transport.write).toHaveBeenCalledTimes(1);
  f.rows.set("pet",row("pet","rabbit",2)); await f.sync.reload();
  await vi.waitFor(()=>expect(f.sync.getSnapshot().conflicts).toEqual([{key:"pet",device:"dog",account:"rabbit"}]));
  expect(f.transport.write).not.toHaveBeenCalledWith("pet","dog",2); f.sync.stop();
});
it("preserves edits made during initial loading and rejects foreign or malformed snapshots", async()=>{
  const f=setup(); let finish!: (value: PreferenceRow[])=>void;
  f.transport.read.mockImplementationOnce(()=>new Promise(resolve=>{ finish=resolve; })); f.sync.start(); f.sync.change("pet","cat"); finish([row("pet","dog")]);
  await vi.waitFor(()=>expect(f.sync.getSnapshot().conflicts).toHaveLength(1)); expect(f.transport.write).not.toHaveBeenCalled();
  f.transport.read.mockResolvedValueOnce([{...row("pet","cat"),user_id:"other"}]); await f.sync.reload();
  expect(f.sync.getSnapshot().error).toBe(true); expect(f.apply).not.toHaveBeenCalled(); f.sync.stop();
});
it("drops late reads and confirmations after sign-out and safely reconciles on a later mount", async()=>{
  const f=setup(); await f.ready(); let finish!: (value: PreferenceRow)=>void;
  f.transport.write.mockImplementationOnce(()=>new Promise(resolve=>{ finish=resolve; }));
  f.sync.change("pet","cat"); const before=f.sync.getSnapshot(); f.sync.stop(); finish(row("pet","cat")); await Promise.resolve();
  expect(f.sync.getSnapshot()).toBe(before);
  f.rows.set("pet",row("pet","cat")); await f.ready(); await f.settled(); expect(f.transport.write).toHaveBeenCalledTimes(1); f.sync.stop();
});
it("retains an offline edit and its conflict across a full page reload",async()=>{
  const rows=[row("pet","rabbit",2)];
  let stored:{key:PreferenceKey;value:Json;base:number|null|undefined;conflict?:boolean}[]=[{key:"pet",value:"dog",base:1}];
  const transport={read:vi.fn(async()=>rows),write:vi.fn(async()=>row("pet","dog",3))};
  const local={read:()=>({}),apply:vi.fn(),readPending:()=>stored,savePending:(values:typeof stored)=>{stored=values;}};
  const first=createPreferenceSync("owner",transport,local);first.start();
  await vi.waitFor(()=>expect(first.getSnapshot().conflicts).toHaveLength(1));first.stop();
  expect(stored[0].conflict).toBe(true);
  const second=createPreferenceSync("owner",transport,local);second.start();
  await vi.waitFor(()=>expect(second.getSnapshot().loaded).toBe(true));
  expect(second.getSnapshot().conflicts).toHaveLength(1);expect(transport.write).not.toHaveBeenCalled();second.stop();
});
it("asks before replacing an unimported legacy preference with a different account value",async()=>{
  const transport={read:vi.fn(async()=>[row("pet","rabbit")]),write:vi.fn(async()=>row("pet","cat",2))};
  const apply=vi.fn();
  const sync=createPreferenceSync("owner",transport,{read:()=>({pet:"cat"}),apply,imported:()=>false});sync.start();
  await vi.waitFor(()=>expect(sync.getSnapshot().conflicts).toEqual([{key:"pet",device:"cat",account:"rabbit"}]));
  expect(apply).not.toHaveBeenCalled();expect(transport.write).not.toHaveBeenCalled();sync.stop();
});
