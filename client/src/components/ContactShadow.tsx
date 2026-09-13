"use client";
import { useArtPx } from "./SceneScale";
import { INK } from "@/lib/palette";

/**
 * One art-pixel-tall smudge on the ground plane, centred under its owner.
 *
 * Lives in its own file because the scenery and the characters both need it and
 * they are rendered from different components. The numbers are the ones the
 * scenery has been using since the backgrounds landed — matching them matters
 * more than the exact value, since a character whose shadow is darker than the
 * tree beside it reads as lit by a different sun.
 *
 * The parent must be positioned, and its bottom edge must be the sprite's feet.
 */
export default function ContactShadow({ width }: { width: number }) {
  const artPx = useArtPx();
  return (
    <div
      className="absolute left-1/2 pointer-events-none"
      style={{
        bottom: -artPx,
        width: width * artPx,
        height: artPx,
        marginLeft: -Math.round((width * artPx) / 2),
        background: INK,
        opacity: 0.26,
      }}
    />
  );
}
