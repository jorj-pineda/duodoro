import { randomUUID } from "node:crypto";
import { test, expect, requireSuccess } from "./duoFixture";
import { onboard } from "./onboard";

test("opt-in tab recovery survives refresh, saves only explicitly, and clears on discard and sign-out", async ({ duo }) => {
  const { a,admin,roomCodes } = duo;
  await a.page.goto("/"); await onboard(a.page,"Recovery Alpha",`rc_${randomUUID().slice(0,8)}`);
  const room = randomUUID(); roomCodes.add(room);
  requireSuccess((await admin.rpc("record_focus_session",{ p_recording_key:randomUUID(),p_room_code:room,p_world:"forest",p_focus_duration:600,p_break_duration:60,p_actual_focus:600,p_completed:true,p_started_at:new Date(Date.now()-600000).toISOString(),p_user_ids:[a.id] })).error,"Record recovery fixture");
  const copies = () => a.page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("duodoro:reflection-draft:")));
  const openCalendar = async () => {
    await a.page.getByRole("button",{ name:"Open stats",exact:true }).click();
    const panel = a.page.getByRole("dialog",{ name:"Stats",exact:true });
    await panel.getByRole("tab",{ name:"calendar",exact:true }).click(); return panel;
  };
  let panel = await openCalendar(); await panel.getByRole("button",{ name:"Add reflection",exact:true }).click();
  let text = panel.getByRole("textbox",{ name:"How did this session go?" });
  await text.fill("Recover this private writing"); expect(await copies()).toHaveLength(0);
  await panel.getByRole("checkbox",{ name:"Keep a recovery draft in this tab" }).check(); expect(await copies()).toHaveLength(1);
  a.page.once("dialog",dialog => dialog.accept()); await a.page.reload();
  panel = await openCalendar(); await panel.getByRole("button",{ name:"Add reflection",exact:true }).click();
  text = panel.getByRole("textbox",{ name:"How did this session go?" }); await expect(text).toHaveValue(""); await expect(text).toBeDisabled();
  await panel.getByRole("button",{ name:"Recover browser draft" }).click(); await expect(text).toHaveValue("Recover this private writing");
  const unsaved = await a.client.from("session_reflections").select("session_id").eq("user_id",a.id); requireSuccess(unsaved.error,"Read unsaved recovery"); expect(unsaved.data).toEqual([]);
  await a.page.setViewportSize({ width:390,height:844 }); await text.scrollIntoViewIfNeeded();
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await a.page.screenshot({ path:test.info().outputPath("recovered-reflection-phone.png") });
  await panel.getByRole("button",{ name:"Save reflection",exact:true }).click(); await expect(panel.getByText("Reflection saved",{ exact:true })).toBeVisible(); expect(await copies()).toHaveLength(0);
  await panel.getByRole("button",{ name:"Edit reflection",exact:true }).click(); await text.fill("Discard this browser copy");
  await panel.getByRole("checkbox",{ name:"Keep a recovery draft in this tab" }).check(); expect(await copies()).toHaveLength(1);
  a.page.once("dialog",dialog => dialog.accept()); await panel.getByRole("button",{ name:"Close",exact:true }).click(); expect(await copies()).toHaveLength(0);
  panel = await openCalendar(); await panel.getByRole("button",{ name:"Edit reflection",exact:true }).click();
  text = panel.getByRole("textbox",{ name:"How did this session go?" }); await text.fill("Remove this copy on sign-out");
  await panel.getByRole("checkbox",{ name:"Keep a recovery draft in this tab" }).check();
  a.page.once("dialog",dialog => dialog.accept()); await a.page.reload(); expect(await copies()).toHaveLength(1);
  await a.page.getByRole("button",{ name:"Open account menu",exact:true }).click();
  await a.page.getByRole("button",{ name:"Sign out",exact:true }).click();
  await expect(a.page.getByRole("button",{ name:"Continue with Google",exact:true })).toBeVisible(); expect(await copies()).toHaveLength(0);
});

test("sign-out still completes and warns if browser draft cleanup is blocked", async ({ duo }) => {
  const { a } = duo;
  await a.page.goto("/"); await onboard(a.page,"Recovery Warning",`rw_${randomUUID().slice(0,8)}`);
  await a.page.evaluate(() => {
    sessionStorage.setItem("duodoro:reflection-draft:v1:test:round","older private copy");
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function(key: string) {
      if (key.startsWith("duodoro:reflection-draft:")) throw new Error("blocked cleanup");
      return remove.call(this,key);
    };
  });
  await a.page.getByRole("button",{ name:"Open account menu",exact:true }).click();
  await a.page.getByRole("button",{ name:"Sign out",exact:true }).click();
  await expect(a.page.getByRole("button",{ name:"Continue with Google",exact:true })).toBeVisible();
  const warning = a.page.getByRole("alert").filter({ hasText:"Couldn't remove browser reflection drafts" });
  await expect(warning).toBeVisible(); await expect(warning).toContainText("Clear this tab’s site data");
  await a.page.setViewportSize({ width:390,height:844 });
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await a.page.screenshot({ path:test.info().outputPath("cleanup-warning-phone.png") });
});
