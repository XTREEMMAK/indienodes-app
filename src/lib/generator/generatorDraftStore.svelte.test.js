/**
 * Client project (real IndexedDB), for the same reason as draftDb's own tests.
 *
 * These pin the debounce: every patch handed to `save()` must reach the
 * stored draft, not only the last one, and `saveNow()` must write a pending
 * debounced patch rather than cancel it. Both used to lose fields — the join
 * page commits several staged fields back to back on blur and on leaving.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteDraft, getDraft } from './draftDb.js';
import { generatorDraftStore } from './generatorDraftStore.svelte.js';

/** Longer than the store's 400ms debounce. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

beforeEach(async () => {
	await generatorDraftStore.discard();
	await deleteDraft();
});

afterEach(async () => {
	await generatorDraftStore.discard();
});

describe('generatorDraftStore persistence', () => {
	it('persists every patch from rapid saves, not just the last', async () => {
		generatorDraftStore.save({ generator: { displayName: 'Ada' } });
		generatorDraftStore.save({ generator: { templateId: 'late-signal' } });
		generatorDraftStore.save({ entry: { creator: 'Ada L.' } });
		await settle();

		const draft = await getDraft();
		expect(draft?.generator.displayName).toBe('Ada');
		expect(draft?.generator.templateId).toBe('late-signal');
		expect(draft?.entry.creator).toBe('Ada L.');
	});

	it('lets a later save of the same key win', async () => {
		generatorDraftStore.save({ generator: { displayName: 'First' } });
		generatorDraftStore.save({ generator: { displayName: 'Second' } });
		await settle();

		expect((await getDraft())?.generator.displayName).toBe('Second');
	});

	it('writes a pending debounced save when saveNow runs', async () => {
		generatorDraftStore.save({ generator: { bio: 'A paragraph.' } });
		await generatorDraftStore.saveNow({ generator: { icon: null } });

		// Read immediately: saveNow must not have left the bio to a timer it
		// just cancelled.
		const draft = await getDraft();
		expect(draft?.generator.bio).toBe('A paragraph.');
		expect(draft).toHaveProperty('generator.icon', null);
	});

	it('does not write a queued save after discard', async () => {
		generatorDraftStore.save({ generator: { displayName: 'Gone' } });
		await generatorDraftStore.discard();
		await settle();

		expect(await getDraft()).toBeNull();
	});
});
