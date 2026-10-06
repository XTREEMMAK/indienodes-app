import { expect, test } from '@playwright/test';

test('skin laboratory renders every type and exercises boundary controls', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name !== 'skin-lab-dev');
	await page.goto('/dev/skins');

	await expect(page.getByRole('heading', { name: 'Skin Laboratory' })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('data-ui-skin', 'glassmorphic');
	await expect(page.locator('.node')).toHaveCount(7);
	await expect(page.getByText('Midnight Receiver')).toBeVisible();
	await expect(page.getByText('Paper Lantern Comics')).toBeVisible();
	await expect(page.getByText('Loose Leaf Press')).toBeVisible();
	await expect(page.getByText('North Window Studio')).toBeVisible();
	await expect(page.getByText('Fictional Loom Works')).toBeVisible();
	await expect(page.getByText('Imaginary Kiln Studio')).toBeVisible();
	await expect(page.getByText('Tin Roof Studio')).toBeVisible();

	await page.getByLabel('Simulate reduced motion').check();
	await page.getByLabel('Pause timed content').check();
	await page.getByLabel('Include artwork').uncheck();
	await expect(page.locator('.node.has-image')).toHaveCount(0);
});

test('game trailer iframe is created only after an explicit play action', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name !== 'skin-lab-dev');
	await page.route('https://www.youtube-nocookie.com/**', (route) => route.abort());
	await page.goto('/dev/skins');

	await expect(page.locator('iframe[title="Tin Roof Studio game trailer"]')).toHaveCount(0);
	await page.getByRole('button', { name: "Watch Tin Roof Studio's game trailer" }).click();
	const trailer = page.locator('iframe[title="Tin Roof Studio game trailer"]');
	await expect(trailer).toHaveCount(1);
	await expect(trailer).toHaveAttribute(
		'src',
		'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1'
	);
	await page.getByRole('button', { name: 'Close trailer' }).click();
	await expect(trailer).toHaveCount(0);
});

test('ordinary Text node exposes local-device Read aloud start and stop', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name !== 'skin-lab-dev');
	await page.addInitScript(() => {
		class MockUtterance {
			constructor(text) {
				this.text = text;
				this.voice = null;
				this.lang = '';
				this.onend = null;
				this.onerror = null;
			}
		}
		window.SpeechSynthesisUtterance = MockUtterance;
		Object.defineProperty(window, 'speechSynthesis', {
			configurable: true,
			value: {
				getVoices: () => [{ name: 'Local Test', lang: 'en-US', localService: true, default: true }],
				addEventListener: () => {},
				removeEventListener: () => {},
				cancel: () => {},
				speak: (utterance) => {
					window.__skinLabSpoken = utterance.text;
				}
			}
		});
	});
	await page.goto('/dev/skins');

	const read = page.locator('.node[data-type="text"] .speech-button');
	await expect(read).toBeVisible();
	await expect(read).toHaveAccessibleName("Read Loose Leaf Press's excerpt aloud");
	await read.click();
	await expect(read).toHaveAttribute('aria-pressed', 'true');
	await expect(read).toHaveAccessibleName('Stop reading Loose Leaf Press');
	await expect.poll(() => page.evaluate(() => window.__skinLabSpoken)).toContain('recipe card');
	await read.click();
	await expect(read).toHaveAttribute('aria-pressed', 'false');
});

test('production does not publish the skin laboratory', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'production');
	await page.goto('/dev/skins');
	await expect(page.getByRole('heading', { name: 'Skin Laboratory' })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: "That node isn't here" })).toBeVisible();
});
