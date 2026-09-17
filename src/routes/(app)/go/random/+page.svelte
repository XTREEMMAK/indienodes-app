<script>
	/**
	 * Where every badge and text-link tier points (`$lib/widgetTiers.js`'s
	 * `randomRedirectUrl`). The full widget's own Random button never needed
	 * a page like this: it runs inside its own custom element and already
	 * has the ring loaded and an entry list to pick from in memory. The
	 * lighter two tiers are just an `<a>` (the text-link tier isn't even
	 * allowed a script of its own — addendum section 2.3), so their "random"
	 * has to be a real destination rather than client logic pasted onto a
	 * third-party page.
	 *
	 * Same random pick as the widget's own Random: unfiltered by this
	 * visitor's own likes or hidden list. This page runs on this site's own
	 * origin, so it *could* read that local storage, but the widget's
	 * Random (running on a third-party origin, with no access to it at all)
	 * never has, and giving one tier a personalized random pick while the
	 * other two stay uniform would make "Random" mean three different
	 * things depending on which embed a visitor happened to click. Only the
	 * explicit-content gate applies, because that one is never optional
	 * anywhere else in this app either.
	 */
	import { onMount } from 'svelte';
	import { ringStore } from '$lib/ringStore.svelte.js';
	import { preferencesStore } from '$lib/preferencesStore.svelte.js';
	import { isVisibleTo } from '$lib/ring.js';

	let failed = $state(false);

	onMount(async () => {
		await ringStore.ensureLoaded();
		const pool = ringStore.entries.filter((entry) =>
			isVisibleTo(entry, preferencesStore.showExplicit)
		);
		if (pool.length === 0) {
			failed = true;
			return;
		}
		const entry = pool[Math.floor(Math.random() * pool.length)];
		location.replace(entry.source_url);
	});
</script>

<svelte:head>
	<title>Taking you to a random member, IndieNodes</title>
	<!-- Never worth indexing on its own: the destination changes every visit,
	     and nothing here is content a search result should ever point at. -->
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="redirect-page">
	{#if failed}
		<!-- Same wording the field view already uses for an unreachable ring
		     (`src/routes/+page.svelte`), rather than a new error state per
		     tier (addendum section 4: "do not introduce new error states"). -->
		<p class="status">The ring could not be loaded.</p>
	{:else}
		<p class="status">Taking you to a random member…</p>
	{/if}
</div>

<style>
	.redirect-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 60vh;
		padding: 2rem;
		text-align: center;
	}

	.status {
		color: var(--text-muted);
		font-size: var(--text-base);
	}
</style>
