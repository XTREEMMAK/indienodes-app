/**
 * The "Follow in YipDen" destination for one member, or null when there is
 * nothing safe to link to.
 *
 * Pure and taking the base URL as an argument, rather than importing
 * `YIPDEN_URL` from `config.js` itself: that constant is baked in at build
 * time, so a function that read it directly could only be tested by
 * rebuilding, and every caller would need its own guard for the unset case.
 * Here the unset case is just `null`, which is what the caller renders
 * nothing for.
 *
 * Built with `URL` rather than string concatenation so a member's
 * `source_url` is always encoded as exactly one query value and can never
 * smuggle in a parameter (or a fragment) of its own.
 *
 * @param {string} baseUrl A deployment's `YIPDEN_URL`; empty when unset.
 * @param {string} sourceUrl The member's own site.
 * @returns {string | null}
 */
export function yipdenFollowUrl(baseUrl, sourceUrl) {
	if (!baseUrl || !sourceUrl) return null;
	try {
		const url = new URL(baseUrl);
		// A base URL on anything but https is a deployment mistake (or worse),
		// and this link opens in a new tab on the visitor's behalf.
		if (url.protocol !== 'https:') return null;
		url.searchParams.set('follow', sourceUrl);
		return url.toString();
	} catch {
		// A malformed VITE_YIPDEN_URL must not break the page it is shown on;
		// the link simply does not render.
		return null;
	}
}
