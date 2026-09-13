"use client";
import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import type { AvatarConfig } from "@/lib/avatarData";
import { ART_PX } from "@/lib/scene";
import {
  characterMap,
  characterPalette,
  WALK_POSES,
  type CharacterPose,
} from "@/lib/characterMaps";
import PixelSprite from "./PixelSprite";

// ─────────────────────────────────────────────────────────────────────────────
// PixelCharacter — the avatar.
//
// The art lives in `lib/characterMaps.ts` as layered string maps; this file is
// only the timing and the pose choice. It used to be ~90 `<rect>` elements with
// their coordinates written into the JSX, which is why the character was the
// one sprite in the app that couldn't be outlined or blinked without somebody
// editing numbers by hand.
//
// `size` is one art pixel in CSS px. It defaults to ART_PX and every call site
// passes ART_PX — a character rendering at a different pixel size to the scene
// around it is the thing ART_PX exists to prevent, not a knob.
// ─────────────────────────────────────────────────────────────────────────────

export type AnimState = "idle" | "walk" | "jump" | "sit" | "float";

interface PixelCharacterProps extends AvatarConfig {
  anim?: AnimState;
  facing?: "right" | "left";
  size?: number;
  /**
   * Draw a keyline around the silhouette. Off by default; on the Space world a
   * dark-haired character genuinely disappears into the night sky.
   */
  outline?: string;
  className?: string;
}

const WALK_FRAME_MS = 180;

// Real blinks are quick and irregular. A fixed interval reads as a tic.
const BLINK_MIN_MS = 4000;
const BLINK_MAX_MS = 6500;
const BLINK_HOLD_MS = 130;

/**
 * True for the ~130 ms a blink lasts.
 *
 * Nothing in this sprite used to change its own pixels — `pixel-idle`
 * translates the whole thing up three px and back — so a scene of people
 * standing still read as a scene of dolls. A blink is the cheapest frame that
 * fixes that, and it costs one row of the map.
 */
function useBlink(enabled: boolean): boolean {
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    // No synchronous setState on the disabled path: that is a cascading
    // render, and it is why the walk frame is derived rather than reset here.
    if (!enabled) return;
    let hold: ReturnType<typeof setTimeout>;
    let next: ReturnType<typeof setTimeout>;
    const schedule = () => {
      next = setTimeout(
        () => {
          setBlinking(true);
          hold = setTimeout(() => {
            setBlinking(false);
            schedule();
          }, BLINK_HOLD_MS);
        },
        BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS),
      );
    };
    schedule();
    return () => {
      clearTimeout(hold);
      clearTimeout(next);
    };
  }, [enabled]);

  return enabled && blinking;
}

export default function PixelCharacter({
  skinColor,
  hairStyle,
  hairColor,
  eyeStyle,
  outfitColor,
  anim = "idle",
  facing = "right",
  size = ART_PX,
  outline,
  className,
}: PixelCharacterProps) {
  const reducedMotion = useReducedMotion();
  const [walkFrame, setWalkFrame] = useState(0);

  useEffect(() => {
    // Only run the cycle while walking. The not-walking case used to
    // setWalkFrame(0) synchronously here, which is a cascading render — the
    // resting frame is derived below instead.
    if (anim !== "walk") return;
    const id = setInterval(
      () => setWalkFrame((f) => (f + 1) % WALK_POSES.length),
      WALK_FRAME_MS,
    );
    return () => clearInterval(id);
  }, [anim]);

  const blinking = useBlink(!reducedMotion);

  const pose: CharacterPose =
    anim === "walk" ? WALK_POSES[walkFrame] : anim === "sit" ? "sit" : "stand";

  const map = useMemo(
    () => characterMap({ hairStyle, eyeStyle }, pose, blinking),
    [hairStyle, eyeStyle, pose, blinking],
  );

  const palette = useMemo(
    () =>
      characterPalette({
        skinColor,
        hairStyle,
        hairColor,
        eyeStyle,
        outfitColor,
      }),
    [skinColor, hairStyle, hairColor, eyeStyle, outfitColor],
  );

  let animClass = "";
  if (anim === "idle") animClass = "pixel-idle";
  if (anim === "jump") animClass = "pixel-jump";
  if (anim === "float") animClass = "pixel-float";
  if (anim === "sit") animClass = "pixel-idle"; // gentle idle while sitting

  return (
    <PixelSprite
      map={map}
      palette={palette}
      scale={size}
      outline={outline}
      className={`${animClass} ${className ?? ""}`}
      // scaleX(-1) is a whole-sprite mirror on integer bounds, so it is one of
      // the few transforms that doesn't resample the art.
      style={{ transform: facing === "left" ? "scaleX(-1)" : undefined }}
    />
  );
}
