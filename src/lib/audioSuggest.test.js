import { describe, expect, it } from 'vitest';
import { suggestNext } from './audioSuggest.js';

/**
 * @param {Partial<import('./ring.js').RingEntry>} overrides
 * @returns {import('./ring.js').RingEntry}
 */
function entry(overrides) {
	return {
		id: 'e',
		creator: 'C',
		type: 'audio',
		why: 'w',
		source_url: 'https://example.com',
		tags: [],
		tracks: [{ label: 'T', media_url: 'https://example.com/t.mp3' }],
		...overrides
	};
}

/** @param {Partial<import('./audioPlayerStore.svelte.js').QueueItem>} overrides */
function played(overrides) {
	return {
		key: 'q-1',
		entryId: 'played-entry',
		creator: 'Played',
		label: 'T',
		url: 'https://example.com/t.mp3',
		cover: null,
		tags: [],
		...overrides
	};
}

describe('suggestNext never mixes audio form', () => {
	it('never offers a same-tag entry of a different form than what just played', () => {
		const music = entry({ id: 'music-1', form: 'music', tags: ['fantasy'] });
		const spoken = entry({ id: 'spoken-1', form: 'spoken', tags: ['fantasy'] });

		const result = suggestNext(
			[music, spoken],
			[played({ entryId: 'x', tags: ['fantasy'], form: 'music' })]
		);

		expect(result?.id).toBe('music-1');
	});

	it('restricts the fallback random pick to the same form too', () => {
		const music = entry({ id: 'music-1', form: 'music', tags: ['no-overlap'] });
		const spoken = entry({ id: 'spoken-1', form: 'spoken', tags: ['no-overlap'] });

		// Neither candidate shares a tag with what played, so this exercises
		// the random-fallback branch, not the tag-scoring branch -- it must
		// still never cross forms.
		const result = suggestNext(
			[music, spoken],
			[played({ entryId: 'x', tags: ['unrelated'], form: 'music' })]
		);

		expect(result?.id).toBe('music-1');
	});

	it('returns null when nothing shares the form that just played', () => {
		const spoken = entry({ id: 'spoken-1', form: 'spoken', tags: ['fantasy'] });

		const result = suggestNext(
			[spoken],
			[played({ entryId: 'x', tags: ['fantasy'], form: 'music' })]
		);

		expect(result).toBeNull();
	});

	it('falls back to offering any form when the played item is missing form (defensive, not a default)', () => {
		const music = entry({ id: 'music-1', form: 'music', tags: [] });
		const spoken = entry({ id: 'spoken-1', form: 'spoken', tags: [] });

		const result = suggestNext([music, spoken], [played({ entryId: 'x', tags: [] })]);

		expect(['music-1', 'spoken-1']).toContain(result?.id);
	});
});
