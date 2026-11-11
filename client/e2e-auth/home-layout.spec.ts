import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./duoFixture";
import { onboard } from "./onboard";

test("Home keeps Focus on the first phone screen and groups the supporting cards", async ({ duo }) => {
  const { a, roomCodes } = duo;
  await a.page.setViewportSize({ width: 375, height: 667 });
  await a.page.goto("/");
  await onboard(a.page, "Home Layout", `hl_${randomUUID().slice(0, 8)}`);
  const focus = a.page.getByRole("region", { name: "Start focusing", exact: true }).getByRole("button", { name: "Focus", exact: true });
  await expect(focus).toBeInViewport({ ratio: 1 });
  for (const label of ["Today", "Together", "Progress"]) await expect(a.page.getByRole("region", { name: label, exact: true })).toHaveCount(1);
  expect((await new AxeBuilder({ page: a.page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await a.page.screenshot({ path: test.info().outputPath("home-portrait.png") });

  await a.page.setViewportSize({ width: 667, height: 375 });
  await expect(focus).toBeInViewport({ ratio: 1 });
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await a.page.screenshot({ path: test.info().outputPath("home-landscape.png") });
  await a.page.setViewportSize({ width: 1280, height: 800 });
  await a.page.screenshot({ path: test.info().outputPath("home-desktop.png"), fullPage: true });

  const progress = a.page.getByRole("region", { name: "Progress", exact: true });
  await progress.scrollIntoViewIfNeeded();
  await expect(progress).toBeInViewport();
  await expect(a.page.getByRole("button", { name: "Open friends", exact: true })).toBeInViewport({ ratio: 1 });
  await a.page.screenshot({ path: test.info().outputPath("home-progress.png") });
  await focus.click();
  await expect(a.page.getByRole("button", { name: "Start solo", exact: true })).toBeVisible();
  const room = await a.page.evaluate(() => localStorage.getItem("duodoro:session"));
  if (!room) throw new Error("Focus did not create a room."); roomCodes.add(room);
  await a.page.getByRole("button", { name: /Leave room/ }).click();
  await expect(focus).toBeInViewport({ ratio: 1 });
});
