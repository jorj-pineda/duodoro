// ─────────────────────────────────────────────────────────────────────────────
// Pet maps — the companions as string maps, in three sizes.
//
// Growth is more cells at the same ART_PX, never a scale multiplier. A 9×7
// cat at size={4} is the same cat with bigger pixels, not a bigger cat. The
// three stages:
//
//   young   7×5   21×15 px
//   grown  11×8   33×24 px
//   full   15×12  45×36 px
//
// The larger stages are redrawn with wider faces, fuller bodies, and longer
// ears/horns. Fully grown reaches half an avatar's height while every sprite
// keeps the scene's art pixel. Both walk stances remain planted on GROUND.
//
// ── The key alphabet ────────────────────────────────────────────────────────
//   C coat        c coat in shadow      M muzzle / marking
//   E eye         N nose                W tail fluff
// ─────────────────────────────────────────────────────────────────────────────

import type { PixelMap, PixelPalette } from "@/components/PixelSprite";
import { place } from "./pixelMap";
import {
  CAT_PALETTE,
  DOG_PALETTE,
  DRAGON_PALETTE,
  RABBIT_PALETTE,
} from "./palette";
import type { PetStage } from "./petLevel";
import type { PetType } from "./types";

export type { PetStage };

export const PET_STAGE_SIZE: Record<PetStage, { w: number; h: number }> = {
  young: { w: 7, h: 5 },
  grown: { w: 11, h: 8 },
  full: { w: 15, h: 12 },
};

/** Default grown size; rendering still uses the scene's shared art pixel. */
export const PET_W = PET_STAGE_SIZE.grown.w;
export const PET_H = PET_STAGE_SIZE.grown.h;

/**
 * Both walk frames plant both feet on the bottom row.
 *
 * A pet that lifts a foot clean off the map is indistinguishable from one whose
 * foot is being silently clipped — which is exactly what the cat and the rabbit
 * shipped with, each walking on one leg. So the step is a change of *stance*,
 * feet together and feet apart, and the bottom row is never empty.
 */
const FEET: Record<PetStage, { together: string; apart: string }> = {
  young: { together: ".cc.cc.", apart: "cc...cc" },
  grown: { together: "...cc.cc...", apart: "..cc...cc.." },
  full: { together: "....ccc.ccc....", apart: "...ccc...ccc..." },
};

interface PetArt {
  frames: [PixelMap, PixelMap];
  palette: PixelPalette;
}

/** Body rows plus the two foot stances, sized to the stage. */
function pet(
  stage: PetStage,
  body: readonly string[],
  palette: PixelPalette,
): PetArt {
  const { w, h } = PET_STAGE_SIZE[stage];
  const feet = FEET[stage];
  const frame = (feetRow: string) => place(0, [...body, feetRow], h, w);
  return { frames: [frame(feet.together), frame(feet.apart)], palette };
}

export const PET_ART: Record<PetType, Record<PetStage, PetArt>> = {
  cat: {
    // Pointed ears at the head's corners, tail curling out to one side.
    young: pet(
      "young",
      [".C...C.", ".CCCCC.", ".CENCE.", ".CCCCCc"],
      CAT_PALETTE,
    ),
    grown: pet(
      "grown",
      [
        ".C.......C.",
        ".CCCCCCCCC.",
        ".CCECCCECC.",
        ".CCCCNCCCC.",
        "...CCCCCcc.",
        "...CCCCC.c.",
        "...CCCCC.c.",
      ],
      CAT_PALETTE,
    ),
    full: pet(
      "full",
      [
        ".C...........C.",
        ".CCCCCCCCCCCCC.",
        ".CCCECCCCCECCC.",
        ".CCCCCCCCCCCCC.",
        ".CCCCCCNCCCCCC.",
        "....CCCCCCCcc..",
        "....CCCCCCCc.c.",
        "....CCCCCCC..c.",
        "....CCCCCCC..c.",
        "....CCCCCCC....",
        "....CCCCCCC....",
      ],
      CAT_PALETTE,
    ),
  },

  // Ears down the sides rather than above — that plus the muzzle is the whole
  // difference between this and the cat at these sizes.
  dog: {
    young: pet(
      "young",
      ["CC...CC", "cCECECc", ".CCMMC.", ".CCCCC."],
      DOG_PALETTE,
    ),
    grown: pet(
      "grown",
      [
        ".CC.....CC.",
        ".cCCCCCCCc.",
        ".cCECCCECc.",
        "..CCMMMCC..",
        "...CCCCCc..",
        "...CCCCC...",
        "...CCCCC...",
      ],
      DOG_PALETTE,
    ),
    full: pet(
      "full",
      [
        ".CC.........CC.",
        ".cCCCCCCCCCCCc.",
        ".cCCECCCCCECCc.",
        "..CCCMMMMMCCC..",
        "..CCCCCCCCCCC..",
        "...CCCCCCCcc...",
        "...CCCCCCC.c...",
        "...CCCCCCC.....",
        "....CCCCC......",
        "....CCCCC......",
        "....CCCCC......",
      ],
      DOG_PALETTE,
    ),
  },

  // Horns up, wings out at the shoulders, gold eyes.
  dragon: {
    young: pet(
      "young",
      [".c...c.", ".CCCCC.", ".CENCE.", "cCCCCCc"],
      DRAGON_PALETTE,
    ),
    grown: pet(
      "grown",
      [
        "...c...c...",
        "...c...c...",
        "..CCCCCCC..",
        "..CECCCEC..",
        "..CCCNCCC..",
        ".cCCCCCCCc.",
        "...CCCCC.c.",
      ],
      DRAGON_PALETTE,
    ),
    full: pet(
      "full",
      [
        "...cc.....cc...",
        "...cc.....cc...",
        ".CCCCCCCCCCCCC.",
        ".CCCECCCCCECCC.",
        ".CCCCCCNCCCCCC.",
        ".cCCCCCCCCCCCc.",
        ".ccCCCCCCCCCcc.",
        ".cccCCCCCCCccc.",
        "...CCCCCCCc....",
        "....CCCCCCC..c.",
        "....CCCCCCC..c.",
      ],
      DRAGON_PALETTE,
    ),
  },

  // Upright ears lengthen with each stage; young keeps two rows and grown/full
  // gain space for a face and seated body.
  rabbit: {
    young: pet(
      "young",
      ["..C.C..", "..C.C..", ".CENCE.", ".CCCWW."],
      RABBIT_PALETTE,
    ),
    grown: pet(
      "grown",
      [
        "....C.C....",
        "....C.C....",
        "....C.C....",
        "..CCCCCCC..",
        "..CECCCEC..",
        "..CCCNCCC..",
        "...CCCCCWW.",
      ],
      RABBIT_PALETTE,
    ),
    full: pet(
      "full",
      [
        "....CC...CC....",
        "....CC...CC....",
        "....CC...CC....",
        "....CC...CC....",
        "..CCCCCCCCCCC..",
        "..CCECCCCCECC..",
        "..CCCCCNCCCCC..",
        "..CCCCCCCCCCC..",
        "...CCCCCCCCC...",
        "...CCCCCCCWWW..",
        "....CCCCCCCWW..",
      ],
      RABBIT_PALETTE,
    ),
  },
};
