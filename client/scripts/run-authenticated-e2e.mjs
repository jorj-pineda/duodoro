import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const clientDirectory = fileURLToPath(new URL("../", import.meta.url));
const repositoryDirectory = fileURLToPath(new URL("../../", import.meta.url));

// Read only the local CLI's credentials; never use deployment .env values or
// print the status JSON. Both this runner and the Playwright config fail closed.
let local;
try {
  local = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], {
    cwd: repositoryDirectory,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  }));
} catch {
  throw new Error("Local Supabase is unavailable. Run supabase start in the repository root.");
}
if (local.API_URL !== "http://127.0.0.1:55321" || !local.ANON_KEY || !local.SERVICE_ROLE_KEY) {
  throw new Error("Authenticated tests require this repository's local Supabase stack on port 55321.");
}

const environment = {
  ...process.env,
  SUPABASE_TEST_URL: local.API_URL,
  SUPABASE_TEST_ANON_KEY: local.ANON_KEY,
  SUPABASE_TEST_SERVICE_KEY: local.SERVICE_ROLE_KEY,
  NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
  NEXT_PUBLIC_SOCKET_URL: "http://127.0.0.1:3301",
  SUPABASE_URL: local.API_URL,
  SUPABASE_SERVICE_KEY: local.SERVICE_ROLE_KEY,
  FOCUS_QUEUE_URL: "",
};

async function run(command, args, cwd = clientDirectory) {
  const child = spawn(command, args, { cwd, env: environment, stdio: "inherit" });
  const forwardSignal = (signal) => child.kill(signal);
  const onInterrupt = () => forwardSignal("SIGINT");
  const onTerminate = () => forwardSignal("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  try {
    await new Promise((resolve, reject) => {
      child.once("error", () => reject(new Error(`Could not start ${command}.`)));
      child.once("exit", (code) => code === 0
        ? resolve()
        : reject(new Error(`${command} exited unsuccessfully.`)));
    });
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  }
}

await run("npm", ["run", "test:integration"], fileURLToPath(new URL("../../server/", import.meta.url)));
// NEXT_PUBLIC_* are baked into the production build. Always rebuild for this
// local stack rather than accidentally testing a previous deployment build.
await run("npm", ["run", "build"]);
await run("npx", ["playwright", "test", "--config", "playwright.auth.config.ts", ...process.argv.slice(2)]);
