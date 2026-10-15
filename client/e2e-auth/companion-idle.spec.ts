import { randomUUID } from "node:crypto";
import { test, expect, requireSuccess } from "./duoFixture";
import { onboard } from "./onboard";

test("idle companion poses keep their grid and stop for focus and reduced motion", async ({ duo }) => {
  test.setTimeout(120_000);
  const { a, admin, roomCodes } = duo;
  const page = a.page;
  const suffix = randomUUID().slice(0, 8);
  for (let left = 54000; left > 0; left -= 7200) {
    const seconds = Math.min(left, 7200);
    const result = await admin.rpc("record_focus_session", {
      p_recording_key: randomUUID(), p_room_code: `idle_${suffix}`, p_world: "forest",
      p_focus_duration: seconds, p_break_duration: 60, p_actual_focus: seconds, p_completed: true,
      p_started_at: new Date(Date.now() - seconds * 1000).toISOString(), p_user_ids: [a.id],
    });
    requireSuccess(result.error, "Record idle-art fixture history");
  }
  await page.goto("/");
  await onboard(page, "Idle Hero", `idle_${suffix}`);
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start solo", exact: true })).toBeVisible();
  const room = await page.evaluate(() => localStorage.getItem("duodoro:session"));
  if (!room) throw new Error("The idle-art test room was not created.");
  roomCodes.add(room);
  await page.getByRole("button", { name: "Cat (unlock companions)" }).click();
  const companions = page.getByRole("dialog", { name: "Companions", exact: true });
  await companions.getByRole("button", { name: "Unlock companions", exact: true }).click();
  await companions.getByRole("button", { name: "Done", exact: true }).click();
  await page.setViewportSize({ width: 375, height: 667 });
  // Make the idle delay predictable without advancing Socket.IO's heartbeat clock.
  await page.evaluate(() => { Math.random = () => 0; });
  const sprite = page.locator('.z-20 svg[viewBox="0 0 15 12"]');
  for (const pet of ["Cat", "Dog", "Dragon", "Rabbit"]) {
    await page.getByRole("button", { name: pet, exact: true }).click();
    await expect(sprite).toBeVisible();
    const rest = await sprite.innerHTML();
    const feet = () => sprite.locator('rect[y="11"]').evaluateAll((rects) => rects.map((r) => r.outerHTML));
    const planted = await feet();
    await page.screenshot({ path: test.info().outputPath(`${pet}-rest-phone.png`) });
    await expect.poll(() => sprite.innerHTML(), { intervals: [50] }).not.toBe(rest);
    expect(await feet()).toEqual(planted);
    await page.screenshot({ path: test.info().outputPath(`${pet}-blink-phone.png`) });
    await expect.poll(() => sprite.innerHTML(), { intervals: [50] }).toBe(rest);
    await expect.poll(() => sprite.innerHTML(), { intervals: [50] }).not.toBe(rest);
    expect(await feet()).toEqual(planted);
    await expect(sprite).toHaveAttribute("width", "30");
    await expect(sprite).toHaveAttribute("height", "24");
    await page.screenshot({ path: test.info().outputPath(`${pet}-fidget-phone.png`) });
    await expect.poll(() => sprite.innerHTML(), { intervals: [50] }).toBe(rest);
  }
  const rest = await sprite.innerHTML();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(14000);
  expect(await sprite.innerHTML()).toBe(rest);
  await page.setViewportSize({ width: 667, height: 375 });
  await page.screenshot({ path: test.info().outputPath("rabbit-landscape-reduced.png") });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Start solo", exact: true }).click();
  await expect.poll(() => page.title()).toContain(" · Focus · ");
  // Walking may change the feet, but focus must never blink or fidget.
  const earTips = await sprite.locator('rect[y="0"]').evaluateAll((r) => r.map((x) => x.outerHTML));
  for (const ms of [7000, 180, 1200, 320]) {
    await page.waitForTimeout(ms);
    expect(await sprite.locator('rect[y="0"]').evaluateAll((r) => r.map((x) => x.outerHTML)))
      .toEqual(earTips);
    await expect(sprite.locator('rect[y="5"][x="4"]')).toHaveCount(1);
  }
  await page.getByRole("button", { name: "Stop timer", exact: true }).click();
  // Stopping queues an asynchronous interrupted-round save. Wait for that real
  // write before leaving and fixture cleanup enumerates/deletes sessions, or
  // the insert can land after enumeration and leave an orphan session.
  await expect.poll(async () => {
    const saved = await admin.from("sessions").select("id,completed").eq("room_code", room);
    requireSuccess(saved.error, "Wait for interrupted idle-test recording");
    return saved.data?.map(row => row.completed);
  }).toEqual([false]);
  await page.getByRole("button", { name: /Leave room/ }).click();
  await expect(page.getByRole("button", { name: "Focus", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Leave room/ })).toHaveCount(0);
});
