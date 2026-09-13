"use client";
import { useMemo } from "react";
import { GROUND } from "@/lib/scene";
import { useArtPx } from "./SceneScale";
import {
  capPath,
  columnsFor,
  ridgeHeights,
  ridgePath,
  type RidgeSpec,
} from "@/lib/terrain";
import { blend, hazedPalette, INK, type Depth } from "@/lib/palette";

interface RidgeProps {
  /** Everything except `columns`, which comes from the measured scene. */
  spec: Omit<RidgeSpec, "columns">;
  /** Width of the scene in CSS px, so the ridge can cover it without stretching. */
  sceneWidth: number;
  /** Darkest-to-lightest ramp for the rock or foliage this ridge is made of. */
  ramp: readonly string[];
  /** The sky this layer sits in front of — what distance blends toward. */
  sky: string;
  depth: Depth;
  /** Art pixels of snow/lit roof on anything clearing this height. */
  capAbove?: number;
  capColor?: string;
  /** Bottom edge, so a ridge can sit below the horizon for a nearer band. */
  bottom?: string;
  zIndex?: number;
}

/**
 * One band of terrain, drawn at one art pixel per pixel.
 *
 * Depth is carried by value, not size: `hazedPalette` pushes the whole band
 * toward the sky, so a far ridge is a low-contrast ridge rather than a small
 * one. That is the thing that makes a flat scene read as deep, and it is why
 * the same ramp can serve every band.
 */
export default function Ridge({
  spec,
  sceneWidth,
  ramp,
  sky,
  depth,
  capAbove,
  capColor,
  bottom = GROUND,
  zIndex = 0,
}: RidgeProps) {
  const artPx = useArtPx();
  const columns = columnsFor(sceneWidth, artPx);

  const { heights, rows, face, lit, cap } = useMemo(() => {
    const heights = ridgeHeights({ ...spec, columns });
    const rows = Math.max(...heights);
    // Mid of the ramp for the face, two steps up for the sunlit top edge —
    // taking both from one ramp is what keeps the lit edge the same colour
    // family as the rock rather than a wash of white.
    const mid = Math.min(ramp.length - 1, Math.max(0, Math.floor(ramp.length * 0.42)));
    const top = Math.min(ramp.length - 1, mid + 2);
    const shaded = hazedPalette(
      { face: ramp[mid], lit: ramp[top], cap: capColor ?? ramp[ramp.length - 1] },
      sky,
      depth,
    );
    return { heights, rows, face: shaded.face, lit: shaded.lit, cap: shaded.cap };
  }, [spec, columns, ramp, sky, depth, capColor]);

  const silhouette = useMemo(() => ridgePath(heights, rows), [heights, rows]);
  // The same silhouette dropped one pixel: drawn in the face colour over the
  // lit one, what survives is exactly a one-pixel sunlit crest.
  const body = useMemo(
    () => ridgePath(heights.map((h) => h - 1), rows),
    [heights, rows],
  );
  const snow = useMemo(
    () => (capAbove === undefined ? "" : capPath(heights, rows, capAbove)),
    [heights, rows, capAbove],
  );

  return (
    <svg
      viewBox={`0 0 ${columns} ${rows}`}
      width={columns * artPx}
      height={rows * artPx}
      className="absolute left-0 pointer-events-none"
      style={{ bottom, zIndex, shapeRendering: "crispEdges", display: "block" }}
      aria-hidden="true"
    >
      <path d={silhouette} fill={lit} />
      <path d={body} fill={face} />
      {snow && <path d={snow} fill={cap} />}
      {/* A hairline of the band's own shadow where it meets the ground, so the
          ridge sits on the horizon instead of being pasted over it. */}
      <rect
        x={0}
        y={rows - 1}
        width={columns}
        height={1}
        fill={blend(face, INK, 0.22)}
      />
    </svg>
  );
}
