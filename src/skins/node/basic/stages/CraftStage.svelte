<script>
	import NodeFallbackIcon from '../../../../components/NodeFallbackIcon.svelte';
	import { CRAFT_PAN_ENABLED } from '$lib/craftMotion.js';

	// Craft entry's presentation: a slow pan across a detail photo. A craft
	// entry's pages run from a full view to detail shots, so the last page is
	// preferred (texture and joinery read well under a pan) and the first is
	// used when there is only one. The card's expanded viewer shows every
	// photo, so this stage does not cycle through them.
	//
	// The caption is shown with the photo because it carries materials and
	// scale. The pan is a CSS transform on a slightly oversized image and
	// stops under prefers-reduced-motion, or when the host reports
	// `motionReduced`, or when CRAFT_PAN_ENABLED is false.
	//
	// Prose in line comments and the type on one line: a multi-line block
	// comment here gets hoisted into a `var` declaration in the emitted JS
	// and breaks the production build while passing every other check.

	/** @type {{ entry: any, paused?: boolean, motionReduced?: boolean, onImageError?: () => void }} */
	let { entry, paused = false, motionReduced = false, onImageError } = $props();

	/** @param {{ image_url?: string } | null | undefined} page */
	function hasImage(page) {
		return typeof page?.image_url === 'string' && page.image_url.length > 0;
	}

	/** @type {{ image_url?: string, caption?: string }[]} */
	const pages = $derived((entry.pages ?? []).filter(hasImage));
	const detail = $derived(pages[pages.length - 1] ?? null);
	const panning = $derived(CRAFT_PAN_ENABLED && !motionReduced);
</script>

{#if detail?.image_url}
	{#key detail.image_url}
		<figure class="craft-frame">
			<img
				class="craft-photo"
				class:panning
				class:paused
				src={detail.image_url}
				alt={detail.caption ?? ''}
				loading="lazy"
				decoding="async"
				referrerpolicy="no-referrer"
				onerror={() => onImageError?.()}
			/>
			{#if detail.caption}
				<figcaption>{detail.caption}</figcaption>
			{/if}
		</figure>
	{/key}
{:else}
	<NodeFallbackIcon type="craft" />
{/if}

<style>
	.craft-frame {
		position: relative;
		width: 100%;
		height: 100%;
		margin: 0;
		overflow: hidden;
	}

	.craft-photo {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	/* Scaled past the frame so there is image to travel across, then drifted
	   back and forth. Slow enough to read as a camera moving over the piece. */
	.craft-photo.panning {
		transform: scale(1.22);
		animation: craft-pan 32s ease-in-out infinite alternate;
	}

	.craft-photo.paused {
		animation-play-state: paused;
	}

	figcaption {
		position: absolute;
		right: 0;
		bottom: 0;
		left: 0;
		padding: 1.4rem 0.8rem 0.6rem;
		background: linear-gradient(to top, rgb(10 8 16 / 0.82), transparent);
		color: rgb(255 255 255 / 0.94);
		font-size: var(--text-sm);
		line-height: 1.3;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
	}

	@keyframes craft-pan {
		from {
			transform: scale(1.22) translate(-5%, -3%);
		}
		to {
			transform: scale(1.22) translate(5%, 3%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.craft-photo.panning {
			animation: none;
			transform: none;
		}
	}
</style>
