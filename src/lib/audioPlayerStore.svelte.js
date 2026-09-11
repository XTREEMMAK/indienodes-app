/**
 * The playback queue.
 *
 * Owns *what is queued and where playback is in it*, not the audio element
 * itself: `AudioPlayer.svelte` holds the single `<audio>` tag and drives it
 * from this state. Splitting it that way is what lets a play button on a
 * node, the queue list, and the end-of-queue prompt all talk to one queue
 * without any of them needing a reference to the element.
 *
 * Deliberately **not** persisted, unlike favorites, preferences, and the
 * layout. A queue is a thing you are doing right now, and restoring one on a
 * later visit would mean the site starts holding audio you did not just ask
 * for, which is the wrong side of the brief's "nothing plays without the
 * visitor asking" rule (section 11) even if it stayed paused.
 *
 * One entry can contribute several tracks (the schema caps audio at three),
 * so a queue item is a *track*, tagged with the entry it came from, which is
 * what lets the UI group by entry and lets "add this node" append all of its
 * tracks in one action.
 */

import { preferencesStore } from './preferencesStore.svelte.js';

/** @typedef {import('./ring.js').RingEntry} RingEntry */

/**
 * @typedef {object} QueueItem
 * @property {string} key stable per queue position, so reordering a list of
 *   duplicates cannot make two items collide in a keyed `{#each}`
 * @property {string} entryId
 * @property {string} creator the node this track came from; a node is a
 *   creator, not a single work, so this is the item's identity, not a
 *   work-level title (there is no such field any more)
 * @property {string} label track label
 * @property {string} url
 * @property {string | null} cover
 * @property {string[]} tags carried per item so the end-of-queue suggestion
 *   can match on what was actually played, without re-reading ring.json
 * @property {string} [form] 'music' | 'spoken', carried per item so the
 *   end-of-queue suggestion can restrict to the same form without
 *   re-reading ring.json -- Keep going must never mix the two
 */

let nextKey = 0;

/**
 * Flattens an entry into its playable tracks. Entries whose tracks have no
 * usable URL are dropped rather than queued as silent items.
 * @param {RingEntry} entry
 * @param {string | null} cover
 * @returns {QueueItem[]}
 */
function itemsFor(entry, cover) {
	return (entry.tracks ?? [])
		.filter((track) => typeof track.media_url === 'string' && track.media_url.length > 0)
		.map((track) => {
			nextKey += 1;
			return {
				key: `q-${nextKey}`,
				entryId: entry.id,
				creator: entry.creator,
				label: track.label,
				url: track.media_url,
				cover,
				tags: entry.tags ?? [],
				form: entry.form
			};
		});
}

/**
 * Returns a fresh shuffled array without disturbing the entry's canonical
 * track order. Fisher-Yates gives every position the same chance and keeps
 * the operation local to the node being added, so an existing hand-built
 * playlist never moves underneath the listener.
 * @param {QueueItem[]} items
 * @returns {QueueItem[]}
 */
function shuffled(items) {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

/**
 * Queue actions honour the visitor's ordering preference. Preview actions
 * deliberately continue to use `itemsFor` directly: auditioning track one
 * should not choose a different track merely because later queue insertion
 * is randomized.
 * @param {RingEntry} entry
 * @param {string | null} cover
 * @returns {QueueItem[]}
 */
function queueItemsFor(entry, cover) {
	const items = itemsFor(entry, cover);
	return preferencesStore.randomizeAudioTracks ? shuffled(items) : items;
}

function createAudioPlayerStore() {
	/** @type {QueueItem[]} */
	let queue = $state([]);
	let index = $state(0);
	let playing = $state(false);
	// Set when the queue runs off its own end, and *only* then. This is what
	// the brief calls the "keep going" prompt (section 8): an explicit,
	// un-defaulted choice, never an automatic continuation, so reaching the
	// end stops playback and raises this rather than picking something new.
	let atEnd = $state(false);
	// Mobile's detailed player replaces the primary nav while it is open.
	// Its visibility is shared because AudioPlayer owns that replacement bar
	// while the layout restores the nav when the player is hidden.
	let mobilePanelOpen = $state(false);
	// Whether the queue panel is expanded. Lives here rather than in the
	// component so "add to queue" from a node can open it, which is the only
	// feedback that action has when the player is already playing something.
	let queueOpen = $state(false);

	// The preview lane. Deliberately a single item beside the queue rather
	// than a position inside it: a preview is an audition, and the whole
	// point is that auditioning something does not disturb a queue the
	// visitor may have built by hand. It never enters `queue` unless they
	// promote it with "+ Queue", never advances the playhead, and never
	// raises `atEnd`, because it is not part of the sequence that can end.
	/** @type {QueueItem | null} */
	let previewItem = $state(null);
	let previewPlaying = $state(false);
	let previewCompletion = $state({ sequence: 0, entryId: '' });
	// The entry the preview came from, kept alongside the single track being
	// auditioned. Promoting has to queue the *whole* node, not just the one
	// track that happened to be sounding: "add this" means the release, the
	// same as `addEntry` from the node's own button. Without this the store
	// would only have the flattened item and could not get back to its
	// siblings.
	/** @type {{ entry: RingEntry, cover: string | null } | null} */
	let previewSource = null;

	return {
		get queue() {
			return queue;
		},
		get index() {
			return index;
		},
		get playing() {
			return playing;
		},
		get atEnd() {
			return atEnd;
		},
		get mobilePanelOpen() {
			return mobilePanelOpen;
		},
		get queueOpen() {
			return queueOpen;
		},
		get current() {
			return queue[index] ?? null;
		},
		get isEmpty() {
			return queue.length === 0;
		},

		/**
		 * Whether a given entry is the one currently playing, so a node can
		 * show its own state rather than every audio node looking identical
		 * while one of them is the source of the sound.
		 * @param {string} entryId
		 */
		isCurrentEntry(entryId) {
			return queue[index]?.entryId === entryId;
		},

		get previewItem() {
			return previewItem;
		},
		get previewPlaying() {
			return previewPlaying;
		},
		get previewCompletion() {
			return previewCompletion;
		},
		get isPreviewing() {
			return previewItem !== null;
		},

		/**
		 * Whether a given entry is the one being previewed, so its node can
		 * show a stop control instead of offering to start it again.
		 * @param {string} entryId
		 */
		isPreviewEntry(entryId) {
			return previewItem?.entryId === entryId;
		},

		/**
		 * Auditions an entry without touching the queue. Only the first track:
		 * "let me hear this" is a different request from "play this album,"
		 * and the second one is what `playEntry` and `addEntry` are for.
		 * @param {RingEntry} entry
		 * @param {string | null} cover
		 * @param {{ autoplay?: boolean, trackIndex?: number }} [options]
		 */
		previewEntry(entry, cover, { autoplay = true, trackIndex = 0 } = {}) {
			const items = itemsFor(entry, cover);
			if (items.length === 0) return false;
			previewItem = items[trackIndex] ?? items[0];
			previewSource = { entry, cover };
			previewPlaying = autoplay;
			return true;
		},

		togglePreview() {
			if (!previewItem) return;
			previewPlaying = !previewPlaying;
		},

		stopPreview() {
			previewItem = null;
			previewSource = null;
			previewPlaying = false;
		},

		finishPreview() {
			const entryId = previewItem?.entryId ?? '';
			previewItem = null;
			previewSource = null;
			previewPlaying = false;
			previewCompletion = {
				sequence: previewCompletion.sequence + 1,
				entryId
			};
		},

		/**
		 * Moves the previewed entry into the queue: the one action that turns
		 * an audition into a commitment. Ends the preview, because the item is
		 * now part of the sequence and having it in both lanes would mean it
		 * plays twice.
		 *
		 * Queues **every** track of the entry, not just the one that was
		 * sounding. Auditioning is per-track by design (you want to hear it,
		 * not commit to a release), but adding is per-entry everywhere else in
		 * this app, and adding a three-track EP by way of a preview should not
		 * quietly give you one third of it.
		 */
		promotePreview() {
			if (!previewSource) return false;
			const items = queueItemsFor(previewSource.entry, previewSource.cover);
			if (items.length === 0) return false;
			queue = [...queue, ...items];
			atEnd = false;
			queueOpen = true;
			previewItem = null;
			previewSource = null;
			previewPlaying = false;
			return true;
		},

		/**
		 * Fed by the preview element's own play/pause events. No-op writes are
		 * ignored for the same reason `setPlaying` ignores them: these events
		 * fire far more often than the value actually changes.
		 * @param {boolean} value
		 */
		setPreviewPlaying(value) {
			if (previewPlaying === value) return;
			previewPlaying = value;
		},

		/**
		 * Replaces the queue with this entry's tracks and starts it. The
		 * "play this node" action.
		 * @param {RingEntry} entry
		 * @param {string | null} cover
		 */
		playEntry(entry, cover) {
			const items = queueItemsFor(entry, cover);
			if (items.length === 0) return false;
			queue = items;
			index = 0;
			atEnd = false;
			playing = true;
			mobilePanelOpen = true;
			return true;
		},

		/**
		 * Appends an entry's tracks without touching what is currently
		 * playing. The explicit ask: adding another node to the playlist must
		 * not interrupt the current track.
		 *
		 * If nothing is queued yet this starts playback, since "add" with an
		 * empty queue and no playback would otherwise silently do nothing
		 * visible.
		 * @param {RingEntry} entry
		 * @param {string | null} cover
		 * @param {{ openQueue?: boolean }} [options]
		 */
		addEntry(entry, cover, { openQueue = true } = {}) {
			const items = queueItemsFor(entry, cover);
			if (items.length === 0) return false;
			const wasEmpty = queue.length === 0;
			queue = [...queue, ...items];
			if (wasEmpty) {
				index = 0;
				playing = true;
				mobilePanelOpen = true;
			}
			// Clearing this matters: the queue had ended, and it now has
			// somewhere to go again, so the prompt is stale.
			atEnd = false;
			if (openQueue) queueOpen = true;
			return true;
		},

		/**
		 * Moves a queue item. Used by the reorder controls.
		 *
		 * `index` is adjusted rather than left pointing at a position, so
		 * moving items around does not change *which track is playing*: the
		 * queue is being reordered underneath a playhead, not seeked.
		 * @param {number} from
		 * @param {number} to
		 */
		move(from, to) {
			if (from === to) return;
			if (from < 0 || from >= queue.length) return;
			if (to < 0 || to >= queue.length) return;

			const playingKey = queue[index]?.key;
			const next = [...queue];
			const [moved] = next.splice(from, 1);
			next.splice(to, 0, moved);
			queue = next;

			const found = next.findIndex((item) => item.key === playingKey);
			if (found >= 0) index = found;
		},

		/** @param {number} at */
		removeAt(at) {
			if (at < 0 || at >= queue.length) return;
			const wasCurrent = at === index;
			queue = queue.filter((_, i) => i !== at);

			if (queue.length === 0) {
				index = 0;
				playing = false;
				atEnd = false;
				queueOpen = false;
				mobilePanelOpen = false;
				return;
			}
			// Removing something earlier in the queue shifts the playhead back
			// with it; removing the current item leaves the playhead where it
			// is, which is now the following track, clamped to the new end.
			if (at < index) index -= 1;
			if (index >= queue.length) index = queue.length - 1;
			if (wasCurrent) playing = true;
		},

		/**
		 * Drops every queued track belonging to one entry. The brief's own case
		 * (section 8) is marking a node Not for Me mid-queue: its remaining
		 * tracks have to go, and if one of them was playing, playback has to
		 * move on to the next *node's* first track, not just the next track
		 * position (which could belong to the very entry just dismissed).
		 * @param {string} entryId
		 */
		removeEntry(entryId) {
			if (queue.length === 0) return;
			const currentKey = queue[index]?.key;
			const wasCurrent = queue[index]?.entryId === entryId;

			// Captured before filtering: the first surviving item after the
			// current position is what "advances to the next node" points at.
			let fallbackKey = null;
			if (wasCurrent) {
				for (let i = index + 1; i < queue.length; i += 1) {
					if (queue[i].entryId !== entryId) {
						fallbackKey = queue[i].key;
						break;
					}
				}
			}

			queue = queue.filter((item) => item.entryId !== entryId);

			if (queue.length === 0) {
				index = 0;
				playing = false;
				atEnd = false;
				queueOpen = false;
				mobilePanelOpen = false;
				return;
			}

			if (wasCurrent) {
				const found = fallbackKey ? queue.findIndex((item) => item.key === fallbackKey) : -1;
				if (found >= 0) {
					index = found;
					playing = true;
				} else {
					// Nothing survived after it either: the queue effectively ended
					// here, same as running off the end during `next()`.
					index = queue.length - 1;
					playing = false;
					atEnd = true;
				}
				return;
			}

			// Not the entry that was playing: keep the same track playing,
			// correcting the index for whatever shifted out from under it.
			const found = queue.findIndex((item) => item.key === currentKey);
			if (found >= 0) index = found;
		},

		/** @param {number} at */
		jumpTo(at) {
			if (at < 0 || at >= queue.length) return;
			index = at;
			atEnd = false;
			playing = true;
		},

		next() {
			if (queue.length === 0) return;
			if (index >= queue.length - 1) {
				// End of the queue: stop and ask, rather than looping or
				// auto-continuing into something nobody chose.
				playing = false;
				atEnd = true;
				return;
			}
			index += 1;
			playing = true;
		},

		prev() {
			if (queue.length === 0) return;
			atEnd = false;
			// Standard transport behavior: past the first few seconds, Previous
			// restarts the current track instead of leaving it. The component
			// owns playback position, so it decides which of these to call.
			if (index > 0) index -= 1;
			playing = true;
		},

		toggle() {
			if (queue.length === 0) return;
			// Un-pausing after the queue ended should replay from the top
			// rather than sit on a finished last track doing nothing.
			if (atEnd) {
				index = 0;
				atEnd = false;
				playing = true;
				return;
			}
			playing = !playing;
		},

		/**
		 * Guarded against no-op writes. This is fed directly by the audio
		 * element's `play` and `pause` events, which fire far more often than
		 * the value actually changes, and every write wakes anything derived
		 * from it. Cheap insurance against the kind of feedback loop that
		 * once flapped this thousands of times a second.
		 * @param {boolean} value
		 */
		setPlaying(value) {
			if (playing !== value) playing = value;
		},

		/** Dismisses the end-of-queue prompt without queueing anything new. */
		stop() {
			atEnd = false;
			playing = false;
		},

		clear() {
			queue = [];
			index = 0;
			playing = false;
			atEnd = false;
			queueOpen = false;
			mobilePanelOpen = false;
		},

		openMobilePanel() {
			if (queue.length > 0) mobilePanelOpen = true;
		},

		closeMobilePanel() {
			mobilePanelOpen = false;
			queueOpen = false;
		},

		toggleQueueOpen() {
			queueOpen = !queueOpen;
		},

		/** @param {boolean} value */
		setQueueOpen(value) {
			queueOpen = value;
		}
	};
}

export const audioPlayerStore = createAudioPlayerStore();
