import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Caddy sets these headers in production; the preview server this suite runs
// against does not, since it is plain `vite preview` with no Caddy in front
// of it (see playwright.config.js). Route interception applies the exact
// same header string Caddy would, against the exact same built HTML, so this
// is a real test of the policy rather than of Caddy's config syntax (which
// nothing in this repo's toolchain can validate -- there is no `caddy`
// binary in CI or this sandbox). It cannot replace validating the Caddyfile
// itself against a real Caddy instance before/at deploy.
const CADDYFILE = readFileSync(new URL('../Caddyfile', import.meta.url), 'utf8');

// Two Content-Security-Policy declarations exist, in file order: the
// site-wide baseline first, then /embed-frame's own stricter override.
const cspDeclarations = [...CADDYFILE.matchAll(/Content-Security-Policy "([^"]+)"/g)].map(
	(m) => m[1]
);
if (cspDeclarations.length !== 2) {
	throw new Error(
		`Expected exactly 2 Content-Security-Policy declarations in the Caddyfile (the site-wide ` +
			`baseline and /embed-frame's override), found ${cspDeclarations.length}. Update this test ` +
			'to match the Caddyfile structure.'
	);
}
const [MAIN_CSP, EMBED_FRAME_CSP] = cspDeclarations;

/**
 * Applies a CSP header to every navigation response and collects violations
 * via the real `securitypolicyviolation` event, not just console scraping --
 * that event fires for every kind of violation (including ones a browser
 * does not also log), and carries the exact blocked directive/URI.
 * @param {import('@playwright/test').Page} page
 * @param {string} csp
 */
async function withCsp(page, csp) {
	await page.addInitScript(() => {
		window.__cspViolations = [];
		document.addEventListener('securitypolicyviolation', (e) => {
			window.__cspViolations.push(`${e.violatedDirective}: ${e.blockedURI}`);
		});
	});
	// Only the top-level document response needs the header added -- CSP is
	// a per-document policy, and every sub-resource this suite cares about
	// (images, fonts, scripts) is governed by that one policy regardless of
	// its own response headers. Leaving every other request alone (rather
	// than re-fetching it here) matters concretely: the fixture ring embeds
	// deliberately unreachable `https://example.invalid/...` media URLs, and
	// re-fetching those through this handler throws instead of letting the
	// real browser fail them normally the way a live page would.
	await page.route('**/*', async (route) => {
		if (route.request().resourceType() !== 'document') return route.continue();
		const response = await route.fetch();
		await route.fulfill({
			response,
			headers: { ...response.headers(), 'content-security-policy': csp }
		});
	});
}

/** @param {import('@playwright/test').Page} page */
async function violations(page) {
	return page.evaluate(() => window.__cspViolations ?? []);
}

// A valid, pre-seeded draft, same shape join-editor-preview.e2e.js's own
// fixture uses: this suite is testing the CSP, not re-deriving the join
// form's own field-by-field validation, so skipping straight to a page that
// needs one avoids duplicating that flow.
const DRAFT = {
	creator: 'CSP Test',
	type: 'audio',
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

test.describe('the main-app Content-Security-Policy', () => {
	test('the field view loads images, audio metadata, and the ring with no violations', async ({
		page
	}) => {
		await withCsp(page, MAIN_CSP);
		await page.goto('/', { waitUntil: 'networkidle' });
		await expect(page.locator('.node').first()).toBeVisible({ timeout: 10000 });
		expect(await violations(page)).toEqual([]);
	});

	test('members, lists, and settings load with no violations', async ({ page }) => {
		await withCsp(page, MAIN_CSP);
		for (const path of ['/members', '/lists', '/settings']) {
			await page.goto(path, { waitUntil: 'networkidle' });
			expect(await violations(page), path).toEqual([]);
		}
	});

	test('the join flow (inline styles, uploads, the sandboxed preview) has no violations', async ({
		page
	}) => {
		await withCsp(page, MAIN_CSP);
		await page.addInitScript((entry) => {
			localStorage.setItem('indienode:submission-draft:v1', JSON.stringify(entry));
		}, DRAFT);
		await page.goto('/join', { waitUntil: 'networkidle' });
		await page.getByRole('button', { name: 'Start', exact: true }).click();
		await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
		await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
		await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
		await expect(page.getByRole('heading', { name: 'Build your page' })).toBeVisible();
		await page.getByRole('button', { name: 'Open the editor' }).click();
		await expect(
			page.frameLocator('iframe[title="Live preview of your page"]').locator('body')
		).toBeVisible();
		expect(await violations(page)).toEqual([]);
	});

	test('the widget reference page (script tag + same-origin iframe) has no violations', async ({
		page
	}) => {
		await withCsp(page, MAIN_CSP);
		// The default tab already renders the iframe; violations accumulate
		// for the page's whole lifetime (see withCsp), so switching to the
		// Advanced tab to also mount the script-tag embed before reading
		// them still catches a violation from either one.
		await page.goto('/widget', { waitUntil: 'networkidle' });
		await page.getByRole('tab', { name: 'Advanced' }).click();
		await expect(page.locator('indienode-widget')).toBeVisible();
		// Not asserting into the nested iframe's own content here: that iframe
		// navigates to /embed-frame, a real cross-document load this same
		// route handler would (incorrectly, for this purpose) hand the
		// main-app CSP rather than /embed-frame's own -- already covered
		// correctly by the dedicated /embed-frame test below.
		expect(await violations(page)).toEqual([]);
	});

	// This pair exists because the pair above didn't: the join-flow test
	// already in this file uses a pre-seeded generator draft that never
	// reaches a real webhookClient.js call, and members/lists/settings never
	// call it either. Nothing here previously exercised connect-src against
	// the actual submission/contact webhook fetch -- which is exactly the gap
	// that shipped connect-src without n8n.kjnet.us in it, caught live on
	// /update instead of by this suite. `playwright.config.js`'s "production"
	// project now builds with real (but nonexistent-path) webhook URLs
	// specifically so `hasBackend` is true here and these two attempt the
	// real fetch() call `submissionApi.js`/`contactApi.js` would make -- CSP
	// evaluates and either allows or blocks that call before any network
	// activity happens, so whether the far end actually answers is
	// irrelevant to what this test checks.
	test('generating a verification token attempts the real webhook fetch with no violations', async ({
		page
	}) => {
		await withCsp(page, MAIN_CSP);
		await page.goto('/join', { waitUntil: 'networkidle' });
		await page.getByRole('button', { name: 'Start', exact: true }).click();
		await page.getByRole('radio', { name: /Yes, I have a site/ }).check();
		await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

		await page.locator('#f-creator').fill('CSP Webhook Test');
		await page.locator('#f-type').selectOption('audio');
		await page.locator('#f-why').fill('Exercises the real submission webhook fetch under CSP.');
		await page.locator('#f-source').fill('https://example.com');
		await page.locator('#f-tags').fill('test');
		await page.locator('#f-tags').press('Enter');
		await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
		await page.getByRole('button', { name: 'Continue', exact: true }).last().click();

		await page.getByRole('button', { name: 'Generate my token' }).click();
		// Not asserting the request succeeds -- the webhook path is
		// deliberately unregistered (see playwright.config.js). Only that
		// nothing about attempting it violated CSP.
		await page.waitForTimeout(1000);
		expect(await violations(page)).toEqual([]);
	});

	// A second, separate gap of the same shape the pair above closed:
	// `checkRateStatus` fires its own fetch automatically the moment
	// `/update`'s identify step finds a match, before anyone clicks anything
	// or Turnstile is even in view. Nothing above exercised that path.
	test('finding a node on /update attempts the real rate-status fetch with no violations', async ({
		page
	}) => {
		await withCsp(page, MAIN_CSP);
		await page.goto('/update', { waitUntil: 'networkidle' });
		await page.locator('#f-node-id').fill('audio-ashzone-xeno');
		await expect(page.getByText('Found it:')).toBeVisible();
		await page.waitForTimeout(1000);
		expect(await violations(page)).toEqual([]);
	});

	test('sending a contact message attempts the real webhook fetch with no violations', async ({
		page
	}) => {
		await withCsp(page, MAIN_CSP);
		await page.goto('/contact', { waitUntil: 'networkidle' });
		await page.locator('#f-name').fill('CSP Webhook Test');
		await page.locator('#f-email').fill('csp-test@example.com');
		await page.locator('#f-message').fill('Exercises the real contact webhook fetch under CSP.');
		await page.getByRole('button', { name: /Send message|Sending…/ }).click();
		await page.waitForTimeout(1000);
		expect(await violations(page)).toEqual([]);
	});
});

test.describe('the /embed-frame Content-Security-Policy', () => {
	test('the sandboxed widget target mounts and fetches ring.json with no violations', async ({
		page
	}) => {
		await withCsp(page, EMBED_FRAME_CSP);
		await page.goto('/embed-frame?site-id=audio-ashzone-xeno', { waitUntil: 'networkidle' });
		await expect(page.locator('indienode-widget')).toBeVisible();
		await expect(
			page.locator('indienode-widget').getByRole('region', { name: 'IndieNodes webring' })
		).toBeVisible();
		expect(await violations(page)).toEqual([]);
	});
});
