import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ContentAttestations from './ContentAttestations.svelte';

/**
 * The attestations about the featured works, on /join's consent step and
 * /update's review step. The rules live in submissionValidation.js; this
 * covers what the component decides: which boxes it renders, and that each
 * change is reported.
 *
 * `includeRights` is the difference between the two flows. /join folds the
 * rights statement into its one Rights and EULA checkbox, so it does not ask
 * again here; /update has no EULA box and asks for rights on its own.
 */

function renderOwn(/** @type {Record<string, any>} */ props = {}) {
	const onchange = vi.fn();
	const screen = render(ContentAttestations, { onchange, ...props });
	return { screen, onchange };
}

describe('ContentAttestations', () => {
	it('always asks whether the featured work was made by people', async () => {
		const { screen, onchange } = renderOwn();
		const ai = screen.getByRole('checkbox', { name: /were made by people/ });
		await ai.click();
		await expect.element(ai).toBeChecked();
		expect(onchange).toHaveBeenCalledTimes(1);
	});

	it('omits the rights box unless asked for it (/join folds it into the EULA)', () => {
		const { screen } = renderOwn();
		expect(
			screen.getByRole('checkbox', { name: /I hold the rights to the works/ }).elements()
		).toHaveLength(0);
	});

	it('asks for rights on its own when includeRights is set (/update)', async () => {
		const { screen } = renderOwn({ includeRights: true });
		const rights = screen.getByRole('checkbox', { name: /I hold the rights to the works/ });
		await rights.click();
		await expect.element(rights).toBeChecked();
	});

	it('adds the PRO sentence to the rights box only when asked', async () => {
		const music = render(ContentAttestations, { includeRights: true, showMusicProSentence: true });
		await expect
			.element(music.getByRole('checkbox', { name: /PRO membership does not prevent me/ }))
			.toBeVisible();

		const other = render(ContentAttestations, { includeRights: true });
		expect(other.container.textContent).not.toContain('PRO membership');
	});

	it('lists what is still missing, and nothing once complete', async () => {
		const screen = render(ContentAttestations, {
			missing: { ai_attestation: 'Please confirm your featured works were made by people.' }
		});
		await expect
			.element(screen.getByRole('status'))
			.toHaveTextContent('Please confirm your featured works were made by people.');

		const done = render(ContentAttestations, { missing: {} });
		expect(done.container.querySelector('.still-needed')).toBeNull();
	});

	it('never shows a missing-rights message while the rights box is hidden', () => {
		const screen = render(ContentAttestations, {
			missing: { rights_confirmation: 'Please confirm you hold the rights.' }
		});
		expect(screen.container.textContent).not.toContain('Please confirm you hold the rights.');
	});
});
