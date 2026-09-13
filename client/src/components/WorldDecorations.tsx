"use client";
import { useMemo } from "react";
import PixelSprite, { type PixelMap, type PixelPalette } from "./PixelSprite";
import { getWorld, HORIZON, type WorldId } from "@/lib/avatarData";
import { GROUND } from "@/lib/scene";
import { useArtPx } from "./SceneScale";
import { columnsFor, ridgeHeights } from "@/lib/terrain";
import Ridge from "./Ridge";
import Skyline from "./Skyline";
import Shelving from "./Shelving";
import ContactShadow from "./ContactShadow";
import {
  AISLE_SIGN_PALETTE,
  BARK,
  BATTEN_PALETTE,
  BOOKSHELF_PALETTE,
  BOOK_TONES,
  BUILDING_PALETTE,
  BULB_COLORS,
  CAFE_ROOM,
  CAKE_TONES,
  CHECKOUT_PALETTE,
  CLOUD_PALETTE,
  CRATE_PALETTE,
  CRATER_PALETTE,
  CUP_PALETTE,
  EMBER,
  FOLIAGE,
  FRIDGE_PALETTE,
  GLOW,
  GRASS,
  INK,
  LAMP_PALETTE,
  MACHINE_PALETTE,
  MENU_PALETTE,
  MINI_PLANET_PALETTE,
  MOUNTAIN_FRONT,
  PALM_PALETTE,
  PINE_PALETTE,
  PLANET_PALETTE,
  PRODUCT_TONES,
  SAND,
  SEA,
  SNOW,
  STONE,
  SUN_PALETTE,
  TABLE_PALETTE,
  UMBRELLA_PALETTE,
  WHITE,
  blend,
  hazedPalette,
  type Depth,
} from "@/lib/palette";

// ─────────────────────────────────────────────────────────────────────────────
// World Decorations — pixel-art scenery for each world.
//
// Every prop-less component here renders inside GameWorld's sky container
// (absolute inset-0, overflow-hidden). The ground plane is GROUND tall
// (lib/scene.ts), so anything "standing" is anchored there. Scenes are built
// from three layers for depth: far silhouettes → mid sprites → near sprites,
// plus slow ambient motion (drifting clouds, twinkling stars, rising steam).
// ─────────────────────────────────────────────────────────────────────────────

// ── Scale deviations — none left, and how they were paid off ────────────────
//
// This list used to be the debt. Every sprite here is on the scene's art pixel
// now (PR #37), and `WorldDecorations.test.tsx` asserts one density per world
// with an empty exemption list, so a new sprite that picks its own scale fails
// the suite instead of quietly reintroducing two pixel grids in one frame.
//
// It is kept because it records *how* they were paid off, which is the part
// that generalises: a sprite's apparent pixel size *is* its scale, so a 16-cell
// map rendered at 3px is a 48px mountain, not a small-pixelled 128px one.
// Keeping the on-screen size meant redrawing each map at more cells — never
// scaling the small map up. The before-and-after:
//
//   sprite          map      scale(s)      on-screen        cells @ ART_PX
//   MOUNTAIN        16x10    5, 6, 7, 8    80..128 wide     27x17 .. 43x27
//   BOOKSHELF       14x17    4             56x68            19x23
//   PALM            14x11    4             56x44            19x15
//   UMBRELLA        12x9     4             48x36            16x12
//   PINE            12x14    2, 3, 4       24..48 wide      8x9 .. 16x19
//   SUN             9x9      3, 4, 5       27..45           9x9 .. 15x15
//   MOON            8x8      4, 5          32..40           11x11 .. 13x13
//   PLANET          16x9     2, 4          32..64 wide      11x6 .. 21x12
//   CLOUD           12x4     2, 3          24..36 wide      8x3 .. 12x4
//   BUILDING_*      -        2, 3          -                already at/near 3
//   LAMP, TABLE     -        3             -                already at ART_PX
//
// MountainDecor alone used to render at 5, 6, 7 and 8 in a single frame, with
// the character beside it at 3. Mismatched pixel density is the clearest tell
// of amateur pixel art, which is why the guard is now an assertion rather than
// a list of exceptions.
//
// ── Sprite maps ─────────────────────────────────────────────────────────────

const CLOUD: PixelMap = [
  "...WWWWW....",
  ".WWWWWWWWW..",
  "WWWWWWWWWWWW",
  ".SWWWWWWWWS.",
];
const PINE: PixelMap = [
  ".....DD.....",
  "....DDDD....",
  "...DDDDDD...",
  "....MMMM....",
  "...MMMMMM...",
  "..MMMMMMMM..",
  "...LLLLLL...",
  "..LLLLLLLL..",
  ".LLLLLLLLLL.",
  "LLLLLLLLLLLL",
  ".....TT.....",
  ".....TT.....",
  ".....TT.....",
  "....TTTT....",
];
const SUN: PixelMap = [
  "...GGG...",
  "..GYYYG..",
  ".GYYYYYG.",
  "GYYYHYYYG",
  "GYYHHHYYG",
  "GYYYHYYYG",
  ".GYYYYYG.",
  "..GYYYG..",
  "...GGG...",
];
const MOON: PixelMap = [
  "..MMMM..",
  ".MMMmm..",
  "MMMm....",
  "MMm.....",
  "MMm.....",
  "MMMm....",
  ".MMMmm..",
  "..MMMM..",
];

// A ringed planet at ART_PX: 102x48px, where the old 16x9 map needed scale 4
// to reach 64x36 — i.e. it was only ever big by having bigger pixels. Lit limb
// upper right, terminator, banding, and the ring passing behind at the top and
// in front along the bottom, which is what sells it as a sphere.
const PLANET: PixelMap = [
  "................HH................",
  ".............PPPPHHHH.............",
  "............dpppppHHHH............",
  "...........ddpppppHHHHH...........",
  "..........ddddPPPPPHHHHH..........",
  ".......rrrdddddPPPPPHHHHrrr.......",
  "...rrrr...dddddpppppHHHH...rrrr...",
  ".rrrr....DDdddddpppppHHHH....rrrr.",
  ".RRRR....DDDdddddPPPPPHHH....RRRR.",
  "...RRRR...DDddddddPPPPHH...RRRR...",
  ".......RRRRRRRRdddpRRRRRRRR.......",
  "..........DDDDdddddppppp..........",
  "...........DDDddddddPPP...........",
  "............DDDdddddPP............",
  ".............DDDddddd.............",
  "................dd................",
];
const MINI_PLANET: PixelMap = [
  ".pppp.",
  "pppddp",
  "pppppp",
  "pddppp",
  "pppppp",
  ".pppp.",
];
const MOUNTAIN: PixelMap = [
  ".......SS.......",
  "......SSSS......",
  ".....SSSSSS.....",
  ".....MSSSSm.....",
  "....MMMSSmmm....",
  "...MMMMMmmmm....",
  "..MMMMMMmmmmm...",
  ".MMMMMMMmmmmmm..",
  "MMMMMMMMmmmmmmm.",
  "MMMMMMMMMmmmmmmm",
];
// A palm at ART_PX: 78x114px against a 48x72 person, where the old 14x11 map
// at scale 4 was 56x44 — a palm tree two thirds the height of the person under
// it. Fronds are arcs that stop before their tips trail off into single
// pixels, which is what a drooping frond does if you let the curve run.
const PALM: PixelMap = [
  ".......FFFF.......FFFF....",
  ".....ffFFFFFF...FFFFFFff..",
  "....ffff...FFF.FFF...ffff.",
  "...ff....FFFFFFFFFFF....ff",
  "...f....FFFFctTcFFFFF....f",
  ".......FFFFFFcT.FFFFFF....",
  ".......FFFFFtT...FFFFF....",
  "......ff.FF.tT....FF.ff...",
  "......f..F..tT.....F..f...",
  "............tT............",
  "............tT............",
  "............tT............",
  "...........tT.............",
  "...........tT.............",
  "...........tT.............",
  "...........tT.............",
  "...........tT.............",
  "...........tT.............",
  "..........tT..............",
  "..........tT..............",
  "..........tT..............",
  "..........tT..............",
  "..........tTT.............",
  "..........tTT.............",
  "..........tTT.............",
  "..........tTT.............",
  "..........tTT.............",
  ".........tTT..............",
  ".........tTT..............",
  ".........tTT..............",
  ".........tTT..............",
  ".........tTT..............",
  ".........tTT..............",
  ".........tTT..............",
  ".........tTT..............",
  ".........tTT..............",
  ".........tTT..............",
  ".........tTT..............",
];
const UMBRELLA: PixelMap = [
  "....RRRR....",
  "..RRRRRRRR..",
  ".RRWWRRWWRR.",
  "RWWRRRRRRWWR",
  ".....PP.....",
  ".....PP.....",
  ".....PP.....",
  ".....PP.....",
  ".....PP.....",
];
const BUILDING_SHORT: PixelMap = [
  "BBBBBBB",
  "ByBuByB",
  "BBBBBBB",
  "BuByBuB",
  "BBBBBBB",
  "ByByBuB",
  "BBBBBBB",
  "BuByByB",
  "BBBBBBB",
  "BBBBBBB",
];
const BOOKSHELF: PixelMap = [
  "FFFFFFFFFFFFFF",
  "F112233445566F",
  "F112233445566F",
  "F112233445566F",
  "FFFFFFFFFFFFFF",
  "F445566112233F",
  "F445566112233F",
  "F445566112233F",
  "FFFFFFFFFFFFFF",
  "F2233ff661144F",
  "F2233ff661144F",
  "F2233ff661144F",
  "FFFFFFFFFFFFFF",
  "F663311224455F",
  "F663311224455F",
  "F663311224455F",
  "FFFFFFFFFFFFFF",
];
const LAMP: PixelMap = [
  "....C....",
  "....C....",
  "....C....",
  "....C....",
  "..GGGGG..",
  ".GGGGGGG.",
  "..YYYYY..",
  "...YYY...",
];
export const CUP: PixelMap = [
  ".CCCCC..",
  ".CkkkCH.",
  ".CkkkCH.",
  ".CCCCC..",
  "..DDDD..",
];
const TABLE: PixelMap = [
  "TTTTTTTTTTTTTTTT",
  ".tt..........tt.",
  ".tt..........tt.",
  ".tt..........tt.",
  ".tt..........tt.",
];
// Espresso machine — the thing that makes a room read as a café rather than a
// brown wall with tables in it.
const MACHINE: PixelMap = [
  "MMMMMMMMMMMM",
  "MggMMggMMkkM",
  "MMMMMMMMMMMM",
  "MnnMMnnMMMMM",
  "MMMMMMMMMMMM",
  "DDDDDDDDDDDD",
];
// Menu board over the counter.
const MENU: PixelMap = [
  "FFFFFFFFFFFFFF",
  "F.cc..cccc...F",
  "F.cc..cc.....F",
  "F.cccc.ccc...F",
  "F............F",
  "F.cc.cc..cc..F",
  "F.cccccc.....F",
  "FFFFFFFFFFFFFF",
];
// Crater rim — lit on the far side, shadowed on the near, which is what makes
// a ring of pixels read as a hole rather than a disc.
const CRATER: PixelMap = [
  "..LLLLLL..",
  ".LddddddL.",
  "LdDDDDDDdL",
  "LdDDDDDDdL",
  ".LddddddL.",
  "..LLLLLL..",
];
// ── Grocery ────────────────────────────────────────────────────────────────

/** Chest freezer with a lit glass front. */
const FRIDGE: PixelMap = [
  "CCCCCCCCCCCCCCCC",
  "CggggggCCggggggC",
  "CgllllgCCgllllgC",
  "CgllllgCCgllllgC",
  "CgbbbbgCCgbbbbgC",
  "CgllllgCCgllllgC",
  "CgllllgCCgllllgC",
  "CgbbbbgCCgbbbbgC",
  "CgllllgCCgllllgC",
  "CggggggCCggggggC",
  "CCCCCCCCCCCCCCCC",
  "DDDDDDDDDDDDDDDD",
];
/** Produce crate — angled front, fruit heaped above the rim. */
const CRATE: PixelMap = [
  "..rrrrrrrrrr..",
  ".rrggrrggrrgr.",
  "rrggrrggrrggrr",
  "WWWWWWWWWWWWWW",
  "WwwWwwWwwWwwWW",
  "WWWWWWWWWWWWWW",
  "wwwwwwwwwwwwww",
];
/** Checkout: conveyor, register, and the little divider rail. */
const CHECKOUT: PixelMap = [
  "..........RRRR......",
  "..........RkkR......",
  "..........RRRR......",
  "CCCCCCCCCCCCCCCCCCCC",
  "CbbbbbbbbCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCC",
  "DDDDDDDDDDDDDDDDDDDD",
  "DDDDDDDDDDDDDDDDDDDD",
];
/** Hanging aisle sign. */
const AISLE_SIGN: PixelMap = [
  "....ss....",
  "SSSSSSSSSS",
  "SttSttSttS",
  "SSSSSSSSSS",
];
/** Fluorescent ceiling batten. */
const BATTEN: PixelMap = ["ffffffffffff", "FFFFFFFFFFFF"];

// A conifer at ART_PX is 60x111px against a 48x72 person — 1.54x human height.
// The old PINE was 48x56: shorter than the people standing under it, and with
// 33% bigger pixels. Boughs are tiered rather than one smooth triangle, and
// three of them are nicked on the left so the silhouette isn't perfectly
// regular — a symmetrical conifer reads as a christmas tree.
const PINE_TALL: PixelMap = [
  ".........MD.........",
  "........LMDD........",
  ".......LMMMDD.......",
  "......LMMMMDDD......",
  "........LMDD........",
  ".......LMMMDD.......",
  "......LMMMMDDD......",
  ".....LMMMMMDDDD.....",
  ".......LMMMDD.......",
  "......LMMMMDDD......",
  ".....LMMMMMDDDD.....",
  ".....MMMMMMDDDDD....",
  "......LMMMMDDD......",
  ".....LMMMMMDDDD.....",
  "....LMMMMMMDDDDD....",
  "...LMMMMMMMDDDDDD...",
  ".....LMMMMMDDDD.....",
  "....LMMMMMMDDDDD....",
  "...LMMMMMMMDDDDDD...",
  "...MMMMMMMMMDDDDDD..",
  "....LMMMMMMDDDDD....",
  "...LMMMMMMMDDDDDD...",
  "..LMMMMMMMMMDDDDDD..",
  ".LMMMMMMMMMMDDDDDDD.",
  "...LMMMMMMMDDDDDD...",
  "..LMMMMMMMMMDDDDDD..",
  ".LMMMMMMMMMMDDDDDDD.",
  "LMMMMMMMMMMMDDDDDDDD",
  "..LMMMMMMMMMDDDDDD..",
  ".LMMMMMMMMMMDDDDDDD.",
  "LMMMMMMMMMMMDDDDDDDD",
  ".MMMMMMMMMMMDDDDDDDD",
  "........tttT........",
  "........tttT........",
  ".......ttttTT.......",
  ".......ttttTT.......",
  "......tttttTTT......",
];
const PINE_TALL_PALETTE: PixelPalette = {
  L: FOLIAGE[4],
  M: FOLIAGE[2],
  D: FOLIAGE[1],
  t: BARK[2],
  T: BARK[1],
};

// Undergrowth. Its job is to break the line where trunks meet the ground, so
// the trees don't read as posted into a flat plane.
const BUSH: PixelMap = [
  "...LMM....",
  ".LMMMMDD..",
  "LMMMMMMDD.",
  "LMMMMMMDDD",
  ".MMMMMDDD.",
  "..MMMDDD..",
];
const BUSH_PALETTE: PixelPalette = { L: GRASS[3], M: GRASS[2], D: GRASS[1] };

// A spruce for the winter mountain: narrower and steeper than the forest pine
// (42x102 against the pine's 60x111), with snow settling on the outer edge of
// each bough where it would actually collect.
const SPRUCE: PixelMap = [
  "......MD......",
  ".....LMDD.....",
  "....LMMDDD....",
  ".....LMDD.....",
  "....LMMDDD....",
  "...SSMMDDss...",
  "....LMMDDD....",
  "...LMMMDDDD...",
  "..SSMMMDDDss..",
  "....LMMDDD....",
  "...LMMMDDDD...",
  "..LMMMMDDDDD..",
  ".SSMMMMMDDDss.",
  "...LMMMDDDD...",
  "..LMMMMDDDDD..",
  ".LMMMMMMDDDDD.",
  "SSMMMMMMDDDDss",
  "...MMMMDDDDD..",
  ".LMMMMMMDDDDD.",
  "LMMMMMMMDDDDDD",
  "SSMMMMMMDDDDss",
  ".LMMMMMMDDDDD.",
  "LMMMMMMMDDDDDD",
  "LMMMMMMMDDDDDD",
  "SSMMMMMMDDDDss",
  ".LMMMMMMDDDDD.",
  ".MMMMMMMDDDDDD",
  "LMMMMMMMDDDDDD",
  "LMMMMMMMDDDDDD",
  "SSMMMMMMDDDDss",
  "......ttT.....",
  "......ttT.....",
  ".....tttTT....",
  ".....tttTT....",
];
const SPRUCE_PALETTE: PixelPalette = {
  L: FOLIAGE[3],
  M: FOLIAGE[1],
  D: FOLIAGE[0],
  S: SNOW[3],
  s: SNOW[2],
  t: BARK[1],
  T: BARK[0],
};

// A boulder breaking through the snow, so the ground isn't one flat sheet.
const ROCK: PixelMap = [
  "..LLMM....",
  ".LLMMMMD..",
  "LLMMMMMDD.",
  "LMMMMMMDDD",
  "MMMMMMMDDD",
];
const ROCK_PALETTE: PixelPalette = { L: STONE[4], M: STONE[3], D: STONE[1] };


/** Keyline for a sprite at a given depth. The outline has to recede with
 *  everything else, or a far sprite reads as nearer than the ridge behind it. */
function keyline(sky: string, depth: Depth): string {
  return hazedPalette({ k: blend(FOLIAGE[0], INK, 0.4) }, sky, depth).k;
}

/** Every decor scene needs the measured scene width: terrain is generated to
 *  cover it, and sprite positions are rounded to whole pixels against it. */
interface DecorProps {
  sceneWidth: number;
}

// ── Shared layer helpers ────────────────────────────────────────────────────

/** A percentage of the scene, snapped to a whole pixel once it is measurable. */
function pin(pct: number | undefined, sceneWidth: number): string | undefined {
  if (pct === undefined) return undefined;
  if (sceneWidth <= 0) return `${pct}%`;
  return `${Math.round((sceneWidth * pct) / 100)}px`;
}


/** Deterministic star field; a third of the stars twinkle on a stagger. */
function Stars({
  count,
  color = WHITE,
  maxY = 60,
  baseOpacity = 0.55,
  sceneWidth = 0,
}: {
  count: number;
  color?: string;
  maxY?: number;
  baseOpacity?: number;
  /** A 1px star placed at a percentage is a 1px star straddling two device
   *  pixels — i.e. two half-lit greys where there should be one white dot. */
  sceneWidth?: number;
}) {
  const stars = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: (i * 37 + 11) % 100,
        y: (i * 53 + 7) % maxY,
        size: i % 3 === 0 ? 2 : 1,
        twinkle: i % 3 === 0,
        delay: (i % 5) * 0.7,
      })),
    [count, maxY],
  );
  return (
    <>
      {stars.map((s, i) => (
        <div
          key={i}
          className={`absolute ${s.twinkle ? "decor-twinkle" : ""}`}
          style={{
            left:
              sceneWidth > 0
                ? `${Math.round((sceneWidth * s.x) / 100)}px`
                : `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            backgroundColor: color,
            opacity: baseOpacity + (i % 4) * 0.1,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
    </>
  );
}

// No `scale` prop: nothing ever passed one, and an optional scale on a scene
// sprite is a way to end up with two pixel grids in one frame. It draws at the
// scene's art pixel like everything else.
function DriftingCloud({
  left,
  top,
  delay = 0,
  slow = false,
  opacity = 0.95,
}: {
  left: number;
  top: number;
  delay?: number;
  slow?: boolean;
  opacity?: number;
}) {
  const artPx = useArtPx();
  return (
    <div
      className={`absolute ${slow ? "decor-drift-slow" : "decor-drift"}`}
      style={{
        left: `${left}%`,
        top: `${top}%`,
        opacity,
        animationDelay: `${delay}s`,
      }}
    >
      <PixelSprite map={CLOUD} palette={CLOUD_PALETTE} scale={artPx} />
    </div>
  );
}

function Grounded({
  left,
  right,
  children,
  z = 0,
  shadow,
  sceneWidth = 0,
}: {
  left?: number;
  right?: number;
  children: React.ReactNode;
  z?: number;
  /** Measured scene width. A percentage offset lands on a fractional pixel and
   *  softens every edge in the sprite, same as it did for the characters. */
  sceneWidth?: number;
  /** Width of the contact shadow in art pixels. Without one a sprite hovers:
   *  nothing tells the eye where the object meets the plane it stands on. */
  shadow?: number;
}) {
  return (
    <div
      className="absolute"
      style={{
        left: pin(left, sceneWidth),
        right: pin(right, sceneWidth),
        bottom: GROUND,
        zIndex: z,
      }}
    >
      {children}
      {shadow !== undefined && <ContactShadow width={shadow} />}
    </div>
  );
}

function SteamPuffs({ left, bottom }: { left: string; bottom: string }) {
  return (
    <div className="absolute" style={{ left, bottom }}>
      {[0, 1].map((i) => (
        <div
          key={i}
          className="decor-steam absolute rounded-none bg-white/70"
          style={{
            width: 2,
            height: 2,
            left: i * 4 - 2,
            animationDelay: `${i * 1.3}s`,
          }}
        />
      ))}
    </div>
  );
}

// ── Forest — daytime, layered hills, drifting clouds, pine clusters ─────────

export function ForestDecor({ sceneWidth }: DecorProps) {
  const artPx = useArtPx();
  const sky = HORIZON.forest;
  const tree = (depth: Depth) => hazedPalette(PINE_TALL_PALETTE, sky, depth);
  const bush = (depth: Depth) => hazedPalette(BUSH_PALETTE, sky, depth);
  return (
    <>
      <div
        className="absolute right-[10%] top-[8%]"
        style={{ filter: `drop-shadow(0 0 12px ${GLOW.forestSun})` }}
      >
        <PixelSprite map={SUN} palette={SUN_PALETTE} scale={artPx} />
      </div>
      <DriftingCloud left={10} top={12} slow />
      <DriftingCloud left={38} top={7} delay={4} />
      <DriftingCloud left={64} top={17} delay={9} slow />
      <DriftingCloud left={84} top={26} delay={2} opacity={0.7} />

      {/* Three bands of hill. Each is the same green ramp pushed further
          toward the sky, so the depth is carried by contrast, not by size. */}
      <Ridge
        spec={{ seed: 11, base: 26, amplitude: 15, wavelength: 44 }}
        sceneWidth={sceneWidth}
        ramp={FOLIAGE}
        sky={sky}
        depth="far"
      />
      <Ridge
        spec={{ seed: 23, base: 16, amplitude: 11, wavelength: 30 }}
        sceneWidth={sceneWidth}
        ramp={FOLIAGE}
        sky={sky}
        depth="mid"
        zIndex={1}
      />
      <Ridge
        spec={{ seed: 37, base: 8, amplitude: 6, wavelength: 19, detail: 3 }}
        sceneWidth={sceneWidth}
        ramp={GRASS}
        sky={sky}
        depth="near"
        zIndex={2}
      />

      {/* A treeline, not four trees. Mid-depth trunks fill the band behind,
          near ones frame the edges where the characters don't walk. */}
      {[4, 11, 18, 25, 32].map((left) => (
        <Grounded key={`lm${left}`} left={left} z={3} sceneWidth={sceneWidth}>
          <PixelSprite map={PINE_TALL} palette={tree("mid")} scale={artPx} />
        </Grounded>
      ))}
      {[6, 13, 20, 27].map((right) => (
        <Grounded key={`rm${right}`} right={right} z={3} sceneWidth={sceneWidth}>
          <PixelSprite map={PINE_TALL} palette={tree("mid")} scale={artPx} />
        </Grounded>
      ))}
      {[-3, 8].map((left) => (
        <Grounded
          key={`ln${left}`}
          left={left}
          z={4}
          shadow={16}
          sceneWidth={sceneWidth}
        >
          <PixelSprite
            map={PINE_TALL}
            palette={tree("near")}
            scale={artPx}
            outline={keyline(sky, "near")}
          />
        </Grounded>
      ))}
      {[-2, 10].map((right) => (
        <Grounded
          key={`rn${right}`}
          right={right}
          z={4}
          shadow={16}
          sceneWidth={sceneWidth}
        >
          <PixelSprite
            map={PINE_TALL}
            palette={tree("near")}
            scale={artPx}
            outline={keyline(sky, "near")}
          />
        </Grounded>
      ))}

      {/* Undergrowth, to break the line where the trunks meet the ground. */}
      {[16, 29, 44].map((left) => (
        <Grounded key={`b${left}`} left={left} z={4} sceneWidth={sceneWidth}>
          <PixelSprite map={BUSH} palette={bush("near")} scale={artPx} />
        </Grounded>
      ))}
      {[22, 36].map((right) => (
        <Grounded key={`br${right}`} right={right} z={4} sceneWidth={sceneWidth}>
          <PixelSprite map={BUSH} palette={bush("near")} scale={artPx} />
        </Grounded>
      ))}
    </>
  );
}

// ── Space — nebulas, twinkling stars, ringed planet, shooting star ──────────

export function SpaceDecor({ sceneWidth }: DecorProps) {
  const artPx = useArtPx();
  const sky = HORIZON.space;
  const px = (pct: number) =>
    sceneWidth > 0 ? `${Math.round((sceneWidth * pct) / 100)}px` : `${pct}%`;
  return (
    <>
      <div
        className="absolute pointer-events-none"
        style={{
          left: "6%",
          top: "12%",
          width: 260,
          height: 190,
          background:
            `radial-gradient(ellipse at center, ${GLOW.spaceNebula}, transparent 70%)`,
        }}
      />
      <Stars count={54} maxY={78} sceneWidth={sceneWidth} />

      {/* The ringed planet used to sit at right-8% / top-8%, jammed into the
          corner. It hangs over the scene now, and it is twice the size. */}
      <div
        className="absolute"
        style={{
          left: px(58),
          top: "16%",
          filter: `drop-shadow(0 0 22px ${GLOW.spacePlanet})`,
        }}
      >
        <PixelSprite map={PLANET} palette={PLANET_PALETTE} scale={artPx} />
      </div>
      <div className="absolute left-[16%] top-[34%] opacity-80">
        <PixelSprite map={MINI_PLANET} palette={MINI_PLANET_PALETTE} scale={artPx} />
      </div>
      <div
        className="decor-shooting-star absolute left-[74%] top-[12%] bg-white"
        style={{ width: 10, height: 2 }}
      />

      {/* We are standing on the moon: a low regolith horizon with craters,
          rather than a purple field. */}
      <Ridge
        spec={{ seed: 13, base: 14, amplitude: 9, wavelength: 46, detail: 2 }}
        sceneWidth={sceneWidth}
        ramp={STONE}
        sky={sky}
        depth="mid"
      />
      <Ridge
        spec={{ seed: 29, base: 6, amplitude: 4, wavelength: 22, detail: 3 }}
        sceneWidth={sceneWidth}
        ramp={STONE}
        sky={sky}
        depth="near"
        zIndex={1}
      />
      {[9, 27, 46, 63, 82].map((left, i) => (
        <Grounded key={i} left={left} z={2} sceneWidth={sceneWidth}>
          <PixelSprite
            map={CRATER}
            palette={hazedPalette(CRATER_PALETTE, sky, i % 2 ? "near" : "mid")}
            scale={artPx}
          />
        </Grounded>
      ))}
    </>
  );
}

// ── Beach — sunset sun, ocean horizon bands, palm + umbrella ────────────────

/**
 * The sea, filling the right of the ground plane.
 *
 * Drawn above the ground band rather than behind it (GameWorld paints the band
 * after the decor), with a stepped shoreline so the waterline is pixel art
 * rather than a CSS diagonal. The partner spawns on this side and walks up out
 * of it, which needs no animation — the scene does the work.
 */
function Shore({ sceneWidth }: DecorProps) {
  const artPx = useArtPx();
  const columns = columnsFor(sceneWidth, artPx);
  const rows = 34;
  // Waterline x per row, wobbling as it comes toward the viewer.
  const edge = ridgeHeights({
    columns: rows,
    seed: 61,
    base: Math.round(columns * 0.42),
    amplitude: 7,
    wavelength: 9,
    detail: 2,
  });
  return (
    <svg
      viewBox={`0 0 ${columns} ${rows}`}
      width={columns * artPx}
      height={rows * artPx}
      className="absolute left-0 bottom-0 pointer-events-none"
      style={{ zIndex: 5, shapeRendering: "crispEdges", display: "block" }}
      aria-hidden="true"
    >
      {Array.from({ length: rows }, (_, y) => {
        const x = edge[y];
        return (
          <g key={y}>
            <rect x={x} y={y} width={columns - x} height={1} fill={SEA.water} />
            {/* Foam at the waterline, and a second line of it further out. */}
            <rect x={x} y={y} width={2} height={1} fill={SEA.foam} />
            {y % 5 === 2 && (
              <rect x={x + 6} y={y} width={9} height={1} fill={SEA.ripple} />
            )}
            {y % 7 === 4 && (
              <rect x={x + 18} y={y} width={13} height={1} fill={SEA.ripple} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function BeachDecor({ sceneWidth }: DecorProps) {
  const artPx = useArtPx();
  const sky = HORIZON.beach;
  const palm = (depth: Depth) => hazedPalette(PALM_PALETTE, sky, depth);
  return (
    <>
      <div
        className="absolute left-[8%] top-[6%]"
        style={{ filter: `drop-shadow(0 0 18px ${GLOW.beachSun})` }}
      >
        <PixelSprite map={SUN} palette={SUN_PALETTE} scale={artPx} />
      </div>
      <DriftingCloud left={40} top={10} slow opacity={0.8} />
      <DriftingCloud left={70} top={20} delay={6} slow opacity={0.7} />

      {/* No ocean on the horizon any more — the water is beside you, not
          behind you. A low dune band gives the sand somewhere to start. */}
      <Ridge
        spec={{ seed: 77, base: 9, amplitude: 5, wavelength: 34, detail: 2 }}
        sceneWidth={sceneWidth}
        ramp={SAND}
        sky={sky}
        depth="mid"
      />

      <Shore sceneWidth={sceneWidth} />

      {/* Palms on the dry side, where the player starts. */}
      <Grounded left={2} z={6} shadow={14} sceneWidth={sceneWidth}>
        <PixelSprite
          map={PALM}
          palette={palm("near")}
          scale={artPx}
          outline={keyline(sky, "near")}
        />
      </Grounded>
      <Grounded left={14} z={6} sceneWidth={sceneWidth}>
        <PixelSprite map={PALM} palette={palm("mid")} scale={artPx} />
      </Grounded>
      <Grounded left={26} z={6} sceneWidth={sceneWidth}>
        <PixelSprite map={PALM} palette={palm("mid")} scale={artPx} />
      </Grounded>
      <Grounded left={8} z={6} shadow={16} sceneWidth={sceneWidth}>
        <PixelSprite
          map={UMBRELLA}
          palette={UMBRELLA_PALETTE}
          scale={artPx}
        />
      </Grounded>
    </>
  );
}

// ── City — far skyline, lit pixel towers, moon and sparse stars ─────────────

export function CityDecor({ sceneWidth }: DecorProps) {
  const artPx = useArtPx();
  const sky = HORIZON.city;
  return (
    <>
      <Stars count={14} maxY={34} baseOpacity={0.4} sceneWidth={sceneWidth} />
      <div
        className="absolute left-[10%] top-[6%]"
        style={{ filter: `drop-shadow(0 0 12px ${GLOW.cityMoon})` }}
      >
        <PixelSprite
          map={MOON}
          palette={{ M: SNOW[3], m: SNOW[2] }}
          scale={artPx}
        />
      </div>

      {/* Four bands of Manhattan. The near towers are 96–140 art pixels — four
          to six times the 24-pixel character — because the old city's tallest
          building was 48px against a 72px person. */}
      <Skyline
        spec={{
          seed: 5,
          minHeight: 34,
          maxHeight: 62,
          minWidth: 7,
          maxWidth: 14,
          gap: 1,
        }}
        sceneWidth={sceneWidth}
        ramp={STONE}
        glow={EMBER[2]}
        sky={sky}
        depth="far"
        showWindows={false}
      />
      <Skyline
        spec={{
          seed: 23,
          minHeight: 52,
          maxHeight: 92,
          minWidth: 9,
          maxWidth: 17,
          gap: 1,
          roofs: ["flat", "flat", "tank", "antenna"],
        }}
        sceneWidth={sceneWidth}
        ramp={STONE}
        glow={EMBER[2]}
        sky={sky}
        depth="mid"
        zIndex={1}
      />
      <Skyline
        spec={{
          seed: 41,
          minHeight: 78,
          maxHeight: 124,
          minWidth: 11,
          maxWidth: 20,
          gap: 2,
          roofs: ["flat", "tank", "antenna", "setback", "spire"],
        }}
        sceneWidth={sceneWidth}
        ramp={STONE}
        glow={EMBER[1]}
        sky={sky}
        depth="near"
        zIndex={2}
      />
      {/* Street level: low blocks the characters walk in front of. */}
      <Skyline
        spec={{
          seed: 67,
          minHeight: 26,
          maxHeight: 44,
          minWidth: 13,
          maxWidth: 24,
          gap: 3,
          roofs: ["flat", "tank"],
        }}
        sceneWidth={sceneWidth}
        ramp={STONE}
        glow={EMBER[0]}
        sky={sky}
        depth="front"
        zIndex={3}
      />
    </>
  );
}

// ── Mountain — layered ranges, clouds, alpine pines ─────────────────────────

export function MountainDecor({ sceneWidth }: DecorProps) {
  const artPx = useArtPx();
  const sky = HORIZON.mountain;
  const spruce = (depth: Depth) => hazedPalette(SPRUCE_PALETTE, sky, depth);
  return (
    <>
      <DriftingCloud left={8} top={16} slow opacity={0.85} />
      <DriftingCloud left={52} top={9} delay={5} slow opacity={0.8} />
      <DriftingCloud left={80} top={21} delay={10} opacity={0.75} />

      {/* Ranges, not hills. The far wall is 78 art pixels — 234px, more than
          three times the character — where the old one topped out at 80px
          total. Snow lines sit lower on the near ranges, which is backwards
          for altitude but right for reading: the near rock has to stay dark
          enough to hold the silhouette against the sky. */}
      <Ridge
        spec={{ seed: 5, base: 78, amplitude: 40, wavelength: 78, detail: 2 }}
        sceneWidth={sceneWidth}
        ramp={STONE}
        sky={sky}
        depth="far"
        capAbove={64}
        capColor={SNOW[3]}
      />
      <Ridge
        spec={{ seed: 19, base: 58, amplitude: 34, wavelength: 54, detail: 3 }}
        sceneWidth={sceneWidth}
        ramp={STONE}
        sky={sky}
        depth="mid"
        capAbove={52}
        capColor={SNOW[3]}
        zIndex={1}
      />
      <Ridge
        spec={{ seed: 31, base: 36, amplitude: 24, wavelength: 38, detail: 3 }}
        sceneWidth={sceneWidth}
        ramp={STONE}
        sky={sky}
        depth="near"
        capAbove={38}
        capColor={SNOW[2]}
        zIndex={2}
      />
      {/* Snowline foothills the treeline stands on. */}
      <Ridge
        spec={{ seed: 47, base: 9, amplitude: 6, wavelength: 20, detail: 3 }}
        sceneWidth={sceneWidth}
        ramp={SNOW}
        sky={sky}
        depth="front"
        zIndex={3}
      />

      {/* A treeline rather than two lonely trees. */}
      <Grounded left={3} z={4} sceneWidth={sceneWidth}>
        <PixelSprite map={SPRUCE} palette={spruce("mid")} scale={artPx} />
      </Grounded>
      <Grounded left={12} z={4} sceneWidth={sceneWidth}>
        <PixelSprite map={SPRUCE} palette={spruce("mid")} scale={artPx} />
      </Grounded>
      <Grounded left={21} z={4} sceneWidth={sceneWidth}>
        <PixelSprite map={SPRUCE} palette={spruce("mid")} scale={artPx} />
      </Grounded>
      <Grounded right={4} z={4} sceneWidth={sceneWidth}>
        <PixelSprite map={SPRUCE} palette={spruce("mid")} scale={artPx} />
      </Grounded>
      <Grounded right={13} z={4} sceneWidth={sceneWidth}>
        <PixelSprite map={SPRUCE} palette={spruce("mid")} scale={artPx} />
      </Grounded>
      <Grounded left={-2} z={5} shadow={12} sceneWidth={sceneWidth}>
        <PixelSprite
          map={SPRUCE}
          palette={spruce("near")}
          scale={artPx}
          outline={keyline(sky, "near")}
        />
      </Grounded>
      <Grounded right={-1} z={5} shadow={12} sceneWidth={sceneWidth}>
        <PixelSprite
          map={SPRUCE}
          palette={spruce("near")}
          scale={artPx}
          outline={keyline(sky, "near")}
        />
      </Grounded>

      {/* Rock breaking the snow so the ground isn't a flat sheet. */}
      <Grounded left={30} z={5} sceneWidth={sceneWidth}>
        <PixelSprite
          map={ROCK}
          palette={hazedPalette(ROCK_PALETTE, sky, "near")}
          scale={artPx}
        />
      </Grounded>
      <Grounded right={26} z={5} sceneWidth={sceneWidth}>
        <PixelSprite
          map={ROCK}
          palette={hazedPalette(ROCK_PALETTE, sky, "near")}
          scale={artPx}
        />
      </Grounded>
    </>
  );
}

// ── Library — shelves, hanging reading lamps, warm glow ─────────────────────

export function LibraryDecor({ sceneWidth }: DecorProps) {
  const artPx = useArtPx();
  const sky = HORIZON.library;
  return (
    <>
      {/* Warm pool of light from the hanging lamps. */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-none"
        style={{
          width: 420,
          height: 260,
          background:
            `radial-gradient(ellipse at top center, ${GLOW.libraryReading}, transparent 72%)`,
        }}
      />

      {/* A full wall of shelving, 66 art pixels — 198px, near three times the
          character — with the middle left clear so the pair aren't lost in it. */}
      <Shelving
        sceneWidth={sceneWidth}
        rows={66}
        spacing={11}
        seed={17}
        frame={BARK}
        tones={BOOK_TONES}
        sky={sky}
        depth="mid"
        bayWidth={34}
      />
      {/* A nearer run in front, shorter, so the room has depth rather than
          being one flat backdrop. */}
      <Shelving
        sceneWidth={sceneWidth}
        rows={40}
        spacing={10}
        seed={53}
        frame={BARK}
        tones={BOOK_TONES}
        sky={sky}
        depth="near"
        bayWidth={26}
        zIndex={2}
        clearFrom={Math.round(sceneWidth / artPx / 2) - 34}
        clearTo={Math.round(sceneWidth / artPx / 2) + 34}
      />

      {/* Hanging lamps, on their own flexes so they read as suspended. */}
      {[18, 38, 62, 82].map((left, i) => (
        <div
          key={i}
          className="absolute top-0"
          style={{
            left:
              sceneWidth > 0
                ? `${Math.round((sceneWidth * left) / 100)}px`
                : `${left}%`,
            filter: `drop-shadow(0 6px 14px ${GLOW.libraryLamp})`,
          }}
        >
          <PixelSprite map={LAMP} palette={LAMP_PALETTE} scale={artPx} />
        </div>
      ))}

      {/* Reading table under the middle gap. */}
      <Grounded left={40} z={3} sceneWidth={sceneWidth} shadow={20}>
        <div className="relative">
          <div className="absolute" style={{ bottom: "100%", left: 4 * artPx }}>
            <PixelSprite map={CUP} palette={CUP_PALETTE} scale={artPx} />
          </div>
          <PixelSprite map={TABLE} palette={TABLE_PALETTE} scale={artPx} />
        </div>
      </Grounded>
    </>
  );
}

// ── Café — string lights, tables with steaming cups ─────────────────────────

const BULB_SAG = [2, 8, 13, 16, 16, 13, 8, 2];

function StringLights() {
  return (
    <div className="absolute left-[6%] right-[6%] top-[6%] h-6">
      {BULB_SAG.map((sag, i) => (
        <div
          key={i}
          className="decor-twinkle absolute"
          style={{
            left: `${(i / (BULB_SAG.length - 1)) * 100}%`,
            top: sag,
            width: 4,
            height: 4,
            backgroundColor: BULB_COLORS[i % BULB_COLORS.length],
            boxShadow: `0 0 6px ${BULB_COLORS[i % BULB_COLORS.length]}`,
            animationDelay: `${(i % 4) * 0.9}s`,
            animationDuration: "4.5s",
          }}
        />
      ))}
    </div>
  );
}

function CafeTable({
  left,
  right,
  sceneWidth,
}: {
  left?: number;
  right?: number;
  sceneWidth: number;
}) {
  const artPx = useArtPx();
  return (
    <Grounded left={left} right={right} sceneWidth={sceneWidth} shadow={18}>
      <div className="relative">
        <div
          className="absolute"
          style={{ bottom: "100%", left: 4 * artPx }}
        >
          <PixelSprite map={CUP} palette={CUP_PALETTE} scale={artPx} />
        </div>
        <SteamPuffs
          left={`${6 * artPx}px`}
          bottom={`calc(100% + ${5 * artPx}px)`}
        />
        <PixelSprite map={TABLE} palette={TABLE_PALETTE} scale={artPx} />
      </div>
    </Grounded>
  );
}

export function CafeDecor({ sceneWidth }: DecorProps) {
  const artPx = useArtPx();
  const sky = HORIZON.cafe;
  const px = (pct: number) =>
    sceneWidth > 0
      ? `${Math.round((sceneWidth * pct) / 100)}px`
      : `${pct}%`;
  return (
    <>
      {/* We are indoors. The old scene had the sun in it. */}
      <div
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{
          height: "46%",
          background:
            `linear-gradient(180deg, ${CAFE_ROOM.ceilingTop} 0%, ${CAFE_ROOM.ceilingBottom} 70%, ${CAFE_ROOM.ceilingBottom} 100%)`,
        }}
      />
      {/* Wall panelling: boards and a rail, so the back isn't a flat wash. */}
      <div
        className="absolute inset-x-0 pointer-events-none"
        style={{
          bottom: GROUND,
          height: 13 * artPx,
          backgroundColor: CAFE_ROOM.wall,
          backgroundImage:
            `repeating-linear-gradient(90deg, ${CAFE_ROOM.wallStripe} 0 ` +
            3 * artPx +
            "px, transparent " +
            3 * artPx +
            "px " +
            6 * artPx +
            "px)",
        }}
      />
      <div
        className="absolute inset-x-0 pointer-events-none"
        style={{
          bottom: `calc(${GROUND} + ${13 * artPx}px)`,
          height: artPx,
          backgroundColor: CAFE_ROOM.rail,
        }}
      />

      <StringLights />

      {/* Back bar: shelves of cups and beans, the machine, and a menu board. */}
      <Shelving
        sceneWidth={sceneWidth}
        rows={26}
        spacing={9}
        seed={91}
        frame={BARK}
        tones={CAKE_TONES}
        sky={sky}
        depth="mid"
        bayWidth={22}
        bottom={`calc(${GROUND} + ${16 * artPx}px)`}
      />
      <div className="absolute" style={{ left: px(38), bottom: `calc(${GROUND} + ${16 * artPx}px)` }}>
        <PixelSprite map={MACHINE} palette={MACHINE_PALETTE} scale={artPx} />
      </div>
      <div className="absolute" style={{ left: px(56), bottom: `calc(${GROUND} + ${26 * artPx}px)` }}>
        <PixelSprite map={MENU} palette={MENU_PALETTE} scale={artPx} />
      </div>

      {/* Tables. Five of them, so it reads as a room with other people's
          seats in it rather than two props. */}
      <CafeTable sceneWidth={sceneWidth} left={4} />
      <CafeTable sceneWidth={sceneWidth} left={20} />
      <CafeTable sceneWidth={sceneWidth} right={20} />
      <CafeTable sceneWidth={sceneWidth} right={4} />
    </>
  );
}

// ── World decor dispatcher — one component per worldId ──────────────────────

export function WorldDecor({
  worldId,
  sceneWidth,
}: {
  worldId: WorldId;
  sceneWidth: number;
}) {
  switch (worldId) {
    case "forest":
      return <ForestDecor sceneWidth={sceneWidth} />;
    case "space":
      return <SpaceDecor sceneWidth={sceneWidth} />;
    case "beach":
      return <BeachDecor sceneWidth={sceneWidth} />;
    case "city":
      return <CityDecor sceneWidth={sceneWidth} />;
    case "mountain":
      return <MountainDecor sceneWidth={sceneWidth} />;
    case "library":
      return <LibraryDecor sceneWidth={sceneWidth} />;
    case "cafe":
      return <CafeDecor sceneWidth={sceneWidth} />;
    case "grocery":
      return <GroceryDecor sceneWidth={sceneWidth} />;
  }
}

// ── World thumbnail — mini scene preview for pickers ────────────────────────

const THUMB_SPRITES: Record<
  WorldId,
  { map: PixelMap; palette: PixelPalette; scale: number }
> = {
  forest: { map: PINE, palette: PINE_PALETTE, scale: 2 },
  space: { map: PLANET, palette: PLANET_PALETTE, scale: 2 },
  beach: { map: PALM, palette: PALM_PALETTE, scale: 2 },
  city: { map: BUILDING_SHORT, palette: BUILDING_PALETTE, scale: 2 },
  mountain: { map: MOUNTAIN, palette: MOUNTAIN_FRONT, scale: 2 },
  library: { map: BOOKSHELF, palette: BOOKSHELF_PALETTE, scale: 2 },
  cafe: { map: CUP, palette: CUP_PALETTE, scale: 3 },
  grocery: { map: CRATE, palette: CRATE_PALETTE, scale: 2 },
};

/** Tiny sky + ground + signature sprite; size it via the parent element. */
export function WorldThumbnail({ worldId }: { worldId: WorldId }) {
  const world = getWorld(worldId);
  const sprite = THUMB_SPRITES[worldId];
  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{ background: world.skyGradient }}
      aria-hidden="true"
    >
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{ height: "24%", backgroundColor: world.groundColor }}
      />
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{ bottom: "20%" }}
      >
        <PixelSprite
          map={sprite.map}
          palette={sprite.palette}
          scale={sprite.scale}
        />
      </div>
    </div>
  );
}

// ── Lo-fi — purple night, twin skylines, big moon ───────────────────────────

export function GroceryDecor({ sceneWidth }: DecorProps) {
  const artPx = useArtPx();
  const sky = HORIZON.grocery;
  const px = (pct: number) =>
    sceneWidth > 0 ? `${Math.round((sceneWidth * pct) / 100)}px` : `${pct}%`;
  const mid = Math.round(sceneWidth / artPx / 2);
  return (
    <>
      {/* Ceiling battens. Fluorescent strips are what a supermarket actually
          looks like from the inside, and they set the whole colour of the room. */}
      {[6, 20, 34, 48, 62, 76, 90].map((left, i) => (
        <div
          key={i}
          className="absolute"
          style={{ left: px(left), top: "4%", filter: `drop-shadow(0 4px 18px ${GLOW.groceryBatten})` }}
        >
          <PixelSprite map={BATTEN} palette={BATTEN_PALETTE} scale={artPx} />
        </div>
      ))}

      {/* Back wall: a long run of grocery shelving, floor to near the ceiling. */}
      <Shelving
        sceneWidth={sceneWidth}
        rows={58}
        spacing={9}
        seed={7}
        frame={STONE}
        tones={PRODUCT_TONES}
        sky={sky}
        depth="mid"
        bayWidth={28}
      />

      {/* Freezer run on the left of the back wall. */}
      {[3, 14].map((left, i) => (
        <Grounded key={i} left={left} z={1} sceneWidth={sceneWidth}>
          <PixelSprite
            map={FRIDGE}
            palette={hazedPalette(FRIDGE_PALETTE, sky, "mid")}
            scale={artPx}
          />
        </Grounded>
      ))}

      {/* Aisle signs hanging over the gondolas. */}
      {[22, 44, 66, 86].map((left, i) => (
        <div
          key={i}
          className="absolute"
          style={{ left: px(left), top: "17%" }}
        >
          <PixelSprite
            map={AISLE_SIGN}
            palette={AISLE_SIGN_PALETTE}
            scale={artPx}
          />
        </div>
      ))}

      {/* Gondolas: double-sided island shelving, the aisles you walk between.
          The middle is left open so the pair have somewhere to meet. */}
      <Shelving
        sceneWidth={sceneWidth}
        rows={26}
        spacing={8}
        seed={41}
        frame={STONE}
        tones={PRODUCT_TONES}
        sky={sky}
        depth="near"
        bayWidth={24}
        zIndex={2}
        clearFrom={mid - 30}
        clearTo={mid + 30}
      />

      {/* Produce crates in the open middle, low enough to see over. */}
      <Grounded left={40} z={3} sceneWidth={sceneWidth} shadow={16}>
        <PixelSprite map={CRATE} palette={CRATE_PALETTE} scale={artPx} />
      </Grounded>
      <Grounded right={40} z={3} sceneWidth={sceneWidth} shadow={16}>
        <PixelSprite map={CRATE} palette={CRATE_PALETTE} scale={artPx} />
      </Grounded>

      {/* Checkout lanes at the near right, where you'd walk out. */}
      <Grounded right={2} z={4} sceneWidth={sceneWidth} shadow={22}>
        <PixelSprite
          map={CHECKOUT}
          palette={CHECKOUT_PALETTE}
          scale={artPx}
          outline={keyline(sky, "near")}
        />
      </Grounded>
      <Grounded right={16} z={4} sceneWidth={sceneWidth} shadow={22}>
        <PixelSprite
          map={CHECKOUT}
          palette={CHECKOUT_PALETTE}
          scale={artPx}
          outline={keyline(sky, "near")}
        />
      </Grounded>
    </>
  );
}
