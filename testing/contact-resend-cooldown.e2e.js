import { expect, test } from '@playwright/test';

/**
 * "Send another message" cooldown, added after live testing showed 6
 * back-to-back sends going through: not a bot gap (Turnstile plus the edge
 * rate limit on n8n.kjnet.us already stop that, verified live -- a rapid
 * burst gets refused after the fourth request), but a real visitor could
 * burn through that same per-IP budget and land on a confusing "Too many
 * requests" error with no warning. This is UX, not a security control: a
 * script posting straight to the webhook never runs this page's JS at all.
 *
 * Uses Playwright's virtual clock so the 20s cooldown does not cost 20 real
 * seconds per run. `pauseAt` freezes the clock right after installing it, so
 * nothing advances except through an explicit `runFor` -- unlike
 * `fastForward`, which only fires each due timer once and then lets real
 * time keep flowing, `runFor` fires every interval tick due within the
 * window, which is what a `setInterval`-driven countdown needs to be
 * asserted deterministically. The mock backend's own artificial latency
 * (contactApi.mock.js) is a real setTimeout too, so it needs the same
 * treatment before "Sent." appears.
 */
test('the resend cooldown disables the button, counts down, then re-enables', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name !== 'join-mock-dev');

	await page.addInitScript(() => localStorage.clear());
	await page.goto('/contact');
	await page.clock.install();
	await page.clock.pauseAt(Date.now());

	await page.locator('#f-name').fill('Cooldown Test');
	await page.locator('#f-email').fill('cooldown@example.com');
	await page.locator('#f-message').fill('Checking the resend cooldown.');
	await page.getByRole('button', { name: 'Send message' }).click();

	// Past the mock's own 600ms latency, not the cooldown itself.
	await page.clock.runFor(700);
	await expect(page.getByRole('heading', { name: 'Sent.' })).toBeVisible();

	const sendAnother = page.getByRole('button', { name: /Send another message/ });
	await expect(sendAnother).toBeDisabled();
	await expect(sendAnother).toHaveText('Send another message (20s)');

	await page.clock.runFor(5000);
	await expect(sendAnother).toHaveText('Send another message (15s)');
	await expect(sendAnother).toBeDisabled();

	await page.clock.runFor(15000);
	await expect(sendAnother).toBeEnabled();
	await expect(sendAnother).toHaveText('Send another message');

	// A real second send still works once the cooldown clears, and starts a
	// fresh cooldown rather than leaving the button permanently enabled.
	await sendAnother.click();
	await expect(page.getByRole('heading', { name: 'Sent.' })).toHaveCount(0);
	await page.locator('#f-name').fill('Cooldown Test Two');
	await page.locator('#f-email').fill('cooldown@example.com');
	await page.locator('#f-message').fill('Second message after the cooldown cleared.');
	await page.getByRole('button', { name: 'Send message' }).click();
	await page.clock.runFor(700);
	await expect(page.getByRole('heading', { name: 'Sent.' })).toBeVisible();
	await expect(sendAnother).toBeDisabled();
	await expect(sendAnother).toHaveText('Send another message (20s)');
});
