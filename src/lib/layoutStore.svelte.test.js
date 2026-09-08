import { describe, expect, it } from 'vitest';
import { defaultLayout } from './layoutStore.svelte.js';
import { GRID_COLUMNS, MAX_H, MAX_W, MIN_W, snapToAllowedShape } from './nodeShape.js';

/**
 * `defaultLayout` is the arrangement a fresh visitor sees before they have
 * touched anything. A hardcoded `x` centered it only at exactly
 * `GRID_COLUMNS`, and most real windows hold more columns than that (a plain
 * 1920px window is already 30 -- see `columnsForWidth`), which put the block
 * visibly left-of-center in the extra room and never let it grow to use any
 * of it. These pin the fix: centered at the authored width same as before,
 * and both centered and larger once there is real extra room.
 */

/**
 * @param {import('./layoutStore.svelte.js').FieldNodeConfig[]} nodes
 * @param {string} id
 */
const byId = (nodes, id) => nodes.find((n) => n.id === id);

describe('defaultLayout', () => {
	it('matches the originally authored arrangement at the authored width', () => {
		const nodes = defaultLayout(GRID_COLUMNS);
		expect(byId(nodes, 'n-comic-1')).toMatchObject({ x: 8, y: 0, w: 4, h: 6 });
		expect(byId(nodes, 'n-text-1')).toMatchObject({ x: 8, y: 6, w: 4, h: 6 });
		expect(byId(nodes, 'n-audio-1')).toMatchObject({ x: 12, y: 0, w: 4, h: 4 });
		expect(byId(nodes, 'n-game-1')).toMatchObject({ x: 12, y: 4, w: 4, h: 4 });
		expect(byId(nodes, 'n-art-1')).toMatchObject({ x: 12, y: 8, w: 4, h: 6 });
	});

	it('defaults to the authored width when called with no viewport at all', () => {
		expect(defaultLayout()).toEqual(defaultLayout(GRID_COLUMNS));
	});

	it('never shrinks below the authored size for a narrower-than-authored viewport', () => {
		// Below GRID_COLUMNS, FieldGrid's own computeCenteredLayout re-flows
		// the result anyway (see fieldLayout.js) -- what this guards is that
		// the *size* never drops below MIN_W just because the count did.
		const nodes = defaultLayout(12);
		expect(byId(nodes, 'n-comic-1')).toMatchObject({ w: 4, h: 6 });
		expect(byId(nodes, 'n-audio-1')).toMatchObject({ w: 4, h: 4 });
	});

	it('scales the block up and keeps it centered in a wider-than-authored viewport', () => {
		// 48 columns is exactly double the authored width, so the block
		// should be exactly double the authored size too.
		const nodes = defaultLayout(48);
		const comic = byId(nodes, 'n-comic-1');
		const audio = byId(nodes, 'n-audio-1');
		if (!comic || !audio) throw new Error('expected both nodes to exist');
		expect(comic).toMatchObject({ w: 8, h: 12 });
		expect(audio).toMatchObject({ w: 8, h: 8 });

		// Centered: the gap left of the block equals the gap right of it.
		const blockRight = audio.x + audio.w;
		const leftGap = comic.x;
		const rightGap = 48 - blockRight;
		expect(leftGap).toBe(rightGap);
	});

	it('keeps every node on a shape its own type already allows, at every scale', () => {
		// Round-tripping through snapToAllowedShape rather than asserting an
		// exact ratio: at some odd cell counts whole-cell rounding lands a
		// shade off the ideal 2:3 (nodeShape.js's own doc says as much --
		// "within half a cell of its nominal ratio"), and that is legitimate,
		// not a bug this should fail on. What has to hold is that the shape
		// is already stable -- snapping it again changes nothing.
		for (const columns of [GRID_COLUMNS, 30, 48, 96]) {
			for (const node of defaultLayout(columns)) {
				expect(snapToAllowedShape(node.type, node.w, node.h)).toEqual({
					w: node.w,
					h: node.h
				});
			}
		}
	});

	it('never exceeds each type’s own size bound on an extreme viewport', () => {
		const nodes = defaultLayout(1000);
		for (const node of nodes) {
			expect(node.w).toBeLessThanOrEqual(MAX_W);
			expect(node.h).toBeLessThanOrEqual(MAX_H);
			expect(node.w).toBeGreaterThanOrEqual(MIN_W);
		}
	});
});
