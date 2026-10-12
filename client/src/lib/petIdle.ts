import { PET_ART } from "./petMaps";
import type { PetStage } from "./petLevel";
import type { PetType } from "./types";

export type PetIdleMoment = "rest" | "blink" | "fidget";

/** Discrete poses on the existing grid; the feet and palette never change. */
export function petIdleMap(type: PetType, stage: PetStage, moment: PetIdleMoment) {
  const base = PET_ART[type][stage].frames[0];
  if (moment === "rest") return base;
  if (moment === "blink") return base.map((row) => row.replaceAll("E", "c"));
  const rows = base.map((row) => row.split(""));
  const move = (x: number, y: number, dx: number, dy: number) => {
    if (rows[y]?.[x] !== "c" || rows[dy]?.[dx] !== ".") return;
    rows[y][x] = ".";
    rows[dy][dx] = "c";
  };
  if (type === "rabbit") {
    // Only the ear tips tilt; their bases stay connected to the head.
    const tips = rows[0].flatMap((cell, x) => cell === "C" ? [x] : []);
    for (const x of tips) rows[0][x] = ".";
    for (const x of tips) rows[0][x + (x < rows[0].length / 2 ? -1 : 1)] = "C";
  } else if (type === "cat") {
    if (stage === "young") move(6, 3, 6, 2);
    if (stage === "grown") move(9, 6, 8, 6);
    if (stage === "full") move(13, 8, 12, 8);
  } else if (type === "dog") {
    if (stage === "young") rows[3][6] = "c";
    if (stage === "grown") move(8, 4, 8, 5);
    if (stage === "full") move(11, 6, 10, 6);
  } else {
    if (stage === "young") { move(0, 3, 0, 2); move(6, 3, 6, 2); }
    if (stage === "grown") { move(1, 5, 1, 6); move(9, 5, 9, 6); }
    if (stage === "full") { move(1, 7, 1, 8); move(13, 7, 13, 8); }
  }
  return rows.map((row) => row.join(""));
}
