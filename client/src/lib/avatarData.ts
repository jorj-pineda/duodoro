// ─────────────────────────────────────────────────────────────────────────────
// Avatar Data — pixel art definitions for the SVG character renderer
// Character canvas: 16 × 24 "pixels" (SVG units)
// ─────────────────────────────────────────────────────────────────────────────

export type HairStyle = 'bob' | 'mohawk' | 'long' | 'spiky' | 'bald';
export type EyeStyle = 'normal' | 'anime' | 'sleepy';
export type WorldId = 'forest' | 'space' | 'beach' | 'city' | 'mountain' | 'library' | 'cafe' | 'grocery';

export type AvatarConfig = {
  skinColor: string;
  hairStyle: HairStyle;
  hairColor: string;
  eyeStyle: EyeStyle;
  outfitColor: string;
};

// ── Color Palettes ─────────────────────────────────────────────────────────

export const SKIN_COLORS = [
  { label: 'Fair',    hex: '#FDDBB4' },
  { label: 'Light',   hex: '#F3C08C' },
  { label: 'Medium',  hex: '#D4956A' },
  { label: 'Tan',     hex: '#B5714E' },
  { label: 'Deep',    hex: '#7A4B30' },
  { label: 'Rich',    hex: '#4A2518' },
];

export const HAIR_COLORS = [
  { label: 'Brown',   hex: '#5C3317' },
  { label: 'Black',   hex: '#1A1A1A' },
  { label: 'Blonde',  hex: '#D4A836' },
  { label: 'Auburn',  hex: '#8B3A1E' },
  { label: 'Pink',    hex: '#E06C8B' },
  { label: 'Blue',    hex: '#3A78C9' },
];

export const OUTFIT_COLORS = [
  { label: 'Blue',    hex: '#3B5BDB' },
  { label: 'Red',     hex: '#C92A2A' },
  { label: 'Green',   hex: '#2B7A4B' },
  { label: 'Purple',  hex: '#7048C9' },
  { label: 'Orange',  hex: '#D4580A' },
  { label: 'Pink',    hex: '#C9428B' },
];

export const HAIR_STYLE_LABELS: Record<HairStyle, string> = {
  bob:    'Bob',
  mohawk: 'Mohawk',
  long:   'Long',
  spiky:  'Spiky',
  bald:   'Bald',
};

export const EYE_STYLE_LABELS: Record<EyeStyle, string> = {
  normal:  'Normal',
  anime:   'Anime',
  sleepy:  'Sleepy',
};

export const HAIR_STYLES: HairStyle[] = ['bob', 'mohawk', 'long', 'spiky', 'bald'];
export const EYE_STYLES: EyeStyle[] = ['normal', 'anime', 'sleepy'];

export const DEFAULT_AVATAR: AvatarConfig = {
  skinColor:   '#FDDBB4',
  hairStyle:   'bob',
  hairColor:   '#5C3317',
  eyeStyle:    'normal',
  outfitColor: '#3B5BDB',
};

// ── World Configs ──────────────────────────────────────────────────────────

export type SkyStop = {
  color: string;
  /** Position down the sky, 0 = top. */
  at: number;
};

export type WorldConfig = {
  id: WorldId;
  label: string;
  /**
   * Sky gradient stops, top to bottom. The one source for both the CSS gradient
   * the scene paints (`skyGradient`) and the colour distance blends toward
   * (`HORIZON`) — these used to be written down twice and could drift.
   */
  skyStops: SkyStop[];
  /**
   * Index into `skyStops` of the colour at the horizon. The last stop for every
   * outdoor world; grocery is an interior, so its horizon is the wall/ceiling
   * join at 55%, before the floor brightens the bottom stop.
   */
  horizonStop: number;
  groundColor: string;
  groundPatternColor: string;
  /** `linear-gradient(180deg, …)` built from `skyStops`; see `skyGradient()`. */
  skyGradient: string;
};

type WorldSeed = Omit<WorldConfig, "skyGradient">;

const WORLD_SEEDS: WorldSeed[] = [
  {
    id: 'forest',
    label: 'Forest',
    skyStops: [
      { color: '#7EC8E3', at: 0 },
      { color: '#AEE5D8', at: 100 },
    ],
    horizonStop: 1,
    groundColor: '#4a7c59',
    groundPatternColor: '#3d6849',
  },
  {
    id: 'space',
    label: 'Space',
    // Standing on the moon, so the ground is regolith rather than purple.
    skyStops: [
      { color: '#04001A', at: 0 },
      { color: '#130840', at: 100 },
    ],
    horizonStop: 1,
    groundColor: '#6d727c',
    groundPatternColor: '#565b64',
  },
  {
    id: 'beach',
    label: 'Beach',
    skyStops: [
      { color: '#FF8C42', at: 0 },
      { color: '#FFD166', at: 100 },
    ],
    horizonStop: 1,
    groundColor: '#C9A84C',
    groundPatternColor: '#B89238',
  },
  {
    id: 'city',
    label: 'City',
    skyStops: [
      { color: '#1a1a2e', at: 0 },
      { color: '#16213e', at: 100 },
    ],
    horizonStop: 1,
    groundColor: '#3a3a4a',
    groundPatternColor: '#2d2d3d',
  },
  {
    id: 'mountain',
    label: 'Mountain',
    // Winter: the ground is snow over rock, not the alpine meadow it was.
    skyStops: [
      { color: '#87CEEB', at: 0 },
      { color: '#E0F0FF', at: 100 },
    ],
    horizonStop: 1,
    groundColor: '#dbe4ea',
    groundPatternColor: '#aab7c2',
  },
  {
    id: 'library',
    label: 'Library',
    skyStops: [
      { color: '#3e2723', at: 0 },
      { color: '#5d4037', at: 100 },
    ],
    horizonStop: 1,
    groundColor: '#6d4c41',
    groundPatternColor: '#5d3f35',
  },
  {
    id: 'cafe',
    label: 'Café',
    skyStops: [
      { color: '#f5e6d3', at: 0 },
      { color: '#e8d5b7', at: 100 },
    ],
    horizonStop: 1,
    groundColor: '#8d6e63',
    groundPatternColor: '#795548',
  },
  {
    id: 'grocery',
    label: 'Grocery',
    // An interior: the "sky" is a lit ceiling, the ground is vinyl tile.
    skyStops: [
      { color: '#f2f4f0', at: 0 },
      { color: '#dfe4dd', at: 55 },
      { color: '#cdd4cc', at: 100 },
    ],
    horizonStop: 1,
    groundColor: '#c8ccc6',
    groundPatternColor: '#aab0a9',
  },
];

/** The CSS gradient for a world sky, built from its stops. */
export function skyGradient(stops: SkyStop[]): string {
  return `linear-gradient(180deg, ${stops
    .map((s) => `${s.color} ${s.at}%`)
    .join(', ')})`;
}

export const WORLDS: WorldConfig[] = WORLD_SEEDS.map((seed) => ({
  ...seed,
  skyGradient: skyGradient(seed.skyStops),
}));

/**
 * The colour distance blends toward in each world — its sky at the horizon.
 * Derived from `skyStops`, never written beside them, so the two cannot drift.
 */
export const HORIZON: Record<WorldId, string> = Object.fromEntries(
  WORLDS.map((w) => [w.id, w.skyStops[w.horizonStop].color]),
) as Record<WorldId, string>;

export function getWorld(id: WorldId): WorldConfig {
  return WORLDS.find((w) => w.id === id) ?? WORLDS[0];
}
