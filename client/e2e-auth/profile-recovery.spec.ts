import AxeBuilder from "@axe-core/playwright";
import { test, expect, requireSuccess } from "./duoFixture";
import { DEFAULT_AVATAR } from "../src/lib/avatarData";

test("a fresh device retries a profile outage without resetting an existing account", async ({ duo }) => {
  const { a } = duo;
  const setup = await a.client.from("profiles").update({ avatar_config: DEFAULT_AVATAR }).eq("id", a.id).select("id");
  requireSuccess(setup.error, "Set fixture avatar");
  expect(setup.data).toHaveLength(1);
  const original = await a.client.from("profiles").select("username,avatar_config").eq("id", a.id).single();
  requireSuccess(original.error, "Read fixture profile");
  let writes = 0;
  await a.page.route("**/rest/v1/profiles*", async route => {
    if (route.request().method() !== "GET") {
      writes++;
      await route.continue();
      return;
    }
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Temporary test outage" }) });
  });
  await a.page.setViewportSize({ width: 375, height: 667 });
  await a.page.goto("/");
  await expect(a.page.getByRole("heading", { name: "Couldn’t load your account" })).toBeVisible();
  const retry = a.page.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeFocused();
  await expect(a.page.getByRole("heading", { name: "Design your hero" })).toHaveCount(0);
  expect(writes).toBe(0);
  expect((await new AxeBuilder({ page: a.page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await a.page.unroute("**/rest/v1/profiles*");
  await retry.click();
  await expect(a.page.getByRole("button", { name: "Focus", exact: true })).toBeVisible();
  const restored = await a.client.from("profiles").select("username,avatar_config").eq("id", a.id).single();
  requireSuccess(restored.error, "Read recovered profile");
  expect(restored.data).toEqual(original.data);
});
