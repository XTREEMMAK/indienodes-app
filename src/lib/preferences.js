import { browser } from '$app/environment';
import { STORAGE_KEYS, safeWriteJson } from './storageKeys.js';
import { ENTRY_TYPES } from './submissionValidation.js';

/**
 * @typedef {object} Preferences
 * @property {number} version
 * @property {'light' | 'dark' | 'system'} theme
 * @property {'none' | 'drifty-stars'} background
 * @property {boolean} fitToView Render the whole arrangement scaled to the
 *   viewport instead of letting the responsive column ladder repack it.
 * @property {boolean} showExplicit Show entries their creator marked as
 *   explicit adult content. Off by default, so the filter is on by default.
 * @property {boolean} randomizeAudioTracks Shuffle each audio node's tracks
 *   when Play or Add puts that node into the playlist. On by default; a
 *   listener who wants the listed order has to opt out.
 * @property {Record<string, number>} rotationMs How long a node of each
 *   content type holds an entry before rotating, in milliseconds.
 * @property {Record<string, boolean>} ambientTypes Which content types are
 *   eligible to appear in Ambient View. All true by default; setting one to
 *   false excludes that type from both the visual rotation and, for audio,
 *   the sound dock. This is a deliberate, documented exception to Ambient's
 *   usual no-filter rule (see decisions.md).
 */

const STORAGE_KEY = STORAGE_KEYS.preferences.key;
const VERSION = 1;

/**
 * How long a node of each type holds an entry before rotating.
 *
 * Per type rather than one global interval, because the types are not
 * equally quick to take in: a few seconds is enough to decide whether a
 * track is for you, and a comic page is something you actually have to read.
 * A single interval is necessarily too fast for one end of that range or too
 * slow for the other, which is why brief section 7c scopes this per type.
 *
 * The ladder is ordered by how long the medium takes, not by preference:
 * audio is the quickest sample, text needs a moment to parse an excerpt,
 * comic needs longest since the card is now cycling pages of its own. `any`
 * sits mid-range because such a node could be showing anything.
 *
 * These are defaults, not limits. The visitor can change them in Settings.
 */
/** @type {Record<string, number>} */
export const DEFAULT_ROTATION_MS = {
	audio: 10000,
	game: 14000,
	art: 14000,
	any: 14000,
	text: 16000,
	comic: 22000
};

/** Bounds for the visitor-facing control, in milliseconds. */
export const ROTATION_MIN_MS = 5000;
export const ROTATION_MAX_MS = 60000;

/** Every content type is eligible for Ambient View until a visitor opts one out. */
export const DEFAULT_AMBIENT_TYPES = Object.fromEntries(ENTRY_TYPES.map((type) => [type, true]));

/** @type {Preferences} */
const DEFAULT_PREFERENCES = {
	version: VERSION,
	theme: 'system',
	background: 'drifty-stars',
	fitToView: false,
	// Off, so explicit entries are filtered out until someone asks for them.
	// The default has to be the restrictive one: a visitor who has never
	// opened Settings should not be shown adult content by a surface whose
	// whole premise is that things appear without being chosen.
	showExplicit: false,
	// On by default; a listener who wants the listed order has to opt out.
	randomizeAudioTracks: true,
	rotationMs: { ...DEFAULT_ROTATION_MS },
	ambientTypes: { ...DEFAULT_AMBIENT_TYPES }
};

/**
 * Reads preferences from localStorage, filling in defaults for anything
 * missing or malformed. Nothing here is sent anywhere; it is local-only
 * personalization per the brief.
 * @returns {Preferences}
 */
export function loadPreferences() {
	if (!browser) return { ...DEFAULT_PREFERENCES };

	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULT_PREFERENCES };

		const parsed = JSON.parse(raw);
		return {
			...DEFAULT_PREFERENCES,
			...parsed,
			// Merged one level deeper, unlike every other key. A top-level
			// spread would let a stored object that happens to carry only one
			// type replace the whole map, leaving the other three undefined and
			// their nodes rotating on NaN. That is reachable in practice: an
			// older export, a hand-edited file, or a future build that adds a
			// fifth type all produce exactly that shape.
			randomizeAudioTracks: parsed?.randomizeAudioTracks !== false,
			rotationMs: sanitizeRotation(parsed?.rotationMs),
			ambientTypes: sanitizeAmbientTypes(parsed?.ambientTypes),
			version: VERSION
		};
	} catch {
		return { ...DEFAULT_PREFERENCES };
	}
}

/**
 * Fills in any missing type and clamps every value into the range the
 * control offers, so a stored file cannot produce a node that rotates every
 * 4ms or never.
 * @param {unknown} stored
 * @returns {Record<string, number>}
 */
function sanitizeRotation(stored) {
	const merged = { ...DEFAULT_ROTATION_MS };
	if (!stored || typeof stored !== 'object') return merged;

	for (const [type, value] of Object.entries(stored)) {
		if (!(type in merged)) continue;
		const ms = Number(value);
		if (!Number.isFinite(ms)) continue;
		merged[type] = Math.min(ROTATION_MAX_MS, Math.max(ROTATION_MIN_MS, ms));
	}
	return merged;
}

/**
 * Same shape of fix-up as `sanitizeRotation`: fills in any type missing from
 * a stored file (an older export, or a future build adding a type) as
 * visible by default, and drops anything that isn't a real schema type.
 * @param {unknown} stored
 * @returns {Record<string, boolean>}
 */
function sanitizeAmbientTypes(stored) {
	const merged = { ...DEFAULT_AMBIENT_TYPES };
	if (!stored || typeof stored !== 'object') return merged;

	for (const [type, value] of Object.entries(stored)) {
		if (!(type in merged)) continue;
		merged[type] = value !== false;
	}
	return merged;
}

/**
 * @param {Preferences} preferences
 */
export function savePreferences(preferences) {
	if (!browser) return;
	safeWriteJson(STORAGE_KEY, { ...preferences, version: VERSION });
}
