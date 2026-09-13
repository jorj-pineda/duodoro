import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { WorldDecor } from "./WorldDecorations";
import { WORLDS } from "@/lib/avatarData";

// The scene palette is whatever each world actually paints. This pins that set
// per world, so a palette consolidation can prove it moved colours without
// changing any — and so a later edit that recolours a scene has to say so by
// updating the snapshot rather than sliding through as a refactor.

/** Every colour literal the rendered scene markup contains, deduped. */
function painted(html: string): string[] {
  return Array.from(new Set(html.match(/#[0-9a-fA-F]{3,8}/g) ?? [])).sort();
}

describe("scene colours", () => {
  for (const world of WORLDS) {
    it(`${world.id} paints a fixed set of colours`, () => {
      const { container } = render(
        <WorldDecor worldId={world.id} sceneWidth={640} />,
      );
      expect(painted(container.innerHTML)).toMatchSnapshot();
    });
  }
});
