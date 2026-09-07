import changelogRaw from '../../CHANGELOG.md?raw';

/**
 * Release history for the About modal, parsed from `CHANGELOG.md`.
 *
 * **Server-side deliberately.** This was a universal `+layout.js` load, which
 * meant the `?raw` import put the *entire* changelog into the client bundle:
 * 22 KB, 9.4 KB gzipped, shipped to every visitor so the About modal could
 * render about 45 bytes of version numbers, and growing with every release.
 * A server load never reaches the browser; only its return value does, and
 * that is the parsed list.
 *
 * This is prerendered like everything else, so "server" here means build
 * time. Nothing runs per request and no backend appears.
 *
 * The same reasoning kept ring data *out* of the layout load entirely (see
 * `$lib/ringStore.svelte.js`), but the two cases differ in the right way:
 * the ring is large, changes independently of deploys, and is wanted live,
 * so it is fetched. Releases are tiny and change only when the code does, so
 * baking them in costs nothing and saves a fetch.
 */

const HEADING = /^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\] - (\d{4}-\d{2}-\d{2})$/gm;

/**
 * Reads `## [X.Y.Z] - YYYY-MM-DD` headings only (a trailing `-rc.N`-style
 * prerelease identifier is also matched, since a gated build carries one);
 * body content stays out of scope. Newest-first order is inherited from the
 * file itself (Keep a Changelog convention, which every entry so far
 * follows), not re-sorted.
 * @param {string} markdown
 */
function parseReleases(markdown) {
	return [...markdown.matchAll(HEADING)].map(([, version, date]) => ({
		version,
		date,
		// GitHub's own heading-anchor slugifier: lowercase (already true
		// here), strip punctuation the brackets and periods are the only
		// punctuation a version heading has, spaces and the separating dash
		// collapse to hyphens. Verified against the live rendering rather
		// than derived blind: `## [1.4.0] - 2026-07-29` anchors at
		// `#140---2026-07-29`, not the more guessable `#1-4-0---...`; a
		// prerelease identifier's own periods (`1.5.0-rc.1`) strip the same
		// way, landing on `#150-rc1---2026-09-07`.
		anchor: `${version.replace(/\./g, '')}---${date}`
	}));
}

export function load() {
	return { releases: parseReleases(changelogRaw) };
}
