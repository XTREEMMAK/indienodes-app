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
	destination = new FakeAudioNode();

	createAnalyser() {
		return new FakeAnalyserNode();
	}

	createMediaElementSource() {
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

/** @type {import('$lib/ring.js').RingEntry} */
const FIRST_ENTRY = {
	id: 'audio-first',
	creator: 'First Artist',
	type: 'audio',
	why: 'Player lifecycle fixture.',
	source_url: 'https://example.com/first',
	tags: ['test'],
	tracks: [{ label: 'First Track', media_url: 'https://example.com/first.mp3' }],
	verification_token: 'test'
};

/** @type {import('$lib/ring.js').RingEntry} */
const SECOND_ENTRY = {
	...FIRST_ENTRY,
	id: 'audio-second',
	creator: 'Second Artist',
	source_url: 'https://example.com/second',
	tracks: [{ label: 'Second Track', media_url: 'https://example.com/second.mp3' }]
};

const MINI_POSITION_KEY = 'indienode:player-position:v1';

beforeEach(async () => {
	await page.viewport(1280, 900);
});

afterEach(() => {
	audioPlayerStore.clear();
	audioLevelStore.reset();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
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
		await vi.waitFor(() => expect(original?.src).toBe('https://example.com/first.mp3'));

		audioPlayerStore.clear();
		await vi.waitFor(() => {
			expect(original?.getAttribute('src')).toBeNull();
			expect(document.querySelector('[data-main-player-audio]')).toBe(original);
		});

		audioPlayerStore.addEntry(SECOND_ENTRY, null);
		await vi.waitFor(() => expect(original?.src).toBe('https://example.com/second.mp3'));
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
