import { expect, test } from '@playwright/test';

test('the audio playlist setting randomizes tracks for a node Play action', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem(
			'indienode:favorites:v1',
			JSON.stringify(['example-audio-driftwood-radio'])
		);
		// Makes Fisher-Yates deterministic: [Harbor Light, Static Tide]
		// becomes [Static Tide, Harbor Light].
		Math.random = () => 0;
	});

	await page.goto('/settings', { waitUntil: 'networkidle' });
	await page.getByRole('tab', { name: 'Content', exact: true }).click();
	// The keyed tab panel lets its outgoing transition finish before mounting
	// Content's vertical tabs.
	await expect(page.getByRole('tab', { name: 'Audio playlist', exact: true })).toBeVisible();
	await page.getByRole('tab', { name: 'Audio playlist', exact: true }).click();

	// On by default; round-trip off and back on to prove the checkbox still
	// drives a real change event and persists, rather than relying on
	// Playwright's `.check()` no-op on an already-checked box to prove nothing.
	const setting = page.getByRole('checkbox', { name: /Randomize tracks within each node/ });
	await expect(setting).toBeChecked();
	await setting.uncheck();
	await expect(setting).not.toBeChecked();
	expect(
		await page.evaluate(
			() =>
				JSON.parse(localStorage.getItem('indienode:preferences:v1') ?? '{}').randomizeAudioTracks
		)
	).toBe(false);

	await setting.check();
	await expect(setting).toBeChecked();
	expect(
		await page.evaluate(
			() =>
				JSON.parse(localStorage.getItem('indienode:preferences:v1') ?? '{}').randomizeAudioTracks
		)
	).toBe(true);

	await page.goto('/lists', { waitUntil: 'networkidle' });
	await page.getByRole('button', { name: 'Play Driftwood Radio (placeholder)' }).click();
	await page.getByRole('button', { name: /Show queue/ }).click();

	await expect(page.locator('.queue-label')).toHaveText(['Static Tide', 'Harbor Light']);
});
