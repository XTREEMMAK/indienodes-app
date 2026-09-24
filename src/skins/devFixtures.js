const SILENT_WAV =
	'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const ART = '/images/IndieNodes_Logo.webp';

/** @type {import('../lib/ring.js').RingEntry[]} */
export const SKIN_LAB_ENTRIES = [
	{
		id: 'skin-lab-audio',
		creator: 'Midnight Receiver',
		type: 'audio',
		why: 'Field recordings, soft machinery, and songs transmitted after closing time.',
		source_url: 'https://example.com/audio',
		tags: ['ambient', 'field-recording'],
		tracks: [{ label: 'Quiet Signal', media_url: SILENT_WAV }],
		thumb_url: ART,
		verification_token: 'skin-lab'
	},
	{
		id: 'skin-lab-comic',
		creator: 'Paper Lantern Comics',
		type: 'comic',
		why: 'A weekly ghost story about the last shop still open on an empty street.',
		source_url: 'https://example.com/comic',
		tags: ['horror', 'slice-of-life'],
		pages: [
			{ image_url: ART, caption: 'The shop after close.' },
			{ image_url: ART, caption: 'A knock at the back door.' }
		],
		verification_token: 'skin-lab'
	},
	{
		id: 'skin-lab-text',
		creator: 'Loose Leaf Press',
		type: 'text',
		why: 'Essays about food, memory, and the kitchens that held both.',
		source_url: 'https://example.com/text',
		tags: ['essay', 'food'],
		excerpts: [
			{
				text: 'The recipe card had been rewritten so many times that every measurement carried an opinion.'
			},
			{
				text: 'Every kitchen keeps its own time, measured in cooling racks and kettles rather than clocks.',
				audio_url: 'https://example.com/skin-lab/reading.mp3'
			}
		],
		thumb_url: ART,
		verification_token: 'skin-lab'
	},
	{
		id: 'skin-lab-art',
		creator: 'North Window Studio',
		type: 'art',
		why: 'Small paintings about night buses, lit windows, and the people between stops.',
		source_url: 'https://example.com/art',
		tags: ['painting', 'city'],
		artworks: [
			{ image_url: ART, alt: 'A blue night bus passing a row of warm apartment windows.' }
		],
		verification_token: 'skin-lab'
	},
	{
		id: 'skin-lab-craft',
		creator: 'Fictional Loom Works',
		type: 'craft',
		why: 'Hand-woven wall hangings in wool and linen.',
		source_url: 'https://example.com/craft',
		tags: ['weaving', 'textile'],
		pages: [{ image_url: ART, caption: 'Full piece, 24 x 36 in, wool on linen warp' }],
		verification_token: 'skin-lab'
	},
	{
		id: 'skin-lab-craft-set',
		creator: 'Imaginary Kiln Studio',
		type: 'craft',
		why: 'Stoneware cups and bowls, thrown and glazed in small batches.',
		source_url: 'https://example.com/craft-set',
		tags: ['ceramics', 'stoneware'],
		pages: [
			{ image_url: ART, caption: 'Full view, 8 in tall, glazed stoneware' },
			{ image_url: ART, caption: 'Rim and glaze pooling' },
			{ image_url: ART, caption: 'Detail of the thumb-pressed foot' }
		],
		verification_token: 'skin-lab'
	},
	{
		id: 'skin-lab-game',
		creator: 'Tin Roof Studio',
		type: 'game',
		why: 'A slow puzzle game about weather systems and the towns waiting them out.',
		source_url: 'https://example.com/game',
		tags: ['puzzle', 'weather'],
		thumb_url: ART,
		trailer_url: 'https://youtu.be/dQw4w9WgXcQ',
		verification_token: 'skin-lab'
	}
];

/** @param {import('../lib/ring.js').RingEntry} entry */
export function withoutLabArtwork(entry) {
	return {
		...entry,
		thumb_url: undefined,
		pages: entry.pages?.map((page) => ({ ...page, image_url: '' })),
		artworks: entry.artworks?.map((artwork) => ({ ...artwork, image_url: '' }))
	};
}
