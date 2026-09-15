<script>
	/**
	 * Ambient view's options sheet: everything the mode can do that is not worth
	 * a permanent control.
	 *
	 * Only that. The playlist has its own sheet (AmbientPlaylistSheet) behind
	 * the dock's playlist button; sharing this one made both buttons open the
	 * same crowded popup. Unobstructed view is likewise left to the view dock's
	 * own button beside the one that opens this, rather than repeated here.
	 *
	 * Split out of `AmbientView` as the largest remaining block of markup and
	 * CSS with a single job.
	 *
	 * @type {{
	 *   audioEntry: import('$lib/ring.js').RingEntry | null,
	 *   visualEntry: import('$lib/ring.js').RingEntry | null,
	 *   audioCardVisible?: boolean,
	 *   canRead?: boolean,
	 *   reading?: boolean,
	 *   visualReadable?: boolean,
	 *   visualTrailerUrl?: string | null,
	 *   onClose: () => void,
	 *   onToggleAudioCard: () => void,
	 *   onNextVisual: () => void,
	 *   onOpenViewer: () => void,
	 *   onOpenTrailer: () => void,
	 *   onToggleRead: () => void,
	 *   onExit: () => void
	 * }}
	 */
	let {
		audioEntry,
		visualEntry,
		audioCardVisible = true,
		canRead = false,
		reading = false,
		visualReadable = false,
		visualTrailerUrl = null,
		onClose,
		onToggleAudioCard,
		onNextVisual,
		onOpenViewer,
		onOpenTrailer,
		onToggleRead,
		onExit
	} = $props();

	import { fade, slide } from 'svelte/transition';
	import { resolve } from '$app/paths';
</script>

<button
	type="button"
	class="options-backdrop"
	onclick={onClose}
	aria-label="Close ambient options"
	transition:fade={{ duration: 180 }}
></button>
<section
	class="options-sheet glass-panel"
	aria-label="Ambient options"
	transition:slide={{ duration: 240, axis: 'y' }}
>
	<div class="options-heading">
		<div>
			<p>Ambient view</p>
			<h2>Options</h2>
		</div>
		<button type="button" onclick={onClose} aria-label="Close options">
			<svg
				viewBox="0 0 24 24"
				width="18"
				height="18"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path d="M6 6l12 12M18 6 6 18" stroke-linecap="round" />
			</svg>
		</button>
	</div>
	<div class="option-grid">
		{#if audioEntry}
			{@const shownAudio = audioEntry}
			<button type="button" onclick={onToggleAudioCard}>
				{audioCardVisible ? 'Hide audio discovery' : 'Show audio discovery'}
			</button>
			<!-- eslint-disable svelte/no-navigation-without-resolve -- creator-controlled external destination -->
			<a href={shownAudio.source_url} target="_blank" rel="noopener noreferrer"
				>Visit audio creator</a
			>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
		{#if visualEntry}
			{@const shownVisual = visualEntry}
			{#if canRead}
				<button type="button" onclick={onToggleRead}
					>{reading ? 'Stop reading' : 'Read text aloud'}</button
				>
			{/if}
			{#if visualTrailerUrl}
				<button type="button" onclick={onOpenTrailer}>Play trailer</button>
			{/if}
			{#if visualReadable}
				<button type="button" onclick={onOpenViewer}>Open visual in viewer</button>
			{/if}
			<button type="button" onclick={onNextVisual}>Next visual</button>
			<!-- eslint-disable svelte/no-navigation-without-resolve -- creator-controlled external destination -->
			<a href={shownVisual.source_url} target="_blank" rel="noopener noreferrer"
				>Visit visual creator</a
			>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -- resolved app route with an appended report query -->
			<a href={`${resolve('/contact')}?report=${encodeURIComponent(shownVisual.id)}`}
				>Report visual</a
			>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
	</div>
	<button type="button" class="exit-option" onclick={onExit}>Exit ambient view</button>
</section>

<style>
	.options-backdrop {
		position: absolute;
		inset: 0;
		z-index: 5;
		border: 0;
		background: rgb(0 0 0 / 0.3);
		cursor: default;
	}

	.options-sheet {
		position: absolute;
		left: 50%;
		bottom: calc(max(0.75rem, env(safe-area-inset-bottom)) + 5.1rem);
		z-index: 6;
		width: min(30rem, calc(100% - 1.5rem));
		max-height: calc(100dvh - 7.25rem);
		overflow-y: auto;
		padding: 1rem;
		border-radius: var(--radius-lg);
		transform: translateX(-50%);
	}

	.options-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.8rem;
	}

	.options-heading p,
	.options-heading h2 {
		margin: 0;
	}

	.options-heading p {
		color: var(--text-muted);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.options-heading h2 {
		font-size: var(--text-md);
	}

	.options-heading button,
	.option-grid button,
	.option-grid a,
	.exit-option {
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}

	.options-heading button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 999px;
	}

	.option-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.55rem;
	}

	.option-grid button,
	.option-grid a,
	.exit-option {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		padding: 0.65rem 0.75rem;
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		font-weight: 700;
		text-align: center;
		text-decoration: none;
	}

	.exit-option {
		width: 100%;
		margin-top: 0.75rem;
		border-color: color-mix(in oklch, #e0455f 50%, var(--border));
		color: #e0455f;
	}

	@media (max-width: 40rem) {
		.option-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
