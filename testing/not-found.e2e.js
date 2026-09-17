import { expect, test } from '@playwright/test';

// The app's routes live in the `(app)` layout group so /embed-frame can sit
// outside it. SvelteKit renders an unmatched URL with the *root* error page
// and root layout, which no longer carry the app, so the group has its own
// `[...missing]` catch-all. These pin that a mistyped URL still gets the
// in-app "That node isn't here" page with the app's chrome around it, and
// that the catch-all never swallows a real route.

test('an unknown URL renders the in-app 404 with the app chrome', async ({ page }) => {
	await page.setViewportSize({ width: 1400, height: 900 });
	await page.goto('/definitely-not-a-node');

	await expect(page.getByRole('heading', { name: "That node isn't here" })).toBeVisible();
	await expect(page.locator('.brand-float')).toBeVisible();
	await expect(page).toHaveTitle(/Not found/);
});

test('a nested unknown URL is caught too', async ({ page }) => {
	await page.goto('/members/nope/still-nope');
	await expect(page.getByRole('heading', { name: "That node isn't here" })).toBeVisible();
});

test('real routes are not caught by the 404 route', async ({ page }) => {
	await page.goto('/contact');
	await expect(page.getByRole('heading', { name: "That node isn't here" })).toHaveCount(0);
	await expect(page).not.toHaveTitle(/Not found/);
});
