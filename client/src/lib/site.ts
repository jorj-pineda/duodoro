// ─────────────────────────────────────────────────────────────────────────────
// Launch surface — the words and colours crawlers, the install splash, and
// the tab icon all have to agree on.
//
// Duplicating these in layout.tsx, the manifest, and the OG image is how the
// tagline grew a second period, the splash flashed gray-900, and the icon
// shipped in Tailwind emerald — a colour that appears nowhere else. One
// module, so the next drift fails a test instead of a screenshot.
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical origin. Relative OG image paths are resolved against this. */
export const SITE_URL = "https://duodoro.live";

export const SITE_NAME = "Duodoro";

/** One period. The openGraph description used to have two. */
export const SITE_TAGLINE = "Focus together, anywhere.";

export const SITE_TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`;

export const SITE_DESCRIPTION =
  "A real-time focus timer for long-distance couples and friends. Walk toward each other, meet in the middle, and celebrate your session together.";

/**
 * Warm paper / warm charcoal, copied from `app/globals.css`.
 *
 * The CSS tokens are the live theme; these exist because the manifest, the
 * viewport `themeColor`, and `next/og` cannot read custom properties. Change
 * both, or neither.
 */
export const LIGHT_BG = "#f3ede1";
export const DARK_BG = "#171411";
export const DARK_INK = "#ede4d3";
export const DARK_MUTED = "#a2967e";
export const PAPER = "#f3ede1";
