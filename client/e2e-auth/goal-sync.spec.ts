import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, requireSuccess } from "./duoFixture";
import { onboard } from "./onboard";

function goalRow(page: Page, content: string, done = false) {
  return page.getByRole("button", { name: `Mark ${content} ${done ? "incomplete" : "complete"}`, exact: true }).locator("..");
}

test("two Home tabs synchronize goals while preserving unsaved drafts", async ({ duo }) => {
  test.setTimeout(120_000);
  const { a, b } = duo;
  const first = a.page;
  const second = await first.context().newPage();
  const original = "Plan the next focus round";
  const remote = "Plan a focused afternoon";
  const extra = "Prepare our supplies";
  const draft = "My unsaved plan";
  const pageErrors: string[] = [];
  for (const page of [first, second]) page.on("pageerror", () => pageErrors.push("browser error"));
  await first.goto("/");
  await onboard(first, "Goal Sync", `sync_${randomUUID().slice(0, 8)}`);
  await first.getByRole("textbox", { name: "New goal", exact: true }).fill(original);
  await first.getByRole("button", { name: "Add goal", exact: true }).click();
  await expect(first.getByText(original, { exact: true })).toBeVisible();
  await second.goto("/");
  await expect(second.getByText(original, { exact: true })).toBeVisible();
  const created = await a.client.from("tasks").select("id").eq("owner_id", a.id).eq("content", original).single();
  requireSuccess(created.error, "Read synchronization goal");
  const id = created.data!.id;
  const privateRead = await b.client.from("tasks").select("id").eq("id", id);
  requireSuccess(privateRead.error, "Read private goal as another account");
  expect(privateRead.data).toEqual([]);

  await test.step("a new goal appears in both tabs without erasing the new-goal draft", async () => {
    await second.getByRole("textbox", { name: "New goal", exact: true }).fill("An unsaved new goal");
    await first.getByRole("textbox", { name: "New goal", exact: true }).fill(extra);
    await first.getByRole("button", { name: "Add goal", exact: true }).click();
    for (const page of [first, second]) await expect(page.getByText(extra, { exact: true })).toHaveCount(1);
    await expect(second.getByRole("textbox", { name: "New goal", exact: true })).toHaveValue("An unsaved new goal");
  });

  await test.step("remote edits and completion preserve an open editing draft", async () => {
    await goalRow(second, original).getByRole("button", { name: "Edit goal", exact: true }).click();
    const editor = second.getByRole("textbox", { name: "Edit goal text" });
    await editor.fill(draft);
    await goalRow(first, original).getByRole("button", { name: "Edit goal", exact: true }).click();
    await first.getByRole("textbox", { name: "Edit goal text" }).fill(remote);
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await expect(second.getByRole("button", { name: `Mark ${remote} complete`, exact: true })).toBeVisible();
    await expect(editor).toHaveValue(draft);
    await first.getByRole("button", { name: `Mark ${remote} complete`, exact: true }).click();
    await expect(second.getByRole("button", { name: `Mark ${remote} incomplete`, exact: true })).toBeVisible();
    await expect(editor).toHaveValue(draft);
    await editor.press("Escape");
    await expect(second.getByText(remote, { exact: true })).toBeVisible();
  });

  await test.step("a failed refresh preserves loaded goals and catches up on tab return", async () => {
    const endpoint = "**/rest/v1/tasks?**";
    await second.route(endpoint, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Unavailable" }) });
    });
    await second.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(second.getByRole("alert").filter({ hasText: "Couldn't load your tasks" })).toBeVisible();
    await expect(second.getByText(remote, { exact: true })).toBeVisible();
    await first.getByRole("button", { name: `Mark ${remote} incomplete`, exact: true }).click();
    await second.unroute(endpoint);
    // Simulate the visibility event without claiming a physical sleeping tab.
    await second.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(second.getByRole("button", { name: `Mark ${remote} complete`, exact: true })).toBeVisible();
    await expect(second.getByRole("alert").filter({ hasText: "Couldn't load your tasks" })).toBeHidden();
  });

  await test.step("deletion in another tab keeps the draft available to copy or cancel", async () => {
    await goalRow(first, remote).getByRole("button", { name: "Edit goal", exact: true }).click();
    const editor = first.getByRole("textbox", { name: "Edit goal text" });
    await editor.fill(draft);
    await goalRow(second, remote).getByRole("button", { name: "Delete task", exact: true }).click();
    await expect(first.getByRole("alert").filter({ hasText: "deleted elsewhere" })).toBeVisible();
    await expect(editor).toHaveValue(draft);
    await expect(first.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await editor.press("Enter");
    const remaining = await a.client.from("tasks").select("id").eq("id", id);
    requireSuccess(remaining.error, "Read removed synchronization goal");
    expect(remaining.data).toEqual([]);
    await first.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(first.getByText(remote, { exact: true })).toHaveCount(0);
    for (const page of [first, second]) {
      await page.reload();
      await expect(page.getByText(extra, { exact: true })).toHaveCount(1);
      await expect(page.getByText(remote, { exact: true })).toHaveCount(0);
    }
    expect(pageErrors).toEqual([]);
  });
});
