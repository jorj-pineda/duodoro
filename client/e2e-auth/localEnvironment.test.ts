import { describe, expect, it } from "vitest";
import { LOCAL_SUPABASE_URL, SOCKET_ORIGIN, localEnvironment } from "./localEnvironment";

const local = {
  SUPABASE_TEST_URL: LOCAL_SUPABASE_URL,
  SUPABASE_TEST_ANON_KEY: "local-anon",
  SUPABASE_TEST_SERVICE_KEY: "local-service",
  NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-anon",
  NEXT_PUBLIC_SOCKET_URL: SOCKET_ORIGIN,
};

describe("authenticated test destination guard", () => {
  it("accepts matching local test and browser configuration", () => {
    expect(localEnvironment(local)).toEqual({ url: LOCAL_SUPABASE_URL, anonKey: "local-anon", serviceKey: "local-service" });
  });
  it.each([undefined, "https://example.supabase.co", "http://127.0.0.1:54321"])("rejects a missing or non-project destination: %s", (url) => {
    expect(() => localEnvironment({ ...local, SUPABASE_TEST_URL: url })).toThrow(/only run against local/);
  });
  it.each(["SUPABASE_TEST_ANON_KEY", "SUPABASE_TEST_SERVICE_KEY"])("requires %s", (key) => {
    expect(() => localEnvironment({ ...local, [key]: "" })).toThrow(/credentials are missing/);
  });
  it.each(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SOCKET_URL"])("rejects a mismatched browser build: %s", (key) => {
    expect(() => localEnvironment({ ...local, [key]: "different" })).toThrow(/same local stack/);
  });
});
