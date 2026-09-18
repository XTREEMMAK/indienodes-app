import { expect, test } from '@playwright/test';

/**
 * What /join and /update actually send for the content-rule attestations.
 *
 * Runs against the production build, whose submission webhook points at an
 * unregistered path (see playwright.config.js). Every call to it is answered
 * here instead, so the real client code runs end to end and each request body
 * can be inspected. Nothing leaves the machine.
 *
 * The server enforces the same rules (CONTENT_ATTESTATIONS_REQUIRED in
 * scripts/n8n/build_workflows.py, tested in test_code_nodes.mjs); this pins
 * that the client sends them, including on an update, so a change request
 * cannot bypass them.
 */

const WEBHOOK = 'https://n8n.kjnet.us/webhook/**';

/** @param {import('@playwright/test').Page} page */
async function answerWebhook(page) {
	/** @type {Record<string, any>[]} */
	const sent = [];
	const cors = {
		'access-control-allow-origin': '*',
		'access-control-allow-headers': 'content-type',
		'access-control-allow-methods': 'POST, OPTIONS'
	};
	await page.route(WEBHOOK, async (route) => {
		const request = route.request();
		if (request.method() === 'OPTIONS') {
			return route.fulfill({ status: 204, headers: cors });
		}
		const body = request.postDataJSON() ?? {};
		sent.push(body);
		const expires = new Date(Date.now() + 86_400_000).toISOString();
		/** @type {Record<string, any>} */
		const answers = {
			issue_token: { submission_id: 'sub-e2e', verification_token: 'tok-e2e', expires_at: expires },
			request_update_token: {
				submission_id: 'sub-e2e',
				verification_token: 'tok-e2e',
				expires_at: expires
			},
			verify: { verified: true, reason: 'matched' },
			check_media_url: { accepted: true, verdict: 'ok' },
			rate_status: { blocked: false, retry_after_seconds: null },
			submit: { reference: 'ref-join' },
			submit_update: { reference: 'ref-update' }
		};
		return route.fulfill({
			status: 200,
			headers: cors,
			contentType: 'application/json',
			body: JSON.stringify({ ok: true, ...(answers[body.action] ?? {}) })
		});
	});
	return sent;
}

/**
 * @param {Record<string, any>[]} sent
 * @param {string} action
 */
const lastOf = (sent, action) => sent.filter((body) => body.action === action).at(-1);

/**
 * The site-level disclosure, asked beside the explicit checkbox on /join's
 * entry step and /update's edit step.
 * @param {import('@playwright/test').Page} page
 */
async function discloseAdultContent(page, answer = 'yes') {
	if (answer === 'yes') {
		await page.getByRole('radio', { name: 'Yes', exact: true }).check();
		await page.getByRole('checkbox', { name: /behind a clear content warning/ }).check();
	} else {
		await page.getByRole('radio', { name: 'No', exact: true }).check();
	}
}

test('a new submission sends every attestation in its review block', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'production');
	const sent = await answerWebhook(page);

	await page.addInitScript(() => localStorage.clear());
	await page.setViewportSize({ width: 1280, height: 1100 });
	await page.goto('/join', { waitUntil: 'networkidle' });

	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await page.getByRole('radio', { name: /Yes, I have a site/ }).check();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await page.locator('#f-creator').fill('Attestation Payload Test');
	await page.locator('#f-type').selectOption('audio');
	await page.locator('#f-form').selectOption('music');
	await page.locator('#f-why').fill('Checks what the join form sends for the content rules.');
	await page.locator('#f-source').fill('https://example.com');
	await page.locator('#f-tags').fill('test');
	await page.locator('#f-tags').press('Enter');
	await discloseAdultContent(page, 'yes');
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await page.getByRole('button', { name: 'Generate my token' }).click();
	await page.getByRole('button', { name: 'Verify', exact: true }).click();
	await expect(page.getByText('Verified. That page is yours.')).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await page.locator('#f-email').fill('payload@example.com');
	const rightsAndEula = page.getByRole('checkbox', { name: /I hold the rights to the works/ });
	await page.getByRole('checkbox', { name: /were made by people/ }).check();
	await rightsAndEula.check();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await page.getByRole('button', { name: 'Submit my entry' }).click();
	await expect(page.getByRole('heading', { name: 'Request Submitted!' })).toBeVisible();

	const submit = lastOf(sent, 'submit');
	expect(submit?.review).toMatchObject({
		email: 'payload@example.com',
		eula_agreement: true,
		rights_confirmation: true,
		ai_attestation: true,
		adult_content: 'yes',
		adult_content_confirmation: true
	});
	// Review data only: nothing about the disclosure reaches the public entry.
	expect(JSON.stringify(submit?.entry)).not.toContain('adult_content');
});

test('a change request sends the attestations too, and cannot be sent without them', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name !== 'production');
	const sent = await answerWebhook(page);

	await page.addInitScript(() => localStorage.clear());
	await page.setViewportSize({ width: 1280, height: 1100 });
	await page.goto('/update', { waitUntil: 'networkidle' });

	await page.locator('#f-node-id').fill('audio-ashzone-xeno');
	await expect(page.getByText('Found it:')).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).click();

	await page.getByRole('button', { name: 'Generate my token' }).click();
	await page.getByRole('button', { name: 'Verify', exact: true }).click();
	await expect(page.getByText('Verified. That page is yours.')).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await expect(page.getByRole('heading', { name: "What's changing?" })).toBeVisible();
	// The seeded fixture entry predates the 75-character cap on `why`, so the
	// edit step asks for a shorter one before it will continue. Changing it is
	// also what makes this a real change request.
	await page.locator('#f-why').fill('A short EP, updated through the attestation flow.');

	// The disclosure is asked on this step, beside the explicit checkbox, and
	// holds it until answered.
	const editContinue = page.getByRole('button', { name: 'Continue', exact: true }).last();
	await expect(editContinue).toBeDisabled();
	await discloseAdultContent(page, 'yes');
	const confirm = page.getByRole('checkbox', { name: /behind a clear content warning/ });
	await expect(confirm).toBeVisible();
	await page.getByRole('radio', { name: 'No', exact: true }).check();
	await expect(confirm, 'switching back to "no" clears it').toHaveCount(0);
	await expect(editContinue).toBeEnabled();
	await editContinue.click();
	await expect(page.getByRole('heading', { name: 'Review and send' })).toBeVisible();

	const send = page.getByRole('button', { name: 'Send request' });
	await page.locator('#f-email').fill('update@example.com');
	await expect(send, 'an email alone is not enough').toBeDisabled();

	// This flow has no EULA box, so rights are their own checkbox here.
	await page.getByRole('checkbox', { name: /were made by people/ }).check();
	await expect(send).toBeDisabled();
	await page.getByRole('checkbox', { name: /I hold the rights to the works/ }).check();
	await expect(send).toBeEnabled();
	await send.click();
	await expect(page.getByText('ref-update')).toBeVisible();

	const update = lastOf(sent, 'submit_update');
	expect(update?.email).toBe('update@example.com');
	expect(update?.review).toEqual({
		ai_attestation: true,
		rights_confirmation: true,
		adult_content: 'no',
		adult_content_confirmation: false
	});
});
