<script>
	/**
	 * The tap-revealed creator actions in ambient view.
	 *
	 * A single tap on the visual pauses rotation and slides this in: one row per
	 * medium, each naming its creator and offering what can be done with that
	 * entry right now. Split out of `AmbientView` because it is the mode's
	 * largest self-contained surface — the rows, their icons, and their layout
	 * have nothing to do with dealing entries or driving audio.
	 *
	 * Presentational. The parent owns whether this is open, what is playing, and
	 * what each action does; this renders the rows and reports taps. The stores
	 * are read directly rather than passed, because "is this liked" is a
	 * question about global state, not about this panel.
	 *
	 * @type {{
	 *   audioEntry: import('$lib/ring.js').RingEntry | null,
	 *   visualEntry: import('$lib/ring.js').RingEntry | null,
	 *   canRead?: boolean,
	 *   reading?: boolean,
	 *   visualReadable?: boolean,
	 *   visualTrailerUrl?: string | null,
	 *   onClose: () => void,
	 *   onLike: (entry: import('$lib/ring.js').RingEntry) => void,
	 *   onHide: (entry: import('$lib/ring.js').RingEntry, medium: 'audio' | 'visual') => void,
	 *   onNextAudio: () => void,
	 *   onNextVisual: () => void,
	 *   onOpenViewer: () => void,
	 *   onOpenTrailer: () => void,
	 *   onToggleRead: () => void
	 * }}
	 */
	let {
		audioEntry,
		visualEntry,
		canRead = false,
		reading = false,
		visualReadable = false,
		visualTrailerUrl = null,
		onClose,
		onLike,
		onHide,
		onNextAudio,
		onNextVisual,
		onOpenViewer,
		onOpenTrailer,
		onToggleRead
	} = $props();

	import { fade } from 'svelte/transition';
	import { resolve } from '$app/paths';
	import { favoritesStore } from '$lib/favoritesStore.svelte.js';
	import { hiddenStore } from '$lib/hiddenStore.svelte.js';
	import { flyFade } from '$lib/transitions.js';
</script>

<button
	type="button"
	class="interaction-backdrop"
	onclick={onClose}
	aria-label="Dismiss creator actions"
	transition:fade={{ duration: 180 }}
></button>
<aside
	class="interaction-panel"
	aria-label="Current creator reactions"
	transition:flyFade={{ y: -18, duration: 220 }}
>
	<header>
		<span class="rotation-status"><i></i> Visual rotation paused</span>
		<button type="button" onclick={onClose} aria-label="Close creator actions">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
		</button>
	</header>
	{#if audioEntry}
		{@const reactedAudio = audioEntry}
		<section
			class="creator-action-row audio-action-row"
			aria-label={`Audio by ${reactedAudio.creator}`}
		>
			<div class="creator-action-copy">
				<span>Audio</span><strong>{reactedAudio.creator}</strong>
			</div>
			<div class="creator-action-buttons">
				<button
					type="button"
					class:active={favoritesStore.isLiked(reactedAudio.id)}
					onclick={() => onLike(reactedAudio)}
					aria-pressed={favoritesStore.isLiked(reactedAudio.id)}
					aria-label={`${favoritesStore.isLiked(reactedAudio.id) ? 'Unlike' : 'Like'} audio by ${reactedAudio.creator}`}
					title={`${favoritesStore.isLiked(reactedAudio.id) ? 'Unlike' : 'Like'} audio`}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path
							class="heart"
							d="M12 20.5s-7.5-4.6-10-9.3C.4 8 1.7 4.5 5 3.4c2.1-.7 4.3.1 5.6 1.9L12 7l1.4-1.7c1.3-1.8 3.5-2.6 5.6-1.9 3.3 1.1 4.6 4.6 3 7.8-2.5 4.7-10 9.3-10 9.3Z"
						/>
						<path class="medium-symbol" d="M12.7 8.1v6.1a2.2 2.2 0 1 1-1.4-2V8.9l4.4-1v2l-3 .7" />
					</svg>
				</button>
				<button
					type="button"
					class:active={hiddenStore.isHidden(reactedAudio.id)}
					onclick={() => onHide(reactedAudio, 'audio')}
					aria-pressed={hiddenStore.isHidden(reactedAudio.id)}
					aria-label={`${hiddenStore.isHidden(reactedAudio.id) ? 'Restore' : 'Not for Me'} audio by ${reactedAudio.creator}`}
					title="Not for Me"
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
						<path d="M9.5 9.5a3.5 3.5 0 0 0 5 5M3 3l18 18" />
					</svg>
				</button>
				<!-- eslint-disable svelte/no-navigation-without-resolve -- creator-controlled external destination -->
				<a
					href={reactedAudio.source_url}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`Visit audio creator ${reactedAudio.creator}`}
					title="Visit audio creator"
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<circle cx="12" cy="12" r="9" />
						<path
							d="M3 12h18M12 3c2.5 2.5 3.7 5.5 3.7 9s-1.2 6.5-3.7 9c-2.5-2.5-3.7-5.5-3.7-9S9.5 5.5 12 3Z"
						/>
					</svg>
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
				<button type="button" onclick={onNextAudio} aria-label="Next audio" title="Next audio">
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6h2v12h-2zM5 6l9 6-9 6z" /></svg>
				</button>
			</div>
		</section>
	{/if}

	{#if visualEntry}
		{@const reactedVisual = visualEntry}
		<section
			class="creator-action-row visual-action-row"
			aria-label={`Visual by ${reactedVisual.creator}`}
		>
			<div class="creator-action-copy">
				<span>Visual</span><strong>{reactedVisual.creator}</strong>
			</div>
			<div class="creator-action-buttons">
				<button
					type="button"
					class:active={favoritesStore.isLiked(reactedVisual.id)}
					onclick={() => onLike(reactedVisual)}
					aria-pressed={favoritesStore.isLiked(reactedVisual.id)}
					aria-label={`${favoritesStore.isLiked(reactedVisual.id) ? 'Unlike' : 'Like'} visual by ${reactedVisual.creator}`}
					title={`${favoritesStore.isLiked(reactedVisual.id) ? 'Unlike' : 'Like'} visual`}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<rect x="3" y="4" width="18" height="16" rx="2" />
						<path
							class="heart"
							d="M12 17s-5-3-5-6.2A2.8 2.8 0 0 1 12 9a2.8 2.8 0 0 1 5 1.8C17 14 12 17 12 17Z"
						/>
						<path d="M8 2v2M16 2v2" />
					</svg>
				</button>
				<button
					type="button"
					class:active={hiddenStore.isHidden(reactedVisual.id)}
					onclick={() => onHide(reactedVisual, 'visual')}
					aria-pressed={hiddenStore.isHidden(reactedVisual.id)}
					aria-label={`${hiddenStore.isHidden(reactedVisual.id) ? 'Restore' : 'Not for Me'} visual by ${reactedVisual.creator}`}
					title="Not for Me"
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
						<path d="M9.5 9.5a3.5 3.5 0 0 0 5 5M3 3l18 18" />
					</svg>
				</button>
				<!-- eslint-disable svelte/no-navigation-without-resolve -- creator-controlled external destination -->
				<a
					href={reactedVisual.source_url}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`Visit visual creator ${reactedVisual.creator}`}
					title="Visit visual creator"
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<circle cx="12" cy="12" r="9" />
						<path
							d="M3 12h18M12 3c2.5 2.5 3.7 5.5 3.7 9s-1.2 6.5-3.7 9c-2.5-2.5-3.7-5.5-3.7-9S9.5 5.5 12 3Z"
						/>
					</svg>
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{#if canRead}
					<button
						type="button"
						onclick={onToggleRead}
						aria-pressed={reading}
						aria-label={reading ? 'Stop reading this text' : `Read ${reactedVisual.creator} aloud`}
						title={reading ? 'Stop reading' : 'Read aloud'}
					>
						{#if reading}
							<svg viewBox="0 0 24 24" aria-hidden="true"
								><path d="M7 6h4v12H7zM13 6h4v12h-4z" /></svg
							>
						{:else}
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M11 5L6.5 9H3v6h3.5L11 19z" stroke-linejoin="round" />
								<path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.4 6.4a8 8 0 0 1 0 11.2" />
							</svg>
						{/if}
					</button>
				{/if}
				{#if visualTrailerUrl}
					<button
						type="button"
						onclick={onOpenTrailer}
						aria-label={`Play the trailer for ${reactedVisual.creator}`}
						title="Play trailer"
					>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<rect x="2.5" y="5" width="19" height="14" rx="2" />
							<path d="M10 9.2l5 2.8-5 2.8z" fill="currentColor" stroke="none" />
						</svg>
					</button>
				{/if}
				{#if visualReadable}
					<button
						type="button"
						onclick={onOpenViewer}
						aria-label={`Read ${reactedVisual.creator} in the full screen viewer`}
						title="Open in viewer"
					>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M3 5.5h7a2 2 0 0 1 2 2V19a2.5 2.5 0 0 0-2.5-2H3Z" />
							<path d="M21 5.5h-7a2 2 0 0 0-2 2V19a2.5 2.5 0 0 1 2.5-2H21Z" />
						</svg>
					</button>
				{/if}
				<button type="button" onclick={onNextVisual} aria-label="Next visual" title="Next visual">
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6h2v12h-2zM5 6l9 6-9 6z" /></svg>
				</button>
				<!-- eslint-disable svelte/no-navigation-without-resolve -- resolved app route with an appended report query -->
				<a
					href={`${resolve('/contact')}?report=${encodeURIComponent(reactedVisual.id)}`}
					aria-label={`Report visual by ${reactedVisual.creator}`}
					title="Report visual"
				>
					<svg viewBox="0 0 24 24" aria-hidden="true"
						><path d="M5 21V4m0 1h11l-1.5 3L16 11H5" /></svg
					>
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</div>
		</section>
	{/if}
</aside>

<style>
	.interaction-backdrop {
		position: absolute;
		inset: 0;
		z-index: 5;
		border: 0;
		background: rgb(4 3 8 / 0.5);
		cursor: default;
	}

	.interaction-panel {
		position: absolute;
		inset: max(0.75rem, env(safe-area-inset-top)) 0.75rem max(0.75rem, env(safe-area-inset-bottom));
		z-index: 6;
		display: grid;
		align-content: center;
		gap: 0.7rem;
		width: min(46rem, calc(100% - 1.5rem));
		margin-inline: auto;
		pointer-events: none;
	}

	.interaction-panel > * {
		pointer-events: auto;
	}

	.interaction-panel > header,
	.creator-action-row {
		border: 1px solid var(--border);
		background: color-mix(in oklch, var(--bg-elevated) 88%, transparent);
		box-shadow: var(--shadow-sm);
		backdrop-filter: blur(20px);
	}

	.interaction-panel > header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 3.25rem;
		padding: 0.4rem 0.45rem 0.4rem 0.9rem;
		border-radius: 999px;
	}

	.interaction-panel > header button {
		display: grid;
		place-items: center;
		width: 2.35rem;
		height: 2.35rem;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: var(--glass-bg);
		color: var(--text);
		cursor: pointer;
	}

	.interaction-panel > header svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}

	.creator-action-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		min-height: 5rem;
		padding: 0.7rem 0.8rem;
		border-radius: 1.15rem;
	}

	.audio-action-row {
		--row-color: var(--type-audio);
	}

	.visual-action-row {
		--row-color: var(--type-comic);
	}

	.creator-action-copy {
		display: flex;
		min-width: 0;
		flex-direction: column;
	}

	.creator-action-copy span {
		color: var(--row-color);
		font-size: 0.67rem;
		font-weight: 850;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.creator-action-copy strong {
		overflow: hidden;
		font-size: var(--text-md);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.creator-action-buttons {
		display: grid;
		grid-auto-flow: column;
		gap: 0.3rem;
	}

	.creator-action-buttons button,
	.creator-action-buttons a {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 3rem;
		height: 3rem;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: var(--glass-bg);
		color: var(--text-muted);
		text-decoration: none;
		cursor: pointer;
		transition:
			background 160ms ease,
			color 160ms ease,
			transform 160ms ease;
	}

	.creator-action-buttons button:hover,
	.creator-action-buttons button:focus-visible,
	.creator-action-buttons a:hover,
	.creator-action-buttons a:focus-visible {
		background: color-mix(in oklch, var(--row-color) 20%, var(--glass-bg));
		color: var(--text);
		transform: scale(1.05);
	}

	.creator-action-buttons button.active {
		background: rgb(224 69 95 / 0.16);
		color: #e0455f;
	}

	.creator-action-buttons svg {
		width: 1.35rem;
		height: 1.35rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.creator-action-buttons button.active .heart {
		fill: currentColor;
	}

	.creator-action-buttons button.active .medium-symbol {
		stroke: white;
	}

	.rotation-status {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--text-muted);
		font-size: 0.66rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.rotation-status i {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 999px;
		background: var(--accent);
		box-shadow: 0 0 0.6rem color-mix(in oklch, var(--accent) 65%, transparent);
	}

	@media (max-width: 40rem) {
		.interaction-panel {
			inset: max(0.5rem, env(safe-area-inset-top)) 0.5rem max(0.5rem, env(safe-area-inset-bottom));
			width: calc(100% - 1rem);
		}

		.creator-action-row {
			min-height: 4.8rem;
			padding: 0.65rem;
		}

		.creator-action-buttons button,
		.creator-action-buttons a {
			width: 2.75rem;
			height: 2.75rem;
		}
	}
</style>
