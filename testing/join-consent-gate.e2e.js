import { expect, test } from '@playwright/test';

/**
 * The Consent step's gate.
 *
 * Continue (and later Submit) needs the general EULA and every content-rule
 * attestation: made by people, rights, and an answer to the adult-content
 * question, plus its confirmation after a "Yes". Rights apply to everyone;
 * they used to appear only alongside a stated PRO relationship.
 *
 * Also pins an older bug: the "Terms of Use" and "Privacy Notice" links both
 * pointed at the bare `/terms` URL.
 */
test('consent step requires the EULA and every content-rule attestation before Continue', async ({
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
	const eula = page.getByRole('checkbox', { name: /By submitting, you affirm/ });
	const madeByPeople = page.getByRole('checkbox', { name: /were made by people/ });
	const rights = page.getByRole('checkbox', { name: /I hold the rights to the works/ });
	const adultYes = page.getByRole('radio', { name: 'Yes', exact: true });
	const adultNo = page.getByRole('radio', { name: 'No', exact: true });
	const adultConfirm = page.getByRole('checkbox', { name: /behind a clear content warning/ });
	const stillNeeded = page.locator('.still-needed');

	await page.locator('#f-email').fill('consent-test@example.com');
	await page.locator('#f-pro').selectOption('Not a member');

	// Nothing answered yet: every attestation is listed, and neither adult
	// answer is chosen for the visitor.
	await expect(adultYes).not.toBeChecked();
	await expect(adultNo).not.toBeChecked();
	await expect(adultConfirm).toHaveCount(0);
	await expect(stillNeeded).toContainText(
		'Please confirm your featured works were made by people.'
	);
	await expect(stillNeeded).toContainText(
		'Please confirm you hold the rights to the works you are featuring.'
	);
	await expect(stillNeeded).toContainText(
		'Please say whether your website includes adult content.'
	);

	// The EULA alone is no longer enough, and neither is anything short of all.
	await eula.check();
	await expect(continueBtn).toBeDisabled();
	await madeByPeople.check();
	await expect(continueBtn).toBeDisabled();
	await rights.check();
	await expect(continueBtn).toBeDisabled();

	// "Yes" brings its own required confirmation.
	await adultYes.check();
	await expect(adultConfirm).toBeVisible();
	await expect(stillNeeded).toContainText(
		'Please confirm your adult content sits behind a content warning.'
	);
	await expect(continueBtn).toBeDisabled();
	await adultConfirm.check();
	await expect(continueBtn).toBeEnabled();
	await expect(stillNeeded).toHaveCount(0);

	// Back to "No": the confirmation is hidden and cleared, and "No" is a
	// complete answer on its own.
	await adultNo.check();
	await expect(adultConfirm).toHaveCount(0);
	await expect(continueBtn).toBeEnabled();
	await adultYes.check();
	await expect(adultConfirm).not.toBeChecked();
	await expect(continueBtn).toBeDisabled();
	await adultNo.check();

	// Each piece still gates on its own.
	await rights.uncheck();
	await expect(continueBtn).toBeDisabled();
	await rights.check();
	await eula.uncheck();
	await expect(continueBtn).toBeDisabled();
	await eula.check();
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
