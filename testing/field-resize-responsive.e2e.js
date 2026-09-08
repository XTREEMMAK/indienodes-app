import { expect, test } from '@playwright/test';

const visibleResizeHandles = (page) =>
	page.locator('.grid-stack-item .ui-resizable-handle:visible');

const storedComic = (page) =>
	page.evaluate(() => {
		const raw = localStorage.getItem('indienode:layout:v1');
		const layout = raw ? JSON.parse(raw) : [];
		return layout.find((node) => node.id === 'n-comic-1');
	});

test('the open canvas offers bidirectional node resizing wherever it applies', async ({ page }) => {
	await page.setViewportSize({ width: 1700, height: 900 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	await page.getByRole('button', { name: 'Arrange field' }).click();

	const comicNode = page.locator('.grid-stack-item[gs-id="n-comic-1"]');
	await expect(comicNode.locator('.ui-resizable-handle:visible')).toHaveCount(5);
	const before = (await storedComic(page)) ?? { w: 4, h: 6 };

	const southHandle = comicNode.locator('.ui-resizable-s');
	const southBox = await southHandle.boundingBox();
	if (!southBox) throw new Error('The south resize handle has no bounding box');
	await page.mouse.move(southBox.x + southBox.width / 2, southBox.y + southBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(southBox.x + southBox.width / 2, southBox.y + southBox.height / 2 + 140, {
		steps: 8
	});
	await page.mouse.up();

	await expect.poll(() => storedComic(page).then((node) => node?.w)).toBe(before.w);
	await expect.poll(() => storedComic(page).then((node) => node?.h)).toBeGreaterThan(before.h);
	const afterHeight = await storedComic(page);
	if (!afterHeight) throw new Error('The vertical resize was not persisted');

	const horizontalHandle = comicNode.locator('.ui-resizable-w');
	const horizontalBox = await horizontalHandle.boundingBox();
	if (!horizontalBox) throw new Error('The west resize handle has no bounding box');
	await page.mouse.move(
		horizontalBox.x + horizontalBox.width / 2,
		horizontalBox.y + horizontalBox.height / 2
	);
	await page.mouse.down();
	await page.mouse.move(
		horizontalBox.x + horizontalBox.width / 2 - 140,
		horizontalBox.y + horizontalBox.height / 2,
		{
			steps: 8
		}
	);
	await page.mouse.up();

	await expect.poll(() => storedComic(page).then((node) => node?.w)).toBeGreaterThan(afterHeight.w);

	await page.setViewportSize({ width: 900, height: 900 });
	await expect(visibleResizeHandles(page)).toHaveCount(0);

	await page.setViewportSize({ width: 1700, height: 900 });
	await expect(comicNode.locator('.ui-resizable-s')).toBeVisible();
	await expect(visibleResizeHandles(page)).toHaveCount(25);
});

test('gravity is off only where a drop means reorder', async ({ page }) => {
	// Floating everywhere but the narrowest layout.
	//
	// The canvas floats so a node stays in the gap it was placed in. The
	// re-arranging tier above the stack floats too, and that one is structural:
	// its positions are derived by a shelf packer that leaves a gap under a
	// short node sharing a row with a tall one, and top gravity pulls the next
	// row up into it — so the engine never settled where the layout asked, the
	// effect kept re-asking, and resizing back and forth ran the update depth
	// out. Only the stack keeps gravity, because gravity is what turns a
	// downward drag there into a reorder rather than a slide.
	const isFloating = () =>
		page.locator('.grid-stack').evaluate((element) => element.gridstack?.getFloat());
	const columns = () =>
		page.locator('.grid-stack').evaluate((element) => element.gridstack?.getColumn());

	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	await expect.poll(isFloating).toBe(true);

	// 600 is the lowest of these still above the stack: below roughly 565 there
	// is no room for two of the narrowest nodes side by side, and the count
	// drops straight to four.
	for (const width of [1900, 1600, 1200, 900, 700, 600]) {
		await page.setViewportSize({ width, height: 1000 });
		await expect.poll(columns).toBeGreaterThan(4);
		await expect.poll(isFloating).toBe(true);
	}

	await page.setViewportSize({ width: 400, height: 1000 });
	await expect.poll(columns).toBe(4);
	await expect.poll(isFloating).toBe(false);

	await page.setViewportSize({ width: 1600, height: 1000 });
	await expect.poll(isFloating).toBe(true);
});

test('arrangement dragging moves between neighbours and preserves empty canvas space', async ({
	page
}) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	await page.getByRole('button', { name: 'Arrange field' }).click();

	const dragByCells = async (id, dx, dy = 0) => {
		const node = page.locator('.grid-stack-item[gs-id="' + id + '"]');
		const nodeBox = await node.boundingBox();
		const gridBox = await page.locator('.grid-stack').boundingBox();
		if (!nodeBox || !gridBox) throw new Error('The grid node has no bounding box');
		const cell = gridBox.width / 24;
		await page.mouse.move(nodeBox.x + 20, nodeBox.y + nodeBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(nodeBox.x + 20 + dx * cell, nodeBox.y + nodeBox.height / 2 + dy * cell, {
			steps: 10
		});
		await page.mouse.up();
	};

	await dragByCells('n-comic-1', -2);
	await expect.poll(() => storedComic(page).then((node) => node?.x)).toBeLessThan(8);

	await dragByCells('n-art-1', 5);
	const storedArt = () =>
		page.evaluate(() => {
			const raw = localStorage.getItem('indienode:layout:v1');
			return raw ? JSON.parse(raw).find((node) => node.id === 'n-art-1') : null;
		});
	await expect.poll(() => storedArt().then((node) => node?.x)).toBeGreaterThan(12);
	await expect.poll(() => storedArt().then((node) => node?.y)).toBe(8);
});

test('transient drag collisions do not permanently displace neighbours', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	await page.getByRole('button', { name: 'Arrange field' }).click();

	const gridBox = await page.locator('.grid-stack').boundingBox();
	const comicBox = await page.locator('.grid-stack-item[gs-id="n-comic-1"]').boundingBox();
	if (!gridBox || !comicBox) throw new Error('The drag fixtures have no bounding boxes');
	const cell = gridBox.width / 24;
	const startX = comicBox.x + 20;
	const startY = comicBox.y + comicBox.height / 2;

	await page.mouse.move(startX, startY);
	await page.mouse.down();
	await page.mouse.move(startX + 5 * cell, startY, { steps: 12 });
	await page.waitForTimeout(100);
	await page.mouse.move(startX - 6 * cell, startY, { steps: 12 });
	await page.mouse.up();

	const storedNode = (id) =>
		page.evaluate((nodeId) => {
			const raw = localStorage.getItem('indienode:layout:v1');
			return raw ? JSON.parse(raw).find((node) => node.id === nodeId) : null;
		}, id);

	await expect.poll(() => storedNode('n-comic-1').then((node) => node?.x)).toBeLessThan(8);
	await expect.poll(() => storedNode('n-audio-1')).toMatchObject({ x: 12, y: 0 });
});

for (const mixedSizes of [false, true]) {
	test(`window restore clears responsive offsets (${mixedSizes ? 'mixed' : 'default'} sizes)`, async ({
		page
	}) => {
		if (mixedSizes) {
			await page.addInitScript(() => {
				localStorage.setItem(
					'indienode:layout:v1',
					JSON.stringify([
						{ id: 'a', type: 'audio', tags: [], x: 0, y: 0, w: 7, h: 7 },
						{ id: 'b', type: 'comic', tags: [], x: 7, y: 0, w: 4, h: 6 },
						{ id: 'c', type: 'audio', tags: [], x: 11, y: 0, w: 6, h: 6 },
						{ id: 'd', type: 'game', tags: [], x: 17, y: 0, w: 4, h: 4 }
					])
				);
			});
		}
		await page.setViewportSize({ width: 1900, height: 1000 });
		await page.goto('/');
		await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
		const boxes = () =>
			page.locator('.grid-stack-item').evaluateAll((elements) =>
				elements.map((el) => {
					const { x, y, width, height } = el.getBoundingClientRect();
					return { x, y, width, height };
				})
			);
		const original = await boxes();
		const saved = await page.evaluate(() => localStorage.getItem('indienode:layout:v1'));
		for (const width of [900, 700, 400, 900]) {
			await page.setViewportSize({ width, height: 1000 });
			await expect
				.poll(() => page.locator('.grid-stack').evaluate((el) => el.gridstack.getColumn()))
				.toBeLessThan(24);
			await page.setViewportSize({ width: 1900, height: 1000 });
			await expect.poll(boxes).toEqual(original);
			await expect
				.poll(() =>
					page
						.locator('.grid-stack-item')
						.evaluateAll((elements) => elements.every((el) => el.style.transform === ''))
				)
				.toBe(true);
			await expect
				.poll(() => page.evaluate(() => localStorage.getItem('indienode:layout:v1')))
				.toBe(saved);
		}
	});
}

/**
 * An arrangement authored on a wide display needs more than the authored 24
 * columns, and losing a single one (a scrollbar appearing, browser chrome,
 * zoom) is enough to overflow it. gridstack's own answer to that was to clamp
 * the overflowing node leftward onto its neighbour and then resolve the
 * overlap the only way its engine can — pushing the neighbour down, which
 * pushed the next one down after it. One node over by a single column left a
 * hole where its neighbour had been and shoved a third clean off the bottom:
 * stored 25,0 / 19,0 / 19,6 rendered as 24,0 / 19,6 / 19,12.
 *
 * The layout is derived by `computeCenteredLayout` in that case now, the same
 * packer that already owns every below-authored-count layout. These pin both
 * halves of that: a derived layout is coherent, and it is only ever a
 * rendering — the authored arrangement is untouched and comes back intact.
 */
const OVERFLOWING = [
	{ id: 'n-audio-1', type: 'audio', tags: [], x: 0, y: 0, w: 8, h: 8 },
	{ id: 'n-comic-1', type: 'comic', tags: [], x: 8, y: 0, w: 6, h: 9 },
	{ id: 'n-game-1', type: 'game', tags: [], x: 19, y: 0, w: 6, h: 6 },
	{ id: 'n-text-1', type: 'text', tags: [], x: 19, y: 6, w: 6, h: 4 },
	// Needs columns 25..31, so it fits at 36 columns and overflows at 30.
	{ id: 'n-audio-2', type: 'audio', tags: [], x: 25, y: 0, w: 6, h: 6 }
];

const seedOverflowing = (page) =>
	page.addInitScript(
		([key, layout]) => {
			localStorage.clear();
			localStorage.setItem(key, JSON.stringify(layout));
		},
		['indienode:layout:v1', OVERFLOWING]
	);

const engineGeometry = (page) =>
	page.evaluate(() =>
		Object.fromEntries(
			[...document.querySelectorAll('.grid-stack-item[gs-id]')].map((el) => {
				const node = el.gridstackNode;
				return [el.getAttribute('gs-id'), { x: node?.x, y: node?.y, w: node?.w, h: node?.h }];
			})
		)
	);

test('an arrangement too wide for the columns available packs instead of cascading', async ({
	page
}) => {
	await seedOverflowing(page);
	await page.setViewportSize({ width: 2000, height: 1100 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();

	const columns = await page.locator('.grid-stack').evaluate((el) => el.gridstack.getColumn());
	// The width this is pinned at has to be one the arrangement overflows,
	// or the test proves nothing.
	expect(columns).toBeLessThan(31);

	await expect
		.poll(async () => {
			const items = Object.entries(await engineGeometry(page)).map(([id, g]) => ({ id, ...g }));
			const faults = [];
			for (const item of items) {
				if (item.x + item.w > columns) faults.push(`${item.id} overflows`);
			}
			for (let i = 0; i < items.length; i++) {
				for (let j = i + 1; j < items.length; j++) {
					const a = items[i];
					const b = items[j];
					if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
						faults.push(`${a.id} overlaps ${b.id}`);
					}
				}
			}
			return faults;
		})
		.toEqual([]);
});

test('a derived layout never rewrites the arrangement it was derived from', async ({ page }) => {
	await seedOverflowing(page);
	await page.setViewportSize({ width: 2000, height: 1100 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	await page.waitForTimeout(600);

	const saved = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('indienode:layout:v1') ?? '[]')
	);
	for (const authored of OVERFLOWING) {
		expect(
			saved.find((node) => node.id === authored.id),
			authored.id
		).toMatchObject({
			x: authored.x,
			y: authored.y,
			w: authored.w,
			h: authored.h
		});
	}
});

test('the authored arrangement renders as authored once it fits again', async ({ page }) => {
	await seedOverflowing(page);
	// 36 columns, which the arrangement's 31-column extent fits inside.
	await page.setViewportSize({ width: 2400, height: 1100 });
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();

	await expect
		.poll(() => engineGeometry(page))
		.toEqual(
			Object.fromEntries(
				OVERFLOWING.map((node) => [node.id, { x: node.x, y: node.y, w: node.w, h: node.h }])
			)
		);
});

/**
 * A second, independent bug from the one above, found live on a real
 * deployment: an arrangement that fits its column count with room to spare
 * could still come back wrong on load, with one node's x, w, and h all
 * correct and only its y off. Restoring N nodes straight to their authored
 * positions, one at a time, risks a later restoration colliding with an
 * earlier one's just-corrected position and shoving it away again —
 * gridstack evaluates collision live on every `grid.update()` call even
 * inside a batch, the same fact `replayGroupScale` already had to work
 * around once for a live gesture, just hit here for a settle-on-load pass
 * instead. Confirmed by reverting the fix (a two-phase move: park every
 * pending node somewhere nothing else can ever be, then place real
 * positions) against this exact layout and watching it reproduce.
 *
 * Every shape below is deliberately legal for its type (`coerceNode`
 * silently re-snaps an illegal one regardless of columns, which reads as
 * this bug but is not) and no two boxes overlap (gridstack's own collision
 * handling will relocate one deliberately, which also reads as this bug but
 * is not) — both mistakes were made and caught while first writing this.
 */
const RESTORE_ORDER_SENSITIVE = [
	{ id: 'n-audio-1', type: 'audio', tags: [], x: 0, y: 0, w: 5, h: 5 },
	{ id: 'n-comic-1', type: 'comic', tags: [], x: 5, y: 0, w: 4, h: 6 },
	{ id: 'n-audio-2', type: 'audio', tags: [], x: 9, y: 0, w: 5, h: 5 },
	{ id: 'n-art-1', type: 'art', tags: [], x: 14, y: 0, w: 5, h: 5 },
	{ id: 'n-comic-2', type: 'comic', tags: [], x: 0, y: 5, w: 5, h: 8 },
	{ id: 'n-text-1', type: 'text', tags: [], x: 16, y: 7, w: 4, h: 7 },
	{ id: 'n-text-2', type: 'text', tags: [], x: 10, y: 5, w: 4, h: 6 },
	{ id: 'n-game-1', type: 'game', tags: [], x: 19, y: 0, w: 5, h: 5 },
	{ id: 'n-audio-3', type: 'audio', tags: [], x: 25, y: 0, w: 5, h: 5 },
	{ id: 'n-text-3', type: 'text', tags: [], x: 20, y: 5, w: 4, h: 4 }
];

test('a wide, non-overflowing arrangement restores every node exactly, repeatedly', async ({
	page
}) => {
	await page.addInitScript(
		([key, layout]) => {
			localStorage.clear();
			localStorage.setItem(key, JSON.stringify(layout));
		},
		['indienode:layout:v1', RESTORE_ORDER_SENSITIVE]
	);
	// The exact width and resulting column count from the live report (33
	// columns; the arrangement only needs 30).
	await page.setViewportSize({ width: 2195, height: 1300 });

	const want = Object.fromEntries(
		RESTORE_ORDER_SENSITIVE.map((node) => [node.id, { x: node.x, y: node.y, w: node.w, h: node.h }])
	);
	for (let pass = 0; pass < 3; pass++) {
		await page.goto('/');
		await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
		await expect.poll(() => engineGeometry(page)).toEqual(want);
	}
});
