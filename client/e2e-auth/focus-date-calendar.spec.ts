import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, AUTH_STORAGE_KEY, requireSuccess } from "./duoFixture";
import { onboard } from "./onboard";
import { SITE_URL } from "../src/lib/site";

test("accepted focus dates download private calendar copies, preserve timezones and block stale or failed exports", async ({ duo }) => {
  test.setTimeout(180_000);
  const { a,b,admin } = duo;
  const suffix = randomUUID().slice(0,8);
  await a.page.goto("/"); await onboard(a.page,"Calendar Alpha",`cala_${suffix}`);
  await b.page.goto("/");
  await b.page.evaluate(({ key,session }) => localStorage.setItem(key,JSON.stringify(session)), { key:AUTH_STORAGE_KEY,session:b.session });
  await b.page.reload(); await onboard(b.page,"Calendar Beta",`calb_${suffix}`);
  requireSuccess((await admin.from("friendships").insert({ requester_id:a.id,addressee_id:b.id,status:"accepted" })).error,"Create calendar fixture friends");
  const start = new Date(Date.now()+2*86_400_000); start.setUTCMinutes(30,0,0);
  const proposed = await a.client.rpc("propose_focus_date", { p_id:randomUUID(),p_recipient_id:b.id,p_starts_at:start.toISOString() });
  requireSuccess(proposed.error,"Create calendar fixture date"); const pending = proposed.data![0];
  const regionA = a.page.getByRole("region",{ name:"Shared focus dates",exact:true });
  const regionB = b.page.getByRole("region",{ name:"Shared focus dates",exact:true });
  await a.page.reload(); await b.page.reload();
  await expect(regionA.getByText("Waiting for your friend to accept",{ exact:true })).toBeVisible();
  for (const region of [regionA,regionB]) await expect(region.getByRole("button",{ name:"Add to calendar",exact:true })).toHaveCount(0);
  await regionB.getByRole("button",{ name:"Accept date",exact:true }).click();
  await regionA.getByRole("button",{ name:"Reload focus dates" }).click();
  await expect(regionA.getByText("Accepted by both of you",{ exact:true })).toBeVisible();
  const before = await a.client.from("focus_dates").select("*").eq("id",pending.id).single(); requireSuccess(before.error,"Read accepted calendar fixture");
  const texts: string[] = [];
  const stamp = (date: Date) => date.toISOString().replace(/[-:]/g,"").replace(/\.000Z$/,"Z");
  for (const [actor, region, timezoneId] of [[a,regionA,"America/Chicago"],[b,regionB,"Asia/Tokyo"]] as const) {
    const devtools = await actor.page.context().newCDPSession(actor.page); await devtools.send("Emulation.setTimezoneOverride",{ timezoneId });
    await actor.page.bringToFront();
    await region.getByRole("button",{ name:"Add to calendar",exact:true }).click();
    const panel = region.getByRole("group",{ name:"Calendar export",exact:true });
    await expect(panel).toContainText("remove or update the event in your calendar yourself");
    await expect(panel).toContainText("Your calendar's sharing settings apply");
    await panel.getByLabel("Calendar block length").selectOption("50");
    const [download] = await Promise.all([actor.page.waitForEvent("download"), panel.getByRole("button",{ name:"Download .ics file",exact:true }).click()]);
    expect(await download.failure()).toBeNull(); expect(download.suggestedFilename()).toMatch(/^duodoro-focus-\d{8}\.ics$/);
    const path = await download.path(); if (!path) throw new Error("Browser didn't produce a calendar file.");
    const content = await readFile(path,"utf8"); texts.push(content.replace(/\r\n[ \t]/g,""));
    expect(content).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2.0\r\n/);
    expect(content.replace(/\r\n/g,"")).not.toMatch(/[\r\n]/);
    for (const line of content.split("\r\n")) expect(Buffer.byteLength(line,"utf8")).toBeLessThanOrEqual(75);
    const event = texts.at(-1)!;
    expect(event).toContain(`DTSTART:${stamp(start)}\r\n`);
    expect(event).toContain(`DTEND:${stamp(new Date(start.getTime()+50*60_000))}\r\n`);
    expect(event).toContain("CLASS:PRIVATE\r\n"); expect(event).toContain(`URL:${SITE_URL}\r\n`);
    for (const sensitive of [a.id,b.id,"Calendar Alpha","Calendar Beta","ATTENDEE","ORGANIZER","VALARM","/join/","mailto:"]) expect(event).not.toContain(sensitive);
    await expect(panel.getByRole("status")).toContainText("Open the download in your calendar to import it");
  }
  expect(texts[0].match(/^UID:(.+)$/m)![1]).toBe(texts[1].match(/^UID:(.+)$/m)![1]);
  const after = await a.client.from("focus_dates").select("*").eq("id",pending.id).single();
  requireSuccess(after.error,"Read unchanged date after calendar downloads"); expect(after.data).toEqual(before.data);
  const focus = await admin.from("session_participants").select("session_id").in("user_id",[a.id,b.id]);
  requireSuccess(focus.error,"Read unchanged focus after export"); expect(focus.data).toEqual([]);
  await a.page.bringToFront();
  const panel = regionA.getByRole("group",{ name:"Calendar export",exact:true });
  expect((await new AxeBuilder({ page:a.page }).include('[aria-label="Shared focus dates"]').withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
  for (const [name,width,height] of [["phone",375,667],["landscape",667,375]] as const) {
    await a.page.setViewportSize({ width,height }); const button = panel.getByRole("button",{ name:"Download .ics file",exact:true });
    await button.scrollIntoViewIfNeeded(); expect(await button.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await a.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await a.page.screenshot({ path:test.info().outputPath(`calendar-export-${name}.png`) });
  }
  const endpoint = "**/rest/v1/focus_dates?*";
  await a.page.route(endpoint, route => new URL(route.request().url()).searchParams.has("id")
    ? route.fulfill({ status:503,contentType:"application/json",body:'{"message":"Unavailable"}' }) : route.continue());
  let unexpectedDownload = false; a.page.on("download",()=>{ unexpectedDownload=true; });
  await panel.getByRole("button",{ name:"Download .ics file",exact:true }).click();
  await expect(panel.getByRole("alert")).toContainText("Couldn't prepare the calendar file");
  await expect(panel.getByRole("status")).toHaveCount(0); expect(unexpectedDownload).toBe(false);
  await a.page.unroute(endpoint);
  // Let background reads keep the old card while a click's fresh lookup reaches
  // the real cancelled row. This specifically tests the last-moment read guard.
  await a.page.route(endpoint, route => {
    const url = new URL(route.request().url());
    return url.searchParams.has("id") ? route.continue() : route.fulfill({ status:200,contentType:"application/json",body:JSON.stringify([before.data]) });
  });
  requireSuccess((await b.client.rpc("respond_focus_date", { p_id:pending.id,p_expected_version:before.data!.version,p_status:"cancelled" })).error,"Cancel calendar date elsewhere");
  await panel.getByRole("button",{ name:"Download .ics file",exact:true }).click();
  await expect(panel.getByRole("alert")).toContainText("Reload focus dates before exporting");
  expect(unexpectedDownload).toBe(false);
  await a.page.unroute(endpoint); await regionA.getByRole("button",{ name:"Reload focus dates" }).click();
  await expect(regionA.getByRole("article")).toHaveCount(0); await expect(regionA.getByRole("button",{ name:"Add to calendar",exact:true })).toHaveCount(0);
});
