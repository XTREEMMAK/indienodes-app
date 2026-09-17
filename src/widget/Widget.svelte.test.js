import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Widget from './Widget.svelte';

/**
 * The widget runs on other people's sites, where no visitor setting can opt
 * in to explicit content. These pin that its Prev/Next/Random never send a
 * visitor to an entry marked explicit, which the app's own `/go/random` and
 * every in-app surface already guarantee.
 */

/** @param {string} id @param {boolean} [explicit] */
const entry = (id, explicit = false) => ({
	id,
	creator: `Creator ${id}`,
	type: 'audio',
	why: 'A widget fixture.',
	source_url: `https://${id}.example/`,
	tags: ['test'],
	verification_token: 'test',
	...(explicit ? { explicit: true } : {})
});

/** @param {object[]} ring */
function serve(ring) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify(ring)))
	);
	return vi.spyOn(window, 'open').mockImplementation(() => null);
}

/** Every URL the widget opened, in order. @param {import('vitest').MockInstance} open */
const opened = (open) => open.mock.calls.map((call) => call[0]);

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('Widget explicit-content gate', () => {
	it('never opens an explicit member, walking the whole ring both ways', async () => {
		const open = serve([entry('own'), entry('a'), entry('adult', true), entry('b')]);
		const screen = render(Widget, { siteId: 'own' });
		const next = screen.getByRole('button', { name: /Next/ });
		await expect.element(next).toBeEnabled();

		for (let i = 0; i < 6; i++) await next.click();
		const prev = screen.getByRole('button', { name: /Prev/ });
		for (let i = 0; i < 6; i++) await prev.click();
		const random = screen.getByRole('button', { name: /Random/ });
		for (let i = 0; i < 10; i++) await random.click();

		expect(opened(open).length).toBeGreaterThan(0);
		expect(opened(open)).not.toContain('https://adult.example/');
	});

	it("keeps Prev/Next relative to an explicit host, without ever opening the host's entry", async () => {
		const open = serve([entry('a'), entry('own', true), entry('b')]);
		const screen = render(Widget, { siteId: 'own' });
		const next = screen.getByRole('button', { name: /Next/ });
		await expect.element(next).toBeEnabled();

		await next.click();
		expect(opened(open)[0]).toBe('https://b.example/');

		for (let i = 0; i < 5; i++) await next.click();
		expect(opened(open)).not.toContain('https://own.example/');
	});

	it('treats a ring with only explicit others as having no one to visit', async () => {
		serve([entry('own'), entry('adult', true)]);
		const screen = render(Widget, { siteId: 'own' });
		await expect
			.element(screen.getByText('The ring has no other members yet.'))
			.toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
	});
});
