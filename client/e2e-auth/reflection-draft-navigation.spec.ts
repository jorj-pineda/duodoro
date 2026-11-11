import { randomUUID } from "node:crypto";
import { test, expect, requireSuccess } from "./duoFixture";
import { onboard } from "./onboard";

test("calendar navigation requires explicit discard and cancelling retains a private reflection", async ({ duo }) => {
  const { a, admin, roomCodes } = duo;
  await a.page.goto("/");
  await onboard(a.page, "Draft Alpha", `dr_${randomUUID().slice(0, 8)}`);
  await expect(a.page.getByRole("button", { name: "Focus", exact: true })).toBeVisible();
  const room = randomUUID(); roomCodes.add(room);
  requireSuccess((await admin.rpc("record_focus_session", {
    p_recording_key: randomUUID(), p_room_code: room, p_world: "forest", p_focus_duration: 600,
    p_break_duration: 60, p_actual_focus: 600, p_completed: true,
    p_started_at: new Date(Date.now() - 600_000).toISOString(), p_user_ids: [a.id],
  })).error, "Record draft fixture");
  await a.page.getByRole("button", { name: "Open stats", exact: true }).click();
  await a.page.getByRole("tab", { name: "calendar" }).click();
  const calendar = a.page.getByRole("region", { name: "Focus calendar" });
  await calendar.getByRole("button", { name: "Add reflection", exact: true }).click();
  const text = calendar.getByRole("textbox", { name: "How did this session go?" });
  await text.fill("Private draft, still working on it");
  const selected = calendar.getByRole("button", { pressed: true }).filter({ hasText: /^\d+/ });
  const label = await selected.getAttribute("aria-label");
  if (!label) throw new Error("Calendar selection unavailable");
  const date = label.slice(0, 10);
  const target = new Date(`${date}T12:00:00Z`);
  const offset = target.getUTCDate() < 28 ? 1 : -1;
  target.setUTCDate(target.getUTCDate() + offset);
  const next = target.toISOString().slice(0, 10);
  a.page.once("dialog", async dialog => {
    expect(dialog.type()).toBe("confirm"); expect(dialog.message()).toContain("unsaved reflection");
    await dialog.dismiss();
  });
  await calendar.getByRole("button", { name: new RegExp(`^${next}:`) }).click();
  await expect(text).toHaveValue("Private draft, still working on it");
  await expect(calendar.getByRole("button", { name: new RegExp(`^${date}:`) })).toHaveAttribute("aria-pressed", "true");
  a.page.once("dialog", dialog => dialog.dismiss());
  await calendar.getByRole("button", { name: "Previous month" }).click();
  await expect(text).toHaveValue("Private draft, still working on it");
  const saved = await a.client.from("session_reflections").select("session_id").eq("user_id", a.id);
  requireSuccess(saved.error, "Check unsaved reflection"); expect(saved.data).toEqual([]);
  a.page.once("dialog", dialog => dialog.accept());
  await calendar.getByRole("button", { name: "Previous month" }).click();
  await expect(text).toHaveCount(0);
  await calendar.getByRole("button", { name: "Next month" }).click();
  await expect(calendar.getByRole("button", { name: "Add reflection", exact: true })).toBeVisible();
});
