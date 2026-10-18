// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SITE_URL } from "@/lib/site";
import { GET } from "./route";

beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VERCEL_ENV", "production"); });
afterEach(() => vi.unstubAllEnvs());
const callback = (next: string, code = "review-dummy") => {
  const url = new URL("/auth/callback", SITE_URL);
  url.searchParams.set("next", next); url.searchParams.set("code", code);
  return new NextRequest(url);
};

describe("OAuth callback destination", () => {
  it.each(["@attacker.invalid/", ".attacker.invalid/", "//attacker.invalid/", "https://attacker.invalid/", "/\\attacker.invalid/", "/auth/callback", "/?code=another"])("ignores unused next parameter %s", async next => {
    const response = await GET(callback(next));
    const target = new URL(response.headers.get("location")!);
    expect(target.origin).toBe(SITE_URL); expect(target.pathname).toBe("/");
    expect(target.searchParams.get("code")).toBe("review-dummy");
  });
  it("ignores untrusted request hosts and forwarded headers in production", async () => {
    const response = await GET(new NextRequest("https://attacker.invalid/auth/callback?code=review-dummy", {
      headers: { host: "attacker.invalid", "x-forwarded-host": "attacker.invalid", "x-forwarded-proto": "http" },
    }));
    expect(new URL(response.headers.get("location")!).origin).toBe(SITE_URL);
  });
  it("encodes the code as one query value and prevents callback caching or referrer disclosure", async () => {
    const code = "review&extra=value?#fragment";
    const response = await GET(callback("/", code));
    const target = new URL(response.headers.get("location")!);
    expect([...target.searchParams]).toEqual([["code", code]]); expect(target.hash).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("returns to the app without forwarding arbitrary parameters when there is no code", async () => {
    const response = await GET(new NextRequest(`${SITE_URL}/auth/callback?next=@attacker.invalid/&error_description=private`));
    expect(response.headers.get("location")).toBe(`${SITE_URL}/`);
  });
  it("keeps loopback development callbacks local without trusting forwarded hosts", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await GET(new NextRequest("http://localhost:3000/auth/callback?code=review-dummy", { headers: { "x-forwarded-host": "attacker.invalid" } }));
    expect(new URL(response.headers.get("location")!).origin).toBe("http://localhost:3000");
    const remote = await GET(new NextRequest("http://attacker.invalid/auth/callback?code=review-dummy"));
    expect(new URL(remote.headers.get("location")!).origin).toBe(SITE_URL);
  });
  it("uses the trusted Vercel deployment hostname for previews", async () => {
    vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("VERCEL_URL", "duodoro-preview.vercel.app");
    const response = await GET(callback("@attacker.invalid/"));
    expect(new URL(response.headers.get("location")!).origin).toBe("https://duodoro-preview.vercel.app");
  });
  it("falls back to the canonical origin for malformed preview configuration", async () => {
    vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("VERCEL_URL", "duodoro.vercel.app@attacker.invalid");
    const response = await GET(callback("/"));
    expect(new URL(response.headers.get("location")!).origin).toBe(SITE_URL);
  });
});
