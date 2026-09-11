import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from './storageKeys.js';
import { createSubmissionStore } from './submissionStore.svelte.js';
import { generatorDraftStore } from './generator/generatorDraftStore.svelte.js';

/**
 * The submission draft, tested before `/join` is refactored around it.
 *
 * This is the one place in the app where a bug costs someone work they cannot
 * get back: a submitter leaves mid-flow to paste a token onto their own site,
 * and the draft is what is waiting when they return. It had no tests at all.
 *
 * Two properties matter most, and they pull in opposite directions — the entry
 * half must survive a reload, and the review half (an email address, two
 * consent checkboxes) must *not*. Section 2.2 of the spec keeps email out of
 * anywhere it does not belong, and a consent checkbox that restores itself has
 * not been given.
 *
 * The store is a module singleton reading localStorage at import time, so each
 * case seeds storage and then imports a fresh copy via `resetModules`.
 */

const KEY = STORAGE_KEYS.submissionDraft.key;

/** @param {{ uid: string }} row */
const uidOf = (row) => row.uid;
/** @param {{ label: string }} row */
const labelOf = (row) => row.label;

/**
 * A genuinely fresh store.
 *
 * `vi.resetModules()` is not enough: the store is a module singleton that
 * reads localStorage once at import, and the already-evaluated module is
 * handed back, so every case would share one instance and see the first
 * case's storage. A cache-busting dynamic import is not statically analysable
 * by Vite either. The module exports its factory for exactly this.
 *
 * @param {unknown} [draft]
 */
function freshStore(draft) {
	localStorage.clear();
	if (draft !== undefined) localStorage.setItem(KEY, JSON.stringify(draft));
	return createSubmissionStore();
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	localStorage.clear();
});

describe('restoring a draft', () => {
	it('starts empty when nothing was stored', () => {
		const store = freshStore();
		expect(store.entry.creator).toBe('');
		expect(store.entry.tags).toEqual([]);
		expect(store.entry.tracks).toEqual([]);
	});

	it('brings back the work someone left behind', () => {
		const store = freshStore({
			creator: 'Driftwood Radio',
			type: 'audio',
			why: 'Because it is good.',
			tags: ['ambient'],
			source_url: 'https://example.com'
		});

		expect(store.entry.creator).toBe('Driftwood Radio');
		expect(store.entry.type).toBe('audio');
		expect(store.entry.why).toBe('Because it is good.');
		expect(store.entry.tags).toEqual(['ambient']);
	});

	it('fills in fields the stored draft predates', () => {
		// A draft written by an older build must not leave newer fields
		// undefined, or the form binds to nothing.
		const store = freshStore({ creator: 'Partial' });
		expect(store.entry.excerpts).toHaveLength(1);
		expect(store.entry.excerpts[0]).toMatchObject({ text: '', audio_url: '' });
		expect(store.entry.explicit).toBe(false);
		expect(store.entry.has_own_site).toBe('');
	});

	it('discards a corrupt draft rather than half-loading it', () => {
		// A draft that half-loads is worth much less than nothing: the
		// submitter cannot tell which half is real.
		localStorage.clear();
		localStorage.setItem(KEY, '{not json');
		expect(createSubmissionStore().entry.creator).toBe('');
	});

	it('repairs list fields that were stored as the wrong shape', () => {
		const store = freshStore({ creator: 'X', tags: 'nope', tracks: null, pages: 42 });
		expect(store.entry.tags).toEqual([]);
		expect(store.entry.tracks).toEqual([]);
		expect(store.entry.pages).toEqual([]);
	});

	it('re-keys restored rows so no two share a uid', () => {
		// uids key the {#each}; duplicates smear values across rows when one
		// in the middle is removed.
		const store = freshStore({
			creator: 'X',
			tracks: [
				{ uid: 'same', label: 'a', media_url: 'https://e.com/a.mp3' },
				{ uid: 'same', label: 'b', media_url: 'https://e.com/b.mp3' }
			]
		});

		// Inline JSDoc casts on arrow parameters are avoided deliberately here:
		// this file is compiled by Svelte, which mangles that idiom into
		// invalid syntax (see submissionStore.svelte.js's own note).
		const rows = store.entry.tracks;
		const uids = rows.map(uidOf);
		expect(new Set(uids).size).toBe(2);
		// The content still survives the re-key.
		expect(rows.map(labelOf)).toEqual(['a', 'b']);
	});
});

describe('what never reaches storage', () => {
	it('does not persist the email or the consent checkboxes', () => {
		const store = freshStore();
		store.entry.creator = 'Someone';
		store.review.email = 'private@example.com';
		store.review.rights_confirmation = true;
		store.review.eula_agreement = true;
		store.touch();
		vi.runAllTimers();

		const raw = localStorage.getItem(KEY) ?? '';
		expect(raw).toContain('Someone');
		// The whole reason the draft key is catalogued exportable:false.
		expect(raw).not.toContain('private@example.com');
		expect(raw).not.toContain('rights_confirmation');
		expect(raw).not.toContain('eula_agreement');
	});

	it('starts every session with consent ungiven, whatever was stored', () => {
		// A consent checkbox that restores itself has not been consented to.
		const store = freshStore({ creator: 'X', review: { eula_agreement: true } });
		expect(store.review.eula_agreement).toBe(false);
		expect(store.review.rights_confirmation).toBe(false);
		expect(store.review.email).toBe('');
	});
});

describe('persistence timing', () => {
	it('waits for a pause in typing rather than writing per keystroke', () => {
		const store = freshStore();
		store.entry.creator = 'A';
		store.touch();
		store.entry.creator = 'Ab';
		store.touch();

		// Nothing yet: still mid-keystroke.
		expect(localStorage.getItem(KEY)).toBeNull();

		vi.runAllTimers();
		expect(localStorage.getItem(KEY)).toContain('Ab');
	});

	it('survives a storage that refuses writes', () => {
		const store = freshStore();
		const real = Storage.prototype.setItem;
		Storage.prototype.setItem = () => {
			throw new DOMException('QuotaExceededError');
		};
		try {
			store.entry.creator = 'Private window';
			store.touch();
			// Losing the draft is survivable; throwing out of a keystroke is not.
			expect(() => vi.runAllTimers()).not.toThrow();
		} finally {
			Storage.prototype.setItem = real;
		}
	});
});

describe('reset', () => {
	it('clears the stored draft so a finished submission does not come back', () => {
		const store = freshStore({ creator: 'Done' });
		store.touch();
		vi.runAllTimers();
		expect(localStorage.getItem(KEY)).not.toBeNull();

		store.reset();

		expect(localStorage.getItem(KEY)).toBeNull();
		expect(store.entry.creator).toBe('');
	});
});

describe("isStepComplete('entry') cover ownership", () => {
	const validEntry = {
		creator: 'Pocket Studio',
		type: 'game',
		why: 'Tiny games for long train rides.',
		has_own_site: 'yes',
		source_url: 'https://example.com/games',
		tags: ['game']
	};

	it('requires an own-site game cover on the Entry step', () => {
		const store = freshStore(validEntry);
		expect(store.isStepComplete('entry')).toBe(false);

		store.entry.thumb_url = 'https://example.com/cover.png';
		expect(store.isStepComplete('entry')).toBe(true);
	});

	it('leaves a generated-page game cover for its media upload step', () => {
		const store = freshStore({
			...validEntry,
			has_own_site: 'no',
			source_url: '',
			thumb_url: ''
		});
		expect(store.isStepComplete('entry')).toBe(true);
	});
});

describe("isStepComplete('media') for a no-site audio creator", () => {
	// generatorDraftStore is a real module singleton (submissionStore.svelte.js
	// reads it directly, not as an injected dependency), so its in-memory
	// `generator` state has to be reset between cases the same way the draft
	// key is cleared above — otherwise one case's `audioHosting` choice would
	// leak into the next.
	afterEach(() => {
		generatorDraftStore.discard();
	});

	it('never blocks bundle mode, the default, exactly as before this feature existed', () => {
		const store = freshStore();
		store.entry.has_own_site = 'no';
		store.entry.type = 'audio';
		expect(store.isStepComplete('media')).toBe(true);
	});

	it('never blocks bundle mode even when explicitly chosen', () => {
		const store = freshStore();
		store.entry.has_own_site = 'no';
		store.entry.type = 'audio';
		generatorDraftStore.save({ generator: { audioHosting: 'bundle' } });
		expect(store.isStepComplete('media')).toBe(true);
	});

	it('blocks Continue when external hosting is chosen but no track has a URL yet', () => {
		const store = freshStore();
		store.entry.has_own_site = 'no';
		store.entry.type = 'audio';
		generatorDraftStore.save({ generator: { audioHosting: 'external' } });
		expect(store.isStepComplete('media')).toBe(false);
	});

	it('unblocks once at least one track has a real URL', () => {
		const store = freshStore();
		store.entry.has_own_site = 'no';
		store.entry.type = 'audio';
		store.entry.tracks = [{ uid: 'a', label: '', media_url: '' }];
		generatorDraftStore.save({ generator: { audioHosting: 'external' } });
		expect(store.isStepComplete('media')).toBe(false);

		store.entry.tracks[0].media_url = 'https://filegarden.com/creator/track.mp3';
		expect(store.isStepComplete('media')).toBe(true);
	});

	it('a track present with only whitespace still counts as empty', () => {
		const store = freshStore();
		store.entry.has_own_site = 'no';
		store.entry.type = 'audio';
		store.entry.tracks = [{ uid: 'a', label: '', media_url: '   ' }];
		generatorDraftStore.save({ generator: { audioHosting: 'external' } });
		expect(store.isStepComplete('media')).toBe(false);
	});
});

describe("isStepComplete('consent')", () => {
	/** @param {ReturnType<typeof freshStore>} store */
	function fillContactFields(store) {
		store.review.email = 'creator@example.com';
		store.review.pro_membership = 'Not a member';
	}

	it('is not complete until the general EULA box is checked', () => {
		const store = freshStore();
		fillContactFields(store);
		expect(store.isStepComplete('consent')).toBe(false);

		store.review.eula_agreement = true;
		expect(store.isStepComplete('consent')).toBe(true);
	});

	it('does not require rights_confirmation when pro_membership is "Not a member"', () => {
		const store = freshStore();
		fillContactFields(store);
		store.review.eula_agreement = true;
		store.review.rights_confirmation = false;
		expect(store.isStepComplete('consent')).toBe(true);
	});

	it('also requires rights_confirmation once a real PRO relationship is stated', () => {
		const store = freshStore();
		fillContactFields(store);
		store.review.pro_membership = 'BMI';
		store.review.eula_agreement = true;
		expect(store.isStepComplete('consent')).toBe(false);

		store.review.rights_confirmation = true;
		expect(store.isStepComplete('consent')).toBe(true);
	});

	it('still requires the contact fields themselves (email, pro_membership)', () => {
		const store = freshStore();
		store.review.eula_agreement = true;
		expect(store.isStepComplete('consent')).toBe(false);
	});
});
