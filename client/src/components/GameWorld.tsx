"use client";
import { useRef, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import PixelCharacter from "./PixelCharacter";
import PetCharacter from "./PetCharacter";
import { getWorld, type WorldId, type AvatarConfig } from "@/lib/avatarData";
import type { PetType } from "@/lib/types";
import type { PetStage } from "@/lib/petLevel";
import {
  useCharacterPosition,
  useSceneBox,
} from "@/hooks/useCharacterPosition";
import PixelSprite from "./PixelSprite";
import {
  HEART,
  HEART_PALETTE,
  SPARKLE,
  SPARKLE_PALETTE,
  SPARKLE_BLUE_PALETTE,
  CONTROLLER,
  CONTROLLER_PALETTE,
} from "@/lib/uiSprites";
import { WorldDecor, CUP } from "./WorldDecorations";
import { CUP_PALETTE } from "@/lib/palette";
import ContactShadow from "./ContactShadow";
import type { PixelMap, PixelPalette } from "./PixelSprite";
import { GROUND, artPxFor } from "@/lib/scene";
import ScenePixel, { useArtPx } from "./SceneScale";
import { CHAR_W, CHAR_H } from "@/lib/characterMaps";

export type GamePhase =
  | "waiting"
  | "focus"
  | "celebration"
  | "break"
  | "returning";

interface PlayerInfo {
  id: string;
  avatar: AvatarConfig;
}

interface Props {
  worldId: WorldId;
  phase: GamePhase;
  /** 0–1: how far toward center the characters have walked */
  //random placement for test
  focusProgress: number;
  /** 0–1: how far through the returning animation (1 = back at start) */
  returningProgress: number;
  me: PlayerInfo;
  partner: PlayerInfo | null;
  myPet?: PetType | null;
  partnerPet?: PetType | null;
  myPetStage?: PetStage | null;
  partnerPetStage?: PetStage | null;
  myName?: string;
  partnerName?: string;
  /** Partner's socket dropped; server is holding their spot */
  partnerDisconnected?: boolean;
}

// Confetti, at two sizes for depth. `near`/`far` rather than 3 and 2 so the
// burst tracks the scene's pixel: on a phone a literal 3 would put particles
// *above* the characters' own density, which reads as debris from a different
// drawing. Desktop is unchanged — near is 3 and far is 2, exactly as drawn.
const CELEBRATION_SPRITES = [
  { map: HEART, palette: HEART_PALETTE, depth: "near" },
  { map: SPARKLE, palette: SPARKLE_PALETTE, depth: "near" },
  { map: HEART, palette: HEART_PALETTE, depth: "far" },
  { map: SPARKLE, palette: SPARKLE_BLUE_PALETTE, depth: "near" },
  { map: HEART, palette: HEART_PALETTE, depth: "near" },
  { map: SPARKLE, palette: SPARKLE_PALETTE, depth: "far" },
] as const;

function CelebrationOverlay() {
  const artPx = useArtPx();
  // Never below 1: a zero-scale sprite renders a 0x0 box, which is not a
  // smaller particle, it is a missing one.
  const far = Math.max(1, artPx - 1);
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {CELEBRATION_SPRITES.map((s, i) => (
        <motion.div
          key={i}
          className="absolute"
          initial={{ y: 60, x: `${15 + i * 14}%`, opacity: 0 }}
          animate={{ y: -40, opacity: [0, 1, 1, 0] }}
          transition={{
            duration: 1.8,
            delay: i * 0.25,
            repeat: Infinity,
            repeatDelay: 1,
          }}
        >
          <PixelSprite
            map={s.map}
            palette={s.palette}
            scale={s.depth === "near" ? artPx : far}
          />
        </motion.div>
      ))}
    </div>
  );
}

/** What the pair do on their break. A game controller in a coffee shop was
 *  always a bit odd; indoors worlds get something that belongs in the room. */
const BREAK_PROP: Record<
  WorldId,
  { map: PixelMap; palette: PixelPalette }
> = {
  forest: { map: CONTROLLER, palette: CONTROLLER_PALETTE },
  space: { map: CONTROLLER, palette: CONTROLLER_PALETTE },
  beach: { map: CONTROLLER, palette: CONTROLLER_PALETTE },
  city: { map: CONTROLLER, palette: CONTROLLER_PALETTE },
  mountain: { map: CONTROLLER, palette: CONTROLLER_PALETTE },
  library: { map: CUP, palette: CUP_PALETTE },
  cafe: { map: CUP, palette: CUP_PALETTE },
  grocery: { map: CUP, palette: CUP_PALETTE },
};

/**
 * A sprite standing on the ground plane, with the shadow that says so.
 *
 * `Grounded` has done this for the scenery since the backgrounds landed, so
 * every tree meets the ground and both people floated above it. The wrapper has
 * to be shrink-wrapped to the sprite: the shadow centres on it, and a span that
 * stretched would centre the shadow on the row instead of on the character.
 */
function Standing({
  shadow,
  children,
}: {
  shadow: number;
  children: ReactNode;
}) {
  return (
    <span className="relative inline-block">
      {children}
      <ContactShadow width={shadow} />
    </span>
  );
}

// Footprints, in art pixels. Deliberately narrower than the sprite's bounding
// box — the avatar is 16 cells wide and the pets 9, but a shadow is cast by
// what touches the ground, so it tracks the feet rather than the shoulders.
const CHARACTER_SHADOW = 10;

/** Footprints track the feet, not the bounding box, and the box grows. */
function petShadow(stage: PetStage | null | undefined): number {
  if (stage === "young") return 4;
  if (stage === "full") return 8;
  return 6;
}

function BreakOverlay({ worldId }: { worldId: WorldId }) {
  const prop = BREAK_PROP[worldId] ?? BREAK_PROP.forest;
  // One step above the scene's pixel, which is the relationship this overlay
  // has always had: it was a hardcoded scale={4} against a scene drawn at 3.
  //
  // That is a genuine density mismatch and it predates this change — nothing
  // caught it because the scene's density tests only ever looked at the
  // character and pet maps. It is *not* silently fixed here: putting the prop
  // on artPx would shrink an approved desktop visual by 25% inside a PR about
  // small screens. Written up in ROADMAP instead, where the two real options
  // are a decision (drop to artPx) or a redraw (more cells at artPx).
  const artPx = useArtPx() + 1;
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      {/* .pixel-shuffle, not a rotation: the controller used to swing ±10°,
          which resampled every edge of the sprite for the whole break. */}
      <div className="mt-4 pixel-shuffle">
        <PixelSprite map={prop.map} palette={prop.palette} scale={artPx} />
      </div>
    </div>
  );
}

export default function GameWorld({
  worldId,
  phase,
  focusProgress,
  returningProgress,
  me,
  partner,
  myPet,
  partnerPet,
  myPetStage,
  partnerPetStage,
  myName,
  partnerName,
  partnerDisconnected,
}: Props) {
  const world = getWorld(worldId);
  // Characters are placed in whole pixels off the scene's own width, so the
  // scene has to be measured. GameWorld only ever mounts client-side (DuoTimer
  // starts on the loading screen), so the layout effect inside runs before the
  // first paint of this component and there is no unmeasured frame.
  const sceneRef = useRef<HTMLDivElement>(null);
  const { width: sceneWidth, height: sceneHeight } = useSceneBox(sceneRef);
  // One art pixel for everything in this scene, small screens included. The
  // provider below is what stops a sprite deeper in the tree drawing at the
  // other stop; nothing in here reads ART_PX directly any more.
  const artPx = artPxFor(sceneWidth, sceneHeight);
  const { myX, partnerX, myAnim, partnerAnim } = useCharacterPosition(
    phase,
    focusProgress,
    returningProgress,
    sceneWidth,
  );

  return (
    <ScenePixel value={artPx}>
    <div ref={sceneRef} className="relative w-full h-full">
      {/* Sky */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ background: world.skyGradient }}
      >
        <WorldDecor worldId={worldId} sceneWidth={sceneWidth} />
      </div>

      {/* Ground */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{
          height: GROUND,
          backgroundColor: world.groundColor,
        }}
      >
        {/* Ground texture strip */}
        <div
          className="absolute top-0 left-0 right-0 h-2"
          style={{ backgroundColor: world.groundPatternColor }}
        />
        {/* Ground dots / texture */}
        {worldId === "forest" && (
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: `radial-gradient(circle, ${world.groundPatternColor} 1px, transparent 1px)`,
              backgroundSize: "18px 14px",
            }}
          />
        )}
        {worldId === "space" && (
          /* Regolith, not a grid: scattered dust rather than scan lines. */
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage: `radial-gradient(circle, ${world.groundPatternColor} 1px, transparent 1px)`,
              backgroundSize: "9px 7px",
            }}
          />
        )}
        {worldId === "city" && (
          <div
            className="absolute inset-0 opacity-15"
            style={{
              backgroundImage: `repeating-linear-gradient(90deg, ${world.groundPatternColor} 0px, ${world.groundPatternColor} 2px, transparent 2px, transparent 20px)`,
            }}
          />
        )}
        {worldId === "mountain" && (
          /* Rock showing through snow. */
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: `radial-gradient(circle, ${world.groundPatternColor} 1px, transparent 1px)`,
              backgroundSize: "16px 12px",
            }}
          />
        )}
        {worldId === "library" && (
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: `repeating-linear-gradient(90deg, ${world.groundPatternColor} 0px, ${world.groundPatternColor} 3px, transparent 3px, transparent 18px)`,
            }}
          />
        )}
        {worldId === "grocery" && (
          /* Vinyl tile, which is the one floor everybody recognises. */
          <div
            className="absolute inset-0 opacity-45"
            style={{
              backgroundImage: `repeating-linear-gradient(90deg, ${world.groundPatternColor} 0 1px, transparent 1px 24px), repeating-linear-gradient(0deg, ${world.groundPatternColor} 0 1px, transparent 1px 18px)`,
            }}
          />
        )}
      </div>

      {/* Meeting heart marker */}
      <div className="absolute bottom-[17%] left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none">
        <motion.div
          animate={{
            scale: phase === "celebration" ? [1, 1.4, 1] : 1,
            opacity: phase === "focus" ? 0.4 : 0.9,
          }}
          transition={{
            duration: 0.8,
            repeat: phase === "celebration" ? Infinity : 0,
          }}
        >
          <PixelSprite map={HEART} palette={HEART_PALETTE} scale={artPx} />
        </motion.div>
        <div className="w-0.5 h-8 bg-white/20 mt-1" />
      </div>

      {/* Me (left side, walks right) */}
      {/* The name tag is out of flow on purpose: as an ordinary child it was
          the wrapper's bottom edge, so anchoring the wrapper to the ground put
          the label on the ground and held the character a label's height above
          it. That is what the `- 4px` was nudging at. */}
      <motion.div
        className="absolute z-20"
        style={{ bottom: GROUND, left: 0, x: myX }}
      >
        <div className="flex items-end gap-1">
          {myPet && (
            <Standing shadow={petShadow(myPetStage)}>
              <PetCharacter
                type={myPet}
                stage={myPetStage}
                anim={myAnim}
                facing="right"
                size={artPx}
              />
            </Standing>
          )}
          <Standing shadow={CHARACTER_SHADOW}>
            <PixelCharacter
              {...me.avatar}
              anim={myAnim}
              facing="right"
              size={artPx}
            />
          </Standing>
        </div>
        <div className="absolute top-full inset-x-0 mt-1 text-[10px] text-center font-bold text-white bg-black/50 rounded px-1 font-mono truncate max-w-[80px]">
          {myName ?? "YOU"}
        </div>
      </motion.div>

      {/* Partner (right side, walks left) */}
      {partner && (
        <motion.div
          key={partner.id}
          className="absolute z-20"
          style={{ bottom: GROUND, right: 0, x: partnerX }}
        >
          <div
            className={`flex items-end gap-1 transition-opacity duration-500 ${
              partnerDisconnected ? "opacity-40" : ""
            }`}
          >
            <Standing shadow={CHARACTER_SHADOW}>
              <PixelCharacter
                {...partner.avatar}
                anim={partnerDisconnected ? "idle" : partnerAnim}
                facing="left"
                size={artPx}
              />
            </Standing>
            {partnerPet && (
              <Standing shadow={petShadow(partnerPetStage)}>
                <PetCharacter
                  type={partnerPet}
                  stage={partnerPetStage}
                  anim={partnerDisconnected ? "idle" : partnerAnim}
                  facing="left"
                  size={artPx}
                />
              </Standing>
            )}
          </div>
          <div className="absolute top-full inset-x-0 mt-1 text-[10px] text-center font-bold text-white bg-black/50 rounded px-1 font-mono truncate max-w-[80px]">
            {partnerDisconnected ? (
              <span className="animate-pulse">RECONNECTING…</span>
            ) : (
              (partnerName ?? "THEM")
            )}
          </div>
        </motion.div>
      )}

      {/* Phase overlays */}
      <AnimatePresence>
        {phase === "celebration" && (
          <motion.div
            key="celebration"
            className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <CelebrationOverlay />
          </motion.div>
        )}
        {phase === "break" && (
          <motion.div
            key="break"
            className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <BreakOverlay worldId={worldId} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Waiting state — partner slot empty */}
      {!partner && phase === "waiting" && (
        <div
          className="absolute right-4 flex flex-col items-center opacity-40"
          style={{ bottom: GROUND }}
        >
          <div
            className="border-2 border-white/50 flex items-center justify-center font-display text-white text-xl leading-none"
            style={{ width: CHAR_W * artPx, height: CHAR_H * artPx }}
          >
            ?
          </div>
          <div className="text-[10px] text-center mt-1 font-bold text-white font-display">
            WAITING
          </div>
        </div>
      )}
    </div>
    </ScenePixel>
  );
}
