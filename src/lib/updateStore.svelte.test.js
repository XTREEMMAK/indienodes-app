import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from './storageKeys.js';
import { createUpdateStore } from './updateStore.svelte.js';

/**
 * `/update`'s draft, and the property that brought these tests about: an email
 * typed here used to survive in the browser between visits, while `/join`
 * deliberately never kept one. An address given for a single message should
 * not outlive that message because someone closed a tab.
 *
 * The rest of the draft must still survive, which is the half that protects
 * someone's half-finished change request.
 */

const KEY = STORAGE_KEYS.updateDraft.key;

/** @param {unknown} [draft] */
function freshStore(draft) {
	localStorage.clear();
	if (draft !== undefined) localStorage.setItem(KEY, JSON.stringify(draft));
	return createUpdateStore();
}

/** @type {any[]} */
const RING = [
	{
		id: 'audio-ashzone-xeno',
		creator: 'AshZone',
		type: 'audio',
		why: 'Tape loops.',
		tags: ['ambient'],
		source_url: 'https://ashzonemusic.bandcamp.com/album/xeno'
	},
	{
		id: 'comic-paper-lantern',
		creator: 'Paper Lantern Comics',
		type: 'comic',
		why: 'Ink and rain.',
		tags: ['comics'],
		source_url: 'https://paperlantern.example/'
	}
];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	localStorage.clear();
});

describe('the email never reaches storage', () => {
	it('is not written when the draft persists', () => {
		const store = freshStore();
		store.nodeId = 'audio-ashzone-xeno';
		store.email = 'private@example.com';
		store.touch();
		vi.runAllTimers();

		const raw = localStorage.getItem(KEY) ?? '';
		expect(raw).toContain('audio-ashzone-xeno');
		expect(raw).not.toContain('private@example.com');
	});

	it('is not restored from a draft written by an older build', () => {
		// Those drafts exist in real browsers right now, so dropping it on the
		// way out is not enough on its own.
		const store = freshStore({
			nodeId: 'audio-ashzone-xeno',
			entry: { creator: 'AshZone' },
			email: 'left@example.com'
		});
		expect(store.email).toBe('');
	});

	it('starts each session with every attestation ungiven', () => {
		const store = freshStore({
			nodeId: 'x',
			entry: {},
			rightsReaffirmed: true,
			aiAttestation: true,
			adultContent: 'no'
		});
		expect(store.aiAttestation).toBe(false);
		expect(store.rightsConfirmation).toBe(false);
		expect(store.adultContent).toBe('');
		expect(store.adultContentConfirmation).toBe(false);
	});

	it('never writes the attestations to the draft', () => {
		const store = freshStore();
		store.nodeId = 'audio-ashzone-xeno';
		store.aiAttestation = true;
		store.rightsConfirmation = true;
		store.adultContent = 'yes';
		store.adultContentConfirmation = true;
		store.touch();
		vi.runAllTimers();

		const raw = localStorage.getItem(KEY) ?? '';
		expect(raw).toContain('audio-ashzone-xeno');
		expect(raw).not.toMatch(/attestation|adultContent|rightsConfirmation/i);
	});
});

describe('the rest of the draft still survives', () => {
	it('brings back the node and the edits in progress', () => {
		const store = freshStore({
			nodeId: 'comic-paper-lantern',
			entry: { creator: 'Paper Lantern Comics', why: 'A rewritten pitch.' }
		});
		expect(store.nodeId).toBe('comic-paper-lantern');
		expect(store.entry.why).toBe('A rewritten pitch.');
	});

	it('ignores a draft with no node id rather than half-loading it', () => {
		const store = freshStore({ entry: { creator: 'Orphaned' } });
		expect(store.nodeId).toBe('');
		expect(store.entry.creator).toBe('');
	});
});

describe('finding the node without knowing its id', () => {
	it('matches an exact id', () => {
		const store = freshStore();
		store.nodeId = 'audio-ashzone-xeno';
		store.lookup(RING);
		expect(store.node?.id).toBe('audio-ashzone-xeno');
		expect(store.notFound).toBe(false);
	});

	it('matches the site address someone would actually remember', () => {
		const store = freshStore();
		store.nodeId = 'ashzonemusic.bandcamp.com';
		store.lookup(RING);
		expect(store.node?.id).toBe('audio-ashzone-xeno');
	});

	it('matches a creator name', () => {
		const store = freshStore();
		store.nodeId = 'paper lantern';
		store.lookup(RING);
		expect(store.node?.id).toBe('comic-paper-lantern');
	});

	it('replaces what was typed with the real id once matched', () => {
		// The backend is asked about the node's own id, never the search text.
		const store = freshStore();
		store.nodeId = 'AshZone';
		store.lookup(RING);
		expect(store.nodeId).toBe('audio-ashzone-xeno');
	});

	it('seeds the edit step from the matched node', () => {
		const store = freshStore();
		store.nodeId = 'AshZone';
		store.lookup(RING);
		expect(store.entry.creator).toBe('AshZone');
		expect(store.entry.source_url).toBe('https://ashzonemusic.bandcamp.com/album/xeno');
		expect(store.entry.tags).toEqual(['ambient']);
	});

	it('offers a choice instead of guessing when several match', () => {
		/** @type {any[]} */
		const ambiguous = [
			{ id: 'a', creator: 'Paper Lantern Comics', type: 'comic', source_url: 'https://a.example' },
			{ id: 'b', creator: 'Paper Lantern Press', type: 'text', source_url: 'https://b.example' }
		];
		const store = freshStore();
		store.nodeId = 'paper lantern';
		store.lookup(ambiguous);

		expect(store.node).toBeNull();
		expect(store.matches.map((m) => m.id).sort()).toEqual(['a', 'b']);

		store.select(store.matches[0]);
		expect(store.node?.id).toBe('a');
		expect(store.matches).toEqual([]);
	});

	it('reports nothing found without blocking the flow', () => {
		const store = freshStore();
		store.nodeId = 'not-in-this-ring';
		store.lookup(RING);
		expect(store.node).toBeNull();
		expect(store.notFound).toBe(true);
		// Verification is the real gate, so an unmatched id still continues.
		expect(store.isStepComplete('identify')).toBe(true);
	});

	it('does not report "not found" for an empty field', () => {
		const store = freshStore();
		store.nodeId = '';
		store.lookup(RING);
		expect(store.notFound).toBe(false);
	});
});

describe('content-rule attestations on a change request', () => {
	it('are all required before a change can be sent', () => {
		const store = freshStore();
		expect(store.attestationsGiven).toBe(false);
		expect(Object.keys(store.attestationErrors)).toEqual([
			'ai_attestation',
			'rights_confirmation',
			'adult_content'
		]);

		store.aiAttestation = true;
		store.rightsConfirmation = true;
		store.adultContent = 'no';
		expect(store.attestationsGiven).toBe(true);
		expect(store.attestationErrors).toEqual({});
	});

	it('need the confirmation after a "yes"', () => {
		const store = freshStore();
		store.aiAttestation = true;
		store.rightsConfirmation = true;
		store.adultContent = 'yes';
		expect(store.attestationErrors).toEqual({
			adult_content_confirmation: 'Please confirm your adult content sits behind a content warning.'
		});
		store.adultContentConfirmation = true;
		expect(store.attestationsGiven).toBe(true);
	});

	it('drop a confirmation when the answer changes back to "no"', () => {
		const store = freshStore();
		store.adultContent = 'yes';
		store.adultContentConfirmation = true;
		store.adultContent = 'no';
		expect(store.adultContentConfirmation).toBe(false);
	});

	it('no longer gate the edit step, which only checks the entry itself', () => {
		const store = freshStore();
		store.nodeId = 'audio-ashzone-xeno';
		store.lookup(RING);
		store.entry.form = 'music';
		expect(store.entryErrors).toEqual({});
		// Nothing attested yet, and the edit step is still complete: the
		// attestations are asked on the review step, for every change.
		expect(store.attestationsGiven).toBe(false);
		expect(store.isStepComplete('edit')).toBe(true);
	});

	it('are cleared by reset', () => {
		const store = freshStore();
		store.aiAttestation = true;
		store.rightsConfirmation = true;
		store.adultContent = 'yes';
		store.adultContentConfirmation = true;

		store.reset();

		expect(store.aiAttestation).toBe(false);
		expect(store.rightsConfirmation).toBe(false);
		expect(store.adultContent).toBe('');
		expect(store.adultContentConfirmation).toBe(false);
	});

	it('refuse to send without them, even once everything else is in place', async () => {
		const store = freshStore();
		store.nodeId = 'audio-ashzone-xeno';
		store.lookup(RING);
		store.email = 'someone@example.com';

		await store.send();

		// Unverified as well, so this also holds without a backend; the
		// attested path end to end is testing/content-attestations.e2e.js.
		expect(store.reference).toBe('');
		expect(store.pending).toBe('idle');
	});
});

describe('withdrawing an entry', () => {
	/** Identified but not yet verified. */
	function identifiedStore() {
		const store = freshStore();
		store.nodeId = 'audio-ashzone-xeno';
		store.lookup(RING);
		return store;
	}

	it('starts out changing, not removing', () => {
		// Nothing should infer that someone meant to delete.
		expect(freshStore().intent).toBe('change');
	});

	it('moves to the remove step only when asked', () => {
		const store = identifiedStore();
		store.setIntent('remove');
		expect(store.intent).toBe('remove');
		expect(store.step).toBe('remove');
	});

	it('is not complete until explicitly armed', () => {
		const store = identifiedStore();
		store.setIntent('remove');
		expect(store.isStepComplete('remove')).toBe(false);
		store.removalConfirmed = true;
		expect(store.isStepComplete('remove')).toBe(true);
	});

	it('disarms when someone changes their mind and comes back', () => {
		const store = identifiedStore();
		store.setIntent('remove');
		store.removalConfirmed = true;
		store.setIntent('change');
		store.setIntent('remove');
		// Ticking it once should not still count after a detour.
		expect(store.removalConfirmed).toBe(false);
	});

	it('refuses to send without verification, however armed', async () => {
		const store = identifiedStore();
		store.setIntent('remove');
		store.removalConfirmed = true;
		expect(store.verified, 'precondition: control was never proven').toBe(false);

		await store.sendRemoval();

		expect(store.reference).toBe('');
	});

	// The armed-and-verified path is deliberately not asserted here. Reaching
	// `verified` needs a backend answer, and whether these tests get the dev
	// mock or a real one depends on whether a VITE_SUBMISSION_WEBHOOK_URL
	// happens to be set in the environment running them — which differs
	// between a developer's machine and CI. A test that changes meaning
	// depending on where it runs is worse than an absent one. The arming rule
	// is covered by `isStepComplete` above, and the whole walk end to end by
	// testing/update-remove.e2e.js.

	it('clears the whole intent on reset', () => {
		const store = identifiedStore();
		store.setIntent('remove');
		store.removalReason = 'The project ended.';
		store.removalConfirmed = true;

		store.reset();

		expect(store.intent).toBe('change');
		expect(store.removalReason).toBe('');
		expect(store.removalConfirmed).toBe(false);
		expect(store.step).toBe('identify');
	});
});
