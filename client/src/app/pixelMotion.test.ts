import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Pixel art is only crisp while its edges land on device pixels. Rotation puts
// them off the grid at every angle, fractional scale puts them off it at every
// row, and an eased tween between two whole pixels spends most of its time
// between them. None of that is visible in a rect count or a component test —
// it lives entirely in the keyframes — so this reads the stylesheet.

const CSS = readFileSync(path.join(__dirname, "globals.css"), "utf8");

/** decor-shooting-star is a 10x2 div of light, not a sprite; the diagonal is
 *  the effect. Nothing else in the file gets to move off the grid. */
const EXEMPT_FROM_WHOLE_PIXELS = new Set(["decor-shooting-star"]);

type Keyframes = { name: string; body: string };

function parseKeyframes(css: string): Keyframes[] {
  const blocks: Keyframes[] = [];
  const opener = /@keyframes\s+([\w-]+)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(css))) {
    let depth = 1;
    let i = opener.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    blocks.push({ name: match[1], body: css.slice(opener.lastIndex, i - 1) });
  }
  return blocks;
}

/** Every `transform:` value declared inside a keyframe block. */
function transformValues(body: string): string[] {
  return Array.from(body.matchAll(/transform:\s*([^;}]+)/g)).map((m) =>
    m[1].trim(),
  );
}

/** `translateY(-3px) scaleY(1.05)` → [["translateY","-3px"],["scaleY","1.05"]] */
function transformFunctions(value: string): [string, string][] {
  return Array.from(value.matchAll(/([a-zA-Z]+)\(([^)]*)\)/g)).map((m) => [
    m[1],
    m[2].trim(),
  ]);
}

const keyframes = parseKeyframes(CSS);

describe("pixel-art keyframes", () => {
  it("parses the stylesheet it is asserting about", () => {
    // Guards against a regex change quietly turning every test below into a
    // no-op loop over zero blocks.
    expect(keyframes.length).toBeGreaterThan(5);
    expect(keyframes.map((k) => k.name)).toContain("jump-anim");
  });

  for (const { name, body } of keyframes) {
    if (EXEMPT_FROM_WHOLE_PIXELS.has(name)) continue;
    const values = transformValues(body);
    if (values.length === 0) continue;

    it(`${name} only ever moves sprites by whole pixels`, () => {
      for (const value of values) {
        if (/^translate[XY]\(calc\(-?\d+ \* var\(--reaction-px\)\)\)$/.test(value)) continue;
        for (const [fn, arg] of transformFunctions(value)) {
          // Rotation and scale have no whole-pixel form at these sizes: one
          // degree across a 48px sprite is a sub-pixel shear, and scaleY(1.05)
          // of 72px is 75.6px. Translation is the only transform pixel art can
          // take, and only in integers.
          expect(
            ["translateX", "translateY"],
            `${name} uses ${fn}() — see the whole-pixel rule in globals.css`,
          ).toContain(fn);
          expect(arg, `${name}: ${fn}(${arg}) is not a whole pixel`).toMatch(
            /^(0|-?\d+px)$/,
          );
        }
      }
    });
  }
});

describe("character animation classes", () => {
  // Holding each pose is the other half of the rule: an eased tween from 0 to
  // -3px is on a fraction of a pixel for most of its cycle even though both
  // endpoints are whole.
  const STEPPED_CLASSES = [
    "pixel-idle",
    "pixel-jump",
    "pixel-float",
    "pixel-shuffle",
    "pixel-reaction",
  ];
  for (const cls of STEPPED_CLASSES) {
    it(`.${cls} steps between poses instead of tweening through them`, () => {
      const rule = CSS.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`))?.[1];
      expect(rule, `.${cls} is missing from globals.css`).toBeTruthy();
      expect(rule).toMatch(/animation:[^;]*steps\(/);
    });
  }

  // The decor loops travel far enough to need more stops than a keyframe list
  // wants to spell out, so they carry a per-keyframe step count matched to
  // their distance instead — a whole pixel per step either way.
  for (const name of ["sparkle-rise", "decor-drift", "decor-steam"]) {
    it(`@keyframes ${name} steps its travel into whole pixels`, () => {
      const block = keyframes.find((k) => k.name === name);
      expect(block, `@keyframes ${name} is missing`).toBeTruthy();
      expect(block!.body).toMatch(/animation-timing-function:\s*steps\(/);
    });
  }
});
