import { error } from '@sveltejs/kit';

/**
 * Unknown URLs land here rather than falling through to the root error page,
 * so a 404 still renders inside the app layout (`(app)/+error.svelte`), with
 * the nav and background, the way it did before the app moved into this
 * group. Only real routes are prerendered: static hosting serves the
 * adapter's `404.html` fallback for anything else, and the client router
 * resolves it to this route.
 */
export const prerender = false;

export function load() {
	error(404, 'Not found');
}
