import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, AUTH_STORAGE_KEY, requireSuccess } from "./duoFixture";
import { onboard } from "./onboard";

test("focus dates require consent, display local time and recover conflicts and lost responses", async ({ duo }) => {
  test.setTimeout(180_000);
  const { a, b, admin } = duo;
  const suffix = randomUUID().slice(0, 8);
  for (const [actor, timezoneId] of [[a, "America/Chicago"], [b, "Asia/Tokyo"]] as const) {
    const devtools = await actor.page.context().newCDPSession(actor.page);
    await devtools.send("Emulation.setTimezoneOverride", { timezoneId });
  }
  await a.page.goto("/"); await onboard(a.page, "Dates Alpha", `dta_${suffix}`);
  await b.page.goto("/");
  await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
  await b.page.reload(); await onboard(b.page, "Dates Beta", `dtb_${suffix}`);
  const regionA = a.page.getByRole("region", { name: "Shared focus dates", exact: true });
  const regionB = b.page.getByRole("region", { name: "Shared focus dates", exact: true });
  await expect(regionA.getByText("No upcoming focus dates.", { exact: true })).toBeVisible();
  await expect(regionB.getByText("No upcoming focus dates.", { exact: true })).toBeVisible();
  const starts = new Date(Date.now() + 2 * 86_400_000); starts.setUTCMinutes(30, 0, 0);
  const startsAt = starts.toISOString();
  // Authenticated direct API cannot propose to a non-friend.
  const unavailable = await a.client.rpc("propose_focus_date", { p_id: randomUUID(), p_recipient_id: b.id, p_starts_at: startsAt });
  expect(unavailable.error?.code).toBe("P0002");
  requireSuccess((await admin.from("friendships").insert({ requester_id: a.id, addressee_id: b.id, status: "accepted" })).error, "Create date fixture friends");
  await a.page.reload(); await b.page.reload();
  await regionA.getByRole("button", { name: "Propose a focus date", exact: true }).click();
  const localTime = await a.page.evaluate(value => {
    const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  }, startsAt);
  await regionA.getByLabel("Your local date and time", { exact: true }).fill(localTime);
  expect((await a.client.from("focus_dates").select("id")).data).toEqual([]);
  // The database commits, then the caller loses the acknowledgement.
  const proposeEndpoint = "**/rest/v1/rpc/propose_focus_date";
  await a.page.route(proposeEndpoint, async route => {
    const response = await route.fetch(); expect(response.ok()).toBe(true);
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Unavailable"}' });
  });
  const send = regionA.getByRole("button", { name: "Send date proposal", exact: true });
  await send.click();
  await expect(regionA.getByText(/Couldn't confirm this change/)).toBeVisible();
  await expect(regionA.getByText(/request confirmed/)).toHaveCount(0);
  await expect(send).toBeDisabled();
  await a.page.unroute(proposeEndpoint);
  await regionA.getByRole("button", { name: "Reload focus dates" }).click();
  await expect(regionA.getByText("Waiting for your friend to accept", { exact: true })).toBeVisible();
  await send.click(); // same draft/request ID, not a duplicate date
  await expect(regionA.getByText(/request confirmed/)).toBeVisible();
  const read = await a.client.from("focus_dates").select("*").single(); requireSuccess(read.error, "Read created date");
  const date = read.data!;
  expect(Date.parse(date.starts_at)).toBe(Date.parse(startsAt)); expect(date.status).toBe("pending");
  const forgedAcceptance = await a.client.rpc("respond_focus_date", { p_id: date.id, p_expected_version: 1, p_status: "accepted" });
  expect(forgedAcceptance.error?.code).toBe("PT409");
  await b.page.bringToFront(); await regionB.getByRole("button", { name: "Reload focus dates" }).click();
  await expect(regionB.getByText("Your friend proposed this time", { exact: true })).toBeVisible();
  const label = async (page: typeof a.page) => page.evaluate(value => new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "long" }).format(new Date(value)), startsAt);
  const labelA = await label(a.page), labelB = await label(b.page); expect(labelA).not.toBe(labelB);
  await expect(regionA.getByText(labelA, { exact: true })).toBeVisible(); await expect(regionB.getByText(labelB, { exact: true })).toBeVisible();
  await regionB.getByRole("button", { name: "Accept date", exact: true }).click();
  await expect(regionB.getByText("Accepted by both of you", { exact: true })).toBeVisible();
  await a.page.bringToFront(); await regionA.getByRole("button", { name: "Reload focus dates" }).click();
  await expect(regionA.getByText("Accepted by both of you", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page: a.page }).include('[aria-label="Shared focus dates"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  for (const [name, width, height] of [["phone",375,667],["landscape",667,375]] as const) {
    await a.page.setViewportSize({ width,height }); const cancel = regionA.getByRole("button", { name: "Cancel date", exact: true });
    await cancel.scrollIntoViewIfNeeded(); expect(await cancel.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await a.page.screenshot({ path: test.info().outputPath(`focus-dates-${name}.png`) });
  }
  await regionA.getByRole("button", { name: "Cancel date", exact: true }).click();
  await expect(regionA.getByText("Focus date cancelled.", { exact: true })).toBeVisible();
  await b.page.bringToFront(); await regionB.getByRole("button", { name: "Reload focus dates" }).click();
  await expect(regionB.getByRole("article")).toHaveCount(0);
  const next = await a.client.rpc("propose_focus_date", { p_id: randomUUID(), p_recipient_id: b.id, p_starts_at: startsAt });
  requireSuccess(next.error, "Create conflict date"); const pending = next.data![0];
  await regionB.getByRole("button", { name: "Reload focus dates" }).click();
  await expect(regionB.getByRole("button", { name: "Accept date", exact: true })).toBeVisible();
  // Keep the existing read snapshot stable while the other participant cancels.
  const reads = "**/rest/v1/focus_dates?*";
  await b.page.route(reads, route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([pending]) }));
  requireSuccess((await a.client.rpc("respond_focus_date", { p_id: pending.id, p_expected_version: pending.version, p_status: "cancelled" })).error, "Cancel from other device");
  await regionB.getByRole("button", { name: "Accept date", exact: true }).click();
  await expect(regionB.getByText(/changed elsewhere/)).toBeVisible();
  await b.page.unroute(reads); await regionB.getByRole("button", { name: "Reload focus dates" }).click();
  await expect(regionB.getByRole("article")).toHaveCount(0);
  const decline = await a.client.rpc("propose_focus_date", { p_id: randomUUID(), p_recipient_id: b.id, p_starts_at: startsAt }); requireSuccess(decline.error, "Create decline date");
  await regionB.getByRole("button", { name: "Reload focus dates" }).click();
  await regionB.getByRole("button", { name: "Decline date", exact: true }).click();
  await expect(regionB.getByText("Focus date declined.", { exact: true })).toBeVisible();
  await expect(regionB.getByRole("article")).toHaveCount(0);
  const focus = await admin.from("session_participants").select("session_id").in("user_id", [a.id,b.id]);
  requireSuccess(focus.error, "Read unchanged focus records"); expect(focus.data).toEqual([]);
});

test("concurrent focus date proposals enforce both participants' capacity", async ({ duo }) => {
  const { a,b,admin } = duo;
  requireSuccess((await admin.from("friendships").insert({ requester_id: a.id, addressee_id: b.id, status: "accepted" })).error, "Create capacity fixture friends");
  const startsAt = new Date(Date.now()+86_400_000).toISOString();
  const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? a : b).client.rpc("propose_focus_date", {
    p_id: randomUUID(), p_recipient_id: index % 2 ? b.id : a.id, p_starts_at: startsAt,
  })));
  expect(responses.filter(response => !response.error)).toHaveLength(10);
  expect(responses.filter(response => response.error?.code === "PT429")).toHaveLength(2);
  const rows = await a.client.from("focus_dates").select("*"); requireSuccess(rows.error, "Read bounded date list"); expect(rows.data).toHaveLength(10);
});
