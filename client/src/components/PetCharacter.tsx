"use client";
import { useEffect, useState } from "react";
import type { AnimState } from "./PixelCharacter";
import type { PetType } from "@/lib/types";
import { ART_PX } from "@/lib/scene";
import { PET_ART } from "@/lib/petMaps";
import type { PetStage } from "@/lib/petLevel";
import { petIdleMap } from "@/lib/petIdle";
import { usePetIdleMoment } from "@/hooks/usePetIdleMoment";
import PixelSprite from "./PixelSprite";

// ─────────────────────────────────────────────────────────────────────────────
// PetCharacter — the companion that walks with you.
//
// The art is in `lib/petMaps.ts`. `size` is one art pixel in CSS px, the same
// unit the character uses — pets used to render at 2 while the character
// rendered at 3, which is two pixel grids in one frame.
// ─────────────────────────────────────────────────────────────────────────────

interface PetCharacterProps {
  type: PetType;
  /** Missing on an older server; grown is today's art, so a client-first
   *  deploy does not shrink every pet to young. */
  stage?: PetStage | null;
  anim?: AnimState;
  facing?: "right" | "left";
  size?: number;
  outline?: string;
  idleMoments?: boolean;
}

const STEP_MS = 250;

export default function PetCharacter({
  type,
  stage = "grown",
  anim = "idle",
  facing = "right",
  size = ART_PX,
  outline,
  idleMoments = false,
}: PetCharacterProps) {
  const [walkFrame, setWalkFrame] = useState(0);
  const moment = usePetIdleMoment(idleMoments && (anim === "idle" || anim === "sit"), `${type}:${stage}:${anim}`);

  useEffect(() => {
    // See PixelCharacter: resetting the frame in the effect body was a
    // synchronous setState, so the resting frame is derived instead.
    if (anim !== "walk") return;
    const id = setInterval(() => setWalkFrame((f) => (f + 1) % 2), STEP_MS);
    return () => clearInterval(id);
  }, [anim]);

  const frame = anim === "walk" ? walkFrame : 0;
  const art = PET_ART[type][stage ?? "grown"];

  let animClass = "";
  if (anim === "idle") animClass = "pixel-idle";
  if (anim === "jump") animClass = "pixel-jump";
  if (anim === "float") animClass = "pixel-float";

  return (
    // Animate the wrapper so its vertical hop cannot override the sprite's
    // horizontal facing transform. Both retain the existing integer grid.
    <span className={`block ${animClass}`}>
      <PixelSprite
        map={moment === "rest" ? art.frames[frame] : petIdleMap(type, stage ?? "grown", moment)}
        palette={art.palette}
        scale={size}
        outline={outline}
        style={{ transform: facing === "left" ? "scaleX(-1)" : undefined }}
      />
    </span>
  );
}
