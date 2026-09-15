import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import GameWorld, { type GamePhase } from "./GameWorld";
import { DEFAULT_AVATAR, type WorldId } from "@/lib/avatarData";
import { ART_PX, ART_PX_COMPACT, GROUND } from "@/lib/scene";
import { CHAR_W, CHAR_H } from "@/lib/characterMaps";
import { PET_W, PET_H, PET_STAGE_SIZE } from "@/lib/petMaps";
import { PET_STAGES, type PetStage } from "@/lib/petLevel";

// The scene used to place characters with `calc(41.7% + 8px)` on `left` and
// spin the break-phase controller ±10°. Both put sprite edges between device
// pixels, which is what made the art look soft no matter what
// `shapeRendering: crispEdges` claimed. Neither shows up in a rect count, so
// this asserts on what the scene actually puts in the DOM.

const me = { id: "me", avatar: DEFAULT_AVATAR };
const partner = { id: "them", avatar: DEFAULT_AVATAR };

function renderScene(
  phase: GamePhase,
  focusProgress = 0,
  returning = 0,
  pets = false,
  worldId: WorldId = "forest",
  petStage: PetStage | null = "grown",
) {
  return render(
    <GameWorld
      worldId={worldId}
      phase={phase}
      focusProgress={focusProgress}
      returningProgress={returning}
      me={me}
      partner={partner}
      myPet={pets ? "cat" : null}
      partnerPet={pets ? "dog" : null}
      myPetStage={pets ? petStage : null}
      partnerPetStage={pets ? petStage : null}
      myName="ME"
      partnerName="THEM"
    />,
  );
}

/** The two absolutely-positioned character wrappers. */
function characterWrappers(container: HTMLElement) {
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>("div.absolute.z-20"),
  );
  expect(nodes.length).toBe(2);
  return nodes;
}

/**
 * The sprite drawn on a `w`x`h` map.
 *
 * Matched on the map's shape rather than on an exact viewBox string, because
 * the outline pass draws one cell outside the map and grows the viewBox to
 * match — an outlined sprite is its own size plus a one-cell border.
 */
function findSprite(container: HTMLElement, w: number, h: number) {
  const svg = Array.from(container.querySelectorAll("svg")).find((el) => {
    const [, , vw, vh] = (el.getAttribute("viewBox") ?? "").split(" ").map(Number);
    return (vw === w || vw === w + 2) && (vh === h || vh === h + 2);
  });
  expect(svg, `no sprite on a ${w}x${h} grid`).toBeTruthy();
  return svg!;
}

/** CSS px per art pixel, read off a sprite's own SVG. */
function density(container: HTMLElement, w: number, h: number) {
  const svg = findSprite(container, w, h);
  const cells = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
  return Number(svg.getAttribute("width")) / cells;
}

describe("character placement", () => {
  const cases: [GamePhase, number, number][] = [
    ["waiting", 0, 0],
    ["focus", 0.37, 0],
    ["celebration", 0, 0],
    ["break", 0, 0],
    ["returning", 0, 0.63],
  ];

  for (const [phase, focus, returning] of cases) {
    it(`places both characters on whole pixels during ${phase}`, () => {
      const { container } = renderScene(phase, focus, returning);
      for (const node of characterWrappers(container)) {
        // A percentage of an arbitrary container width is a fractional pixel
        // in every case that matters.
        expect(node.style.left).not.toMatch(/%/);
        expect(node.style.right).not.toMatch(/%/);
        const offsets = [
          node.style.left,
          node.style.right,
          ...Array.from(node.style.transform.matchAll(/\(([^)]*)\)/g)).map(
            (m) => m[1],
          ),
        ].filter(Boolean);
        for (const value of offsets) {
          expect(value, `${phase}: "${value}" is not a whole pixel`).toMatch(
            /^(0|-?\d+px)$/,
          );
        }
      }
    });
  }
});

describe("break overlay", () => {
  it("wiggles the controller without rotating it", () => {
    const { container } = renderScene("break");
    const shuffled = container.querySelector(".pixel-shuffle");
    expect(shuffled, "controller is not using the stepped shuffle").toBeTruthy();
    for (const el of container.querySelectorAll<HTMLElement>("*")) {
      expect(el.style.transform ?? "").not.toMatch(/rotate/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// One ground line, one art pixel.
// ─────────────────────────────────────────────────────────────────────────────

describe("ground line", () => {
  it("stands everything in the scene on the same line", () => {
    const { container } = renderScene("waiting");
    // Trees, hills and both characters anchor to the scene with a percentage
    // `bottom`. Any percentage that isn't GROUND is something standing off the
    // horizon — which is exactly what `calc(19% - 4px)` was.
    //
    // Pixel offsets are excluded on purpose: those are local nudges inside a
    // sprite's own wrapper (a contact shadow sitting one art pixel below its
    // owner), not claims about where the ground is.
    const anchors = new Set(
      Array.from(container.querySelectorAll<HTMLElement>("[style*='bottom']"))
        .map((el) => el.style.bottom)
        .filter((v) => v.includes("%")),
    );
    expect(anchors).toEqual(new Set([GROUND]));
  });

  it("anchors the character by its feet, not by its name tag", () => {
    // The tag has to be out of flow. As an ordinary child it is the wrapper's
    // bottom edge, so anchoring the wrapper to the ground lands the label on
    // the ground and leaves the character a label's height in the air.
    const { container } = renderScene("waiting");
    for (const wrapper of characterWrappers(container)) {
      const tag = wrapper.querySelector<HTMLElement>(".text-\\[10px\\]");
      expect(tag, "no name tag rendered").toBeTruthy();
      expect(tag!.className).toContain("absolute");
    }
  });
});

describe("one art pixel", () => {
  it("draws characters and their pets on the same pixel grid", () => {
    const { container } = renderScene("waiting", 0, 0, true);
    // Read the grids from the art rather than writing them out here — this
    // test hardcoded "0 0 10 11" and had to be edited when the pets were
    // redrawn, which is the kind of edit that quietly turns a check into a
    // restatement of whatever the code now does.
    expect(density(container, CHAR_W, CHAR_H)).toBe(ART_PX);
    expect(density(container, PET_W, PET_H)).toBe(ART_PX);
  });

  it("keeps pets to something like an animal's share of a person's height", () => {
    // Pets were 10x11 against a 16x24 person: 0.46x a human, where a cat is
    // about 0.25x. They only looked right while they were rendering at a
    // smaller pixel than the character, which is the mismatch ART_PX removed.
    //
    // Measured off the rendered SVGs, not off PET_H / CHAR_H. Those constants
    // describe the *maps*, and the outline pass adds a cell all round — which
    // is +8% on a 24-row person and +29% on a 7-row pet. Asserting on the maps
    // said 0.29 while the screen showed 0.35, i.e. the test was passing on a
    // number nobody could see.
    //
    // A guard, not an A/B.
    const { container } = renderScene("waiting", 0, 0, true);
    const height = (w: number, h: number) =>
      Number(findSprite(container, w, h).getAttribute("height"));
    const ratio = height(PET_W, PET_H) / height(CHAR_W, CHAR_H);
    expect(ratio).toBeLessThan(0.38);
    expect(ratio).toBeGreaterThan(0.2);
  });

  it("pins the grown ratio so a bounding-box change has to notice", () => {
    // A one-cell border costs a 7-row pet proportionally far more than a
    // 24-row person: turning outlines on moved this from 0.292 to 0.346, about
    // a third of the shrink #39 gave the pets, as a side effect of a change
    // about keylines. The outlines came back off, so it is 0.292 again — and
    // pinned, because the next thing to touch either box will move it too.
    expect((PET_H / CHAR_H).toFixed(3)).toBe("0.292");
  });

  it("grows by adding cells, never by scaling pixels, and stops short of half a person", () => {
    expect((PET_STAGE_SIZE.young.h / CHAR_H).toFixed(3)).toBe("0.208");
    expect((PET_STAGE_SIZE.full.h / CHAR_H).toFixed(3)).toBe("0.375");
    for (const stage of PET_STAGES) {
      const { container } = renderScene("waiting", 0, 0, true, "forest", stage);
      const { w, h } = PET_STAGE_SIZE[stage];
      expect(density(container, w, h)).toBe(ART_PX);
      const petPx = Number(findSprite(container, w, h).getAttribute("height"));
      const personPx = Number(
        findSprite(container, CHAR_W, CHAR_H).getAttribute("height"),
      );
      expect(petPx / personPx).toBeLessThan(0.38);
      expect(petPx / personPx).toBeGreaterThan(0.2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Contact shadows — what stops a sprite reading as hovering.
// ─────────────────────────────────────────────────────────────────────────────

describe("contact shadows", () => {
  /** Only the ones inside the character wrappers; the scenery's are elsewhere. */
  function characterShadows(container: HTMLElement) {
    return characterWrappers(container).flatMap((wrapper) =>
      Array.from(wrapper.querySelectorAll<HTMLElement>("div")).filter(
        (el) => el.style.opacity === "0.26" && el.style.height === `${ART_PX}px`,
      ),
    );
  }

  it("grounds both people and both pets", () => {
    // A/B — fails against the previous commit. `Grounded` has given every tree
    // a shadow since the backgrounds landed, but the characters are drawn from
    // GameWorld rather than WorldDecorations and so got none: two people
    // hovering in a scene where the scenery stands on the floor.
    const { container } = renderScene("waiting", 0, 0, true);
    expect(characterShadows(container).length).toBe(4);
  });

  it("still grounds a lone player with no pet", () => {
    const { container } = renderScene("waiting");
    expect(characterShadows(container).length).toBe(2);
  });

  it("keeps a shadow narrower than the sprite casting it", () => {
    // A guard, not an A/B. A shadow the full width of the sprite's bounding box
    // reads as a plinth rather than as contact — the avatar's box includes its
    // shoulders, and shoulders do not touch the ground.
    const { container } = renderScene("waiting", 0, 0, true);
    const widths = characterShadows(container).map((el) =>
      Number.parseInt(el.style.width, 10),
    );
    expect(widths.length).toBe(4);
    for (const w of widths) {
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThan(CHAR_W * ART_PX);
    }
  });
});

describe("waiting slot", () => {
  it("is a square the size of a person, not a dashed circle", () => {
    // A/B — against the previous commit this is a w-12 h-12 rounded-full
    // dashed ring with a "?" in the middle.
    const { container } = render(
      <GameWorld
        worldId="forest"
        phase="waiting"
        focusProgress={0}
        returningProgress={0}
        me={me}
        partner={null}
      />,
    );
    expect(container.textContent).toMatch(/WAITING/);
    expect(container.innerHTML).not.toMatch(/rounded-full/);
    const frame = Array.from(container.querySelectorAll("div")).find(
      (el) => el.textContent === "?" && el.children.length === 0,
    );
    expect(frame).toBeTruthy();
    expect(frame!.style.width).toBe(`${CHAR_W * ART_PX}px`);
    expect(frame!.style.height).toBe(`${CHAR_H * ART_PX}px`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The responsive art pixel.
//
// The scene box *is* the viewport here — GameWorld is `absolute inset-0` inside
// an h-dvh shell — so faking `clientWidth`/`clientHeight` is faking the device.
// jsdom reports 0 for both, which is why every test above sees the desktop
// pixel without asking for it.
// ─────────────────────────────────────────────────────────────────────────────

/** Renders `body` with every element measuring `w` x `h`. */
function atBox<T>(w: number, h: number, body: () => T): T {
  const proto = HTMLElement.prototype;
  const width = Object.getOwnPropertyDescriptor(proto, "clientWidth");
  const height = Object.getOwnPropertyDescriptor(proto, "clientHeight");
  Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => w });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => h });
  try {
    return body();
  } finally {
    if (width) Object.defineProperty(proto, "clientWidth", width);
    else delete (proto as unknown as Record<string, unknown>).clientWidth;
    if (height) Object.defineProperty(proto, "clientHeight", height);
    else delete (proto as unknown as Record<string, unknown>).clientHeight;
  }
}

/** CSS px per art pixel for every sprite in the scene, scenery included. */
function allDensities(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll("svg"))
    .map((svg) => {
      const vb = svg.getAttribute("viewBox")?.split(/\s+/).map(Number);
      const width = Number(svg.getAttribute("width"));
      if (!vb || vb.length < 3 || !vb[2] || !width) return null;
      return width / vb[2];
    })
    .filter((d): d is number => d !== null);
}

describe("art pixel follows the screen", () => {
  const PHONE: [number, number] = [375, 667];
  const LANDSCAPE_PHONE: [number, number] = [852, 393];
  const DESKTOP: [number, number] = [1440, 900];

  it("draws a phone's whole scene at the compact pixel", () => {
    const { container } = atBox(...PHONE, () =>
      renderScene("waiting", 0, 0, true),
    );
    expect(density(container, CHAR_W, CHAR_H)).toBe(ART_PX_COMPACT);
    expect(density(container, PET_W, PET_H)).toBe(ART_PX_COMPACT);
  });

  it("draws a desktop's whole scene at the full pixel", () => {
    const { container } = atBox(...DESKTOP, () =>
      renderScene("waiting", 0, 0, true),
    );
    expect(density(container, CHAR_W, CHAR_H)).toBe(ART_PX);
    expect(density(container, PET_W, PET_H)).toBe(ART_PX);
  });

  /**
   * The invariant that actually matters, and the one a per-sprite change
   * would break: shrinking the characters while the scenery stays at 3 is
   * two pixel grids in one frame — the mismatch PR #37 spent twelve commits
   * removing. So this asserts on the *set*, not on the characters.
   */
  for (const [what, box, expected] of [
    ["phone", PHONE, ART_PX_COMPACT],
    ["landscape phone", LANDSCAPE_PHONE, ART_PX_COMPACT],
    ["desktop", DESKTOP, ART_PX],
  ] as const) {
    it(`gives a ${what} exactly one density, and it is ${expected}`, () => {
      const { container } = atBox(box[0], box[1], () =>
        renderScene("focus", 0.5, 0, true),
      );
      expect(new Set(allDensities(container))).toEqual(new Set([expected]));
    });
  }

  /**
   * A landscape phone is *wider* than an iPad is tall, so this is the case a
   * width-only rule gets backwards — and it is the one the HUD's own
   * max-height query already exists for.
   */
  it("shrinks for a landscape phone, which is wide but out of vertical room", () => {
    const { container } = atBox(...LANDSCAPE_PHONE, () =>
      renderScene("waiting", 0, 0, true),
    );
    expect(density(container, CHAR_W, CHAR_H)).toBe(ART_PX_COMPACT);
  });

  it("keeps the contact shadow on the same pixel as the sprite it sits under", () => {
    const { container } = atBox(...PHONE, () =>
      renderScene("waiting", 0, 0, true),
    );
    const shadows = Array.from(
      container.querySelectorAll<HTMLElement>("div.absolute"),
    ).filter((el) => el.style.opacity === "0.26");
    expect(shadows.length).toBeGreaterThan(0);
    for (const s of shadows) {
      expect(s.style.height).toBe(`${ART_PX_COMPACT}px`);
    }
  });

  /**
   * An unmeasured box is not a small box. This is what every other test in
   * this file relies on, so it is worth stating once rather than leaving as
   * an accident of jsdom.
   */
  it("draws an unmeasured box at the full pixel, not the compact one", () => {
    const { container } = renderScene("waiting", 0, 0, true);
    expect(density(container, CHAR_W, CHAR_H)).toBe(ART_PX);
  });
});

/**
 * The break prop is the one sprite in the scene deliberately drawn a step above
 * the scene's own pixel, and this pins that rather than leaving it to be
 * rediscovered as a defect.
 *
 * The mismatch predates the responsive pixel — a hardcoded `scale={4}` against
 * a scene at 3. Both fixes were reviewed with the owner on 2026-09-14 and
 * rejected on looks: dropping to `artPx` shrinks an approved desktop visual by
 * 25%, and redrawing the maps at more cells came out worse than the current
 * art. It is a centred focal prop on a break screen, not part of the world, so
 * the extra resolution competes with nothing the eye is comparing it against.
 *
 * What must hold is the *relationship*: the prop tracks the scene's pixel at
 * both stops instead of sitting on a literal. Celebration confetti, by
 * contrast, is part of the scene and never out-resolves the characters.
 */
describe("the break prop tracks the scene, one step above it", () => {
  function spriteScales(container: HTMLElement) {
    return allDensities(container);
  }

  it("keeps the break prop one step above the scene, on both screens", () => {
    const desktop = atBox(1440, 900, () => renderScene("break")).container;
    expect(Math.max(...spriteScales(desktop))).toBe(ART_PX + 1);

    const phone = atBox(375, 667, () => renderScene("break")).container;
    expect(Math.max(...spriteScales(phone))).toBe(ART_PX_COMPACT + 1);
  });

  it("never draws celebration confetti above the scene's own pixel", () => {
    for (const [w, h, expected] of [
      [1440, 900, ART_PX],
      [375, 667, ART_PX_COMPACT],
    ] as const) {
      const { container } = atBox(w, h, () => renderScene("celebration"));
      // Confetti comes in two depths; neither may out-resolve the characters.
      expect(Math.max(...spriteScales(container))).toBe(expected);
      expect(Math.min(...spriteScales(container))).toBeGreaterThanOrEqual(1);
    }
  });
});
