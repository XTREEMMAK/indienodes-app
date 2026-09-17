import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AdultContentSection from './AdultContentSection.svelte';

/**
 * The two adult-content questions and the definition they share, on /join's
 * entry step and /update's edit step.
 *
 * What this component owns: the definition applies to both questions, the
 * required site question is visibly its own panel rather than part of the
 * optional checkbox's, there is no default answer, and the confirmation
 * exists only after "Yes".
 *
 * The component holds its own state here (no bound props): plain getters and
 * setters are not reactive, and the bound path is covered end to end by
 * testing/content-attestations.e2e.js.
 */

function renderOwn(/** @type {Record<string, any>} */ props = {}) {
	const onchange = vi.fn();
	const screen = render(AdultContentSection, { onchange, ...props });
	return { screen, onchange };
}

describe('AdultContentSection', () => {
	it('states the definition once, for both questions', () => {
		const { screen } = renderOwn();
		expect(screen.container.textContent).toContain(
			'What counts as adult content here, for both questions below'
		);
		// Worded for both, rather than as instructions for the checkbox alone.
		expect(screen.container.textContent).toContain('Adult content');
		expect(screen.container.textContent).toContain('Not adult content');
		expect(screen.container.textContent).not.toContain('Check this for');
		expect(screen.container.textContent).not.toContain('Leave unchecked for');
	});

	it('keeps the required question in its own panel, not the checkbox’s', () => {
		const { screen } = renderOwn();
		const works = screen.container.querySelector('.works-panel');
		const site = screen.container.querySelector('.site-panel');
		expect(works).not.toBeNull();
		expect(site).not.toBeNull();
		expect(works?.contains(/** @type {Node} */ (site))).toBe(false);
		// The required marker belongs to the site question.
		expect(site?.querySelector('.required')).not.toBeNull();
		expect(site?.textContent).toContain('(required)');
	});

	it('asks both questions, and neither answers the other', async () => {
		const { screen } = renderOwn();
		const explicit = screen.getByRole('checkbox', { name: /This Node features adult content/ });
		await explicit.click();
		await expect.element(explicit).toBeChecked();
		// Ticking the works checkbox does not answer the site question.
		await expect.element(screen.getByRole('radio', { name: 'Yes' })).not.toBeChecked();
		await expect.element(screen.getByRole('radio', { name: 'No' })).not.toBeChecked();
	});

	it('shows the confirmation after "Yes", and hides and clears it after "No"', async () => {
		const { screen, onchange } = renderOwn();
		const confirm = screen.getByRole('checkbox', { name: /behind a clear content warning/ });

		await screen.getByRole('radio', { name: 'Yes' }).click();
		await expect.element(confirm).toBeVisible();
		await confirm.click();
		await expect.element(confirm).toBeChecked();

		await screen.getByRole('radio', { name: 'No' }).click();
		await expect.poll(() => confirm.elements().length).toBe(0);

		await screen.getByRole('radio', { name: 'Yes' }).click();
		await expect.element(confirm).toBeVisible();
		await expect.element(confirm).not.toBeChecked();
		expect(onchange).toHaveBeenCalled();
	});

	it('marks the site panel when its answer is missing, and says what is needed', async () => {
		const { screen } = renderOwn({
			missing: {
				adult_content: 'Please say whether your website includes adult content.',
				ai_attestation: 'Please confirm your featured works were made by people.'
			}
		});
		await expect
			.element(screen.getByRole('status'))
			.toHaveTextContent('Please say whether your website includes adult content.');
		expect(screen.container.querySelector('.site-panel.has-error')).not.toBeNull();
		// Only its own fields: the consent step owns the rest.
		expect(screen.container.textContent).not.toContain('were made by people');
	});
});
