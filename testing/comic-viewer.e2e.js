import { expect, test } from '@playwright/test';

/**
 * The reader had no end-to-end coverage at all, which is what made extracting
 * its gesture thresholds worth doing carefully. The reset-zoom assertion is a
 * real past bug: resetting used to clear `loaded`, stranding the spinner over
 * an image that was already on screen, reachable three ways.
 */

test('mobile Back closes the shared comic/art viewer before leaving the field', async ({
	page
}) => {
	await page.route('https://example.invalid/**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="800" height="1200" fill="#333"/></svg>'
		})
	);
	await page.setViewportSize({ width: 390, height: 844 });
	// Give the field a real previous route. If the viewer does not intercept
	// Back, this test will visibly navigate to Members instead of staying here.
	await page.goto('/members');
	await page.goto('/');
	await page.waitForTimeout(900);
	const fieldUrl = page.url();

	const read = page.getByRole('button', { name: /^Read / }).first();
	await read.waitFor({ state: 'visible' });
	await read.click();
	await expect(page.getByRole('dialog', { name: /comic reader/i })).toBeVisible();
	await page.goBack();
	await expect(page.getByRole('dialog', { name: /comic reader/i })).toHaveCount(0);
	expect(page.url()).toBe(fieldUrl);
});

test('comic reader zoom, paging and reset still work after the gesture extraction', async ({
	page
}) => {
	await page.route('https://example.invalid/**', (r) =>
		r.fulfill({
			status: 200,
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="800" height="1200" fill="#333"/></svg>'
		})
	);
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));

	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/');
	await page.waitForTimeout(900);

	const read = page.getByRole('button', { name: /^Read / }).first();
	await read.waitFor({ state: 'visible' });
	await read.click();

	const viewer = page.getByRole('dialog', { name: /comic reader/i });
	await expect(viewer).toBeVisible();

	const zoomOf = () =>
		page.evaluate(() => {
			const el = document.querySelector('.viewer .stage img');
			const t = el ? getComputedStyle(el).transform : '';
			if (!t || t === 'none') return 1;
			return Number(t.match(/matrix\(([-\d.]+)/)?.[1] ?? 1);
		});

	expect(await zoomOf()).toBeCloseTo(1, 2);

	// Wheel zoom in.
	await page.locator('.viewer .stage').hover();
	await page.mouse.wheel(0, -120);
	await page.waitForTimeout(200);
	const zoomed = await zoomOf();
	expect(zoomed, 'wheel should zoom in').toBeGreaterThan(1);

	// Keyboard paging + reset.
	await page.keyboard.press('ArrowRight');
	await page.waitForTimeout(200);
	await page.keyboard.press('0');
	await page.waitForTimeout(250);
	expect(await zoomOf(), 'the 0 key should reset zoom').toBeCloseTo(1, 2);

	// And the spinner must not be stuck over a perfectly good image.
	await expect(page.locator('.viewer .stage img')).toBeVisible();
	expect(errors).toEqual([]);
});
