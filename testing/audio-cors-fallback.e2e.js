import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';

/**
 * A track from a host that refuses CORS has to stay audible after an earlier
 * track has wired the reactive background.
 *
 * Unit tests can only fake Web Audio. The failure this guards against lives in
 * the real thing: once `createMediaElementSource` claims an element, a resource
 * that element then loads without CORS is routed through a graph that outputs
 * zeros, and Chrome says so in the console ("MediaElementAudioSource outputs
 * zeroes due to CORS access restrictions"). That warning is the one observable
 * a headless browser gives for "the visitor hears nothing", so it is what this
 * asserts on. It was reported against real pages.kjnet.us tracks on
 * 2026-09-14.
 */

/** Half a second of a quiet 440 Hz tone, so each track ends and hands over. */
function toneWav() {
	const rate = 8000;
	const samples = rate / 2;
	const bytes = Buffer.alloc(44 + samples);
	bytes.write('RIFF', 0, 'ascii');
	bytes.writeUInt32LE(36 + samples, 4);
	bytes.write('WAVEfmt ', 8, 'ascii');
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(1, 20);
	bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(rate, 24);
	bytes.writeUInt32LE(rate, 28);
	bytes.writeUInt16LE(1, 32);
	bytes.writeUInt16LE(8, 34);
	bytes.write('data', 36, 'ascii');
	bytes.writeUInt32LE(samples, 40);
	for (let i = 0; i < samples; i++) {
		bytes[44 + i] = 128 + Math.round(20 * Math.sin((2 * Math.PI * 440 * i) / rate));
	}
	return bytes;
}

/**
 * A real, separate origin for the audio. Playwright's `route.fulfill` cannot
 * stand in for a refusing host: its fulfilled responses pass Chrome's CORS
 * check whatever headers they carry, so a "refused" track served that way
 * simply loads in CORS mode. Only a response from an actual server is checked.
 * @type {import('node:http').Server}
 */
let audioHost;
let audioOrigin = '';

test.beforeAll(async () => {
	const wav = toneWav();
	audioHost = createServer((req, res) => {
		res.writeHead(200, {
			'Content-Type': 'audio/wav',
			'Content-Length': wav.length,
			...(req.url?.startsWith('/allows/') ? { 'Access-Control-Allow-Origin': '*' } : {})
		});
		res.end(wav);
	});
	await new Promise((resolve) => audioHost.listen(0, '127.0.0.1', () => resolve(undefined)));
	const address = /** @type {import('node:net').AddressInfo} */ (audioHost.address());
	audioOrigin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
	await new Promise((resolve) => audioHost.close(() => resolve(undefined)));
});

test('a refused host still plays after a CORS track wired the background', async ({ page }) => {
	const zeroes = /** @type {string[]} */ ([]);
	page.on('console', (message) => {
		if (/outputs zeroes/i.test(message.text())) zeroes.push(message.text());
	});

	// Driftwood Radio's two fixture tracks live on example.invalid. Each is
	// redirected to the local audio host: one to a path that allows CORS, the
	// other to one that does not.
	await page.route('https://example.invalid/media/**', (route) => {
		const refuses = route.request().url().endsWith('/harbor-light.mp3');
		return route.fulfill({
			status: 302,
			headers: {
				Location: `${audioOrigin}/${refuses ? 'refuses' : 'allows'}/track.wav`,
				'Access-Control-Allow-Origin': '*'
			}
		});
	});

	await page.addInitScript(() => {
		localStorage.setItem(
			'indienode:favorites:v1',
			JSON.stringify(['example-audio-driftwood-radio'])
		);
		// With the default randomized playlist this yields Static Tide (allows
		// CORS) first, then Harbor Light (refuses), which is the order that
		// wires the graph before the refused track arrives.
		Math.random = () => 0;
	});

	await page.goto('/lists', { waitUntil: 'networkidle' });
	await page.getByRole('button', { name: 'Play Driftwood Radio (placeholder)' }).click();

	const main = page.locator('[data-main-player-audio]');
	const plain = page.locator('[data-main-player-audio-plain]');

	// The first track plays through the wired element.
	await expect
		.poll(() => main.evaluate((el) => /** @type {HTMLAudioElement} */ (el).currentSrc))
		.toContain('/static-tide.mp3');

	// It ends by itself and hands over to the refused host, which has to end up
	// on the unwired element and actually play there.
	await expect
		.poll(() => plain.evaluate((el) => /** @type {HTMLAudioElement} */ (el).currentSrc), {
			timeout: 15_000
		})
		.toContain('/harbor-light.mp3');
	await expect
		.poll(() => plain.evaluate((el) => /** @type {HTMLAudioElement} */ (el).currentTime), {
			timeout: 15_000
		})
		.toBeGreaterThan(0);

	expect(zeroes).toEqual([]);
});
