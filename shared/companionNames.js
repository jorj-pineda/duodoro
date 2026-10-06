const DEFAULT_COMPANION_NAMES = Object.freeze({ cat: 'Mochi', dog: 'Buddy', dragon: 'Ember', rabbit: 'Clover' });
const MAX_COMPANION_NAME_LENGTH = 24;
function normalizeCompanionName(value) {
  if (typeof value !== 'string' || value.length > 96) return null;
  const name = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/gu, ' ').trim();
  return Array.from(name).length <= MAX_COMPANION_NAME_LENGTH ? name : null;
}
function companionName(pet, value) {
  return Object.hasOwn(DEFAULT_COMPANION_NAMES, pet) ? normalizeCompanionName(value) || DEFAULT_COMPANION_NAMES[pet] : null;
}
module.exports = { DEFAULT_COMPANION_NAMES, MAX_COMPANION_NAME_LENGTH, normalizeCompanionName, companionName };
