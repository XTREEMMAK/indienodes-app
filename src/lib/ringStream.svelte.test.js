/**
 * Client project (real Chromium): the browser is where `loadRing` streams the
 * body instead of calling `text()` -- see `readBody` in ring.js for why the
 * prerender path does not -- so the byte cap and the body timeout on that path
 * can only be exercised here.
 */

import { describe, expect, it } from 'vitest';
import { loadRing } from './ring.js';

const entry = {
	id: 'stream-example',
	creator: 'Example',
	type: 'audio',
	why: 'because',
	source_url: 'https://example.org',
	tags: ['one'],
	verification_token: 'token'
};

const MB = 1024 * 1024;

/** @param {ReadableStream<Uint8Array>} body */
const fetchBody = (body) => /** @type {typeof fetch} */ (async () => new Response(body));

describe('loadRing in the browser', () => {
	it('reads a normal streamed body', async () => {
		const loaded = await loadRing(async () => new Response(JSON.stringify([entry])));
		expect(loaded.map((e) => e.id)).toEqual([entry.id]);
	});

	it('refuses an oversized body with no content-length while it is still arriving', async () => {
		let pulled = 0;
		// An endless stream of 1 MB chunks: only a cap applied mid-stream ends this.
		const endless = new ReadableStream({
			pull(controller) {
				pulled += 1;
				controller.enqueue(new Uint8Array(MB).fill(0x20));
			}
		});
		await expect(loadRing(fetchBody(endless))).rejects.toThrow('too large');
		expect(pulled).toBeLessThan(12);
	});

	it('falls back when the first body stalls after headers', async () => {
		const stalled = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('['));
			}
		});
		const fetchFn = /** @type {typeof fetch} */ (
			async (url) =>
				url === '/ring.json' ? new Response(JSON.stringify([entry])) : new Response(stalled)
		);
		const loaded = await loadRing(fetchFn, 'https://slow.example/ring.json', '/ring.json');
		expect(loaded.map((e) => e.id)).toEqual([entry.id]);
	}, 15_000);
});
