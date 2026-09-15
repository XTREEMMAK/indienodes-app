<script>
	/**
	 * The one-time "add to home screen" banner on phones, and the iOS steps it
	 * (or the More menu) can open.
	 *
	 * A banner rather than a dialog: the app already carries two dialogs and a
	 * rating prompt, and this is an offer, not a question that needs an answer
	 * before anything else can happen. It sits above the mobile nav and
	 * appears once per browser — see installPromptStore for why once.
	 *
	 * @type {{ suppressed?: boolean }}
	 */
	let { suppressed = false } = $props();

	import { flyFade } from '$lib/transitions.js';
	import { feedbackStore } from '$lib/feedbackStore.svelte.js';
	import { installPromptStore } from '$lib/installPromptStore.svelte.js';

	let bannerOpen = $state(false);

	// Deferred past first paint for the same reason the rating prompt is, and
	// held back entirely while something else (ambient, a dialog) has the
	// screen. The ask is only spent once it has actually been seen.
	$effect(() => {
		if (suppressed || bannerOpen) return;
		if (!installPromptStore.bannerEligible(feedbackStore.visits)) return;
		const timer = setTimeout(() => {
			if (installPromptStore.bannerEligible(feedbackStore.visits)) {
				bannerOpen = true;
				installPromptStore.markAnswered();
			}
		}, 3000);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		if (suppressed || !installPromptStore.available) bannerOpen = false;
	});

	async function install() {
		bannerOpen = false;
		const result = await installPromptStore.install();
		if (result === 'ios') installPromptStore.setStepsOpen(true);
	}
</script>

{#if bannerOpen}
	<aside
		class="install-banner glass-panel"
		aria-label="Install IndieNodes"
		transition:flyFade={{ y: 18, duration: 220 }}
	>
		<img src="/icons/icon-192.png" alt="" width="40" height="40" />
		<p>
			<strong>Add IndieNodes to your home screen</strong>
			<span>Opens full screen, like an app.</span>
		</p>
		<button type="button" class="install-action" onclick={install}>
			{installPromptStore.method === 'ios' ? 'How to' : 'Install'}
		</button>
		<button
			type="button"
			class="install-dismiss"
			onclick={() => (bannerOpen = false)}
			aria-label="Dismiss install offer"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
		</button>
	</aside>
{/if}

{#if installPromptStore.stepsOpen}
	<aside
		class="install-banner install-steps glass-panel"
		aria-labelledby="install-steps-heading"
		transition:flyFade={{ y: 18, duration: 220 }}
	>
		<div class="steps-copy">
			<strong id="install-steps-heading">Add to your home screen</strong>
			<ol>
				<li>
					Tap <span class="share-glyph" aria-label="Share">
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1" />
						</svg>
					</span> Share in the browser bar.
				</li>
				<li>Choose <strong>Add to Home Screen</strong>.</li>
			</ol>
		</div>
		<button
			type="button"
			class="install-dismiss"
			onclick={() => installPromptStore.setStepsOpen(false)}
			aria-label="Close install steps"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
		</button>
	</aside>
{/if}

<style>
	.install-banner {
		position: fixed;
		left: 0.75rem;
		right: 0.75rem;
		/* Clear of the mobile nav, which sits 0.75rem up and is about 4.5rem tall. */
		bottom: calc(6rem + env(safe-area-inset-bottom));
		z-index: 47;
		display: flex;
		align-items: center;
		gap: 0.7rem;
		max-width: 30rem;
		margin-inline: auto;
		padding: 0.7rem 0.6rem 0.7rem 0.8rem;
		border-radius: var(--radius-lg);
	}

	.install-banner img {
		flex: 0 0 auto;
		border-radius: 0.6rem;
	}

	.install-banner p {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
		margin: 0;
		font-size: var(--text-sm);
		line-height: 1.3;
	}

	.install-banner p span {
		color: var(--text-muted);
		font-size: var(--text-xs);
	}

	.install-action {
		flex: 0 0 auto;
		min-height: 2.5rem;
		padding: 0.4rem 1rem;
		border: 0;
		border-radius: 999px;
		background: var(--accent);
		color: white;
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 700;
		cursor: pointer;
	}

	.install-dismiss {
		display: inline-grid;
		flex: 0 0 auto;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 0;
		border-radius: 999px;
		background: none;
		color: var(--text-muted);
		cursor: pointer;
	}

	.install-dismiss svg,
	.share-glyph svg {
		width: 1.1rem;
		height: 1.1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.install-steps {
		align-items: flex-start;
	}

	.steps-copy {
		flex: 1;
		min-width: 0;
		font-size: var(--text-sm);
	}

	.steps-copy ol {
		margin: 0.4rem 0 0;
		padding-left: 1.2rem;
	}

	.steps-copy li + li {
		margin-top: 0.25rem;
	}

	.share-glyph {
		display: inline-flex;
		vertical-align: -0.2em;
		color: var(--accent);
	}
</style>
