<script>
	/**
	 * "Check this track": asks the browser whether a track's host will let it
	 * drive the reactive background, before the creator submits it. The test
	 * itself, and why it has to run here rather than in the backend, is in
	 * `$lib/audioCorsCheck.js`.
	 *
	 * A button rather than a check that runs as the URL is typed, so no request
	 * goes to a half-typed address, and nothing is fetched from a creator's host
	 * until they ask.
	 *
	 * A component rather than a snippet in JoinMediaStep: the track field
	 * markup there is duplicated across two branches, and a snippet calling a
	 * component-local function breaks that file's build (see its comment above
	 * the first track list).
	 *
	 * @type {{ url: string | undefined, label: string }}
	 */
	let { url, label } = $props();

	import { audioCorsMessage, checkAudioCors } from '$lib/audioCorsCheck.js';

	/** @typedef {{ url: string, verdict: import('$lib/audioCorsCheck.js').AudioCorsVerdict }} CheckResult */
	let result = $state(/** @type {CheckResult | null} */ (null));
	let checkingUrl = $state('');

	const trimmed = $derived((url ?? '').trim());
	const checking = $derived(checkingUrl !== '' && checkingUrl === trimmed);
	// A verdict belongs to the URL it was reached for. Editing the field hides
	// it rather than leaving a "Ready" beside a link nobody has checked.
	const message = $derived(
		result && result.url === trimmed ? audioCorsMessage(result.verdict) : null
	);

	async function runCheck() {
		const target = trimmed;
		if (!target || checkingUrl) return;
		checkingUrl = target;
		try {
			const verdict = await checkAudioCors(target);
			result = { url: target, verdict };
		} finally {
			checkingUrl = '';
		}
	}
</script>

<div class="track-check">
	<button
		type="button"
		class="btn btn-ghost track-check-button"
		disabled={!trimmed || checking}
		onclick={runCheck}
		aria-label="Check whether {label} plays here"
	>
		{checking ? 'Checking…' : 'Check this track'}
	</button>
	<p class="track-check-result" role="status" data-tone={message?.tone}>
		{#if checking}
			Loading the file the way the player will…
		{:else if message}
			{message.text}
		{/if}
	</p>
</div>

<style>
	.track-check {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.9rem;
		margin-bottom: 1rem;
	}

	.track-check-button {
		flex: none;
	}

	.track-check-result {
		flex: 1 1 20rem;
		max-width: 62ch;
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	/* Tone is carried by the rule beside the text, not the text colour: the
	   type greens and ambers are too light to read as body text on the light
	   theme, and the message itself already says what happened. */
	.track-check-result[data-tone] {
		padding-left: 0.7rem;
		border-left: 3px solid var(--border);
		color: var(--text);
	}

	.track-check-result[data-tone='ok'] {
		border-left-color: var(--type-game);
	}

	.track-check-result[data-tone='warn'] {
		border-left-color: var(--type-text);
	}

	.track-check-result[data-tone='error'] {
		border-left-color: #e0455f;
	}
</style>
