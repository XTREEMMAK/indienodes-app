import { describe, expect, it, vi } from 'vitest';
import { audioCorsMessage, checkAudioCors } from './audioCorsCheck.js';

/**
 * A stand-in audio element that answers by CORS mode. `respond` gets the mode
 * the element was set to before `src`, and returns the event to fire, or null
 * to never answer.
 * @param {(crossOrigin: string | null) => 'loadedmetadata' | 'error' | null} respond
 */
function fakeAudioFactory(respond) {
	/** @type {{ crossOrigin: string | null, src: string }[]} */
	const created = [];
	const createAudio = () => {
		/** @type {Record<string, Function>} */
		const listeners = {};
		const record = { crossOrigin: /** @type {string | null} */ (null), src: '' };
		created.push(record);
		const audio = {
			preload: '',
			removed: false,
			get crossOrigin() {
				return record.crossOrigin;
			},
			set crossOrigin(value) {
				record.crossOrigin = value;
			},
			get src() {
				return record.src;
			},
			set src(value) {
				record.src = value;
				const event = respond(record.crossOrigin);
				if (event) queueMicrotask(() => listeners[event]?.());
			},
			addEventListener: (/** @type {string} */ name, /** @type {Function} */ fn) => {
				listeners[name] = fn;
			},
			removeEventListener: (/** @type {string} */ name) => {
				delete listeners[name];
			},
			removeAttribute: vi.fn(),
			load: vi.fn()
		};
		return /** @type {any} */ (audio);
	};
	return { createAudio, created };
}

describe('checkAudioCors', () => {
	it('reports a host that allows CORS as reactive, with one request in CORS mode', async () => {
		const { createAudio, created } = fakeAudioFactory(() => 'loadedmetadata');
		expect(await checkAudioCors('https://file.garden/x/track.mp3', { createAudio })).toBe(
			'reactive'
		);
		expect(created).toEqual([{ crossOrigin: 'anonymous', src: 'https://file.garden/x/track.mp3' }]);
	});

	it('reports a host that loads only without CORS as no_cors', async () => {
		const { createAudio, created } = fakeAudioFactory((mode) =>
			mode === 'anonymous' ? 'error' : 'loadedmetadata'
		);
		expect(await checkAudioCors('https://creator.example/a.mp3', { createAudio })).toBe('no_cors');
		expect(created.map((a) => a.crossOrigin)).toEqual(['anonymous', null]);
	});

	it('reports a link that fails in both modes as unplayable', async () => {
		const { createAudio } = fakeAudioFactory(() => 'error');
		expect(await checkAudioCors('https://creator.example/page', { createAudio })).toBe(
			'unplayable'
		);
	});

	it('gives no verdict on a host that never answers', async () => {
		const { createAudio } = fakeAudioFactory(() => null);
		expect(await checkAudioCors('https://slow.example/a.mp3', { createAudio, timeoutMs: 5 })).toBe(
			'timeout'
		);
	});

	it('requests nothing for a non-https or malformed URL', async () => {
		const { createAudio, created } = fakeAudioFactory(() => 'loadedmetadata');
		for (const url of ['http://creator.example/a.mp3', 'javascript:alert(1)', 'not a url', '']) {
			expect(await checkAudioCors(url, { createAudio })).toBe('invalid');
		}
		expect(created).toEqual([]);
	});

	it('releases the element after each attempt', async () => {
		const elements = /** @type {any[]} */ ([]);
		const { createAudio: base } = fakeAudioFactory((mode) =>
			mode === 'anonymous' ? 'error' : 'loadedmetadata'
		);
		const createAudio = () => {
			const el = base();
			elements.push(el);
			return el;
		};
		await checkAudioCors('https://creator.example/a.mp3', { createAudio });
		expect(elements).toHaveLength(2);
		for (const el of elements) {
			expect(el.removeAttribute).toHaveBeenCalledWith('src');
			expect(el.load).toHaveBeenCalled();
		}
	});
});

describe('audioCorsMessage', () => {
	it('has a message for every verdict, and points no_cors at the fix', () => {
		for (const verdict of /** @type {const} */ ([
			'reactive',
			'no_cors',
			'unplayable',
			'timeout',
			'invalid'
		])) {
			expect(audioCorsMessage(verdict).text).toBeTruthy();
		}
		expect(audioCorsMessage('reactive').tone).toBe('ok');
		expect(audioCorsMessage('no_cors').tone).toBe('warn');
		expect(audioCorsMessage('no_cors').text).toMatch(/File Garden/);
	});
});
