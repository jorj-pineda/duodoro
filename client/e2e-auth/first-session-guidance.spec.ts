import { randomUUID } from "node:crypto";
import { test, expect } from "./duoFixture";
import { onboard } from "./onboard";

test("first-session guidance is dismissible, survives reload, and never blocks opening a waiting room", async ({ duo }) => {
  const { a, roomCodes } = duo;
  await a.page.setViewportSize({ width: 390, height: 844 });
  await a.page.goto("/"); await onboard(a.page, "Guidance Alpha", `guide_${randomUUID().slice(0, 8)}`);
  const tip = a.page.getByRole("complementary", { name: "First-session guidance" });
  await expect(tip).toBeVisible(); await expect(tip).toContainText("The host chooses Start session");
  await expect(a.page.getByRole("button", { name: "Focus", exact: true })).toBeEnabled();
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await tip.getByRole("button", { name: "Dismiss getting-started tip" }).click();
  await expect(tip).toHaveCount(0); await a.page.reload();
  await expect(a.page.getByRole("button", { name: "Focus", exact: true })).toBeVisible(); await expect(tip).toHaveCount(0);
  // Restore the tip locally to exercise opening the room without dismissing it.
  await a.page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith("duodoro:first-session-guidance:"));
    if (key) { localStorage.removeItem(key); window.dispatchEvent(new StorageEvent("storage", { key })); }
  });
  await expect(tip).toBeVisible();
  await a.page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(a.page.getByRole("button", { name: "Start solo", exact: true })).toBeVisible();
  const room = await a.page.evaluate(() => localStorage.getItem("duodoro:session"));
  if (!room) throw new Error("Guidance test room was not created.");
  roomCodes.add(room);
  await expect(a.page.getByRole("button", { name: "Stop timer", exact: true })).toHaveCount(0);
});
