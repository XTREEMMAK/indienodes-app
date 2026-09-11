/**
 * Cross-checks the hand-written client validation against the real JSON
 * schema.
 *
 * `submissionValidation.js` explains why it does not simply run Ajv in the
 * browser (roughly 120 KB shipped to every visitor so one page can check a
 * form). The cost of that choice is the risk of drift: the schema changes,
 * the hand-written rules do not, and the form starts cheerfully accepting
 * entries the publish step will reject.
 *
 * This is the mechanism that makes that safe. It compiles the actual
 * `schema/ring.schema.json` with the same Ajv configuration
 * `scripts/validate-ring.js` uses, then asserts both agree in **both**
 * directions across a table of cases: anything the form accepts must
 * validate, and anything the form rejects must either fail the schema or
 * fail a rule the schema deliberately does not encode.
 *
 * That second clause is the interesting one. A few rules exist only in the
 * form (a length cap on `why`, requiring an email) because they are product
 * decisions rather than data-integrity ones. Those cases are marked
 * `formOnly` so the test asserts the asymmetry deliberately rather than
 * papering over it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
	MAX_EXCERPTS,
	MAX_ARTWORKS,
	MAX_PAGES,
	MAX_TRACKS,
	WHY_MAX_LENGTH,
	ENTRY_TYPES,
	ENTRY_TYPE_LABELS,
	validateEntry,
	toRingEntry,
	validateReview,
	consentGiven
} from './submissionValidation.js';

describe('entry type labels', () => {
	it('presents the internal audio type as Audio, split into music/spoken by `form`', () => {
		expect(ENTRY_TYPES).toContain('audio');
		expect(ENTRY_TYPE_LABELS.audio).toBe('Audio');
	});
	expect(ENTRY_TYPES).toContain('art');
	expect(ENTRY_TYPE_LABELS.art).toBe('Art');
});

const schema = JSON.parse(readFileSync('schema/ring.schema.json', 'utf8'));
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validateAgainstSchema = ajv.compile(schema);

/**
 * The backend supplies these; the form never collects them.
 *
 * These have to match whatever `schema/ring.schema.json` currently requires,
 * because that file is a *mirror* of indienodes-ring's canonical schema
 * (re-fetched by `sync-ring-mirror`), not something this repository authors.
 * `verification_token` is listed here even though the approval workflow has
 * stopped publishing it, precisely because the canonical schema still requires
 * it: dropping it here would make this suite assert a contract the ring does
 * not actually offer yet. Remove it once indienodes-ring relaxes that
 * requirement and the relaxation has been synced back.
 */
const BACKEND_FIELDS = {
	id: 'test-entry',
	verification_token: 'tok-abc123',
	joined_at: '2026-01-01T00:00:00Z'
};

/** A complete, valid form draft. Cases below vary one thing about it. */
function draft(overrides = {}) {
	return {
		creator: 'Driftwood Radio',
		type: 'text',
		why: 'A short essay about tape hiss.',
		has_own_site: 'yes',
		source_url: 'https://example.com/loose-leaf',
		tags: ['essay'],
		excerpts: [{ text: 'The hiss was the point.' }],
		tracks: [],
		artworks: [],
		pages: [],
		...overrides
	};
}

/**
 * Runs a draft through the form's own pipeline and then through the schema,
 * the way a real submission travels.
 * @param {Record<string, any>} entry
 */
function schemaVerdict(entry) {
	const candidate = { ...toRingEntry(entry), ...BACKEND_FIELDS };
	return validateAgainstSchema(candidate);
}

/**
 * @type {{ name: string, entry: Record<string, any>, formValid: boolean, formOnly?: boolean }[]}
 */
const cases = [
	{ name: 'a complete text entry', entry: draft(), formValid: true },
	{
		name: 'audio with no tracks (link-only member, a supported shape)',
		entry: draft({ type: 'audio', form: 'music', excerpts: undefined }),
		formValid: true
	},
	{
		name: 'audio with three tracks',
		entry: draft({
			type: 'audio',
			form: 'music',
			excerpts: undefined,
			tracks: [
				{ label: 'One', media_url: 'https://archive.org/1.mp3' },
				{ label: 'Two', media_url: 'https://archive.org/2.mp3' },
				{ label: 'Three', media_url: 'https://archive.org/3.mp3' }
			]
		}),
		formValid: true
	},
	{
		name: 'audio with four tracks',
		entry: draft({
			type: 'audio',
			form: 'music',
			excerpts: undefined,
			tracks: Array.from({ length: 4 }, (_, i) => ({
				label: `T${i}`,
				media_url: `https://archive.org/${i}.mp3`
			}))
		}),
		formValid: false
	},
	{
		name: 'spoken audio (narration, not music)',
		entry: draft({
			type: 'audio',
			form: 'spoken',
			excerpts: undefined,
			tracks: [{ label: 'Chapter One', media_url: 'https://archive.org/ch1.mp3' }]
		}),
		formValid: true
	},
	{
		name: 'audio missing its required form',
		entry: draft({ type: 'audio', excerpts: undefined }),
		formValid: false
	},
	{
		name: 'audio with a form value outside the enum',
		entry: draft({ type: 'audio', form: 'podcast', excerpts: undefined }),
		formValid: false
	},
	{
		name: 'a non-audio entry carrying a form value it must not have',
		entry: draft({ form: 'music' }),
		// `validateEntry` only checks `form` when `type` is audio, since the
		// form never shows or collects it for any other type: it has nothing
		// to say about a stray `form` here, so its own verdict is a pass.
		// The schema is what actually forbids `form` outside audio -- see the
		// dedicated assertion below, since this file's own agreement check
		// only ever asserts "form accepts implies schema accepts" and would
		// wrongly demand schema acceptance here if not marked formOnly.
		formValid: true,
		formOnly: true
	},
	{
		name: 'a comic with one page',
		entry: draft({
			type: 'comic',
			excerpts: undefined,
			pages: [{ image_url: 'https://example.com/p1.png', caption: 'One' }]
		}),
		formValid: true
	},
	{
		name: 'a comic with no pages',
		entry: draft({ type: 'comic', excerpts: undefined, pages: [] }),
		formValid: false
	},
	{
		name: 'a comic with four pages',
		entry: draft({
			type: 'comic',
			excerpts: undefined,
			pages: Array.from({ length: 4 }, (_, i) => ({
				image_url: `https://example.com/p${i}.png`
			}))
		}),
		formValid: false
	},
	{
		name: 'an Art entry with one described artwork',
		entry: draft({
			type: 'art',
			excerpts: undefined,
			artworks: [
				{
					image_url: 'https://example.com/work.webp',
					alt: 'A blue figure standing beneath a red moon.',
					title: 'Night Signal',
					year: '2026',
					medium: 'Digital painting',
					external_url: 'https://example.com/portfolio/night-signal'
				}
			]
		}),
		formValid: true
	},
	{
		name: 'an Art entry with no artworks',
		entry: draft({ type: 'art', excerpts: undefined, artworks: [] }),
		formValid: false
	},
	{
		name: 'an artwork without alt text',
		entry: draft({
			type: 'art',
			excerpts: undefined,
			artworks: [{ image_url: 'https://example.com/work.webp', alt: '' }]
		}),
		formValid: false
	},
	{
		name: 'an Art entry with four artworks',
		entry: draft({
			type: 'art',
			excerpts: undefined,
			artworks: Array.from({ length: 4 }, (_, i) => ({
				image_url: `https://example.com/work-${i}.webp`,
				alt: `Artwork ${i}`
			}))
		}),
		formValid: false
	},
	{
		name: 'a game with a thumb',
		entry: draft({
			type: 'game',
			excerpts: undefined,
			thumb_url: 'https://example.com/shot.png'
		}),
		formValid: true
	},
	{
		name: 'a game with a click-to-play YouTube trailer',
		entry: draft({
			type: 'game',
			excerpts: undefined,
			thumb_url: 'https://example.com/shot.png',
			trailer_url: 'https://youtu.be/dQw4w9WgXcQ'
		}),
		formValid: true
	},
	{
		name: 'a game with a non-YouTube trailer',
		entry: draft({
			type: 'game',
			excerpts: undefined,
			thumb_url: 'https://example.com/shot.png',
			trailer_url: 'https://video.example/trailer.mp4'
		}),
		formValid: false
	},
	{
		name: 'a game with an invalid YouTube video id',
		entry: draft({
			type: 'game',
			excerpts: undefined,
			thumb_url: 'https://example.com/shot.png',
			trailer_url: 'https://youtu.be/short'
		}),
		formValid: false
	},
	{
		name: 'a cover with a normalized focal point',
		entry: draft({
			type: 'game',
			excerpts: undefined,
			thumb_url: 'https://example.com/shot.png',
			thumb_position: { x: 18, y: 72 }
		}),
		formValid: true
	},
	{
		name: 'a cover focal point outside its normalized bounds',
		entry: draft({
			type: 'game',
			excerpts: undefined,
			thumb_url: 'https://example.com/shot.png',
			thumb_position: { x: 101, y: 50 }
		}),
		formValid: false
	},
	{
		name: 'a game with no thumb',
		entry: draft({ type: 'game', excerpts: undefined }),
		formValid: false
	},
	{ name: 'text with no samples', entry: draft({ excerpts: [] }), formValid: false },
	{
		name: 'text with three samples',
		entry: draft({
			excerpts: [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }]
		}),
		formValid: true
	},
	{
		name: 'text with four samples',
		entry: draft({
			excerpts: [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }, { text: 'Four' }]
		}),
		formValid: false
	},
	{
		name: 'a sample with its own recording',
		entry: draft({
			excerpts: [{ text: 'The hiss was the point.', audio_url: 'https://archive.org/reading.mp3' }]
		}),
		formValid: true
	},
	{
		name: 'a sample recording rehosted on IndieNodes',
		entry: draft({
			excerpts: [
				{ text: 'The hiss was the point.', audio_url: 'https://indienodes.us/reading.mp3' }
			]
		}),
		formValid: false
	},
	{ name: 'no tags', entry: draft({ tags: [] }), formValid: false },
	{ name: 'tags that are only whitespace', entry: draft({ tags: ['  '] }), formValid: false },
	{
		name: 'an http source_url',
		entry: draft({ source_url: 'http://example.com/x' }),
		formValid: false
	},
	{ name: 'a nonsense source_url', entry: draft({ source_url: 'not a url' }), formValid: false },
	{
		name: 'a cover image rehosted on IndieNodes',
		entry: draft({ thumb_url: 'https://indienodes.us/cover.png' }),
		formValid: false
	},
	{
		name: 'a cover image on an IndieNodes subdomain',
		entry: draft({ thumb_url: 'https://cdn.indienodes.us/cover.png' }),
		formValid: false
	},
	{
		name: 'a cover image on a domain that merely ends in the same letters',
		entry: draft({ thumb_url: 'https://notindienodes.us/cover.png' }),
		formValid: true
	},
	{
		name: 'a track rehosted on IndieNodes',
		entry: draft({
			type: 'audio',
			form: 'music',
			excerpts: undefined,
			tracks: [{ label: 'One', media_url: 'https://indienodes.us/1.mp3' }]
		}),
		formValid: false
	},
	{ name: 'a missing creator', entry: draft({ creator: '   ' }), formValid: false },
	{
		name: 'a why exactly at the 75-character cap',
		entry: draft({ why: 'x'.repeat(WHY_MAX_LENGTH) }),
		formValid: true
	},
	{
		name: 'a why longer than the 75-character cap',
		entry: draft({ why: 'x'.repeat(WHY_MAX_LENGTH + 1) }),
		formValid: false,
		// The schema only asks for minLength 1. The cap is the form keeping
		// `why` to the one line the field is for, which is a product rule.
		formOnly: true
	},
	{
		name: 'has_own_site left unanswered',
		entry: draft({ has_own_site: '' }),
		formValid: false,
		// has_own_site never reaches the ring entry (toRingEntry never emits
		// it), so the schema has no opinion on it at all.
		formOnly: true
	},
	{
		name: 'has_own_site "no" does not require source_url up front',
		entry: draft({ has_own_site: 'no', source_url: '' }),
		// A no-site draft cannot be sent to the schema check at all yet: it
		// has no source_url, which the schema itself still requires (the
		// generator flow fills that in later, from a real uploaded site).
		// This case exists only to prove the FORM does not block on it here.
		formValid: true,
		formOnly: true
	}
];

describe('the media caps match the schema', () => {
	// These were bare `3`s in five places across this file and both entry
	// forms, so the schema's own rule held only by coincidence of nobody
	// having edited one of them. Named constants make that a single edit;
	// this makes a schema change that misses them a failing test rather than
	// a form that accepts what publish will reject.
	it('caps tracks where the schema does', () => {
		expect(MAX_TRACKS).toBe(schema.properties.tracks.maxItems);
	});

	it('caps excerpts where the schema does', () => {
		expect(MAX_EXCERPTS).toBe(schema.properties.excerpts.maxItems);
	});

	it('caps artworks where the schema does', () => {
		expect(MAX_ARTWORKS).toBe(schema.properties.artworks.maxItems);
	});

	it('caps pages where the schema does', () => {
		expect(MAX_PAGES).toBe(schema.properties.pages.maxItems);
	});
});

describe('published entries stay valid across the excerpt shape change', () => {
	// `excerpts` gained per-sample audio by becoming `{ text, audio_url? }`
	// objects. The architecture audit locks this whole change set as additive
	// and migration-free, so the shape already sitting in published member
	// files has to keep validating: a schema that only accepted the new form
	// would retroactively invalidate every text entry published before it.
	//
	// This is asserted against the schema directly rather than through the
	// `cases` table above, because that table runs drafts through
	// `toRingEntry`, which only ever emits the new object form — the legacy
	// shape reaches the schema from `ring.json` on disk, never from the form.
	/** @param {any} excerpts */
	function textEntry(excerpts) {
		return {
			id: 'legacy-text',
			creator: 'Loose Leaf Press',
			type: 'text',
			why: 'A short essay about tape hiss.',
			source_url: 'https://example.com/loose-leaf',
			tags: ['essay'],
			excerpts,
			// Both are required by the mirrored schema; see BACKEND_FIELDS above
			// for why verification_token is still supplied here.
			verification_token: 'tok-abc123',
			joined_at: '2026-01-01T00:00:00Z'
		};
	}

	it('accepts the bare-string form published before samples carried audio', () => {
		const ok = validateAgainstSchema(textEntry(['The hiss was the point.']));
		expect(ok, JSON.stringify(validateAgainstSchema.errors)).toBe(true);
	});

	it('accepts the object form new submissions produce', () => {
		const ok = validateAgainstSchema(
			textEntry([
				{ text: '<p>The hiss was the point.</p>' },
				{ text: '<p>Read aloud.</p>', audio_url: 'https://archive.org/reading.mp3' }
			])
		);
		expect(ok, JSON.stringify(validateAgainstSchema.errors)).toBe(true);
	});

	it('accepts a file mid-migration, with both forms side by side', () => {
		const ok = validateAgainstSchema(
			textEntry(['Still a plain string.', { text: '<p>Already an object.</p>' }])
		);
		expect(ok, JSON.stringify(validateAgainstSchema.errors)).toBe(true);
	});

	it('accepts an optional per-sample title, and still accepts samples without one', () => {
		const ok = validateAgainstSchema(
			textEntry([
				{ title: 'Chapter One', text: '<p>Titled.</p>' },
				{ text: '<p>Untitled, which is a complete sample too.</p>' }
			])
		);
		expect(ok, JSON.stringify(validateAgainstSchema.errors)).toBe(true);
	});

	it('carries a sample title through toRingEntry and drops an empty one', () => {
		const out = toRingEntry(
			draft({
				excerpts: [
					{ title: '  Chapter One  ', text: '<p>Titled.</p>' },
					{ title: '   ', text: '<p>Blank title is the same as none.</p>' }
				]
			})
		);
		expect(out.excerpts[0]).toMatchObject({ title: 'Chapter One' });
		expect(out.excerpts[1]).not.toHaveProperty('title');
		expect(validateAgainstSchema({ ...out, ...BACKEND_FIELDS })).toBe(true);
	});

	it('still rejects shapes that are neither', () => {
		expect(validateAgainstSchema(textEntry([{ audio_url: 'https://a.co/x.mp3' }]))).toBe(false);
		expect(validateAgainstSchema(textEntry([{ text: '' }]))).toBe(false);
		expect(validateAgainstSchema(textEntry(['']))).toBe(false);
		expect(validateAgainstSchema(textEntry([{ text: 'x', rogue: 1 }]))).toBe(false);
		// A rehosted recording is still refused in the object form.
		expect(
			validateAgainstSchema(textEntry([{ text: 'x', audio_url: 'https://indienodes.us/x.mp3' }]))
		).toBe(false);
	});
});

describe('validateEntry agrees with ring.schema.json', () => {
	for (const { name, entry, formValid, formOnly } of cases) {
		it(name, () => {
			const errors = validateEntry(entry);
			expect(Object.keys(errors).length === 0, `form verdict for: ${name}`).toBe(formValid);

			// formOnly marks a case as a form-level product rule with nothing
			// for the schema to agree or disagree with, in either direction:
			// most commonly the form rejecting something the schema's silence
			// permits (why's length cap, has_own_site itself), but also, for
			// the no-site branch, the form *accepting* a draft that is not
			// schema-checkable yet at all (no source_url exists until after
			// the generator flow produces one).
			if (formOnly) return;

			if (formValid) {
				// Anything the form accepts must survive the publish step.
				const ok = schemaVerdict(entry);
				expect(
					ok,
					`schema rejected a form-accepted entry: ${JSON.stringify(validateAgainstSchema.errors)}`
				).toBe(true);
			} else {
				// And anything it rejects must be rejected downstream too,
				// otherwise the form is inventing a rule it did not declare.
				expect(schemaVerdict(entry), `schema accepted a form-rejected entry: ${name}`).toBe(false);
			}
		});
	}
});

describe('schema forbids `form` outside audio, even though the form never checks that itself', () => {
	it('rejects a non-audio entry carrying a form value', () => {
		const candidate = { ...toRingEntry(draft()), form: 'music', ...BACKEND_FIELDS };
		expect(validateAgainstSchema(candidate)).toBe(false);
	});

	it('accepts the same non-audio entry once form is removed', () => {
		const candidate = { ...toRingEntry(draft()), ...BACKEND_FIELDS };
		expect(validateAgainstSchema(candidate)).toBe(true);
	});
});

describe('toRingEntry produces only ring-shaped fields', () => {
	it('never carries review-only data into the entry', () => {
		const out = toRingEntry({
			...draft(),
			email: 'someone@example.com',
			eula_agreement: true,
			rights_confirmation: true,
			pro_membership: 'BMI'
		});
		for (const leaked of ['email', 'eula_agreement', 'rights_confirmation', 'pro_membership']) {
			expect(out, `${leaked} must never reach the entry`).not.toHaveProperty(leaked);
		}
	});

	it('drops half-filled repeatable rows rather than emitting invalid ones', () => {
		const out = toRingEntry(
			draft({
				type: 'audio',
				form: 'music',
				excerpts: undefined,
				tracks: [
					{ label: 'Real', media_url: 'https://archive.org/a.mp3' },
					{ label: 'Abandoned', media_url: '' }
				]
			})
		);
		expect(out.tracks).toHaveLength(1);
		expect(validateAgainstSchema({ ...out, ...BACKEND_FIELDS })).toBe(true);
	});

	it('serializes text excerpts, sanitizing markup and dropping empty samples', () => {
		const out = toRingEntry(
			draft({
				excerpts: [
					{
						text: ' <h2>Kitchen notes</h2><p>Real <strong>formatted</strong> <script>alert(1)</script>sample.</p> '
					},
					{ text: '<p></p>' }, // an untouched tipex editor: no text, ignored like an empty row
					{
						text: '<p>Recorded aloud.</p>',
						audio_url: ' https://archive.org/reading.mp3 '
					}
				]
			})
		);
		expect(out.excerpts).toEqual([
			{ text: '<h2>Kitchen notes</h2><p>Real <strong>formatted</strong> sample.</p>' },
			{ text: '<p>Recorded aloud.</p>', audio_url: 'https://archive.org/reading.mp3' }
		]);
		expect(validateAgainstSchema({ ...out, ...BACKEND_FIELDS })).toBe(true);
	});

	it('serializes Art metadata and drops empty optional fields', () => {
		const out = toRingEntry(
			draft({
				type: 'art',
				excerpts: undefined,
				artworks: [
					{
						image_url: ' https://example.com/work.webp ',
						alt: ' Blue figure under a red moon. ',
						title: ' Night Signal ',
						year: ' 2026 ',
						medium: ' Digital painting ',
						external_url: ''
					}
				]
			})
		);
		expect(out.artworks).toEqual([
			{
				image_url: 'https://example.com/work.webp',
				alt: 'Blue figure under a red moon.',
				title: 'Night Signal',
				year: '2026',
				medium: 'Digital painting'
			}
		]);
	});

	it('serializes the separate game teaser and trailer fields', () => {
		const out = toRingEntry(
			draft({
				type: 'game',
				excerpts: undefined,
				thumb_url: 'https://example.com/shot.png',
				preview_url: ' https://example.com/teaser.mp4 ',
				trailer_url: ' https://youtu.be/dQw4w9WgXcQ '
			})
		);
		expect(out).toMatchObject({
			preview_url: 'https://example.com/teaser.mp4',
			trailer_url: 'https://youtu.be/dQw4w9WgXcQ'
		});
	});
	it('serializes cover focal coordinates only with a cover', () => {
		expect(
			toRingEntry(
				draft({ thumb_url: 'https://example.com/cover.png', thumb_position: { x: 20, y: 80 } })
			).thumb_position
		).toEqual({ x: 20, y: 80 });
		expect(toRingEntry(draft({ thumb_position: { x: 20, y: 80 } }))).not.toHaveProperty(
			'thumb_position'
		);
	});

	it('omits explicit rather than writing false', () => {
		expect(toRingEntry(draft())).not.toHaveProperty('explicit');
		expect(toRingEntry(draft({ explicit: true })).explicit).toBe(true);
	});

	it('trims whitespace the submitter did not mean to send', () => {
		const out = toRingEntry(draft({ creator: '  Driftwood  ', tags: [' essay ', '  '] }));
		expect(out.creator).toBe('Driftwood');
		expect(out.tags).toEqual(['essay']);
	});
});

describe('validateReview', () => {
	const base = { email: 'a@b.co', pro_membership: 'Not a member' };

	it('accepts a minimal valid review block', () => {
		expect(validateReview(base)).toEqual({});
	});

	it('requires an email', () => {
		expect(validateReview({ ...base, email: '' })).toHaveProperty('email');
	});

	it('requires an organization name only when "Other" is picked', () => {
		expect(validateReview({ ...base, pro_membership: 'Other' })).toHaveProperty(
			'pro_membership_name'
		);
		expect(
			validateReview({ ...base, pro_membership: 'Other', pro_membership_name: 'A local guild' })
		).toEqual({});
		expect(validateReview({ ...base, pro_membership: 'Not sure' })).toEqual({});
	});

	it('never rejects a submission for its PRO membership itself, and does not re-ask for a name a named option already gave', () => {
		for (const org of ['ASCAP', 'BMI', 'SESAC', 'GMR']) {
			expect(validateReview({ ...base, pro_membership: org })).toEqual({});
		}
		expect(
			validateReview({ ...base, pro_membership: 'Other', pro_membership_name: 'Other' })
		).toEqual({});
	});
});

describe('consentGiven', () => {
	it('is gated on the general EULA box only; rights_confirmation does not block it', () => {
		expect(consentGiven({ eula_agreement: true })).toBe(true);
		expect(consentGiven({ eula_agreement: false })).toBe(false);
		expect(consentGiven({ rights_confirmation: true, eula_agreement: false })).toBe(false);
		expect(consentGiven({ rights_confirmation: false, eula_agreement: true })).toBe(true);
		expect(consentGiven({})).toBe(false);
	});
});
