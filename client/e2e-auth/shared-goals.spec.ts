import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, AUTH_STORAGE_KEY, requireSuccess } from "./duoFixture";
import { onboard } from "./onboard";

async function openGoals(page: Page) {
  await page.getByRole("button", { name: "Toggle notes panel" }).click();
  const notes = page.getByRole("dialog", { name: "SESSION NOTES" });
  await expect(notes).toBeVisible();
  await notes.getByRole("tab", { name: "Our Goals", exact: true }).click();
  return notes;
}

test("partners share goal completion and credit while edits and deletes stay owner-only", async ({ duo }) => {
  test.setTimeout(120_000);
  const { a, b, admin, roomCodes } = duo;
  const suffix = randomUUID().slice(0, 8);
  const alpha = "Goal Alpha";
  const beta = "Goal Beta";
  const original = "Plan our next focus session";
  const edited = "Plan our next focus session together";
  const pageErrors: string[] = [];
  for (const actor of [a, b]) actor.page.on("pageerror", () => pageErrors.push("browser error"));

  await test.step("two authenticated users join through the shipping UI", async () => {
    await a.page.goto("/");
    await onboard(a.page, alpha, `goala_${suffix}`);
    await a.page.getByRole("button", { name: "Focus", exact: true }).click();
    await expect(a.page.getByRole("button", { name: "Start solo", exact: true })).toBeVisible();
    const room = await a.page.evaluate(() => localStorage.getItem("duodoro:session"));
    if (!room) throw new Error("The server did not create a test room.");
    roomCodes.add(room);
    await a.page.getByRole("button", { name: "Copy invite link" }).click();
    await expect(a.page.getByText("Invite link copied!")).toBeVisible();
    const invite = await a.page.evaluate(() => navigator.clipboard.readText());
    await b.page.goto("/");
    await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
    await b.page.reload();
    await onboard(b.page, beta, `goalb_${suffix}`);
    await expect(b.page.getByRole("button", { name: "Focus", exact: true })).toBeVisible();
    await b.page.goto(invite);
    for (const actor of [a, b]) await expect(actor.page.getByRole("button", { name: "Start session", exact: true })).toBeVisible();
    await expect.poll(async () => {
      const profiles = await admin.from("profiles").select("current_session_id").in("id", [a.id, b.id]);
      requireSuccess(profiles.error, "Read live test membership");
      return profiles.data?.length === 2 && profiles.data.every((profile) => profile.current_session_id === room);
    }).toBe(true);
  });

  let notesA = await openGoals(a.page);
  let notesB = await openGoals(b.page);
  await expect(notesB.getByText("No shared goals yet!", { exact: true })).toBeVisible();
  await notesA.getByRole("textbox", { name: "New task" }).fill(original);
  await notesA.getByRole("button", { name: "Add task", exact: true }).click();
  for (const notes of [notesA, notesB]) await expect(notes.getByText(original, { exact: true })).toHaveCount(1);
  await expect(notesB.getByText(`added by ${alpha}`, { exact: true })).toBeVisible();
  await expect(notesB.getByRole("button", { name: "Delete note" })).toHaveCount(0);
  const created = await a.client.from("tasks").select("id, owner_id, is_shared, is_done, completed_by").eq("owner_id", a.id).eq("content", original).single();
  requireSuccess(created.error, "Read created goal through owner RLS");
  expect(created.data).toMatchObject({ owner_id: a.id, is_shared: true, is_done: false, completed_by: null });
  const goalId = created.data!.id;

  async function storedGoal() {
    const result = await b.client.from("tasks").select("content, is_done, completed_by").eq("id", goalId).single();
    requireSuccess(result.error, "Read shared goal through partner RLS");
    return result.data;
  }

  await test.step("partner edits/deletes and forged credit are refused by the database", async () => {
    // These use B's real JWT, never the fixture's service-role client. RLS
    // refusals can be successful zero-row responses, so verify returned rows.
    const edit = await b.client.from("tasks").update({ content: "Unauthorized rewrite" }).eq("id", goalId).select("id");
    requireSuccess(edit.error, "Attempt partner content edit");
    expect(edit.data).toEqual([]);
    const deletion = await b.client.from("tasks").delete().eq("id", goalId).select("id");
    requireSuccess(deletion.error, "Attempt partner deletion");
    expect(deletion.data).toEqual([]);
    const forged = await a.client.from("tasks").update({ completed_by: b.id }).eq("id", goalId).select("id");
    expect(forged.error?.code).toBe("42501");
    expect(await storedGoal()).toEqual({ content: original, is_done: false, completed_by: null });
    // Content editing has no UI yet; exercise the owner's existing grant.
    const ownerEdit = await a.client.from("tasks").update({ content: edited }).eq("id", goalId).select("id");
    requireSuccess(ownerEdit.error, "Edit own shared goal");
    expect(ownerEdit.data).toEqual([{ id: goalId }]);
    for (const notes of [notesA, notesB]) await expect(notes.getByText(edited, { exact: true })).toHaveCount(1);
  });

  await test.step("B completes A's goal and both browsers receive persisted attribution", async () => {
    await notesB.getByRole("button", { name: "Mark as done", exact: true }).click();
    await expect(notesA.getByText(`✓ by ${beta}`, { exact: true })).toBeVisible();
    await expect(notesB.getByText("✓ by you", { exact: true })).toBeVisible();
    await expect.poll(storedGoal).toEqual({ content: edited, is_done: true, completed_by: b.id });
    for (const actor of [a, b]) {
      await actor.page.reload();
      await expect(actor.page.getByRole("button", { name: "Start session", exact: true })).toBeVisible();
    }
    notesA = await openGoals(a.page);
    notesB = await openGoals(b.page);
    await expect(notesA.getByText(`✓ by ${beta}`, { exact: true })).toBeVisible();
    await expect(notesB.getByText("✓ by you", { exact: true })).toBeVisible();
    for (const notes of [notesA, notesB]) {
      await expect(notes.getByText(edited, { exact: true })).toHaveCount(1);
      await expect(notes.getByRole("progressbar", { name: "Task completion" })).toHaveAttribute("aria-valuenow", "1");
    }
  });

  await test.step("either partner can undo completion and credit clears in both browsers", async () => {
    await notesA.getByRole("button", { name: "Mark as not done", exact: true }).click();
    for (const notes of [notesA, notesB]) {
      await expect(notes.getByRole("button", { name: "Mark as done", exact: true })).toBeVisible();
      await expect(notes.getByText(/^✓ by /)).toHaveCount(0);
    }
    await expect.poll(storedGoal).toEqual({ content: edited, is_done: false, completed_by: null });
  });

  await test.step("owner deletion removes the goal from both live boards and the database", async () => {
    await expect(notesB.getByRole("button", { name: "Delete note" })).toHaveCount(0);
    await notesA.getByText(edited, { exact: true }).hover();
    await notesA.getByRole("button", { name: "Delete note", exact: true }).click();
    for (const notes of [notesA, notesB]) await expect(notes.getByText("No shared goals yet!", { exact: true })).toBeVisible();
    const remaining = await a.client.from("tasks").select("id").eq("id", goalId);
    requireSuccess(remaining.error, "Read deleted goal");
    expect(remaining.data).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
