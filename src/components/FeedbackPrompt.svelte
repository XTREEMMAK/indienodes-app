<script>
	/**
	 * The one-time rating and support prompt. Two steps in one dialog: rate the
	 * app, then optionally support it.
	 *
	 * The boundaries this must not cross are argued in docs/decisions.md and
	 * restated in feedbackStore: the rating is about THIS APP, never about a
	 * creator, a Node, or a work; it never ranks or recommends anything; and it
	 * never comes back as a number a visitor can see. It also cannot recur —
	 * the store is marked answered before the request goes out, so a failed
	 * send loses the rating rather than earning a second ask.
	 */
	import { untrack } from 'svelte';
	import Modal from './Modal.svelte';
	import Honeypot from './Honeypot.svelte';
	import { feedbackStore } from '$lib/feedbackStore.svelte.js';
	import { KOFI_URL } from '$lib/config.js';
	import { createAntiBot } from '$lib/antiBot.svelte.js';
	import { submitRating, hasBackend, useMock } from '$lib/ratingApi.js';

	/**
	 * `initialStep` exists only for `+layout.svelte`'s
	 * `?debug=rating-test-support` shortcut, to preview the Ko-fi step
	 * without clicking through a real rating first — real usage never passes
	 * it, so it defaults to the normal starting point.
	 */
	let { open = false, onClose, initialStep = 'rating' } = $props();

	/** 'rating' asks; 'support' thanks and offers Ko-fi. */
	let step = $state(untrack(() => initialStep));
	let selected = $state(0);
	let hovered = $state(0);

	// The dwell clock deliberately runs from mount, not from when the dialog
	// opens, which is the same "time since the page was rendered" the other
	// webhook-backed forms send. Resetting it on open was tried and reverted:
	// the prompt itself only appears four seconds in, so a visitor who rates
	// quickly can post an elapsed_ms under n8n's 1500ms dwell gate and be
	// silently bot-dropped. Measuring from mount cannot produce a value the
	// gate rejects, and the gate only ever tests for too-fast.
	const antiBot = createAntiBot();

	const STARS = [1, 2, 3, 4, 5];
	const LABELS = ['Poor', 'Fair', 'Good', 'Great', 'Excellent'];

	/** The filled count follows the pointer before a choice is committed. */
	const shown = $derived(hovered || selected);

	function finish() {
		step = 'rating';
		selected = 0;
		hovered = 0;
		onClose?.();
	}

	/**
	 * Marked answered first, deliberately. A rating nobody is waiting on is not
	 * worth a retry, and it is certainly not worth asking a second time.
	 */
	async function send() {
		if (!selected) return;
		feedbackStore.markAnswered();
		if (hasBackend || useMock) {
			try {
				await submitRating({
					rating: selected,
					website: antiBot.honeypot,
					elapsed_ms: antiBot.elapsedMs
				});
			} catch {
				// Deliberately silent. The visitor did their part; a delivery
				// problem is not their problem to see, and there is nothing
				// useful for them to do about it.
			}
		}
		// Ko-fi is the only reason to continue, so skip straight out when the
		// link is not configured — same "unset means off, not broken" posture
		// AboutModal uses when it drops the Support tab entirely.
		if (KOFI_URL) step = 'support';
		else finish();
	}

	function dismiss() {
		feedbackStore.markAnswered();
		finish();
	}
</script>

<Modal
	{open}
	title={step === 'rating' ? 'How has IndieNodes been for you?' : 'Thanks for helping'}
	dialogClass="feedback-modal"
	onClose={dismiss}
>
	{#if step === 'rating'}
		<p class="prompt-copy">
			This is about IndieNodes itself, how it works and how it feels to explore. This rating is
			separate from the creators and the works of the creators you have found here. Asked once, and
			<em>never</em> again on this device.
		</p>

		<!-- The gradient is defined once here rather than once per star: five
		     inline SVGs each carrying their own <linearGradient> would work
		     (ids are document-global, not scoped to one <svg>), but it is one
		     definition repeated five times for no reason. Zero-size and
		     aria-hidden since it draws nothing itself — every star's fill
		     just references #rating-star-gold. -->
		<svg width="0" height="0" style="position: absolute;" aria-hidden="true">
			<defs>
				<linearGradient id="rating-star-gold" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stop-color="#FFCC33" />
					<stop offset="1" stop-color="#FF9900" />
				</linearGradient>
			</defs>
		</svg>

		<!-- Radios, not buttons: a rating is one choice from a set, and that is
		     what a radio group already means to a screen reader and to the
		     keyboard. The visual stars are the label. -->
		<fieldset class="stars">
			<legend class="sr-only">Rate IndieNodes from 1 to 5</legend>
			{#each STARS as star (star)}
				<label
					class="star"
					class:filled={star <= shown}
					onmouseenter={() => (hovered = star)}
					onmouseleave={() => (hovered = 0)}
				>
					<input
						type="radio"
						name="rating"
						value={star}
						checked={selected === star}
						onchange={() => (selected = star)}
					/>
					<span class="sr-only">{star} — {LABELS[star - 1]}</span>
					<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
						<path
							d="M 11.358 3.865 Q 12.000 2.300 12.642 3.865 L 13.872 6.863 Q 14.674 8.819 16.782 8.978 L 20.014 9.221 Q 21.701 9.348 20.411 10.442 L 17.939 12.539 Q 16.327 13.906 16.828 15.960 L 17.595 19.109 Q 17.995 20.752 16.557 19.863 L 13.799 18.161 Q 12.000 17.050 10.201 18.161 L 7.443 19.863 Q 6.005 20.752 6.405 19.109 L 7.172 15.960 Q 7.673 13.906 6.061 12.539 L 3.589 10.442 Q 2.299 9.348 3.986 9.221 L 7.218 8.978 Q 9.326 8.819 10.128 6.863 L 11.358 3.865 Z"
						/>
					</svg>
					<!-- Pure CSS, not a Svelte transition: the burst only has to
					     replay every time a `:hover` rule starts matching again,
					     which the browser already restarts an animation for on
					     its own -- no JS needed to detect "hovering the same
					     star a second time" the way a class-toggle would. -->
					<span class="particles" aria-hidden="true">
						{#each [0, 1, 2, 3, 4, 5] as i (i)}
							<span class="particle" style="--i: {i}"></span>
						{/each}
					</span>
				</label>
			{/each}
		</fieldset>

		<p class="star-label" aria-live="polite">
			{shown ? LABELS[shown - 1] : ' '}
		</p>

		<!-- Same anti-bot pair every other webhook-backed form here sends. -->
		<Honeypot id="f-rating-website" bind:value={antiBot.honeypot} />

		<div class="prompt-actions">
			<button type="button" class="btn btn-secondary" onclick={dismiss}>Not now</button>
			<button type="button" class="btn btn-primary" disabled={!selected} onclick={send}>
				Send rating
			</button>
		</div>
	{:else}
		<p class="prompt-copy">
			Thanks for helping us improve it. IndieNodes is built and maintained by a single developer, so
			if you would like to help keep it independent, you can support development on Ko-fi.
		</p>
		<div class="prompt-actions">
			<button type="button" class="btn btn-secondary" onclick={finish}>Not now</button>
			<!-- eslint-disable svelte/no-navigation-without-resolve -- external URL from config.js, not an app route; same as AboutModal's Support tab -->
			<a
				class="btn btn-primary"
				href={KOFI_URL}
				target="_blank"
				rel="noopener noreferrer"
				onclick={finish}
			>
				<!-- Ko-fi's own mark, not a generic mug -- same icon and reasoning
				     as AboutModal's own Support tab link. -->
				<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
					<path
						fill="currentColor"
						d="M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493 1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182 2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195-1.09-2-1.298-4.155-1.298-7.506 0-2.181.857-3.402 3.012-3.714 1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545 1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142 0 1.533.858 2.857 1.949 3.897.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896 1.117-1.039 1.974-2.364 1.974-3.897 0-1.662-1.247-3.142-3.039-3.142-1.065 0-1.792.545-2.338 1.298-.493-.753-1.246-1.298-2.312-1.298"
					/>
				</svg>
				Support IndieNodes
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</div>
	{/if}
</Modal>

<style>
	.prompt-copy {
		margin: 0 0 1.25rem;
		color: var(--text-muted);
		font-size: var(--text-sm);
		line-height: 1.55;
	}

	.stars {
		display: flex;
		justify-content: center;
		margin: 0;
		padding: 0;
		border: 0;
	}

	/* Spacing lives in each star's own padding rather than a `gap` between
	   them: a `gap` is dead space no `.star` element covers, so the pointer
	   crossing it between two stars briefly hovers neither -- `shown` drops
	   to `hovered || selected`'s `selected` (0 before a first pick), and the
	   whole preview visibly blanks for that instant. Padding keeps the same
	   visual spacing while keeping the hover target contiguous across the
	   row, so there is no gap to cross in the first place. */
	.star {
		position: relative;
		padding: 0 0.2rem;
		cursor: pointer;
		transition: transform 0.15s ease;
	}

	.star svg {
		display: block;
		width: 4rem;
		height: 4rem;
	}

	/* Flat and muted unfilled, the shipped gold gradient once chosen --
	   defined once in the hidden <svg> above rating-star-gold, referenced by
	   every star rather than repeated in each one's own <defs>. */
	.star svg path {
		fill: var(--text-faint);
		transition: fill 0.15s ease;
	}

	.star.filled svg path {
		fill: url(#rating-star-gold);
	}

	/* A slight sparkle on hover, nothing more -- six dots flung outward from
	   the star's own center and gone within half a second. `rotate` then
	   `translateX` is the trick: rotating first turns translateX's axis with
	   it, so six particles at 60° apart fan out radially with no per-particle
	   sin/cos math, just `--i` picking each one's angle. */
	.particles {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.particle {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 0.3rem;
		height: 0.3rem;
		margin: -0.15rem 0 0 -0.15rem;
		border-radius: 50%;
		background: #ffcc33;
		opacity: 0;
	}

	.particle:nth-child(even) {
		background: #ff9900;
	}

	.star:hover .particle {
		animation: star-particle-burst 0.45s ease-out;
		animation-delay: calc(var(--i) * 15ms);
	}

	@keyframes star-particle-burst {
		0% {
			opacity: 1;
			transform: rotate(calc(var(--i) * 60deg)) translateX(0) scale(1);
		}
		100% {
			opacity: 0;
			transform: rotate(calc(var(--i) * 60deg)) translateX(1.6rem) scale(0.4);
		}
	}

	/* Scale rather than translate: a lift (translateY) shifts the star's own
	   hit-box out from under a stationary pointer, and the resulting
	   hover/unhover/hover oscillation was the actual cause of the rating
	   preview flickering while sweeping across the row -- confirmed by
	   disabling this rule outright and watching the flicker disappear.
	   Scaling up from center only ever grows the hit-box, so a pointer
	   already inside it before the hover can never end up outside it after. */
	.star:hover {
		transform: scale(1.08);
	}

	/* The radio itself is invisible but still focusable, so keyboard focus
	   lands on a real control and the ring is drawn on the star instead. */
	.star input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}

	.star:focus-within svg {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
		border-radius: 4px;
	}

	.star-label {
		margin: 0.5rem 0 1.25rem;
		color: var(--text-muted);
		font-size: var(--text-xs);
		text-align: center;
		min-height: 1.2em;
	}

	.prompt-actions {
		display: flex;
		justify-content: center;
		gap: 0.6rem;
	}

	.prompt-actions .btn {
		text-decoration: none;
	}

	/* Modal's own default 48rem wrapped this dialog's copy awkwardly --
	   see Modal's own doc comment on dialogClass, the escape hatch built
	   for exactly this: one caller needing its own sizing rather than the
	   shared default. */
	:global(.feedback-modal) {
		/* !important to beat Modal's own scoped `.dialog` rule, which compiles
		   to a two-class selector (its own class plus Svelte's scoping class)
		   and so outranks a plain single-class override on specificity alone
		   -- the same reason every other dialogClass override in this app
		   (join/+page.svelte's own) needs it too. */
		max-width: 56rem !important;
	}

	@media (prefers-reduced-motion: reduce) {
		.star {
			transition: none;
		}

		.star:hover {
			transform: none;
		}

		.star:hover .particle {
			animation: none;
		}
	}
</style>
