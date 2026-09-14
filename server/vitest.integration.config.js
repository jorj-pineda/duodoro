import { defineConfig } from "vitest/config";

// The live-database suite. Separate config on purpose: the default
// `vitest.config.js` excludes `*.integration.test.js` so `npm run test:run`
// (what CI executes, with no Supabase stack) is hermetic. Exclude lists append
// rather than replace, so the only way to run these is a config that never had
// the exclusion — this one.
export default defineConfig({
  test: {
    globals: true,
    include: ["**/*.integration.test.js"],
    // Real users are created and deleted; parallel files would collide on
    // cleanup and there is only one database to share.
    fileParallelism: false,
  },
});
