import { describe, expect, it } from "vitest";
import { browserSecurityHeaders } from "./securityHeaders";
const csp = (options: Parameters<typeof browserSecurityHeaders>[0] = {}) => browserSecurityHeaders(options).find(header=>header.key==="Content-Security-Policy")!.value;

describe("browser security policy", () => {
  it("allows exactly the configured HTTP and WebSocket origins without retaining paths or query parameters", () => {
    const value = csp({ supabaseUrl:"https://project.supabase.co/rest/v1?discard=1",socketUrl:"https://timer.onrender.com/socket.io/" });
    expect(value).toContain("connect-src 'self' https://project.supabase.co wss://project.supabase.co https://timer.onrender.com wss://timer.onrender.com");
    expect(value).not.toContain("discard"); expect(value).not.toContain("/rest/");
    expect(value).not.toContain("https:;"); expect(value).not.toContain("*");
    expect(value).toContain("frame-ancestors 'none'"); expect(value).toContain("object-src 'none'");
    expect(value).not.toContain("unsafe-eval"); expect(value).not.toContain("vercel.live");
  });
  it("supports local realtime ports and adds development tools only in development", () => {
    const production = csp({ supabaseUrl:"http://127.0.0.1:55321",socketUrl:"ws://localhost:3301" });
    expect(production).toContain("http://127.0.0.1:55321 ws://127.0.0.1:55321 http://localhost:3301 ws://localhost:3301");
    expect(production).not.toContain("unsafe-eval");
    const development = csp({ development:true });
    expect(development).toContain("'unsafe-eval'"); expect(development).toContain("ws://localhost:*");
  });
  it("keeps Vercel feedback origins restricted to previews", () => {
    const value = csp({ preview:true });
    expect(value).toContain("https://vercel.live"); expect(value).toContain("wss://ws-us3.pusher.com");
    expect(value).toContain("frame-src https://vercel.live"); expect(value).toContain("https://assets.vercel.com");
    expect(csp()).not.toContain("pusher.com");
  });
  it.each(["not-a-url","javascript:alert(1)","https://user:password@example.invalid", "https://host.invalid; script-src *"])("fails closed on invalid public connection configuration: %s", value => {
    expect(()=>csp({socketUrl:value})).toThrow("Invalid public connection URL");
  });
});
