import { expect, test } from '@playwright/test';

/**
 * Every failure reason the ownership-verification backend can send
 * (`docs/n8n-workflow-runbook.md` §6) has to render *something*. It didn't:
 * `expired` and `redirect` fell through `/join`'s message map to `''`, which
 * this button renders as nothing at all — Verify just reset with no
 * explanation, reported live as "doesn't seem to be working." `/update` had
 * the opposite flaw, collapsing three distinct reasons into one misleading
 * message. This walks all five reasons on both pages in a real browser.
 *
 * `mode()` in `submissionApi.mock.js` reads `window.location.search` live at
 * call time, so the query string is swapped with `history.replaceState`
 * between attempts rather than reloading the page — the whole point is
 * proving the *rendering* is correct once a real result comes back, not
 * re-driving the form five times over.
 */

const REASONS = [
	'expired',
	'unsafe-url',
	'redirect',
	'unreachable',
	'fail-verify',
	'unknown-verify'
];

/**
 * Raw `history.replaceState`, deliberately not SvelteKit's `$app/navigation`
 * equivalent: that goes through the router, which would treat this as a real
 * navigation and reload data/reset the form. All this needs to change is what
 * `mode()` reads next time `verify()` runs — the SPA state must survive
 * untouched. SvelteKit's dev build logs a console warning recommending its
 * own import for any direct `history.*` call; expected here and safe to
 * ignore, not a sign this should be swapped out.
 * @param {import('@playwright/test').Page} page
 */
async function setMock(page, mode) {
	await page.evaluate((m) => {
		const url = new URL(location.href);
		url.searchParams.set('mock', m);
		history.replaceState(null, '', url);
	}, mode);
}

test('every verify failure reason renders its own message on /join', async ({ page }, testInfo) => {
	// `testMatch` on the `join-mock-dev` project restricts what runs *there*,
	// but the global `testMatch` in playwright.config.js still picks this file
	// up for every other project too, `production` included — where `?mock=`
	// does nothing (useMock is stripped from a built-and-preview server) and
	// this would just fail. Same guard `skin-lab.e2e.js` already uses for the
	// same reason.
	test.skip(testInfo.project.name !== 'join-mock-dev');

	await page.addInitScript(() => localStorage.clear());
	await page.setViewportSize({ width: 1280, height: 900 });
	// `networkidle`, not the default `load`: this runs against a dev server
	// (see the `join-mock-dev` project's own comment in playwright.config.js
	// for why it has to be dev, not the prebuilt `production` preview), and a
	// dev server compiles modules on demand rather than serving a prebundled
	// script. `load` fires before hydration has actually finished wiring up
	// event handlers, so a click lands on inert server-rendered HTML and does
	// nothing — no error, no navigation, just silence. Confirmed directly:
	// without this, the Start button reports itself visible and enabled, the
	// click resolves without throwing, and the page still shows step one four
	// seconds later. `generator-templates.visual.e2e.js` hits the same class
	// of problem against its own dev server (port 4175) and uses the same fix.
	await page.goto('/join?mock=fail-verify', { waitUntil: 'networkidle' });

	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await page.getByRole('radio', { name: /Yes, I have a site/ }).check();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await expect(page.getByRole('heading', { name: 'Your entry' })).toBeVisible();
	await page.locator('#f-creator').fill('Test Creator');
	await page.locator('#f-type').selectOption('audio');
	await page.locator('#f-form').selectOption('music');
	await page.locator('#f-why').fill('Testing the verify failure messages.');
	await page.locator('#f-source').fill('https://example.com');
	await page.locator('#f-tags').fill('test');
	await page.locator('#f-tags').press('Enter');
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	// Audio tracks are optional on the has-a-site branch, so Continue is
	// already enabled with none filled in.
	await expect(page.getByRole('heading', { name: 'Your tracks' })).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await page.getByRole('button', { name: 'Generate my token' }).click();
	const verifyButton = page.getByRole('button', { name: 'Verify', exact: true });
	await expect(verifyButton).toBeVisible();

	/** @type {Record<string, string>} */
	const seen = {};
	for (const reason of REASONS) {
		await setMock(page, reason);
		await verifyButton.click();
		const message = page.locator('.inline-error[role="alert"]');
		await expect(message, `reason: ${reason}`).toBeVisible();
		const text = (await message.textContent())?.trim() ?? '';
		expect(
			text.length,
			`reason ${reason} should render real text, not an empty alert`
		).toBeGreaterThan(10);
		seen[reason] = text;
	}

	// Every documented reason plus an unknown backend value renders real text.
	// Known reasons remain distinct; the unknown one is the generic safety net.
	const distinct = new Set(Object.values(seen));
	expect(
		distinct.size,
		`expected ${REASONS.length} distinct messages, got ${JSON.stringify(seen)}`
	).toBe(REASONS.length);
});

test('editing a redirected URL creates a fresh verification session', async ({
	page
}, testInfo) => {
	// The mock backend is available only in the dedicated dev-server project.
	test.skip(testInfo.project.name !== 'join-mock-dev');

	await page.addInitScript(() => localStorage.clear());
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/join?mock=redirect', { waitUntil: 'networkidle' });

	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await page.getByRole('radio', { name: /Yes, I have a site/ }).check();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await expect(page.getByRole('heading', { name: 'Your entry' })).toBeVisible();
	await page.locator('#f-creator').fill('Redirect Test');
	await page.locator('#f-type').selectOption('audio');
	await page.locator('#f-form').selectOption('music');
	await page.locator('#f-why').fill('Testing a corrected verification URL.');
	await page.locator('#f-source').fill('https://example.com/redirect');
	await page.locator('#f-tags').fill('test');
	await page.locator('#f-tags').press('Enter');
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await expect(page.getByRole('heading', { name: 'Your tracks' })).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await page.getByRole('button', { name: 'Generate my token' }).click();
	await setMock(page, 'redirect');
	await page.getByRole('button', { name: 'Verify', exact: true }).click();
	await expect(page.getByText(/address redirects somewhere else/)).toBeVisible();

	await page.getByRole('button', { name: 'Back', exact: true }).last().click();
	await expect(page.getByRole('heading', { name: 'Your tracks' })).toBeVisible();
	await page.getByRole('button', { name: 'Back', exact: true }).last().click();
	await expect(page.getByRole('heading', { name: 'Your entry' })).toBeVisible();
	await page.locator('#f-source').fill('https://example.com/final');

	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await expect(page.getByRole('heading', { name: 'Your tracks' })).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await expect(page.getByRole('heading', { name: 'Prove the page is yours' })).toBeVisible();

	// The previous URL's token cannot be reused; the corrected URL gets its own.
	await expect(page.getByRole('button', { name: 'Generate my token' })).toBeVisible();
	await setMock(page, 'success');
	await page.getByRole('button', { name: 'Generate my token' }).click();
	await page.getByRole('button', { name: 'Verify', exact: true }).click();
	await expect(page.getByText('✓ Verified. That page is yours.')).toBeVisible();
});
