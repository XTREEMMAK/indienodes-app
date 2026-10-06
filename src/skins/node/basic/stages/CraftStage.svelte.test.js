import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CraftStage from './CraftStage.svelte';

const SVG = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
const SVG_DETAIL = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';

/** @param {number} count */
function entryWith(count) {
	return {
		id: 'craft-stage-test',
		creator: 'Test Maker',
		type: 'craft',
		pages: [
			{ image_url: SVG, caption: 'Full view' },
			{ image_url: SVG_DETAIL, caption: 'Detail of the border' }
		].slice(0, count)
	};
}

describe('CraftStage', () => {
	it('shows the last page as the detail shot, with its caption', async () => {
		const screen = await render(CraftStage, { entry: entryWith(2) });
		await expect.element(screen.getByAltText('Detail of the border')).toBeInTheDocument();
		expect(screen.getByAltText('Full view').elements()).toHaveLength(0);
		await expect.element(screen.getByText('Detail of the border')).toBeInTheDocument();
	});

	it('uses the only page when there is one', async () => {
		const screen = await render(CraftStage, { entry: entryWith(1) });
		await expect.element(screen.getByAltText('Full view')).toBeInTheDocument();
	});

	it('pans by default', async () => {
		const screen = await render(CraftStage, { entry: entryWith(1), motionReduced: false });
		await expect.element(screen.getByAltText('Full view')).toHaveClass('panning');
	});

	it('holds still under reduced motion', async () => {
		const screen = await render(CraftStage, { entry: entryWith(1), motionReduced: true });
		await expect.element(screen.getByAltText('Full view')).not.toHaveClass('panning');
	});

	it('falls back to the craft icon when no page has an image', async () => {
		const screen = await render(CraftStage, { entry: { ...entryWith(1), pages: [] } });
		expect(screen.container.querySelector('img')).toBeNull();
		expect(screen.container.querySelector('svg')).not.toBeNull();
	});
});
