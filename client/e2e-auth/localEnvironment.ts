export const APP_ORIGIN = "http://127.0.0.1:3300";
export const SOCKET_ORIGIN = "http://127.0.0.1:3301";
export const LOCAL_SUPABASE_URL = "http://127.0.0.1:55321";

export function localEnvironment(environment: Record<string, string | undefined> = process.env) {
  if (environment.SUPABASE_TEST_URL !== LOCAL_SUPABASE_URL) {
    throw new Error("Authenticated browser tests only run against local Supabase on port 55321.");
  }
  const anonKey = environment.SUPABASE_TEST_ANON_KEY;
  const serviceKey = environment.SUPABASE_TEST_SERVICE_KEY;
  if (!anonKey || !serviceKey) {
    throw new Error("Local test credentials are missing. Run npm run test:e2e:auth.");
  }
  if (environment.NEXT_PUBLIC_SUPABASE_URL !== LOCAL_SUPABASE_URL ||
      environment.NEXT_PUBLIC_SUPABASE_ANON_KEY !== anonKey ||
      environment.NEXT_PUBLIC_SOCKET_URL !== SOCKET_ORIGIN) {
    throw new Error("The browser build must use the same local stack. Run npm run test:e2e:auth.");
  }
  return { url: LOCAL_SUPABASE_URL, anonKey, serviceKey };
}
