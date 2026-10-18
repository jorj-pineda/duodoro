import { randomUUID } from "node:crypto";
import { test, expect, AUTH_STORAGE_KEY, requireSuccess } from "./duoFixture";
import { onboard } from "./onboard";

test("direct API cannot forge acceptance and the recipient can still accept through the UI", async ({ duo }) => {
  const { a, b } = duo;
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto("/");
  await onboard(a.page, "Consent Alpha", `cna_${suffix}`);
  await b.page.goto("/");
  await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
  await b.page.reload();
  await onboard(b.page, "Consent Beta", `cnb_${suffix}`);

  const forged = await a.client.from("friendships").insert({ requester_id: a.id, addressee_id: b.id, status: "accepted" });
  expect(forged.error?.code).toBe("42501");
  const pending = await a.client.from("friendships").insert({ requester_id: a.id, addressee_id: b.id }).select("id,status").single();
  requireSuccess(pending.error, "Create pending request");
  expect(pending.data?.status).toBe("pending");
  const selfAccepted = await a.client.from("friendships").update({ status: "accepted" }).eq("id", pending.data!.id).select("id");
  requireSuccess(selfAccepted.error, "Check requester update result");
  expect(selfAccepted.data).toEqual([]);

  await b.page.getByRole("button", { name: "Open friends", exact: true }).click();
  const panel = b.page.getByRole("dialog", { name: "Friends", exact: true });
  await panel.getByRole("tab", { name: /requests/i }).click();
  await expect(panel.getByText("Consent Alpha", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Accept", exact: true }).click();
  await expect.poll(async () => {
    const read = await a.client.from("friendships").select("status").eq("id", pending.data!.id).single();
    requireSuccess(read.error, "Read accepted friendship");
    return read.data?.status;
  }).toBe("accepted");
  await panel.getByRole("tab", { name: "friends", exact: true }).click();
  await expect(panel.getByText("Consent Alpha", { exact: true })).toBeVisible();
});
