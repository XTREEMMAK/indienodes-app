import { expect, test } from '@playwright/test';

/**
 * Covers the media step of `/join` for a submitter who already has a site.
 *
 * Written before that step was extracted into its own component. `/join` is
 * the highest-stakes flow in the app — losing a half-finished submission is
 * the worst failure it has — and it had exactly one end-to-end test, which
 * walks the other branch. This is the net the extraction is done against.
 */
test('the own-site media step adds, fills and removes track rows', async ({ page }) => {
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));

	await page.setViewportSize({ width: 1280, height: 900 });
	await page.addInitScript(() => localStorage.clear());
	await page.goto('/join');

	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Do you have a site?' })).toBeVisible();

	// The "I already have a site" branch.
	await page.getByRole('radio', { name: /Yes, I have a site/ }).check();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await expect(page.getByRole('heading', { name: 'Your entry' })).toBeVisible();
	await page.locator('#f-creator').fill('Driftwood Radio');
	await page.locator('#f-type').selectOption('audio');
	await page.locator('#f-why').fill('Warm tape loops for late evenings.');
	await page.locator('#f-source').fill('https://example.com');
	// At least one tag is required before the step will advance; the field
	// commits on Enter.
	await page.locator('#f-tags').fill('ambient');
	await page.locator('#f-tags').press('Enter');
	await expect(page.locator('.tag-list button.chip.checked')).toHaveCount(1);

	const entryContinue = page.getByRole('button', { name: 'Continue', exact: true }).last();
	// Music/spoken is required for audio; everything else on this step is
	// already filled in, so this isolates the form field as the reason.
	await expect(entryContinue).toBeDisabled();
	await page.locator('#f-form').selectOption('music');
	await expect(entryContinue).toBeEnabled();

	await entryContinue.click();
	await expect(page.getByRole('heading', { name: 'Your tracks' })).toBeVisible();

	const rows = page.locator('.repeat-row');
	const startCount = await rows.count();

	await page
		.getByRole('button', { name: /Add (a )?track/i })
		.first()
		.click();
	await expect(rows).toHaveCount(startCount + 1);

	// The new row is real and fillable.
	const lastLabel = page.getByLabel(/track \d+ name/i).last();
	await lastLabel.fill('Harbor Light');
	await expect(lastLabel).toHaveValue('Harbor Light');

	// Adding a row focuses its first field, which is the whole point of the
	// shared row-focus action: a new row routinely lands below the fold.
	const focusedId = await page.evaluate(() => document.activeElement?.id ?? '');
	expect(focusedId, 'the new row should take focus').toMatch(/track/i);

	// And removable again.
	await page
		.getByRole('button', { name: /remove/i })
		.last()
		.click();
	await expect(rows).toHaveCount(startCount);

	expect(errors).toEqual([]);
});
