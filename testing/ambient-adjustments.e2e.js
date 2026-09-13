import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const realAudio = fs.readFileSync(path.join(__dirname, 'assets/test-tone.wav'));

async function routeAudio(page) {
	await page.route('https://example.invalid/**', (route) => {
		if (/\.(mp3|wav|ogg|m4a)(\?|$)/i.test(route.request().url())) {
			return route.fulfill({ status: 200, contentType: 'audio/wav', body: realAudio });
		}
		return route.fulfill({
			status: 200,
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'
		});
	});
}

async function enterAmbient(page) {
	await page.getByRole('button', { name: 'Start ambient view' }).click();
	const confirm = page.getByRole('button', { name: 'Enter ambient view' });
	if (await confirm.isVisible().catch(() => false)) await confirm.click();
	await expect(page.getByRole('region', { name: 'Ambient view' })).toBeVisible();
}

test('b: discovery chip reads "Audio Next", plus the form label for a declared entry', async ({
	page
}) => {
	await routeAudio(page);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/');
	await enterAmbient(page);
	// The seeded fixture's audio entries are all `form: "music"` (see
	// testing/ring.e2e.json), so the chip appends that label -- the addendum's
	// "visible form label" requirement.
	await expect(page.locator('.audio-discovery-chip')).toHaveText('Audio Next · Music');
});

test('a: candidate preview honours the player volume instead of full blast', async ({ page }) => {
	await routeAudio(page);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.addInitScript(() => localStorage.setItem('indienode:volume:v1', '0.25'));
	await page.goto('/');
	await enterAmbient(page);

	await page.getByRole('button', { name: /^Preview / }).click();
	await expect
		.poll(() => page.evaluate(() => document.querySelector('.candidate-preview-audio')?.volume))
		.toBeCloseTo(0.25, 2);
});

test('a: entering with a queue adopts it instead of starting its own preview', async ({ page }) => {
	await routeAudio(page);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/');

	// Build a real queue first.
	await page
		.getByRole('button', { name: /^Play / })
		.first()
		.click();
	await expect(page.locator('.player')).toBeVisible();

	// `currentSrc` is not set when the element mounts -- the browser assigns it
	// at the end of its own resource selection, a beat later -- so "the player
	// is visible" does not yet mean "the source resolved". Reading `before`
	// without waiting for it captured "" on a loaded CI runner and then
	// compared that against the real URL below, so a test about whether ambient
	// *changed* the track failed on a value that only meant it had not loaded
	// yet. Locally it passed every time, because resolution beat the read.
	await expect
		.poll(() => page.evaluate(() => document.querySelector('[data-main-player-audio]')?.currentSrc))
		.toBeTruthy();

	const before = await page.evaluate(
		() => document.querySelector('[data-main-player-audio]')?.currentSrc
	);

	await enterAmbient(page);

	// The main element keeps playing; ambient did not duck it to run a preview.
	await expect
		.poll(() => page.evaluate(() => document.querySelector('[data-main-player-audio]')?.paused))
		.toBe(false);
	const after = await page.evaluate(
		() => document.querySelector('[data-main-player-audio]')?.currentSrc
	);
	expect(after).toBe(before);
	// The ambient preview lane stayed empty.
	await expect
		.poll(() =>
			page.evaluate(() => document.querySelector('[data-preview-player-audio]')?.currentSrc)
		)
		.toBeFalsy();
	// The playlist the visitor built is what the dock reports.
	await page.getByRole('button', { name: /Open current playlist/ }).click();
	await expect(page.getByRole('heading', { name: 'Current playlist' })).toBeVisible();
	await expect(page.locator('.playlist-section li')).not.toHaveCount(0);
});

test('c: unobstructed view hides all chrome and a tap restores it', async ({ page }) => {
	await routeAudio(page);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/');
	await enterAmbient(page);

	await expect(page.locator('.sound-dock')).toBeVisible();
	await page.getByRole('button', { name: 'Hide controls for an unobstructed view' }).click();

	await expect(page.locator('.sound-dock')).toHaveCount(0);
	await expect(page.locator('.audio-discovery-card')).toHaveCount(0);
	await expect(page.locator('.immersive-hint')).toBeVisible();

	await page.locator('.visual-canvas').dispatchEvent('click');
	await expect(page.locator('.sound-dock')).toBeVisible();
});

test('d: tap menu offers the viewer, and it opens the reader', async ({ page }) => {
	await routeAudio(page);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/');
	await enterAmbient(page);

	const viewerButton = page.getByRole('button', { name: /full screen viewer/ });
	const nextVisual = page
		.locator('.interaction-panel')
		.getByRole('button', { name: 'Next visual' });

	// The visual deck holds one comic among the non-audio entries; cycling it
	// reaches that entry within a full pass.
	await page.locator('.visual-canvas').dispatchEvent('click');
	await expect(page.locator('.interaction-panel')).toBeVisible();
	for (let i = 0; i < 6 && !(await viewerButton.count()); i += 1) {
		await nextVisual.click();
		await page.waitForTimeout(120);
	}

	await expect(viewerButton).toBeVisible();
	await viewerButton.click();
	// The reader is a sibling of the ambient overlay and takes over the screen.
	await expect(page.getByRole('dialog', { name: /comic reader/i })).toBeVisible();
	// Ambient is still underneath, not closed by the fullscreen release.
	await expect(page.getByRole('region', { name: 'Ambient view' })).toBeAttached();
});

test('c: now playing announces a track change but not the first track', async ({ page }) => {
	await routeAudio(page);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/');
	await enterAmbient(page);

	// Entering announces nothing: the first track is what they just chose.
	await page.waitForTimeout(600);
	await expect(page.locator('.now-playing-toast')).toHaveCount(0);

	// Swapping to the discovery candidate is a real track change.
	await page.getByRole('button', { name: /^Replace ambient audio with/ }).click();
	await expect(page.locator('.now-playing-toast')).toBeVisible();
	await expect(page.locator('.now-playing-toast')).toContainText('Now playing');

	// And it clears itself rather than sitting on the visual.
	await expect(page.locator('.now-playing-toast')).toHaveCount(0, { timeout: 8000 });
});

test('c: the toast still appears while unobstructed, where the dock cannot', async ({ page }) => {
	await routeAudio(page);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/');
	await enterAmbient(page);
	await page.waitForTimeout(400);

	const replace = page.getByRole('button', { name: /^Replace ambient audio with/ });
	await replace.click();
	await expect(page.locator('.now-playing-toast')).toBeVisible();
	await page.waitForTimeout(4500);

	await page.getByRole('button', { name: 'Hide controls for an unobstructed view' }).click();
	await expect(page.locator('.sound-dock')).toHaveCount(0);

	// Nothing on screen reports playback now, which is the point of the toast.
	await page.evaluate(() => {
		const el = document.querySelector('[data-preview-player-audio]');
		if (el) el.dispatchEvent(new Event('ended'));
	});
	await expect(page.locator('.now-playing-toast')).toBeVisible({ timeout: 8000 });
});
