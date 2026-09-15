import { expect, test } from '@playwright/test';

const MOBILE_VIEWPORT = { width: 400, height: 1146 };

test.beforeEach(async ({ page }) => {
	await page.setViewportSize(MOBILE_VIEWPORT);
});

test('members use cover art as a readable full-card mobile background', async ({ page }) => {
	await page.route('https://f4.bcbits.com/**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><path fill="#345" d="M0 0h400v240H0z"/><circle fill="#d86" cx="300" cy="80" r="70"/></svg>'
		})
	);
	await page.goto('/members');
	await expect(page.locator('#member-search')).toBeVisible();
	await expect(page.getByText('Paper Lantern', { exact: false }).first()).toBeVisible();

	const member = page.locator('.member.has-cover').first();
	await expect(member).toBeVisible();

	const dimensions = await member.evaluate((element) => {
		const thumbElement = element.querySelector('.thumb');
		return {
			memberWidth: element.clientWidth,
			memberHeight: element.clientHeight,
			thumbWidth: thumbElement?.clientWidth,
			thumbHeight: thumbElement?.clientHeight
		};
	});
	expect(dimensions.thumbWidth).toBe(dimensions.memberWidth);
	expect(dimensions.thumbHeight).toBe(dimensions.memberHeight);

	await expect(member.locator('.member-why')).toHaveCSS('font-size', '18.4px');
});

test('mobile modal and submission routes use the compact type scale', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Ambient', exact: true }).click();

	const dialog = page.getByRole('dialog', { name: 'Start ambient view?' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('heading', { name: 'Start ambient view?' })).toHaveCSS(
		'font-size',
		'28.8px'
	);
	await expect(dialog.locator('.consent-copy')).toHaveCSS('font-size', '22.4px');

	await page.goto('/join');
	await expect(page.locator('.join-page')).toHaveCSS('font-size', '22.4px');

	await page.goto('/update');
	await expect(page.locator('.join-page')).toHaveCSS('font-size', '22.4px');
});

test('mobile arrange mode leaves touches to scroll instead of dragging nodes', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();
	const nodes = page.locator('.grid-stack-item');
	const readOrder = () =>
		nodes.evaluateAll((items) => items.map((item) => item.getAttribute('gs-id')));
	const before = await readOrder();
	expect(before.length).toBeGreaterThan(1);

	await page.getByRole('button', { name: 'Arrange field' }).click();
	await expect(page.locator('.mobile-reorder')).toHaveCount(before.length);
	// The up/down buttons are the reorder mechanism here, so no card is a drag
	// surface: gridstack marks every item disabled and drops its touch handlers.
	await expect(nodes.first()).toHaveClass(/ui-draggable-disabled/);
	await expect(page.locator('.grid-stack-item:not(.ui-draggable-disabled)')).toHaveCount(0);

	// The gesture itself is covered in field-drag-stability.e2e.js.
	expect(await readOrder()).toEqual(before);
});

test('mobile arrange buttons reorder nodes and persist the sequence', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.grid-stack.gs-visible')).toBeVisible();

	const nodes = page.locator('.grid-stack-item');
	const before = await nodes.evaluateAll((items) =>
		items.map((item) => item.getAttribute('gs-id'))
	);
	expect(before.length).toBeGreaterThan(1);

	await page.getByRole('button', { name: 'Arrange field' }).click();
	const controls = page.locator('.mobile-reorder');
	await expect(controls).toHaveCount(before.length);
	await expect(controls.first().getByRole('button', { name: /node up$/ })).toBeDisabled();
	await expect(controls.last().getByRole('button', { name: /node down$/ })).toBeDisabled();

	await controls
		.nth(1)
		.getByRole('button', { name: /node up$/ })
		.click();

	const expected = [...before];
	[expected[0], expected[1]] = [expected[1], expected[0]];
	await expect
		.poll(() => nodes.evaluateAll((items) => items.map((item) => item.getAttribute('gs-id'))))
		.toEqual(expected);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const raw = localStorage.getItem('indienode:layout:v1');
				return raw ? JSON.parse(raw).map((node) => node.id) : [];
			})
		)
		.toEqual(expected);
});

test('mobile settings open sections from a drill-down list and back', async ({ page }) => {
	await page.goto('/settings', { waitUntil: 'networkidle' });
	await page.getByRole('tab', { name: 'Content', exact: true }).click();

	// No wrapped strip of sub-tabs: one row per section, each saying what it
	// is set to.
	await expect(page.locator('.section-tabs')).toHaveCount(0);
	const list = page.getByRole('list', { name: 'Content settings' });
	await expect(list).toBeVisible();
	await expect(list.getByRole('button')).toHaveCount(8);
	await expect(list.getByRole('button', { name: /^Explicit content/ })).toContainText('Hidden');
	await expect(list.getByRole('button', { name: /^Tags/ })).toContainText('All');

	await list.getByRole('button', { name: /^Tags/ }).click();
	const panel = page.getByRole('region', { name: 'Tags' });
	await expect(panel.getByRole('heading', { name: 'Tags' })).toBeVisible();
	await expect(panel).toBeFocused();
	await expect(list).toHaveCount(0);

	await page.getByRole('button', { name: 'Content', exact: true }).click();
	await expect(page.getByRole('list', { name: 'Content settings' })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Tags/ })).toBeFocused();
});
