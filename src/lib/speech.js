/**
 * Reading text aloud, using the browser's own synthesiser.
 *
 * `docs/roadmap.md` named [tiny-tts](https://github.com/tronghieuit/tiny-tts)
 * for this and left three questions open: which voice, whose synthesis, and
 * whether it stays local-only. Those are answered here, and the answer changed
 * the pick.
 *
 * **Whose synthesis: the browser's.** tiny-tts is a real option — Apache-2.0,
 * genuinely local, one consistent voice everywhere — but it is a ~3.4 MB ONNX
 * model plus the ONNX Runtime WASM to execute it. The thing being read is an
 * `excerpts` array the schema caps at three short samples. Shipping several
 * megabytes of neural synthesiser to read a paragraph is the wrong trade for a
 * project whose stated thesis is staying lightweight, and it would be a
 * dependency-posture change of exactly the kind `decisions.md` treats as
 * significant. `speechSynthesis` costs zero bytes and is already installed on
 * every device that can open the site.
 *
 * **Whether it stays local-only: yes, and it is checked rather than promised.**
 * The privacy hazard people associate with the Web Speech API belongs to its
 * *other* half — `SpeechRecognition` uploads audio to a vendor server. Speech
 * *synthesis* is a different code path, and voices carry a `localService` flag
 * saying whether they run on-device. `pickVoice` below refuses a remote one, so
 * "the text never leaves the browser" is enforced by the API rather than
 * asserted in a comment. A device offering only remote voices reports no voice
 * at all, and the caller hides the control.
 *
 * **Which voice: whichever local one matches the page language,** preferring
 * the platform default. Not a configurable setting, because the honest set of
 * choices differs on every OS and a voice picker listing whatever this machine
 * happens to have is not a preference worth persisting across devices.
 */

/**
 * Whether this browser can synthesise speech at all. Cheap enough to call in
 * a `$derived`, and false during SSR, where `window` does not exist.
 */
export function speechSupported() {
	return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * The best on-device voice for `lang`, or null when the device has none.
 *
 * Returning null is a real outcome, not a failure: some platforms populate
 * `getVoices()` only with network voices, and this refuses those rather than
 * quietly sending the text to a vendor. Callers treat null as "no read
 * control", the same unset-means-off posture used elsewhere in this app.
 *
 * @param {string} [lang] BCP-47 tag; matched on the primary subtag only, so
 *   `en-GB` is an acceptable voice for an `en` page.
 * @returns {SpeechSynthesisVoice | null}
 */
export function pickVoice(lang = 'en') {
	if (!speechSupported()) return null;
	// Populated asynchronously on some browsers; an empty list here just means
	// "not yet", which is why callers re-check on `voiceschanged`.
	const local = window.speechSynthesis.getVoices().filter((voice) => voice.localService);
	if (local.length === 0) return null;

	const base = lang.split('-')[0].toLowerCase();
	const matching = local.filter((voice) => voice.lang?.split('-')[0].toLowerCase() === base);
	const pool = matching.length > 0 ? matching : local;
	return pool.find((voice) => voice.default) ?? pool[0];
}

/**
 * Splits text into utterance-sized chunks.
 *
 * Long strings are unreliable across engines — some truncate, some stall part
 * way through — and a single utterance is also all-or-nothing to cancel.
 * Splitting on sentence boundaries keeps each piece short enough to be spoken
 * reliably and gives the caller a natural place to stop.
 *
 * @param {string} text
 * @param {number} [maxLength]
 * @returns {string[]}
 */
export function chunkForSpeech(text, maxLength = 220) {
	const clean = String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!clean) return [];

	/** @type {string[]} */
	const chunks = [];
	let current = '';
	// Keep the punctuation with the sentence it ends, so the synthesiser still
	// hears a question as a question.
	for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
		if (sentence.length > maxLength) {
			if (current) {
				chunks.push(current);
				current = '';
			}
			// A single sentence longer than the cap still has to be said, so it
			// is broken on whitespace rather than dropped or spoken as one
			// oversized utterance.
			let rest = sentence;
			while (rest.length > maxLength) {
				const cut = rest.lastIndexOf(' ', maxLength);
				const at = cut > 0 ? cut : maxLength;
				chunks.push(rest.slice(0, at).trim());
				rest = rest.slice(at).trim();
			}
			if (rest) current = rest;
			continue;
		}
		if (!current) {
			current = sentence;
		} else if (current.length + sentence.length + 1 <= maxLength) {
			current = `${current} ${sentence}`;
		} else {
			chunks.push(current);
			current = sentence;
		}
	}
	if (current) chunks.push(current);
	return chunks;
}

/**
 * Speaks `text`, calling `onDone` when it finishes or is stopped.
 *
 * Cancels anything already speaking first: two voices at once is unusable, and
 * the synthesiser queues by default rather than replacing.
 *
 * @param {string} text
 * @param {{ voice?: SpeechSynthesisVoice | null, lang?: string, onDone?: () => void }} [options]
 * @returns {() => void} stop function; safe to call after it has finished
 */
export function speak(text, { voice = null, lang = 'en', onDone } = {}) {
	if (!speechSupported()) {
		onDone?.();
		return () => {};
	}

	const chunks = chunkForSpeech(text);
	if (chunks.length === 0) {
		onDone?.();
		return () => {};
	}

	const resolved = voice ?? pickVoice(lang);
	if (!resolved) {
		onDone?.();
		return () => {};
	}
	/** Narrowed once, so the closure below does not re-widen it to null. */
	const chosen = resolved;

	let stopped = false;
	window.speechSynthesis.cancel();
	// Mobile engines can leave the shared synthesiser paused after an audio
	// interruption or background/foreground cycle. Resume is harmless when it
	// is already active and keeps a user-initiated read from failing silently.
	window.speechSynthesis.resume?.();

	let index = 0;
	// Keep a strong reference for the life of each chunk. Some mobile WebViews
	// garbage-collect an otherwise unreferenced utterance while it is speaking,
	// which presents as Read aloud starting and then immediately going silent.
	let activeUtterance = /** @type {SpeechSynthesisUtterance | null} */ (null);
	function next() {
		if (stopped) return;
		if (index >= chunks.length) {
			activeUtterance = null;
			onDone?.();
			return;
		}
		const utterance = new SpeechSynthesisUtterance(chunks[index]);
		index += 1;
		utterance.voice = chosen;
		utterance.lang = chosen.lang || lang;
		utterance.onend = () => {
			activeUtterance = null;
			next();
		};
		// A failed chunk should not strand the rest of the passage silent.
		utterance.onerror = () => {
			activeUtterance = null;
			next();
		};
		activeUtterance = utterance;
		window.speechSynthesis.resume?.();
		window.speechSynthesis.speak(utterance);
	}
	next();

	return () => {
		if (stopped) return;
		stopped = true;
		activeUtterance = null;
		window.speechSynthesis.cancel();
		onDone?.();
	};
}
