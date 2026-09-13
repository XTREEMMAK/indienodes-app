/**
 * The one thing every local webhook-backed form (submission, contact, node
 * update) actually shares: POST JSON, wait a bounded time, come back with
 * either a parsed body or a normalized `WebhookError`. Extracted out of
 * `submissionApi.js`'s own `post()` once a second and third caller needed
 * the identical fetch/timeout/error-shape handling — copy-pasting it would
 * have meant three places that could quietly drift on exactly the part
 * (timeout handling, what counts as a failure) that most wants to stay
 * identical.
 *
 * Deliberately does **not** own the `hasBackend`/`useMock` gate. Each
 * webhook (submission, contact, update) is independently configured and can
 * legitimately be on while another is off — a maintainer pausing intake
 * without also silencing Contact, for instance — so that gate stays a
 * decision each caller makes for itself before ever reaching this function.
 */

import { WebhookError } from './submissionError.js';

/**
 * A non-JSON body is treated as a failure even on a 2xx, because the most
 * likely source of one is an intermediary (a proxy error page, a CORS
 * rejection rendered as HTML) rather than the backend, and parsing it as
 * success would produce an undefined-shaped object the caller then trusts.
 * @param {string} url
 * @param {Record<string, unknown>} body
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<Record<string, any>>}
 */
export async function postWebhook(url, body, { timeoutMs = 15000 } = {}) {
	let response;
	try {
		response = await fetch(url, {
			method: 'POST',
			// Kept as application/json so this is always a preflighted request
			// rather than a "simple" one. The backend has to answer OPTIONS
			// either way for the JSON response to be readable cross-origin, and
			// a consistent preflight is easier to configure than two paths.
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch (error) {
		// Network failure, CORS rejection, and timeout all land here, and the
		// browser deliberately does not distinguish CORS from offline.
		const timedOut = error instanceof Error && error.name === 'TimeoutError';
		throw new WebhookError(
			timedOut ? 'That took too long to answer.' : 'Could not reach the service.',
			{ code: timedOut ? 'timeout' : 'network', retryable: true }
		);
	}

	/** @type {Record<string, any> | null} */
	let parsed;
	try {
		parsed = await response.json();
	} catch {
		parsed = null;
	}

	if (!response.ok || !parsed || parsed.ok === false) {
		const error = parsed?.error ?? {};
		throw new WebhookError(error.message ?? 'The service returned an error.', {
			code: error.code ?? `http_${response.status}`,
			// 5xx and 429 are worth retrying; a 400 means the payload is wrong
			// and retrying it unchanged will fail identically.
			retryable: error.retryable ?? (response.status >= 500 || response.status === 429),
			status: response.status,
			field: typeof error.field === 'string' ? error.field : ''
		});
	}

	return parsed;
}
