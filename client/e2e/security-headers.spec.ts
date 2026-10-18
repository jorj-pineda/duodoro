import { test, expect } from "@playwright/test";

test("HTML and offline fallback responses enforce browser security headers", async ({ request }) => {
  for (const path of ["/", "/terms", "/privacy", "/offline.html"]) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    const headers = response.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    expect(headers["content-security-policy"]).not.toContain("'unsafe-eval'");
  }
});

test("the browser blocks scripts outside the configured application origins", async ({ page }) => {
  let requested = false;
  await page.route("https://blocked.example.invalid/**", async route => {
    requested = true;
    await route.fulfill({ contentType: "application/javascript", body: "window.securityReviewUnexpectedScript=true" });
  });
  await page.goto("/");
  const result = await page.evaluate(() => new Promise<string>(resolve => {
    const script = document.createElement("script");
    script.src = "https://blocked.example.invalid/review.js";
    script.onload = () => { script.remove(); resolve("loaded"); };
    script.onerror = () => { script.remove(); resolve("blocked"); };
    document.head.append(script);
  }));
  expect(result).toBe("blocked");
  expect(requested).toBe(false);
});
