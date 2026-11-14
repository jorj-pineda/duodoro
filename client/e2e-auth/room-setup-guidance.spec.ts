import { randomUUID } from "node:crypto";
import { test, expect } from "./duoFixture";
import { onboard } from "./onboard";

test("room setup guidance is optional, private about reflections and reachable on phones", async ({ duo }) => {
  const { a,roomCodes } = duo;
  await a.page.goto("/"); await onboard(a.page,"Setup Alpha",`sg_${randomUUID().slice(0,8)}`);
  await a.page.getByRole("button",{ name:"Focus",exact:true }).click();
  const start = a.page.getByRole("button",{ name:"Start solo",exact:true }); await expect(start).toBeVisible();
  const room = await a.page.evaluate(() => localStorage.getItem("duodoro:session")); if (room) roomCodes.add(room);
  const guide = a.page.getByRole("complementary",{ name:"Room setup guidance" });
  await expect(guide).toContainText("Saving an intention shares it with your room partner");
  await expect(guide).toContainText("Reflections written after a session stay private");
  for (const viewport of [{ width:390,height:844 },{ width:844,height:390 }]) {
    await a.page.setViewportSize(viewport); await guide.scrollIntoViewIfNeeded();
    expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await a.page.screenshot({ path:test.info().outputPath(`setup-${viewport.width}.png`) });
    await start.scrollIntoViewIfNeeded(); await expect(start).toBeInViewport();
  }
  await a.page.getByRole("button",{ name:"Dismiss room setup tip" }).click(); await expect(guide).toHaveCount(0);
  await expect(start).toBeEnabled(); await a.page.reload(); await expect(start).toBeVisible(); await expect(guide).toHaveCount(0);
});
