import { expect, test } from '@playwright/test';

/**
 * The two places the content rules are answered.
 *
 * The adult-content disclosure is asked on the entry step, beside the
 * `explicit` checkbox it is easily confused with, and blocks Continue there.
 * The consent step asks the rest: made by people, and one Rights and EULA
 * checkbox (the rights statement is folded into it rather than repeated a
 * line above).
 *
 * Also pins an older bug: the "Terms of Use" and "Privacy Notice" links both
 * pointed at the bare `/terms` URL.
 */
test('the entry step blocks on the adult-content disclosure, and the consent step on the rest', async ({
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

	// The disclosure is asked here, next to the explicit checkbox, and holds
	// this step until it is answered.
	const entryContinue = page.getByRole('button', { name: 'Continue', exact: true }).last();
	const adultYes = page.getByRole('radio', { name: 'Yes', exact: true });
	const adultNo = page.getByRole('radio', { name: 'No', exact: true });
	const adultConfirm = page.getByRole('checkbox', { name: /behind a clear content warning/ });
	await expect(
		page.getByRole('checkbox', { name: /This Node features adult content/ })
	).toBeVisible();
	await expect(adultYes).not.toBeChecked();
	await expect(adultNo).not.toBeChecked();
	await expect(adultConfirm).toHaveCount(0);
	await expect(entryContinue).toBeDisabled();

	await adultYes.check();
	await expect(adultConfirm).toBeVisible();
	await expect(entryContinue, 'a "yes" needs its confirmation').toBeDisabled();
	await adultConfirm.check();
	await expect(entryContinue).toBeEnabled();

	// Back to "no": the confirmation is gone and cleared, and "no" is complete.
	await adultNo.check();
	await expect(adultConfirm).toHaveCount(0);
	await expect(entryContinue).toBeEnabled();
	await adultYes.check();
	await expect(adultConfirm).not.toBeChecked();
	await expect(entryContinue).toBeDisabled();
	await adultNo.check();

	await entryContinue.click();

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
	const rightsAndEula = page.getByRole('checkbox', { name: /I hold the rights to the works/ });
	const madeByPeople = page.getByRole('checkbox', { name: /were made by people/ });
	const stillNeeded = page.locator('.still-needed');

	await page.locator('#f-email').fill('consent-test@example.com');

	// The disclosure is not asked again here.
	await expect(page.getByRole('radio', { name: 'Yes', exact: true })).toHaveCount(0);
	// Rights are stated once, inside the one checkbox that also carries the EULA.
	await expect(rightsAndEula).toHaveAccessibleName(/donation-only basis/);
	await expect(page.getByRole('checkbox', { name: /By submitting, you affirm/ })).toHaveCount(0);

	await expect(stillNeeded).toContainText(
		'Please confirm your featured works were made by people.'
	);
	await expect(continueBtn).toBeDisabled();

	// Each of the two still gates on its own.
	await madeByPeople.check();
	await expect(stillNeeded).toHaveCount(0);
	await expect(continueBtn).toBeDisabled();
	await rightsAndEula.check();
	await expect(continueBtn).toBeEnabled();
	await madeByPeople.uncheck();
	await expect(continueBtn).toBeDisabled();
	await madeByPeople.check();
	await rightsAndEula.uncheck();
	await expect(continueBtn).toBeDisabled();
	await rightsAndEula.check();
	await expect(continueBtn).toBeEnabled();

	const links = await page
		.locator('.consent-text a')
		.evaluateAll((els) =>
			els.map((el) => ({ text: el.textContent?.trim(), href: el.getAttribute('href') }))
		);
	expect(links).toContainEqual({ text: 'Terms of Use', href: '/terms#terms-of-use' });
	expect(links).toContainEqual({ text: 'Privacy Notice', href: '/terms#privacy-notice' });
});

test('the content rules link to the update route', async ({ page }) => {
	await page.goto('/join', { waitUntil: 'networkidle' });
	const link = page.locator('.rules-list a', { hasText: 'submit an update request' });
	await expect(link).toHaveAttribute('href', '/update');
	await expect(page.locator('.rules-list')).toContainText(
		'You can also remove your Node from the network at any time.'
	);
});
