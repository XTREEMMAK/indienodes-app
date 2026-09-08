import { browser } from '$app/environment';
import { STORAGE_KEYS, safeReadJson, safeWriteJson } from './storageKeys.js';
import {
	ALLOWED_RATIOS,
	GRID_COLUMNS,
	MIN_W,
	defaultSizeFor,
	snapToAllowedShape
} from './nodeShape.js';
import { columnsForWidth } from './fieldLayout.js';
import { normalizeTags, pruneTagsForType } from './nodeChannel.js';

/**
 * The visitor's arranged field: which nodes exist, where they sit, how big
 * they are, and what type of entry each one pulls.
 *
 * Local-only, same as favorites and preferences. Mirrors their pattern
 * exactly (versioned key, browser guard, try/catch load, defensive parse),
 * because a corrupt or hand-edited layout should degrade to the default
 * arrangement rather than throwing on boot and leaving an empty page.
 *
 * A node is a *channel*, not a slot for a specific entry (docs/decisions.md):
 * it declares what kind of thing it shows, and entries flow through it. The
 * visitor can shape the pool but never pick the item. Both halves of that
 * declaration live here now: `type` and, since the semantic pass, `tags`.
 * `nodeChannel.js` owns what those two mean against a ring; this file only
 * stores them.
 */

const STORAGE_KEY = STORAGE_KEYS.layout.key;

/** @typedef {import('./nodeShape.js').NodeType} NodeType */
/** @typedef {{ id: string, type: NodeType, tags: string[], x: number, y: number, w: number, h: number }} FieldNodeConfig */

export { GRID_COLUMNS } from './nodeShape.js';

/**
 * Shipped arrangement, so a first-time visitor sees a composed field rather
 * than an empty canvas with an invitation to build one. Deliberately mixed:
 * square audio and game nodes beside a portrait comic and a portrait text
 * one, so the per-type shape rules are visible immediately rather than
 * being something you only discover by trying to resize.
 *
 * Small and masonry, not one big hero: an earlier version of this gave the
 * comic node a 16-wide hero shape, which read as "the biggest thing on the
 * page" rather than "one entry among several." Every node here starts at
 * `MIN_W`, the smallest width the shape rules allow, and comic/text/art take
 * the tall end of their ratio family (2:3) instead of the wide end, since a
 * type that is *allowed* to be tall reads as an actual choice only if the
 * default demonstrates it. Two columns is the simplest arrangement that
 * gives real masonry: the columns land at different total heights (the
 * right one, audio+game+art, ends up taller than comic+text) purely because
 * the nodes in them are different heights, the same reason a
 * Pinterest-style layout staggers instead of gridding evenly.
 *
 * One node per type, so a first visit shows what the ring actually holds.
 * That is the rule the arrangement serves, not the 2x2 it happened to be
 * when there were four types: Art was added as a fifth and took a slot for
 * the same reason the other four have one.
 *
 * Still centered, not full-width: the whole two-column block sits in the
 * middle of the canvas with margin on both sides, continuing the "a
 * composed column, not a viewport-filling spread" rule from before this.
 * This is still only the *first* visit's arrangement; anything the visitor
 * does after is what persists (`load()` below only reaches this when
 * nothing is already saved).
 *
 * Scales with `columns` rather than assuming exactly `GRID_COLUMNS`: a
 * hardcoded `x` centered the block only at exactly 24 columns, and most
 * ordinary screens hold more than that (a plain 1920px window is already 30
 * -- `columnsForWidth`), which put the block visibly left-of-center in the
 * extra room and left it the same small size regardless of how much space
 * there actually was. `Math.max(1, ...)` means a *narrower* first visit is
 * unaffected -- unchanged from before this, and still handled below
 * `GRID_COLUMNS` by `computeCenteredLayout`'s own reflow once the field
 * mounts. `snapToAllowedShape` both derives the scaled size and re-applies
 * each type's own bound (`MAX_W`/`MAX_H`), so this never has to cap the
 * scale factor itself -- an absurdly wide viewport just runs into the same
 * ceiling an oversized manual resize would.
 * @param {number} [columns] the field's column count at first render;
 *   defaults to the authored width for SSR/prerendering, where there is no
 *   viewport to measure and the previous fixed arrangement is exactly right.
 * @returns {FieldNodeConfig[]}
 */
export function defaultLayout(columns = GRID_COLUMNS) {
	const scale = Math.max(1, columns / GRID_COLUMNS);
	const unit = Math.round(MIN_W * scale);

	// [2, 3] (portrait) and [1, 1] (square) are exact ratio matches for the
	// desired w/h below at every scale, so snapping only ever clamps at the
	// type's own MAX_W/MAX_H bound -- it never picks a different ratio.
	const tall = snapToAllowedShape('comic', unit, Math.round((unit * 3) / 2));
	const square = snapToAllowedShape('audio', unit, unit);

	const blockW = tall.w + square.w;
	const columnA = Math.max(0, Math.floor((columns - blockW) / 2));
	const columnB = columnA + tall.w;

	// Every shipped node starts untagged. A first visit should show what the
	// ring actually holds, and a default tag selection would be this app
	// deciding a visitor's taste for them before they have seen anything.
	return [
		{ id: 'n-comic-1', type: 'comic', tags: [], x: columnA, y: 0, w: tall.w, h: tall.h },
		{ id: 'n-text-1', type: 'text', tags: [], x: columnA, y: tall.h, w: tall.w, h: tall.h },
		{ id: 'n-audio-1', type: 'audio', tags: [], x: columnB, y: 0, w: square.w, h: square.h },
		{
			id: 'n-game-1',
			type: 'game',
			tags: [],
			x: columnB,
			y: square.h,
			w: square.w,
			h: square.h
		},
		// Art sits at the foot of the right column rather than being left out:
		// every other type has a slot here, and a type that never appears on a
		// first visit is one no visitor discovers without going to Arrange
		// first. It takes the same 2:3 portrait as comic and text because it
		// belongs to the same wide-and-tall family, and putting it here is
		// also what keeps the two columns uneven — see the note above on why
		// that matters.
		{ id: 'n-art-1', type: 'art', tags: [], x: columnB, y: square.h * 2, w: tall.w, h: tall.h }
	];
}

const VALID_TYPES = Object.keys(ALLOWED_RATIOS);

/**
 * Coerces one stored record into a valid node, or null if it is too broken
 * to rescue. Sizes are re-snapped rather than trusted: the ratio rules may
 * have changed since the layout was written, and a stored shape that is no
 * longer legal would otherwise be un-resizable back into legality.
 * @param {unknown} raw
 * @returns {FieldNodeConfig | null}
 */
function coerceNode(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const node = /** @type {Record<string, unknown>} */ (raw);

	const id = typeof node.id === 'string' && node.id ? node.id : null;
	if (!id) return null;

	const type = /** @type {NodeType} */ (
		typeof node.type === 'string' && VALID_TYPES.includes(node.type) ? node.type : 'any'
	);

	const x = Number.isFinite(node.x) ? Math.max(0, Number(node.x)) : 0;
	const y = Number.isFinite(node.y) ? Math.max(0, Number(node.y)) : 0;
	const fallback = defaultSizeFor(type);
	const w = Number.isFinite(node.w) ? Number(node.w) : fallback.w;
	const h = Number.isFinite(node.h) ? Number(node.h) : fallback.h;
	const snapped = snapToAllowedShape(type, w, h);

	// A layout written before tags existed simply has no `tags` key, and
	// `normalizeTags` turns that (and anything else malformed) into "no
	// restriction" — which is exactly the right reading of a node that
	// predates the concept.
	return { id, type, tags: normalizeTags(node.tags), x, y, w: snapped.w, h: snapped.h };
}

/**
 * The field's column count at this exact moment, for sizing a freshly
 * generated default layout. `window.innerWidth` rather than the grid's own
 * measured container width, which nothing outside `FieldGrid.svelte` has —
 * this runs before any grid element exists, at store creation or on an
 * explicit reset. Close enough for a one-time starter arrangement: it is
 * only ever a column or so wider than the real container (page margins, the
 * scrollbar gutter), and the field's own responsive reflow corrects anything
 * that matters once it actually mounts.
 * @returns {number}
 */
function viewportColumns() {
	return browser ? columnsForWidth(window.innerWidth) : GRID_COLUMNS;
}

/** @returns {FieldNodeConfig[]} */
function load() {
	if (!browser) return defaultLayout();
	const parsed = safeReadJson(STORAGE_KEY, /** @type {unknown} */ (null));
	if (!Array.isArray(parsed)) return defaultLayout(viewportColumns());
	// An empty stored array is a real state (the visitor removed every node)
	// and is preserved. Only an unreadable one falls back.
	return parsed.map(coerceNode).filter((n) => n !== null);
}

let nextId = 0;

/**
 * How many arrangements back undo can reach. Bounded because history is
 * every node's geometry per step and arranging is a long series of small
 * moves; unbounded, a session spent nudging things would grow it without
 * limit for depth nobody reaches.
 */
const HISTORY_LIMIT = 50;

/**
 * Nodes are replaced rather than mutated everywhere in this file (every
 * method rebuilds the array through `map`/`filter`), so a snapshot only
 * needs to copy one level down to be safe against a later edit that
 * forgets that. `tags` is the one array inside a node, hence its own copy.
 * @param {FieldNodeConfig[]} list
 * @returns {FieldNodeConfig[]}
 */
function snapshot(list) {
	return list.map((node) => ({ ...node, tags: [...node.tags] }));
}

function createLayoutStore() {
	let nodes = $state(load());
	// Past arrangements, oldest first, each the whole field as it stood
	// *before* one change. Redo is the same thing forward. Deliberately not
	// persisted: it is a within-session affordance for the arranging you just
	// did, and restoring a stack of positions across reloads would let a
	// visitor undo their way into an arrangement from days ago.
	/** @type {FieldNodeConfig[][]} */
	let past = $state([]);
	/** @type {FieldNodeConfig[][]} */
	let future = $state([]);

	function persist() {
		if (!browser) return;
		// Quota or private-mode failures are not worth breaking the field over;
		// the arrangement just will not survive this session.
		safeWriteJson(STORAGE_KEY, nodes);
	}

	/**
	 * Records the arrangement as it stands right now, before the caller
	 * changes it. Every mutation below calls this first, so undo covers
	 * placement, sizing, adding, removing, retyping and retagging alike
	 * rather than only the ones that happen to move a node.
	 *
	 * Any new change discards the redo branch, which is the standard shape:
	 * once you undo twice and then do something else, the thing you undid is
	 * no longer reachable forward.
	 */
	/** @param {FieldNodeConfig[]} before */
	function pushHistory(before) {
		past = [...past, before].slice(-HISTORY_LIMIT);
		future = [];
	}

	function record() {
		pushHistory(snapshot(nodes));
	}

	return {
		get nodes() {
			return nodes;
		},

		get canUndo() {
			return past.length > 0;
		},

		get canRedo() {
			return future.length > 0;
		},

		/** Steps back one arrangement, keeping the current one for redo. */
		undo() {
			const previous = past.at(-1);
			if (!previous) return;
			past = past.slice(0, -1);
			future = [snapshot(nodes), ...future];
			nodes = previous;
			persist();
		},

		/** Steps forward again after an undo. */
		redo() {
			const next = future[0];
			if (!next) return;
			future = future.slice(1);
			past = [...past, snapshot(nodes)].slice(-HISTORY_LIMIT);
			nodes = next;
			persist();
		},

		/**
		 * Replaces stored geometry for the nodes gridstack reports as moved.
		 * Takes a partial list because gridstack's `change` event only
		 * reports what actually changed, not the whole grid.
		 * @param {{ id?: string, x?: number, y?: number, w?: number, h?: number }[]} changed
		 */
		applyGeometry(changed) {
			const before = snapshot(nodes);
			let touched = false;
			nodes = nodes.map((node) => {
				const update = changed.find((c) => c.id === node.id);
				if (!update) return node;
				touched = true;
				return {
					...node,
					x: update.x ?? node.x,
					y: update.y ?? node.y,
					w: update.w ?? node.w,
					h: update.h ?? node.h
				};
			});
			if (touched) {
				pushHistory(before);
				persist();
			}
		},

		/**
		 * Changes a node's content type, re-snapping its size because the new
		 * type may not permit the shape the old one had.
		 *
		 * Tags survive a retype where they still mean something and are
		 * dropped where they do not, which needs the ring to decide — hence
		 * `entries`. Passing none keeps every tag, which is the right
		 * fallback before the ring has loaded: silently emptying a visitor's
		 * configuration because a fetch had not finished would be worse than
		 * briefly keeping a tag that turns out to have no matches.
		 * @param {string} id
		 * @param {NodeType} type
		 * @param {import('./ring.js').RingEntry[]} [entries]
		 */
		setType(id, type, entries) {
			record();
			nodes = nodes.map((node) => {
				if (node.id !== id) return node;
				const snapped = snapToAllowedShape(type, node.w, node.h);
				const tags = entries ? pruneTagsForType(node.tags, entries, type) : node.tags;
				return { ...node, type, tags, w: snapped.w, h: snapped.h };
			});
			persist();
		},

		/**
		 * Replaces a node's tag selection. An empty array is a real value —
		 * "this channel adds no restriction of its own" — not a reset.
		 * @param {string} id
		 * @param {string[]} tags
		 */
		setTags(id, tags) {
			record();
			const normalized = normalizeTags(tags);
			nodes = nodes.map((node) => (node.id === id ? { ...node, tags: normalized } : node));
			persist();
		},

		/**
		 * Appends a node. Position is left to the caller (or to gridstack's
		 * auto-placement) rather than guessed here.
		 * @param {NodeType} type
		 * @returns {FieldNodeConfig}
		 */
		/**
		 * @param {import('./nodeShape.js').NodeType} type
		 * @param {{ x: number, y: number }} [at] Where to place it, in grid
		 *   cells. Defaults to the origin, which is only right when there is
		 *   no better answer: a node added from a right-click belongs where
		 *   the pointer was, not at the top-left corner of a field the
		 *   visitor may not even be looking at. The caller converts a pointer
		 *   position to cells, since only the grid knows its own pitch.
		 */
		add(type, at) {
			record();
			const size = defaultSizeFor(type);
			nextId += 1;
			const node = {
				id: `n-${type}-${Date.now().toString(36)}-${nextId}`,
				type,
				tags: /** @type {string[]} */ ([]),
				x: at?.x ?? 0,
				y: at?.y ?? 0,
				...size
			};
			nodes = [...nodes, node];
			persist();
			return node;
		},

		/**
		 * Reorders nodes to an arbitrary sequence.
		 *
		 * Exists for dragging below the authored column count, where x/y is
		 * never trustworthy geometry (see FieldGrid's `computeCenteredLayout`):
		 * a drop there is read as "put it here in the sequence" rather than
		 * "put it at this pixel," so this changes list order only and
		 * deliberately never touches x, y, w, or h. The wide, authored
		 * arrangement is positional, not order-based, so a phone reorder
		 * leaves it alone; a desktop visit still renders every node at its
		 * own saved coordinates regardless of what order this put them in.
		 *
		 * Ignored, rather than partially applied, if `order` does not contain
		 * exactly the current set of ids: a stale or partial read (the caller
		 * derives this from live DOM state) should do nothing instead of
		 * silently dropping a node.
		 * @param {string[]} order
		 */
		reorderTo(order) {
			if (order.length !== nodes.length) return;
			const byId = new Map(nodes.map((node) => [node.id, node]));
			if (!order.every((id) => byId.has(id))) return;
			record();
			nodes = order.map((id) => /** @type {FieldNodeConfig} */ (byId.get(id)));
			persist();
		},

		/** @param {string} id */
		remove(id) {
			record();
			nodes = nodes.filter((node) => node.id !== id);
			persist();
		},

		/** Restores the shipped arrangement, for an "undo my mess" affordance. */
		reset() {
			record();
			nodes = defaultLayout(viewportColumns());
			persist();
		}
	};
}

export const layoutStore = createLayoutStore();
