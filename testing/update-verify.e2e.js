import { expect, test } from '@playwright/test';

/**
 * `/update` used to collapse three distinct verify-failure reasons
 * (`expired`, `redirect`, `unsafe_url`) into one message — "Token not found
 * there yet. Double check it was pasted in and saved." — which sent a
 * creator whose page redirected off chasing a paste mistake that was never
 * the actual problem. See `join-verify.e2e.js` for the sibling coverage of
 * `/join`'s version of the same bug, including why this needs the dev-mode
 * mock and `networkidle`.
 */

const REASONS = [
	'expired',
	'redirect',
	'unsafe-url',
	'unreachable',
	'fail-verify',
	'unknown-verify'
];

/**
 * A single real node to identify against.
 *
 * `join-mock-dev`'s server is plain `npm run dev` (no seeding step — that
 * only runs for the `production` project's built preview, per
 * `testing/scripts/seed-e2e-ring.mjs`), so it serves the repository's actual
 * `ring.json` as-is, which is legitimately empty right now — an empty ring is
 * itself a supported state (`empty-ring.e2e.js`), not a fixture gap. This
 * test isn't about the ring's real contents, only about what `/update`
 * renders once a node is found, so it stubs the fetch the same way
 * `empty-ring.e2e.js` does rather than depending on what happens to be
 * published.
 * @param {import('@playwright/test').Page} page
 */
async function stubOneNode(page) {
	await page.route('**/ring.json', (r) =>
		r.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([
				{
					id: 'audio-verify-test',
					creator: 'Verify Test',
					type: 'audio',
					why: 'Exists only to give /update a node to identify.',
					source_url: 'https://example.com',
					tags: ['test'],
					verification_token: 'test-token'
				}
			])
		})
	);
}

/** @param {import('@playwright/test').Page} page */
async function setMock(page, mode) {
	await page.evaluate((m) => {
		const url = new URL(location.href);
		url.searchParams.set('mock', m);
		history.replaceState(null, '', url);
	}, mode);
}

test('every verify failure reason renders its own message on /update', async ({
	page
}, testInfo) => {
	// Same reason join-verify.e2e.js has this guard: the global testMatch
	// still hands this file to every project, and `?mock=` only works on the
	// dev server the mock is stripped from a `production` preview build.
	test.skip(testInfo.project.name !== 'join-mock-dev');

	await page.addInitScript(() => localStorage.clear());
	await page.setViewportSize({ width: 1280, height: 900 });
	await stubOneNode(page);
	await page.goto('/update?mock=fail-verify', { waitUntil: 'networkidle' });

	await page.locator('#f-node-id').fill('audio-verify-test');
	await expect(page.locator('.note')).toContainText('Found it');
	await page.getByRole('button', { name: 'Continue', exact: true }).click();

	await page.getByRole('button', { name: 'Generate my token' }).click();
	const tokenSnippet = page.locator('.verification-snippet');
	await expect(tokenSnippet).toBeVisible();
	await expect(tokenSnippet).toHaveCSS('box-sizing', 'border-box');
	await expect(tokenSnippet).toHaveCSS('border-top-width', '1px');
	const tokenBox = await tokenSnippet.evaluate((element) => ({
		background: getComputedStyle(element).backgroundColor,
		width: element.getBoundingClientRect().width
	}));
	expect(tokenBox.background).not.toMatch(/^rgba\(0, 0, 0, 0\)$/);
	expect(tokenBox.width).toBeGreaterThan(400);
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
		expect(text.length, `reason ${reason} should render real text`).toBeGreaterThan(10);
		seen[reason] = text;
	}

	// The actual bug: expired/redirect/unsafe_url all used to say "token not
	// found," identical to fail-verify's own message. Every reason must read
	// differently now.
	const distinct = new Set(Object.values(seen));
	expect(
		distinct.size,
		`expected ${REASONS.length} distinct messages, got ${JSON.stringify(seen)}`
	).toBe(REASONS.length);
});

test('update review keeps exact data inside the shared scroll container', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name !== 'join-mock-dev');

	await page.addInitScript(() => localStorage.clear());
	await page.setViewportSize({ width: 390, height: 844 });
	await stubOneNode(page);
	await page.goto('/update', { waitUntil: 'networkidle' });

	await page.locator('#f-node-id').fill('audio-verify-test');
	await expect(page.locator('.note')).toContainText('Found it');
	await page.getByRole('button', { name: 'Continue', exact: true }).click();

	await page.getByRole('button', { name: 'Generate my token' }).click();
	await page.getByRole('button', { name: 'Verify', exact: true }).click();
	await expect(page.getByText('Verified. That page is yours.')).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

	await expect(page.getByRole('heading', { name: "What's changing?" })).toBeVisible();
	// The stubbed node predates `form`, so the pre-migration audio member has
	// none yet and the step re-asks for it before Continue is enabled.
	await page.locator('#f-form').selectOption('music');
	await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
	await expect(page.getByRole('heading', { name: 'Review and send' })).toBeVisible();

	const exactData = page.locator('details.exact-data');
	await expect(exactData).toBeVisible();
	await exactData.locator('summary').click();
	await expect(exactData.locator('.exact-data-scroll')).toHaveCSS('overflow-x', 'auto');
	await expect(exactData.locator('pre')).toContainText('Verify Test');
});
