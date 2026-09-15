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
	await expect(page.getByRole('heading', { name: 'In this session' })).toBeVisible();
	await expect(page.locator('.playlist-section li')).not.toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Up first' })).toHaveCount(0);
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

test('c: ambient plays through the real queue and appends as it goes', async ({ page }) => {
	await routeAudio(page);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/');
	await enterAmbient(page);

	// Play queues ambient's pick into the regular player's queue.
	await page.getByRole('button', { name: 'Play ambient audio' }).click();
	await expect(page.getByRole('button', { name: 'Pause ambient audio' })).toBeVisible();
	const firstTrack = (await page.locator('.sound-meta strong').textContent())?.trim() ?? '';

	// Taking the discovery card's suggestion appends it and jumps to it,
	// rather than replacing what was there. Waited to a single match first: a
	// candidate swap keeps the outgoing card around for its own exit
	// transition, so right after the swap both a leaving and an entering card
	// can briefly share the same role and name.
	const replaceBtn = page.getByRole('button', { name: /^Replace ambient audio with/ });
	await expect.poll(() => replaceBtn.count()).toBe(1);
	await replaceBtn.click();
	await expect(page.locator('.sound-meta strong')).not.toHaveText(firstTrack);

	await page.getByRole('button', { name: /Open current playlist/ }).click();
	const rows = page.locator('.playlist-section li');
	await expect.poll(() => rows.count()).toBeGreaterThan(1);
	// Whichever track was chosen remains in focus when the sheet opens.
	await expect(page.locator('.playlist-section [aria-current="true"]')).toBeInViewport();
	await expect(rows.filter({ hasText: firstTrack }).locator('.track-row')).toHaveClass(/played/);
	await page.getByRole('button', { name: 'Close playlist sheet' }).click();

	// Skipping past the end deals another node onto the end.
	const before = await rows.count();
	await page.getByRole('button', { name: /Open current playlist/ }).click();
	await page.locator(`[data-queue-index="${before - 1}"] .track-row`).click();
	await page.getByRole('button', { name: 'Close playlist sheet' }).click();
	await page.getByRole('button', { name: 'Next audio track' }).click();
	await page.getByRole('button', { name: /Open current playlist/ }).click();
	await expect.poll(() => page.locator('.playlist-section li').count()).toBeGreaterThan(before);
	// This fixture can add the same release twice. The per-addition batch key
	// still places that newer copy at the top without reversing its tracks.
	await expect(rows.first()).toHaveAttribute('data-queue-index', String(before));
	await expect(page.locator('.playlist-section [aria-current="true"]')).toBeInViewport();

	// Pause the short synthetic tone before counting removals, otherwise its
	// real ended event can append another batch while this assertion runs.
	await page.getByRole('button', { name: 'Close playlist sheet' }).click();
	await page.getByRole('button', { name: 'Pause ambient audio' }).click();
	await page.getByRole('button', { name: /Open current playlist/ }).click();

	// Every row has an explicit delete affordance. A left swipe over a row is
	// the touch shortcut for the same removal action.
	const afterAppend = await rows.count();
	await rows
		.last()
		.getByRole('button', { name: /Remove .* from playlist/ })
		.click();
	await expect(rows).toHaveCount(afterAppend - 1);
	const swipeRow = rows.last();
	// The sheet itself re-plays its own 240ms slide-in transition every time
	// it reopens (`transition:slide` in AmbientPlaylistSheet.svelte), and
	// `boundingBox()` has no actionability wait the way `click()` does -- it
	// happily measures a row mid-slide. `hover()` performs the same
	// stability check `click()` does, without side effects, so the box below
	// is read after the row has actually stopped moving.
	await swipeRow.hover();
	const swipeBox = await swipeRow.boundingBox();
	expect(swipeBox).not.toBeNull();
	await page.mouse.move(swipeBox.x + swipeBox.width - 8, swipeBox.y + swipeBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(swipeBox.x + 8, swipeBox.y + swipeBox.height / 2, { steps: 8 });
	await page.mouse.up();
	await expect(rows).toHaveCount(afterAppend - 2);
	await page.getByRole('button', { name: 'Close playlist sheet' }).click();
	await page.getByRole('button', { name: 'Play ambient audio' }).click();

	// Leaving ambient keeps the queue playing in the regular player.
	await page.getByRole('button', { name: 'Ambient options' }).click();
	await page.getByRole('button', { name: 'Exit ambient view' }).click();
	await expect(page.getByRole('region', { name: 'Ambient view' })).toHaveCount(0);
	await expect
		.poll(() =>
			page.evaluate(() =>
				[
					...document.querySelectorAll('[data-main-player-audio], [data-main-player-audio-plain]')
				].some((el) => !(/** @type {HTMLAudioElement} */ (el).paused))
			)
		)
		.toBe(true);
});

test('c: the toast still appears while unobstructed, where the dock cannot', async ({ page }) => {
	await routeAudio(page);
	// Fixed track order: the fixture's only audio entry carries two tracks,
	// and the visitor's own shuffle preference (on by default) reorders them
	// on every deal. Left random, the queue-run-out below has a genuine
	// coin-flip chance of re-dealing the same label that is already showing
	// -- correctly not a new announcement, since nothing audible changed --
	// which made this assertion flaky for a reason that had nothing to do
	// with what it is testing (a track change with the dock hidden).
	await page.addInitScript(() =>
		localStorage.setItem(
			'indienode:preferences:v1',
			JSON.stringify({ randomizeAudioTracks: false })
		)
	);
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

	// Only the active element's `ended` counts; dispatching on both covers
	// whichever one the track loaded into.
	await page.evaluate(() => {
		for (const el of document.querySelectorAll(
			'[data-main-player-audio], [data-main-player-audio-plain]'
		)) {
			el.dispatchEvent(new Event('ended'));
		}
	});
	await expect(page.locator('.now-playing-toast')).toBeVisible({ timeout: 8000 });
});

test('mobile unobstructed mode lowers metadata and controls animate it back up', async ({
	page
}) => {
	await routeAudio(page);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await page.getByRole('button', { name: 'Ambient', exact: true }).click();
	await page.getByRole('button', { name: 'Enter ambient view' }).click();
	await expect(page.getByRole('region', { name: 'Ambient view' })).toBeVisible();
	await page.getByRole('button', { name: 'Hide audio discovery card' }).click();

	const creator = page.locator('.visual-canvas .creator-name');
	await expect(creator).toBeVisible();
	const shown = await creator.boundingBox();
	expect(shown).not.toBeNull();

	await page.getByRole('button', { name: 'Hide controls for an unobstructed view' }).click();
	await expect(page.locator('.immersive-hint')).toHaveCSS('text-align', 'center');
	await page.waitForTimeout(260);
	const unobstructed = await creator.boundingBox();
	expect(unobstructed).not.toBeNull();
	expect(unobstructed.y).toBeGreaterThan(shown.y + 40);

	await page.locator('.visual-canvas').dispatchEvent('click');
	await page.waitForTimeout(260);
	const restored = await creator.boundingBox();
	expect(restored).not.toBeNull();
	expect(restored.y).toBeLessThan(unobstructed.y - 40);
});

test('e: swiping the visual moves to the next one and back', async ({ page }) => {
	await routeAudio(page);
	// Slowest rotation, so the only thing that changes the visual is the swipe.
	await page.addInitScript(() =>
		localStorage.setItem(
			'indienode:preferences:v1',
			JSON.stringify({
				rotationMs: { audio: 60000, game: 60000, art: 60000, any: 60000, text: 60000, comic: 60000 }
			})
		)
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await page.getByRole('button', { name: 'Ambient', exact: true }).click();
	await page.getByRole('button', { name: 'Enter ambient view' }).click();
	await expect(page.getByRole('region', { name: 'Ambient view' })).toBeVisible();
	// Out of the way: the discovery card floats over the upper half of the
	// visual on a phone (see ambient.e2e.js's own layout assertions for its
	// footprint), which would otherwise eat a swipe started there as a tap on
	// the card instead of the canvas.
	await page.getByRole('button', { name: 'Hide audio discovery card' }).click();

	const shown = () =>
		page
			.locator('.visual-canvas .node')
			.evaluate(
				(node) =>
					`${node.getAttribute('data-type')}|${node.querySelector('.creator-name')?.textContent}`
			);
	/** @param {number} fromX @param {number} toX */
	async function swipe(fromX, toX) {
		await page.mouse.move(fromX, 200);
		await page.mouse.down();
		await page.mouse.move(toX, 210, { steps: 8 });
		await page.mouse.up();
	}

	const first = await shown();
	await swipe(300, 90);
	await expect.poll(shown).not.toBe(first);
	// A swipe is not a tap: the action panel stays closed.
	await expect(page.getByText('Visual rotation paused')).toHaveCount(0);

	await swipe(90, 300);
	await expect.poll(shown).toBe(first);

	// A swipe that starts at the screen edge is the system's, not ours.
	await swipe(8, 250);
	await page.waitForTimeout(300);
	expect(await shown()).toBe(first);
});

test('e: the tap panel offers next audio beside next visual', async ({ page }) => {
	await routeAudio(page);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/');
	await enterAmbient(page);

	await page.getByRole('button', { name: 'Play ambient audio' }).click();
	const firstTrack = (await page.locator('.sound-meta strong').textContent())?.trim() ?? '';
	await page.locator('.visual-canvas').dispatchEvent('click');
	const panel = page.locator('.interaction-panel');
	await expect(panel.getByRole('button', { name: 'Next visual' })).toBeVisible();
	await panel.getByRole('button', { name: 'Next audio' }).click();
	await expect(page.locator('.sound-meta strong')).not.toHaveText(firstTrack);
});

test('f: the playlist delete button stays on screen at phone width', async ({ page }) => {
	await routeAudio(page);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await page.getByRole('button', { name: 'Ambient', exact: true }).click();
	await page.getByRole('button', { name: 'Enter ambient view' }).click();
	await expect(page.getByRole('region', { name: 'Ambient view' })).toBeVisible();
	await page.getByRole('button', { name: 'Hide audio discovery card' }).click();
	await page.getByRole('button', { name: 'Play ambient audio' }).click();
	await page.getByRole('button', { name: /Open current playlist/ }).click();

	// A long creator/label pair, at nowrap, used to refuse to shrink and push
	// the delete button off the right edge of the sheet -- reachable by a
	// mouse click (which can act on an off-screen element) but not by a real
	// finger on a real phone. `toBeInViewport` is the check that catches it;
	// `toBeVisible` alone does not, since the element is still attached,
	// unhidden, and has a non-zero size.
	const removeButtons = page.getByRole('button', { name: /^Remove .* from playlist$/ });
	await expect(removeButtons.first()).toBeInViewport();
	await removeButtons.first().click();
});
