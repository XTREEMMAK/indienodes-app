<script>
	// The field's loading state: the logo materialises out of nothing,
	// oversized and almost invisible, settling to its real size as the ring
	// arrives.
	//
	// This replaces a bare line of text, and it exists because the field has
	// no other first impression. The surface is deliberately idle once it
	// settles, so the only moment it can introduce itself is this one.
	//
	// The real logo, matching the About modal, rather than the small
	// four-square mark used in the header. This is the one place the brand
	// gets a full-size moment, so it should be the actual logo.
	//
	// Referenced by served path rather than imported, same as AboutModal:
	// files under static/ are copied through and are not part of the module
	// graph. It is `fetchpriority="high"` because it is the only thing on
	// screen and a loading screen that itself loads slowly is self-defeating.

	/** @type {{ message?: string }} */
	let { message = 'Loading the ring' } = $props();

	const LOGO_SRC = '/images/IndieNodes_Logo.webp';
</script>

<div class="ring-loading">
	<div class="mark">
		<img src={LOGO_SRC} alt="" width="1776" height="1488" fetchpriority="high" />
	</div>
	<p class="message">{message}<span class="dots" aria-hidden="true"></span></p>
</div>

<style>
	.ring-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.4rem;
		/* Matches the empty states this sits alongside, so the page does not
		   jump height when one replaces the other. */
		min-height: 60vh;
	}

	/* Ghost to solid: starts oversized, transparent, and out of focus, and
	   resolves into itself. Scale and blur travel together so it reads as
	   something approaching rather than something being stretched. */
	.mark img {
		display: block;
		width: auto;
		height: 11rem;
		aspect-ratio: 1776 / 1488;
		border-radius: var(--radius-md);
	}

	.mark {
		animation: materialise 900ms cubic-bezier(0.16, 0.84, 0.44, 1) both;
	}

	@keyframes materialise {
		from {
			opacity: 0;
			transform: scale(2.6);
			filter: blur(10px);
		}
		60% {
			opacity: 1;
		}
		to {
			opacity: 1;
			transform: scale(1);
			filter: blur(0);
		}
	}

	.message {
		color: var(--text-muted);
		font-size: var(--text-sm);
		animation: fade-up 600ms 260ms ease-out both;
	}

	@keyframes fade-up {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Three dots that fill in and reset, so the message reads as ongoing
	   without a spinner. Written as content rather than markup so it cannot
	   be picked up as text by a screen reader mid-cycle. */
	.dots::after {
		content: '';
		animation: dots 1.4s steps(4, end) infinite;
	}

	@keyframes dots {
		0% {
			content: '';
		}
		25% {
			content: '.';
		}
		50% {
			content: '..';
		}
		75% {
			content: '...';
		}
	}

	/* The zoom is the part this preference is actually about. The logo still
	   fades in, which is a small one-shot opacity change rather than motion,
	   and the dots stop cycling. */
	@media (prefers-reduced-motion: reduce) {
		.mark {
			animation: fade-only 300ms ease-out both;
		}

		.message {
			animation: fade-only 300ms 120ms ease-out both;
		}

		.dots::after {
			content: '...';
			animation: none;
		}

		@keyframes fade-only {
			from {
				opacity: 0;
			}
			to {
				opacity: 1;
			}
		}
	}
</style>
