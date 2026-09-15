<script>
	import NodeFallbackIcon from '../../../../components/NodeFallbackIcon.svelte';
	import { sanitizeExcerptHtml } from '$lib/ring.js';

	// Text entry's presentation, drawn over the card's blurred backdrop.
	//
	// The one type that fills rather than contains. A text entry's image is a
	// header or social card, not a composed artefact in its own right: it is
	// already made to be cropped, and letterboxing it over a blur would give
	// it a reverence it was not designed for. Entries with no image use the
	// shared paper-and-pencil mark over the card's type-colour wash.
	//
	// A text node alternates between introducing the creator and reading them.
	// Showing both at once was the problem this replaces: the cover, the
	// creator name, the one-line pitch, and a block of the writing all
	// competed inside one small card, and the writing — the thing a text node
	// exists to show — lost, because it is the only one of the four that has
	// to actually be read rather than glanced at.
	//
	// So the card takes turns. It opens on the cover with the creator's name
	// and pitch (host-owned chrome, still rendered by FieldNode). Then it
	// dims the cover, tells the host to fade that chrome out via
	// `onReadingChange`, and crawls one sample upward at reading pace. When
	// the sample is done it moves to the next one and opens on the cover
	// again. Both halves get the whole card instead of half of it.
	//
	// Under prefers-reduced-motion none of that happens: there is no crawl,
	// no dimming, and no cycling, only the first sample shown statically. The
	// choreography is continuous movement plus content changing under the
	// reader, which is exactly what the preference is about, and a text node
	// still says what it needs to without it.
	//
	// Sanitized again here even though `toRingEntry` already sanitizes on the
	// way in: this stage renders untrusted third-party ring.json data (a
	// hand-edited entry, or one from a source that skipped the form), not
	// only entries this app's own submission flow produced.
	//
	// Prose in line comments and the type on one line: a multi-line block
	// comment here gets hoisted into a `var` declaration in the emitted JS
	// and breaks the production build while passing every other check.

	/** @type {{ entry: any, cover?: string | null, hasImage?: boolean, paused?: boolean, motionReduced?: boolean, onImageError?: () => void, onExcerptChange?: (index: number) => void, onReadingChange?: (reading: boolean) => void }} */
	let {
		entry,
		cover = null,
		hasImage = false,
		paused = false,
		motionReduced = false,
		onImageError,
		onExcerptChange,
		onReadingChange
	} = $props();

	/** Long enough to take in a cover and a name before the words arrive. */
	const INTRO_MS = 3600;
	/** One sample's read. The crawl below is paced to fit inside this. */
	const READ_MS = 12000;
	/** Phase clock resolution. Coarse on purpose: nothing here needs frames. */
	const TICK_MS = 200;

	/** @param {{ text?: string }} sample */
	function hasSampleText(sample) {
		return Boolean(sample?.text?.trim());
	}

	/** @type {{ title?: string, text?: string, audio_url?: string }[]} */
	const samples = $derived((entry.excerpts ?? []).filter(hasSampleText));

	let index = $state(0);
	let reading = $state(false);
	let elapsed = $state(0);

	let viewportEl = $state(/** @type {HTMLDivElement | undefined} */ (undefined));
	let textEl = $state(/** @type {HTMLDivElement | undefined} */ (undefined));
	/** How far the sample has to travel to be read to its end; 0 when it already fits. */
	let crawlPx = $state(0);

	const current = $derived(samples[index] ?? null);

	// A new entry restarts the sequence rather than resuming wherever the
	// previous one left off: a slot reuses this component across rotations, so
	// sample 3 of the last creator must not become sample 3 of this one.
	$effect(() => {
		entry.id;
		index = 0;
		reading = false;
		elapsed = 0;
		onExcerptChange?.(0);
		onReadingChange?.(false);
	});

	// The host owns the creator name and pitch, so it has to be told when to
	// clear them. Mirrored from `reading` rather than called from inside the
	// tick so it stays correct however `reading` was reached, including the
	// reset above and the reduced-motion path that never enters it.
	$effect(() => {
		onReadingChange?.(reading);
	});

	// Measures the overflow the crawl has to cover. Depends on the sample and
	// on `reading`, because the viewport only exists while reading, and on
	// `hasImage` because a cover changes nothing about the text box but does
	// change when this component re-renders.
	$effect(() => {
		index;
		reading;
		const box = viewportEl;
		const text = textEl;
		if (!reading || !box || !text) return;
		crawlPx = Math.max(0, text.scrollHeight - box.clientHeight);
	});

	// One clock for both phases. Reads `paused` live inside the callback
	// rather than tracking it, so hovering a card freezes the sequence where
	// it stands instead of tearing the timer down and restarting the phase
	// from zero — the same reasoning FieldSlot's own rotation timer documents.
	$effect(() => {
		if (motionReduced || samples.length === 0) return;

		const id = setInterval(() => {
			if (paused) return;
			elapsed += TICK_MS;
			const limit = reading ? READ_MS : INTRO_MS;
			if (elapsed < limit) return;

			elapsed = 0;
			if (!reading) {
				reading = true;
				return;
			}
			reading = false;
			// One sample still cycles: its cover and its words each get their
			// own turn, the same as any other count. `% length` makes that the
			// same code path rather than a special case.
			index = (index + 1) % samples.length;
			onExcerptChange?.(index);
		}, TICK_MS);

		return () => clearInterval(id);
	});
</script>

<div class="header" class:has-image={hasImage}>
	{#if hasImage && cover}
		<img
			class="header-image"
			src={cover}
			alt=""
			aria-hidden="true"
			referrerpolicy="no-referrer"
			onerror={() => onImageError?.()}
		/>
	{:else}
		<NodeFallbackIcon type="text" />
	{/if}
</div>

<!-- Only while reading, and only over a real cover: with no image the card is
     already a flat type wash that the theme's own text colour contrasts
     against, and darkening it further would just muddy it. -->
{#if hasImage}
	<div class="veil" class:reading aria-hidden="true"></div>
{/if}

{#if current && (reading || motionReduced)}
	{#key index}
		<div class="excerpt-viewport" class:has-image={hasImage} bind:this={viewportEl}>
			<div
				class="excerpt"
				class:crawling={reading && !motionReduced}
				bind:this={textEl}
				style:--crawl-px={`${crawlPx}px`}
				style:--read-ms={`${READ_MS}ms`}
				style:animation-play-state={paused ? 'paused' : 'running'}
			>
				{#if current.title?.trim()}
					<!-- Travels with the sample rather than sitting fixed above it:
					     it is the title *of this piece*, so it should scroll off
					     with the words it belongs to rather than hang over the next
					     one. -->
					<p class="excerpt-title">{current.title}</p>
				{/if}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized above -->
				{@html sanitizeExcerptHtml(current.text ?? '')}
			</div>
		</div>
	{/key}
{/if}

<style>
	.header {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.header-image {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	/* Deeper than FieldNode's own scrim goes, because this is not about
	   keeping a caption legible over artwork — it is about the cover stepping
	   back so a paragraph can be read across the whole card. Faded rather than
	   switched so the change reads as the card settling into a read. */
	.veil {
		position: absolute;
		inset: 0;
		background: rgb(0 0 0 / 0.72);
		opacity: 0;
		transition: opacity 900ms ease;
		pointer-events: none;
	}

	.veil.reading {
		opacity: 1;
	}

	/* The window the sample travels through. Sized off the card rather than
	   the text, so the crawl distance is a property of how much writing there
	   is, not of how tall the card happens to be. */
	.excerpt-viewport {
		position: relative;
		/* The measure is only set by a host that renders this larger (ambient
		   view); on a grid card the fallback leaves the width at 88%. */
		width: min(88%, var(--text-stage-measure, 100%));
		max-height: 74%;
		overflow: hidden;
		mask-image: linear-gradient(to bottom, transparent 0%, #000 8%, #000 92%, transparent 100%);
	}

	.excerpt {
		font-size: var(--text-stage-size, 1.1rem);
		line-height: 1.6;
		text-align: center;
		color: #f2ede2;
		animation: excerpt-in 700ms ease;
	}

	/* No cover means no veil, so the text sits on the type wash and takes the
	   theme's own colour the way the creator name and pitch do there. */
	.excerpt-viewport:not(.has-image) .excerpt {
		color: var(--text);
	}

	.excerpt-title {
		margin: 0 0 0.5em;
		font-size: 0.95em;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		opacity: 0.75;
	}

	.excerpt :global(p) {
		margin: 0 0 0.6em;
	}

	/* Samples may carry headings now that the editor offers them. At browser
	   defaults an h1 is twice the body size, which on a card this small is
	   most of the visible area spent on one line. These keep a heading
	   readable as a heading — heavier, with air above it — without letting it
	   take the space the writing under it needs. */
	.excerpt :global(h1),
	.excerpt :global(h2),
	.excerpt :global(h3) {
		margin: 0 0 0.4em;
		font-size: 1.15em;
		font-weight: 700;
		line-height: 1.3;
	}

	.excerpt :global(h1:not(:first-child)),
	.excerpt :global(h2:not(:first-child)),
	.excerpt :global(h3:not(:first-child)) {
		margin-top: 0.8em;
	}

	.excerpt :global(blockquote) {
		margin: 0 0 0.6em;
		padding-left: 0.75em;
		border-left: 2px solid currentColor;
		opacity: 0.85;
	}

	.excerpt :global(p:last-child) {
		margin-bottom: 0;
	}

	.excerpt :global(a) {
		color: inherit;
		text-decoration: underline;
	}

	/* Holds still at each end: a beat to find the first line before it moves,
	   and a beat on the last line before the card moves on. A sample short
	   enough to fit has a crawl distance of 0, so this animates nothing and
	   simply rests — no special case needed for it. */
	.excerpt.crawling {
		animation:
			excerpt-in 700ms ease,
			excerpt-crawl var(--read-ms) linear;
	}

	@keyframes excerpt-crawl {
		0%,
		14% {
			transform: translateY(0);
		}
		86%,
		100% {
			transform: translateY(calc(-1 * var(--crawl-px, 0px)));
		}
	}

	@keyframes excerpt-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		/* Static, and clamped instead of crawling: with the sequence switched
		   off upstream this is the only sample shown, so it has to be readable
		   where it stands rather than depending on movement to finish. */
		.excerpt,
		.excerpt.crawling {
			animation: none;
			display: -webkit-box;
			-webkit-line-clamp: 8;
			line-clamp: 8;
			-webkit-box-orient: vertical;
			overflow: hidden;
		}

		.veil {
			transition: none;
		}
	}
</style>
