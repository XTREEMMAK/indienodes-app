/** Short transport envelope, independent of the listener's volume setting. */
export const PLAYBACK_FADE_MS = 80;

/**
 * Apply one playback intent. Cancelling preserves the current gain so a quick
 * reversal continues smoothly and an old pause cannot stop resumed playback.
 * The play fade waits for play() to resolve, including buffered starts.
 * @param {Pick<HTMLMediaElement, 'paused' | 'play' | 'pause'>} element
 * @param {boolean} playing
 * @param {number} from
 * @param {(gain: number) => void} onGain
 * @param {() => void} onError
 * @returns {() => void}
 */
export function fadePlayback(element, playing, from, onGain, onError) {
	let cancelled = false;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;

	function ramp() {
		if (cancelled) return;
		const started = performance.now();
		const target = playing ? 1 : 0;
		function step() {
			if (cancelled) return;
			const t = Math.min(1, (performance.now() - started) / PLAYBACK_FADE_MS);
			const eased = (1 - Math.cos(Math.PI * t)) / 2;
			onGain(from + (target - from) * eased);
			if (t < 1) timer = setTimeout(step, 8);
			else if (!playing && !element.paused) element.pause();
		}
		step();
	}

	if (playing && element.paused) {
		from = 0;
		onGain(0);
		element
			.play()
			.then(ramp)
			.catch(() => {
				if (!cancelled) onError();
			});
	} else if (!playing && element.paused) {
		onGain(0);
	} else {
		ramp();
	}

	return () => {
		cancelled = true;
		clearTimeout(timer);
	};
}
