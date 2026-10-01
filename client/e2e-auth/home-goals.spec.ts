import { randomUUID } from "node:crypto";
import { test, expect, requireSuccess } from "./duoFixture";
import { onboard } from "./onboard";

test("Home edits survive a failed save, refresh and a session round trip", async ({ duo }) => {
  test.setTimeout(120_000);
  const { a, roomCodes } = duo;
  const page = a.page;
  const original = "Prepare our next focus plan";
  const edited = "Prepare our next focus plan together";
  const completed = "Keep our completed focus plan";
  const pageErrors: string[] = [];
  page.on("pageerror", () => pageErrors.push("browser error"));
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await onboard(page, "Home Goals", `home_${randomUUID().slice(0, 8)}`);
  await page.getByRole("textbox", { name: "New goal", exact: true }).fill(original);
  await page.getByRole("button", { name: "Add goal", exact: true }).click();
  await expect(page.getByText(original, { exact: true })).toBeVisible();
  const created = await a.client.from("tasks").select("id").eq("owner_id", a.id).eq("content", original).single();
  requireSuccess(created.error, "Read created Home goal");
  const goalId = created.data!.id;
  async function storedGoal() {
    const result = await a.client.from("tasks").select("content, is_done, completed_by, room_code").eq("id", goalId).single();
    requireSuccess(result.error, "Read personal goal through owner RLS");
    return result.data;
  }

  await test.step("Escape discards a Home draft and restores focus", async () => {
    await page.getByRole("button", { name: "Edit goal", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Edit goal text" });
    await expect(editor).toBeFocused();
    await editor.fill("Discard this draft");
    await editor.press("Escape");
    await expect(editor).toBeHidden();
    await expect(page.getByRole("button", { name: "Edit goal", exact: true })).toBeFocused();
    expect((await storedGoal())?.content).toBe(original);
  });

  await test.step("a failed content write keeps the draft for retry", async () => {
    const endpoint = "**/rest/v1/tasks?**";
    await page.route(endpoint, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Unavailable" }) });
    });
    await page.getByRole("button", { name: "Edit goal", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Edit goal text" });
    await editor.fill(`  ${edited}  `);
    await editor.press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "Couldn't save your changes" })).toBeVisible();
    await expect(editor).toHaveValue(`  ${edited}  `);
    expect((await storedGoal())?.content).toBe(original);
    await page.unroute(endpoint);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(page.getByText(edited, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(edited, { exact: true })).toBeVisible();
  });

  await test.step("editing a completed goal preserves its state", async () => {
    await page.getByRole("button", { name: `Mark ${edited} complete`, exact: true }).click();
    await expect(page.getByRole("button", { name: `Mark ${edited} incomplete`, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit goal", exact: true }).click();
    await page.getByRole("textbox", { name: "Edit goal text" }).fill(completed);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: `Mark ${completed} incomplete`, exact: true })).toBeVisible();
    expect(await storedGoal()).toEqual({ content: completed, is_done: true, completed_by: null, room_code: null });
  });

  await test.step("session My Tasks and Home retain the same goal", async () => {
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start solo", exact: true })).toBeVisible();
    const room = await page.evaluate(() => localStorage.getItem("duodoro:session"));
    if (!room) throw new Error("The server did not create a test room.");
    roomCodes.add(room);
    await page.getByRole("button", { name: "Toggle notes panel" }).click();
    const notes = page.getByRole("dialog", { name: "SESSION NOTES" });
    await expect(notes.getByRole("tab", { name: "My Tasks", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(notes.getByText(completed, { exact: true })).toBeVisible();
    await expect(notes.getByRole("button", { name: "Mark as not done" })).toBeVisible();
    await notes.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: /Leave room/ }).click();
    await expect(page.getByRole("button", { name: `Mark ${completed} incomplete`, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(completed, { exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
