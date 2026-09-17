/**
 * The submission form's only contact with the outside world.
 *
 * Five actions over one webhook (the original three plus `bind_source_url`
 * and the node-maintenance pair added later), discriminated by an `action`
 * field rather than split across separate URLs: one CORS configuration to
 * get right, one variable to rotate, one place for the workflow to branch.
 * See `docs/submission-form-spec.md` section 7 for the original contract,
 * and `docs/roadmap.md`'s "Node maintenance and change requests" entry for
 * why change requests extend this webhook rather than getting their own —
 * they need the exact same token-issue/re-verify contract `issue_token` and
 * `verify` already implement.
 *
 * **`verify` deliberately sends only a `submission_id`.** The backend holds
 * the token *and the `source_url` it was issued against*, and checks that
 * stored URL. If this sent the URL alongside the request, a submitter could
 * verify a page they control and then submit a different one, and the whole
 * verification step would be decorative. The same reasoning is why
 * `request_update_token` checks a node's *current* `source_url` server-side
 * rather than trusting one the client supplies.
 */

import { SUBMISSION_WEBHOOK_URL } from './config.js';
import { WebhookError } from './submissionError.js';
import { postWebhook } from './webhookClient.js';
import * as mock from './submissionApi.mock.js';

export { WebhookError };

/**
 * Whether a real backend is configured.
 *
 * Exported because the UI needs to say different things in the two unset
 * cases, and deriving that from a falsy check at each call site is how the
 * production case ends up silently behaving like the dev one.
 */
export const hasBackend = Boolean(SUBMISSION_WEBHOOK_URL);

/**
 * True when the form should run against canned responses.
 *
 * Dev with no webhook configured is the normal way to work on this form, so
 * it mocks. A **production** build with no webhook does not: it reports that
 * submissions are closed. That asymmetry is the point of this flag existing
 * rather than being inlined; a production build must never look like it is
 * accepting submissions it is dropping.
 */
export const useMock = import.meta.env.DEV && !hasBackend;

/**
 * Posts one action. Thin wrapper around the shared `postWebhook` — this
 * file's own job is just knowing which URL and which "closed" message apply
 * to *this* webhook; the fetch/timeout/error-shape handling itself lives in
 * `webhookClient.js` now, shared with Contact and node updates.
 * @param {string} action
 * @param {Record<string, unknown>} payload
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<Record<string, any>>}
 */
async function post(action, payload, options) {
	if (!hasBackend) {
		throw new WebhookError('Submissions are closed right now.', { code: 'no_backend' });
	}
	return postWebhook(SUBMISSION_WEBHOOK_URL, { action, ...payload }, options);
}

/**
 * Step one: commit to a `source_url` (or, for a creator with no site yet,
 * commit only to a `type` and get a token before one exists at all) and
 * receive a token to place.
 *
 * **`source_url: null` is the site-generator branch's whole reason for
 * existing as a separate case.** The generator's own token has to be baked
 * into the exported site *before* the creator uploads it anywhere
 * (`docs/submission-form-spec.md` section 4's six-step sequence), which
 * means there is no URL yet at the point the token is issued. `bindSourceUrl`
 * below is the second half of that: once the creator has somewhere to point
 * `source_url` at, it gets attached to this same `submission_id` rather than
 * re-running `issueToken`, which would mint a second, unrelated token.
 *
 * The honeypot and dwell values ride along from the first call onward so the
 * backend can drop an obvious bot before it ever allocates a token.
 * @param {{ source_url: string | null, type: string, website: string, elapsed_ms: number }} input
 * @returns {Promise<{ submission_id: string, verification_token: string, expires_at: string }>}
 */
export async function issueToken(input) {
	if (useMock) return mock.issueToken(input);
	const body = await post('issue_token', input);
	return {
		submission_id: body.submission_id,
		verification_token: body.verification_token,
		expires_at: body.expires_at
	};
}

/**
 * Attaches a `source_url` to a submission whose token was issued without
 * one (the site-generator branch). A separate action from `issue_token`
 * rather than allowing a second call with a URL this time, so the backend
 * can enforce "accepted once" server-side — see this file's own top
 * comment on why `verify` trusting a client-supplied URL would make
 * verification decorative; letting `issue_token` be called twice for one
 * submission would reopen exactly that hole through a side door.
 * @param {string} submissionId
 * @param {string} sourceUrl
 * @returns {Promise<{ bound: boolean }>}
 */
export async function bindSourceUrl(submissionId, sourceUrl) {
	if (useMock) return mock.bindSourceUrl();
	const body = await post('bind_source_url', {
		submission_id: submissionId,
		source_url: sourceUrl
	});
	return { bound: body.bound !== false };
}

/**
 * Step two: ask the backend to go and look for the token.
 *
 * Resolves with `verified: false` rather than throwing when the token simply
 * is not there yet. That is the expected case, not an error: the submitter is
 * still on the page and pressing Verify again is the whole retry story.
 * Throwing is reserved for not getting an answer at all.
 * @param {string} submissionId
 * @returns {Promise<{ verified: boolean, reason?: string }>}
 */
export async function verify(submissionId) {
	if (useMock) return mock.verify();
	const body = await post('verify', { submission_id: submissionId });
	return { verified: body.verified === true, reason: body.reason };
}

/**
 * Step three: hand over the entry and the review-only block.
 *
 * The caller builds `entry` with `toRingEntry`, which names its fields rather
 * than spreading form state, so nothing from `review` can reach the public
 * half by accident.
 *
 * **Never retried automatically.** A submit that times out may well have
 * succeeded, and a silent retry would create a second pending submission for
 * the same person. Retrying is offered to the submitter as a button, which
 * keeps the choice with the one party who knows whether they got a
 * confirmation.
 * `requested_id` is the id the form has been displaying, which a generated
 * site already carries in its footer embed. Advisory: approval keeps it when
 * nothing has claimed it and derives one otherwise. It rides beside `entry`
 * rather than inside it because `toRingEntry` output is schema-validated with
 * `additionalProperties: false`.
 * @param {{ submission_id: string, requested_id?: string, entry: Record<string, any>, review: Record<string, any>, website: string, elapsed_ms: number }} input
 * @returns {Promise<{ reference: string }>}
 */
export async function submit(input) {
	if (useMock) return mock.submit(input);
	const body = await post('submit', input, { timeoutMs: SUBMIT_TIMEOUT_MS });
	return { reference: body.reference };
}

/**
 * Longer than the shared 15s. Finalize now fetches the headers of every image
 * URL in the entry (up to four for a comic) before it re-verifies the page, and
 * a slow creator host can use most of the default on its own. A timeout here is
 * the worst outcome in this file — see `submit` on why it is never retried — so
 * it gets the room.
 */
const SUBMIT_TIMEOUT_MS = 45000;

/**
 * Asks the backend whether a typed media URL is really an image: a HEAD (or
 * ranged GET) from the server, with an `image/*` content type required — see
 * `mediaUrlCheck.js` for why the URL's own shape cannot answer that.
 *
 * Carries the honeypot and dwell fields like every form-entry action: it makes
 * an outbound request on a stranger's behalf, so an obvious bot is dropped
 * before it can. The answer is a verdict word and nothing more.
 * @param {{ url: string, kind: 'image' | 'preview', website: string, elapsed_ms: number }} input
 * @returns {Promise<{ accepted: boolean, verdict: string }>}
 */
export async function checkMediaUrl(input) {
	if (useMock) return mock.checkMediaUrl(input);
	const body = await post('check_media_url', input);
	return { accepted: body.accepted === true, verdict: String(body.verdict ?? '') };
}

/**
 * Node maintenance / change requests (Creator Nodes addendum, Section C;
 * `docs/roadmap.md`'s "Node maintenance and change requests"). Not a new
 * submission: keyed to a node id that already exists in the ring, and
 * re-verified the same way a first submission is, against the node's
 * *current* `source_url` rather than a client-supplied one.
 */

/**
 * Step one of a change request: get a token to place, tied to an existing
 * node rather than a brand-new one. The backend looks up `node_id`'s current
 * `source_url` itself; nothing about *which* URL to check ever comes from
 * this call, for the same reason `verify` below never takes one.
 * @param {string} nodeId
 * @param {{ website: string, elapsed_ms: number }} input
 * @returns {Promise<{ submission_id: string, verification_token: string, expires_at: string }>}
 */
export async function requestUpdateToken(nodeId, input) {
	if (useMock) return mock.requestUpdateToken(nodeId, input);
	const body = await post('request_update_token', { node_id: nodeId, ...input });
	return {
		submission_id: body.submission_id,
		verification_token: body.verification_token,
		expires_at: body.expires_at
	};
}

/**
 * Step three of a change request: hand over the corrected entry. `entry` is
 * the *whole* corrected ring.json-shaped object (built with the same
 * `toRingEntry` a first submission uses), not a partial diff — simpler for
 * the backend to validate against the schema, and it means "replacing a
 * dead media_url" needs no special casing anywhere in this contract.
 *
 * `turnstile_token` is optional because `Turnstile.svelte` renders nothing
 * (and so never produces one) when `TURNSTILE_SITE_KEY` is unset — see its
 * own doc comment. This is the one action here Turnstile actually guards:
 * `issue_token`/`verify` stay exactly as `/join` already left them.
 *
 * `review` carries the same content-rule attestations a new submission does
 * (see `validateAttestations` in submissionValidation.js), so changing a
 * Node's featured works cannot skip them. Email stays top-level.
 * @param {{ submission_id: string, node_id: string, entry: Record<string, any>, email: string, review: { ai_attestation: boolean, rights_confirmation: boolean, adult_content: string, adult_content_confirmation: boolean }, website: string, elapsed_ms: number, turnstile_token?: string }} input
 * @returns {Promise<{ reference: string }>}
 */
export async function submitUpdate(input) {
	if (useMock) return mock.submitUpdate(input);
	const body = await post('submit_update', input);
	return { reference: body.reference };
}

/**
 * Whether a fresh request for `sourceUrl` would be rate-limited right now —
 * asked from `/update`'s identify step, as soon as a node is found, so a
 * visitor learns this before investing five minutes in the form and a
 * Turnstile challenge only to be told to come back later at the very end.
 *
 * **Never throws.** Everywhere else in this file, a failure to reach the
 * backend is a real error the caller must surface — here it means only that
 * this advisory note cannot be shown, not that anything is actually wrong.
 * The rate limit itself is still enforced, with full context (a retried
 * notification, a voluntary removal) that this pre-check does not have,
 * server-side at actual submit time; this is a courtesy, not the gate. See
 * `updateStore.svelte.js`'s own note on why the identify step's lookup is
 * not a security boundary either.
 * @param {string} sourceUrl
 * @returns {Promise<{ blocked: boolean, retryAfterSeconds: number | null }>}
 */
export async function checkRateStatus(sourceUrl) {
	if (useMock) return mock.checkRateStatus();
	if (!hasBackend) return { blocked: false, retryAfterSeconds: null };
	try {
		const body = await post('rate_status', { source_url: sourceUrl });
		return { blocked: body.blocked === true, retryAfterSeconds: body.retry_after_seconds ?? null };
	} catch {
		return { blocked: false, retryAfterSeconds: null };
	}
}

/**
 * Removes a node from the ring at its creator's own request.
 *
 * The same contract as a change request, with nothing to change: identify,
 * prove control of the page the node points at, then act. That reuse is the
 * point — the `<meta>` tag that proves someone may *edit* an entry proves
 * equally well that they may *withdraw* it, so leaving needs no mechanism of
 * its own and, in particular, no stored contact address to write to.
 *
 * `reason` is optional and free text, offered rather than required: someone
 * withdrawing their own work owes no explanation, and a required field would
 * imply otherwise. It exists because a maintainer seeing "the project ended"
 * versus nothing at all is occasionally useful, never because the answer
 * gates anything.
 *
 * @param {{ submission_id: string, node_id: string, reason?: string, website: string, elapsed_ms: number, turnstile_token?: string }} input
 * @returns {Promise<{ reference: string }>}
 */
export async function requestRemoval(input) {
	if (useMock) return mock.requestRemoval(input);
	const body = await post('request_removal', input);
	return { reference: body.reference };
}
