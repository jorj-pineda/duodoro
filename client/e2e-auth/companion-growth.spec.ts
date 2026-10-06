import { randomUUID } from "node:crypto";
import { test, expect, requireSuccess } from "./duoFixture";
import { onboard } from "./onboard";

test("companions grow visibly from saved focus and restore private progress after reload", async ({ duo }) => {
  test.setTimeout(120_000);
  const { a, admin, roomCodes } = duo;
  const page = a.page;
  const suffix = randomUUID().slice(0, 8);
  const pageErrors: string[] = [];
  page.on("pageerror", () => pageErrors.push("browser error"));
  async function seed(seconds: number) {
    while (seconds > 0) {
      const chunk = Math.min(7200, seconds);
      const result = await admin.rpc("record_focus_session", {
        p_recording_key: randomUUID(), p_room_code: `growth_${suffix}`, p_world: "forest",
        p_focus_duration: Math.max(60, chunk), p_break_duration: 60, p_actual_focus: chunk, p_completed: true,
        p_started_at: new Date(Date.now() - chunk * 1000).toISOString(), p_user_ids: [a.id],
      });
      requireSuccess(result.error, "Record growth fixture history");
      seconds -= chunk;
    }
  }
  await seed(10799);
  await page.goto("/");
  await onboard(page, "Growth Hero", `growth_${suffix}`);
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start solo", exact: true })).toBeVisible();
  const room = await page.evaluate(() => localStorage.getItem("duodoro:session"));
  if (!room) throw new Error("The test room was not created.");
  roomCodes.add(room);
  await page.getByRole("button", { name: "Cat (unlock companions)" }).click();
  const companions = page.getByRole("dialog", { name: "Companions", exact: true });
  await companions.getByRole("button", { name: "Unlock companions", exact: true }).click();
  await companions.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Cat", exact: true }).click();
  const growth = page.getByRole("region", { name: "Companion growth", exact: true });
  const sprite = (w: number, h: number) => page.locator(`.z-20 svg[viewBox="0 0 ${w} ${h}"]`);
  await expect(growth.getByText("Level 1 · Young", { exact: true })).toBeVisible();
  await expect(sprite(7, 5)).toHaveAttribute("height", "15");
  await page.screenshot({ path: test.info().outputPath("companion-young-desktop.png") });

  await page.getByRole("button", { name: "Flowmodoro", exact: true }).click();
  await page.getByRole("button", { name: "Start solo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Take break", exact: true })).toBeVisible();
  // Wait for elapsed focus to cross at least one real second, rather than
  // changing client state or skipping the timer's server boundary.
  await expect.poll(async () => page.title()).toContain(" · Flow · ");
  await expect.poll(async () => page.title()).not.toContain("0:00");
  await page.getByRole("button", { name: "Take break", exact: true }).click();
  await expect(page.getByRole("region", { name: "Round recap", exact: true })).toBeVisible();
  await expect(growth.getByRole("status")).toContainText("Mochi grew to Level 2!");
  await expect(growth.getByText("Level 2 · Grown", { exact: true })).toBeVisible();
  await expect(sprite(11, 8)).toHaveAttribute("height", "24");
  await expect.poll(async () => page.title()).toContain(" · Break · ");
  await page.screenshot({ path: test.info().outputPath("companion-grown-desktop.png") });
  await page.reload();
  await expect(growth.getByText("Level 2 · Grown", { exact: true })).toBeVisible();
  await expect(growth.getByRole("status")).toHaveCount(0);

  // Stop keeps the room. Seed the remaining saved history, then request the
  // normal tab-return sync: it refreshes growth without replaying a milestone.
  await page.getByRole("button", { name: "Stop timer", exact: true }).click();
  const total = await admin.rpc("total_focus_seconds", { target: a.id });
  requireSuccess(total.error, "Read fixture's saved total");
  await seed(54000 - Number(total.data));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(growth.getByText("Level 3 · Fully grown", { exact: true })).toBeVisible();
  await expect(growth.getByRole("progressbar")).toHaveCount(0);
  await expect(growth.getByRole("status")).toHaveCount(0);
  await expect(sprite(15, 12)).toHaveAttribute("height", "36");
  await page.screenshot({ path: test.info().outputPath("companion-full-desktop.png") });
  await page.setViewportSize({ width: 375, height: 667 });
  for (const pet of ["Cat", "Dog", "Dragon", "Rabbit"]) {
    await page.getByRole("button", { name: pet, exact: true }).click();
    await expect(sprite(15, 12)).toHaveAttribute("height", "24");
    const controls = await page.locator(".session-hud-scroll").boundingBox();
    const companion = await sprite(15, 12).boundingBox();
    expect(controls).not.toBeNull();
    expect(companion).not.toBeNull();
    expect(controls!.y + controls!.height).toBeLessThan(companion!.y);
    await page.screenshot({ path: test.info().outputPath(`companion-${pet.toLowerCase()}-phone.png`) });
  }
  await page.setViewportSize({ width: 667, height: 375 });
  await expect(sprite(15, 12)).toHaveAttribute("height", "24");
  const landscapeControls = await page.locator(".session-hud-scroll").boundingBox();
  const landscapeCompanion = await sprite(15, 12).boundingBox();
  expect(landscapeControls!.y + landscapeControls!.height).toBeLessThan(landscapeCompanion!.y);
  await page.screenshot({ path: test.info().outputPath("companion-rabbit-landscape.png") });
  await page.getByRole("button", { name: "Leave room" }).click();
  expect(pageErrors).toEqual([]);
});
