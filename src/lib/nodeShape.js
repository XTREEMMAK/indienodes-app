/**
 * Per-type shape rules for field nodes.
 *
 * Kept separate from `layoutStore` because three unrelated places need the
 * same rules and none of them should own them: the grid constrains resizing
 * to them, the card renders its `aspect-ratio` from them, and the store
 * validates against them when loading a layout it did not write.
 *
 * The constraint is real, not cosmetic (docs/decisions.md): audio and game
 * ornaments are physical objects (a record player, a console), and a
 * stretched record player is exactly the failure the ornamental direction
 * exists to avoid. Comic, text, and art tolerate a banner shape.
 */

/** @typedef {'audio' | 'comic' | 'text' | 'game' | 'art' | 'craft' | 'any'} NodeType */

/**
 * Columns the grid is authored against.
 *
 * 24 rather than 12 because cells are square and a 16:9 node therefore needs
 * w/h = 16/9 in whole cells. The only size satisfying that within a sane
 * column count is 16x9, which simply does not fit in a 12 column grid. At 12
 * the widest thing expressible was 2:1, so asking for 16:9 quietly produced
 * something else. 24 also gives finer resize steps.
 */
export const GRID_COLUMNS = 24;

/** Width bounds in cells. A node narrower than this has no room for its text. */
export const MIN_W = 4;
export const MAX_W = GRID_COLUMNS;
/** Height bound, which also stops a square node filling the whole viewport. */
export const MAX_H = 16;

/**
 * The shape ladder for types that are not locked to square, tallest to
 * widest. Portrait entries are not decoration: a comic page and an article
 * are both taller than they are wide, and an earlier version of this list
 * ran from 1:1 to 2:1 with nothing above square at all, so dragging a comic
 * node taller could only ever snap back down to a square.
 * @type {[number, number][]}
 */
const WIDE_AND_TALL = [
	[9, 16],
	[2, 3],
	[3, 4],
	[1, 1],
	[3, 2],
	[16, 9],
	[2, 1]
];

/**
 * Shapes a type may take, as [w, h] ratios.
 *
 * Ratios, not a menu of fixed sizes. The fixed-size version snapped every
 * drag to the nearest of six discrete sizes, and the gaps between those were
 * far larger than a normal drag: pulling a 16x9 node to 14x9, 18x9, 20x9, or
 * 16x6 all landed back on 16x9, so resizing looked like it silently refused
 * to commit. Constraining the ratio while leaving width continuous means
 * every drag produces a change, and the shape still cannot go anywhere the
 * type disallows.
 * @type {Record<NodeType, [number, number][]>}
 */
export const ALLOWED_RATIOS = {
	audio: [[1, 1]],
	game: [[1, 1]],
	comic: WIDE_AND_TALL,
	text: WIDE_AND_TALL,
	art: WIDE_AND_TALL,
	craft: WIDE_AND_TALL,
	any: WIDE_AND_TALL
};

/**
 * @param {NodeType} type
 * @returns {boolean} whether this type is locked to square
 */
export function isSquareLocked(type) {
	return (ALLOWED_RATIOS[type] ?? ALLOWED_RATIOS.any).length === 1;
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

/**
 * Snaps a dragged size to the nearest shape this type permits.
 *
 * Width follows the pointer (clamped), and height is derived from whichever
 * allowed ratio is closest to what was dragged. So dragging the side edge
 * resizes, and dragging the bottom edge changes which ratio family the node
 * is in, which is the intuitive reading of both gestures.
 *
 * Heights are rounded to whole cells, so a ratio is exact only where it
 * divides evenly (16:9 at w=16, 3:2 at any multiple of 3). Everywhere else
 * the card is within half a cell of its nominal ratio, which is not visually
 * distinguishable at these sizes.
 *
 * @param {NodeType} type
 * @param {number} w desired width in cells
 * @param {number} h desired height in cells
 * @returns {{ w: number, h: number }} a permitted size
 */
export function snapToAllowedShape(type, w, h) {
	const ratios = ALLOWED_RATIOS[type] ?? ALLOWED_RATIOS.any;
	const draggedW = Math.max(1, Math.round(w));
	const draggedH = Math.max(1, Math.round(h));
	const desired = draggedW / draggedH;

	let best = ratios[0];
	let bestDelta = Infinity;
	for (const ratio of ratios) {
		const delta = Math.abs(ratio[0] / ratio[1] - desired);
		if (delta < bestDelta) {
			bestDelta = delta;
			best = ratio;
		}
	}

	let width = clamp(draggedW, MIN_W, MAX_W);
	let height = Math.max(1, Math.round((width * best[1]) / best[0]));

	// A tall ratio at full width can exceed the height bound; give up width
	// rather than the ratio, since the ratio is the part being constrained.
	if (height > MAX_H) {
		height = MAX_H;
		width = clamp(Math.round((height * best[0]) / best[1]), MIN_W, MAX_W);
	}

	return { w: width, h: height };
}

/**
 * The CSS `aspect-ratio` value a card should render at for a given size.
 * Derived from the node's actual w/h rather than stored separately, so the
 * card can never disagree with the grid about its own shape.
 * @param {number} w
 * @param {number} h
 */
export function aspectRatioFor(w, h) {
	return `${Math.max(1, w)} / ${Math.max(1, h)}`;
}

/**
 * A node's default size when first created, in grid cells.
 *
 * `MIN_W`, matching the first-visit arrangement in `layoutStore`, rather than
 * the 8 cells this used to ask for. Eight is a third of the canvas: dropping
 * one in pushed everything already placed out of its way, so adding a node to
 * a field someone had arranged re-arranged it for them. Starting at the
 * smallest legal width makes adding a node additive, and resizing it up
 * afterwards is one drag on a grip that is already there.
 * @param {NodeType} type
 */
export function defaultSizeFor(type) {
	return snapToAllowedShape(type, MIN_W, MIN_W);
}
