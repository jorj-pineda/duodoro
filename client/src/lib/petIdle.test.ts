import { describe, expect, it } from "vitest";
import { petIdleMap } from "./petIdle";
import { PET_ART, PET_STAGE_SIZE } from "./petMaps";
import { PET_STAGES } from "./petLevel";
import { PET_OPTIONS } from "./types";

describe("companion idle art", () => {
  for (const { type } of PET_OPTIONS) for (const stage of PET_STAGES) {
    it(`${type} ${stage} keeps its palette, grid and planted feet in every pose`, () => {
      const art = PET_ART[type][stage];
      const original = [...art.frames[0]];
      const { w, h } = PET_STAGE_SIZE[stage];
      expect(petIdleMap(type, stage, "rest")).toBe(art.frames[0]);
      for (const moment of ["blink", "fidget"] as const) {
        const pose = petIdleMap(type, stage, moment);
        expect(pose).not.toEqual(original);
        expect(pose).toHaveLength(h);
        expect(pose.at(-1)).toBe(original.at(-1));
        for (const row of pose) {
          expect(row).toHaveLength(w);
          for (const cell of row) expect(cell === "." || cell in art.palette).toBe(true);
        }
        if (moment === "blink") expect(pose.join("")).not.toContain("E");
      }
      expect(art.frames[0]).toEqual(original);
    });
  }
});
