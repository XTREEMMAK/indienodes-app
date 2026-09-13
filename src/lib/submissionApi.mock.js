/**
 * Canned backend for the submission form, used in dev when no webhook is
 * configured (see `submissionApi.js` for when that applies, and for why a
 * *production* build with no webhook does something different instead).
 *
 * The point is not to fake a happy path. It is to make every branch of the
 * form reachable without standing up n8n, including the ones that are
 * otherwise hard to trigger on purpose: a failed verification, a rate limit,
 * a network drop. Those are selected with a `?mock=` query parameter, so
 * walking through the failure states is a URL edit rather than a code edit.
 *
 *   /join?mock=fail-verify    Verify always reports the token was not found
 *   /join?mock=unreachable    Verify reports the URL could not be fetched
 *   /join?mock=expired        Verify reports the token expired
 *   /join?mock=unsafe-url     Verify reports the URL was rejected as unsafe
 *   /join?mock=redirect       Verify reports the URL redirects
 *   /join?mock=network        Every call fails as a network error
 *   /join?mock=rate-limited   Every call fails as a 429
 *   /join?mock=slow           Responses take 6s, for testing pending states
 *   /join?mock=media-page     Every media URL check answers "a web page"
 *
 * This module is imported unconditionally by `submissionApi.js` and tree-
 * shaken out of production builds, because `useMock` is `import.meta.env.DEV`
 * ANDed with a constant, which Rollup folds to `false` and eliminates.
 */

import { WebhookError } from './submissionError.js';

/** Feels like a request without slowing down iteration. */
const LATENCY_MS = 600;

/** @returns {string} */
function mode() {
	if (typeof window === 'undefined') return '';
	return new URLSearchParams(window.location.search).get('mock') ?? '';
}

/** @param {number} ms */
function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Applies the latency and the failure modes that affect every action, so
 * each exported function below only has to describe its own success shape.
 */
async function gate() {
	await wait(mode() === 'slow' ? 6000 : LATENCY_MS);

	if (mode() === 'network') {
		throw new WebhookError('Could not reach the submission service.', {
			code: 'network',
			retryable: true
		});
	}
	if (mode() === 'rate-limited') {
		throw new WebhookError('Too many submissions from here. Try again in a few minutes.', {
			code: 'rate_limited',
			retryable: true,
			status: 429
		});
	}
}

/**
 * @param {{ source_url: string | null }} input
 */
export async function issueToken(input) {
	await gate();
	// Same shape the real workflow mints, so the instructions the form renders
	// around it are exercised at the right length.
	const random = Math.random().toString(16).slice(2, 10);
	return {
		submission_id: `mock-${Math.random().toString(36).slice(2, 10)}`,
		verification_token: `indienode-verify-${random}`,
		expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
		// Not part of the contract; only here so the dev console shows which
		// URL (or lack of one, for the site-generator branch) a real backend
		// would have bound the token to.
		_mock_source_url: input.source_url
	};
}

/** Mirrors `bind_source_url`; nothing stateful to actually attach it to here. */
export async function bindSourceUrl() {
	await gate();
	return { bound: true };
}

/**
 * The submission id is part of the real contract but unused here: the mock
 * has nothing stateful to look it up against, and which submission is being
 * checked is entirely determined by the `?mock=` mode instead.
 */
export async function verify() {
	await gate();
	if (mode() === 'fail-verify') return { verified: false, reason: 'token_not_found' };
	if (mode() === 'unreachable') return { verified: false, reason: 'unreachable' };
	if (mode() === 'expired') return { verified: false, reason: 'expired' };
	if (mode() === 'unsafe-url') return { verified: false, reason: 'unsafe_url' };
	if (mode() === 'redirect') return { verified: false, reason: 'redirect' };
	if (mode() === 'unknown-verify') return { verified: false, reason: 'unexpected_backend_reason' };
	return { verified: true };
}

/**
 * Mirrors `check_media_url`. Without a server to ask, it guesses the way the
 * real failure usually looks: a URL whose path has no file extension (a
 * reader page such as `/comic/?pg=29`) is a page, anything else an image.
 * `?mock=media-page` forces the page answer for any URL.
 * @param {{ url: string }} input
 */
export async function checkMediaUrl(input) {
	await gate();
	const path = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(input.url)?.[1] ?? '';
	const looksLikePage = mode() === 'media-page' || !/\.[a-z0-9]{2,5}$/i.test(path);
	return looksLikePage ? { accepted: false, verdict: 'html' } : { accepted: true, verdict: 'ok' };
}

/**
 * @param {Record<string, any>} input
 */
export async function submit(input) {
	await gate();
	// Logged rather than discarded: the payload's exact shape is the thing
	// most worth eyeballing while building the form, and this is the only
	// place it exists in full.
	console.info('[mock] submission payload', input);
	return { reference: `MOCK-${Math.random().toString(36).slice(2, 8).toUpperCase()}` };
}

/**
 * Mirrors `issueToken`; same `?mock=` vocabulary applies (fail-verify/unreachable
 * act on the following `verify` call, not this one).
 * @param {string} nodeId
 * @param {{ website: string, elapsed_ms: number }} [input]
 */
export async function requestUpdateToken(nodeId, input) {
	await gate();
	const random = Math.random().toString(16).slice(2, 10);
	return {
		submission_id: `mock-update-${Math.random().toString(36).slice(2, 10)}`,
		verification_token: `indienode-verify-${random}`,
		expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
		// Not part of the contract; only here so the dev console shows what a
		// real backend would have received alongside the node id.
		_mock_node_id: nodeId,
		_mock_input: input
	};
}

/**
 * Mirrors `submit`.
 * @param {Record<string, any>} input
 */
export async function submitUpdate(input) {
	await gate();
	console.info('[mock] update payload', input);
	return { reference: `MOCK-UPD-${Math.random().toString(36).slice(2, 8).toUpperCase()}` };
}

/** @param {Record<string, any>} input */
export async function requestRemoval(input) {
	await gate();
	console.info('[mock] removal payload', input);
	return { reference: `MOCK-DEL-${Math.random().toString(36).slice(2, 8).toUpperCase()}` };
}

/**
 * Mirrors `checkRateStatus`; the source URL is part of the real contract but
 * unused here, the same as `bindSourceUrl` above. `?mock=rate-limited`
 * reports a blocked bucket here too, so the identify-step note is reachable
 * without standing up n8n — as a normal resolved value, not a thrown error,
 * matching the real function's own "this never throws" contract.
 */
export async function checkRateStatus() {
	await wait(LATENCY_MS);
	if (mode() === 'rate-limited') return { blocked: true, retryAfterSeconds: 8 * 60 };
	return { blocked: false, retryAfterSeconds: null };
}
