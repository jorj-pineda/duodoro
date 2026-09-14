import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // `*.integration.test.js` needs a live Supabase (`supabase start`) and real
    // users, so it is not part of the default suite CI runs. Drive it with
    // `npm run test:integration`. The name is the switch, deliberately: nobody
    // should be able to add a second live-database test and have it silently
    // join the unit run.
    exclude: ["**/node_modules/**", "**/*.integration.test.js"],
  },
});
