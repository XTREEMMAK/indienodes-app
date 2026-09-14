/**
 * Will a track's host let it drive the reactive background?
 *
 * The player can only analyse audio fetched in CORS mode, and a host that does
 * not send `Access-Control-Allow-Origin` refuses that fetch outright (see
 * `AudioPlayer.svelte`'s `loadTrack` and `handleMediaError`). Nothing about a
 * URL's shape says which kind of host it is, and the submission backend cannot
 * answer either: CORS is enforced by the browser, for this site's origin, so
 * the only faithful test is this page asking the browser the same question the
 * player will.
 *
 * So this loads the file's metadata the way the player does: first in CORS
 * mode, then, only if that fails, without it. Nothing is played and nothing
 * leaves the creator's own browser. It is advice, not a gate: a host without
 * the header still joins the ring, and the creator is told what they lose.
 */

/**
 * - `reactive`: loads in CORS mode. Plays here and drives the background.
 * - `no_cors`: loads only without CORS. Plays, but the host needs the header.
 * - `unplayable`: the browser could not load it as audio in either mode.
 * - `timeout`: no answer in time, so no verdict.
 * - `invalid`: not an https:// URL, so nothing was requested.
 * @typedef {'reactive' | 'no_cors' | 'unplayable' | 'timeout' | 'invalid'} AudioCorsVerdict
 */

export const AUDIO_CORS_TIMEOUT_MS = 15_000;

/**
 * @typedef {Pick<HTMLAudioElement, 'crossOrigin' | 'preload' | 'src' | 'addEventListener' | 'removeEventListener' | 'removeAttribute' | 'load'>} AudioLike
 */

/**
 * @param {string} url
 * @param {'anonymous' | null} crossOrigin
 * @param {() => AudioLike} createAudio
 * @param {number} timeoutMs
 * @returns {Promise<'loaded' | 'error' | 'timeout'>}
 */
function loadMetadata(url, crossOrigin, createAudio, timeoutMs) {
	return new Promise((resolve) => {
		const audio = createAudio();
		/** @type {ReturnType<typeof setTimeout>} */
		let timer;
		/** @param {'loaded' | 'error' | 'timeout'} outcome */
		const finish = (outcome) => {
			clearTimeout(timer);
			audio.removeEventListener('loadedmetadata', onLoaded);
			audio.removeEventListener('error', onError);
			// Releases the connection rather than leaving a half-loaded resource
			// hanging off a detached element until it is collected.
			audio.removeAttribute('src');
			audio.load();
			resolve(outcome);
		};
		const onLoaded = () => finish('loaded');
		const onError = () => finish('error');
		audio.addEventListener('loadedmetadata', onLoaded);
		audio.addEventListener('error', onError);
		timer = setTimeout(() => finish('timeout'), timeoutMs);
		// Same order as the player: the mode has to be chosen before `src`.
		audio.crossOrigin = crossOrigin;
		audio.preload = 'metadata';
		audio.src = url;
	});
}

/**
 * @param {string} url
 * @param {{ createAudio?: () => AudioLike, timeoutMs?: number }} [options]
 * @returns {Promise<AudioCorsVerdict>}
 */
export async function checkAudioCors(url, options = {}) {
	const createAudio = options.createAudio ?? (() => new Audio());
	const timeoutMs = options.timeoutMs ?? AUDIO_CORS_TIMEOUT_MS;

	let parsed;
	try {
		parsed = new URL(url.trim());
	} catch {
		return 'invalid';
	}
	if (parsed.protocol !== 'https:') return 'invalid';

	const cors = await loadMetadata(parsed.href, 'anonymous', createAudio, timeoutMs);
	if (cors === 'loaded') return 'reactive';
	if (cors === 'timeout') return 'timeout';

	const plain = await loadMetadata(parsed.href, null, createAudio, timeoutMs);
	if (plain === 'loaded') return 'no_cors';
	return plain === 'timeout' ? 'timeout' : 'unplayable';
}

/**
 * @param {AudioCorsVerdict} verdict
 * @returns {{ tone: 'ok' | 'warn' | 'error', text: string }}
 */
export function audioCorsMessage(verdict) {
	switch (verdict) {
		case 'reactive':
			return {
				tone: 'ok',
				text: 'Ready. This track plays here and drives the reactive background.'
			};
		case 'no_cors':
			return {
				tone: 'warn',
				text: "This track loads, but its host doesn't allow cross-origin playback, so it won't drive the reactive background. Host it on File Garden, or add the header on your own site (see the hosting help below)."
			};
		case 'unplayable':
			return {
				tone: 'error',
				text: "This link couldn't be loaded as audio. Make sure it's public and points at the audio file itself (MP3, OGG, or similar), not a page."
			};
		case 'timeout':
			return {
				tone: 'warn',
				text: "The host didn't answer in time. Check the link, then try again."
			};
		case 'invalid':
		default:
			return { tone: 'error', text: 'Use a public https:// link to the file.' };
	}
}
