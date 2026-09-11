/**
 * Picking what to offer when a queue ends.
 *
 * A plain module, not `.svelte.js`: this is a pure function over data with
 * no reactive state of its own, and keeping it out of the store file is
 * what lets it use ordinary `Set`s for scratch lookups. (In a `.svelte.js`
 * file the `svelte/prefer-svelte-reactivity` lint rule flags every plain
 * `Set`, correctly in general and wrongly here, since nothing about these
 * is meant to be reactive.)
 */

/** @typedef {import('./ring.js').RingEntry} RingEntry */
/** @typedef {import('./audioPlayerStore.svelte.js').QueueItem} QueueItem */

/**
 * Picks the next entry to suggest when a queue ends.
 *
 * Weighted by shared tags with what was just played, which is what the
 * brief's "keep going" expansion asks for (section 8): it draws only on
 * declared `tags` data, never on inferred behavior, and it is only ever
 * offered behind an explicit prompt. There is no per-node genre preference
 * to read yet (that arrives with per-node tag channels, see
 * `docs/roadmap.md`), so "their node preferences" currently means the tags
 * of the audio they actually just chose to play, which is the closest
 * honest proxy available.
 *
 * Falls back to a random unplayed audio entry when nothing shares a tag, so
 * the prompt is never a dead end in a ring whose entries have no tags in
 * common, and so the fallback is not just "whichever happened to be first".
 *
 * Never crosses `form`: a spoken piece and a soundtrack can share every tag,
 * so the expansion is restricted to whatever form was just playing before
 * tags are even considered (see the addendum on audio form, section 5 --
 * "Keep going" never mixes forms). `!playedForm` is a defensive fallback for
 * a queue item somehow missing `form` post-migration; it is not a way to
 * silently default a form, just a way for the prompt to still offer
 * something rather than nothing in that edge case.
 *
 * @param {RingEntry[]} entries the whole ring
 * @param {QueueItem[]} played the queue that just finished
 * @returns {RingEntry | null}
 */
export function suggestNext(entries, played) {
	const playedIds = new Set(played.map((item) => item.entryId));
	const playedTags = new Set(played.flatMap((item) => item.tags));
	const playedForm = played[0]?.form;

	const candidates = entries.filter(
		(entry) =>
			entry.type === 'audio' &&
			!playedIds.has(entry.id) &&
			(entry.tracks?.length ?? 0) > 0 &&
			(!playedForm || entry.form === playedForm)
	);
	if (candidates.length === 0) return null;

	let best = null;
	let bestScore = -1;
	for (const entry of candidates) {
		const score = (entry.tags ?? []).filter((tag) => playedTags.has(tag)).length;
		if (score > bestScore) {
			bestScore = score;
			best = entry;
		}
	}

	if (bestScore <= 0) return candidates[Math.floor(Math.random() * candidates.length)];
	return best;
}
