<script>
	/**
	 * The one page nobody asks for.
	 *
	 * There was no error boundary anywhere in the app before this: a bad
	 * route fell through to SvelteKit's bare default, and `adapter-static`
	 * had nothing prerendered to hand a static host for an unmatched path.
	 * `vite.config.js`'s adapter now sets `fallback: '404.html'` so the build
	 * produces one; this component is what renders into it.
	 *
	 * Treated as part of the site rather than an apology screen: since this
	 * is a webring, the most useful thing to hand someone who is lost is a
	 * way back *into* the ring, not just a link to the homepage. "Visit a
	 * random member" mirrors the embeddable widget's own Random control
	 * (`src/widget/Widget.svelte`), which opens a member's `source_url` in a
	 * new tab rather than navigating away — there is no internal per-entry
	 * route to deep-link to, since the field view is the only place entries
	 * render, so sending a visitor to an actual member's site is the closer
	 * match to what "random" means in this app's own vocabulary than
	 * inventing a route that does not otherwise exist.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import GlassPanel from '../../components/GlassPanel.svelte';
	import { ringStore } from '$lib/ringStore.svelte.js';
	import { flyFade } from '$lib/transitions.js';

	const isNotFound = $derived(page.status === 404);

	const heading = $derived(isNotFound ? "That node isn't here" : 'Something broke');
	const body = $derived(
		isNotFound
			? "The page you're looking for doesn't exist, or moved. Nothing was lost on your end."
			: (page.error?.message ?? 'An unexpected error happened while loading this page.')
	);

	// A stable pick per page load rather than a $derived over
	// ringStore.entries: a derived would draw a new member every time the
	// store's fetch settles or any other reactive read on this page changes,
	// which would read as the link silently swapping under a visitor
	// mid-decision.
	let randomEntry = $state(/** @type {import('$lib/ring.js').RingEntry | null} */ (null));

	onMount(async () => {
		const entries = await ringStore.ensureLoaded();
		if (entries.length) randomEntry = entries[Math.floor(Math.random() * entries.length)];
	});
</script>

<svelte:head>
	<title>{isNotFound ? 'Not found' : 'Error'} · IndieNodes</title>
</svelte:head>

<div class="error-page">
	<div class="panel-wrap" in:flyFade={{ y: 12 }}>
		<GlassPanel as="div" class="error-panel">
			<p class="status" aria-hidden="true">{page.status}</p>
			<h1>{heading}</h1>
			<p class="body">{body}</p>

			<div class="actions">
				<a class="btn btn-primary" href={resolve('/')}>Back to the field</a>
				<a class="btn btn-ghost" href={resolve('/members')}>See every member</a>
			</div>

			{#if randomEntry}
				<p class="random">
					Or
					<!-- eslint-disable svelte/no-navigation-without-resolve -- a member's own source_url, not an app route; a block disable, not next-line, since prettier is free to wrap this tag's attributes across lines and push href away from a next-line comment -->
					<a
						href={randomEntry.source_url}
						target="_blank"
						rel="noopener noreferrer"
						style="color: var(--type-{randomEntry.type})"
					>
						visit {randomEntry.creator}
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
					, a random member of the ring.
				</p>
			{/if}
		</GlassPanel>
	</div>
</div>

<style>
	.error-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 70vh;
		padding: 3rem 2rem;
	}

	.panel-wrap {
		width: 100%;
		max-width: 34rem;
	}

	:global(.error-panel) {
		padding: 2.6rem 2.4rem;
		text-align: center;
	}

	.status {
		margin: 0 0 0.4rem;
		color: var(--text-faint);
		font-family: var(--font-display);
		font-size: var(--text-xl);
		font-weight: 700;
		letter-spacing: 0.02em;
	}

	h1 {
		margin: 0 0 0.9rem;
		font-size: var(--text-xl);
	}

	.body {
		max-width: 40ch;
		margin: 0 auto 2rem;
		color: var(--text-muted);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 1rem;
	}

	.random {
		margin: 1.8rem 0 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.random a {
		font-weight: 600;
	}

	@media (max-width: 30rem) {
		.error-page {
			padding: 2rem 1.2rem;
		}

		:global(.error-panel) {
			padding: 2rem 1.6rem;
		}
	}
</style>
