import { expect, test } from '@playwright/test';

test('ambient mobile surface exposes audio navigation and tap-paused visual actions', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');

	await page.getByRole('button', { name: 'Ambient', exact: true }).click();
	await page.getByRole('button', { name: 'Enter ambient view' }).click();

	const ambient = page.getByRole('region', { name: 'Ambient view' });
	await expect(ambient).toBeVisible();
	await expect(page.getByRole('button', { name: 'Play ambient audio' })).toBeVisible();
	await expect(page.locator('[data-preview-player-audio]')).toHaveJSProperty('paused', true);

	const playlistButton = page.getByRole('button', { name: /Open current playlist/ });
	const nextAudioButton = page.getByRole('button', { name: 'Show next audio discovery' });
	const discoveryCard = page.locator('.audio-discovery-card');
	await expect(playlistButton).toBeVisible();
	await expect(nextAudioButton).toBeVisible();
	// Not exact: the chip appends the declared form label (see
	// ambient-adjustments.e2e.js for that assertion) and this test is only
	// about the surrounding mobile nav, not the chip's exact wording.
	await expect(discoveryCard.getByText('Audio Next', { exact: false })).toBeVisible();
	const progressFill = discoveryCard.locator('.audio-rotation-progress span');
	await expect(progressFill).toBeVisible();
	const progressBefore = await progressFill.boundingBox();
	await page.waitForTimeout(250);
	const progressAfter = await progressFill.boundingBox();
	expect(progressAfter.width).toBeGreaterThan(progressBefore.width + 1);
	const [discoveryBox, soundDockBox] = await Promise.all([
		discoveryCard.boundingBox(),
		page.locator('.sound-dock').boundingBox()
	]);
	expect(discoveryBox).not.toBeNull();
	expect(soundDockBox).not.toBeNull();
	expect(Math.abs(discoveryBox.width - discoveryBox.height)).toBeLessThan(2);
	expect(discoveryBox.width).toBeGreaterThan(210);
	expect(discoveryBox.x + discoveryBox.width / 2).toBeGreaterThan(390 / 2);
	expect(soundDockBox.y - (discoveryBox.y + discoveryBox.height)).toBeGreaterThan(12);
	await page.getByRole('button', { name: 'Hide audio discovery card' }).click();
	await expect(page.locator('.audio-discovery-card')).toBeHidden();
	await page.getByRole('button', { name: 'Ambient options' }).click();
	await page.getByRole('button', { name: 'Show audio discovery' }).click();
	await page.locator('.options-heading').getByRole('button', { name: 'Close options' }).click();
	await expect(page.locator('.audio-discovery-card')).toBeVisible();

	await playlistButton.click();
	await expect(page.getByRole('heading', { name: 'Current playlist' })).toBeVisible();
	await expect(page.locator('.playlist-section')).toBeFocused();
	await page.locator('.options-heading').getByRole('button', { name: 'Close options' }).click();

	await page.locator('.visual-canvas').dispatchEvent('click');
	await expect(page.getByText('Visual rotation paused')).toBeVisible();

	const interactionPanel = page.locator('.interaction-panel');
	const likeAudio = interactionPanel.getByRole('button', { name: /Like audio by/ });
	const hideAudio = interactionPanel.getByRole('button', { name: /Not for Me audio by/ });
	await expect(likeAudio).toBeVisible();
	await expect(hideAudio).toBeVisible();
	await expect(interactionPanel.getByRole('link', { name: /Visit audio creator/ })).toBeVisible();
	await expect(interactionPanel.getByRole('button', { name: 'Next visual' })).toBeVisible();
	await expect(interactionPanel.getByRole('link', { name: /Report visual by/ })).toBeVisible();

	const [panelHeader, audioRow, visualRow] = await Promise.all([
		interactionPanel.locator('header').boundingBox(),
		page.locator('.audio-action-row').boundingBox(),
		page.locator('.visual-action-row').boundingBox()
	]);
	expect(panelHeader).not.toBeNull();
	expect(audioRow).not.toBeNull();
	expect(visualRow).not.toBeNull();
	expect(Math.abs(audioRow.width - visualRow.width)).toBeLessThan(2);
	expect(audioRow.width).toBeGreaterThan(360);
	expect(audioRow.height).toBeGreaterThan(70);
	const actionGroupCenter = (panelHeader.y + visualRow.y + visualRow.height) / 2;
	expect(Math.abs(actionGroupCenter - 844 / 2)).toBeLessThan(24);

	await page
		.getByRole('button', { name: 'Dismiss creator actions' })
		.click({ position: { x: 2, y: 2 } });
	await expect(page.getByText('Visual rotation paused')).toBeHidden();
});
