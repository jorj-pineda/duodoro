// ─────────────────────────────────────────────────────────────────────────────
// Pet maps — the companions as string maps, in three sizes.
//
// Growth is more cells at the same ART_PX, never a scale multiplier. A 9×7
// cat at size={4} is the same cat with bigger pixels, not a bigger cat. The
// three stages:
//
//   young  7×5   21×15 px   0.21× a person
//   grown  9×7   27×21 px   0.29× a person   ← today's art, unchanged
//   full   11×9  33×27 px   0.38× a person
//
// Stop at 0.38×: a companion taller than half its owner stops reading as a
// pet. The grown maps are the ones that shipped in #39; young and full are
// the same silhouettes with less or more room for the same tells (cat ears
// at the corners, dog ears down the sides, dragon horns and wings, rabbit
// ears above).
//
// ── What seven (or five, or nine) rows costs you ────────────────────────────
// Every pet is a head with a body under it, seen face-on. That is a choice:
// at this size the head is the only part with room for anything readable.
// Everything distinguishing therefore happens in the silhouette.
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
  grown: { w: 9, h: 7 },
  full: { w: 11, h: 9 },
};

/** Grown size, the one the rest of the scene was drawn against. */
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
  grown: { together: "..cc.cc..", apart: ".cc...cc." },
  full: { together: "...cc.cc...", apart: "..cc...cc.." },
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
        ".C.....C.",
        ".CCCCCCC.",
        ".CECCCEC.",
        ".CCCNCCC.",
        "..CCCCCcc",
        "..CCCCC.c",
      ],
      CAT_PALETTE,
    ),
    full: pet(
      "full",
      [
        ".C.......C.",
        ".CCCCCCCCC.",
        ".CCECCCECC.",
        ".CCCCCCCCC.",
        ".CCCCNCCCC.",
        "...CCCCCcc.",
        "...CCCCCc.c",
        "...CCCCC..c",
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
        "CC.....CC",
        "cCCCCCCCc",
        "cCECCCECc",
        ".CCMMMCC.",
        "..CCCCCc.",
        "..CCCCC..",
      ],
      DOG_PALETTE,
    ),
    full: pet(
      "full",
      [
        "CC.......CC",
        "cCCCCCCCCCc",
        "cCCECCCECCc",
        ".CCMMMMMCC.",
        ".CCCCCCCCC.",
        "..CCCCCCCc.",
        "..CCCCCC...",
        "..CCCCC....",
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
        "..c...c..",
        ".CCCCCCC.",
        ".CECCCEC.",
        ".CCCNCCC.",
        "cCCCCCCCc",
        "..CCCCC.c",
      ],
      DRAGON_PALETTE,
    ),
    full: pet(
      "full",
      [
        "..c.....c..",
        ".CCCCCCCCC.",
        ".CCECCCECC.",
        ".CCCCCCCCC.",
        ".CCCCNCCCC.",
        "cCCCCCCCCCc",
        "..CCCCCcc.c",
        "..CCCCC...c",
      ],
      DRAGON_PALETTE,
    ),
  },

  // Two rows of ear, which is most of what a rabbit is from the front. Full
  // gets a third so the ears scale with the rest of it; young keeps two and
  // drops the body, same sit-up as grown.
  rabbit: {
    young: pet(
      "young",
      ["..C.C..", "..C.C..", ".CENCE.", ".CCCWW."],
      RABBIT_PALETTE,
    ),
    grown: pet(
      "grown",
      [
        "...C.C...",
        "...C.C...",
        ".CCCCCCC.",
        ".CECCCEC.",
        ".CCCNCCC.",
        "..CCCCCWW",
      ],
      RABBIT_PALETTE,
    ),
    full: pet(
      "full",
      [
        "...C...C...",
        "...C...C...",
        "...C...C...",
        ".CCCCCCCCC.",
        ".CCECCCECC.",
        ".CCCCNCCCC.",
        "..CCCCCCC..",
        "..CCCCCWWW.",
      ],
      RABBIT_PALETTE,
    ),
  },
};
