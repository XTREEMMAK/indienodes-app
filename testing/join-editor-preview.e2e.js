import { expect, test } from '@playwright/test';

/**
 * An uploaded image must actually render inside the editor's preview.
 *
 * The preview iframe is sandboxed without `allow-same-origin`, so it has an
 * opaque origin, and an opaque-origin document cannot fetch a blob URL minted
 * by the page that created it. The preview used to hand the template
 * `URL.createObjectURL(file)`, so every uploaded cover, page, artwork and
 * screenshot came back blank — and because the failure is a cross-origin
 * fetch refusal inside a sandboxed frame, nothing surfaced to the creator or
 * to the console they would think to open.
 *
 * Asserting the `src` is a `data:` URI would restate the implementation.
 * What matters is that the browser decoded it, so this checks `naturalWidth`,
 * which is 0 for an image that failed to load and non-zero only for one that
 * actually rendered under the real sandbox.
 */
const draft = {
	creator: 'Preview Artist',
	type: 'audio',
	form: 'music',
	why: 'A sufficiently detailed reason for joining this independent creator ring.',
	has_own_site: 'no',
	source_url: '',
	tags: ['experimental'],
	tracks: [],
	pages: [],
	excerpts: [''],
	thumb_url: '',
	thumb_position: { x: 50, y: 50 },
	preview_url: '',
	explicit: false
};

// 2x2 red PNG: big enough that a successful decode is unambiguous.
const COVER = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4mBgYGJAQoAFqIC/1De1AoAAAAASUVORK5CYII=',
	'base64'
);

test('an uploaded cover renders inside the sandboxed editor preview', async ({ page }) => {
	await page.addInitScript((entry) => {
		localStorage.setItem('indienode:submission-draft:v1', JSON.stringify(entry));
	}, draft);
	await page.goto('/join');

	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await expect(page.getByRole('heading', { name: 'Your entry' })).toBeVisible();
	await page
		.locator('#f-cover-file')
		.setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: COVER });
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await expect(page.getByRole('heading', { name: 'Your tracks' })).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await expect(page.getByRole('heading', { name: 'Build your page' })).toBeVisible();

	await page.getByRole('button', { name: 'Open the editor' }).click();
	const frame = page.frameLocator('iframe[title="Live preview of your page"]');
	const image = frame.locator('img').first();
	await expect(image).toBeAttached();

	// The load is asynchronous inside the frame, so poll rather than sampling
	// once: a 0 read immediately after attach would be indistinguishable from
	// the failure this test exists to catch.
	await expect
		.poll(async () => image.evaluate((img) => /** @type {HTMLImageElement} */ (img).naturalWidth), {
			timeout: 10_000,
			message: 'the uploaded cover never decoded inside the sandboxed preview frame'
		})
		.toBeGreaterThan(0);
});

test('the full widget shows as a still in the preview', async ({ page }) => {
	// Neither widget tier's real embed loads inside this preview frame: the
	// default (sandboxed iframe) would mean nesting a real cross-origin frame
	// inside this already-sandboxed one, and the advanced script tier's
	// module fetch needs a real origin the sandbox denies it either way. A
	// still stands in for both; the export still writes the real embed.
	await page.addInitScript((entry) => {
		localStorage.setItem('indienode:submission-draft:v1', JSON.stringify(entry));
	}, draft);
	await page.goto('/join');
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await expect(page.getByRole('heading', { name: 'Build your page' })).toBeVisible();
	await page.getByRole('button', { name: 'Open the editor' }).click();

	const frame = page.frameLocator('iframe[title="Live preview of your page"]');
	const still = frame.locator('.indienodes-widget-preview');
	await expect(still).toBeVisible();
	await expect(still).toContainText('IndieNodes');
	await expect(still).toContainText('Random');

	// Its logo has to have actually decoded, the same standard the uploaded
	// cover is held to above.
	await expect
		.poll(() =>
			still
				.locator('img')
				.first()
				.evaluate((img) => /** @type {HTMLImageElement} */ (img).naturalWidth)
		)
		.toBeGreaterThan(0);
});
