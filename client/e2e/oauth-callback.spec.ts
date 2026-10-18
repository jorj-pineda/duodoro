import { test, expect } from "@playwright/test";
import { SITE_URL } from "../src/lib/site";

test("production OAuth callbacks cannot redirect dummy codes through next or forwarded hosts", async ({ request }) => {
  for (const next of ["@attacker.invalid/", ".attacker.invalid/", "//attacker.invalid/", "/auth/callback"]) {
    const response = await request.get(`/auth/callback?code=review-dummy&next=${encodeURIComponent(next)}`, {
      maxRedirects: 0,
      headers: { "x-forwarded-host": "attacker.invalid", "x-forwarded-proto": "http" },
    });
    expect(response.status()).toBe(307);
    const target = new URL(response.headers().location);
    expect(target.origin).toBe(SITE_URL); expect(target.pathname).toBe("/");
    expect([...target.searchParams]).toEqual([["code", "review-dummy"]]);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  }
});

test("production OAuth callbacks encode the code and discard unrelated parameters", async ({ request }) => {
  const code = "review&other=value?#fragment";
  const response = await request.get(`/auth/callback?code=${encodeURIComponent(code)}&extra=private`, { maxRedirects: 0 });
  expect([...new URL(response.headers().location).searchParams]).toEqual([["code", code]]);
  const missing = await request.get("/auth/callback?next=@attacker.invalid/&error_description=private", { maxRedirects: 0 });
  expect(missing.headers().location).toBe(`${SITE_URL}/`);
});
