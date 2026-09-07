import { expect, test } from '@playwright/test';

// /embed-frame is the sandboxed-iframe widget target a member's page loads
// cross-origin (src/routes/embed-frame/+page.svelte, docs/decisions.md's
// widget-iframe-isolation entry). This suite runs it through the preview
// server directly, same-origin -- it cannot exercise the real cross-origin
// sandboxed embedding a member site does (that needs a real second origin
// and is tracked as its own, larger e2e gap), but it does confirm the page
// itself renders correctly and carries none of the main app's chrome, which
// is exactly what a regression in the root layout's isEmbedFrame branch
// would break silently.

test('embed-frame renders the widget with no app chrome', async ({ page }) => {
	await page.goto('/embed-frame?site-id=audio-ashzone-xeno');

	// None of the main app's floating chrome exists on this route.
	await expect(page.locator('.brand-float')).toHaveCount(0);
	await expect(page.locator('.menu-trigger')).toHaveCount(0);
	await expect(page.locator('.nav-mobile')).toHaveCount(0);
	await expect(page.locator('.desktop-tools')).toHaveCount(0);

	// The real widget mounts and becomes interactive. Playwright's locators
	// pierce an open shadow root, which is exactly what indienode-widget uses.
	const widget = page.locator('indienode-widget');
	await expect(widget).toBeVisible();
	await expect(widget.getByRole('region', { name: 'IndieNodes webring' })).toBeVisible();
	await expect(widget.getByRole('button', { name: /Next/ })).toBeEnabled();
	await expect(widget.getByRole('button', { name: 'Random' })).toBeEnabled();
});

test('embed-frame with no site-id still renders a working widget', async ({ page }) => {
	// A host page that hasn't set site-id yet (or a creator previewing before
	// approval) gets a random starting point rather than a broken widget --
	// same contract Widget.svelte's own siteId-not-found fallback already
	// guarantees.
	await page.goto('/embed-frame');

	const widget = page.locator('indienode-widget');
	await expect(widget).toBeVisible();
	await expect(widget.getByRole('region', { name: 'IndieNodes webring' })).toBeVisible();
});

test('the /widget demo page live-previews the real sandboxed iframe', async ({ page }) => {
	await page.goto('/widget');

	const frame = page.frameLocator('iframe[title="IndieNodes webring"]');
	await expect(frame.getByRole('region', { name: 'IndieNodes webring' })).toBeVisible();
});

test.describe('optional theming via query params', () => {
	// Widget.svelte exposes exactly two CSS custom properties for an
	// embedding site to match its own brand (see that file's own comment);
	// /embed-frame is one of the two places that reads them, from its own
	// URL rather than a light-DOM stylesheet. These check the custom
	// property actually reaches the shadow root with the resolved value the
	// widget's own `:host` rule computes from it, not just that the page
	// didn't error.

	test('a valid accent and font are applied inside the shadow root', async ({ page }) => {
		await page.goto('/embed-frame?site-id=audio-ashzone-xeno&accent=%23ff00aa&font=monospace');

		const widget = page.locator('indienode-widget');
		await expect(widget).toBeVisible();
		const resolvedAccent = await widget.evaluate((el) =>
			getComputedStyle(el).getPropertyValue('--accent').trim()
		);
		expect(resolvedAccent).toBe('#ff00aa');
		const resolvedFont = await widget
			.locator('.widget')
			.evaluate((el) => getComputedStyle(el).fontFamily);
		expect(resolvedFont).toContain('monospace');
	});

	test('an invalid accent falls back to the default rather than breaking', async ({ page }) => {
		await page.goto(
			'/embed-frame?site-id=audio-ashzone-xeno&accent=' +
				encodeURIComponent('red; background: url(https://evil.example/track.png)')
		);

		const widget = page.locator('indienode-widget');
		await expect(widget).toBeVisible();
		await expect(widget.getByRole('region', { name: 'IndieNodes webring' })).toBeVisible();
		const resolvedAccent = await widget.evaluate((el) =>
			getComputedStyle(el).getPropertyValue('--accent').trim()
		);
		// The default light-mode accent, not the rejected value and not empty.
		expect(resolvedAccent).toBe('#b5502f');
	});

	test('no theming params leaves the default accent and font in place', async ({ page }) => {
		await page.goto('/embed-frame?site-id=audio-ashzone-xeno');

		const widget = page.locator('indienode-widget');
		await expect(widget).toBeVisible();
		const resolvedAccent = await widget.evaluate((el) =>
			getComputedStyle(el).getPropertyValue('--accent').trim()
		);
		expect(resolvedAccent).toBe('#b5502f');
	});

	test('the script tier picks up a host page setting the property directly, no query param involved', async ({
		page
	}) => {
		// The other half of the same contract: a member using the advanced
		// script tier sets --indienode-accent in their OWN site's stylesheet,
		// targeting the light-DOM <indienode-widget> element directly -- no
		// /embed-frame, no query string, just ordinary CSS custom-property
		// inheritance across the open shadow boundary.
		await page.goto('/widget');
		await page.getByRole('tab', { name: 'Advanced' }).click();
		await page.addStyleTag({ content: 'indienode-widget { --indienode-accent: #00aa55; }' });

		const widget = page.locator('indienode-widget');
		await expect(widget).toBeVisible();
		const resolvedAccent = await widget.evaluate((el) =>
			getComputedStyle(el).getPropertyValue('--accent').trim()
		);
		expect(resolvedAccent).toBe('#00aa55');
	});
});
