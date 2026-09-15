import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioPlayerStore } from './audioPlayerStore.svelte.js';
import { preferencesStore } from './preferencesStore.svelte.js';

/** @type {import('./ring.js').RingEntry} */
const ENTRY = {
	id: 'audio-test',
	creator: 'Test Artist',
	type: 'audio',
	why: 'Queue behavior fixture.',
	source_url: 'https://example.com',
	tags: ['test'],
	tracks: [{ label: 'Test Track', media_url: 'https://example.com/test.mp3' }],
	verification_token: 'test'
};

const MULTI_TRACK_ENTRY = {
	...ENTRY,
	id: 'audio-multi',
	creator: 'Multi Track Artist',
	tracks: [
		{ label: 'One', media_url: 'https://example.com/one.mp3' },
		{ label: 'Two', media_url: 'https://example.com/two.mp3' },
		{ label: 'Three', media_url: 'https://example.com/three.mp3' }
	]
};

afterEach(() => {
	audioPlayerStore.clear();
	preferencesStore.setRandomizeAudioTracks(false);
	vi.restoreAllMocks();
});

describe('audio queue expansion', () => {
	it('opens for an explicit add', () => {
		audioPlayerStore.addEntry(ENTRY, null);
		expect(audioPlayerStore.queueOpen).toBe(true);
	});

	it('stays closed for an automatic Keep Going add', () => {
		audioPlayerStore.addEntry(ENTRY, null, { openQueue: false });
		expect(audioPlayerStore.queueOpen).toBe(false);
	});

	it('stays open when automatic continuation appends to an already open queue', () => {
		audioPlayerStore.setQueueOpen(true);
		audioPlayerStore.addEntry(ENTRY, null, { openQueue: false });
		expect(audioPlayerStore.queueOpen).toBe(true);
	});
});

describe('adding without starting', () => {
	it('starts an empty queue by default', () => {
		audioPlayerStore.addEntry(ENTRY, null);
		expect(audioPlayerStore.playing).toBe(true);
	});

	it('queues into an empty queue silently when asked not to start', () => {
		audioPlayerStore.previewEntry(MULTI_TRACK_ENTRY, null);
		audioPlayerStore.addEntry(ENTRY, null, { openQueue: false, start: false });

		expect(audioPlayerStore.queue.map((item) => item.label)).toEqual(['Test Track']);
		expect(audioPlayerStore.index).toBe(0);
		expect(audioPlayerStore.playing).toBe(false);
		expect(audioPlayerStore.mobilePanelOpen).toBe(false);
		// The preview that was sounding is left alone.
		expect(audioPlayerStore.previewItem?.label).toBe('One');
		expect(audioPlayerStore.previewPlaying).toBe(true);
		// `clear()` in afterEach resets the queue only.
		audioPlayerStore.stopPreview();
	});
});

describe('audio node track order', () => {
	it('keeps one insertion batch together and distinguishes later additions', () => {
		audioPlayerStore.playEntry(MULTI_TRACK_ENTRY, null);
		const firstBatch = audioPlayerStore.queue[0].batchKey;

		expect(audioPlayerStore.queue.every((item) => item.batchKey === firstBatch)).toBe(true);

		audioPlayerStore.addEntry(ENTRY, null);
		expect(audioPlayerStore.queue.at(-1)?.batchKey).not.toBe(firstBatch);
	});

	it('keeps the listed track order by default', () => {
		audioPlayerStore.playEntry(MULTI_TRACK_ENTRY, null);

		expect(audioPlayerStore.queue.map((item) => item.label)).toEqual(['One', 'Two', 'Three']);
	});

	it('randomizes tracks added by the Play action when enabled', () => {
		preferencesStore.setRandomizeAudioTracks(true);
		vi.spyOn(Math, 'random').mockReturnValue(0);

		audioPlayerStore.playEntry(MULTI_TRACK_ENTRY, null);

		expect(audioPlayerStore.queue.map((item) => item.label)).toEqual(['Two', 'Three', 'One']);
	});

	it('randomizes only the new node when Add appends to an existing playlist', () => {
		audioPlayerStore.playEntry(ENTRY, null);
		preferencesStore.setRandomizeAudioTracks(true);
		vi.spyOn(Math, 'random').mockReturnValue(0);

		audioPlayerStore.addEntry(MULTI_TRACK_ENTRY, null);

		expect(audioPlayerStore.queue.map((item) => item.label)).toEqual([
			'Test Track',
			'Two',
			'Three',
			'One'
		]);
	});

	it('keeps a preview deterministic and randomizes it only when added', () => {
		preferencesStore.setRandomizeAudioTracks(true);
		vi.spyOn(Math, 'random').mockReturnValue(0);

		audioPlayerStore.previewEntry(MULTI_TRACK_ENTRY, null);
		expect(audioPlayerStore.previewItem?.label).toBe('One');

		audioPlayerStore.promotePreview();
		expect(audioPlayerStore.queue.map((item) => item.label)).toEqual(['Two', 'Three', 'One']);
	});
});

describe('mobile player panel', () => {
	it('opens with a new playback session and can be dismissed without clearing audio', () => {
		audioPlayerStore.playEntry(ENTRY, null);
		expect(audioPlayerStore.mobilePanelOpen).toBe(true);

		audioPlayerStore.closeMobilePanel();
		expect(audioPlayerStore.mobilePanelOpen).toBe(false);
		expect(audioPlayerStore.current?.entryId).toBe(ENTRY.id);

		audioPlayerStore.openMobilePanel();
		expect(audioPlayerStore.mobilePanelOpen).toBe(true);
	});

	it('closes when the last queued entry is removed', () => {
		audioPlayerStore.playEntry(ENTRY, null);
		audioPlayerStore.removeEntry(ENTRY.id);

		expect(audioPlayerStore.queue).toHaveLength(0);
		expect(audioPlayerStore.mobilePanelOpen).toBe(false);
	});
});

describe('audio preview', () => {
	it('can select a preview without autoplaying it', () => {
		audioPlayerStore.previewEntry(ENTRY, null, { autoplay: false });

		expect(audioPlayerStore.previewItem?.entryId).toBe(ENTRY.id);
		expect(audioPlayerStore.previewPlaying).toBe(false);
	});

	it('reports which preview completed before releasing it', () => {
		audioPlayerStore.previewEntry(ENTRY, null);
		const before = audioPlayerStore.previewCompletion.sequence;

		audioPlayerStore.finishPreview();

		expect(audioPlayerStore.previewItem).toBeNull();
		expect(audioPlayerStore.previewCompletion).toEqual({
			sequence: before + 1,
			entryId: ENTRY.id
		});
	});

	it('can select a specific track from a multi-track preview', () => {
		const multiTrackEntry = {
			...ENTRY,
			tracks: [
				{ label: 'First', media_url: 'https://example.test/first.mp3' },
				{ label: 'Second', media_url: 'https://example.test/second.mp3' }
			]
		};

		audioPlayerStore.previewEntry(multiTrackEntry, null, { autoplay: false, trackIndex: 1 });

		expect(audioPlayerStore.previewItem?.label).toBe('Second');
		expect(audioPlayerStore.previewItem?.url).toBe('https://example.test/second.mp3');
	});
});
