<script>
	/**
	 * Last-resort error page, outside the app chrome.
	 *
	 * SvelteKit's client imports the root error page on every route, so this
	 * one stays dependency-free. Visitors almost never see it: unknown URLs
	 * are caught inside the `(app)` group (`[...missing]`) and rendered by
	 * `(app)/+error.svelte` with the full app around them. This covers only
	 * errors outside that group, such as the `/embed-frame` widget target,
	 * and a failure in the app layout itself.
	 */
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>{page.status === 404 ? 'Not found' : 'Error'} · IndieNodes</title>
</svelte:head>

<main class="root-error">
	<p class="status">{page.status}</p>
	<p>{page.status === 404 ? "That page isn't here." : 'Something went wrong.'}</p>
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a full reload to the app root is the point: it leaves whatever state failed -->
	<a href="/" data-sveltekit-reload>Go to IndieNodes</a>
</main>

<style>
	.root-error {
		font-family: system-ui, sans-serif;
		max-width: 32rem;
		margin: 4rem auto;
		padding: 0 1rem;
		text-align: center;
	}

	.status {
		font-size: 2.5rem;
		font-weight: 700;
		margin: 0;
	}
</style>
