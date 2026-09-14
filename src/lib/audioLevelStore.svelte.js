/**
 * Live loudness of whatever is playing, for effects that want to react to it.
 *
 * Written into by `AudioPlayer.svelte` (the only component with the audio
 * element) and read by `AmbientBackground.svelte`. A store rather than a prop
 * chain because those two are mounted as siblings in the root layout and
 * neither owns the other.
 *
 * **This is silent for most audio, by construction.** Reading samples out of
 * a media element requires Web Audio, and Web Audio refuses to analyse a
 * cross-origin resource unless its host sends `Access-Control-Allow-Origin`.
 * Worse than refusing: connecting a `MediaElementAudioSourceNode` to a
 * stream that has not opted in routes the audio through a graph that outputs
 * **zeros**, so the visitor hears nothing at all. Measured directly against
 * Bandcamp's own CDN, which sends no CORS header on either its stream URLs or
 * its pages:
 *
 * - `crossorigin="anonymous"` on the element: the stream fails to load
 *   outright (`MEDIA_ELEMENT_ERROR`, code 4).
 * - No attribute, analyser attached anyway: every frequency bin reads 0,
 *   which is the same silence the visitor would get.
 *
 * So the player tries CORS mode first and, for a host that refuses, moves the
 * track to a second audio element that is never wired into Web Audio (see
 * `plainEl` in `AudioPlayer.svelte`). It has to be a second element: once one
 * has been wired, anything it loads without CORS comes out as zeros. Those
 * tracks simply don't drive this store. A reactive background is a key part
 * of the experience, and `/join` steers creators to hosts that allow it, but
 * audible music is the product. See `docs/decisions.md`.
 */

function createAudioLevelStore() {
	// Smoothed overall loudness, 0 to 1. Drives sustained speed.
	let level = $state(0);
	// A short-lived spike, 0 to 1, raised when energy jumps sharply and decayed
	// every frame after. Separate from `level` because a kick drum and a loud
	// sustained pad are different things to react to, and a background that
	// only tracked average loudness would drift faster during the pad and do
	// nothing at all on the beat.
	let pulse = $state(0);
	// Whether analysis is actually running. Effects read this to decide
	// whether to react at all, rather than inferring it from a level of 0,
	// which is also what silence looks like.
	let active = $state(false);
	// Incremented once per especially strong beat (AudioPlayer's own
	// BIG_HIT_RATIO), never reset to 0. Edge-triggered rather than a
	// boolean flag so a consumer's own `$effect` can watch for the id
	// *changing* and fire a one-shot reaction, the same "track an id, not
	// a boolean" pattern this app already uses elsewhere (e.g. the Lists
	// bulk-select work's `anchorIndex`) — a boolean would need resetting
	// somewhere, and there is no single frame that is obviously "done."
	let bigHitId = $state(0);

	return {
		get level() {
			return level;
		},
		get pulse() {
			return pulse;
		},
		get active() {
			return active;
		},
		get bigHitId() {
			return bigHitId;
		},

		/**
		 * @param {number} nextLevel 0..1
		 * @param {number} nextPulse 0..1
		 */
		report(nextLevel, nextPulse) {
			level = nextLevel;
			pulse = nextPulse;
			if (!active) active = true;
		},

		/** Called once per qualifying big hit; see `bigHitId`'s own comment above. */
		reportBigHit() {
			bigHitId += 1;
		},

		/** Analysis stopped or was never possible; effects fall back to idle. */
		reset() {
			level = 0;
			pulse = 0;
			active = false;
		}
	};
}

export const audioLevelStore = createAudioLevelStore();
