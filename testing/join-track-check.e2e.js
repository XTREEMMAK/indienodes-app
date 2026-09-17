import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { answerAdultContent } from './helpers.js';

/**
 * "Check this track" on the /join media step has to give the same answer the
 * player would: whether the browser will load the file in CORS mode from this
 * site's origin. That is only meaningful against a real server, since
 * Playwright's fulfilled responses pass CORS whatever their headers (see
 * audio-cors-fallback.e2e.js), so the tracks redirect to one.
 */

/** A tenth of a second of silence. */
function silentWav() {
	const samples = 800;
	const bytes = Buffer.alloc(44 + samples, 128);
	bytes.write('RIFF', 0, 'ascii');
	bytes.writeUInt32LE(36 + samples, 4);
	bytes.write('WAVEfmt ', 8, 'ascii');
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(1, 20);
	bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(8000, 24);
	bytes.writeUInt32LE(8000, 28);
	bytes.writeUInt16LE(1, 32);
	bytes.writeUInt16LE(8, 34);
	bytes.write('data', 36, 'ascii');
	bytes.writeUInt32LE(samples, 40);
	return bytes;
}

/** @type {import('node:http').Server} */
let audioHost;
let audioOrigin = '';

test.beforeAll(async () => {
	const wav = silentWav();
	audioHost = createServer((req, res) => {
		if (req.url?.startsWith('/missing/')) {
			res.writeHead(404, { 'Content-Type': 'text/html' }).end('<p>Not found</p>');
			return;
		}
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

test('Check this track reports whether a host allows the reactive background', async ({ page }) => {
	const errors = /** @type {string[]} */ ([]);
	page.on('pageerror', (e) => errors.push(String(e)));

	// The form only takes https:// links, so each fake host redirects to the
	// matching path on the local audio host.
	await page.route('https://*.track-check.example/**', (route) => {
		const host = new URL(route.request().url()).hostname.split('.')[0];
		return route.fulfill({
			status: 302,
			headers: {
				Location: `${audioOrigin}/${host}/track.wav`,
				'Access-Control-Allow-Origin': '*'
			}
		});
	});

	await page.setViewportSize({ width: 1280, height: 900 });
	await page.addInitScript(() => localStorage.clear());
	await page.goto('/join');

	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await page.getByRole('radio', { name: /Yes, I have a site/ }).check();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await expect(page.getByRole('heading', { name: 'Your entry' })).toBeVisible();
	await page.locator('#f-creator').fill('Driftwood Radio');
	await page.locator('#f-type').selectOption('audio');
	await page.locator('#f-why').fill('Warm tape loops for late evenings.');
	await page.locator('#f-source').fill('https://example.com');
	await page.locator('#f-tags').fill('ambient');
	await page.locator('#f-tags').press('Enter');
	await page.locator('#f-form').selectOption('music');
	await answerAdultContent(page);
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await expect(page.getByRole('heading', { name: 'Your tracks' })).toBeVisible();

	const rows = page.locator('.repeat-row');
	if ((await rows.count()) === 0) {
		await page
			.getByRole('button', { name: /Add (a )?track/i })
			.first()
			.click();
	}
	const row = rows.first();
	const url = row.getByLabel('Direct link to the file');
	const check = row.getByRole('button', { name: /Check whether track 1 plays here/ });
	const result = row.getByRole('status');

	await expect(check).toBeDisabled();

	await url.fill('https://allows.track-check.example/track.wav');
	await check.click();
	await expect(result).toHaveText(
		/Ready\. This track plays here and drives the reactive background/
	);
	await expect(result).toHaveAttribute('data-tone', 'ok');

	// Editing the link hides the verdict rather than leaving it beside a link
	// nobody has checked.
	await url.fill('https://refuses.track-check.example/track.wav');
	await expect(result).toHaveText('');

	await check.click();
	await expect(result).toHaveText(/won't drive the reactive background/, { timeout: 20_000 });
	await expect(result).toHaveAttribute('data-tone', 'warn');

	await url.fill('https://missing.track-check.example/track.wav');
	await check.click();
	await expect(result).toHaveText(/couldn't be loaded as audio/, { timeout: 20_000 });

	// The self-hosting setups are one click from the verdict that needs them.
	await page.getByText('Musicians: what makes a track actually playable here').click();
	await page.getByText('Hosting on your own site? Add the header').click();
	await expect(page.getByRole('heading', { name: 'nginx', exact: true })).toBeVisible();
	await expect(
		page.locator('pre').filter({ hasText: 'add_header Access-Control-Allow-Origin' })
	).toContainText('root');

	expect(errors).toEqual([]);
});
