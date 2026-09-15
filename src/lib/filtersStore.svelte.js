import { browser } from '$app/environment';
import { SvelteSet } from 'svelte/reactivity';
import { STORAGE_KEYS, safeReadJson, safeWriteJson } from './storageKeys.js';

/**
 * The visitor's broad tag preference: "not this, anywhere." Local-only, same
 * as favorites and preferences — nothing here is a server-side query.
 *
 * An empty `tags` set means "no restriction," not "nothing matches": a
 * visitor who has set nothing sees everything, rather than an empty field.
 *
 * **The type filter that used to live here is gone.** Field nodes declare
 * their own content type, and a global type exclusion layered on top of that
 * would strand a node with a permanently empty pool, with the cause sitting
 * in a different part of the app than the symptom.
 *
 * **Tags did not follow it out.** This store was once slated for removal
 * once nodes carried their own tags, on the same argument. It stays, because
 * the two layers answer different questions — this one is a standing
 * preference that applies wherever entries are drawn, while a node's tags
 * shape one channel within it — and because the empty-pool objection is
 * answerable rather than fatal: `shortageCause` on the field page detects
 * exactly the case where this store is what emptied a node, and the node
 * says so and links here. See `nodeChannel.js` for how the layers compose
 * and `docs/decisions.md` for the reversal.
 *
 * This is deliberately not exposed as a control inside the field view
 * itself (brief section 7c: "the moment this view grows a filter control,
 * it has become a directory again").
 */
const STORAGE_KEY = STORAGE_KEYS.filters.key;

function load() {
	if (!browser) return { tags: [] };
	const parsed = safeReadJson(STORAGE_KEY, /** @type {{ tags?: unknown }} */ ({}));
	// `types` may still be present from a layout written before nodes carried
	// their own type. Read and discard rather than migrating: the setting no
	// longer has a meaning to migrate into.
	return { tags: Array.isArray(parsed.tags) ? parsed.tags : [] };
}

function createFiltersStore() {
	const initial = load();
	const tags = new SvelteSet(initial.tags);

	function persist() {
		if (!browser) return;
		safeWriteJson(STORAGE_KEY, { tags: [...tags] });
	}

	return {
		get tags() {
			return tags;
		},
		/** @param {string} tag */
		toggleTag(tag) {
			if (tags.has(tag)) {
				tags.delete(tag);
			} else {
				tags.add(tag);
			}
			persist();
		},
		clear() {
			tags.clear();
			persist();
		},
		/**
		 * Replaces the whole tag selection at once — used when a Field preset
		 * restores the global tag state it was saved with. Matches `load()`'s
		 * own defensive read: anything that isn't a string is dropped rather
		 * than trusted.
		 * @param {string[]} newTags
		 */
		setTags(newTags) {
			const clean = Array.isArray(newTags) ? newTags.filter((tag) => typeof tag === 'string') : [];
			tags.clear();
			for (const tag of clean) tags.add(tag);
			persist();
		},
		/** @param {import('./ring.js').RingEntry} entry */
		matches(entry) {
			return tags.size === 0 || entry.tags.some((tag) => tags.has(tag));
		}
	};
}

export const filtersStore = createFiltersStore();
