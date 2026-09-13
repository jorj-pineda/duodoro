// ─────────────────────────────────────────────────────────────────────────────
// Character maps — the avatar as layered string maps.
//
// This was ~90 hand-placed `<rect x= y= width= height=>` elements with the
// coordinates inline in JSX. That shape works exactly once: it cannot be
// palette-swapped, outlined, blinked, or given a second idle frame without
// somebody editing numbers by hand and hoping. Everything below is a picture
// you can read, which is the point — the eyes are where the eyes look.
//
// Canvas is 16 x 24, unchanged. The whole scene is anchored to it: GROUND, the
// name tag, MEET_HALF_WIDTH in useCharacterPosition. Redrawing at a different
// size is a separate change from redrawing.
//
// ── The key alphabet ────────────────────────────────────────────────────────
// Every layer uses these, so compositing is "last non-transparent wins" and no
// two layers can disagree about what a key means.
//
//   S skin          s skin in shadow      B cheek
//   H hair          h hair in shadow
//   O outfit        o outfit in shadow    P trousers      F shoes
//   E eye           W eye highlight       e lowered lid
// ─────────────────────────────────────────────────────────────────────────────

import type { PixelMap, PixelPalette } from "@/components/PixelSprite";
import { overlay, place } from "./pixelMap";
import { shade, flush, blend, AVATAR_INK } from "./palette";
import type { AvatarConfig, EyeStyle, HairStyle } from "./avatarData";

export const CHAR_W = 16;
export const CHAR_H = 24;

const at = (top: number, block: readonly string[]) =>
  place(top, block, CHAR_H, CHAR_W);

// ── Hair behind the head ────────────────────────────────────────────────────
// Only 'long' has any. The side drapes are what actually distinguish it from
// 'bob' — the two share a fringe, which is a reasonable design and was once
// mistaken for a duplication bug.

const HAIR_BACK: Record<HairStyle, PixelMap | null> = {
  long: at(4, [
    ".HH..........HH.",
    ".HH..........HH.",
    ".HH..........HH.",
    ".HH..........HH.",
    ".HH..........HH.",
    ".HH..........HH.",
    ".Hh..........hH.",
    ".Hh..........hH.",
    ".hh..........hh.",
  ]),
  bob: null,
  mohawk: null,
  spiky: null,
  bald: null,
};

// ── Torso ───────────────────────────────────────────────────────────────────
// Constant across every pose; arms and legs are the parts that move.

const TORSO = at(12, [
  "....OOooooOO....",
  "....OOOOOOOO....",
  "....OOOOOOOO....",
  "....OOOOOOOO....",
  "....OOOOOOOO....",
  "....OOOOOOOo....",
]);

// ── Arms ────────────────────────────────────────────────────────────────────
// A sleeve cap in outfit colour and a forearm in skin. The walk drops one arm
// by a row and then the other, which is the whole arm swing — at 16 px wide
// there is no room for an arm to travel further than one pixel without leaving
// the body.

const ARM_BLOCK = [
  ".OOO........OOO.",
  ".OOO........OOO.",
  ".SSS........SSS.",
  ".SSS........SSS.",
  ".sss........sss.",
];

const armsAt = (leftTop: number, rightTop: number): PixelMap =>
  overlay(
    at(leftTop, ARM_BLOCK.map((row) => row.slice(0, 8) + "........")),
    at(rightTop, ARM_BLOCK.map((row) => "........" + row.slice(8))),
  );

const ARMS = {
  neutral: armsAt(12, 12),
  leftDown: armsAt(13, 12),
  rightDown: armsAt(12, 13),
  /** Sitting: both arms drop to rest beside the hips. */
  sit: armsAt(14, 14),
} as const;

// ── Legs ────────────────────────────────────────────────────────────────────

const LEGS_TOGETHER = at(18, [
  "....PPP..PPP....",
  "....PPP..PPP....",
  "....PPP..PPP....",
  "....PPP..PPP....",
  "....PPP..PPP....",
  "...FFFF..FFFF...",
]);

// The stride. Splaying from the hip rather than the knee — the first version
// stepped out two pixels a row and came out bow-legged, which at 16 px wide
// reads as a stance rather than a step.
const LEGS_APART = at(18, [
  "....PPP..PPP....",
  "....PPP..PPP....",
  "...PPP....PPP...",
  "...PPP....PPP...",
  "..PPP......PPP..",
  ".FFFF......FFFF.",
]);

// Hips on row 18, so there is no gap between the bottom of the torso and the
// top of the legs. There was one at first: the torso ends at 17, and starting
// the legs at 19 left the body floating a pixel above them.
const LEGS_SIT = at(18, [
  "...PPPPPPPPPP...",
  "..PPPPP..PPPPP..",
  "..PPPPP..PPPPP..",
  "..PPPPP..PPPPP..",
  "..PPPP....PPPP..",
  "..FFFF....FFFF..",
]);

// ── Head ────────────────────────────────────────────────────────────────────
// Neck, face, a shaded jaw, and cheeks. The cheeks are part of the face rather
// than a translucent mark laid over it, so they are one flat colour derived
// from the skin — see `flush` in palette.ts.

const HEAD = at(3, [
  "...SSSSSSSSSS...",
  "...SSSSSSSSSS...",
  "...SSSSSSSSSS...",
  "...SSSSSSSSSS...",
  "...SSSSSSSSSS...",
  "...BBSSSSSSBB...",
  "...SSSSSSSSSS...",
  "...ssssssssss...",
  "......SSSS......",
]);

// ── Eyes ────────────────────────────────────────────────────────────────────
// Two frames each. Nothing in this sprite used to change its own pixels — the
// idle animation translated the whole thing up three pixels — which is what
// made scenes read as posed dolls rather than as people standing still.

interface EyeFrames {
  open: PixelMap;
  shut: PixelMap;
}

const EYES: Record<EyeStyle, EyeFrames> = {
  normal: {
    open: at(6, ["....WE....WE....", "....EE....EE...."]),
    shut: at(7, ["....EE....EE...."]),
  },
  anime: {
    open: at(5, [
      "....WEE..WEE....",
      "....EEE..EEE....",
      "....EEE..EEE....",
    ]),
    shut: at(7, ["....EEE..EEE...."]),
  },
  sleepy: {
    // Already half-lidded, so the "open" frame carries the lowered lid and the
    // blink just finishes the job.
    open: at(6, ["....eee..eee....", "....EEE..EEE...."]),
    shut: at(7, ["....EEE..EEE...."]),
  },
};

// ── Hair in front ───────────────────────────────────────────────────────────

const HAIR_FRONT: Record<HairStyle, PixelMap | null> = {
  bob: at(0, [
    "...HHHHHHHHHH...",
    "...HHHHHHHHHH...",
    "..HHHHHHHHHHHH..",
    "..HhhhhhhhhhhH..",
    "..H..........H..",
  ]),
  long: at(0, [
    "...HHHHHHHHHH...",
    "...HHHHHHHHHH...",
    "..HHHHHHHHHHHH..",
    "..HhhhhhhhhhhH..",
    "..H..........H..",
  ]),
  mohawk: at(0, [
    ".......HH.......",
    ".......HH.......",
    "......HHHH......",
    ".....hHHHHh.....",
    ".......HH.......",
    ".......hh.......",
  ]),
  spiky: at(0, [
    "....h..hh..h....",
    "....H..HH..H....",
    "....HH.HH.HH....",
    "...HHHHHHHHHH...",
    "...hhhhhhhhhh...",
  ]),
  bald: null,
};

// ── Poses ───────────────────────────────────────────────────────────────────

export type CharacterPose =
  | "stand"
  | "walk0"
  | "walk1"
  | "walk2"
  | "walk3"
  | "sit";

const POSES: Record<CharacterPose, { arms: PixelMap; legs: PixelMap }> = {
  stand: { arms: ARMS.neutral, legs: LEGS_TOGETHER },
  // Contact, passing, contact, passing — the arm that drops alternates so the
  // cycle reads as a stride rather than a hop.
  walk0: { arms: ARMS.leftDown, legs: LEGS_APART },
  walk1: { arms: ARMS.neutral, legs: LEGS_TOGETHER },
  walk2: { arms: ARMS.rightDown, legs: LEGS_APART },
  walk3: { arms: ARMS.neutral, legs: LEGS_TOGETHER },
  sit: { arms: ARMS.sit, legs: LEGS_SIT },
};

export const WALK_POSES: CharacterPose[] = ["walk0", "walk1", "walk2", "walk3"];

/**
 * One frame of a character, composited back to front.
 *
 * The order is load-bearing: hair behind the body, then limbs, then the torso
 * over the sleeve caps, then the head over the neck, then eyes, then the
 * fringe over the forehead.
 */
export function characterMap(
  avatar: Pick<AvatarConfig, "hairStyle" | "eyeStyle">,
  pose: CharacterPose,
  blinking = false,
): PixelMap {
  const { arms, legs } = POSES[pose];
  const eyes = EYES[avatar.eyeStyle];
  return overlay(
    HAIR_BACK[avatar.hairStyle],
    arms,
    legs,
    TORSO,
    HEAD,
    blinking ? eyes.shut : eyes.open,
    HAIR_FRONT[avatar.hairStyle],
  );
}

/**
 * The palette for one avatar.
 *
 * Every shadow is derived rather than picked, so a recoloured character stays
 * lit the same way. The eye is not pure black: a black keyline on a dark hair
 * colour loses the eye entirely, and the world's own shadow hue keeps it
 * sitting in the same light as everything else.
 */
export function characterPalette(avatar: AvatarConfig): PixelPalette {
  const { skinColor, hairColor, outfitColor } = avatar;
  return {
    S: skinColor,
    s: shade(skinColor, 0.1),
    B: flush(skinColor),
    H: hairColor,
    h: shade(hairColor, 0.13),
    O: outfitColor,
    o: shade(outfitColor, 0.13),
    P: shade(outfitColor, 0.22),
    F: AVATAR_INK.shoes,
    E: AVATAR_INK.eye,
    W: AVATAR_INK.glint,
    e: blend(AVATAR_INK.eye, skinColor, 0.55),
  };
}
