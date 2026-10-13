import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, requireSuccess, AUTH_STORAGE_KEY } from "./duoFixture";
import { onboard } from "./onboard";

test("reflection review searches the full month and keeps notes and tags private across views", async ({ duo }) => {
  test.setTimeout(180_000);
  const { a, b, admin, roomCodes } = duo;
  const pageErrors: string[] = [];
  a.page.on("pageerror", () => pageErrors.push("browser error"));
  b.page.on("pageerror", () => pageErrors.push("browser error"));
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto("/"); await onboard(a.page, "Review Alpha", `rva_${suffix}`);
  await b.page.goto("/");
  await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
  await b.page.reload(); await onboard(b.page, "Review Beta", `rvb_${suffix}`);

  async function save(ids: string[], ended = new Date()) {
    const room = randomUUID(); roomCodes.add(room);
    requireSuccess((await admin.rpc("record_focus_session", {
      p_recording_key: randomUUID(), p_room_code: room, p_world: "forest", p_focus_duration: 600,
      p_break_duration: 60, p_actual_focus: 600, p_completed: true,
      p_started_at: new Date(ended.getTime() - 600_000).toISOString(), p_user_ids: ids,
    })).error, "Save review fixture");
    const found = await admin.from("sessions").select("id").eq("room_code", room).single();
    requireSuccess(found.error, "Find review fixture"); return found.data!.id;
  }
  const shared = await save([a.id, b.id]);
  const aNote = await a.client.rpc("create_session_reflection", { p_session_id: shared, p_text: "Alpha shared-round private note" });
  requireSuccess(aNote.error, "Create Alpha shared reflection");
  requireSuccess((await b.client.rpc("create_session_reflection", { p_session_id: shared, p_text: "Beta shared-round private note" })).error, "Create Beta shared reflection");
  const createRevision = null as unknown as number;
  requireSuccess((await a.client.rpc("set_session_focus_tag", { p_session_id: shared, p_tag: "work", p_expected_version: createRevision })).error, "Set Alpha tag");
  requireSuccess((await b.client.rpc("set_session_focus_tag", { p_session_id: shared, p_tag: "study", p_expected_version: createRevision })).error, "Set Beta tag");
  const longNote = `Long note: ${"focus".repeat(90)}`;
  for (let index = 0; index < 24; index++) {
    const id = await save([a.id]);
    requireSuccess((await a.client.rpc("create_session_reflection", {
      p_session_id: id, p_text: index === 23 ? longNote : `Alpha solo note ${index + 1}`,
    })).error, "Create solo review reflection");
  }
  const bSolo = await save([b.id]);
  requireSuccess((await b.client.rpc("create_session_reflection", { p_session_id: bSolo, p_text: "Beta solo private note" })).error, "Create Beta solo reflection");
  const previous = new Date(); previous.setDate(1); previous.setMonth(previous.getMonth() - 1); previous.setDate(15);
  const older = await save([a.id], previous);
  // Recording stamps completion at write time. Move only this disposable local
  // fixture's completion date to exercise the previous-month boundary.
  requireSuccess((await admin.from("sessions").update({ ended_at: previous.toISOString() }).eq("id", older).select("id").single()).error,
    "Date previous-month fixture");
  requireSuccess((await a.client.rpc("create_session_reflection", { p_session_id: older, p_text: "Alpha previous-month note" })).error, "Create previous-month reflection");
  const denied = await a.client.from("session_reflections").select("reflection_text").eq("user_id", b.id);
  requireSuccess(denied.error, "Check reflection RLS"); expect(denied.data).toEqual([]);

  await a.page.route("**/rest/v1/session_reflections*", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Unavailable"}' }));
  await a.page.getByRole("button", { name: "Open stats", exact: true }).click();
  await a.page.getByRole("tab", { name: "personal", exact: true }).focus();
  await a.page.getByRole("tab", { name: "personal", exact: true }).press("End");
  await expect(a.page.getByRole("tab", { name: "reflections", exact: true })).toHaveAttribute("aria-selected", "true");
  const review = a.page.getByRole("region", { name: "Private reflection review" });
  await expect(review.getByRole("alert")).toContainText("list may be incomplete");
  await expect(review.getByText(/No saved reflections/)).toHaveCount(0);
  await a.page.unroute("**/rest/v1/session_reflections*");
  await review.getByRole("button", { name: "Retry reflections" }).click();
  await expect(review.getByText("25 matching reflections", { exact: true })).toBeVisible();
  await expect(review.getByRole("article")).toHaveCount(20);
  await expect(review.getByText("Alpha shared-round private note", { exact: true })).toHaveCount(0);
  await review.getByRole("searchbox").fill("SHARED-ROUND");
  await expect(review.getByText("Alpha shared-round private note", { exact: true })).toBeVisible();
  await expect(review.getByRole("article")).toHaveCount(1);
  await review.getByRole("combobox", { name: "Round type" }).selectOption("duo");
  await review.getByRole("combobox", { name: "Private tag" }).selectOption("work");
  await expect(review.getByRole("article")).toHaveCount(1);
  await review.getByRole("combobox", { name: "Private tag" }).selectOption("study");
  await expect(review.getByText(/No reflections match/)).toBeVisible();
  await expect(review.getByText("Beta shared-round private note")).toHaveCount(0);

  await b.page.getByRole("button", { name: "Open stats", exact: true }).click();
  await b.page.getByRole("tab", { name: "reflections", exact: true }).click();
  const bReview = b.page.getByRole("region", { name: "Private reflection review" });
  await expect(bReview.getByText("2 matching reflections", { exact: true })).toBeVisible();
  await expect(bReview.getByText("Beta shared-round private note", { exact: true })).toBeVisible();
  await expect(bReview.getByText("Beta solo private note", { exact: true })).toBeVisible();
  await expect(bReview.getByText("Alpha shared-round private note", { exact: true })).toHaveCount(0);
  await expect(bReview.getByRole("article").filter({ hasText: "Beta shared-round private note" }).getByText("Study", { exact: true })).toBeVisible();

  await review.getByRole("combobox", { name: "Private tag" }).selectOption("all");
  await review.getByRole("combobox", { name: "Round type" }).selectOption("all");
  await review.getByRole("searchbox").fill("");
  await review.getByRole("button", { name: "Show more reflections (5 remaining)" }).click();
  await expect(review.getByRole("article")).toHaveCount(25);
  await review.getByRole("button", { name: "Previous reflection month" }).click();
  await expect(review.getByText("Alpha previous-month note", { exact: true })).toBeVisible();
  await expect(review.getByRole("article")).toHaveCount(1);
  await review.getByRole("button", { name: "Next reflection month" }).click();
  await expect(review.getByText("25 matching reflections", { exact: true })).toBeVisible();
  await expect(review.getByRole("article")).toHaveCount(20);

  const axe = await new AxeBuilder({ page: a.page }).include("#stats-panel")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations).toEqual([]);
  await review.getByRole("searchbox").fill("Long note");
  await expect(review.getByText(longNote, { exact: true })).toBeVisible();
  for (const [name, width, height] of [["phone", 375, 667], ["landscape", 667, 375]] as const) {
    await a.page.setViewportSize({ width, height });
    await review.scrollIntoViewIfNeeded();
    expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await a.page.screenshot({ path: test.info().outputPath(`reflection-review-${name}.png`) });
    await review.getByText(longNote, { exact: true }).scrollIntoViewIfNeeded();
    await expect(review.getByText(longNote, { exact: true })).toBeInViewport();
    expect(await review.getByText(longNote, { exact: true }).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await a.page.screenshot({ path: test.info().outputPath(`reflection-review-${name}-note.png`) });
  }
  await a.page.getByRole("button", { name: "View detailed stats →" }).click();
  const full = a.page.getByRole("dialog", { name: "Your stats", exact: true });
  const fullReview = full.getByRole("region", { name: "Private reflection review" });
  await expect(fullReview.getByText("25 matching reflections", { exact: true })).toBeVisible();
  await fullReview.getByRole("searchbox").fill("shared-round");
  await expect(fullReview.getByText("Alpha shared-round private note", { exact: true })).toBeVisible();
  requireSuccess((await a.client.rpc("delete_session_reflection", { p_session_id: shared, p_expected_version: aNote.data![0].version })).error, "Delete Alpha reflection");
  await a.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(fullReview.getByText(/No reflections match/)).toBeVisible();
  await expect(bReview.getByText("Beta shared-round private note", { exact: true })).toBeVisible();
  await full.getByRole("button", { name: "Close", exact: true }).click();
  expect(pageErrors).toEqual([]);
});
