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
