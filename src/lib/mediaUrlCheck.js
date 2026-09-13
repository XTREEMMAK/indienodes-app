/**
 * Is a typed media URL actually an image?
 *
 * A creator with their own site pastes URLs for their pages, artworks and
 * cover. The easy mistake is copying the address bar of the page an image sits
 * on rather than the image itself — ring PR #30 went out with
 * `https://frammyjammy.com/suzu-and-jack/?pg=29#showComic` as a comic page's
 * `image_url`, where `.../img/comics/pg29.png` was meant. Every https and host
 * rule in `submissionValidation.js` passes that URL, because nothing about its
 * *shape* is wrong; only what the server sends back is.
 *
 * So the real test is a request, made by the backend (Check Media URL in
 * `scripts/n8n/build_workflows.py`): HEAD, falling back to a ranged GET, and an
 * `image/*` content type required. This module is the browser half — which
 * fields to ask about, a free first check that needs no request, and what to
 * tell the creator about each verdict. The backend runs the same check again
 * at submit and at approval, so nothing here is the gate.
 */

/**
 * @typedef {'ok' | 'html' | 'not_image' | 'redirect' | 'unreachable' | 'unsafe_url'} MediaVerdict
 * @typedef {'image' | 'preview'} MediaKind
 * @typedef {{ field: string, url: string, kind: MediaKind }} MediaUrlField
 */

/**
 * The typed media URLs this form shows for an entry's type, keyed by the
 * same field paths `validateEntry` reports under. The generator's
 * `mediaUrls` (MEDIA_URLS_JS) uses the same paths but checks every field
 * present in the payload whatever its type, since a hand-built request need
 * not respect the form.
 *
 * Tracks and excerpt audio are deliberately absent: they are audio, and this
 * check is about images (plus a game's preview, which may also be a video).
 * @param {Record<string, any>} entry
 * @returns {MediaUrlField[]}
 */
export function mediaUrlFields(entry) {
	/** @type {MediaUrlField[]} */
	const out = [];
	/**
	 * @param {string} field
	 * @param {unknown} url
	 * @param {MediaKind} kind
	 */
	const add = (field, url, kind) => {
		if (typeof url === 'string' && url.trim()) out.push({ field, url: url.trim(), kind });
	};
	const type = entry?.type;
	if (type === 'comic') {
		(entry.pages ?? []).forEach((/** @type {any} */ p, /** @type {number} */ i) =>
			add(`pages.${i}.image_url`, p?.image_url, 'image')
		);
	}
	if (type === 'art') {
		(entry.artworks ?? []).forEach((/** @type {any} */ a, /** @type {number} */ i) =>
			add(`artworks.${i}.image_url`, a?.image_url, 'image')
		);
	}
	add('thumb_url', entry?.thumb_url, 'image');
	if (type === 'game') add('preview_url', entry?.preview_url, 'preview');
	return out;
}

/**
 * The free first check, and only in one direction. A path ending in a web-page
 * extension is a web page, so there is no reason to ask the backend. The
 * reverse is never inferred: `.png` in a URL proves nothing about what the
 * server sends, so every other URL still goes to the real check.
 * @param {string} url
 * @returns {MediaVerdict | null}
 */
export function quickMediaVerdict(url) {
	const path = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(url.trim())?.[1] ?? '';
	return /\.(html?|xhtml)$/i.test(path) ? 'html' : null;
}

/**
 * What to tell a creator about a verdict. `null` for a pass, and for anything
 * this form does not recognise: an unknown verdict is the backend being newer
 * than the page, not the creator's mistake.
 * @param {string} verdict
 * @param {MediaKind} [kind]
 * @returns {string | null}
 */
export function mediaVerdictMessage(verdict, kind = 'image') {
	const what = kind === 'preview' ? 'an image or video' : 'an image';
	switch (verdict) {
		case 'html':
			return `This looks like a web page, not ${what}. Open the image itself, right-click it and choose "Copy image address", then paste that link here.`;
		case 'not_image':
			return `This link isn't served as ${what} (PNG, JPEG, WebP, GIF or AVIF). Use the direct link to the file.`;
		case 'redirect':
			return 'This link redirects somewhere else. Open it in your browser and paste the address it ends up at.';
		case 'unreachable':
			return "This link couldn't be loaded. Check that it's public and spelled correctly.";
		case 'unsafe_url':
			return 'Use a public https:// link to the file.';
		default:
			return null;
	}
}

/**
 * The finalize workflow's refusal codes, back to the verdict they came from,
 * so a refusal at submit lands on the field it is about.
 * @type {Record<string, MediaVerdict>}
 */
export const MEDIA_ERROR_VERDICTS = {
	media_web_page: 'html',
	media_not_image: 'not_image',
	media_redirect: 'redirect',
	media_unreachable: 'unreachable',
	media_unsafe_url: 'unsafe_url'
};
