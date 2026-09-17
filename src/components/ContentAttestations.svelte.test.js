import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ContentAttestations from './ContentAttestations.svelte';

/**
 * The shared attestation block on /join and /update. The rules it enforces
 * live in submissionValidation.js; these pin the part only the component
 * owns: no default adult answer, and a confirmation that exists only after
 * "Yes" and is cleared when the answer goes back to "No".
 */

// The component holds its own state here (no bound props): plain getters and
// setters are not reactive, and the real bound path, with `$state` in the
// forms, is covered end to end by testing/content-attestations.e2e.js.
function renderOwn() {
	const onchange = vi.fn();
	const screen = render(ContentAttestations, { onchange });
	return { screen, onchange };
}

describe('ContentAttestations', () => {
	it('starts with no adult-content answer and no confirmation', async () => {
		const { screen } = renderOwn();
		await expect.element(screen.getByRole('radio', { name: 'Yes' })).not.toBeChecked();
		await expect.element(screen.getByRole('radio', { name: 'No' })).not.toBeChecked();
		expect(
			screen.getByRole('checkbox', { name: /behind a clear content warning/ }).elements()
		).toHaveLength(0);
	});

	it('shows the confirmation after "Yes" and hides and clears it after "No"', async () => {
		const { screen, onchange } = renderOwn();
		const confirm = screen.getByRole('checkbox', { name: /behind a clear content warning/ });

		await screen.getByRole('radio', { name: 'Yes' }).click();
		await expect.element(confirm).toBeVisible();
		await confirm.click();
		await expect.element(confirm).toBeChecked();

		await screen.getByRole('radio', { name: 'No' }).click();
		await expect.element(screen.getByRole('radio', { name: 'No' })).toBeChecked();
		await expect.poll(() => confirm.elements().length).toBe(0);

		// Back to "Yes": the earlier confirmation did not survive the "No".
		await screen.getByRole('radio', { name: 'Yes' }).click();
		await expect.element(confirm).toBeVisible();
		await expect.element(confirm).not.toBeChecked();
		expect(onchange).toHaveBeenCalled();
	});

	it('toggles the made-by-people and rights checkboxes and reports each change', async () => {
		const { screen, onchange } = renderOwn();
		const ai = screen.getByRole('checkbox', { name: /were made by people/ });
		const rights = screen.getByRole('checkbox', { name: /I hold the rights to the works/ });
		await ai.click();
		await rights.click();
		await expect.element(ai).toBeChecked();
		await expect.element(rights).toBeChecked();
		expect(onchange).toHaveBeenCalledTimes(2);
	});

	it('lists what is still missing, in plain words, and nothing once complete', async () => {
		const missing = { ai_attestation: 'Please confirm your featured works were made by people.' };
		const screen = render(ContentAttestations, { missing });
		await expect
			.element(screen.getByRole('status'))
			.toHaveTextContent('Please confirm your featured works were made by people.');

		const done = render(ContentAttestations, { missing: {}, idPrefix: 'done' });
		expect(done.container.querySelector('.still-needed')).toBeNull();
	});

	it('adds the PRO sentence to the rights box only when asked', async () => {
		const music = render(ContentAttestations, { showMusicProSentence: true, idPrefix: 'music' });
		await expect
			.element(music.getByRole('checkbox', { name: /PRO membership does not prevent me/ }))
			.toBeVisible();

		const other = render(ContentAttestations, { idPrefix: 'other' });
		expect(other.container.textContent).not.toContain('PRO membership');
	});
});
