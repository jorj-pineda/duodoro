import { describe, it, expect } from "vitest";
import { WORLDS, HORIZON, skyGradient } from "./avatarData";

// The sky gradient and the horizon used to be written down separately, so the
// eight horizon colours could drift from the sky they were supposed to be the
// bottom of. They are derived now; these pin the derivation and the one world
// where the horizon is deliberately not the bottom stop.

describe("world sky", () => {
  it("builds each gradient from its own stops", () => {
    for (const world of WORLDS) {
      expect(world.skyGradient).toBe(skyGradient(world.skyStops));
    }
    expect(skyGradient(WORLDS[0].skyStops)).toBe(
      "linear-gradient(180deg, #7EC8E3 0%, #AEE5D8 100%)",
    );
  });

  it("takes the horizon from the sky, not a second list", () => {
    for (const world of WORLDS) {
      expect(HORIZON[world.id]).toBe(world.skyStops[world.horizonStop].color);
    }
  });

  it("keeps grocery's horizon above its brighter floor stop", () => {
    // An interior: the horizon is the wall/ceiling join at 55%, not the bottom
    // of the gradient. A naive "last stop" derivation would change this colour.
    const grocery = WORLDS.find((w) => w.id === "grocery");
    expect(HORIZON.grocery).toBe("#dfe4dd");
    expect(grocery?.skyStops.at(-1)?.color).toBe("#cdd4cc");
  });
});
