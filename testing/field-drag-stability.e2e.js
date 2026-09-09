import { expect, test } from '@playwright/test';

/**
 * The field is an open canvas at its full authored column count everywhere
 * above the mobile stack, so a node renders where it was actually arranged and
 * a drop is a placement rather than a suggestion.
 *
 * These cover the two things that used to break that. One was a bug: the
 * responsive layout pass read the measured cell pitch, gridstack resizes the
 * grid container continuously while a node is in flight, so the pass ran
 * mid-drag and repositioned the node under the pointer — which both snapped it
 * back and left gridstack refusing every later move of that drag, while the
 * neighbours it had already pushed aside kept their pushed positions. The
 * other was the column ladder itself: below the authored width a node wider
 * than the grid was clamped, so coordinates could not be trusted, so the whole
 * arrangement was re-derived from reading order and re-centered on every
 * resize. Holding 24 columns removes the clamp, and with it the re-derivation.
 */

/** Engine-side geometry, which is the runtime truth while a grid is live. */
const geometry = (page) =>
	page.evaluate(() =>
		Object.fromEntries(
			[...document.querySelectorAll('.grid-stack-item[gs-id]')].map((el) => [
				el.getAttribute('gs-id'),
				`${el.gridstackNode?.x},${el.gridstackNode?.y}`
			])
		)
	);

/** Like `geometry`, but carrying w/h too -- for the resize suite below,
 * which needs to compare sizes, not just position. */
const geometryWithSize = (page) =>
	page.evaluate(() =>
		Object.fromEntries(
			[...document.querySelectorAll('.grid-stack-item[gs-id]')].map((el) => {
				const n = el.gridstackNode;
				return [el.getAttribute('gs-id'), { x: n?.x, y: n?.y, w: n?.w, h: n?.h }];
			})
		)
	);

/**
 * Where each card is actually painted, in viewport pixels. Unlike `geometry`
 * this is deliberately *not* the engine's answer: the live group-move preview
 * is a CSS transform the engine knows nothing about, so mid-gesture the two
 * disagree on purpose.
 */
const paintedAt = (page) =>
	page.evaluate(() =>
		Object.fromEntries(
			[...document.querySelectorAll('.grid-stack-item[gs-id]')].map((el) => {
				const box = el.getBoundingClientRect();
				return [el.getAttribute('gs-id'), { x: box.x, y: box.y }];
			})
		)
	);

/** The saved layout, or null when nothing has been persisted this session. */
const stored = (page) =>
	page.evaluate(() => {
		const raw = localStorage.getItem('indienode:layout:v1');
		return raw
			? Object.fromEntries(JSON.parse(raw).map((node) => [node.id, `${node.x},${node.y}`]))
			: null;
	});

const storedOrder = (page) =>
	page.evaluate(() => {
		const raw = localStorage.getItem('indienode:layout:v1');
		return raw ? JSON.parse(raw).map((node) => node.id) : null;
	});

/**
 * Width reserved by `scrollbar-gutter: stable` (app.css). A fixed element fills
 * the viewport minus this strip, and nothing is painted inside it.
 */
const GUTTER_PX = 16;

const columnsNow = (page) =>
	page.evaluate(() => document.querySelector('.grid-stack').gridstack.getColumn());

/**
 * Presses on a card's middle and nudges once, which is what gridstack treats
 * as the start of a real drag.
 *
 * The middle specifically, because both ends of a card are drag-cancelling
 * controls: the configuration bar along the top and the Visit link near the
 * bottom, both of which match gridstack's `cancel` selector. On the open
 * canvas a card can be as little as 128px tall, so an offset that clears them
 * comfortably at desktop sizes lands squarely on one of them further down.
 *
 * Scrolled into view first: a node far enough down the field (the default
 * arrangement's own nodes now scale up with a wide first-load viewport, see
 * layoutStore's defaultLayout) can render below the fold in a short test
 * viewport, and `page.mouse.move` targets absolute viewport coordinates with
 * no auto-scroll of its own the way a locator action gets for free.
 */
async function pressOn(page, id) {
	const locator = page.locator(`.grid-stack-item[gs-id="${id}"]`);
	await locator.scrollIntoViewIfNeeded();

	// Measured, aimed at, and then *checked*, up to a few times.
	//
	// A drop makes the field taller or shorter and gridstack auto-scrolls
	// while a card is carried past the edge of the window, so the page can
	// still be settling when the next gesture is measured — and a box read a
	// moment before the press can be stale by the time the press lands, which
	// puts the pointer on whatever card has scrolled into that spot instead.
	// Caught in the act: a drag meant for one node reported another as the one
	// it moved, and the test read that as the drop having been ignored. The
	// check is what makes a press mean the card it names.
	let from = { x: 0, y: 0 };
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const box = await locator.boundingBox();
		if (!box) throw new Error(`${id} has no bounding box`);
		from = { x: box.x + box.width / 2, y: box.y + box.height * 0.45 };
		await page.mouse.move(from.x, from.y);
		const under = await page.evaluate(
			([x, y]) =>
				document.elementFromPoint(x, y)?.closest('.grid-stack-item')?.getAttribute('gs-id') ?? null,
			[from.x, from.y]
		);
		if (under === id) break;
		if (attempt === 3) throw new Error(`press for ${id} kept landing on ${under}`);
		// Let whatever is still moving finish before measuring again.
		await page.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
		);
	}

	await page.mouse.down();
	await page.mouse.move(from.x + 3, from.y + 3);
	return from;
}

/**
 * The column count follows the width now, so a test asks for the *mode* it
 * needs rather than a number: 'canvas' is any width holding at least the
 * authored count, where nodes render at their own coordinates, and 'stack' is
 * the narrowest layout, where a drop means reorder.
 */
async function arrangeAt(page, width, mode = 'canvas') {
	await page.setViewportSize({ width, height: 1000 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	await page.getByRole('button', { name: 'Arrange field' }).click();
	if (mode === 'stack') await expect.poll(() => columnsNow(page)).toBe(4);
	else await expect.poll(() => columnsNow(page)).toBeGreaterThanOrEqual(24);
}

test('the arrangement is identical at every width above the mobile stack', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	await expect.poll(() => columnsNow(page)).toBeGreaterThanOrEqual(24);
	const composed = await geometry(page);

	// The whole point of holding the authored column count: a composition
	// survives a resize instead of being re-flowed into centered rows.
	for (const width of [2400, 2000, 1750, 1620, 1600]) {
		await page.setViewportSize({ width, height: 1000 });
		await expect.poll(() => columnsNow(page)).toBeGreaterThanOrEqual(24);
		await expect.poll(() => geometry(page)).toEqual(composed);
	}
});

test('cards hold their size and the canvas gains columns instead', async ({ page }) => {
	// The complaint this answers: cards scaled with the viewport, shrinking
	// until a card's own container query dropped the `why` line under the title
	// and clipped the Visit button.
	const card = () =>
		page.evaluate(() => {
			const node = document.querySelector('.grid-stack-item[gs-id="n-comic-1"] .node');
			const why = node?.querySelector('.why');
			const box = node.getBoundingClientRect();
			const grid = document.querySelector('.grid-stack').getBoundingClientRect();
			const room = document.querySelector('.grid-viewport').getBoundingClientRect();
			return {
				width: Math.round(box.width),
				height: Math.round(box.height),
				why: why ? getComputedStyle(why).display !== 'none' : false,
				columns: document.querySelector('.grid-stack').gridstack.getColumn(),
				unusable: Math.round(room.width - grid.width)
			};
		});

	await page.setViewportSize({ width: 2560, height: 1000 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	await page.waitForTimeout(400);
	// Read once the field settles, rather than hardcoding a literal size: the
	// default arrangement's own starting size now scales with the viewport it
	// first loads at (see layoutStore's defaultLayout), so what this test
	// guards is that resizing afterward never changes it, not any specific
	// number of pixels.
	const expectedWidth = (await card()).width;
	for (const width of [2560, 1920, 1608, 1400, 1200, 900, 600]) {
		await page.setViewportSize({ width, height: 1000 });
		// Polled rather than read once: a resize re-derives the column count and
		// then re-applies the arrangement, so the first frame after it is still
		// the old layout in the new room.
		await expect
			.poll(
				async () => {
					const c = await card();
					// The same card at every width, give or take the slack a whole
					// number of columns leaves in a row — not one tracking the
					// window. Percentage rather than a flat pixel budget: near the
					// narrow end a column's own width stops being exactly
					// CANVAS_CELL_PX and flexes to fill the container evenly
					// instead (see columnsForWidth), which is a bigger absolute
					// swing for a wider card than a slim one.
					return Math.abs(c.width - expectedWidth) < expectedWidth * 0.1;
				},
				{ message: `card width at ${width}px` }
			)
			.toBe(true);
		const now = await card();
		expect(now.why, `why line at ${width}px`).toBe(true);
		expect(now.height, `card height at ${width}px`).toBeGreaterThan(240);
		// And the canvas uses the whole width rather than centring in it.
		expect(now.unusable, `dead margin at ${width}px`).toBeLessThanOrEqual(1);
	}

	// A wider screen buys more canvas, not bigger cards.
	await page.setViewportSize({ width: 2560, height: 1000 });
	await expect.poll(() => card().then((c) => c.columns)).toBeGreaterThan(24);
});

test('fit-to-view caps the column count without pinning it', async ({ page }) => {
	const state = () =>
		page.evaluate(() => {
			const grid = document.querySelector('.grid-stack');
			const room = document.querySelector('.grid-viewport').getBoundingClientRect();
			const card = document.querySelector(
				'.grid-stack-item[gs-id] .node, .grid-stack-item[gs-id] .empty-node'
			);
			return {
				columns: grid.gridstack.getColumn(),
				cardWidth: card ? Math.round(card.getBoundingClientRect().width) : 0,
				unusable: Math.round(room.width - grid.getBoundingClientRect().width),
				columnsUsed: new Set(
					[...document.querySelectorAll('.grid-stack-item[gs-id]')].map((el) => el.gridstackNode.x)
				).size
			};
		});

	await page.setViewportSize({ width: 2110, height: 1000 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	await page.evaluate(() => {
		const key = 'indienode:preferences:v1';
		const prefs = JSON.parse(localStorage.getItem(key) ?? '{}');
		prefs.fitToView = true;
		localStorage.setItem(key, JSON.stringify(prefs));
	});
	await page.reload();
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();

	// Upward it caps: the composition fills a wide screen instead of sitting in
	// the left of a canvas wider than it, and no dead margin is left either side.
	await expect.poll(() => state().then((s) => s.columns)).toBe(24);
	expect((await state()).unusable).toBeLessThanOrEqual(1);

	// Downward it must still collapse. Pinning the authored count onto smaller
	// screens rendered cards at 119px, then 45px, and never reached a single
	// column — a composition preserved in name only.
	// Polled on the card, not the count: the count drops a frame before the
	// arrangement is re-applied underneath it.
	await page.setViewportSize({ width: 872, height: 1000 });
	await expect
		.poll(
			async () => {
				const now = await state();
				return now.columns < 24 && now.cardWidth > 200;
			},
			{ message: 'collapsed and legible at 872px' }
		)
		.toBe(true);

	await page.setViewportSize({ width: 426, height: 1000 });
	await expect
		.poll(
			async () => {
				const now = await state();
				return now.columns === 4 && now.cardWidth > 200;
			},
			{ message: 'single legible column at 426px' }
		)
		.toBe(true);
	const narrow = await state();
	// One column: every node starts at the same x.
	expect(narrow.columnsUsed).toBe(1);
	expect(narrow.unusable).toBeLessThanOrEqual(1);
});

test('the narrowest layout is one full-width column', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 900 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	await expect.poll(() => columnsNow(page)).toBe(4);

	// Every node on its own row, filling the width rather than sitting in a
	// column with margin either side.
	const placed = await geometry(page);
	for (const cell of Object.values(placed)) expect(cell.split(',')[0]).toBe('0');
	const fills = await page.evaluate(() => {
		const grid = document.querySelector('.grid-stack').getBoundingClientRect();
		const vp = document.querySelector('.grid-viewport').getBoundingClientRect();
		return Math.round(vp.width - grid.width);
	});
	expect(fills).toBe(0);
});

test('the field never scrolls sideways at any width', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	for (const width of [1600, 1205, 1100, 900, 700, 500, 390]) {
		await page.setViewportSize({ width, height: 1000 });
		await page.waitForTimeout(250);
		const overflows = await page.evaluate(() => {
			const vp = document.querySelector('.grid-viewport');
			return vp.scrollWidth > vp.clientWidth + 1;
		});
		expect(overflows, `overflow at ${width}px`).toBe(false);
	}
});

test('the arrange grid fills the viewport, not just the arrangement', async ({ page }) => {
	// It is the surface the field is arranged on, so it covers the whole screen
	// however few nodes there are and however far down they reach — and, being
	// out of flow, it cannot add a pixel of scroll to the page doing it.
	await page.setViewportSize({ width: 1400, height: 700 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();

	const restingHeight = await page.evaluate(() => document.documentElement.scrollHeight);
	await page.getByRole('button', { name: 'Arrange field' }).click();
	await expect(page.locator('.arrange-canvas')).toBeVisible();

	const covers = () =>
		page.evaluate(() => {
			const dots = document.querySelector('.arrange-canvas').getBoundingClientRect();
			const lowest = [...document.querySelectorAll('.grid-stack-item[gs-id]')].reduce(
				(deepest, el) => Math.max(deepest, el.getBoundingClientRect().bottom),
				0
			);
			return {
				left: Math.round(dots.left),
				top: Math.round(dots.top),
				width: Math.round(dots.width),
				height: Math.round(dots.height),
				// The gutter reserved for the scrollbar is not part of the
				// viewport a fixed element fills, and nothing is painted there.
				win: `${document.documentElement.clientWidth}x${window.innerHeight}`,
				pastLowestNode: dots.bottom > lowest
			};
		});

	const box = await covers();
	expect(box).toMatchObject({ left: 0, top: 0, height: 700 });
	// Everything but the strip reserved for the scrollbar, which is not part of
	// the viewport a fixed element fills and has nothing painted in it.
	expect(box.width).toBeGreaterThanOrEqual(Number.parseInt(box.win, 10) - GUTTER_PX);

	// Arranging must not lengthen the page: an earlier version gave the canvas a
	// min-height, which made an absolutely positioned box overflow its parent.
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollHeight))
		.toBe(restingHeight);

	// Still the whole viewport once the field scrolls beneath it, and the
	// lattice follows the grid so the dots stay on real cell boundaries.
	await page.evaluate(() => window.scrollTo(0, 200));
	await expect.poll(covers).toMatchObject({ left: 0, top: 0, height: 700 });
	const tracks = await page.evaluate(() => {
		const canvas = document.querySelector('.arrange-canvas');
		const grid = document.querySelector('.grid-stack').getBoundingClientRect();
		return Math.abs(Number.parseFloat(canvas.style.getPropertyValue('--dot-y')) - grid.top) <= 1;
	});
	expect(tracks).toBe(true);
});

test('every node shows what type it is while being arranged', async ({ page }) => {
	// Resizing a node is exactly when you need to know which kind it is, and an
	// empty one has no artwork to say so — it is otherwise a blank rectangle.
	// The whole row carrying the badge used to be hidden here, on the reasoning
	// that the node's own menu states the type; that meant opening a menu per
	// node to read something a chip already says.
	await page.setViewportSize({ width: 1700, height: 950 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	await page.getByRole('button', { name: 'Arrange field' }).click();

	await expect
		.poll(() =>
			page.evaluate(() =>
				[...document.querySelectorAll('.grid-stack-item[gs-id]')].every((el) => {
					const badge = el.querySelector('.type-badge');
					return (
						badge &&
						getComputedStyle(badge).visibility !== 'hidden' &&
						badge.textContent.trim().length > 0
					);
				})
			)
		)
		.toBe(true);

	// Including the ones with nothing in them, which is the case that needs it.
	const empties = await page.evaluate(
		() => document.querySelectorAll('.grid-stack-item[gs-id] .empty-node .type-badge').length
	);
	expect(empties).toBeGreaterThan(0);

	// The curate toggles still go: they sit above the configuration layer and
	// covered the Remove control underneath it.
	await expect(page.locator('.grid-stack-item .curate-controls')).toHaveCount(0);
});

test('the arrange intro sweeps the whole viewport, not just the grid', async ({ page }) => {
	await page.setViewportSize({ width: 1700, height: 950 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	await page.waitForTimeout(400);
	await page.getByRole('button', { name: 'Arrange field' }).click();

	// The dot canvas is the full screen, but the sweep was generated one column
	// per *grid* column from the grid's own left edge, so it rippled across the
	// arrangement and left the gutters bare until the resting grid popped in.
	const spans = await page.evaluate(() => {
		const cols = [...document.querySelectorAll('.dot-wave-col')];
		if (!cols.length) return null;
		const rects = cols.map((c) => c.getBoundingClientRect());
		return {
			left: Math.min(...rects.map((r) => r.left)) <= 0,
			right: Math.max(...rects.map((r) => r.right)) >= window.innerWidth
		};
	});
	expect(spans).toEqual({ left: true, right: true });
});

test('the intro sweep lands on the lattice it hands over to', async ({ page }) => {
	// The sweep draws the same dot pattern the resting canvas does, then hands
	// over to it. Both have to be on the same lattice or the whole grid appears
	// to jump into place as the animation ends — which it did: the canvas offsets
	// its dots by --dot-y to follow the grid, and the sweep's columns did not, so
	// they sat a third of a cell out.
	await page.setViewportSize({ width: 1700, height: 950 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	await page.waitForTimeout(400);
	await page.getByRole('button', { name: 'Arrange field' }).click();
	await expect(page.locator('.dot-wave-col').first()).toBeAttached();

	const offset = await page.evaluate(() => {
		const canvas = document.querySelector('.arrange-canvas');
		const column = document.querySelector('.dot-wave-col');
		const style = getComputedStyle(column);
		const cell = Number.parseFloat(style.backgroundSize);
		const canvasPos = getComputedStyle(canvas).backgroundPosition.split(' ');
		const columnPos = style.backgroundPosition.split(' ');
		// Untransformed layout position: the sweep animation is mid-flight and
		// its translate would otherwise be read as a lattice difference.
		const wrap = (value) => ((value % cell) + cell) % cell;
		return {
			cell,
			y: wrap(
				Number.parseFloat(canvasPos[1]) - (column.offsetTop + Number.parseFloat(columnPos[1]))
			),
			x: wrap(
				Number.parseFloat(canvasPos[0]) - (column.offsetLeft + Number.parseFloat(columnPos[0]))
			)
		};
	});

	// Whole cells apart is the same lattice; anything in between is a visible jump.
	const nearZero = (value) => Math.min(value, offset.cell - value);
	expect(nearZero(offset.y), 'vertical lattice').toBeLessThan(1);
	expect(nearZero(offset.x), 'horizontal lattice').toBeLessThan(1);
});

test('the grid stays under the whole viewport mid-drag', async ({ page }) => {
	// Dragging a node up shortens the field. The canvas used to be sized to the
	// grid, so the height that freed up showed bare page until the drop landed.
	await arrangeAt(page, 1700);
	const box = await page.locator('.grid-stack-item[gs-id="n-art-1"]').boundingBox();
	if (!box) throw new Error('the art node has no bounding box');
	const from = { x: box.x + box.width / 2, y: box.y + box.height * 0.45 };
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 3, from.y + 3);
	await page.mouse.move(from.x, from.y - 300, { steps: 20 });

	const covers = await page.evaluate(() => {
		const d = document.querySelector('.arrange-canvas').getBoundingClientRect();
		return (
			d.top <= 1 &&
			d.left <= 1 &&
			d.bottom >= window.innerHeight - 2 &&
			// Bar the strip reserved for the scrollbar; see GUTTER_PX.
			d.right >= document.documentElement.clientWidth - 16
		);
	});
	await page.mouse.up();
	expect(covers).toBe(true);
});

test('the page width does not depend on the field being tall', async ({ page }) => {
	// The shake this prevents was a loop, not a jitter. The field's cell pitch
	// comes from the container width; the drag margin under it used to be four
	// cells deep; so the document's *height* depended on its *width*. With
	// classic space-taking scrollbars — overlay scrollbars hide this entirely —
	// dragging a node down grew the page, summoned the scrollbar, narrowed the
	// container, shrank the cell, shrank the page, dismissed the scrollbar, and
	// went round again.
	await page.setViewportSize({ width: 1700, height: 700 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();

	// One edge: the gutter is reserved whether or not a scrollbar is showing.
	await expect
		.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter))
		.toBe('stable');

	// The other: the drag margin is a fixed length, so growing or shrinking the
	// cell cannot move the document's height.
	await page.getByRole('button', { name: 'Arrange field' }).click();
	const measure = () =>
		page.evaluate(() => ({
			pad: getComputedStyle(document.querySelector('.grid-stack')).paddingBottom,
			cell: document.querySelector('.grid-viewport').style.getPropertyValue('--cell-h')
		}));
	await expect.poll(() => measure().then((m) => m.pad)).not.toBe('0px');
	const wide = await measure();

	await page.setViewportSize({ width: 900, height: 700 });
	await expect.poll(() => measure().then((m) => m.cell)).not.toBe(wide.cell);
	const narrow = await measure();
	expect(narrow.pad, 'drag margin must not track the cell pitch').toBe(wide.pad);

	// And the usable width is the same either side of the change.
	const widths = await page.evaluate(() => ({
		client: document.documentElement.clientWidth,
		win: window.innerWidth
	}));
	expect(widths.win - widths.client).toBeLessThanOrEqual(20);
});

test('resizing back and forth while arranging settles instead of looping', async ({ page }) => {
	// The crash this guards: the layout effect wrote positions, gridstack
	// announced them, the change listener re-measured, and the measurement was
	// state the effect reads — so it ran again. It only terminated if the engine
	// landed exactly where the effect asked, and top gravity in the re-arranging
	// tier does not always allow that (the shelf packer leaves a gap under a
	// short node beside a tall one; gravity pulls the next row into it).
	const errors = [];
	page.on('pageerror', (error) => errors.push(String(error).split('\n')[0]));

	await page.setViewportSize({ width: 1000, height: 900 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	// Rows that mix tall and short nodes, which is what creates the gaps.
	await page.evaluate(() => {
		localStorage.setItem(
			'indienode:layout:v1',
			JSON.stringify([
				{ id: 'n-comic-1', type: 'comic', tags: [], x: 0, y: 0, w: 4, h: 6 },
				{ id: 'n-audio-1', type: 'audio', tags: [], x: 4, y: 0, w: 4, h: 4 },
				{ id: 'n-game-1', type: 'game', tags: [], x: 8, y: 0, w: 4, h: 4 },
				{ id: 'n-text-1', type: 'text', tags: [], x: 12, y: 0, w: 4, h: 6 },
				{ id: 'n-art-1', type: 'art', tags: [], x: 16, y: 0, w: 4, h: 6 }
			])
		);
	});
	await page.reload();
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	await page.getByRole('button', { name: 'Arrange field' }).click();
	await page.waitForTimeout(600);

	await page.evaluate(() => {
		window.__updates = 0;
		const grid = document.querySelector('.grid-stack').gridstack;
		const update = grid.update.bind(grid);
		grid.update = (...args) => {
			window.__updates += 1;
			return update(...args);
		};
	});

	// Down through the tiers and back up, which is the reported gesture.
	for (const width of [900, 800, 700, 600, 480, 600, 700, 800, 900, 1000]) {
		await page.setViewportSize({ width, height: 900 });
		await page.waitForTimeout(200);
	}

	// Whatever it did on the way, it has to stop when the resizing does.
	await page.evaluate(() => {
		window.__updates = 0;
	});
	await page.waitForTimeout(1500);
	expect(await page.evaluate(() => window.__updates), 'still writing while idle').toBe(0);
	expect(errors).toEqual([]);
});

test('an abandoned drag leaves every node where it was', async ({ page }) => {
	await arrangeAt(page, 1700);
	const before = await geometry(page);
	const cell = await page.evaluate(() =>
		document.querySelector('.grid-stack').gridstack.cellWidth()
	);

	// Five cells left, which lands audio squarely across comic rather than
	// clipping its edge: gridstack only pushes a neighbour once the drag covers
	// more than half of it, so a pixel nudge would prove nothing either way.
	const from = await pressOn(page, 'n-audio-1');
	await page.mouse.move(from.x - 5 * cell, from.y, { steps: 20 });

	// The drag has to actually engage, which is the half of this that was
	// silently dead: gridstack refused every move after the first correction, so
	// nothing on the grid ever responded to the pointer.
	await expect
		.poll(() => geometry(page).then((now) => now['n-audio-1']))
		.not.toBe(before['n-audio-1']);
	// And it has to have shoved a neighbour, which is what the drop then puts
	// back.
	await expect
		.poll(() => geometry(page).then((now) => now['n-comic-1']))
		.not.toBe(before['n-comic-1']);

	await page.mouse.move(from.x, from.y, { steps: 20 });
	await page.mouse.up();

	// Everything back where it started, neighbours included: the ones gridstack
	// pushed out of the way on the trip out used to keep the pushed positions.
	await expect.poll(() => geometry(page)).toEqual(before);
	// And nothing was written. A drag that changes nothing is not an edit.
	expect(await stored(page)).toBeNull();
});

test('a drag that pushes a node upward and returns commits nothing', async ({ page }) => {
	// The direction matters, which is why this is separate from the drag above.
	// gridstack pushes neighbours aside continuously and has only one mechanism
	// for putting them back — the floating pack — which walks a displaced node
	// *upward* toward where it started. Anything shoved upward therefore had no
	// route home, and worse, the node that shoved it could not get back into its
	// own cell either once that cell was occupied: gridstack refuses a move
	// covering less than half an occupant. Dragging a node up and back down left
	// the whole column permanently shifted.
	await arrangeAt(page, 1700);
	const before = await geometry(page);
	const cell = await page.evaluate(() =>
		document.querySelector('.grid-stack').gridstack.cellWidth()
	);

	// game sits directly below audio; dragging it up displaces audio downward.
	const from = await pressOn(page, 'n-game-1');
	await page.mouse.move(from.x, from.y - 4 * cell, { steps: 20 });
	await expect
		.poll(() => geometry(page).then((now) => now['n-audio-1']))
		.not.toBe(before['n-audio-1']);

	await page.mouse.move(from.x, from.y, { steps: 20 });
	await page.mouse.up();

	await expect.poll(() => geometry(page)).toEqual(before);
	expect(await stored(page)).toBeNull();
});

test('a drop in open canvas keeps the cell it was dropped on', async ({ page }) => {
	// Comfortably inside the open canvas, but well below the widths the old
	// column ladder kept the authored count for — this drop used to be
	// re-centered away rather than kept.
	await arrangeAt(page, 1700);
	const before = await geometry(page);

	const from = await pressOn(page, 'n-audio-1');
	await page.mouse.move(from.x + 180, from.y + 260, { steps: 25 });
	await page.mouse.up();

	// Literal coordinates, persisted as themselves — no reorder, no re-centring,
	// and no per-breakpoint bookkeeping needed to survive.
	await expect.poll(() => stored(page)).not.toBeNull();
	const after = await geometry(page);
	expect(after['n-audio-1']).not.toBe(before['n-audio-1']);
	expect((await stored(page))['n-audio-1']).toBe(after['n-audio-1']);
	// The nodes it never touched are untouched.
	expect(after['n-comic-1']).toBe(before['n-comic-1']);
	expect(after['n-text-1']).toBe(before['n-text-1']);
});

test('a placement made on a narrower canvas survives a trip to a wide one', async ({ page }) => {
	await arrangeAt(page, 1700);
	const from = await pressOn(page, 'n-audio-1');
	await page.mouse.move(from.x + 180, from.y + 260, { steps: 25 });
	await page.mouse.up();
	await expect.poll(() => stored(page)).not.toBeNull();
	const placed = await geometry(page);

	// Out to a much wider canvas and back. Both widths hold the authored column
	// count, so the arrangement is the same arrangement at each.
	await page.setViewportSize({ width: 2200, height: 1000 });
	await expect.poll(() => geometry(page)).toEqual(placed);
	await page.setViewportSize({ width: 1700, height: 1000 });
	await expect.poll(() => geometry(page)).toEqual(placed);

	// And through the re-arranging tier, which renders from reading order and
	// must leave the saved coordinates alone.
	await page.setViewportSize({ width: 800, height: 1000 });
	await expect.poll(() => columnsNow(page)).toBeLessThan(24);
	await page.setViewportSize({ width: 1700, height: 1000 });
	await expect.poll(() => geometry(page)).toEqual(placed);
});

test('the mobile stack still reads a drag as a reorder', async ({ page }) => {
	// At four columns a node authored 16 cells wide does not fit at all, so
	// there is no arrangement to preserve and sequence is the only thing a drop
	// can mean. This is the one width that still works that way.
	await page.setViewportSize({ width: 400, height: 1400 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	await page.getByRole('button', { name: 'Arrange field' }).click();
	await expect.poll(() => columnsNow(page)).toBe(4);
	expect(await storedOrder(page)).toBeNull();

	// The first card, dragged down past the second. Grabbed near its top so the
	// whole gesture stays on screen: at four columns every card is a full
	// viewport width across and correspondingly tall.
	const box = await page.locator('.grid-stack-item[gs-id="n-comic-1"]').boundingBox();
	if (!box) throw new Error('the comic node has no bounding box');
	const from = { x: box.x + box.width / 2, y: box.y + box.height * 0.25 };
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 3, from.y + 3);
	await page.mouse.move(from.x, from.y + box.height * 0.9, { steps: 25 });
	await page.mouse.up();

	// Order changed; every node still sits in one full-width column.
	await expect.poll(() => storedOrder(page)).not.toBeNull();
	const order = await storedOrder(page);
	expect(order).toHaveLength(5);
	expect(order).not.toEqual(['n-comic-1', 'n-text-1', 'n-audio-1', 'n-game-1', 'n-art-1']);
	const placed = await geometry(page);
	for (const cell of Object.values(placed)) expect(cell.split(',')[0]).toBe('0');
});

/**
 * Clicks a card at the same safe point `pressOn` presses on, so a click
 * meant to select never lands on a cancel-listed control (the config bar,
 * the Visit link) instead.
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 * @param {{ shift?: boolean }} [options]
 */
async function clickOn(page, id, { shift = false } = {}) {
	const locator = page.locator(`.grid-stack-item[gs-id="${id}"]`);
	const box = await locator.boundingBox();
	if (!box) throw new Error(`${id} has no bounding box`);
	await locator.click({
		position: { x: box.width / 2, y: box.height * 0.45 },
		modifiers: shift ? ['Shift'] : []
	});
}

test.describe('multi-select drag', () => {
	test('shift-click selects a group, and dragging one member moves all of them together', async ({
		page
	}) => {
		await arrangeAt(page, 1700);
		await clickOn(page, 'n-comic-1');
		await clickOn(page, 'n-text-1', { shift: true });
		await expect(page.locator('.grid-stack-item.selected')).toHaveCount(2);

		const before = await geometry(page);
		const cell = await page.evaluate(() =>
			document.querySelector('.grid-stack').gridstack.cellWidth()
		);
		// Grabbed by the node under the pointer, but the whole selected group
		// is what should move.
		const from = await pressOn(page, 'n-text-1');
		await page.mouse.move(from.x + 4 * cell, from.y + 4 * cell, { steps: 25 });
		await page.mouse.up();

		await expect
			.poll(() => geometry(page).then((now) => now['n-text-1']))
			.not.toBe(before['n-text-1']);
		const after = await geometry(page);
		/** @param {string} id */
		const delta = (id) => {
			const [bx, by] = before[id].split(',').map(Number);
			const [ax, ay] = after[id].split(',').map(Number);
			return `${ax - bx},${ay - by}`;
		};
		expect(delta('n-text-1')).toBe(delta('n-comic-1'));
		// Not part of the selection, so untouched by the group's move.
		expect(after['n-audio-1']).toBe(before['n-audio-1']);
	});

	test('dragging a node outside the selection moves only that node', async ({ page }) => {
		await arrangeAt(page, 1700);
		await clickOn(page, 'n-comic-1');
		await clickOn(page, 'n-text-1', { shift: true });

		const before = await geometry(page);
		const cell = await page.evaluate(() =>
			document.querySelector('.grid-stack').gridstack.cellWidth()
		);
		const from = await pressOn(page, 'n-audio-1');
		await page.mouse.move(from.x + 3 * cell, from.y, { steps: 25 });
		await page.mouse.up();

		await expect
			.poll(() => geometry(page).then((now) => now['n-audio-1']))
			.not.toBe(before['n-audio-1']);
		const after = await geometry(page);
		expect(after['n-comic-1']).toBe(before['n-comic-1']);
		expect(after['n-text-1']).toBe(before['n-text-1']);
	});

	test('every selected node gets a drop ghost, in the shape the group holds', async ({ page }) => {
		await arrangeAt(page, 1700);
		await clickOn(page, 'n-comic-1');
		await clickOn(page, 'n-text-1', { shift: true });

		const before = await paintedAt(page);
		const cell = await page.evaluate(() =>
			document.querySelector('.grid-stack').gridstack.cellWidth()
		);
		const from = await pressOn(page, 'n-text-1');
		await page.mouse.move(from.x + 4 * cell, from.y + 2 * cell, { steps: 20 });

		// One per selected node, the grabbed one included -- gridstack draws a
		// placeholder for that one node and nothing for the rest, which left a
		// group move previewing a single card.
		const ghosts = await page.evaluate(() => {
			const grid = document.querySelector('.grid-stack').getBoundingClientRect();
			return [...document.querySelectorAll('.group-drop-ghost > .ghost-content')]
				.map((el) => {
					const box = el.getBoundingClientRect();
					return { x: box.x - grid.x, y: box.y - grid.y, width: box.width, height: box.height };
				})
				.sort((a, b) => a.y - b.y || a.x - b.x);
		});
		expect(ghosts).toHaveLength(2);
		// And they are the selection's own shape, not two arbitrary rectangles:
		// the gap between the ghosts is the gap between the cards.
		expect(
			Math.abs(ghosts[1].y - ghosts[0].y - (before['n-text-1'].y - before['n-comic-1'].y))
		).toBeLessThan(2);
		expect(
			Math.abs(ghosts[1].x - ghosts[0].x - (before['n-text-1'].x - before['n-comic-1'].x))
		).toBeLessThan(2);
		// The one node's own placeholder is hidden while they are up, so the
		// group has a single answer on screen rather than two disagreeing ones.
		await expect(page.locator('.grid-stack .field-drop-target')).toBeHidden();

		await page.mouse.up();
		await expect(page.locator('.group-drop-ghost')).toHaveCount(0);

		// And a ghost was the landing rectangle, not merely a rectangle: each
		// card's own painted body ends up exactly where its ghost stood.
		// Measured from the grid's top-left rather than the viewport, because
		// a drop that makes the field taller can shift the page under both.
		const landed = await page.evaluate(() => {
			const grid = document.querySelector('.grid-stack').getBoundingClientRect();
			return ['n-comic-1', 'n-text-1']
				.map((id) =>
					document.querySelector(`.grid-stack-item[gs-id="${id}"] > .grid-stack-item-content`)
				)
				.map((el) => {
					const box = el.getBoundingClientRect();
					return { x: box.x - grid.x, y: box.y - grid.y, width: box.width, height: box.height };
				})
				.sort((a, b) => a.y - b.y || a.x - b.x);
		});
		expect(landed).toHaveLength(2);
		for (const [index, card] of landed.entries()) {
			const ghost = ghosts[index];
			expect(Math.abs(card.x - ghost.x)).toBeLessThan(2);
			expect(Math.abs(card.y - ghost.y)).toBeLessThan(2);
			expect(Math.abs(card.width - ghost.width)).toBeLessThan(2);
			expect(Math.abs(card.height - ghost.height)).toBeLessThan(2);
		}
	});

	test('a follower holds the group shape even where the engine shoves it', async ({ page }) => {
		await arrangeAt(page, 1700);
		await clickOn(page, 'n-comic-1');
		await clickOn(page, 'n-text-1', { shift: true });

		const before = await paintedAt(page);
		const cell = await page.evaluate(() =>
			document.querySelector('.grid-stack').gridstack.cellWidth()
		);
		const from = await pressOn(page, 'n-text-1');

		// A path, not a single move, and a wandering one: n-comic-1 sits
		// directly above n-text-1, and carrying the grabbed node up and across
		// its own selected neighbour is what gets gridstack's live collision
		// handling to shove that neighbour aside mid-drag (this exact route
		// moved it nine rows down while the pointer was still travelling).
		// Every waypoint is checked, because which ones provoke a shove is the
		// engine's business and changes with the arrangement.
		const strayed = [];
		for (const [dx, dy] of [
			[0, -1],
			[0, -3],
			[2, -4],
			[4, -4],
			[4, 0],
			[4, 3]
		]) {
			await page.mouse.move(from.x + dx * cell, from.y + dy * cell, { steps: 10 });
			const during = await paintedAt(page);
			/** Painted travel since the press, per node. */
			const travelled = (id) => ({
				x: during[id].x - before[id].x,
				y: during[id].y - before[id].y
			});
			const grabbed = travelled('n-text-1');
			const follower = travelled('n-comic-1');
			// The selection is one rigid shape while it moves: the follower has
			// gone exactly as far as the node under the pointer. The slack is
			// for the one frame a drag that scrolls the page takes to correct
			// itself; a follower that inherits a shove is out by whole rows.
			if (Math.abs(follower.x - grabbed.x) > 12 || Math.abs(follower.y - grabbed.y) > 12) {
				strayed.push({ at: `${dx},${dy}`, grabbed, follower });
			}
		}
		expect(strayed).toEqual([]);

		await page.mouse.up();
	});

	test('a slow drag never leaves a follower parked outside the group', async ({ page }) => {
		await arrangeAt(page, 1700);
		await clickOn(page, 'n-comic-1');
		await clickOn(page, 'n-text-1', { shift: true });

		const cell = await page.evaluate(() =>
			document.querySelector('.grid-stack').gridstack.cellWidth()
		);

		/**
		 * The offset between the grabbed node and its follower, read a whole
		 * frame after the move that preceded it. That wait is the point: it is
		 * what a slow drag does — one small move, then frames of nothing —
		 * and it is where a preview that only corrects itself on the *next*
		 * pointer event leaves the group visibly broken until one arrives.
		 * Two nested frames, so the reading is taken after a pass that ran and
		 * painted rather than one still in the middle of running.
		 */
		const offsetAfterAFrame = () =>
			page.evaluate(
				() =>
					new Promise((resolve) =>
						requestAnimationFrame(() =>
							requestAnimationFrame(() => {
								const cornerOf = (id) => {
									const box = document
										.querySelector(`.grid-stack-item[gs-id="${id}"]`)
										.getBoundingClientRect();
									return { x: box.x, y: box.y };
								};
								const grabbed = cornerOf('n-text-1');
								const follower = cornerOf('n-comic-1');
								resolve({ x: follower.x - grabbed.x, y: follower.y - grabbed.y });
							})
						)
					)
			);

		const atRest = await offsetAfterAFrame();
		const from = await pressOn(page, 'n-text-1');

		// Over and around the node it is selected with, a third of a cell at a
		// time: every crossing of a collision boundary is a chance for the
		// engine to shove that follower, and the pause after each move is what
		// makes a stale correction visible rather than instantly overwritten.
		const broke = [];
		for (const [dx, dy] of [
			[0, -4],
			[2, -4],
			[4, -4],
			[4, 0],
			[2, 2]
		]) {
			const legs = 6;
			for (let step = 1; step <= legs; step += 1) {
				await page.mouse.move(
					from.x + (dx * cell * step) / legs,
					from.y + (dy * cell * step) / legs
				);
				const offset = await offsetAfterAFrame();
				if (Math.abs(offset.x - atRest.x) > 2 || Math.abs(offset.y - atRest.y) > 2) {
					broke.push({ at: `${dx},${dy} step ${step}`, offset });
				}
			}
		}
		await page.mouse.up();

		// The selection holds the shape it had at rest through every one of
		// them: a follower that inherited a shove sits whole rows away.
		expect(broke).toEqual([]);
	});

	test('the group takes the drop rather than animating into it', async ({ page }) => {
		await arrangeAt(page, 1700);
		await clickOn(page, 'n-comic-1');
		await clickOn(page, 'n-text-1', { shift: true });

		const cell = await page.evaluate(() =>
			document.querySelector('.grid-stack').gridstack.cellWidth()
		);
		const from = await pressOn(page, 'n-text-1');
		await page.mouse.move(from.x + 4 * cell, from.y + 2 * cell, { steps: 20 });

		// Sampled from inside the page, frame by frame, rather than by polling
		// from here: gridstack's own position transition runs for 300ms, and a
		// round trip from the test runner can easily miss all of it. Armed
		// before the release so the first sample is the first frame after it.
		await page.evaluate(() => {
			window.__settleSamples = [];
			window.addEventListener(
				'pointerup',
				() => {
					const sample = () => {
						const el = document.querySelector('.grid-stack-item[gs-id="n-comic-1"]');
						const box = el.getBoundingClientRect();
						window.__settleSamples.push({ x: box.x, y: box.y });
						if (window.__settleSamples.length < 20) requestAnimationFrame(sample);
					};
					requestAnimationFrame(sample);
				},
				{ once: true, capture: true }
			);
		});
		await page.mouse.up();

		await expect.poll(() => page.evaluate(() => window.__settleSamples.length)).toBe(20);
		// Every frame in the first third of a second after the drop is already
		// at the settled position: the group is where it was dropped from the
		// first one, instead of sliding there from wherever the drag had left
		// it. A pixel of slack, because the grid's own row pitch is fractional
		// and re-measuring it can shift a card's painted top by less than one
		// -- an animation is a journey of whole cells, so nothing this test
		// exists to catch hides inside that.
		const samples = await page.evaluate(() => window.__settleSamples);
		const settled = samples[samples.length - 1];
		const strayed = samples.filter(
			(sample) => Math.abs(sample.x - settled.x) > 2 || Math.abs(sample.y - settled.y) > 2
		);
		expect(strayed).toEqual([]);
	});

	test('a drop the engine refuses still lands where it was let go', async ({ page }) => {
		await arrangeAt(page, 1700);
		await clickOn(page, 'n-comic-1');
		await clickOn(page, 'n-text-1', { shift: true });

		const before = await geometry(page);
		const cell = await page.evaluate(() =>
			document.querySelector('.grid-stack').gridstack.cellWidth()
		);
		// One cell to the right, which walks the group into the column its
		// neighbours occupy. gridstack refuses to move the node it is tracking
		// onto occupied cells, so it never moves at all and emits no `change`
		// — and a drop settled only from that event is a drop thrown away.
		const from = await pressOn(page, 'n-text-1');
		await page.mouse.move(from.x + cell, from.y, { steps: 20 });
		await page.mouse.up();

		await expect
			.poll(() => geometry(page).then((now) => now['n-text-1']))
			.not.toBe(before['n-text-1']);
		const after = await geometry(page);
		/** @param {string} id */
		const delta = (id) => {
			const [bx, by] = before[id].split(',').map(Number);
			const [ax, ay] = after[id].split(',').map(Number);
			return `${ax - bx},${ay - by}`;
		};
		// The cells the pointer asked for, both members, no snap back.
		expect(delta('n-text-1')).toBe('1,0');
		expect(delta('n-comic-1')).toBe('1,0');
		// And the neighbour it landed on gave way, the same as it would for a
		// single node dropped on top of it.
		expect(after['n-audio-1']).not.toBe(before['n-audio-1']);
	});

	test('a group dragged with shift held stays selected on release', async ({ page }) => {
		await arrangeAt(page, 1700);
		await clickOn(page, 'n-comic-1');
		await clickOn(page, 'n-text-1', { shift: true });

		const cell = await page.evaluate(() =>
			document.querySelector('.grid-stack').gridstack.cellWidth()
		);
		// Held for the whole gesture, release included: that is what says the
		// group is still wanted afterwards.
		await page.keyboard.down('Shift');
		const from = await pressOn(page, 'n-text-1');
		await page.mouse.move(from.x + 3 * cell, from.y + 2 * cell, { steps: 20 });
		await page.mouse.up();
		await page.keyboard.up('Shift');

		await expect(page.locator('.grid-stack-item.selected')).toHaveCount(2);
		// And it is still a usable selection, not just a leftover ring: the
		// same group moves together again without being rebuilt first.
		const before = await geometry(page);
		const next = await pressOn(page, 'n-text-1');
		await page.mouse.move(next.x, next.y + 2 * cell, { steps: 20 });
		await page.mouse.up();

		await expect
			.poll(() => geometry(page).then((now) => now['n-text-1']))
			.not.toBe(before['n-text-1']);
		const after = await geometry(page);
		/** @param {string} id */
		const delta = (id) => {
			const [bx, by] = before[id].split(',').map(Number);
			const [ax, ay] = after[id].split(',').map(Number);
			return `${ax - bx},${ay - by}`;
		};
		expect(delta('n-comic-1')).toBe(delta('n-text-1'));
	});

	test('a group dragged without shift is let go of on release', async ({ page }) => {
		await arrangeAt(page, 1700);
		await clickOn(page, 'n-comic-1');
		await clickOn(page, 'n-text-1', { shift: true });

		const cell = await page.evaluate(() =>
			document.querySelector('.grid-stack').gridstack.cellWidth()
		);
		const from = await pressOn(page, 'n-text-1');
		await page.mouse.move(from.x + 3 * cell, from.y + 2 * cell, { steps: 20 });
		await page.mouse.up();

		// Dropping a group without holding shift is how a selection is
		// dismissed, so this half of the rule is deliberate rather than the
		// bug the shift case was.
		await expect(page.locator('.grid-stack-item.selected')).toHaveCount(0);
	});

	test('Escape clears the selection', async ({ page }) => {
		await arrangeAt(page, 1700);
		await clickOn(page, 'n-comic-1');
		await expect(page.locator('.grid-stack-item.selected')).toHaveCount(1);
		await page.keyboard.press('Escape');
		await expect(page.locator('.grid-stack-item.selected')).toHaveCount(0);
	});

	test('a plain click replaces the selection with just the clicked node', async ({ page }) => {
		await arrangeAt(page, 1700);
		await clickOn(page, 'n-comic-1');
		await clickOn(page, 'n-text-1', { shift: true });
		await expect(page.locator('.grid-stack-item.selected')).toHaveCount(2);

		await clickOn(page, 'n-audio-1');
		await expect(page.locator('.grid-stack-item.selected')).toHaveCount(1);
		await expect(page.locator('.grid-stack-item[gs-id="n-audio-1"]')).toHaveClass(/selected/);
	});

	test('clicking the empty canvas clears the selection', async ({ page }) => {
		await arrangeAt(page, 1700);
		await clickOn(page, 'n-comic-1');
		await expect(page.locator('.grid-stack-item.selected')).toHaveCount(1);

		// Top-left corner of the grid: nothing is authored to sit there (every
		// node starts at x >= 8 in the fixture), so it is background at every
		// width `arrangeAt` is called with above the mobile stack.
		const gridBox = await page.locator('.grid-stack').boundingBox();
		if (!gridBox) throw new Error('the grid has no bounding box');
		await page.mouse.click(gridBox.x + 5, gridBox.y + 5);
		await expect(page.locator('.grid-stack-item.selected')).toHaveCount(0);
	});
});

test.describe('proportional group resize', () => {
	/**
	 * Moves a node clear of every other one, cell by cell, so a later corner
	 * grow has nowhere to legitimately collide with anything and a test can
	 * assert on the scale math alone rather than also on gridstack's own
	 * collision-push (already covered by the resize suite's own tests).
	 * @param {import('@playwright/test').Page} page
	 * @param {string} id
	 * @param {number} cellsX
	 * @param {number} cellsY
	 */
	async function moveClearBy(page, id, cellsX, cellsY) {
		const cell = await page.evaluate(() =>
			document.querySelector('.grid-stack').gridstack.cellWidth()
		);
		const from = await pressOn(page, id);
		await page.mouse.move(from.x + cellsX * cell, from.y + cellsY * cell, { steps: 25 });
		await page.mouse.up();
		await page.waitForTimeout(400);
	}

	test('dragging the SE corner of one selected node scales every selected node together', async ({
		page
	}) => {
		await arrangeAt(page, 2200);
		// Comic and text stay exactly where the fixture puts them, stacked at
		// the same x -- only the audio/game/art column needs to move, so
		// growing comic and text rightward has clear space to grow into.
		await moveClearBy(page, 'n-audio-1', 20, 0);
		await moveClearBy(page, 'n-game-1', 20, 0);
		await moveClearBy(page, 'n-art-1', 20, 0);

		await clickOn(page, 'n-comic-1');
		await clickOn(page, 'n-text-1', { shift: true });
		const before = await geometryWithSize(page);

		const cell = await page.evaluate(() =>
			document.querySelector('.grid-stack').gridstack.cellWidth()
		);
		const handle = page.locator(
			'.grid-stack-item[gs-id="n-text-1"] .ui-resizable-handle.ui-resizable-se'
		);
		// The node this belongs to may be far enough down the field (the
		// default arrangement's own nodes now scale up with a wide first-load
		// viewport) to sit below the fold, especially after moveClearBy's own
		// scroll to reach a different node earlier in the same test.
		await handle.scrollIntoViewIfNeeded();
		const handleBox = await handle.boundingBox();
		if (!handleBox) throw new Error('n-text-1 has no se handle');
		await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(handleBox.x + 3 * cell, handleBox.y + 3 * cell, { steps: 25 });
		await page.mouse.up();

		await expect
			.poll(() => geometryWithSize(page).then((now) => now['n-text-1'].w))
			.not.toBe(before['n-text-1'].w);
		const after = await geometryWithSize(page);

		const scaleW = after['n-text-1'].w / before['n-text-1'].w;
		const scaleH = after['n-text-1'].h / before['n-text-1'].h;

		expect(scaleW).toBeGreaterThan(1);
		expect(after['n-comic-1'].w / before['n-comic-1'].w).toBeCloseTo(scaleW, 5);
		expect(after['n-comic-1'].h / before['n-comic-1'].h).toBeCloseTo(scaleH, 5);
		// Anchored at the top-left: comic's own corner does not move even
		// though its size does.
		expect(after['n-comic-1'].x).toBe(before['n-comic-1'].x);
		expect(after['n-comic-1'].y).toBe(before['n-comic-1'].y);
		// Not part of the selection, so untouched by the group's scale.
		expect(after['n-audio-1']).toEqual(before['n-audio-1']);
	});

	test('an edge-handle resize does not scale the rest of the selection', async ({ page }) => {
		await arrangeAt(page, 1700);
		await clickOn(page, 'n-comic-1');
		await clickOn(page, 'n-text-1', { shift: true });
		const before = await geometryWithSize(page);

		const cell = await page.evaluate(() =>
			document.querySelector('.grid-stack').gridstack.cellWidth()
		);
		const handle = page.locator(
			'.grid-stack-item[gs-id="n-comic-1"] .ui-resizable-handle.ui-resizable-e'
		);
		// The node this belongs to may be far enough down the field (the
		// default arrangement's own nodes now scale up with a wide first-load
		// viewport) to sit below the fold, especially after moveClearBy's own
		// scroll to reach a different node earlier in the same test.
		await handle.scrollIntoViewIfNeeded();
		const handleBox = await handle.boundingBox();
		if (!handleBox) throw new Error('n-comic-1 has no e handle');
		await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(handleBox.x + 2 * cell, handleBox.y, { steps: 25 });
		await page.mouse.up();

		await expect
			.poll(() => geometryWithSize(page).then((now) => now['n-comic-1'].w))
			.not.toBe(before['n-comic-1'].w);
		const after = await geometryWithSize(page);

		// text's own w/h (not necessarily its position, which a genuine
		// collision push may still legitimately change) stayed the size it
		// was -- the group did not scale from an edge handle.
		expect(after['n-text-1'].w).toBe(before['n-text-1'].w);
		expect(after['n-text-1'].h).toBe(before['n-text-1'].h);
	});
});

test.describe('shift-drag sweep selection', () => {
	/**
	 * Sweeps a rectangle across the canvas with Shift held.
	 *
	 * Starts from the grid's own top-left rather than a point measured off a
	 * card: the top card's top edge *is* the grid's top edge, so anything
	 * "just above" a card is outside the grid element and the sweep never
	 * begins. The left margin is empty at every width this runs at, since the
	 * shipped arrangement starts at column 8.
	 * @param {import('@playwright/test').Page} page
	 * @param {{ x: number, y: number }} to
	 */
	async function sweepTo(page, to) {
		const grid = await page.locator('.grid-stack').boundingBox();
		if (!grid) throw new Error('the grid has no bounding box');
		await page.keyboard.down('Shift');
		await page.mouse.move(grid.x + 5, grid.y + 5);
		await page.mouse.down();
		await page.mouse.move(to.x, to.y, { steps: 20 });
		await page.mouse.up();
		await page.keyboard.up('Shift');
	}

	/** @param {import('@playwright/test').Page} page @param {string} id */
	async function cardBox(page, id) {
		const box = await page.locator(`.grid-stack-item[gs-id="${id}"]`).boundingBox();
		if (!box) throw new Error(`${id} has no bounding box`);
		return box;
	}

	test('a shift-drag selects every node the rectangle touches', async ({ page }) => {
		await arrangeAt(page, 1700);
		const comic = await cardBox(page, 'n-comic-1');
		const text = await cardBox(page, 'n-text-1');

		// Stops 12px short of the left column's right edge, so the right-hand
		// column is outside the rectangle and proves the sweep is bounded.
		await sweepTo(page, {
			x: comic.x + comic.width - 12,
			y: text.y + text.height - 10
		});

		await expect(page.locator('.grid-stack-item.selected')).toHaveCount(2);
		await expect(page.locator('.grid-stack-item[gs-id="n-comic-1"]')).toHaveClass(/selected/);
		await expect(page.locator('.grid-stack-item[gs-id="n-text-1"]')).toHaveClass(/selected/);
		// The sweep's own overlay is gone once the pointer is released.
		await expect(page.locator('.sweep')).toHaveCount(0);
	});

	test('a sweep adds to the selection rather than replacing it', async ({ page }) => {
		await arrangeAt(page, 1700);
		await clickOn(page, 'n-audio-1');
		await expect(page.locator('.grid-stack-item.selected')).toHaveCount(1);

		const comic = await cardBox(page, 'n-comic-1');
		const text = await cardBox(page, 'n-text-1');
		await sweepTo(page, { x: comic.x + comic.width - 12, y: text.y + text.height - 10 });

		// Shift means "and also", the same as it does for a shift-click.
		await expect(page.locator('.grid-stack-item.selected')).toHaveCount(3);
		await expect(page.locator('.grid-stack-item[gs-id="n-audio-1"]')).toHaveClass(/selected/);
	});

	test('a swept group moves together', async ({ page }) => {
		await arrangeAt(page, 1700);
		const comic = await cardBox(page, 'n-comic-1');
		const text = await cardBox(page, 'n-text-1');
		await sweepTo(page, { x: comic.x + comic.width - 12, y: text.y + text.height - 10 });
		await expect(page.locator('.grid-stack-item.selected')).toHaveCount(2);

		const before = await geometry(page);
		const cell = await page.evaluate(() =>
			document.querySelector('.grid-stack').gridstack.cellWidth()
		);
		// Straight down its own column: the swept pair is the whole of that
		// column, so this is a move with nothing in its way, which is what
		// lets the untouched-neighbour assertion below mean anything. A move
		// that lands *on* n-audio-1 pushes it, exactly as a single dragged
		// node would.
		const from = await pressOn(page, 'n-text-1');
		await page.mouse.move(from.x, from.y + 3 * cell, { steps: 25 });
		await page.mouse.up();

		await expect
			.poll(() => geometry(page).then((now) => now['n-text-1']))
			.not.toBe(before['n-text-1']);
		const after = await geometry(page);
		/** @param {string} id */
		const delta = (id) => {
			const [bx, by] = before[id].split(',').map(Number);
			const [ax, ay] = after[id].split(',').map(Number);
			return `${ax - bx},${ay - by}`;
		};
		expect(delta('n-comic-1')).toBe(delta('n-text-1'));
		// And it is the move the pointer actually made, not merely a shared
		// one: the group travels the cells it was dragged, rather than being
		// carried further by the engine's own collision pushes on the way in.
		expect(delta('n-text-1')).toBe('0,3');
		expect(after['n-audio-1']).toBe(before['n-audio-1']);
	});
});

test.describe('live group-drag preview', () => {
	test('the rest of a selection visually follows the grabbed node while dragging', async ({
		page
	}) => {
		await arrangeAt(page, 1700);
		await clickOn(page, 'n-comic-1');
		await clickOn(page, 'n-text-1', { shift: true });

		const comicBefore = await page.locator('.grid-stack-item[gs-id="n-comic-1"]').boundingBox();
		if (!comicBefore) throw new Error('n-comic-1 has no bounding box');
		const from = await pressOn(page, 'n-text-1');

		// Comic never had a finger on it — text is the one gridstack is
		// actually dragging — so any on-screen movement here is this feature,
		// not gridstack's own native drag rendering.
		await page.mouse.move(from.x + 150, from.y + 100, { steps: 15 });

		const comic = page.locator('.grid-stack-item[gs-id="n-comic-1"]');
		await expect(comic).toHaveClass(/group-gesture-follower/);
		const comicDuring = await comic.boundingBox();
		if (!comicDuring) throw new Error('n-comic-1 lost its bounding box mid-drag');
		expect(Math.abs(comicDuring.x - comicBefore.x - 150)).toBeLessThan(15);
		expect(Math.abs(comicDuring.y - comicBefore.y - 100)).toBeLessThan(15);

		await page.mouse.up();

		// The preview is gone the instant the gesture ends, and does not
		// linger as a stray class or transform on top of the real, settled
		// position replayDrop hands it moments later.
		await expect(comic).not.toHaveClass(/group-gesture-follower/);
		await expect(comic).toHaveCSS('transform', 'none');
	});

	test('an abandoned group drag leaves no visual trace on the rest of the selection', async ({
		page
	}) => {
		await arrangeAt(page, 1700);
		await clickOn(page, 'n-comic-1');
		await clickOn(page, 'n-text-1', { shift: true });
		const before = await geometry(page);

		const from = await pressOn(page, 'n-text-1');
		await page.mouse.move(from.x + 120, from.y + 90, { steps: 15 });
		await expect(page.locator('.grid-stack-item[gs-id="n-comic-1"]')).toHaveClass(
			/group-gesture-follower/
		);
		// Back to exactly where it started, same as the single-node "abandoned
		// drag" case above.
		await page.mouse.move(from.x, from.y, { steps: 15 });
		await page.mouse.up();

		await expect(page.locator('.grid-stack-item[gs-id="n-comic-1"]')).not.toHaveClass(
			/group-gesture-follower/
		);
		await expect.poll(() => geometry(page)).toEqual(before);
	});
});

test.describe('live group-resize preview', () => {
	/**
	 * Moves a node clear of every other one, cell by cell, so a later corner
	 * grow has nowhere to legitimately collide with anything and a test can
	 * assert on the live preview alone rather than also on gridstack's own
	 * collision-push. Mirrors the identically named helper in the
	 * "proportional group resize" suite above, whose scope does not reach
	 * this block.
	 * @param {import('@playwright/test').Page} page
	 * @param {string} id
	 * @param {number} cellsX
	 * @param {number} cellsY
	 */
	async function moveClearBy(page, id, cellsX, cellsY) {
		const cell = await page.evaluate(() =>
			document.querySelector('.grid-stack').gridstack.cellWidth()
		);
		const from = await pressOn(page, id);
		await page.mouse.move(from.x + cellsX * cell, from.y + cellsY * cell, { steps: 25 });
		await page.mouse.up();
		await page.waitForTimeout(400);
	}

	test('the rest of a selection visually scales together while resizing', async ({ page }) => {
		await arrangeAt(page, 2200);
		await moveClearBy(page, 'n-audio-1', 20, 0);
		await moveClearBy(page, 'n-game-1', 20, 0);
		await moveClearBy(page, 'n-art-1', 20, 0);

		await clickOn(page, 'n-comic-1');
		await clickOn(page, 'n-text-1', { shift: true });

		const comicBefore = await page.locator('.grid-stack-item[gs-id="n-comic-1"]').boundingBox();
		if (!comicBefore) throw new Error('n-comic-1 has no bounding box');
		const gridBefore = await page.locator('.grid-stack').boundingBox();
		if (!gridBefore) throw new Error('the grid has no bounding box');

		const cell = await page.evaluate(() =>
			document.querySelector('.grid-stack').gridstack.cellWidth()
		);
		const handle = page.locator(
			'.grid-stack-item[gs-id="n-text-1"] .ui-resizable-handle.ui-resizable-se'
		);
		// The node this belongs to may be far enough down the field (the
		// default arrangement's own nodes now scale up with a wide first-load
		// viewport) to sit below the fold, especially after moveClearBy's own
		// scroll to reach a different node earlier in the same test.
		await handle.scrollIntoViewIfNeeded();
		const handleBox = await handle.boundingBox();
		if (!handleBox) throw new Error('n-text-1 has no se handle');
		await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
		await page.mouse.down();

		// Comic never had a handle on it -- text is the one gridstack is
		// actually resizing -- so any on-screen size change here is this
		// feature, not gridstack's own native resize rendering.
		await page.mouse.move(handleBox.x + 3 * cell, handleBox.y + 3 * cell, { steps: 15 });

		const comic = page.locator('.grid-stack-item[gs-id="n-comic-1"]');
		await expect(comic).toHaveClass(/group-gesture-follower/);
		const comicDuring = await comic.boundingBox();
		if (!comicDuring) throw new Error('n-comic-1 lost its bounding box mid-resize');
		const gridDuring = await page.locator('.grid-stack').boundingBox();
		if (!gridDuring) throw new Error('the grid has no bounding box mid-resize');
		expect(comicDuring.width).toBeGreaterThan(comicBefore.width);
		expect(comicDuring.height).toBeGreaterThan(comicBefore.height);
		// Anchored at the top-left: comic's own corner does not visually move
		// *relative to the grid* even though its size does. Measured relative
		// to the grid rather than the page, because growing the grabbed node's
		// real height live -- gridstack's own native resize rendering, nothing
		// to do with this feature -- reflows the grid's own position on the
		// page, and every node on it moves right along with that, comic
		// included; that ambient shift is not what this test is about.
		expect(Math.abs(comicDuring.x - gridDuring.x - (comicBefore.x - gridBefore.x))).toBeLessThan(2);
		expect(Math.abs(comicDuring.y - gridDuring.y - (comicBefore.y - gridBefore.y))).toBeLessThan(2);

		await page.mouse.up();

		// The preview is gone the instant the gesture ends, and does not
		// linger as a stray class or transform on top of the real, settled
		// size replayGroupScale hands it moments later.
		await expect(comic).not.toHaveClass(/group-gesture-follower/);
		await expect(comic).toHaveCSS('transform', 'none');
	});

	test('an abandoned group resize leaves no visual trace on the rest of the selection', async ({
		page
	}) => {
		await arrangeAt(page, 2200);
		await moveClearBy(page, 'n-audio-1', 20, 0);
		await moveClearBy(page, 'n-game-1', 20, 0);
		await moveClearBy(page, 'n-art-1', 20, 0);

		await clickOn(page, 'n-comic-1');
		await clickOn(page, 'n-text-1', { shift: true });
		const before = await geometryWithSize(page);

		const cell = await page.evaluate(() =>
			document.querySelector('.grid-stack').gridstack.cellWidth()
		);
		const handle = page.locator(
			'.grid-stack-item[gs-id="n-text-1"] .ui-resizable-handle.ui-resizable-se'
		);
		// The node this belongs to may be far enough down the field (the
		// default arrangement's own nodes now scale up with a wide first-load
		// viewport) to sit below the fold, especially after moveClearBy's own
		// scroll to reach a different node earlier in the same test.
		await handle.scrollIntoViewIfNeeded();
		const handleBox = await handle.boundingBox();
		if (!handleBox) throw new Error('n-text-1 has no se handle');
		const start = {
			x: handleBox.x + handleBox.width / 2,
			y: handleBox.y + handleBox.height / 2
		};
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(start.x + 3 * cell, start.y + 3 * cell, { steps: 15 });
		await expect(page.locator('.grid-stack-item[gs-id="n-comic-1"]')).toHaveClass(
			/group-gesture-follower/
		);
		// Back to exactly where it started, same as the drag-preview "abandoned"
		// case above.
		await page.mouse.move(start.x, start.y, { steps: 15 });
		await page.mouse.up();

		await expect(page.locator('.grid-stack-item[gs-id="n-comic-1"]')).not.toHaveClass(
			/group-gesture-follower/
		);
		await expect.poll(() => geometryWithSize(page)).toEqual(before);
	});
});
