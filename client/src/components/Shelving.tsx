"use client";
import { useMemo } from "react";
import { GROUND } from "@/lib/scene";
import { useArtPx } from "./SceneScale";
import { columnsFor } from "@/lib/terrain";
import { shelfItems, shelfBoards } from "@/lib/interior";
import { blend, hazedPalette, INK, type Depth } from "@/lib/palette";

interface ShelvingProps {
  sceneWidth: number;
  /** Total height of the unit in art pixels. */
  rows: number;
  /** Clear height between boards. */
  spacing: number;
  seed: number;
  /** Frame colour ramp — the carcass, uprights and boards. */
  frame: readonly string[];
  /** Colours the items are drawn from. */
  tones: readonly string[];
  sky: string;
  depth: Depth;
  /** Repeat a carcass every N art pixels, with an upright between each. */
  bayWidth?: number;
  bottom?: string;
  zIndex?: number;
  /** Leave the middle of the wall clear so the characters aren't lost in it. */
  clearFrom?: number;
  clearTo?: number;
}

/**
 * A wall of shelving, generated across the scene.
 *
 * Every item has its own width, height and tone. The bookcase this replaces
 * repeated the same four rows of six colours down its whole height, which is
 * what made it read as wallpaper rather than as books.
 */
export default function Shelving({
  sceneWidth,
  rows,
  spacing,
  seed,
  frame,
  tones,
  sky,
  depth,
  bayWidth = 30,
  bottom = GROUND,
  zIndex = 0,
  clearFrom,
  clearTo,
}: ShelvingProps) {
  const artPx = useArtPx();
  const columns = columnsFor(sceneWidth, artPx);

  const shaded = useMemo(
    () =>
      hazedPalette(
        {
          carcass: frame[1],
          board: frame[3] ?? frame[2],
          lip: blend(frame[0], INK, 0.25),
          back: blend(frame[0], INK, 0.45),
        },
        sky,
        depth,
      ),
    [frame, sky, depth],
  );

  const shadedTones = useMemo(
    () =>
      tones.map(
        (t) => hazedPalette({ t }, sky, depth).t,
      ),
    [tones, sky, depth],
  );

  const boards = useMemo(() => shelfBoards(rows, spacing), [rows, spacing]);

  const bays = useMemo(() => {
    const out: number[] = [];
    for (let x = 0; x < columns; x += bayWidth) out.push(x);
    return out;
  }, [columns, bayWidth]);

  const hidden = (x: number) =>
    clearFrom !== undefined &&
    clearTo !== undefined &&
    x + bayWidth > clearFrom &&
    x < clearTo;

  return (
    <svg
      viewBox={`0 0 ${columns} ${rows}`}
      width={columns * artPx}
      height={rows * artPx}
      className="absolute left-0 pointer-events-none"
      style={{ bottom, zIndex, shapeRendering: "crispEdges", display: "block" }}
      aria-hidden="true"
    >
      <rect x={0} y={0} width={columns} height={rows} fill={shaded.back} />
      {bays.map((bx, bi) => {
        if (hidden(bx)) return null;
        const inner = bayWidth - 2;
        return (
          <g key={bi}>
            {/* Carcass: an upright each side of the bay. */}
            <rect x={bx} y={0} width={1} height={rows} fill={shaded.carcass} />
            <rect
              x={bx + bayWidth - 1}
              y={0}
              width={1}
              height={rows}
              fill={shaded.lip}
            />
            {boards.map((by, si) => (
              <g key={si}>
                <rect
                  x={bx}
                  y={by}
                  width={bayWidth}
                  height={1}
                  fill={shaded.board}
                />
                {shelfItems({
                  width: inner,
                  seed: seed + bi * 31 + si * 7,
                  height: spacing - 2,
                  tones: shadedTones.length,
                }).map((it, ii) => (
                  <rect
                    key={ii}
                    x={bx + 1 + it.x + (it.leaning ? 1 : 0)}
                    y={by - it.h}
                    width={it.w}
                    height={it.h}
                    fill={shadedTones[it.tone]}
                  />
                ))}
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
