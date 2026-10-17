import { afterEach,expect,it,vi } from "vitest";
import { preferenceOutbox,validPreference,readPreferenceRow,samePreference,devicePreferences } from "./accountPreferences";
afterEach(()=>{localStorage.clear();vi.restoreAllMocks();});
it("validates supported preferences without accepting profile privileges or malformed preset arrays",()=>{
  expect(validPreference("pet","cat")).toBe(true);expect(validPreference("pet",null)).toBe(true);expect(validPreference("pet","fox")).toBe(false);
  expect(validPreference("name_cat","🐱".repeat(24))).toBe(true);expect(validPreference("name_cat","bad\nname")).toBe(false);
  expect(validPreference("presets",[{name:"A",mode:"flow",focus:25,break:5}])).toBe(true);
  expect(validPreference("presets",[{name:"A",mode:"flow",focus:7,break:5}])).toBe(false);
  expect(validPreference("presets",[{name:"A",mode:"flow",focus:25,break:5,extra:true}])).toBe(false);
  expect(readPreferenceRow({user_id:"other",key:"pet",value:"cat",version:1},"owner")).toBeNull();
  expect(readPreferenceRow({user_id:"owner",key:"is_premium",value:true,version:1},"owner")).toBeNull();
  expect(samePreference([{name:"A",mode:"flow",focus:25,break:5}],[{focus:25,mode:"flow",name:"A",break:5}])).toBe(true);
});
it("keeps durable pending values, revisions and conflicts separate by account",()=>{
  const a=preferenceOutbox("a"); a.save([{key:"pet",value:null,base:3,conflict:true}]);
  expect(preferenceOutbox("b").read()).toEqual([]);
  expect(preferenceOutbox("a").read()).toEqual([{key:"pet",value:null,base:3,conflict:true}]);
  const b=preferenceOutbox("a");b.read();b.save([{key:"pet",value:"dog",base:3}]);
  a.save([]); // Older tab's acknowledgement cannot delete the newer edit.
  expect(preferenceOutbox("a").read()).toEqual([{key:"pet",value:"dog",base:3,conflict:false}]);
});
it("ignores corrupt outbox values and tolerates blocked browser storage",()=>{
  localStorage.setItem("duodoro:preferences-outbox:a:pet",'{"value":"fox","base":1}');
  expect(preferenceOutbox("a").read()).toEqual([]);
  vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw new Error("blocked");});
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("blocked");});
  const outbox=preferenceOutbox("a");expect(outbox.read()).toEqual([]);expect(()=>outbox.save([{key:"pet",value:"cat",base:null}])).not.toThrow();
});

it("does not import defaults from corrupt legacy storage",()=>{
  localStorage.setItem("duodoro:companion:corrupt","fox");
  localStorage.setItem("duodoro:daily-goal:corrupt","garbage");
  localStorage.setItem("duodoro:quiet-focus:corrupt","garbage");
  localStorage.setItem("duodoro:session-presets:corrupt","garbage");
  expect(devicePreferences("corrupt")).toEqual({});
});
