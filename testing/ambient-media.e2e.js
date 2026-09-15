import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audio = fs.readFileSync(path.join(__dirname, 'assets/test-tone.wav'));

async function route(page) {
	await page.route('https://example.invalid/**', (r) => {
		const u = r.request().url();
		if (/\.(mp3|wav)/i.test(u))
			return r.fulfill({ status: 200, contentType: 'audio/wav', body: audio });
		if (/\.(mp4|webm)/i.test(u)) {
			// Deliberately never fulfilled: the request hangs, so the element
			// stays in its loading state and never fires `error`. An erroring
			// video auto-closes the trailer — correct behaviour, but it races
			// every assertion about the trailer being open.
			return;
		}
		return r.fulfill({
			status: 200,
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#4a3fc0"/></svg>'
		});
	});
}

async function enter(page) {
	await page.getByRole('button', { name: 'Start ambient view' }).click();
	const c = page.getByRole('button', { name: 'Enter ambient view' });
	if (await c.isVisible().catch(() => false)) await c.click();
	await expect(page.getByRole('region', { name: 'Ambient view' })).toBeVisible();
}

/** Cycle the visual deck until `predicate` holds, via the tap menu. */
async function cycleVisualUntil(page, predicate, limit = 8) {
	await page.locator('.visual-canvas').dispatchEvent('click');
	await expect(page.locator('.interaction-panel')).toBeVisible();
	for (let i = 0; i < limit; i += 1) {
		if (await predicate()) return true;
		await page.locator('.interaction-panel').getByRole('button', { name: 'Next visual' }).click();
		await page.waitForTimeout(150);
	}
	return predicate();
}

test('view controls live in their own dock, right of the player', async ({ page }) => {
	await route(page);
	await page.setViewportSize({ width: 1100, height: 760 });
	await page.goto('/');
	await enter(page);

	const sound = await page.locator('.sound-dock').boundingBox();
	const view = await page.locator('.view-dock').boundingBox();
	expect(view.x).toBeGreaterThanOrEqual(sound.x + sound.width - 1);
	// Unobstructed view, the manual fullscreen toggle (browser/PWA only),
	// and Options.
	await expect(page.locator('.view-dock button')).toHaveCount(3);
	await expect(
		page.locator('.sound-dock').getByRole('button', { name: 'Ambient options' })
	).toHaveCount(0);
});

test('a game visual offers a trailer that borrows the audio lane', async ({ page }) => {
	await route(page);
	await page.setViewportSize({ width: 1100, height: 760 });
	await page.goto('/');
	await enter(page);

	// Get audio actually sounding first, so "borrowed" is observable.
	await page.locator('.sound-dock').getByRole('button', { name: 'Play ambient audio' }).click();
	await expect
		.poll(() =>
			page.evaluate(() =>
				[
					...document.querySelectorAll('[data-main-player-audio], [data-main-player-audio-plain]')
				].every((el) => /** @type {HTMLAudioElement} */ (el).paused)
			)
		)
		.toBe(false);

	const trailerBtn = page.getByRole('button', { name: /Play the trailer for/ });
	const found = await cycleVisualUntil(page, async () => (await trailerBtn.count()) > 0);
	expect(found, 'expected a game entry with preview_url in the deck').toBe(true);

	await trailerBtn.click();

	// Ambient audio is paused for the trailer. Asserted before anything about
	// the video element itself, because that is the contract under test: one
	// thing sounds at a time.
	await expect
		.poll(() =>
			page.evaluate(() =>
				[
					...document.querySelectorAll('[data-main-player-audio], [data-main-player-audio-plain]')
				].every((el) => /** @type {HTMLAudioElement} */ (el).paused)
			)
		)
		.toBe(true);

	const frame = page.locator('.trailer-frame');
	await expect(frame).toBeVisible();
	await page.locator('.trailer-bar').getByRole('button', { name: 'Close trailer' }).click();
	await expect(frame).toHaveCount(0);

	await expect
		.poll(() =>
			page.evaluate(() =>
				[
					...document.querySelectorAll('[data-main-player-audio], [data-main-player-audio-plain]')
				].every((el) => /** @type {HTMLAudioElement} */ (el).paused)
			)
		)
		.toBe(false);
});

test('the read control follows on-device voice availability', async ({ page }) => {
	await route(page);
	await page.setViewportSize({ width: 1100, height: 760 });
	await page.goto('/');
	await enter(page);

	// Whether this machine has an on-device voice is an environment fact, not
	// a product one, so this asserts the *rule* rather than one outcome: the
	// control exists exactly when a local voice does. speech.svelte.test.js
	// covers the selection itself against a stubbed voice list.
	const hasLocalVoice = await page.evaluate(
		() => 'speechSynthesis' in window && speechSynthesis.getVoices().some((v) => v.localService)
	);

	const readBtn = page.getByRole('button', { name: 'Read this text aloud' });
	const found = await cycleVisualUntil(page, async () => (await readBtn.count()) > 0);

	if (hasLocalVoice) {
		expect(found, 'a local voice exists, so a text entry should offer Read aloud').toBe(true);
		// It belongs on the main view, not only behind a tap.
		await page.locator('.interaction-backdrop').click();
		await expect(page.locator('.interaction-panel')).toHaveCount(0);
		await expect(page.locator('.read-control')).toBeVisible();
	} else {
		// No local voice: the control must be absent rather than present and
		// silently sending the passage to a network synthesiser.
		expect(found).toBe(false);
		await expect(page.locator('.read-control')).toHaveCount(0);
	}
});
