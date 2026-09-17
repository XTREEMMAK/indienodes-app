import { describe, expect, it, vi } from 'vitest';
import { loadRing, ringEntries } from './ring.js';

/**
 * The ring document's shape is a public contract, and the reader is the half
 * of it this repo controls.
 *
 * `ring.json` was a bare top-level array for this project's whole life. Every
 * `embed.v1.js` already pasted onto a member's site fetches it and calls
 * `.map` on the result, and that file is regenerated on every build rather
 * than frozen -- so the reader can change ahead of the data, but never behind
 * it. These tests are what keep the bare-array path alive after the envelope
 * becomes the thing actually published.
 *
 * The `loadRing` block below also covers hardening added once `RING_ENDPOINT_URL`
 * (see `lib/config.js`) could point this app at a host this codebase does not
 * operate: a size ceiling, a fetch timeout, a content-type check, and
 * per-entry runtime validation that drops what does not look safe to render
 * rather than trusting a remote response fully because it parsed as JSON.
 */

/** A minimal valid entry; the fields under test are structural, not content. */
const entry = {
	id: 'audio-example',
	creator: 'Example',
	type: 'audio',
	why: 'because',
	source_url: 'https://example.org',
	tags: ['one'],
	verification_token: 'token'
};

/**
 * A minimal `Response` stand-in, cast to `typeof fetch` rather than typed
 * exactly: `loadRing` only ever reads `.ok`, `.status`, `.headers.get`, and
 * `.text()` on what it gets back, and a full `Response` mock would test
 * nothing this suite cares about.
 * @param {unknown} body
 * @param {{ ok?: boolean, status?: number, contentType?: string, contentLength?: string }} [options]
 * @returns {typeof fetch}
 */
function respondWith(
	body,
	{ ok = true, status = 200, contentType = 'application/json', contentLength } = {}
) {
	const text = typeof body === 'string' ? body : JSON.stringify(body);
	return /** @type {typeof fetch} */ (
		/** @type {unknown} */ (
			async () => ({
				ok,
				status,
				headers: {
					get: (/** @type {string} */ name) => {
						if (name === 'content-type') return contentType;
						if (name === 'content-length') return contentLength ?? String(text.length);
						return null;
					}
				},
				text: async () => text
			})
		)
	);
}

describe('ringEntries reads either document shape', () => {
	it('reads a bare array, which is what pasted widgets still fetch', () => {
		expect(ringEntries([entry])).toEqual([entry]);
	});

	it('reads a versioned envelope', () => {
		expect(ringEntries({ version: 1, entries: [entry] })).toEqual([entry]);
	});

	it('reads an envelope whose version it does not recognize', () => {
		// Deliberate: refusing data we would probably have understood is worse
		// than rendering what we recognize. Refusing outright is what a future
		// embed.v2.js is for, not what this function is for.
		expect(ringEntries({ version: 99, entries: [entry] })).toEqual([entry]);
	});

	it('treats a document with no usable entries as an empty ring', () => {
		for (const document of [null, undefined, {}, { entries: 'nope' }, 42, 'ring']) {
			expect(ringEntries(document)).toEqual([]);
		}
	});
});

describe('loadRing', () => {
	it('normalizes entries from both shapes identically', async () => {
		const fromArray = await loadRing(respondWith([entry]));
		const fromEnvelope = await loadRing(respondWith({ version: 1, entries: [entry] }));
		expect(fromArray).toEqual(fromEnvelope);
	});

	it('fills optional collections so callers can iterate without guarding', async () => {
		const [loaded] = await loadRing(respondWith([entry]));
		expect(loaded).toMatchObject({ tracks: [], pages: [], artworks: [], excerpts: [] });
	});

	it('throws on a failed response when no fallback was named', async () => {
		await expect(loadRing(respondWith([], { ok: false, status: 503 }))).rejects.toThrow('503');
	});

	it('falls back to the second source when the first fails', async () => {
		/** @type {string[]} */
		const requested = [];
		const fetchFn = /** @type {typeof fetch} */ (
			async (url) => {
				requested.push(String(url));
				if (url === 'https://data.example/ring.json') return { ok: false, status: 500 };
				return respondWith([entry])(url);
			}
		);

		const loaded = await loadRing(fetchFn, 'https://data.example/ring.json', '/ring.json');
		expect(requested).toEqual(['https://data.example/ring.json', '/ring.json']);
		expect(loaded).toHaveLength(1);
	});

	it('does not retry when the fallback is the URL that just failed', async () => {
		let calls = 0;
		const fetchFn = /** @type {typeof fetch} */ (
			/** @type {unknown} */ (
				async () => {
					calls++;
					return { ok: false, status: 500 };
				}
			)
		);

		await expect(loadRing(fetchFn, '/ring.json', '/ring.json')).rejects.toThrow('500');
		expect(calls).toBe(1);
	});

	it('rejects a response over the size ceiling, by declared content-length', async () => {
		await expect(
			loadRing(respondWith([entry], { contentLength: String(9 * 1024 * 1024) }))
		).rejects.toThrow('too large');
	});

	it('rejects a response over the size ceiling even with no content-length header', async () => {
		const hugeEntry = { ...entry, why: 'x'.repeat(9 * 1024 * 1024) };
		await expect(loadRing(respondWith([hugeEntry], { contentLength: undefined }))).rejects.toThrow(
			'too large'
		);
	});

	it('times out a body that stalls after headers, and then tries the fallback', async () => {
		vi.useFakeTimers();
		try {
			/** @type {string[]} */
			const requested = [];
			const fetchFn = /** @type {typeof fetch} */ (
				/** @type {unknown} */ (
					async (/** @type {string} */ url) => {
						requested.push(url);
						if (url === '/ring.json') return respondWith([entry])(url);
						// Headers arrive; the body never does.
						return {
							ok: true,
							status: 200,
							headers: { get: () => null },
							text: () => new Promise(() => {})
						};
					}
				)
			);

			const loading = loadRing(fetchFn, 'https://slow.example/ring.json', '/ring.json');
			await vi.advanceTimersByTimeAsync(10_001);
			const loaded = await loading;
			expect(requested).toEqual(['https://slow.example/ring.json', '/ring.json']);
			expect(loaded.map((e) => e.id)).toEqual([entry.id]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('rejects a stalled body with no fallback instead of hanging', async () => {
		vi.useFakeTimers();
		try {
			const fetchFn = /** @type {typeof fetch} */ (
				/** @type {unknown} */ (
					async () => ({
						ok: true,
						status: 200,
						headers: { get: () => null },
						text: () => new Promise(() => {})
					})
				)
			);
			const loading = loadRing(fetchFn);
			const settled = expect(loading).rejects.toThrow('timed out');
			await vi.advanceTimersByTimeAsync(10_001);
			await settled;
		} finally {
			vi.useRealTimers();
		}
	});

	describe('malformed entries cost only themselves', () => {
		it.each([
			['a null entry', null],
			['a string entry', 'nope'],
			['a nested array entry', [entry]]
		])('drops %s and keeps the rest', async (_label, bad) => {
			const loaded = await loadRing(respondWith([entry, bad]));
			expect(loaded.map((e) => e.id)).toEqual([entry.id]);
		});

		it('drops null and non-object tracks, pages, artworks and excerpts', async () => {
			const messy = {
				...entry,
				id: 'messy',
				tracks: [null, 7, { label: 'ok', media_url: 'https://example.org/a.mp3' }],
				pages: [null, { image_url: 'https://example.org/p.png' }],
				artworks: ['x', { image_url: 'https://example.org/a.png', alt: 'a' }],
				excerpts: [null, 3, 'plain text', { text: 'rich' }]
			};
			const [loaded] = await loadRing(respondWith([messy]));
			expect(loaded.tracks).toHaveLength(1);
			expect(loaded.pages).toHaveLength(1);
			expect(loaded.artworks).toHaveLength(1);
			expect(loaded.excerpts).toEqual([{ text: 'plain text' }, { text: 'rich' }]);
		});

		it('treats wrongly typed collections as empty rather than throwing', async () => {
			const wrong = {
				...entry,
				id: 'wrong',
				tags: 'solo',
				tracks: {},
				pages: 'p',
				artworks: 1,
				excerpts: { text: 'not an array' }
			};
			const [loaded] = await loadRing(respondWith([wrong]));
			expect(loaded).toMatchObject({ tags: [], tracks: [], pages: [], artworks: [], excerpts: [] });
		});

		it('keeps only string tags', async () => {
			const [loaded] = await loadRing(respondWith([{ ...entry, tags: ['one', 2, null, 'two'] }]));
			expect(loaded.tags).toEqual(['one', 'two']);
		});
	});

	describe('per-entry runtime validation', () => {
		it('drops an entry missing a required field', async () => {
			const missingCreator = { ...entry, creator: undefined };
			const loaded = await loadRing(respondWith([entry, missingCreator]));
			expect(loaded.map((e) => e.id)).toEqual([entry.id]);
		});

		it('drops an entry with an unrecognized type', async () => {
			const badType = { ...entry, id: 'bad-type', type: 'video' };
			const loaded = await loadRing(respondWith([entry, badType]));
			expect(loaded.map((e) => e.id)).toEqual([entry.id]);
		});

		it('drops an entry whose source_url is not https', async () => {
			for (const source_url of ['http://example.org', 'javascript:alert(1)', 'data:text/html,x']) {
				const unsafe = { ...entry, id: 'unsafe', source_url };
				const loaded = await loadRing(respondWith([unsafe]));
				expect(loaded).toEqual([]);
			}
		});

		it('drops an entry whose thumb_url is not https, even with a safe source_url', async () => {
			const unsafeThumb = { ...entry, id: 'unsafe-thumb', thumb_url: 'javascript:alert(1)' };
			const loaded = await loadRing(respondWith([unsafeThumb]));
			expect(loaded).toEqual([]);
		});

		it('drops individual unsafe nested media rather than the whole entry', async () => {
			const mixed = {
				...entry,
				tracks: [
					{ label: 'ok', media_url: 'https://example.org/a.mp3' },
					{ label: 'bad', media_url: 'javascript:alert(1)' }
				]
			};
			const [loaded] = await loadRing(respondWith([mixed]));
			expect(loaded.tracks).toEqual([{ label: 'ok', media_url: 'https://example.org/a.mp3' }]);
		});

		it('keeps HTTP fixture URLs from the exact fetched origin in development', async () => {
			const fixtureEntry = {
				...entry,
				source_url: 'http://localhost:4174/creator/',
				thumb_url: 'http://localhost:4174/creator/cover.svg',
				tracks: [{ label: 'local', media_url: 'http://localhost:4174/creator/audio.mp3' }]
			};

			const [loaded] = await loadRing(
				respondWith([fixtureEntry]),
				'http://localhost:4174/ring.test.json'
			);
			expect(loaded).toMatchObject(fixtureEntry);
		});

		it('still drops HTTP URLs from another origin in development', async () => {
			const mixed = {
				...entry,
				tracks: [
					{ label: 'fixture', media_url: 'http://localhost:4174/audio.mp3' },
					{ label: 'other', media_url: 'http://localhost:9999/audio.mp3' }
				]
			};

			const [loaded] = await loadRing(respondWith([mixed]), 'http://localhost:4174/ring.test.json');
			expect(loaded.tracks).toEqual([
				{ label: 'fixture', media_url: 'http://localhost:4174/audio.mp3' }
			]);
		});
	});
});
