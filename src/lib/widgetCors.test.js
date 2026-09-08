import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RING_JSON_URL } from './config.js';

/**
 * The widget has to work on somebody else's site, which is the only place it
 * is ever meant to run.
 *
 * Two requests leave a member's page for this origin: `embed.v1.js`, and the
 * `ring.json` the widget fetches once it runs. Both are cross-origin from
 * where they are used, and both need `Access-Control-Allow-Origin`.
 *
 * The script is the surprising half. It is a `type="module"` script, and
 * module scripts are *always* fetched in CORS mode — a classic script is
 * `no-cors` and would have loaded cross-origin with no header at all. So the
 * failure has no symptom worth noticing: the script silently never executes,
 * `<indienode-widget>` stays an unknown element, and the member sees a blank
 * space with nothing in their console pointing here. The badge and text tiers
 * are an `<img>` and an `<a>`, which need no CORS, so they keep working — a
 * full widget missing while the lighter tiers render is the signature of this
 * exact bug.
 *
 * Caddy serves these headers and the tests cannot reach Caddy, so this asserts
 * the configuration instead. Verified against the real thing once, by running
 * `caddy:2-alpine` with this file and loading the widget from a second origin.
 */
const caddyfile = readFileSync(fileURLToPath(new URL('../../Caddyfile', import.meta.url)), 'utf8');

/** The matcher line and the header line that applies it. */
const matcher = caddyfile.match(/^\s*@(\w+)\s+path\s+(.+)$/m);
const headerLine = caddyfile.match(
	/^\s*header\s+@(\w+)\s+Access-Control-Allow-Origin\s+"(.+)"\s*$/m
);

describe('the embeddable assets are reachable cross-origin', () => {
	it('declares a path matcher and applies the CORS header to it', () => {
		expect(matcher, 'no `@name path ...` matcher found in the Caddyfile').not.toBeNull();
		expect(headerLine, 'no Access-Control-Allow-Origin header directive found').not.toBeNull();
		// The header must apply to the matcher that names these paths, not to
		// some other one that happens to exist.
		expect(headerLine?.[1]).toBe(matcher?.[1]);
		expect(headerLine?.[2]).toBe('*');
	});

	it.each(['/embed.js', '/embed.v1.js', '/ring.json'])('covers %s', (path) => {
		expect(matcher?.[2].split(/\s+/)).toContain(path);
	});

	// If the ring ever moves, the matcher above has to move with it, and
	// nothing else in the build would notice.
	it('covers whatever path the widget actually fetches the ring from', () => {
		const path = new URL(RING_JSON_URL).pathname;
		expect(matcher?.[2].split(/\s+/)).toContain(path);
	});
});

/**
 * The same failure class one layer down: /embed-frame's opaque (`null`)
 * origin -- deliberate, from its `sandbox="allow-scripts ..."` with no
 * `allow-same-origin` -- makes the browser fetch its own SvelteKit hydration
 * chunks under /_app/immutable/* in CORS mode, same as any other cross-origin
 * module script. Missing this header here left the iframe-tier widget dead on
 * every site (including this app's own /widget preview), with the exact
 * console signature this fix addresses: "Access to script at
 * '.../_app/immutable/...' from origin 'null' has been blocked by CORS
 * policy". Asserted the same way as the block above, against a separate
 * matcher, since @immutable is a distinct `@name path ...` line.
 */
describe('the sandboxed embed-frame iframe can fetch its own build assets', () => {
	const immutableMatcher = [...caddyfile.matchAll(/^\s*@(\w+)\s+path\s+(.+)$/gm)].find(
		([, , paths]) => paths.split(/\s+/).includes('/_app/immutable/*')
	);

	it('declares a matcher for /_app/immutable/*', () => {
		expect(immutableMatcher, 'no `@name path ...` matcher covers /_app/immutable/*').not.toBeNull();
	});

	it('applies Access-Control-Allow-Origin "*" to that matcher', () => {
		const name = immutableMatcher?.[1];
		const header = caddyfile.match(
			new RegExp(`^\\s*header\\s+@${name}\\s+Access-Control-Allow-Origin\\s+"(.+)"\\s*$`, 'm')
		);
		expect(header, `no Access-Control-Allow-Origin header applied to @${name}`).not.toBeNull();
		expect(header?.[1]).toBe('*');
	});
});

/**
 * The same failure class one layer down, in CSP rather than CORS.
 *
 * `/embed-frame` (the default, recommended widget tier) carries its own
 * deliberately tight `Content-Security-Policy`, separate from the site-wide
 * one. Its `connect-src` has to name whatever origin the widget actually
 * fetches the ring from, and that origin is `VITE_RING_URL` — a build-time
 * value this deployment does set, to a different host.
 *
 * It shipped as `connect-src 'self'` alone, and the symptom was almost
 * nothing: `loadRing` catches the blocked fetch and falls back to this
 * origin's committed mirror, so the widget kept working while quietly
 * serving five-minute-cached data instead of the canonical endpoint, with
 * one console violation per load. Exactly the "silently wrong rather than
 * visibly broken" shape the CORS block above exists to prevent.
 *
 * `testing/csp.e2e.js` applies the real header in a real browser, which is
 * strictly better — but it cannot catch this one, because the e2e build
 * configures no `VITE_RING_URL` and so never makes the cross-origin fetch
 * that would violate the policy. This asserts the configuration instead.
 *
 * Derived from the file rather than hardcoded: the site-wide policy is
 * already the list of origins this app is allowed to reach, so the rule is
 * "whatever that one permits for the ring, the frame permits too" and the
 * ring moving cannot re-break this without also failing here.
 */
const cspDeclarations = [...caddyfile.matchAll(/Content-Security-Policy "([^"]+)"/g)].map(
	(m) => m[1]
);

/** @param {string} policy */
function connectSrc(policy) {
	const directive = policy.split(';').find((part) => part.trim().startsWith('connect-src'));
	return (directive ?? '').trim().split(/\s+/).slice(1);
}

describe("the embed-frame CSP lets the widget reach the ring it's built against", () => {
	it('declares exactly the two policies this test knows how to read', () => {
		// The site-wide baseline first, then /embed-frame's override, in file
		// order -- same assumption testing/csp.e2e.js makes. If a third policy
		// is ever added, both need updating together.
		expect(cspDeclarations).toHaveLength(2);
	});

	it('permits every ring origin the site-wide policy permits', () => {
		const [siteWide, embedFrame] = cspDeclarations;
		const ringOrigins = connectSrc(siteWide).filter((source) => source.includes('ring.'));

		// Guards the guard: if the site-wide policy stops naming a ring origin
		// this assertion silently passes against an empty list.
		expect(ringOrigins.length).toBeGreaterThan(0);

		for (const origin of ringOrigins) {
			expect(connectSrc(embedFrame)).toContain(origin);
		}
	});
});
