import { describe, expect, it } from "vitest";
import { isSessionId, normalizeAvatarConfig } from "./storedData";

const VALID_AVATAR = {
  skinColor: "#FDDBB4",
  hairStyle: "bob",
  hairColor: "#5C3317",
  eyeStyle: "normal",
  outfitColor: "#3B5BDB",
};

describe("isSessionId", () => {
  it("accepts the UUIDs the server issues", () => {
    expect(isSessionId("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
    expect(isSessionId("A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D")).toBe(true);
  });

  it("rejects anything that cannot name a live session", () => {
    for (const value of [
      "",
      "forest",
      "not-a-uuid",
      // A v1 UUID: right shape, wrong version nibble. Sessions are v4.
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      "3f2504e0-4f89-41d3-9a0c-0305e82c330", // one char short
      "3f2504e0-4f89-41d3-9a0c-0305e82c33011", // one char long
      null,
      undefined,
      42,
      {},
      [],
      true,
    ]) {
      expect(isSessionId(value), `${String(value)} should be rejected`).toBe(
        false,
      );
    }
  });
});

describe("normalizeAvatarConfig", () => {
  it("passes a valid avatar through unchanged", () => {
    expect(normalizeAvatarConfig(VALID_AVATAR)).toEqual(VALID_AVATAR);
  });

  it("returns null for a value that is not an object", () => {
    for (const value of [null, undefined, "avatar", 7, [], true]) {
      expect(normalizeAvatarConfig(value)).toBeNull();
    }
  });

  it("rejects a colour that is not a six-digit hex", () => {
    // The server's parser uses the same pattern, so a value that fails here
    // would be refused there — after a round trip, with a character the partner
    // never sees. Catching it locally keeps the two in agreement.
    for (const skinColor of ["#fff", "red", "#12345", "#GGGGGG", "", 123, null]) {
      expect(
        normalizeAvatarConfig({ ...VALID_AVATAR, skinColor }),
        `skinColor ${String(skinColor)} should be rejected`,
      ).toBeNull();
    }
  });

  it("rejects an unknown hair or eye style", () => {
    expect(
      normalizeAvatarConfig({ ...VALID_AVATAR, hairStyle: "mohican" }),
    ).toBeNull();
    expect(
      normalizeAvatarConfig({ ...VALID_AVATAR, eyeStyle: "starry" }),
    ).toBeNull();
  });

  it("requires every field rather than filling in defaults", () => {
    // A partial avatar is not a usable one: the missing field would reach the
    // sprite as `undefined` and render a hole. The caller turns null into the
    // full avatar editor instead.
    for (const missing of [
      "skinColor",
      "hairStyle",
      "hairColor",
      "eyeStyle",
      "outfitColor",
    ] as const) {
      const partial: Record<string, unknown> = { ...VALID_AVATAR };
      delete partial[missing];
      expect(
        normalizeAvatarConfig(partial),
        `missing ${missing} should be rejected`,
      ).toBeNull();
    }
  });

  it("ignores unknown extra fields", () => {
    // Forward compatibility: a newer client's extra field must not make the
    // avatar unusable for this one.
    expect(
      normalizeAvatarConfig({ ...VALID_AVATAR, hatStyle: "beanie" }),
    ).toEqual(VALID_AVATAR);
  });
});
