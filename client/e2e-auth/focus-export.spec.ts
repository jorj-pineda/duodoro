import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect, requireSuccess, AUTH_STORAGE_KEY } from "./duoFixture";
import { onboard } from "./onboard";

test("exports caller history and optional own notes without a partner's private data", async ({ duo }) => {
  const { a, b, admin, roomCodes } = duo;
  await a.page.goto("/"); await onboard(a.page, "Export Alpha", `ex_${randomUUID().slice(0, 8)}`);
  await b.page.goto("/");
  await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
  await b.page.reload(); await onboard(b.page, "Export Beta", `eb_${randomUUID().slice(0, 8)}`);
  const records = [{ ids: [a.id, b.id], seconds: 600, completed: true }, { ids: [a.id], seconds: 301, completed: false }, { ids: [b.id], seconds: 999, completed: true }];
  let sharedRoom = "";
  for (const record of records) {
    const room = randomUUID(); roomCodes.add(room); if (record.ids.length === 2) sharedRoom = room;
    requireSuccess((await admin.rpc("record_focus_session", {
      p_recording_key: randomUUID(), p_room_code: room, p_world: "forest", p_focus_duration: Math.max(600, record.seconds),
      p_break_duration: 60, p_actual_focus: record.seconds, p_completed: record.completed,
      p_started_at: new Date(Date.now() - 600_000).toISOString(), p_user_ids: record.ids,
    })).error, "Record export fixture");
  }
  const saved = await admin.from("sessions").select("id").eq("room_code", sharedRoom).single();
  requireSuccess(saved.error, "Find shared export fixture");
  requireSuccess((await admin.from("session_reflections").insert([
    { session_id: saved.data!.id, user_id: a.id, reflection_text: "MY EXPORT NOTE" },
    { session_id: saved.data!.id, user_id: b.id, reflection_text: "PARTNER SECRET" },
  ])).error, "Seed private reflection fixtures");
  await a.page.getByRole("button", { name: "Open stats", exact: true }).click();
  await a.page.getByRole("button", { name: "View detailed stats →" }).click();
  const section = a.page.getByRole("region", { name: "Export focus history" });
  const today = new Date().toISOString().slice(0, 10);
  await section.getByLabel("Export from (UTC)").fill(today);
  await section.getByLabel("Export through (UTC)").fill(today);
  await section.getByLabel("Include my private reflections").check();
  const pending = a.page.waitForEvent("download");
  await section.getByRole("button", { name: "Download CSV", exact: true }).click();
  const download = await pending;
  const content = await readFile((await download.path())!, "utf8");
  expect(content).toContain('"600"'); expect(content).toContain('"301"'); expect(content).toContain('"Stopped"');
  expect(content).toContain("MY EXPORT NOTE"); expect(content).not.toContain("PARTNER SECRET");
  expect(content).not.toContain('"999"'); expect(content).not.toContain(a.id); expect(content).not.toContain(b.id);
  await download.delete();
});
