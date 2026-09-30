import type { Page } from "@playwright/test";
import { expect } from "./duoFixture";

export async function onboard(page: Page, name: string, username: string) {
  await expect(page.getByRole("heading", { name: "Design your hero" })).toBeVisible();
  await page.getByRole("textbox", { name: "Display name" }).fill(name);
  await page.getByRole("textbox", { name: "Username", exact: true }).fill(username);
  await page.getByRole("button", { name: "Ready to focus →" }).click();
}
