import { describe, expect, it } from 'vitest';
import {
	MEDIA_ERROR_VERDICTS,
	mediaUrlFields,
	mediaVerdictMessage,
	quickMediaVerdict
} from './mediaUrlCheck.js';

describe('mediaUrlFields', () => {
	it('lists every comic page and the cover, with validateEntry field paths', () => {
		const fields = mediaUrlFields({
			type: 'comic',
			pages: [
				{ image_url: ' https://e.com/1.png ' },
				{ image_url: '' },
				{ image_url: 'https://e.com/3.png' }
			],
			thumb_url: 'https://e.com/cover.png'
		});
		expect(fields).toEqual([
			{ field: 'pages.0.image_url', url: 'https://e.com/1.png', kind: 'image' },
			{ field: 'pages.2.image_url', url: 'https://e.com/3.png', kind: 'image' },
			{ field: 'thumb_url', url: 'https://e.com/cover.png', kind: 'image' }
		]);
	});

	it('lists artworks for art, and a preview (image or video) for games', () => {
		expect(
			mediaUrlFields({ type: 'art', artworks: [{ image_url: 'https://e.com/a.webp' }] })
		).toEqual([{ field: 'artworks.0.image_url', url: 'https://e.com/a.webp', kind: 'image' }]);
		expect(mediaUrlFields({ type: 'game', preview_url: 'https://e.com/p.mp4' })).toEqual([
			{ field: 'preview_url', url: 'https://e.com/p.mp4', kind: 'preview' }
		]);
	});

	it('ignores fields the entry type does not show', () => {
		expect(mediaUrlFields({ type: 'audio', pages: [{ image_url: 'https://e.com/x' }] })).toEqual(
			[]
		);
	});
});

describe('quickMediaVerdict', () => {
	it('calls a web-page extension a web page', () => {
		expect(quickMediaVerdict('https://e.com/comic/page-29.html')).toBe('html');
		expect(quickMediaVerdict('https://e.com/comic/page-29.HTM?x=1#y')).toBe('html');
	});

	it('never passes a URL on its extension alone', () => {
		expect(quickMediaVerdict('https://e.com/img/comics/pg29.png')).toBeNull();
		// The PR #30 URL has no extension at all: only the real check can tell.
		expect(quickMediaVerdict('https://frammyjammy.com/suzu-and-jack/?pg=29#showComic')).toBeNull();
	});
});

describe('mediaVerdictMessage', () => {
	it('explains a web page and how to copy the image address', () => {
		const message = mediaVerdictMessage('html');
		expect(message).toMatch(/looks like a web page, not an image/);
		expect(message).toMatch(/right-click it and choose "Copy image address"/);
	});

	it('names the accepted formats for a non-image', () => {
		expect(mediaVerdictMessage('not_image')).toMatch(/PNG, JPEG, WebP, GIF or AVIF/);
		expect(mediaVerdictMessage('not_image', 'preview')).toMatch(/an image or video/);
	});

	it('has nothing to say about a pass or an unknown verdict', () => {
		expect(mediaVerdictMessage('ok')).toBeNull();
		expect(mediaVerdictMessage('unknown')).toBeNull();
		expect(mediaVerdictMessage('something_newer')).toBeNull();
	});

	it('has a message for every finalize refusal code', () => {
		for (const verdict of Object.values(MEDIA_ERROR_VERDICTS)) {
			expect(mediaVerdictMessage(verdict)).toBeTruthy();
		}
	});
});
