import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audio = fs.readFileSync(path.join(__dirname, 'assets/test-tone.wav'));

/**
 * The minimized player's drag, clamp and persistence had no coverage at all
 * before it became its own component. The clamp arithmetic is unit-tested in
 * miniPlayerPosition.test.js; this checks the wiring around it.
 */
test('the mini player drags, persists, and expands again', async ({ page }) => {
	await page.route('https://example.invalid/**', (r) =>
		/\.(mp3|wav)/i.test(r.request().url())
			? r.fulfill({ status: 200, contentType: 'audio/wav', body: audio })
			: r.fulfill({
					status: 200,
					contentType: 'image/svg+xml',
					body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'
				})
	);
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));

	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/');
	await page
		.getByRole('button', { name: /^Play / })
		.first()
		.click();
	await expect(page.locator('.player')).toBeVisible();

	await page.getByRole('button', { name: 'Minimize player' }).click();
	const dock = page.locator('.mini-player');
	await expect(dock).toBeVisible();

	const before = await dock.boundingBox();

	// Drag it by its handle.
	const handle = page.locator('.mini-drag-handle');
	const hb = await handle.boundingBox();
	await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
	await page.mouse.down();
	await page.mouse.move(400, 300, { steps: 10 });
	await page.mouse.up();

	const after = await dock.boundingBox();
	expect(after.x, 'dock should have moved').not.toBeCloseTo(before.x, 0);

	// The position is remembered.
	const stored = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('indienode:player-position:v1') ?? 'null')
	);
	expect(stored).not.toBeNull();
	expect(Number.isFinite(stored.x)).toBe(true);

	// Still on screen, and still expandable back to the full player.
	expect(after.x).toBeGreaterThanOrEqual(0);
	expect(after.x + after.width).toBeLessThanOrEqual(1280);
	await page.getByRole('button', { name: /^Expand player/ }).click();
	await expect(page.locator('.player')).toBeVisible();
	await expect(dock).toHaveCount(0);

	expect(errors).toEqual([]);
});

test('the mobile player replaces the nav and preserves hide versus close', async ({ page }) => {
	await page.route('https://example.invalid/**', (route) =>
		/\.(mp3|wav)/i.test(route.request().url())
			? route.fulfill({ status: 200, contentType: 'audio/wav', body: audio })
			: route.fulfill({
					status: 200,
					contentType: 'image/svg+xml',
					body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'
				})
	);
	const errors = [];
	page.on('pageerror', (error) => errors.push(String(error)));

	await page.setViewportSize({ width: 400, height: 1146 });
	await page.goto('/');
	await page
		.getByRole('button', { name: /^Play / })
		.first()
		.click();

	const player = page.locator('.player');
	const nav = page.locator('.nav-mobile');
	await expect(player).toBeVisible();
	await expect(nav).toHaveAttribute('aria-hidden', 'true');
	await expect(nav).toHaveCSS('opacity', '0');
	await expect(page.getByRole('button', { name: 'Hide player controls' })).toBeVisible();
	await page.getByRole('button', { name: /^Show queue,/ }).click();
	const queueList = page.locator('.queue-list');
	const queueItems = queueList.locator('.queue-item');
	const beforeOrder = await queueItems.locator('.queue-label').allTextContents();
	expect(beforeOrder.length).toBeGreaterThan(1);
	await expect(queueList.getByRole('button', { name: 'Stop and clear audio' })).toBeVisible();
	await expect(queueList.locator('.mobile-queue-footer')).toHaveCSS('position', 'sticky');
	await page.waitForTimeout(250);

	const queueMetrics = await queueList.evaluate((list) => {
		const listRect = list.getBoundingClientRect();
		const itemRects = [...list.querySelectorAll('.queue-item')].map((item) =>
			item.getBoundingClientRect()
		);
		const footerRect = list.querySelector('.mobile-queue-footer').getBoundingClientRect();
		return {
			fullyVisibleItems: itemRects.filter(
				(rect) => rect.top >= listRect.top && rect.bottom <= listRect.bottom
			).length,
			footerVisible: footerRect.top >= listRect.top && footerRect.bottom <= listRect.bottom,
			labelSize: Number.parseFloat(getComputedStyle(list.querySelector('.queue-label')).fontSize),
			entrySize: Number.parseFloat(getComputedStyle(list.querySelector('.queue-entry')).fontSize)
		};
	});
	expect(queueMetrics.fullyVisibleItems).toBe(beforeOrder.length);
	expect(queueMetrics.footerVisible).toBe(true);
	expect(queueMetrics.labelSize).toBeLessThanOrEqual(16);
	expect(queueMetrics.entrySize).toBeLessThanOrEqual(13);

	// At a mobile viewport native draggable is disabled; this exercises the
	// Pointer Events path used by a finger dragging the visible grip.
	const firstGrip = queueItems.first().locator('.queue-grip');
	const lastRow = queueItems.last();
	const gripBox = await firstGrip.boundingBox();
	const lastBox = await lastRow.boundingBox();
	await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height * 0.75, {
		steps: 10
	});
	await page.mouse.up();

	await expect
		.poll(() => queueItems.locator('.queue-label').allTextContents())
		.toEqual([...beforeOrder.slice(1), beforeOrder[0]]);

	const playerBottom = await player.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return window.innerHeight - rect.bottom;
	});
	expect(playerBottom).toBeCloseTo(12, 0);

	const shelf = page.locator('.player .now-playing');
	await expect(shelf).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
	const hide = shelf.getByRole('button', { name: /is not for me/ });
	const like = shelf.getByRole('button', { name: /Add .* to favorites/ });
	await expect(hide).toBeVisible();
	await expect(like).toBeVisible();
	const [shelfBox, metaBox, hideBox, likeBox] = await Promise.all([
		shelf.boundingBox(),
		shelf.locator('.meta').boundingBox(),
		hide.boundingBox(),
		like.boundingBox()
	]);
	expect(hideBox.x).toBeGreaterThan(metaBox.x);
	expect(likeBox.x).toBeGreaterThan(hideBox.x);
	expect(shelfBox.x + shelfBox.width - (likeBox.x + likeBox.width)).toBeLessThan(16);
	const layerGap = await player.evaluate((element) => {
		const metadata = element.querySelector('.now-playing');
		const play = element.querySelector('.transport button:nth-child(2)');
		const playStyle = getComputedStyle(play);
		return (
			play.offsetTop -
			Number.parseFloat(playStyle.marginTop) -
			(metadata.offsetTop + metadata.offsetHeight)
		);
	});
	expect(Math.abs(layerGap)).toBeLessThanOrEqual(1);

	await page.getByRole('button', { name: 'Hide player controls' }).click();
	await expect(player).toHaveCount(0);
	await expect(nav).not.toHaveAttribute('aria-hidden', 'true');
	await expect(nav).toHaveCSS('opacity', '1');
	await expect(page.getByRole('button', { name: 'Open audio player' })).toBeVisible();

	await page.getByRole('button', { name: 'Open audio player' }).click();
	await expect(player).toBeVisible();
	await page.getByRole('button', { name: 'Close player and clear queue' }).click();
	await expect(player).toHaveCount(0);
	await expect(nav).toHaveCSS('opacity', '1');
	await expect(page.getByRole('button', { name: 'Open audio player' })).toHaveCount(0);

	expect(errors).toEqual([]);
});
