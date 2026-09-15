/**
 * Every localStorage key this app owns, in one place, with what each is for
 * and whether it travels with the visitor.
 *
 * This exists because the export registry kept drifting from what is actually
 * stored. `localData.js` maintained its own list, so a feature that added a
 * key was silently also opting that key out of export unless someone
 * remembered to edit a second file — and nobody did. By the time this was
 * written, twelve keys were being stored and seven were listed, with the
 * newest gap (ambient's consent flag) introduced after an audit had already
 * flagged the two before it.
 *
 * So the catalog is the source of truth and `localData.js` derives its lists
 * from it. Adding a key here is a deliberate decision about portability,
 * because `exportable` has no default: a key that omits it fails the
 * accompanying test rather than quietly becoming un-portable.
 *
 * Non-exportable is a real answer, not an oversight — but it has to be an
 * argued one, which is what `reason` is for.
 */

/**
 * @typedef {object} StorageKeyEntry
 * @property {string} key the literal localStorage key
 * @property {string} label human name, used in the export summary
 * @property {boolean} exportable whether it belongs in a local-data export
 * @property {string} [reason] required when `exportable` is false
 */

/** @type {Record<string, StorageKeyEntry>} */
export const STORAGE_KEYS = {
	favorites: {
		key: 'indienode:favorites:v1',
		label: 'Liked entries',
		exportable: true
	},
	hidden: {
		key: 'indienode:hidden:v1',
		label: 'Not for Me entries',
		exportable: true
	},
	journal: {
		key: 'indienode:journal:v1',
		label: 'Discovery journal',
		exportable: true
	},
	layout: {
		key: 'indienode:layout:v1',
		label: 'Field arrangement',
		exportable: true
	},
	preferences: {
		key: 'indienode:preferences:v1',
		label: 'Theme and preferences',
		exportable: true
	},
	filters: {
		key: 'indienode:filters:v1',
		label: 'Tag filters',
		exportable: true
	},
	fieldPresets: {
		key: 'indienode:field-presets:v1',
		label: 'Field presets',
		exportable: true
	},
	volume: {
		key: 'indienode:volume:v1',
		label: 'Player volume',
		exportable: true
	},
	skins: {
		key: 'indienode:skins:v1',
		label: 'Skin selection',
		exportable: true
	},
	ambientConsent: {
		key: 'indienode:ambient-consent:v1',
		label: 'Ambient audio acknowledgement',
		exportable: true
	},
	visitCount: {
		key: 'indienode:visit-count:v1',
		label: 'Visit count',
		exportable: true
	},
	feedbackPrompt: {
		key: 'indienode:feedback-prompt:v1',
		label: 'Feedback prompt',
		exportable: true
	},
	installPrompt: {
		key: 'indienode:install-prompt:v1',
		label: 'Install prompt',
		exportable: false,
		reason:
			'Whether this device was already offered the home-screen install. Installing is per device, so carrying the answer to a new phone would silently skip the one offer that phone should get.'
	},
	playerPosition: {
		key: 'indienode:player-position:v1',
		label: 'Minimized player position',
		exportable: false,
		reason:
			'Viewport-specific pixel coordinates. A position dragged on one screen is clamped back into bounds on a different one anyway, so carrying it across devices restores a number rather than a placement.'
	},
	submissionDraft: {
		key: 'indienode:submission-draft:v1',
		label: 'Submission draft',
		exportable: false,
		reason:
			'In-progress form data, including a contact email the visitor has not chosen to submit yet. An export is a file people send to themselves over channels this app cannot see, and a half-finished form is not what they are asking for when they ask for their likes back.'
	},
	updateDraft: {
		key: 'indienode:update-draft:v1',
		label: 'Update draft',
		exportable: false,
		reason:
			'Transient in-progress work, same as the submission draft. Neither draft holds an email: both keep the address in memory only, so it never reaches storage and cannot reach an export.'
	}
};

/**
 * sessionStorage, not localStorage, and deliberately not part of the catalog
 * above.
 *
 * `STORAGE_KEYS` exists to force a portability decision on anything that
 * persists; a session flag persists for one tab and is gone when it closes, so
 * there is no decision to force and nothing for an export to carry. It lives
 * here anyway because the accompanying test forbids a raw `indienode:` literal
 * anywhere else in `src/`, and that rule is worth keeping absolute — one file
 * holds every key string this app writes, whichever storage tier it writes to.
 */
export const SESSION_KEYS = {
	/** Marks this tab's visit as already counted. See feedbackStore. */
	visitCounted: 'indienode:visit-counted'
};

/** Every catalogued entry, for tests and for iteration. */
export const ALL_STORAGE_KEYS = Object.values(STORAGE_KEYS);

/** The literal keys an export carries. Order is the catalog's order. */
export const EXPORTABLE_KEYS = ALL_STORAGE_KEYS.filter((entry) => entry.exportable).map(
	(entry) => entry.key
);

/**
 * Human labels by literal key, so the export summary can say what is in the
 * file rather than listing storage keys at somebody.
 * @type {Record<string, string>}
 */
export const KEY_LABELS = Object.fromEntries(
	ALL_STORAGE_KEYS.map((entry) => [entry.key, entry.label])
);

/**
 * Reads and parses a stored value, falling back rather than throwing.
 *
 * Every store here already hand-rolled some version of this, and they did not
 * agree: some caught a private-mode or quota failure and some let it throw
 * during ordinary interaction. Reading is the easier half to get wrong
 * silently, because a corrupt value looks the same as an absent one until
 * `JSON.parse` throws in the middle of a component's setup.
 *
 * @template T
 * @param {string} key
 * @param {T} fallback returned when the key is absent, unreadable, or invalid
 * @returns {T}
 */
export function safeReadJson(key, fallback) {
	try {
		const raw = localStorage.getItem(key);
		if (raw === null) return fallback;
		const parsed = JSON.parse(raw);
		return parsed === null || parsed === undefined ? fallback : parsed;
	} catch {
		return fallback;
	}
}

/**
 * Writes a value, reporting failure rather than throwing it.
 *
 * A private window and a full quota both reject writes, and neither is a
 * reason for a like to fail to register visually. Callers that genuinely care
 * whether persistence happened can read the return value; most correctly do
 * not, because the in-memory state is what the UI reads either way.
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean} whether it was actually persisted
 */
export function safeWriteJson(key, value) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
}
