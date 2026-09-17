<script>
	/**
	 * The sandboxed-iframe embed target. A member's page loads this cross-
	 * origin via `<iframe src=".../embed-frame?site-id=..." sandbox=
	 * "allow-scripts allow-popups allow-popups-to-escape-sandbox">` instead of
	 * pasting the raw `<script>`+`<indienode-widget>` snippet: a script tag
	 * runs with the full authority of whatever page it's pasted into (reads
	 * cookies, DOM, storage, same-origin APIs), where a sandboxed iframe
	 * without `allow-same-origin` gets a forced opaque origin, unable to
	 * touch any of that regardless of which URL served it. This page's only
	 * job is to mount the real widget inside that boundary. See
	 * `docs/decisions.md`'s widget-iframe-isolation entry for the full
	 * reasoning, including why this is a same-origin route rather than a
	 * separate subdomain.
	 *
	 * Carries none of the main app's chrome: this route sits outside the
	 * `(app)` group, under the empty root layout, so it neither renders nor
	 * downloads it. A stray nav pill or ambient background inside a member's
	 * small widget-sized iframe would be a bug, not a feature.
	 */
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { sanitizeAccentColor, sanitizeFontFamily } from '$lib/widgetTheme.js';

	let ready = $state(false);

	onMount(() => {
		if (!browser) return;
		// Same load pattern /widget's own demo page uses: a plain DOM script
		// tag, not a bundler import(), since /embed.v1.js is a static asset
		// outside this project's module graph -- exactly how a real host page
		// loads it.
		const script = document.createElement('script');
		script.type = 'module';
		script.src = '/embed.v1.js';
		script.onload = () => {
			ready = true;
		};
		document.head.appendChild(script);
	});

	// Read from the query string, not a route param: this page is one
	// prerendered file (adapter-static has no per-member build step), and the
	// query string is exactly the mechanism a static host can still vary per
	// embed without a server. `page.url` reflects the real browser location
	// at runtime regardless of what was prerendered.
	const siteId = $derived(page.url.searchParams.get('site-id') ?? '');

	// Optional theming, opt-in by hand-editing the copied snippet's src URL:
	// a member appends &accent=... and/or &font=... to match their own
	// brand. Both are validated (see widgetTheme.js's own comment for why
	// that's hygiene rather than a real security boundary) and applied as
	// CSS custom properties Widget.svelte already exposes for exactly this.
	// An invalid or absent value resolves to `undefined`, which the
	// style: directive below treats as "don't set this property" rather
	// than the literal string "undefined".
	const accent = $derived(sanitizeAccentColor(page.url.searchParams.get('accent')));
	const fontFamily = $derived(sanitizeFontFamily(page.url.searchParams.get('font')));
</script>

<svelte:head>
	<title>IndieNodes widget</title>
</svelte:head>

<div class="frame">
	{#if ready}
		<indienode-widget
			site-id={siteId}
			style:--indienode-accent={accent}
			style:--indienode-font-family={fontFamily}
		></indienode-widget>
	{:else}
		<p class="loading">Loading…</p>
	{/if}
</div>

<style>
	:global(html),
	:global(body) {
		margin: 0;
		background: transparent;
	}

	.frame {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 0.5rem;
	}

	.loading {
		margin: 0;
		color: #6b6558;
		font-family: ui-sans-serif, system-ui, sans-serif;
		font-size: 0.85rem;
	}
</style>
