import { browser } from '$app/environment';
import { STORAGE_KEYS, safeReadJson, safeWriteJson } from './storageKeys.js';
import { layoutStore } from './layoutStore.svelte.js';
import { filtersStore } from './filtersStore.svelte.js';

/**
 * Saved Field workspaces: a fixed set of five local-only slots, each
 * snapshotting both halves of a Field together — the arrangement
 * (`layoutStore`) and the visitor's global tag preference (`filtersStore`) —
 * since a workspace described only by node layout, without which global tags
 * were active, would not reproduce what the visitor actually saw. See
 * docs/roadmap.md's "Field presets" section for the fuller reasoning.
 *
 * Five fixed slots rather than an unlimited named list: there is no
 * account/cloud layer in this app to justify more, and everything else in
 * `STORAGE_KEYS` is local-only the same way.
 *
 * Loading a slot goes through `layoutStore.restore()`, which pushes the
 * pre-load arrangement onto undo history before replacing it — loading a
 * preset is itself undoable, same as every other mutation in that store —
 * and re-validates every node the same defensive way `layoutStore.load()`
 * does for anything read from storage.
 */

const STORAGE_KEY = STORAGE_KEYS.fieldPresets.key;
const SLOT_COUNT = 5;

/** @typedef {{ name: string, nodes: unknown[], filters: string[] }} FieldPreset */

/**
 * @param {import('./layoutStore.svelte.js').FieldNodeConfig[]} nodes
 * @returns {unknown[]}
 */
function cloneNodes(nodes) {
	return nodes.map((node) => ({ ...node, tags: [...node.tags] }));
}

/**
 * Coerces one stored slot into a valid preset, or null (an empty slot) if it
 * is too broken to rescue — a hand-edited or corrupted entry degrades to
 * "empty" rather than throwing.
 * @param {unknown} raw
 * @returns {FieldPreset | null}
 */
function coerceSlot(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const record = /** @type {Record<string, unknown>} */ (raw);
	const name = typeof record.name === 'string' && record.name.trim() ? record.name : null;
	if (!name) return null;
	return {
		name,
		nodes: Array.isArray(record.nodes) ? record.nodes : [],
		filters: Array.isArray(record.filters)
			? record.filters.filter((tag) => typeof tag === 'string')
			: []
	};
}

/** @returns {(FieldPreset | null)[]} */
function load() {
	/** @type {(FieldPreset | null)[]} */
	const slots = Array(SLOT_COUNT).fill(null);
	if (!browser) return slots;
	const parsed = safeReadJson(STORAGE_KEY, /** @type {unknown} */ (null));
	const arr = Array.isArray(parsed) ? parsed : [];
	for (let i = 0; i < SLOT_COUNT; i++) slots[i] = coerceSlot(arr[i]);
	return slots;
}

function createFieldPresetsStore() {
	let slots = $state(load());

	function persist() {
		if (!browser) return;
		safeWriteJson(STORAGE_KEY, slots);
	}

	return {
		get slots() {
			return slots;
		},
		slotCount: SLOT_COUNT,

		/**
		 * Saves the current arrangement and global tag selection into a slot,
		 * overwriting whatever was there.
		 * @param {number} index
		 * @param {string} name
		 */
		save(index, name) {
			if (index < 0 || index >= SLOT_COUNT) return;
			const trimmed = name?.trim();
			const next = slots.slice();
			next[index] = {
				name: trimmed || `Preset ${index + 1}`,
				nodes: cloneNodes(layoutStore.nodes),
				filters: [...filtersStore.tags]
			};
			slots = next;
			persist();
		},

		/**
		 * @param {number} index
		 * @param {string} name
		 */
		rename(index, name) {
			const trimmed = name?.trim();
			const slot = slots[index];
			if (!slot || !trimmed) return;
			const next = slots.slice();
			next[index] = { ...slot, name: trimmed };
			slots = next;
			persist();
		},

		/** @param {number} index */
		clear(index) {
			if (index < 0 || index >= SLOT_COUNT) return;
			const next = slots.slice();
			next[index] = null;
			slots = next;
			persist();
		},

		/**
		 * Restores a slot's arrangement and tag selection. See this file's
		 * own doc comment for why loading is undoable.
		 * @param {number} index
		 */
		load(index) {
			const slot = slots[index];
			if (!slot) return;
			layoutStore.restore(slot.nodes);
			filtersStore.setTags(slot.filters);
		}
	};
}

export const fieldPresetsStore = createFieldPresetsStore();
