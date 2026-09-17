import { loadRing } from '$lib/ring.js';

export async function load({ fetch }) {
	const entries = await loadRing(fetch);
	return { entries };
}
