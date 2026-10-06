import type { PetType } from './socketContract';
export const DEFAULT_COMPANION_NAMES: Readonly<Record<PetType, string>>;
export const MAX_COMPANION_NAME_LENGTH: number;
export function normalizeCompanionName(value: unknown): string | null;
export function companionName(pet: PetType | null | undefined, value?: unknown): string | null;
