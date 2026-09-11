import { expect, test } from '@playwright/test';

/**
 * Typed fields reach the preview when you are done with them, not while you
 * are still typing.
 *
 * These used to commit on a short idle, the same signal a colour drag uses.
 * An idle is the wrong signal for typing: it fires in the pauses *within*
 * writing, so a full template render into the preview iframe lands in the
 * gaps between words and the field stutters under the person using it. The
 * bio commits when its dialog closes; the other text inputs commit on blur.
 *
 * Colours and ranges deliberately keep the idle — a drag has no meaningful
 * blur until it is over, and watching the colour move is the point.
 */
const draft = {
	creator: 'Bio Artist',
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

/** Long enough to be unambiguous, and nothing else on the page says it. */
const BIO = 'Zqxjvbn writes about slow software';
const NAME = 'Wqzptl Studio';

/** Comfortably past the 250ms idle the other controls still use. */
const PAST_THE_OLD_IDLE = 1200;

async function openEditor(page) {
	await page.addInitScript((entry) => {
		localStorage.setItem('indienode:submission-draft:v1', JSON.stringify(entry));
	}, draft);
	await page.goto('/join');
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await expect(page.getByRole('heading', { name: 'Your entry' })).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await expect(page.getByRole('heading', { name: 'Your tracks' })).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await expect(page.getByRole('heading', { name: 'Build your page' })).toBeVisible();
	await page.getByRole('button', { name: 'Open the editor' }).click();
	return page.frameLocator('iframe[title="Live preview of your page"]');
}

test('the bio reaches the preview on Done, not while typing', async ({ page }) => {
	const frame = await openEditor(page);
	await expect(frame.locator('body')).toBeAttached();

	// By id: the FormField renders a <label for="f-bio">, which takes over the
	// button's accessible name, so a role+name lookup does not find it.
	await page.locator('button#f-bio').click();
	const editor = page.locator('.bio-editor [contenteditable="true"]').first();
	await editor.click();
	await editor.pressSequentially(BIO, { delay: 5 });

	await page.waitForTimeout(PAST_THE_OLD_IDLE);
	await expect(frame.locator('body')).not.toContainText(BIO);

	await page.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(frame.locator('body')).toContainText(BIO);
});

test('the display name reaches the preview on blur, not while typing', async ({ page }) => {
	const frame = await openEditor(page);
	const field = page.locator('#f-display-name');
	await field.click();
	await field.fill(NAME);

	await page.waitForTimeout(PAST_THE_OLD_IDLE);
	await expect(frame.locator('body')).not.toContainText(NAME);

	await field.blur();
	await expect(frame.locator('body')).toContainText(NAME);
});
