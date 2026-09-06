import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fadePlayback } from './playbackFade.js';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => vi.useRealTimers());

function media(paused = false) {
	return { paused, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn() };
}

describe('playback envelope', () => {
	it('fades out before pausing', () => {
		const element = media();
		const gain = vi.fn();
		fadePlayback(element, false, 1, gain, vi.fn());
		vi.advanceTimersByTime(40);
		expect(gain.mock.lastCall?.[0]).toBeCloseTo(0.5);
		expect(element.pause).not.toHaveBeenCalled();
		vi.advanceTimersByTime(40);
		expect(gain.mock.lastCall?.[0]).toBe(0);
		expect(element.pause).toHaveBeenCalledOnce();
	});

	it('starts silent and waits for buffered playback before fading in', async () => {
		const element = media(true);
		/** @type {(() => void) | undefined} */
		let started;
		element.play.mockReturnValue(
			new Promise((resolve) => {
				started = () => resolve(undefined);
			})
		);
		const gain = vi.fn();
		fadePlayback(element, true, 1, gain, vi.fn());
		expect(gain.mock.lastCall?.[0]).toBe(0);
		vi.advanceTimersByTime(500);
		expect(gain.mock.lastCall?.[0]).toBe(0);
		started?.();
		await Promise.resolve();
		vi.advanceTimersByTime(80);
		expect(gain.mock.lastCall?.[0]).toBe(1);
	});

	it('cancels a pending pause when play reverses the fade', () => {
		const element = media();
		let level = 1;
		const cancel = fadePlayback(
			element,
			false,
			level,
			(value) => {
				level = value;
			},
			vi.fn()
		);
		vi.advanceTimersByTime(40);
		cancel();
		fadePlayback(
			element,
			true,
			level,
			(value) => {
				level = value;
			},
			vi.fn()
		);
		vi.advanceTimersByTime(100);
		expect(level).toBe(1);
		expect(element.pause).not.toHaveBeenCalled();
	});

	it('ignores a cancelled play failure', async () => {
		const element = media(true);
		/** @type {((error: Error) => void) | undefined} */
		let rejectPlay;
		element.play.mockReturnValue(
			new Promise((_, reject) => {
				rejectPlay = reject;
			})
		);
		const onError = vi.fn();
		const cancel = fadePlayback(element, true, 0, vi.fn(), onError);
		cancel();
		rejectPlay?.(new Error('interrupted'));
		await Promise.resolve();
		await Promise.resolve();
		expect(onError).not.toHaveBeenCalled();
	});
});
