<script>
	/**
	 * Ambient view's second audio lane: a square card offering a different node
	 * (or another track from the same one) than whatever the dock is playing.
	 *
	 * Deliberately not a now-playing display. It is a *suggestion*, which is why
	 * the chip reads "Audio Next" and why its actions are audition, replace, and
	 * skip rather than transport controls.
	 *
	 * Purely presentational: the parent decides whether this should exist at all
	 * and owns the rotation timer, the preview element, and which entry is being
	 * offered. This renders that decision and reports taps back.
	 *
	 * @type {{
	 *   entry: import('$lib/ring.js').RingEntry,
	 *   track: { label: string, media_url: string },
	 *   cover: string | null,
	 *   previewing?: boolean,
	 *   progress?: number,
	 *   onPreview: () => void,
	 *   onReplace: () => void,
	 *   onNext: () => void,
	 *   onHide: () => void
	 * }}
	 */
	let {
		entry,
		track,
		cover = null,
		previewing = false,
		progress = 0,
		onPreview,
		onReplace,
		onNext,
		onHide
	} = $props();

	import { flyFade } from '$lib/transitions.js';

	const FORM_LABEL = { music: 'Music', spoken: 'Spoken' };
</script>

<article
	class="audio-discovery-card"
	aria-label={`Audio discovery: ${track.label} by ${entry.creator}`}
	in:flyFade={{ x: 36, duration: 260 }}
	out:flyFade={{ x: 36, duration: 180 }}
>
	{#if cover}
		<img src={cover} alt="" decoding="async" referrerpolicy="no-referrer" />
	{:else}
		<div class="audio-discovery-fallback" aria-hidden="true">
			<svg viewBox="0 0 24 24"
				><path
					d="M10 18V6l9-2v11M10 9l9-2M7 18a3 2 0 1 1-6 0 3 2 0 0 1 6 0Zm12-3a3 2 0 1 1-6 0 3 2 0 0 1 6 0Z"
				/></svg
			>
		</div>
	{/if}
	<div class="audio-discovery-scrim"></div>
	<!-- "Audio Next", not "Audio": this card is a queued-up suggestion
		     to move to, and a bare type label read as if it were describing
		     the audio already sounding in the dock. -->
	<span class="audio-discovery-chip"
		>Audio Next{entry.form ? ` · ${FORM_LABEL[entry.form]}` : ''}</span
	>
	<button
		type="button"
		class="audio-card-close"
		onclick={onHide}
		aria-label="Hide audio discovery card"
		title="Hide audio discovery"
	>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
	</button>
	<div class="audio-rotation-progress" aria-hidden="true">
		<span style={`width: ${progress * 100}%`}></span>
	</div>
	<div class="audio-discovery-actions">
		<button
			type="button"
			class:active={previewing}
			onclick={onPreview}
			aria-label={`${previewing ? 'Stop' : 'Preview'} ${track.label}`}
			title={previewing ? 'Stop preview' : 'Preview once'}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"
				>{#if previewing}<path d="M7 6h4v12H7zM13 6h4v12h-4z" />{:else}<path
						d="M8 5l11 7-11 7Z"
					/>{/if}</svg
			>
			<span>Preview</span>
		</button>
		<button
			type="button"
			onclick={onReplace}
			aria-label={`Replace ambient audio with ${track.label}`}
			title="Play this instead"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"
				><path d="M4 7h11M12 4l3 3-3 3M20 17H9M12 14l-3 3 3 3" /></svg
			>
			<span>Play this</span>
		</button>
		<button
			type="button"
			onclick={onNext}
			aria-label="Show next audio discovery"
			title="Next discovery"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6h2v12h-2zM5 6l9 6-9 6z" /></svg>
		</button>
	</div>
</article>

<style>
	.audio-discovery-card {
		position: absolute;
		right: 0.75rem;
		bottom: calc(max(0.75rem, env(safe-area-inset-bottom)) + 6.1rem);
		z-index: 4;
		width: clamp(13rem, 28vw, 17rem);
		aspect-ratio: 1;
		overflow: hidden;
		border: 1px solid rgb(255 255 255 / 0.2);
		border-radius: 1.15rem;
		background: color-mix(in oklch, var(--type-audio) 24%, var(--bg-elevated));
		box-shadow: var(--shadow-md);
	}

	.audio-discovery-card > img,
	.audio-discovery-fallback,
	.audio-discovery-scrim {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.audio-discovery-card > img {
		object-fit: cover;
	}

	.audio-discovery-fallback {
		display: grid;
		place-items: center;
		background:
			radial-gradient(circle at 72% 24%, rgb(255 255 255 / 0.24), transparent 36%),
			linear-gradient(145deg, var(--type-audio), color-mix(in oklch, var(--accent) 65%, #161124));
	}

	.audio-discovery-fallback svg {
		width: 42%;
		fill: none;
		stroke: rgb(255 255 255 / 0.78);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.audio-discovery-scrim {
		background: linear-gradient(180deg, rgb(7 5 12 / 0.04) 48%, rgb(7 5 12 / 0.82) 100%);
		pointer-events: none;
	}

	.audio-discovery-chip {
		position: absolute;
		top: 0.6rem;
		left: 0.6rem;
		padding: 0.32rem 0.55rem;
		border: 1px solid rgb(255 255 255 / 0.28);
		border-radius: 999px;
		background: rgb(10 8 16 / 0.55);
		color: white;
		font-size: 0.62rem;
		font-weight: 850;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		backdrop-filter: blur(12px);
	}

	.audio-card-close,
	.audio-discovery-actions button {
		border: 0;
		color: white;
		font: inherit;
		cursor: pointer;
		backdrop-filter: blur(12px);
	}

	.audio-card-close {
		position: absolute;
		top: 0.55rem;
		right: 0.55rem;
		display: grid;
		place-items: center;
		width: 2.2rem;
		height: 2.2rem;
		padding: 0;
		border-radius: 999px;
		background: rgb(10 8 16 / 0.52);
	}

	.audio-card-close svg,
	.audio-discovery-actions svg {
		width: 1rem;
		height: 1rem;
		fill: currentColor;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.audio-card-close svg {
		fill: none;
	}

	.audio-rotation-progress {
		position: absolute;
		left: 0.6rem;
		right: 0.6rem;
		bottom: 3.55rem;
		overflow: hidden;
		height: 0.24rem;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.24);
		box-shadow: 0 1px 0.3rem rgb(0 0 0 / 0.35);
	}

	.audio-rotation-progress span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: color-mix(in oklch, var(--type-audio) 75%, white);
	}

	.audio-discovery-actions {
		position: absolute;
		left: 0.55rem;
		right: 0.55rem;
		bottom: 0.55rem;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 2.55rem;
		gap: 0.35rem;
	}

	.audio-discovery-actions button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		min-width: 0;
		height: 2.6rem;
		padding: 0 0.45rem;
		border-radius: 0.75rem;
		background: rgb(10 8 16 / 0.58);
		font-size: 0.68rem;
		font-weight: 800;
	}

	.audio-discovery-actions button:hover,
	.audio-discovery-actions button:focus-visible,
	.audio-discovery-actions button.active {
		background: color-mix(in oklch, var(--type-audio) 78%, rgb(10 8 16 / 0.58));
	}
	@media (max-width: 40rem) {
		.audio-discovery-card {
			right: 0.5rem;
			bottom: calc(max(0.5rem, env(safe-area-inset-bottom)) + 6.4rem);
			width: min(58vw, 14rem);
		}
	}
</style>
