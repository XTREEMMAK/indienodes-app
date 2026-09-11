import { expect, test } from '@playwright/test';

test('join success shows confirmation and live embed previews', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'join-mock-dev');

	await page.addInitScript(() => localStorage.clear());
	await page.setViewportSize({ width: 1280, height: 1000 });
	await page.goto('/join', { waitUntil: 'networkidle' });

	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await page.getByRole('radio', { name: /Yes, I have a site/ }).check();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await page.locator('#f-creator').fill('Success Preview Test');
	await page.locator('#f-type').selectOption('audio');
	await page.locator('#f-form').selectOption('music');
	await page.locator('#f-why').fill('Exercises the final confirmation state.');
	await page.locator('#f-source').fill('https://example.com');
	await page.locator('#f-tags').fill('test');
	await page.locator('#f-tags').press('Enter');
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await page.getByRole('button', { name: 'Generate my token' }).click();
	await page.getByRole('button', { name: 'Verify', exact: true }).click();
	await expect(page.getByText('Verified. That page is yours.')).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await page.locator('#f-email').fill('preview@example.com');
	await page.locator('#f-pro').selectOption('Not a member');
	await page.getByRole('checkbox', { name: /I confirm that I hold full rights/ }).check();
	await page.getByRole('checkbox', { name: /By submitting, you affirm/ }).check();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await page.setViewportSize({ width: 390, height: 844 });
	const exactData = page.locator('details.exact-data');
	await expect(exactData).toHaveCSS('overflow', 'hidden');
	expect(
		await exactData.evaluate((element) => Number.parseFloat(getComputedStyle(element).borderRadius))
	).toBeGreaterThan(0);
	await exactData.locator('summary').click();
	const exactDataScroll = exactData.locator('.exact-data-scroll');
	await expect(exactDataScroll).toHaveCSS('overflow-x', 'auto');
	await expect(exactData.locator('pre')).toContainText('Success Preview Test');
	expect(
		await exactDataScroll.evaluate((element) => ({
			clientWidth: element.clientWidth,
			scrollWidth: element.scrollWidth
		}))
	).toMatchObject({
		clientWidth: expect.any(Number),
		scrollWidth: expect.any(Number)
	});
	expect(
		await exactDataScroll.evaluate((element) => element.scrollWidth > element.clientWidth)
	).toBe(true);

	await page.getByRole('button', { name: 'Submit my entry' }).click();

	await expect(page.getByRole('heading', { name: 'Request Submitted!' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'That is in.' })).toHaveCount(0);
	await expect(page.locator('.success-check')).toBeVisible();
	// Four tiers since the widget-iframe-isolation work split "Full widget"
	// into a sandboxed iframe (this one, the new default) and an "Full widget
	// (advanced)" script tag -- see docs/decisions.md.
	await expect(page.locator('.success-tier-card')).toHaveCount(4);
	await expect(page.locator('.success-tier-card .success-preview-frame')).toHaveCount(4);
	// Neither widget tier's real embed loads inside this preview iframe --
	// the script tier's module fetch needs a real origin the sandbox denies
	// it, and the iframe tier means nesting a real cross-origin frame inside
	// this already-sandboxed one, which nothing here relies on (fixed
	// 2026-08-31 -- this iframe used to carry `allow-same-origin` solely to
	// let the script tier's fetch succeed, the same gap the editor preview at
	// join-editor-preview.e2e.js was already free of). A still stands in for
	// both, same as that other preview.
	const widgetStill = page
		.frameLocator('iframe[title="Full widget preview"]')
		.locator('.indienodes-widget-preview');
	await expect(widgetStill).toBeVisible();
	await expect(widgetStill).toContainText('IndieNodes');
	await page.locator('.success-tier-card:has(input[value=badge])').click();
	await expect(page.locator('.success-badge-card')).toHaveCount(4);
	await expect(page.locator('.success-badge-card .success-preview-frame')).toHaveCount(4);
	await expect(
		page.frameLocator('iframe[title="Classic badge preview"]').locator('img')
	).toHaveJSProperty('complete', true);
	expect(
		await page
			.frameLocator('iframe[title="Classic badge preview"]')
			.locator('img')
			.evaluate((image) => image.naturalWidth)
	).toBeGreaterThan(0);
	await expect(page.locator('.success-tier-card.selected')).toContainText('Badge');
});
