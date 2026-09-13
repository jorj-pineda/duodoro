import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

// The palette is only "one place" while nothing else can slip a colour in
// beside it. Scene art drifts back to literals one convenient hex at a time —
// that is how this codebase ended up with three design systems in one frame —
// so this is a guard, not a bug fix: it fails the moment a colour is written
// into the art instead of chosen from `lib/palette.ts`.

const ROOT = path.resolve(__dirname, "..");
/** The one file allowed to name an art colour. */
const PALETTE = "lib/palette.ts";

/**
 * Files that legitimately carry their own colours, and why. Everything here is
 * outside the runtime-generated scene: it is UI chrome, or a per-world value
 * that is itself the definition of that world.
 */
const ALLOWED = new Map<string, string>([
  [PALETTE, "the palette"],
  ["lib/avatarData.ts", "world skies/grounds and the avatar colour choices — these ARE the data"],
  ["lib/site.ts", "brand/launch colours for metadata and the OG image"],
  ["components/LandingPage.tsx", "the example avatars and the Google/Discord brand marks"],
  ["components/StickyNote.tsx", "note colours are a user-facing choice, like avatar colour"],
]);

/** Every tracked source file that isn't a test and isn't a stylesheet. */
function sourceFiles(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "*.ts", "*.tsx"],
    { cwd: ROOT, encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.includes(".test."))
    .filter((f) => !f.endsWith(".d.ts"));
}

const HEX = /#[0-9a-fA-F]{6}\b/g;

describe("art colour has one home", () => {
  it("finds the source files it is asserting about", () => {
    // Guard against a glob or git change silently emptying this test.
    expect(sourceFiles().length).toBeGreaterThan(20);
  });

  it("no art file writes its own hex outside lib/palette.ts", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const rel = file.replace(/^src\//, "");
      if (ALLOWED.has(rel)) continue;
      const body = readFileSync(path.join(ROOT, file), "utf8");
      const hits = body.match(HEX);
      if (hits) offenders.push(`${rel}: ${[...new Set(hits)].join(", ")}`);
    }
    expect(
      offenders,
      "move these into lib/palette.ts (or add them to the allowlist with a reason)",
    ).toEqual([]);
  });

  it("would catch a literal put back into a scene file", () => {
    // A/B for the guard itself: one of the files this PR actually cleaned up
    // still must not contain a colour, and the assertion above only fails if
    // this would too.
    const caving = readFileSync(
      path.join(ROOT, "components/WorldDecorations.tsx"),
      "utf8",
    );
    expect(caving.match(HEX)).toBeNull();
  });
});
