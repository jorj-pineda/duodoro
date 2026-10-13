import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, AUTH_STORAGE_KEY, requireSuccess } from "./duoFixture";
import { onboard } from "./onboard";
import { weekStart } from "../src/lib/weeklyPlan";

test("weekly planning stays private, survives reloads, reconciles conflicts and opens a reviewed intention draft", async ({ duo }) => {
  test.setTimeout(180_000);
  const { a, b, admin, roomCodes } = duo;
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto("/"); await onboard(a.page, "Plan Alpha", `pa_${suffix}`);
  await b.page.goto("/");
  await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
  await b.page.reload(); await onboard(b.page, "Plan Beta", `pb_${suffix}`);
  requireSuccess((await admin.from("friendships").insert({ requester_id: a.id, addressee_id: b.id, status: "accepted" })).error, "Create planning fixture friends");
  const created = await a.client.from("tasks").insert(Array.from({ length: 4 }, (_, i) => ({ owner_id: a.id, content: `Private weekly goal ${i + 1}` }))).select("id,content").order("content");
  requireSuccess(created.error, "Create planning goals");
  const goals = created.data!;
  await a.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const plan = a.page.getByRole("region", { name: "Private weekly focus plan", exact: true });
  await expect(plan.getByRole("combobox")).toBeVisible();
  for (const goal of goals.slice(0, 3)) {
    await plan.getByRole("combobox").selectOption(goal.id);
    await plan.getByRole("button", { name: "Add to this week", exact: true }).click();
    await expect(plan.getByRole("listitem").filter({ hasText: goal.content })).toBeVisible();
  }
  await expect(plan.getByRole("combobox")).toBeDisabled();
  await a.page.reload();
  await expect(plan.getByText("0 of 3 planned goals complete", { exact: true })).toBeVisible();
  const week = await a.page.evaluate(() => {
    const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  }).then(weekStart);
  const own = await a.client.from("weekly_focus_plans").select("*").eq("week_start", week).single();
  requireSuccess(own.error, "Read saved weekly plan");
  const denied = await b.client.from("weekly_focus_plans").select("*").eq("user_id", a.id);
  requireSuccess(denied.error, "Read partner plan boundary"); expect(denied.data).toEqual([]);
  const foreign = await b.client.rpc("set_weekly_focus_plan", { p_week_start: week, p_task_ids: [goals[0].id], p_expected_version: null as unknown as number });
  expect(foreign.error?.code).toBe("P0002");
  const bPlan = b.page.getByRole("region", { name: "Private weekly focus plan", exact: true });
  await expect(bPlan.getByText("0 of 0 planned goals complete", { exact: true })).toBeVisible();
  await expect(b.page.getByText(goals[0].content, { exact: true })).toHaveCount(0);

  // A second device clears the plan; the old UI must conflict, then reload.
  requireSuccess((await a.client.rpc("set_weekly_focus_plan", { p_week_start: week, p_task_ids: [], p_expected_version: own.data!.version })).error, "Change plan from another device");
  await plan.getByRole("button", { name: `Remove ${goals[0].content} from weekly plan`, exact: true }).click();
  await expect(plan.getByRole("alert")).toContainText("changed elsewhere");
  await plan.getByRole("button", { name: "Reload plan", exact: true }).click();
  await expect(plan.getByText("0 of 0 planned goals complete", { exact: true })).toBeVisible();
  await plan.getByRole("combobox").selectOption(goals[0].id);
  const saveEndpoint = "**/rest/v1/rpc/set_weekly_focus_plan";
  await a.page.route(saveEndpoint, async route => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true); // the server commits, but the acknowledgement is lost
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Unavailable"}' });
  });
  await plan.getByRole("button", { name: "Add to this week", exact: true }).click();
  await expect(plan.getByRole("alert")).toContainText("Couldn't confirm");
  await expect(plan.getByRole("listitem")).toHaveCount(0);
  await a.page.unroute(saveEndpoint);
  await plan.getByRole("button", { name: "Reload plan", exact: true }).click();
  await expect(plan.getByRole("listitem")).toHaveCount(1);
  // Completion remains the existing goal operation, independent of focus totals.
  requireSuccess((await a.client.from("tasks").update({ is_done: true }).eq("id", goals[0].id).select("id").single()).error, "Complete planned goal");
  await a.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(plan.getByText("1 of 1 planned goals complete", { exact: true })).toBeVisible();
  await expect(plan.getByRole("button", { name: "Focus on this", exact: true })).toHaveCount(0);
  requireSuccess((await a.client.from("tasks").update({ is_done: false }).eq("id", goals[0].id).select("id").single()).error, "Reopen planned goal");
  await a.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(plan.getByRole("button", { name: "Focus on this", exact: true })).toBeEnabled();
  await a.page.getByRole("button", { name: "Edit goal", exact: true }).first().click();
  await expect(plan.getByRole("button", { name: "Focus on this", exact: true })).toBeDisabled();
  await a.page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(plan.getByRole("button", { name: "Focus on this", exact: true })).toBeEnabled();

  const axe = await new AxeBuilder({ page: a.page }).include('[aria-label="Private weekly focus plan"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations).toEqual([]);
  for (const [name, width, height] of [["phone",375,667],["landscape",667,375]] as const) {
    await a.page.setViewportSize({ width, height }); await plan.scrollIntoViewIfNeeded();
    expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await a.page.screenshot({ path: test.info().outputPath(`weekly-planning-${name}.png`) });
  }
  await plan.getByRole("button", { name: "Focus on this", exact: true }).click();
  await expect(a.page.getByRole("textbox", { name: "Your session intention", exact: true })).toHaveValue(goals[0].content);
  await expect(a.page.getByRole("button", { name: "Start solo", exact: true })).toBeDisabled();
  const room = await a.page.evaluate(() => localStorage.getItem("duodoro:session"));
  if (!room) throw new Error("Planning room missing"); roomCodes.add(room);
  const unchanged = await a.client.from("tasks").select("is_done,is_shared,room_code,content").eq("id", goals[0].id).single();
  requireSuccess(unchanged.error, "Read unchanged source goal");
  expect(unchanged.data).toMatchObject({ is_done: false, is_shared: false, room_code: null, content: goals[0].content });
  await a.page.getByRole("button", { name: /Leave room/ }).click();
});
