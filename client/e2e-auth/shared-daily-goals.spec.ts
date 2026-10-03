import { randomUUID } from "node:crypto";
import { test, expect, AUTH_STORAGE_KEY, requireSuccess } from "./duoFixture";
import { onboard } from "./onboard";

test("friends accept a recurring daily goal, contribute solo and together, and end sharing", async ({ duo }) => {
  test.setTimeout(120_000);
  const { a, b, admin } = duo;
  const suffix = randomUUID().slice(0, 8);
  const pageErrors: string[] = [];
  for (const actor of [a, b]) actor.page.on("pageerror", () => pageErrors.push("browser error"));
  await a.page.goto("/");
  await onboard(a.page, "Daily Alpha", `daya_${suffix}`);
  await b.page.goto("/");
  await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
  await b.page.reload();
  await onboard(b.page, "Daily Beta", `dayb_${suffix}`);
  for (const actor of [a, b]) await expect(actor.page.getByRole("button", { name: "Focus", exact: true })).toBeVisible();
  // Create the fixture friendship through the two users' real RLS permissions.
  const friendship = await a.client.from("friendships").insert({ requester_id: a.id, addressee_id: b.id }).select("id").single();
  requireSuccess(friendship.error, "Request fixture friendship");
  const accepted = await b.client.from("friendships").update({ status: "accepted" }).eq("id", friendship.data!.id).select("id").single();
  requireSuccess(accepted.error, "Accept fixture friendship");
  await a.page.reload();
  await b.page.reload();
  const panelA = a.page.getByRole("region", { name: "Shared daily goals", exact: true });
  const panelB = b.page.getByRole("region", { name: "Shared daily goals", exact: true });
  await panelA.getByLabel("Shared daily target").selectOption("25");
  await panelA.getByRole("button", { name: "Invite to daily goal" }).click();
  await expect(panelA.getByText(/Waiting for your friend/)).toBeVisible();
  await expect(panelB.getByRole("button", { name: "Accept goal" })).toBeVisible();
  await expect(panelB.getByRole("progressbar")).toHaveCount(0);
  await panelB.getByRole("button", { name: "Accept goal" }).click();
  for (const panel of [panelA, panelB]) await expect(panel.getByText("0m / 25m today", { exact: true })).toBeVisible();

  // Recorded history is fixture data. This tests the aggregate's live database
  // boundary; the existing duo journey separately runs a real timed round.
  for (const [seconds, participants, completed] of [[300, [a.id], true], [600, [b.id], true], [300, [a.id, b.id], true], [900, [a.id], false]] as const) {
    const recorded = await admin.rpc("record_focus_session", {
      p_recording_key: randomUUID(), p_room_code: `daily_${suffix}`, p_world: "forest",
      p_focus_duration: seconds, p_break_duration: 60, p_actual_focus: seconds,
      p_completed: completed, p_started_at: new Date(Date.now() - seconds * 1000).toISOString(),
      p_user_ids: [...participants],
    });
    requireSuccess(recorded.error, "Record shared-goal fixture history");
  }
  for (const actor of [a, b]) await actor.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(panelA.getByText("25m / 25m today · Goal reached!", { exact: true })).toBeVisible();
  await expect(panelA.getByText("You: 10m · Daily Beta: 15m", { exact: true })).toBeVisible();
  await expect(panelB.getByText("You: 15m · Daily Alpha: 10m", { exact: true })).toBeVisible();

  await test.step("failed target changes retain the draft; retry persists for both people", async () => {
    await b.page.route("**/rest/v1/rpc/update_shared_daily_goal", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Unavailable"}' }));
    await panelB.getByRole("button", { name: "Edit target" }).click();
    await panelB.getByLabel("Edit shared target").selectOption("30");
    await panelB.getByRole("button", { name: "Save target" }).click();
    await expect(panelB.getByRole("alert")).toBeVisible();
    await expect(panelB.getByLabel("Edit shared target")).toHaveValue("30");
    await b.page.unroute("**/rest/v1/rpc/update_shared_daily_goal");
    await panelB.getByRole("button", { name: "Save target" }).click();
    for (const panel of [panelA, panelB]) await expect(panel.getByText("25m / 30m today", { exact: true })).toBeVisible();
    await a.page.reload();
    await expect(panelA.getByText("25m / 30m today", { exact: true })).toBeVisible();
  });

  await a.page.setViewportSize({ width: 375, height: 667 });
  await panelA.scrollIntoViewIfNeeded();
  await expect(panelA.getByRole("button", { name: "End shared goal" })).toBeVisible();
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panelA.screenshot({ path: test.info().outputPath("shared-daily-goal-phone.png") });
  await panelB.getByRole("button", { name: "End shared goal" }).click();
  // Delete notifications can be missed: tab return must reconcile immediately.
  await a.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  for (const panel of [panelA, panelB]) await expect(panel.getByRole("progressbar")).toHaveCount(0);
  for (const actor of [a, b]) {
    const result = await actor.client.rpc("get_shared_daily_goals");
    requireSuccess(result.error, "Read ended goals");
    expect(result.data).toEqual([]);
  }
  expect(pageErrors).toEqual([]);
});
