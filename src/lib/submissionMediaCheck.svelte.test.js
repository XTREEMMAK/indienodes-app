import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from './storageKeys.js';
import { WebhookError } from './submissionError.js';

/**
 * The /join form's image check on typed media URLs.
 *
 * Ring PR #30 carried `https://frammyjammy.com/suzu-and-jack/?pg=29#showComic`
 * as a comic page's image_url: a reader page, not the image on it. These pin
 * what the form does with the backend's answer for exactly that URL and for
 * the image it should have been. The backend request itself (HEAD, ranged GET,
 * content type) is exercised against real HTTP responses in
 * `scripts/n8n/test_code_nodes.mjs`.
 */

const PAGE_URL = 'https://frammyjammy.com/suzu-and-jack/?pg=29#showComic';
const IMAGE_URL = 'https://frammyjammy.com/suzu-and-jack/img/comics/pg29.png';

const api = vi.hoisted(() => ({
	checkMediaUrl: vi.fn(),
	submit: vi.fn(),
	issueToken: vi.fn(),
	verify: vi.fn(),
	bindSourceUrl: vi.fn()
}));
vi.mock('./submissionApi.js', () => api);

const { createSubmissionStore, MEDIA_CHECK_DEBOUNCE_MS } =
	await import('./submissionStore.svelte.js');

const KEY = STORAGE_KEYS.submissionDraft.key;

/**
 * An own-site comic draft whose only page is `url`.
 * @param {string} url
 */
function comicStore(url) {
	localStorage.clear();
	localStorage.setItem(
		KEY,
		JSON.stringify({
			creator: 'Nori Jammy',
			type: 'comic',
			why: 'Horror cartoonist, musician, and writer from Appalachia.',
			has_own_site: 'yes',
			source_url: 'https://frammyjammy.com/suzu-and-jack/',
			tags: ['horror'],
			pages: [{ image_url: url, caption: 'One Panels' }]
		})
	);
	return createSubmissionStore();
}

/**
 * The backend's answer: the page image is an image, anything else a web page.
 * A named function, not an inline arrow with a cast parameter -- Svelte's
 * compiler emits invalid syntax for that idiom in `.svelte.js` files (see
 * `rekeyed` in submissionStore.svelte.js).
 * @param {{ url: string }} input
 */
async function answerFor(input) {
	return input.url === IMAGE_URL
		? { accepted: true, verdict: 'ok' }
		: { accepted: false, verdict: 'html' };
}

/** Lets the debounce fire and every in-flight check settle. */
async function settle() {
	await vi.advanceTimersByTimeAsync(MEDIA_CHECK_DEBOUNCE_MS + 10);
}

beforeEach(() => {
	vi.useFakeTimers();
	api.checkMediaUrl.mockImplementation(answerFor);
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
	localStorage.clear();
});

describe('a page URL typed where an image belongs', () => {
	it('is refused with a web-page message that says how to fix it', async () => {
		const store = comicStore(PAGE_URL);
		store.scheduleMediaChecks();
		await settle();

		expect(api.checkMediaUrl).toHaveBeenCalledWith(
			expect.objectContaining({ url: PAGE_URL, kind: 'image' })
		);
		const message = store.entryErrors['pages.0.image_url'];
		expect(message).toMatch(/looks like a web page, not an image/);
		expect(message).toContain('right-click');
		expect(message).toContain('"Copy image address"');
		expect(store.isStepComplete('media')).toBe(false);
	});

	it('clears once the image address is pasted in its place', async () => {
		const store = comicStore(PAGE_URL);
		store.scheduleMediaChecks();
		await settle();
		expect(store.isStepComplete('media')).toBe(false);

		store.entry.pages[0].image_url = IMAGE_URL;
		// Changed but not yet checked: still held.
		expect(store.isStepComplete('media')).toBe(false);
		store.scheduleMediaChecks();
		await settle();

		expect(store.entryErrors['pages.0.image_url']).toBeUndefined();
		expect(store.isStepComplete('media')).toBe(true);
	});

	it('refuses a .html path without asking the backend', async () => {
		const store = comicStore('https://frammyjammy.com/suzu-and-jack/page-29.html');
		await store.runMediaChecks();

		expect(api.checkMediaUrl).not.toHaveBeenCalled();
		expect(store.entryErrors['pages.0.image_url']).toMatch(/web page/);
	});
});

describe('a real image URL', () => {
	it('is accepted and lets the step continue', async () => {
		const store = comicStore(IMAGE_URL);
		expect(store.isStepComplete('media')).toBe(false);
		store.scheduleMediaChecks();
		expect(store.mediaCheckPending('pages.0.image_url')).toBe(false);
		await vi.advanceTimersByTimeAsync(MEDIA_CHECK_DEBOUNCE_MS + 10);

		expect(store.entryErrors['pages.0.image_url']).toBeUndefined();
		expect(store.isStepComplete('media')).toBe(true);
	});

	it('is still checked: an image extension is never taken on trust', async () => {
		const store = comicStore('https://example.com/looks-like-an-image.png');
		await store.runMediaChecks();

		expect(api.checkMediaUrl).toHaveBeenCalledOnce();
		expect(store.entryErrors['pages.0.image_url']).toMatch(/web page/);
	});

	it('is asked about once, not again on every schedule', async () => {
		const store = comicStore(IMAGE_URL);
		await store.runMediaChecks();
		store.scheduleMediaChecks();
		await settle();

		expect(api.checkMediaUrl).toHaveBeenCalledOnce();
	});
});

describe('when the check itself cannot answer', () => {
	it('does not block the form: finalize checks again regardless', async () => {
		api.checkMediaUrl.mockRejectedValue(
			new WebhookError('Could not reach the service.', { code: 'network', retryable: true })
		);
		const store = comicStore(PAGE_URL);
		await store.runMediaChecks();

		expect(store.entryErrors['pages.0.image_url']).toBeUndefined();
		expect(store.isStepComplete('media')).toBe(true);
	});

	it('holds Continue while a check is in flight', async () => {
		/** @type {(v: unknown) => void} */
		let answer = () => {};
		api.checkMediaUrl.mockReturnValue(new Promise((resolve) => (answer = resolve)));
		const store = comicStore(IMAGE_URL);
		const checked = store.runMediaChecks();

		expect(store.mediaCheckPending('pages.0.image_url')).toBe(true);
		expect(store.isStepComplete('media')).toBe(false);
		answer({ accepted: true, verdict: 'ok' });
		await checked;
		expect(store.isStepComplete('media')).toBe(true);
	});
});

describe('the generated-site branch', () => {
	it('is not checked from the form: its URLs come from its own export', async () => {
		localStorage.setItem(
			KEY,
			JSON.stringify({ type: 'comic', has_own_site: 'no', pages: [{ image_url: PAGE_URL }] })
		);
		const store = createSubmissionStore();
		await store.runMediaChecks();

		expect(api.checkMediaUrl).not.toHaveBeenCalled();
	});
});

describe('a refusal at submit', () => {
	it('lands on the field it names, so the media step shows why', async () => {
		const store = comicStore(IMAGE_URL);
		await store.runMediaChecks();
		api.issueToken.mockResolvedValue({
			submission_id: 's1',
			verification_token: 'tok',
			expires_at: new Date(Date.now() + 3600e3).toISOString()
		});
		api.verify.mockResolvedValue({ verified: true });
		await store.requestToken();
		await store.runVerify();
		// The page was replaced with a reader page after the form checked it:
		// finalize's own check is what catches that.
		api.submit.mockRejectedValue(
			new WebhookError('Page 1 image looks like a web page, not an image.', {
				code: 'media_web_page',
				field: 'pages.0.image_url'
			})
		);

		await store.send();

		expect(store.error?.code).toBe('media_web_page');
		expect(store.entryErrors['pages.0.image_url']).toMatch(/Copy image address/);
		expect(store.isStepComplete('media')).toBe(false);
	});
});
