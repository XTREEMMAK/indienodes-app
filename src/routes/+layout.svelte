<script>
	/**
	 * The root layout is deliberately empty.
	 *
	 * Everything a visitor would recognise as the app (chrome, stylesheet,
	 * stores, the global viewers and player) lives in `(app)/+layout.svelte`.
	 * The one route outside that group is `/embed-frame`, which a member's
	 * site loads in a sandboxed iframe. SvelteKit loads a root layout's whole
	 * import graph on every route, whatever its markup renders, so the app
	 * chrome here meant every iframe embed downloaded roughly half a megabyte
	 * of JS and CSS it never showed.
	 */
	let { children } = $props();
</script>

{@render children()}
