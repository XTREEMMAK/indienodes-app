import { expect, test } from '@playwright/test';

const draft = {
	creator: 'Test Artist',
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

test('the editor holds settings and preview together, and covers the page chrome', async ({
	page
}) => {
	await page.addInitScript((entry) => {
		localStorage.setItem('indienode:submission-draft:v1', JSON.stringify(entry));
	}, draft);
	await page.goto('/join');

	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Do you have a site?' })).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await expect(page.getByRole('heading', { name: 'Your entry' })).toBeVisible();
	await expect(page.locator('#f-type option[value="audio"]')).toHaveText('Audio');
	await expect(page.locator('#f-cover-file')).toBeVisible();
	await page.locator('#f-cover-file').setInputFiles({
		name: 'cover.png',
		mimeType: 'image/png',
		buffer: Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrL8AAAAASUVORK5CYII=',
			'base64'
		)
	});
	await expect(page.locator('.node-preview-card img.backdrop')).toHaveAttribute('src', /^blob:/);
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await expect(page.getByRole('heading', { name: 'Your tracks' })).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await expect(page.locator('#f-icon')).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Build your page' })).toBeVisible();

	// Nothing to configure until the editor is open: the step offers the way
	// in, and every setting lives beside the preview it changes.
	await expect(page.locator('#f-template')).toHaveCount(0);
	await page.getByRole('button', { name: 'Open the editor' }).click();

	const settings = page.locator('.editor-settings');
	const frame = page.locator('iframe.preview-frame-large');
	await expect(settings).toBeVisible();
	await expect(frame).toBeVisible();
	// The picker is in the sidebar, so choosing a look and seeing the result
	// are the same view rather than two.
	await expect(page.locator('.editor-settings #f-template')).toHaveCount(1);

	const initialPreview = await frame.getAttribute('srcdoc');
	await page.locator('#f-template').selectOption('midnight-echo');
	await expect(page.locator('#f-template')).toHaveValue('midnight-echo');
	await expect.poll(() => frame.getAttribute('srcdoc')).not.toBe(initialPreview);
	// The form does not go anywhere when the template changes.
	await expect(settings).toBeVisible();

	// Collapsing hands the whole dialog to the preview, and takes the hidden
	// fields out of the tab order rather than leaving them focusable at zero
	// width.
	const wideBefore = (await frame.boundingBox())?.width ?? 0;
	await page.getByRole('button', { name: 'Hide settings' }).click();
	await expect(page.getByRole('button', { name: 'Show settings' })).toBeVisible();
	await expect(page.locator('.editor-settings')).toHaveAttribute('inert', '');
	await expect
		.poll(async () => (await frame.boundingBox())?.width ?? 0)
		.toBeGreaterThan(wideBefore);

	// The dialog covers the floating page chrome. The brand mark and the menu
	// trigger are both `position: fixed` and outlive a route change, and the
	// trigger in particular sits above the nav drawer, which used to put it
	// above this dialog too.
	for (const selector of ['.brand-float', '.menu-trigger']) {
		const covered = await page.locator(selector).evaluate((element) => {
			const box = element.getBoundingClientRect();
			const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
			return Boolean(hit) && !element.contains(hit) && hit !== element;
		});
		expect(covered, `${selector} should be behind the editor dialog`).toBe(true);
	}
});
