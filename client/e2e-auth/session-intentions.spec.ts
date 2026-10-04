import { randomUUID } from "node:crypto";
import { test, expect, AUTH_STORAGE_KEY } from "./duoFixture";
import { onboard } from "./onboard";

test("each person shares an intention, resolves their own recap, and carries into the next round", async ({ duo }) => {
  test.setTimeout(120_000);
  const { a, b, roomCodes } = duo;
  const suffix = randomUUID().slice(0, 8);
  const errors: string[] = [];
  for (const actor of [a, b]) actor.page.on("pageerror", () => errors.push("browser error"));
  await a.page.goto("/");
  await onboard(a.page, "Intention Alpha", `inta_${suffix}`);
  await a.page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(a.page.getByRole("button", { name: "Start solo", exact: true })).toBeVisible();
  await a.page.getByRole("button", { name: "Copy invite link" }).click();
  await expect(a.page.getByText("Invite link copied!")).toBeVisible();
  const invite = await a.page.evaluate(() => navigator.clipboard.readText());
  const room = await a.page.evaluate(() => localStorage.getItem("duodoro:session"));
  if (!room) throw new Error("No intention test room.");
  roomCodes.add(room);
  await b.page.goto("/");
  await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
  await b.page.reload();
  await onboard(b.page, "Intention Beta", `intb_${suffix}`);
  await expect(b.page.getByRole("button", { name: "Focus", exact: true })).toBeVisible();
  await b.page.goto(invite);
  for (const actor of [a, b]) await expect(actor.page.getByRole("button", { name: "Start session", exact: true })).toBeVisible();

  const prompt = (page: typeof a.page) => page.getByRole("region", { name: "Session intentions", exact: true });
  async function save(page: typeof a.page, text: string) {
    await prompt(page).getByRole("button", { name: "Add intention", exact: true }).click();
    await prompt(page).getByRole("textbox", { name: "Your session intention" }).fill(text);
    await expect(page.getByRole("button", { name: "Start session", exact: true })).toBeDisabled();
    await prompt(page).getByRole("textbox").press("Enter");
    await expect(prompt(page).getByText(`You: ${text}`, { exact: true })).toBeVisible();
  }
  await save(a.page, "Write the opening paragraph");
  await save(b.page, "Review the first chapter");
  await expect(prompt(b.page).getByText("Intention Alpha: Write the opening paragraph", { exact: true })).toBeVisible();
  await expect(prompt(a.page).getByText("Intention Beta: Review the first chapter", { exact: true })).toBeVisible();
  await a.page.reload();
  await expect(prompt(a.page).getByText("You: Write the opening paragraph", { exact: true })).toBeVisible();
  await a.page.getByRole("button", { name: "Flowmodoro", exact: true }).click();
  await a.page.getByRole("button", { name: "Start session", exact: true }).click();
  for (const actor of [a, b]) {
    await expect(actor.page.getByLabel("Your focus intention:", { exact: false })).toBeVisible();
    await expect(actor.page.getByRole("button", { name: "Add intention" })).toHaveCount(0);
  }
  await a.page.setViewportSize({ width: 375, height: 667 });
  await expect(a.page.getByLabel("Your focus intention:", { exact: false })).toBeVisible();
  async function checkCaptions() {
    const own = await a.page.getByLabel("Your focus intention:", { exact: false }).boundingBox();
    const partner = await a.page.getByLabel("Intention Beta focus intention:", { exact: false }).boundingBox();
    expect(own!.x).toBeGreaterThanOrEqual(7);
    expect(partner!.x + partner!.width).toBeLessThanOrEqual(a.page.viewportSize()!.width - 7);
    expect(own!.x + own!.width).toBeLessThan(partner!.x);
  }
  await checkCaptions();
  await a.page.screenshot({ path: test.info().outputPath("intentions-focus-phone.png") });
  await expect.poll(async () => a.page.title()).toContain(" · Flow · ");
  await expect.poll(async () => a.page.title()).not.toContain("0:00");
  await a.page.getByRole("button", { name: "Take break", exact: true }).click();
  const recap = (page: typeof a.page) => page.getByRole("region", { name: "Round intentions", exact: true });
  for (const actor of [a, b]) {
    await expect(actor.page.getByText("Round saved", { exact: true })).toBeVisible();
    await expect(recap(actor.page).getByText("Not marked done", { exact: true })).toHaveCount(2);
    await expect(recap(actor.page).getByRole("button", { name: "Mark intention done", exact: true })).toHaveCount(1);
  }
  await recap(a.page).getByRole("button", { name: "Mark intention done", exact: true }).click();
  await expect(recap(b.page).getByText("Done", { exact: true })).toHaveCount(1);
  await recap(a.page).getByRole("button", { name: "Carry into next round", exact: true }).click();
  await expect(prompt(a.page).getByText("You: Write the opening paragraph", { exact: true })).toBeVisible();
  await a.page.reload();
  await expect(recap(a.page).getByRole("button", { name: "Undo intention completion" })).toBeVisible();
  await expect(recap(a.page).getByRole("button", { name: "Carried into next round" })).toBeDisabled();
  await recap(a.page).scrollIntoViewIfNeeded();
  await expect.poll(async () => a.page.title()).toContain(" · Break · ");
  await checkCaptions();
  await a.page.screenshot({ path: test.info().outputPath("intentions-recap-phone.png") });
  await a.page.setViewportSize({ width: 667, height: 375 });
  await checkCaptions();
  await a.page.screenshot({ path: test.info().outputPath("intentions-recap-landscape.png") });
  await a.page.setViewportSize({ width: 375, height: 667 });

  // Stopping a completed break keeps the explicitly carried draft. Starting
  // the next round consumes it once and resets its completion state.
  await a.page.getByRole("button", { name: "Stop timer", exact: true }).click();
  await a.page.getByRole("button", { name: "Start session", exact: true }).click();
  await expect(b.page.getByLabel("Intention Alpha focus intention:", { exact: false })).toBeVisible();
  await expect(b.page.getByLabel("Your focus intention:", { exact: false })).toHaveCount(0);
  await expect.poll(async () => a.page.title()).toContain(" · Flow · ");
  await expect.poll(async () => a.page.title()).not.toContain("0:00");
  await a.page.getByRole("button", { name: "Take break", exact: true }).click();
  for (const actor of [a, b]) {
    await expect(recap(actor.page).getByText("Not marked done", { exact: true })).toHaveCount(1);
    await expect(recap(actor.page).getByText("Review the first chapter")).toHaveCount(0);
  }
  await a.page.getByRole("button", { name: "Leave room" }).click();
  await b.page.getByRole("button", { name: "Leave room" }).click();
  expect(errors).toEqual([]);
});
