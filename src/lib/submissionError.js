/**
 * The error type for every local webhook-backed form (submission, contact,
 * node update), in its own module so `webhookClient.js` and each form's own
 * `*Api.js`/`*Api.mock.js` pair can all throw and catch it without
 * importing each other.
 *
 * A mock has to raise errors indistinguishable from the real client's, or
 * the failure branches it exists to exercise would be testing different code
 * than production runs. Since the real client is what imports the mock, the
 * shared type cannot live in either of them without a cycle.
 *
 * Named for what it is (any of these webhooks failing), not for the first
 * form that needed it — it started as `SubmissionError` when `/join` was the
 * only caller and was renamed once Contact and node updates needed the
 * identical shape.
 */
export class WebhookError extends Error {
	/**
	 * @param {string} message Shown to the visitor as-is, so it is written
	 *   for them rather than for a log.
	 * @param {{ code?: string, retryable?: boolean, status?: number, field?: string }} [meta]
	 */
	constructor(message, meta = {}) {
		super(message);
		this.name = 'WebhookError';
		/** Machine-readable, for branching. */
		this.code = meta.code ?? 'unknown';
		/** Whether offering a retry button is honest. */
		this.retryable = meta.retryable ?? false;
		/** 0 when the request never got a response at all. */
		this.status = meta.status ?? 0;
		/** The entry field a refusal is about (`pages.0.image_url`), when the backend names one. */
		this.field = meta.field ?? '';
	}
}
