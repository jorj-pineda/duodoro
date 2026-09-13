"use client";
import { useMemo } from "react";
import { GROUND } from "@/lib/scene";
import { useArtPx } from "./SceneScale";
import { columnsFor } from "@/lib/terrain";
import { skyline, windows, roofParts, type SkylineSpec } from "@/lib/skyline";
import { blend, hazedPalette, INK, type Depth } from "@/lib/palette";

interface SkylineProps {
  spec: Omit<SkylineSpec, "columns">;
  sceneWidth: number;
  /** Darkest-first ramp the towers are cut from. */
  ramp: readonly string[];
  /** Colour lit windows glow. */
  glow: string;
  sky: string;
  depth: Depth;
  bottom?: string;
  zIndex?: number;
  /** Draw windows at all — far towers read better as flat silhouettes. */
  showWindows?: boolean;
}

/**
 * A band of city.
 *
 * Same idea as Ridge: one ramp, pushed toward the horizon by depth, so the
 * layers separate by contrast rather than by size. Windows stay bright at
 * distance for a while and then go — a far tower with legible windows reads
 * as a near tower that happens to be small.
 */
export default function Skyline({
  spec,
  sceneWidth,
  ramp,
  glow,
  sky,
  depth,
  bottom = GROUND,
  zIndex = 0,
  showWindows = true,
}: SkylineProps) {
  const artPx = useArtPx();
  const columns = columnsFor(sceneWidth, artPx);

  const { towers, rows, face, lit, edge, pane, dark } = useMemo(() => {
    const towers = skyline({ ...spec, columns });
    const tallest = towers.reduce((m, b) => Math.max(m, b.h), 0);
    // Headroom for antennas and spires, which are drawn above the parapet.
    const rows = tallest + 14;
    const shaded = hazedPalette(
      {
        face: ramp[1],
        lit: ramp[2],
        edge: blend(ramp[0], INK, 0.3),
        pane: glow,
        dark: ramp[0],
      },
      sky,
      depth,
    );
    return { towers, rows, ...shaded };
  }, [spec, columns, ramp, glow, sky, depth]);

  return (
    <svg
      viewBox={`0 0 ${columns} ${rows}`}
      width={columns * artPx}
      height={rows * artPx}
      className="absolute left-0 pointer-events-none"
      style={{ bottom, zIndex, shapeRendering: "crispEdges", display: "block" }}
      aria-hidden="true"
    >
      {towers.map((b, i) => {
        const top = rows - b.h;
        return (
          <g key={i}>
            {/* Body, with the left two columns catching the light so towers
                separate from each other without needing an outline. */}
            <rect x={b.x} y={top} width={b.w} height={b.h} fill={face} />
            <rect x={b.x} y={top} width={2} height={b.h} fill={lit} />
            <rect x={b.x + b.w - 1} y={top} width={1} height={b.h} fill={edge} />
            {/* Parapet */}
            <rect x={b.x} y={top} width={b.w} height={1} fill={lit} />
            {roofParts(b).map((p, j) => (
              <rect
                key={j}
                x={b.x + p.x}
                y={top + p.y}
                width={p.w}
                height={p.h}
                fill={j === 0 ? face : dark}
              />
            ))}
            {showWindows &&
              windows(b).map((w, j) => (
                <rect
                  key={`w${j}`}
                  x={b.x + w.x}
                  y={top + w.y}
                  width={2}
                  height={2}
                  fill={w.lit ? pane : edge}
                />
              ))}
          </g>
        );
      })}
    </svg>
  );
}
