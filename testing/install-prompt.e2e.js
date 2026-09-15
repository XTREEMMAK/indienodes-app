import { devices, expect, test } from '@playwright/test';

/**
 * The one-time "add to home screen" offer. Chromium's real
 * `beforeinstallprompt` cannot fire under automation (installability needs a
 * real, engaged, secure-origin visit), so a stand-in with the same shape is
 * dispatched instead: what is under test is what the app does with it.
 */

/** @param {import('@playwright/test').Page} page @param {number} priorVisits */
async function seedVisits(page, priorVisits) {
	await page.addInitScript((count) => {
		if (!sessionStorage.getItem('seeded')) {
			localStorage.setItem('indienode:visit-count:v1', JSON.stringify({ version: 1, count }));
			sessionStorage.setItem('seeded', 'true');
		}
	}, priorVisits);
}

/** @param {import('@playwright/test').Page} page */
async function fireInstallEvent(page) {
	await page.evaluate(() => {
		const event = new Event('beforeinstallprompt', { cancelable: true });
		Object.assign(event, {
			prompt: async () => {
				/** @type {any} */ (window).__installPrompted = true;
			},
			userChoice: Promise.resolve({ outcome: 'accepted' })
		});
		window.dispatchEvent(event);
	});
}

test.describe('on an Android phone', () => {
	test.use({
		viewport: devices['Pixel 7'].viewport,
		userAgent: devices['Pixel 7'].userAgent,
		deviceScaleFactor: devices['Pixel 7'].deviceScaleFactor,
		isMobile: true,
		hasTouch: true
	});

	test('offers install once, on the second visit, and opens the browser dialog', async ({
		page
	}) => {
		await seedVisits(page, 1);
		await page.goto('/');
		await fireInstallEvent(page);

		const banner = page.getByRole('complementary', { name: 'Install IndieNodes' });
		await expect(banner).toBeVisible({ timeout: 8000 });
		await banner.getByRole('button', { name: 'Install', exact: true }).click();
		await expect
			.poll(() => page.evaluate(() => /** @type {any} */ (window).__installPrompted))
			.toBe(true);
		await expect(banner).toHaveCount(0);

		// Never again, whichever way it ended.
		await page.reload();
		await fireInstallEvent(page);
		await page.waitForTimeout(4000);
		await expect(banner).toHaveCount(0);

		// The deliberate route stays in the More menu.
		await page.getByRole('button', { name: /More/ }).first().click();
		await expect(page.getByRole('menuitem', { name: 'Install app' })).toBeVisible();
	});

	test('a dismissed offer does not come back', async ({ page }) => {
		await seedVisits(page, 1);
		await page.goto('/');
		await fireInstallEvent(page);
		const banner = page.getByRole('complementary', { name: 'Install IndieNodes' });
		await expect(banner).toBeVisible({ timeout: 8000 });
		await banner.getByRole('button', { name: 'Dismiss install offer' }).click();
		await expect(banner).toHaveCount(0);

		await page.reload();
		await fireInstallEvent(page);
		await page.waitForTimeout(4000);
		await expect(banner).toHaveCount(0);
	});

	test('the first visit asks nothing', async ({ page }) => {
		await seedVisits(page, 0);
		await page.goto('/');
		await fireInstallEvent(page);
		await page.waitForTimeout(4000);
		await expect(page.getByRole('complementary', { name: 'Install IndieNodes' })).toHaveCount(0);
	});
});

test.describe('on an iPhone', () => {
	test.use({
		viewport: devices['iPhone 14'].viewport,
		userAgent: devices['iPhone 14'].userAgent,
		deviceScaleFactor: devices['iPhone 14'].deviceScaleFactor,
		isMobile: true,
		hasTouch: true
	});

	test('explains Share, then Add to Home Screen', async ({ page }) => {
		await seedVisits(page, 1);
		await page.goto('/');
		const banner = page.getByRole('complementary', { name: 'Install IndieNodes' });
		await expect(banner).toBeVisible({ timeout: 8000 });
		await banner.getByRole('button', { name: 'How to' }).click();
		const steps = page.getByRole('complementary', { name: 'Add to your home screen' });
		await expect(steps).toBeVisible();
		await expect(steps).toContainText('Add to Home Screen');
		await steps.getByRole('button', { name: 'Close install steps' }).click();
		await expect(steps).toHaveCount(0);
	});
});

test.describe('on a desktop browser', () => {
	test('shows no banner even when the browser could install', async ({ page }) => {
		await seedVisits(page, 1);
		await page.goto('/');
		await fireInstallEvent(page);
		await page.waitForTimeout(4000);
		await expect(page.getByRole('complementary', { name: 'Install IndieNodes' })).toHaveCount(0);
	});
});
