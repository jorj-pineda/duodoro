import { randomUUID } from "node:crypto";
import { test, expect, requireSuccess } from "./duoFixture";
import { onboard } from "./onboard";

test("database naming rules cover direct writes, setup, retries, and concurrent renames", async ({ duo }) => {
  const { a, admin } = duo;
  const oversized = await a.client.from("profiles").update({ display_name: "x".repeat(10000) }).eq("id",a.id);
  expect(oversized.error?.code).toBe("23514");
  await a.page.goto("/"); await onboard(a.page,"Names Alpha",`nma_${randomUUID().slice(0,8)}`);
  await expect(a.page.getByRole("button",{ name:"Focus",exact:true })).toBeVisible();
  const read = await a.client.from("profiles").select("display_name,display_name_changed_at").eq("id",a.id).single();
  requireSuccess(read.error,"Read setup name"); expect(read.data?.display_name).toBe("Names Alpha");
  expect(read.data?.display_name_changed_at).toBeTruthy();
  const bypass = await a.client.from("profiles").update({ display_name: "Bypass Name" }).eq("id",a.id);
  expect(bypass.error?.code).toBe("P0001");
  const retry = await a.client.rpc("change_display_name",{ new_name: " Names Alpha " });
  requireSuccess(retry.error,"Retry identical name");
  expect(retry.data).toEqual(read.data);
  await a.page.getByRole("button",{ name:"Open account menu",exact:true }).click();
  await a.page.getByRole("button",{ name:"Change display name",exact:true }).click();
  const dialog = a.page.getByRole("dialog",{ name:"Change display name",exact:true });
  await expect(dialog.getByText("Available in 7 days",{ exact:true })).toBeVisible();
  await expect(dialog.getByRole("textbox")).toHaveCount(0);

  // The trusted fixture advances only the cooldown. Clients cannot write it.
  requireSuccess((await admin.from("profiles").update({ display_name_changed_at: new Date(Date.now()-8*86_400_000).toISOString() }).eq("id",a.id)).error,"Advance fixture cooldown");
  const results = await Promise.all([
    a.client.from("profiles").update({ display_name:"Direct Winner" }).eq("id",a.id).select("display_name"),
    a.client.rpc("change_display_name",{ new_name:"RPC Winner" }),
  ]);
  expect(results.filter(result=>!result.error)).toHaveLength(1);
  expect(results.find(result=>result.error)?.error?.code).toBe("P0001");
  const final = await a.client.from("profiles").select("display_name,display_name_changed_at").eq("id",a.id).single();
  requireSuccess(final.error,"Read race winner");
  expect(["Direct Winner","RPC Winner"]).toContain(final.data?.display_name);
  expect(Date.parse(final.data!.display_name_changed_at!)).toBeGreaterThan(Date.now()-60_000);
});
