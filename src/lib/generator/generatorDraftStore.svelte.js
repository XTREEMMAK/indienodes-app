import { browser } from '$app/environment';
import { deleteDraft, getDraft, isNearExpiry, putDraft } from './draftDb.js';

/**
 * Reactive wrapper over `draftDb.js`, the same relationship
 * `submissionStore.svelte.js` has to `localStorage`: the DB module knows
 * nothing about Svelte, this module is the seam where its async, callback-
 * shaped reads and writes become `$state` a component can just read.
 *
 * **Loading is asynchronous and explicit** (`load()`, not a constructor-time
 * side effect), because IndexedDB access has to be — there is no synchronous
 * read like `localStorage.getItem`. Callers (the generator's entry point)
 * call `load()` once on mount and get a `resumeAvailable` flag back to
 * decide what to show, rather than the store silently deciding for them.
 */

function createGeneratorDraftStore() {
	/** @type {Record<string, any>} */
	let entry = $state({});
	/** @type {Record<string, any>} */
	let generator = $state({});
	let hasDraft = $state(false);
	let nearExpiry = $state(false);
	let loaded = $state(false);

	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let saveTimer;

	/**
	 * Everything `save()` has been handed since the last write, merged.
	 *
	 * The debounce used to persist only the *last* patch it was given, so two
	 * saves inside 400ms (a blur committing the display name, then a click
	 * picking a template) wrote the template and silently dropped the name —
	 * and `saveNow` cancelled a pending save outright. Shallow, like
	 * `putDraft`'s own merge: each top-level key is replaced whole.
	 * @type {{ entry?: Record<string, any>, generator?: Record<string, any> }}
	 */
	let pending = {};

	/** @param {{ entry?: Record<string, any>, generator?: Record<string, any> }} patch */
	function queue(patch) {
		if (patch.entry) pending = { ...pending, entry: { ...pending.entry, ...patch.entry } };
		if (patch.generator) {
			pending = { ...pending, generator: { ...pending.generator, ...patch.generator } };
		}
	}

	/** Writes whatever is queued, and nothing if nothing is. */
	function flush() {
		clearTimeout(saveTimer);
		const patch = pending;
		pending = {};
		if (!patch.entry && !patch.generator) return Promise.resolve();
		return putDraft(patch);
	}

	const LEGACY_COLOR_KEYS = ['accentColor', 'groundColor', 'surfaceColor', 'backgroundGlowColor'];

	/**
	 * Moves a pre-`templateOptions` draft onto the `colors` record.
	 *
	 * Customization used to be four flat fields, each hardcoded to one
	 * template's own CSS variable (`groundColor` and `surfaceColor` meant
	 * Late Signal's, `backgroundGlowColor` meant Neon Signal's). They are now
	 * roles resolved per template, so the values move under `colors` keyed by
	 * role and the old keys are dropped.
	 *
	 * A draft lives about a week, so this will stop mattering quickly — but a
	 * creator halfway through a submission when this shipped should not find
	 * their chosen colors silently reverted, which is what reading only the
	 * new shape would do.
	 * @param {Record<string, any>} stored
	 */
	function migrateColorFields(stored) {
		const legacy = {
			accent: stored.accentColor,
			ground: stored.groundColor,
			surface: stored.surfaceColor,
			backgroundGlow: stored.backgroundGlowColor
		};
		const carried = Object.fromEntries(
			Object.entries(legacy).filter(([, value]) => typeof value === 'string' && value)
		);
		if (Object.keys(carried).length === 0 && !('backgroundGlowMotion' in stored)) return stored;

		// Cloned and deleted from rather than destructured with a rest: the
		// rest form names five variables it never reads, which is exactly what
		// `no-unused-vars` exists to catch and not worth an exemption.
		const next = { ...stored };
		for (const key of LEGACY_COLOR_KEYS) delete next[key];
		const legacyMotion = stored.backgroundGlowMotion;
		delete next.backgroundGlowMotion;

		return {
			...next,
			// The already-migrated shape wins where both exist: a draft written
			// after this shipped is the more recent statement of intent.
			colors: { ...carried, ...(next.colors ?? {}) },
			options: {
				...(legacyMotion === undefined ? {} : { backgroundGlowMotion: legacyMotion }),
				...(next.options ?? {})
			}
		};
	}

	/**
	 * Reads whatever draft exists (if any) into reactive state.
	 *
	 * Idempotent and safe to call more than once — the generator's own entry
	 * step calls this on mount, and there is no harm in a second call
	 * re-confirming the same state.
	 * @returns {Promise<{ resumeAvailable: boolean, nearExpiry: boolean }>}
	 */
	async function load() {
		if (!browser) return { resumeAvailable: false, nearExpiry: false };
		const draft = await getDraft();
		if (draft) {
			entry = draft.entry ?? {};
			generator = migrateColorFields(draft.generator ?? {});
			hasDraft = true;
			nearExpiry = await isNearExpiry();
		} else {
			hasDraft = false;
			nearExpiry = false;
		}
		loaded = true;
		return { resumeAvailable: hasDraft, nearExpiry };
	}

	/**
	 * Debounced, matching `submissionStore`'s own ~400ms `persist()` timing.
	 * File inputs bypass the debounce entirely by calling `saveNow` instead
	 * (see below) — a chosen image is exactly the kind of change worth
	 * writing immediately rather than risking on a closed tab.
	 * @param {{ entry?: Record<string, any>, generator?: Record<string, any> }} patch
	 */
	function save(patch) {
		if (patch.entry) entry = { ...entry, ...patch.entry };
		if (patch.generator) generator = { ...generator, ...patch.generator };
		if (!browser) return;
		queue(patch);
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			flush().catch(() => {
				// Private browsing, a full quota, or IndexedDB unavailable
				// entirely. Losing the draft is survivable; there is nothing
				// actionable to surface mid-keystroke.
			});
		}, 400);
	}

	/**
	 * @param {{ entry?: Record<string, any>, generator?: Record<string, any> }} patch
	 */
	async function saveNow(patch) {
		if (patch.entry) entry = { ...entry, ...patch.entry };
		if (patch.generator) generator = { ...generator, ...patch.generator };
		clearTimeout(saveTimer);
		if (!browser) return;
		// Writes any still-debounced saves along with this one, in call order,
		// rather than discarding them.
		queue(patch);
		try {
			await flush();
		} catch {
			// Same as the debounced save() below: private browsing, a full
			// quota, or a transient IndexedDB failure. The in-memory state
			// above already has the change, which is what the rest of the
			// page reads from, so a failed write here costs only
			// persistence, not correctness of what is on screen right now.
		}
	}

	/** Explicit "start fresh," per the spec's resume-or-restart choice. */
	async function discard() {
		clearTimeout(saveTimer);
		pending = {};
		entry = {};
		generator = {};
		hasDraft = false;
		nearExpiry = false;
		if (browser) await deleteDraft();
	}

	return {
		get entry() {
			return entry;
		},
		get generator() {
			return generator;
		},
		get hasDraft() {
			return hasDraft;
		},
		get nearExpiry() {
			return nearExpiry;
		},
		get loaded() {
			return loaded;
		},
		load,
		save,
		saveNow,
		discard
	};
}

export const generatorDraftStore = createGeneratorDraftStore();
