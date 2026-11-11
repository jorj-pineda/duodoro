import { randomUUID } from "node:crypto";
import { test, expect, requireSuccess } from "./duoFixture";
import { onboard } from "./onboard";

test("Stats exits protect private drafts and wait for pending saves", async ({ duo }) => {
  const { a, admin, roomCodes } = duo;
  await a.page.goto("/"); await onboard(a.page, "Exit Alpha", `ex_${randomUUID().slice(0, 8)}`);
  await expect(a.page.getByRole("button", { name: "Focus", exact: true })).toBeVisible();
  const room = randomUUID(); roomCodes.add(room);
  requireSuccess((await admin.rpc("record_focus_session", {
    p_recording_key: randomUUID(), p_room_code: room, p_world: "forest", p_focus_duration: 600,
    p_break_duration: 60, p_actual_focus: 600, p_completed: true,
    p_started_at: new Date(Date.now() - 600_000).toISOString(), p_user_ids: [a.id],
  })).error, "Record Stats fixture");
  await a.page.getByRole("button", { name: "Open stats", exact: true }).click();
  const panel = a.page.getByRole("dialog", { name: "Stats", exact: true });
  await panel.getByRole("tab", { name: "calendar", exact: true }).click();
  await panel.getByRole("button", { name: "Add reflection", exact: true }).click();
  const draft = panel.getByRole("textbox", { name: "How did this session go?" });
  await draft.fill("Do not lose this private draft");
  async function cancel(action: () => Promise<unknown>) {
    a.page.once("dialog", async dialog => { expect(dialog.type()).toBe("confirm"); await dialog.dismiss(); });
    await action(); await expect(draft).toHaveValue("Do not lose this private draft");
  }
  await cancel(() => panel.getByRole("button", { name: "Close", exact: true }).click());
  await cancel(() => a.page.keyboard.press("Escape"));
  await cancel(() => a.page.mouse.click(1, 350));
  await cancel(() => panel.getByRole("tab", { name: "personal", exact: true }).click());
  const calendarTab = panel.getByRole("tab", { name: "calendar", exact: true });
  await expect(calendarTab).toBeFocused();
  await calendarTab.focus(); await cancel(() => a.page.keyboard.press("ArrowRight"));
  await expect(calendarTab).toBeFocused(); await expect(calendarTab).toHaveAttribute("aria-selected", "true");
  await cancel(() => panel.getByRole("button", { name: "View detailed stats →" }).click());
  const unsaved = await a.client.from("session_reflections").select("session_id").eq("user_id", a.id);
  requireSuccess(unsaved.error, "Read unsaved draft state"); expect(unsaved.data).toEqual([]);
  a.page.once("dialog", dialog => dialog.accept());
  await panel.getByRole("button", { name: "View detailed stats →" }).click();
  const full = a.page.getByRole("dialog", { name: "Your stats", exact: true });
  await full.getByRole("button", { name: "Add reflection", exact: true }).click();
  const fullDraft = full.getByRole("textbox", { name: "How did this session go?" });
  await fullDraft.fill("Saved after the guard waits");
  a.page.once("dialog", dialog => dialog.dismiss()); await full.getByRole("button", { name: "Close", exact: true }).click();
  await expect(fullDraft).toHaveValue("Saved after the guard waits");
  a.page.once("dialog", dialog => dialog.dismiss()); await a.page.keyboard.press("Escape");
  await expect(fullDraft).toHaveValue("Saved after the guard waits");
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const endpoint = "**/rest/v1/rpc/create_session_reflection";
  await a.page.route(endpoint, async route => { await gate; await route.continue(); });
  try {
    const request = a.page.waitForRequest(request => request.url().endsWith("/rpc/create_session_reflection"));
    await full.getByRole("button", { name: "Save reflection", exact: true }).click(); await request;
    await full.getByRole("button", { name: "Close", exact: true }).click();
    await expect(full.getByRole("status").filter({ hasText: "Wait for your reflection" })).toBeInViewport({ ratio: 1 });
    await expect(fullDraft).toBeDisabled();
  } finally { release(); }
  await expect(full.getByText("Reflection saved", { exact: true })).toBeVisible();
  await a.page.unroute(endpoint);
  await full.getByRole("button", { name: "Close", exact: true }).click();
  await expect(full).toHaveCount(0);
  const stored = await a.client.from("session_reflections").select("reflection_text").eq("user_id", a.id);
  requireSuccess(stored.error, "Read saved reflection"); expect(stored.data).toEqual([{ reflection_text: "Saved after the guard waits" }]);
});
