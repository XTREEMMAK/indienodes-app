import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FieldNode from './FieldNode.svelte';
import { audioPlayerStore } from '$lib/audioPlayerStore.svelte.js';
import { comicViewerStore } from '$lib/comicViewerStore.svelte.js';
import { textViewerStore } from '$lib/textViewerStore.svelte.js';

const BASE = {
	creator: 'Interaction Test',
	why: 'A primary-action fixture.',
	source_url: 'https://example.com',
	tags: ['test'],
	verification_token: 'test'
};

/** @type {import('$lib/ring.js').RingEntry} */
const ART_ENTRY = {
	...BASE,
	id: 'interaction-art',
	type: 'art',
	artworks: [
		{
			image_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
			alt: 'Interaction artwork'
		}
	]
};

/** @type {import('$lib/ring.js').RingEntry} */
const TEXT_ENTRY = {
	...BASE,
	id: 'interaction-text',
	type: 'text',
	excerpts: [{ text: '<p>Reader fixture.</p>' }]
};

/** @type {import('$lib/ring.js').RingEntry} */
const AUDIO_ENTRY = {
	...BASE,
	id: 'interaction-audio',
	type: 'audio',
	form: 'music',
	tracks: [{ label: 'Test track', media_url: 'https://example.com/test.mp3' }]
};

/** @type {import('$lib/ring.js').RingEntry} */
const GAME_ENTRY = {
	...BASE,
	id: 'interaction-game',
	type: 'game',
	thumb_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
	trailer_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
};

/** @param {Element} target @param {string} type @param {number} x @param {number} y */
function pointer(target, type, x, y) {
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			button: 0,
			clientX: x,
			clientY: y,
			isPrimary: true,
			pointerId: 1,
			pointerType: 'touch'
		})
	);
}

afterEach(() => {
	audioPlayerStore.clear();
	audioPlayerStore.stopPreview();
	comicViewerStore.hide();
	textViewerStore.hide();
	vi.restoreAllMocks();
});

describe('FieldNode primary action', () => {
	it('opens an art gallery from the passive Field card surface', async () => {
		const screen = await render(FieldNode, {
			entry: ART_ENTRY,
			ambient: true,
			motionReducedOverride: true
		});

		await screen.getByText(BASE.why).click();

		expect(comicViewerStore.entry?.id).toBe(ART_ENTRY.id);
		await expect
			.element(screen.getByRole('button', { name: "View Interaction Test's gallery" }))
			.toBeInTheDocument();
	});

	it('keeps the labelled viewer control from firing the delegated action twice', async () => {
		const show = vi.spyOn(comicViewerStore, 'show');
		const screen = await render(FieldNode, {
			entry: ART_ENTRY,
			ambient: true,
			motionReducedOverride: true
		});

		await screen.getByRole('button', { name: "View Interaction Test's gallery" }).last().click();

		expect(show).toHaveBeenCalledTimes(1);
	});

	it('routes text cards to their reader', async () => {
		const screen = await render(FieldNode, {
			entry: TEXT_ENTRY,
			ambient: true,
			motionReducedOverride: true
		});

		await screen.getByText(BASE.why).click();

		expect(textViewerStore.entry?.id).toBe(TEXT_ENTRY.id);
	});

	it('routes audio cards to their existing queue-aware play action', async () => {
		const screen = await render(FieldNode, {
			entry: AUDIO_ENTRY,
			ambient: true,
			motionReducedOverride: true
		});

		await screen.getByText(BASE.why).click();

		expect(audioPlayerStore.current?.entryId).toBe(AUDIO_ENTRY.id);
		expect(audioPlayerStore.playing).toBe(true);
	});

	it('suppresses activation when a touch moves far enough to be a scroll gesture', async () => {
		await render(FieldNode, {
			entry: ART_ENTRY,
			ambient: true,
			motionReducedOverride: true
		});
		const surface = document.querySelector('.stage-layer');
		if (!(surface instanceof HTMLElement)) throw new Error('Passive card surface is missing');

		pointer(surface, 'pointerdown', 20, 20);
		pointer(surface, 'pointermove', 20, 36);
		pointer(surface, 'pointerup', 20, 36);
		surface.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

		expect(comicViewerStore.open).toBe(false);
	});

	it('suppresses activation when an ancestor scroll position changes', async () => {
		await render(FieldNode, {
			entry: ART_ENTRY,
			ambient: true,
			motionReducedOverride: true
		});
		const surface = document.querySelector('.stage-layer');
		const scroller = document.scrollingElement;
		if (!(surface instanceof HTMLElement) || !scroller) {
			throw new Error('Card surface or document scroller is missing');
		}

		const ownScrollTop = Object.getOwnPropertyDescriptor(scroller, 'scrollTop');
		pointer(surface, 'pointerdown', 20, 20);
		try {
			Object.defineProperty(scroller, 'scrollTop', {
				configurable: true,
				writable: true,
				value: scroller.scrollTop + 1
			});
			pointer(surface, 'pointerup', 20, 20);
			surface.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
		} finally {
			if (ownScrollTop) Object.defineProperty(scroller, 'scrollTop', ownScrollTop);
			else Reflect.deleteProperty(scroller, 'scrollTop');
		}

		expect(comicViewerStore.open).toBe(false);
	});

	it('does not offer a card-wide action in Arrange mode, Lists, or game nodes', async () => {
		const arranged = await render(FieldNode, {
			entry: ART_ENTRY,
			ambient: true,
			editMode: true,
			motionReducedOverride: true
		});
		expect(arranged.container.querySelector('.has-primary-action')).toBeNull();

		const listed = await render(FieldNode, {
			entry: ART_ENTRY,
			ambient: false,
			motionReducedOverride: true
		});
		expect(listed.container.querySelector('.has-primary-action')).toBeNull();

		const game = await render(FieldNode, {
			entry: GAME_ENTRY,
			ambient: true,
			motionReducedOverride: true
		});
		expect(game.container.querySelector('.has-primary-action')).toBeNull();
	});

	it('marks actionable Field cards with the restrained hover affordance', async () => {
		await render(FieldNode, {
			entry: ART_ENTRY,
			ambient: true,
			motionReducedOverride: true
		});
		const node = document.querySelector('.node');

		expect(node).toBeInstanceOf(HTMLElement);
		expect(getComputedStyle(/** @type {HTMLElement} */ (node)).cursor).toBe('pointer');
		expect(node?.classList.contains('has-primary-action')).toBe(true);
	});
});

describe('FieldNode form badge', () => {
	it('shows a Music badge for a music-form audio entry', async () => {
		const screen = await render(FieldNode, {
			entry: AUDIO_ENTRY,
			ambient: true,
			motionReducedOverride: true
		});
		expect(screen.container.querySelector('.form-badge')?.textContent).toBe('Music');
	});

	it('shows a Spoken badge for a spoken-form audio entry', async () => {
		const screen = await render(FieldNode, {
			entry: { ...AUDIO_ENTRY, form: 'spoken' },
			ambient: true,
			motionReducedOverride: true
		});
		expect(screen.container.querySelector('.form-badge')?.textContent).toBe('Spoken');
	});

	it('renders no form badge for a pre-migration audio entry with no form yet', async () => {
		const screen = await render(FieldNode, {
			entry: { ...AUDIO_ENTRY, form: undefined },
			ambient: true,
			motionReducedOverride: true
		});
		expect(screen.container.querySelector('.form-badge')).toBeNull();
	});

	it('renders no form badge for a non-audio type', async () => {
		const screen = await render(FieldNode, {
			entry: TEXT_ENTRY,
			ambient: true,
			motionReducedOverride: true
		});
		expect(screen.container.querySelector('.form-badge')).toBeNull();
	});
});
