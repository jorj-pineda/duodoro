// ─────────────────────────────────────────────────────────────────────────────
// Shared UI pixel sprites — used by GameWorld overlays, the landing hero,
// and anywhere an emoji would break the pixel-art look. The colours live in
// `lib/palette.ts`, the one place art colour is written down.
// ─────────────────────────────────────────────────────────────────────────────

import type { PixelMap } from "@/components/PixelSprite";

export {
  CONTROLLER_PALETTE,
  HEART_PALETTE,
  SPARKLE_BLUE_PALETTE,
  SPARKLE_PALETTE,
} from "./palette";

export const HEART: PixelMap = [
  ".HH..HH.",
  "HhhHHHHH",
  "HHHHHHHH",
  ".HHHHHH.",
  "..HHHH..",
  "...HH...",
];

export const SPARKLE: PixelMap = [
  "..S..",
  ".SsS.",
  "SsssS",
  ".SsS.",
  "..S..",
];

export const CONTROLLER: PixelMap = [
  ".BBBBBBBBBB.",
  "BBBdBBBBbBBB",
  "BBdddBBaBbBB",
  "BBBdBBBBaBBB",
  "BBBBBBBBBBBB",
  ".BB......BB.",
];
