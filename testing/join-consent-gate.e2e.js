import { expect, test } from '@playwright/test';

/**
 * Two bugs on the Consent step, found by manual testing:
 *
 * 1. The step's own Continue button didn't require the General EULA
 *    checkbox at all -- only the final "Submit my entry" button did, so a
 *    submitter could click through to Review with nothing agreed and land
 *    there with no visible explanation why Submit stayed disabled.
 * 2. The "Terms of Use" and "Privacy Notice" links both pointed at the same
 *    bare `/terms` URL -- a real link existed, but "Privacy Notice" never
 *    actually reached the privacy section of that combined document.
 *
 * Also covers the newer, deliberate rule that grew out of fixing (1): the
 * Rights section (and its checkbox's contribution to the gate) only applies
 * when the submitter has stated an actual PRO relationship -- "Not a
 * member" has nothing there to disclose, and the general EULA already
 * covers the blanket rights affirmation for everyone.
 */
test('consent step requires the general EULA before Continue, and Rights only applies to a stated PRO member', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name !== 'join-mock-dev');

	await page.addInitScript(() => localStorage.clear());
	await page.setViewportSize({ width: 1280, height: 1200 });
	await page.goto('/join?mock=success', { waitUntil: 'networkidle' });

	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await page.getByRole('radio', { name: /Yes, I have a site/ }).check();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await page.locator('#f-creator').fill('Consent Gate Test');
	await page.locator('#f-type').selectOption('text');
	await page.locator('#f-why').fill('Testing the consent step gating.');
	await page.locator('#f-source').fill('https://example.com');
	await page.locator('#f-tags').fill('test');
	await page.locator('#f-tags').press('Enter');
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await expect(page.getByRole('heading', { name: 'Your text samples' })).toBeVisible();
	const editor = page.locator('[contenteditable="true"]').first();
	await editor.click();
	await editor.type('A short sample excerpt for testing purposes here.');
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await page.getByRole('button', { name: 'Generate my token' }).click();
	await page.getByRole('button', { name: 'Verify', exact: true }).click();
	await expect(page.getByText('Verified. That page is yours.')).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await expect(page.getByRole('heading', { name: 'Rights and contact' })).toBeVisible();
	const continueBtn = page.getByRole('button', { name: 'Continue', exact: true }).last();

	await page.locator('#f-email').fill('consent-test@example.com');
	await page.locator('#f-pro').selectOption('Not a member');

	// "Not a member" leaves nothing for the Rights section to disclose, so
	// it must not even render, and Continue must still be blocked on EULA.
	await expect(page.getByRole('heading', { name: 'Rights', exact: true })).toHaveCount(0);
	await expect(continueBtn).toBeDisabled();

	await page.getByRole('checkbox', { name: /By submitting, you affirm/ }).check();
	await expect(continueBtn).toBeEnabled();
	await page.getByRole('checkbox', { name: /By submitting, you affirm/ }).uncheck();
	await expect(continueBtn).toBeDisabled();

	// Naming an actual PRO brings the Rights section back, and it now joins
	// the gate: EULA alone is no longer enough.
	await page.locator('#f-pro').selectOption('BMI');
	await expect(page.getByRole('heading', { name: 'Rights', exact: true })).toBeVisible();
	await page.getByRole('checkbox', { name: /By submitting, you affirm/ }).check();
	await expect(continueBtn).toBeDisabled();
	await page.getByRole('checkbox', { name: /I confirm that I hold full rights/ }).check();
	await expect(continueBtn).toBeEnabled();

	const links = await page
		.locator('.consent-text a')
		.evaluateAll((els) =>
			els.map((el) => ({ text: el.textContent?.trim(), href: el.getAttribute('href') }))
		);
	expect(links).toContainEqual({ text: 'Terms of Use', href: '/terms#terms-of-use' });
	expect(links).toContainEqual({ text: 'Privacy Notice', href: '/terms#privacy-notice' });
});
