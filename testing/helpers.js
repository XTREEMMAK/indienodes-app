/**
 * Shared steps for the submission flows.
 *
 * Not a `*.e2e.js` file, so Playwright never collects it as a spec (see
 * `testMatch` in playwright.config.js).
 */

/**
 * Answers the site-level adult-content disclosure, which is required on
 * /join's entry step and /update's edit step (see AdultContentSection.svelte).
 * It is review-only state, held in memory, so it cannot be seeded through a
 * stored draft the way entry fields can: a test that walks past either step
 * has to answer it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'yes' | 'no'} [answer]
 */
export async function answerAdultContent(page, answer = 'no') {
	if (answer === 'yes') {
		await page.getByRole('radio', { name: 'Yes', exact: true }).check();
		await page.getByRole('checkbox', { name: /behind a clear content warning/ }).check();
		return;
	}
	await page.getByRole('radio', { name: 'No', exact: true }).check();
}
