import { randomUUID } from "node:crypto";
import { test, expect, AUTH_STORAGE_KEY, requireSuccess } from "./duoFixture";
import { onboard } from "./onboard";

test("pending requests expose identity only while accepted friends retain live room presence", async ({ duo }) => {
  const { a, b, roomCodes } = duo;
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto("/"); await onboard(a.page, "Privacy Alpha", `pra_${suffix}`);
  await b.page.goto("/");
  await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
  await b.page.reload(); await onboard(b.page, "Privacy Beta", `prb_${suffix}`);
  await a.page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(a.page.getByRole("button", { name: "Start solo", exact: true })).toBeVisible();
  const roomId = await a.page.evaluate(() => localStorage.getItem("duodoro:session"));
  expect(roomId).toBeTruthy(); roomCodes.add(roomId!);
  requireSuccess((await a.client.from("friendships").insert({ requester_id: a.id, addressee_id: b.id })).error, "Create pending request");
  for (const [actor, other] of [[a,b],[b,a]] as const) {
    const read = await actor.client.from("profiles").select("id,current_session_id,current_world_id,current_room").eq("id", other.id);
    requireSuccess(read.error, "Read pending peer profile"); expect(read.data).toEqual([]);
  }
  const inbox = await b.client.rpc("get_friend_requests"); requireSuccess(inbox.error, "Read public request identity");
  expect(inbox.data).toHaveLength(1);
  expect(Object.keys(inbox.data![0]).sort()).toEqual(["id","requester_id","username","discriminator","display_name","is_premium"].sort());
  await b.page.getByRole("button", { name: "Open friends", exact: true }).click();
  const panel = b.page.getByRole("dialog", { name: "Friends", exact: true });
  await panel.getByRole("tab", { name: /requests/i }).click();
  await expect(panel.getByText("Privacy Alpha", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Join", exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Accept", exact: true }).click();
  await panel.getByRole("tab", { name: "friends", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Join", exact: true })).toBeVisible();
  await expect.poll(async () => {
    const read = await b.client.from("profiles").select("current_session_id").eq("id", a.id).single();
    requireSuccess(read.error, "Read accepted peer presence"); return read.data?.current_session_id;
  }).toBe(roomId);
});
