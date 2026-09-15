<script>
	/**
	 * Ambient view's playlist sheet: the queue ambient is playing through.
	 *
	 * Its own sheet rather than a section of the options sheet. The two used to
	 * share one popup, so the playlist button and the options button opened the
	 * same thing and neither job had room on a phone.
	 *
	 * This is the real queue, the one the regular player shows. Ambient plays
	 * through it and appends its next pick whenever it runs out (see
	 * AmbientView), so what is listed here is the session so far: tracks
	 * already played, the current one, and whatever is still to come of the
	 * node it belongs to. Before anything is queued, the pick ambient is
	 * offering is shown instead, with the same play the dock has.
	 *
	 * @type {{
	 *   pendingEntry?: import('$lib/ring.js').RingEntry | null,
	 *   pendingLabel?: string,
	 *   listEl?: HTMLElement | null,
	 *   onPlayPending: () => void,
	 *   onClose: () => void
	 * }}
	 */
	let {
		pendingEntry = null,
		pendingLabel = '',
		listEl = $bindable(null),
		onPlayPending,
		onClose
	} = $props();

	import { tick } from 'svelte';
	import { fade, slide } from 'svelte/transition';
	import { audioPlayerStore } from '$lib/audioPlayerStore.svelte.js';
	import { coverImageUrl } from '$lib/ring.js';

	const pendingCover = $derived(pendingEntry ? coverImageUrl(pendingEntry) : null);
	const displayedQueue = $derived.by(() => {
		/** @type {{ item: (typeof audioPlayerStore.queue)[number], originalIndex: number }[][]} */
		const groups = [];
		for (const [originalIndex, item] of audioPlayerStore.queue.entries()) {
			const last = groups[groups.length - 1];
			if (last?.[0]?.item.batchKey === item.batchKey) last.push({ item, originalIndex });
			else groups.push([{ item, originalIndex }]);
		}
		return groups.reverse().flat();
	});
	/** @type {{ key: string, pointerId: number, x: number, y: number } | null} */
	let swipeStart = null;
	let swallowedClickKey = '';
	const SWIPE_DELETE_PX = 56;

	/** @param {PointerEvent} event @param {string} key */
	function handlePointerDown(event, key) {
		if (!event.isPrimary) return;
		swipeStart = { key, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
	}

	/** @param {PointerEvent} event @param {string} key */
	function handlePointerMove(event, key) {
		if (!swipeStart || swipeStart.key !== key || swipeStart.pointerId !== event.pointerId) return;
		if (event.clientX > swipeStart.x - 8) return;
		// Capture only once a swipe is underway. Capturing on pointerdown would
		// retarget an ordinary delete-button click to the row itself.
		if (event.currentTarget instanceof Element)
			event.currentTarget.setPointerCapture(event.pointerId);
	}

	/** @param {PointerEvent} event @param {string} key @param {number} originalIndex */
	function handlePointerUp(event, key, originalIndex) {
		const start = swipeStart;
		swipeStart = null;
		if (!start || start.key !== key || start.pointerId !== event.pointerId) return;
		const dx = event.clientX - start.x;
		const dy = event.clientY - start.y;
		if (dx > -SWIPE_DELETE_PX || Math.abs(dx) < Math.abs(dy) * 1.4) return;
		swallowedClickKey = key;
		audioPlayerStore.removeAt(originalIndex);
	}

	/** @param {string} key @param {number} originalIndex */
	function playItem(key, originalIndex) {
		if (swallowedClickKey === key) {
			swallowedClickKey = '';
			return;
		}
		audioPlayerStore.jumpTo(originalIndex);
	}

	// Opening the sheet and changing tracks both keep the playing row inside
	// the list's viewport. New additions are rendered first, but a visitor can
	// still jump to an older item and retain that same in-focus behaviour.
	$effect(() => {
		const currentIndex = audioPlayerStore.index;
		if (!listEl || audioPlayerStore.queue.length === 0) return;
		tick().then(() => {
			const row = listEl?.querySelector(`[data-queue-index="${currentIndex}"]`);
			row?.scrollIntoView({ block: 'nearest' });
		});
	});
</script>

<button
	type="button"
	class="sheet-backdrop"
	onclick={onClose}
	aria-label="Close playlist"
	transition:fade={{ duration: 180 }}
></button>
<section
	bind:this={listEl}
	class="playlist-sheet glass-panel"
	aria-labelledby="ambient-playlist-heading"
	tabindex="-1"
	transition:slide={{ duration: 240, axis: 'y' }}
>
	<div class="sheet-heading">
		<div>
			<p>Ambient view</p>
			<h2 id="ambient-playlist-heading">Playlist</h2>
		</div>
		<button type="button" onclick={onClose} aria-label="Close playlist sheet">
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

	{#if audioPlayerStore.queue.length > 0}
		<section class="playlist-group playlist-section" aria-labelledby="ambient-queue-heading">
			<div class="group-heading">
				<h3 id="ambient-queue-heading">In this session</h3>
				<span class="count">{audioPlayerStore.queue.length}</span>
			</div>
			<ol class="track-list">
				{#each displayedQueue as displayed (displayed.item.key)}
					{@const item = displayed.item}
					{@const index = displayed.originalIndex}
					{@const current = index === audioPlayerStore.index}
					<li
						data-queue-index={index}
						onpointerdown={(event) => handlePointerDown(event, item.key)}
						onpointermove={(event) => handlePointerMove(event, item.key)}
						onpointerup={(event) => handlePointerUp(event, item.key, index)}
						onpointercancel={() => (swipeStart = null)}
					>
						<button
							type="button"
							class="track-row"
							class:current
							class:played={index < audioPlayerStore.index}
							aria-current={current ? 'true' : undefined}
							onclick={() => playItem(item.key, index)}
							aria-label={`Play ${item.label} by ${item.creator}`}
						>
							<span class="track-position">{index + 1}</span>
							<span class="track-copy">
								<strong>{item.label}</strong>
								<span>{item.creator}</span>
							</span>
							{#if current}
								<span class="current-mark">
									{audioPlayerStore.playing ? 'Playing' : 'Paused'}
								</span>
							{/if}
						</button>
						<button
							type="button"
							class="remove-track"
							onclick={() => audioPlayerStore.removeAt(index)}
							aria-label={`Remove ${item.label} from playlist`}
							title="Remove from playlist"
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M4 7h16M9 3h6l1 4H8l1-4ZM7 7l1 14h8l1-14M10 11v6M14 11v6" />
							</svg>
						</button>
					</li>
				{/each}
			</ol>
			<p class="note">Newest additions appear first. Swipe left or use delete to dismiss one.</p>
		</section>
	{:else if pendingEntry}
		<section class="playlist-group" aria-labelledby="ambient-pending-heading">
			<h3 id="ambient-pending-heading">Up first</h3>
			<div class="track-row pending">
				{#if pendingCover}
					<img src={pendingCover} alt="" decoding="async" referrerpolicy="no-referrer" />
				{/if}
				<span class="track-copy">
					<strong>{pendingLabel}</strong>
					<span>{pendingEntry.creator}</span>
				</span>
				<button type="button" class="play-pending" onclick={onPlayPending}>Play</button>
			</div>
			<p class="note">Nothing is queued yet. Press play and the playlist builds from here.</p>
		</section>
	{:else}
		<p class="note">No playable audio is available right now.</p>
	{/if}
</section>

<style>
	.sheet-backdrop {
		position: absolute;
		inset: 0;
		z-index: 5;
		border: 0;
		background: rgb(0 0 0 / 0.3);
		cursor: default;
	}

	.playlist-sheet {
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
		outline: none;
	}

	.sheet-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.4rem;
	}

	.sheet-heading p,
	.sheet-heading h2 {
		margin: 0;
	}

	.sheet-heading p {
		color: var(--text-muted);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.sheet-heading h2 {
		font-size: var(--text-md);
	}

	.sheet-heading button,
	.play-pending {
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}

	.sheet-heading button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 999px;
	}

	.playlist-group {
		margin-top: 0.8rem;
		padding-top: 0.8rem;
		border-top: 1px solid var(--border);
	}

	.playlist-group:first-of-type {
		border-top: 0;
		padding-top: 0.2rem;
	}

	.playlist-group h3 {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.playlist-group > h3 {
		margin-bottom: 0.45rem;
	}

	.group-heading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.group-heading h3 {
		flex: 1;
	}

	/* A number in a circle, not a heading: --text-xs (1.35rem, this app's
	   type scale bottoms out there) filled almost the entire 1.55rem badge
	   and made a second digit look cramped against the rim. A literal size
	   below the scale, matching the small transport labels' own escape from
	   the same token, plus a line-height equal to the badge's height rather
	   than `1` -- the box-height centering AudioPlayer's own queue-count
	   badge already relies on, more reliably centered across engines than
	   leaving a font's ascent/descent split to align:center alone. */
	.count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		min-width: 1.55rem;
		height: 1.55rem;
		padding-inline: 0.35rem;
		border-radius: 999px;
		background: var(--glass-bg);
		color: var(--text-muted);
		font-size: 0.85rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1.55rem;
		text-align: center;
	}

	.current-mark {
		flex: 0 0 auto;
		color: var(--text-muted);
		font-size: var(--text-xs);
		font-weight: 700;
	}

	.track-list {
		display: grid;
		gap: 0.3rem;
		max-height: min(18rem, 45dvh);
		overflow-y: auto;
		margin: 0.55rem 0 0;
		padding: 0;
		list-style: none;
	}

	.track-list li {
		display: flex;
		min-width: 0;
		align-items: stretch;
		gap: 0.25rem;
		touch-action: pan-y;
	}

	/* min-width: 0 on both this and the `<li>` above: a flex item's automatic
	   minimum size is its content's, not zero, and a <button> holding
	   nowrap text is exactly the case that bites -- without it, the label's
	   full unbroken width refused to shrink and pushed the delete button
	   past the edge of the sheet instead of leaving `.track-copy`'s own
	   ellipsis (which already sets `min-width: 0`) any room to apply. */
	.track-row {
		display: flex;
		width: 100%;
		min-width: 0;
		border: 0;
		color: var(--text);
		font: inherit;
		text-align: left;
		align-items: center;
		gap: 0.55rem;
		padding: 0.5rem 0.55rem;
		border-radius: var(--radius-sm);
		background: color-mix(in oklch, var(--bg-elevated) 72%, transparent);
	}

	.remove-track {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.65rem;
		flex: 0 0 auto;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}

	.remove-track:hover,
	.remove-track:focus-visible {
		background: color-mix(in oklch, var(--danger, #b33a3a) 14%, transparent);
		color: var(--danger, #b33a3a);
	}

	.remove-track svg {
		width: 1.05rem;
		height: 1.05rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	button.track-row {
		cursor: pointer;
	}

	.track-row.played {
		opacity: 0.6;
	}

	.track-row.current {
		background: color-mix(in oklch, var(--accent) 13%, var(--bg-elevated));
	}

	.track-row img {
		flex: 0 0 auto;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: var(--radius-sm);
		object-fit: cover;
	}

	.track-position {
		color: var(--text-muted);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}

	.track-copy {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
	}

	.track-copy strong,
	.track-copy span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.track-copy strong {
		font-size: var(--text-sm);
	}

	.track-copy span {
		color: var(--text-muted);
		font-size: var(--text-xs);
	}

	.play-pending {
		flex: 0 0 auto;
		min-height: 2.25rem;
		padding: 0.35rem 0.9rem;
		border-radius: 999px;
		font-size: var(--text-xs);
		font-weight: 700;
	}

	.note {
		margin: 0.55rem 0 0;
		color: var(--text-muted);
		font-size: var(--text-xs);
	}
</style>
