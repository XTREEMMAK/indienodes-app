import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import AudioPlayer from './AudioPlayer.svelte';
import { audioPlayerStore } from '$lib/audioPlayerStore.svelte.js';
import { audioLevelStore } from '$lib/audioLevelStore.svelte.js';

class FakeAudioNode {
	connect() {}
}

class FakeAnalyserNode extends FakeAudioNode {
	frequencyBinCount = 128;
	fftSize = 256;
	smoothingTimeConstant = 0;

	/** @param {Uint8Array} bins */
	getByteFrequencyData(bins) {
		bins.fill(32);
	}

	/** @param {Uint8Array} bins */
	getByteTimeDomainData(bins) {
		bins.fill(128);
	}
}

class FakeAudioContext {
	/** Every element handed to `createMediaElementSource`, across all instances. */
	static wiredElements = /** @type {HTMLMediaElement[]} */ ([]);

	destination = new FakeAudioNode();

	createAnalyser() {
		return new FakeAnalyserNode();
	}

	/** @param {HTMLMediaElement} element */
	createMediaElementSource(element) {
		FakeAudioContext.wiredElements.push(element);
		return new FakeAudioNode();
	}

	createGain() {
		return Object.assign(new FakeAudioNode(), {
			gain: {
				value: 1,
				/** @param {number} value */
				setTargetAtTime(value) {
					this.value = value;
				}
			}
		});
	}

	createBiquadFilter() {
		return Object.assign(new FakeAudioNode(), {
			type: 'lowpass',
			frequency: { value: 0 },
			Q: { value: 0 }
		});
	}

	async resume() {}
	async close() {}
}

/**
 * A short silent WAV as a data: URL. These tracks have to actually load: a URL
 * that fails, like an unreachable https://example.com file, is now treated as a
 * host refusing CORS and moved to the unwired element, which is exactly what
 * these fixtures are not testing. A data: URL loads in CORS mode.
 * @param {number} samples distinct per fixture, so each URL differs
 */
function silentWav(samples) {
	const bytes = new Uint8Array(44 + samples);
	const view = new DataView(bytes.buffer);
	/**
	 * @param {number} at
	 * @param {string} text
	 */
	function ascii(at, text) {
		[...text].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
	}
	ascii(0, 'RIFF');
	view.setUint32(4, 36 + samples, true);
	ascii(8, 'WAVEfmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, 8000, true);
	view.setUint32(28, 8000, true);
	view.setUint16(32, 1, true);
	view.setUint16(34, 8, true);
	ascii(36, 'data');
	view.setUint32(40, samples, true);
	bytes.fill(128, 44);
	return 'data:audio/wav;base64,' + btoa(String.fromCharCode(...bytes));
}

const FIRST_URL = silentWav(800);
const SECOND_URL = silentWav(801);
/** Never loads in the test browser, so it plays the part of a host refusing CORS. */
const REFUSED_URL = 'https://refuses-cors.example/track.mp3';

/** @type {import('$lib/ring.js').RingEntry} */
const FIRST_ENTRY = {
	id: 'audio-first',
	creator: 'First Artist',
	type: 'audio',
	why: 'Player lifecycle fixture.',
	source_url: 'https://example.com/first',
	tags: ['test'],
	tracks: [{ label: 'First Track', media_url: FIRST_URL }],
	verification_token: 'test'
};

/** @type {import('$lib/ring.js').RingEntry} */
const SECOND_ENTRY = {
	...FIRST_ENTRY,
	id: 'audio-second',
	creator: 'Second Artist',
	source_url: 'https://example.com/second',
	tracks: [{ label: 'Second Track', media_url: SECOND_URL }]
};

/** @type {import('$lib/ring.js').RingEntry} */
const REFUSED_ENTRY = {
	...FIRST_ENTRY,
	id: 'audio-refused',
	creator: 'Self-Hosted Artist',
	source_url: 'https://refuses-cors.example/',
	tracks: [{ label: 'Refused Track', media_url: REFUSED_URL }]
};

/** @returns {{ main: HTMLAudioElement, plain: HTMLAudioElement }} */
function mainElements() {
	return {
		main: /** @type {HTMLAudioElement} */ (document.querySelector('[data-main-player-audio]')),
		plain: /** @type {HTMLAudioElement} */ (
			document.querySelector('[data-main-player-audio-plain]')
		)
	};
}

const MINI_POSITION_KEY = 'indienode:player-position:v1';

beforeEach(async () => {
	await page.viewport(1280, 900);
});

afterEach(() => {
	audioPlayerStore.clear();
	audioLevelStore.reset();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	FakeAudioContext.wiredElements = [];
	localStorage.removeItem(MINI_POSITION_KEY);
});

describe('main audio element lifecycle', () => {
	it('minimizes to a compact transport and resets for a new player session', async () => {
		const screen = await render(AudioPlayer, { entries: [FIRST_ENTRY, SECOND_ENTRY] });

		audioPlayerStore.addEntry(FIRST_ENTRY, null);
		await expect.element(screen.getByRole('button', { name: 'Minimize player' })).toBeVisible();
		await screen.getByRole('button', { name: 'Minimize player' }).click();

		await expect
			.element(screen.getByRole('button', { name: /Expand player, First Track/ }))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

		audioPlayerStore.clear();
		await vi.waitFor(() => expect(document.querySelector('.mini-player')).toBeNull());
		audioPlayerStore.addEntry(SECOND_ENTRY, null);
		await expect.element(screen.getByRole('button', { name: 'Minimize player' })).toBeVisible();
	});

	it('restores and updates the minimized position locally', async () => {
		localStorage.setItem(MINI_POSITION_KEY, JSON.stringify({ x: 24, y: 24 }));
		const screen = await render(AudioPlayer, { entries: [FIRST_ENTRY] });

		audioPlayerStore.addEntry(FIRST_ENTRY, null);
		await screen.getByRole('button', { name: 'Minimize player' }).click();

		const dock = /** @type {HTMLDivElement | null} */ (document.querySelector('.mini-player'));
		await vi.waitFor(() => {
			expect(dock?.style.left).toBe('24px');
			expect(dock?.style.top).toBe('24px');
		});

		const handle = /** @type {HTMLButtonElement | null} */ (
			document.querySelector('[aria-label="Move minimized player"]')
		);
		handle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

		await vi.waitFor(() => {
			const stored = JSON.parse(localStorage.getItem(MINI_POSITION_KEY) ?? 'null');
			expect(stored).toEqual({ x: 40, y: 24 });
		});
	});

	it('keeps the Web Audio source element when the player is closed and reopened', async () => {
		await render(AudioPlayer, { entries: [FIRST_ENTRY, SECOND_ENTRY] });

		const original = /** @type {HTMLAudioElement | null} */ (
			document.querySelector('[data-main-player-audio]')
		);
		expect(original).toBeInstanceOf(HTMLAudioElement);

		audioPlayerStore.addEntry(FIRST_ENTRY, null);
		await vi.waitFor(() => expect(original?.src).toBe(FIRST_URL));

		audioPlayerStore.clear();
		await vi.waitFor(() => {
			expect(original?.getAttribute('src')).toBeNull();
			expect(document.querySelector('[data-main-player-audio]')).toBe(original);
		});

		audioPlayerStore.addEntry(SECOND_ENTRY, null);
		await vi.waitFor(() => expect(original?.src).toBe(SECOND_URL));
		expect(document.querySelector('[data-main-player-audio]')).toBe(original);
	});

	it('restarts background analysis after the player is closed and reopened', async () => {
		vi.stubGlobal('AudioContext', FakeAudioContext);
		vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
		await render(AudioPlayer, { entries: [FIRST_ENTRY, SECOND_ENTRY] });

		audioPlayerStore.addEntry(FIRST_ENTRY, null);
		await vi.waitFor(() => expect(audioPlayerStore.current?.entryId).toBe(FIRST_ENTRY.id));
		audioPlayerStore.setPlaying(true);
		await vi.waitFor(() => expect(audioLevelStore.active).toBe(true));

		audioPlayerStore.clear();
		await vi.waitFor(() => expect(audioLevelStore.active).toBe(false));

		audioPlayerStore.addEntry(SECOND_ENTRY, null);
		await vi.waitFor(() => expect(audioPlayerStore.current?.entryId).toBe(SECOND_ENTRY.id));
		audioPlayerStore.setPlaying(true);
		await vi.waitFor(() => expect(audioLevelStore.active).toBe(true));
	});
});

/**
 * Waits for a refused track to be tried on the wired element, then makes it
 * fail there. The fixture host never resolves, so the browser's own error can
 * beat this to it; either way the track ends up on `plain`.
 * @param {string} url
 */
async function refuseOnMain(url) {
	const { main, plain } = mainElements();
	await vi.waitFor(() => expect([main.src, plain.src]).toContain(url));
	if (main.src === url) main.dispatchEvent(new Event('error'));
	await vi.waitFor(() => expect(plain.src).toBe(url));
}

describe('hosts that refuse CORS', () => {
	it('moves a refused track onto the unwired element and keeps playing', async () => {
		vi.stubGlobal('AudioContext', FakeAudioContext);
		vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
		await render(AudioPlayer, { entries: [REFUSED_ENTRY] });
		const { main, plain } = mainElements();

		audioPlayerStore.addEntry(REFUSED_ENTRY, null);
		await refuseOnMain(REFUSED_URL);

		// Tried in CORS mode first, then released; the retry never sets it.
		expect(main.crossOrigin).toBe('anonymous');
		expect(main.getAttribute('src')).toBeNull();
		expect(plain.crossOrigin).toBeNull();
		expect(audioPlayerStore.playing).toBe(true);
		expect(FakeAudioContext.wiredElements).not.toContain(plain);
		expect(audioLevelStore.active).toBe(false);
	});

	it('keeps a refused track audible after an earlier track wired the graph', async () => {
		// The bug: once createMediaElementSource claimed the element, a refused
		// host reloaded into that same element played zeros.
		vi.stubGlobal('AudioContext', FakeAudioContext);
		vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
		await render(AudioPlayer, { entries: [FIRST_ENTRY, REFUSED_ENTRY, SECOND_ENTRY] });
		const { main, plain } = mainElements();

		audioPlayerStore.addEntry(FIRST_ENTRY, null);
		await vi.waitFor(() => expect(audioLevelStore.active).toBe(true));
		expect(FakeAudioContext.wiredElements).toEqual([main]);

		audioPlayerStore.addEntry(REFUSED_ENTRY, null);
		audioPlayerStore.next();
		await refuseOnMain(REFUSED_URL);

		await vi.waitFor(() => {
			expect(main.getAttribute('src')).toBeNull();
			expect(audioLevelStore.active).toBe(false);
		});
		expect(audioPlayerStore.playing).toBe(true);

		// Back on a host that allows CORS: the original element and its graph
		// pick up again, with no second source node.
		audioPlayerStore.addEntry(SECOND_ENTRY, null);
		audioPlayerStore.next();
		await vi.waitFor(() => {
			expect(main.src).toBe(SECOND_URL);
			expect(plain.getAttribute('src')).toBeNull();
			expect(audioLevelStore.active).toBe(true);
		});
		expect(FakeAudioContext.wiredElements).toEqual([main]);
	});

	it('sends a host already known to refuse straight to the unwired element', async () => {
		vi.stubGlobal('AudioContext', FakeAudioContext);
		vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
		const again = {
			...REFUSED_ENTRY,
			id: 'audio-refused-again',
			tracks: [{ label: 'Refused Again', media_url: 'https://refuses-cors.example/two.mp3' }]
		};
		await render(AudioPlayer, { entries: [REFUSED_ENTRY, again] });
		const { main, plain } = mainElements();

		audioPlayerStore.addEntry(REFUSED_ENTRY, null);
		await refuseOnMain(REFUSED_URL);

		const setSrc = vi.spyOn(main, 'src', 'set');
		audioPlayerStore.addEntry(again, null);
		audioPlayerStore.next();
		await vi.waitFor(() => expect(plain.src).toBe('https://refuses-cors.example/two.mp3'));
		expect(setSrc).not.toHaveBeenCalled();
	});

	it('ignores the pause fired by the element being released', async () => {
		vi.stubGlobal('AudioContext', FakeAudioContext);
		vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
		await render(AudioPlayer, { entries: [REFUSED_ENTRY] });
		const { main } = mainElements();

		audioPlayerStore.addEntry(REFUSED_ENTRY, null);
		await refuseOnMain(REFUSED_URL);

		main.dispatchEvent(new Event('pause'));
		main.dispatchEvent(new Event('ended'));
		expect(audioPlayerStore.playing).toBe(true);
		expect(audioPlayerStore.current?.entryId).toBe(REFUSED_ENTRY.id);
	});
});

it('closing mobile controls clears playback like desktop, and omits minimize', async () => {
	await page.viewport(390, 844);
	const screen = await render(AudioPlayer, { entries: [FIRST_ENTRY] });

	audioPlayerStore.addEntry(FIRST_ENTRY, null);
	await expect
		.element(screen.getByRole('button', { name: 'Close player and clear queue' }))
		.toBeVisible();
	expect(document.querySelector('[aria-label="Minimize player"]')).toBeNull();

	await screen.getByRole('button', { name: 'Close player and clear queue' }).click();
	await vi.waitFor(() => expect(document.querySelector('.player')).toBeNull());
	expect(audioPlayerStore.queue).toHaveLength(0);
});
