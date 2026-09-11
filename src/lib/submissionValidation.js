/**
 * Client-side validation for the submission form.
 *
 * **Deliberately hand-written rather than Ajv against `ring.schema.json`.**
 * Ajv and ajv-formats are devDependencies used by `scripts/validate-ring.js`
 * at build time; promoting them to runtime dependencies of a static site
 * would ship roughly 120 KB to every visitor so that one page can check a
 * form. The schema stays the authority, and this file is checked against it
 * instead of importing it: `submissionValidation.test.js` compiles the real
 * schema with Ajv and asserts that both agree, in both directions, across a
 * table of form states. That test is the anti-drift mechanism, and it costs
 * the bundle nothing.
 *
 * Two things this intentionally does *not* try to be:
 *
 * - **Authoritative.** The submission workflow re-validates server-side, and
 *   `npm run validate:publish` validates again before anything merges. This
 *   layer exists to tell a person what is wrong while they can still fix it,
 *   not to protect the ring.
 * - **Complete against the schema.** It validates what the form can produce.
 *   Fields the form never collects (`id`, `creator_id`)
 *   are supplied by the backend and are checked there.
 *
 * Errors are keyed by form field path so the UI can put each message beside
 * the control it belongs to. Repeatable rows use `tracks.0.media_url` form,
 * which is the same shape Ajv's `instancePath` produces, minus the leading
 * slash, so a server-side error can be merged into the same map later.
 */

import { youtubeVideoId } from './videoPreview.js';
import { stripHtml, sanitizeExcerptHtml } from './ring.js';

/** @typedef {Record<string, string>} ErrorMap */

/** Matches the schema's `type` enum. */
export const ENTRY_TYPES = /** @type {const} */ (['audio', 'comic', 'text', 'game', 'art']);

/**
 * Creator-facing labels for the schema values above. The stored value names
 * the medium and playback implementation, not a genre: audio is split into
 * music and spoken by the required `form` field below, so the type itself no
 * longer needs to imply which one a submitter has in mind.
 */
export const ENTRY_TYPE_LABELS = /** @type {const} */ ({
	audio: 'Audio',
	comic: 'Comic',
	text: 'Text',
	game: 'Game',
	art: 'Art'
});

/** Matches the schema's `form` enum. Audio only, required. */
export const FORM_OPTIONS = /** @type {const} */ (['music', 'spoken']);

/**
 * Creator-facing labels for `form`. Declared so playback queues never mix
 * music and spoken-word content, which tags alone can't separate (a spoken
 * fantasy drama and a fantasy soundtrack can share every tag).
 */
export const FORM_LABELS = /** @type {const} */ ({
	music: 'Music',
	spoken: 'Spoken (narration, audio drama, voice work)'
});

/** Section 2.2. Order is the order the select renders. */
export const PRO_OPTIONS = /** @type {const} */ ([
	'Not a member',
	'ASCAP',
	'BMI',
	'SESAC',
	'GMR',
	'Other',
	'Not sure'
]);

/**
 * The only option that requires naming an organization: every other option
 * either already names the org itself (ASCAP, BMI, ...) or is a submitter
 * who is not a member or does not know, neither of whom can be asked to name
 * one. Asking again for e.g. "BMI" after it was just picked from the list
 * would be re-collecting an answer already given.
 */
const PRO_NAME_REQUIRED_FOR = 'Other';

/**
 * Whether the Rights section (the detailed rights warranty, naming
 * co-writers/sample owners/publishers/collaborators/labels, plus the PRO
 * disclosure sentence for music) applies to this submitter at all.
 *
 * Deliberately tied to `pro_membership`, not to `type`: the general EULA
 * checkbox already collects a blanket "I hold full rights" affirmation from
 * everyone, so the more detailed Rights section only earns its own required
 * checkbox when there is an actual PRO relationship that could complicate
 * that affirmation -- "Not a member" (or the field not yet answered) has
 * nothing to disclose here.
 * @param {Record<string, any>} review
 */
export function rightsSectionApplies(review) {
	return Boolean(review?.pro_membership) && review.pro_membership !== 'Not a member';
}

/** Schema cap: three, so the ring stays a sampler rather than a host. */
export const MAX_TRACKS = 3;

/**
 * Schema cap on `excerpts`, same reasoning as tracks. Named for the same
 * reason too: it was a bare `3` in five places across this file and both entry
 * forms, so the schema's own rule was only ever true by coincidence of nobody
 * having edited one of them.
 */
export const MAX_EXCERPTS = 3;
/** Art follows the same small-showcase cap as tracks and excerpts. */
export const MAX_ARTWORKS = 3;
/**
 * Comic follows the same cap -- schema's own `pages.maxItems` is 3. Added
 * after the fact: comic was the one type whose upper bound was never given a
 * name at all, so nothing here or in either entry form rejected a fourth
 * page client-side. The schema still would have, at review time, which is
 * exactly the failure mode this file exists to avoid -- see the enforcement
 * below and both `/join`/`/update` forms' own "Add a page" guard.
 */
export const MAX_PAGES = 3;

/** Keeps `why` to the "one line" the schema's description asks for. */
export const WHY_MAX_LENGTH = 75;

/**
 * Mirrors `$defs/externalMediaUrl`'s `not` in `schema/ring.schema.json`.
 * Kept as its own exported constant because the form also wants to explain
 * this rule in help text, and the explanation and the check should not be
 * able to disagree about which domain they mean.
 */
const OWN_DOMAIN = /^https:\/\/([a-z0-9-]+\.)*indienodes\.us(\/|$)/i;

/**
 * Every URL in an entry must be https. The schema enforces this with a
 * `^https://` pattern rather than `format: uri` alone, and so does this:
 * `format: uri` accepts `http:` and a good deal else besides.
 * @param {string} value
 */
function isHttpsUrl(value) {
	if (!/^https:\/\//i.test(value)) return false;
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}

/**
 * Validates one media URL and returns an error message, or null.
 *
 * Takes the field's human name so the message can say what is wrong with
 * *this* field rather than emitting a generic string the UI has to prefix.
 * @param {string} value
 * @param {string} label
 * @returns {string | null}
 */
function mediaUrlError(value, label) {
	if (!isHttpsUrl(value)) return `${label} must be a full https:// URL.`;
	if (OWN_DOMAIN.test(value)) {
		return `${label} must be hosted somewhere you control, not on IndieNodes. Nothing here is rehosted.`;
	}
	return null;
}

/**
 * Validates the Section 2.1 half of a submission: everything that becomes a
 * `ring.json` entry.
 *
 * `tracks` is not required for audio, which is a real correction rather than
 * an oversight, and the schema is the authority. An audio entry with no
 * playable file is a supported shape: a link-only member listed with its
 * cover and a link out. See `submission-form-spec.md` section 2.1.
 * @param {Record<string, any>} entry
 * @returns {ErrorMap}
 */
export function validateEntry(entry) {
	/** @type {ErrorMap} */
	const errors = {};
	const type = entry?.type;

	if (!entry?.creator?.trim()) errors.creator = 'Tell people who you are.';

	const why = entry?.why?.trim() ?? '';
	if (!why) {
		errors.why = 'One line on who you are and why this is worth someone’s time.';
	} else if (why.length > WHY_MAX_LENGTH) {
		errors.why = `Keep this to ${WHY_MAX_LENGTH} characters; it is ${why.length}.`;
	}

	if (!ENTRY_TYPES.includes(type)) {
		errors.type = 'Pick a type.';
	}

	if (type === 'audio' && !FORM_OPTIONS.includes(entry?.form)) {
		errors.form = 'Pick Music or Spoken.';
	}

	// Not a ring.json field itself (toRingEntry never emits it), but it
	// gates whether source_url is asked for now or produced later by the
	// site-generator branch, so it needs its own completeness check here
	// rather than living only in the UI.
	if (entry?.has_own_site !== 'yes' && entry?.has_own_site !== 'no') {
		errors.has_own_site = 'Let us know if you already have a site.';
	}

	// Required unless the submitter has explicitly said they have no site
	// yet (the site-generator branch): source_url for that branch is filled
	// in later, once the generated site has somewhere real to live, not
	// asked for up front.
	if (entry?.has_own_site !== 'no') {
		if (!entry?.source_url?.trim()) {
			errors.source_url = 'Where does this live?';
		} else if (!isHttpsUrl(entry.source_url)) {
			errors.source_url = 'Must be a full https:// URL.';
		}
	}

	// minItems: 1 in the schema. An untagged entry joins the ring already
	// unfindable by every route except scrolling past it.
	const tags = Array.isArray(entry?.tags) ? entry.tags.filter((t) => t?.trim()) : [];
	if (tags.length === 0) errors.tags = 'Pick at least one tag.';

	if (entry?.thumb_url?.trim()) {
		const error = mediaUrlError(entry.thumb_url, 'Cover image');
		if (error) errors.thumb_url = error;
		const position = entry.thumb_position;
		if (
			position != null &&
			(!Number.isFinite(position.x) ||
				!Number.isFinite(position.y) ||
				position.x < 0 ||
				position.x > 100 ||
				position.y < 0 ||
				position.y > 100)
		) {
			errors.thumb_position = 'Cover position must stay between 0 and 100 percent.';
		}
	} else if (type === 'game') {
		errors.thumb_url = 'Game entries need a screenshot or cover image.';
	}

	const tracks = Array.isArray(entry?.tracks) ? entry.tracks : [];
	if (tracks.length > MAX_TRACKS) {
		errors.tracks = `Three tracks maximum; you have ${tracks.length}. Remove one rather than letting it be dropped for you.`;
	}
	tracks.forEach((track, i) => {
		if (!track?.label?.trim() && !track?.media_url?.trim()) return; // empty row, ignored
		if (!track?.label?.trim()) errors[`tracks.${i}.label`] = 'Name this track.';
		if (!track?.media_url?.trim()) {
			errors[`tracks.${i}.media_url`] = 'Needs a direct link to the audio file.';
		} else {
			const error = mediaUrlError(track.media_url, 'The audio file');
			if (error) errors[`tracks.${i}.media_url`] = error;
		}
	});

	if (type === 'comic') {
		const pages = Array.isArray(entry?.pages) ? entry.pages : [];
		const filled = pages.filter((p) => p?.image_url?.trim());
		if (filled.length === 0) errors.pages = 'A comic needs at least one page.';
		if (pages.length > MAX_PAGES) {
			errors.pages = `Three pages maximum; you have ${pages.length}. Remove one rather than letting it be dropped for you.`;
		}
		pages.forEach((page, i) => {
			if (!page?.image_url?.trim()) return;
			const error = mediaUrlError(page.image_url, 'The page image');
			if (error) errors[`pages.${i}.image_url`] = error;
		});
	}
	if (type === 'art') {
		const artworks = Array.isArray(entry?.artworks) ? entry.artworks : [];
		/** @param {Record<string, any>} artwork */
		function hasContent(artwork) {
			return ['image_url', 'alt', 'title', 'year', 'medium', 'external_url'].some((field) =>
				Boolean(artwork?.[field]?.trim())
			);
		}
		const filled = artworks.filter(hasContent);
		if (filled.length === 0) errors.artworks = 'An Art entry needs at least one artwork.';
		if (artworks.length > MAX_ARTWORKS) {
			errors.artworks = `Three artworks maximum; you have ${artworks.length}.`;
		}
		artworks.forEach((artwork, i) => {
			if (!hasContent(artwork)) return;
			if (!artwork?.image_url?.trim()) {
				errors[`artworks.${i}.image_url`] = 'Add the artwork image.';
			} else {
				const error = mediaUrlError(artwork.image_url, 'The artwork image');
				if (error) errors[`artworks.${i}.image_url`] = error;
			}
			if (!artwork?.alt?.trim()) {
				errors[`artworks.${i}.alt`] = 'Describe the artwork for visitors who cannot see it.';
			}
			if (artwork?.external_url?.trim() && !isHttpsUrl(artwork.external_url)) {
				errors[`artworks.${i}.external_url`] = 'The artwork link must be a full https:// URL.';
			}
		});
	}

	if (type === 'text') {
		const excerpts = Array.isArray(entry?.excerpts) ? entry.excerpts : [];
		/** @param {Record<string, any>} sample */
		const hasText = (sample) => Boolean(stripHtml(sample?.text).trim());
		const filled = excerpts.filter(hasText);
		if (filled.length === 0) errors.excerpts = 'A text entry needs at least one sample to show.';
		if (excerpts.length > MAX_EXCERPTS)
			errors.excerpts = 'Text entries can include at most three samples.';
		excerpts.forEach((sample, i) => {
			if (!hasText(sample)) return; // empty row, ignored
			if (sample?.audio_url?.trim()) {
				const error = mediaUrlError(sample.audio_url, 'The recording');
				if (error) errors[`excerpts.${i}.audio_url`] = error;
			}
		});
	}

	if (type === 'game' && entry?.preview_url?.trim()) {
		const error = mediaUrlError(entry.preview_url, 'The preview');
		if (error) errors.preview_url = error;
	}

	if (type === 'game' && entry?.trailer_url?.trim() && !youtubeVideoId(entry.trailer_url)) {
		errors.trailer_url =
			'The trailer must be a full https:// YouTube link, such as youtube.com/watch or youtu.be.';
	}

	return errors;
}

/**
 * Validates the Section 2.2 half: the fields a maintainer sees and the ring
 * never does.
 *
 * `pro_membership` is collected and never judged. Spec section 2.2 is
 * explicit that it must not gate anything without a separate decision, so
 * the only rule here is the conditional on `pro_membership_name`.
 * @param {Record<string, any>} review
 * @returns {ErrorMap}
 */
export function validateReview(review) {
	/** @type {ErrorMap} */
	const errors = {};

	const email = review?.email?.trim() ?? '';
	if (!email) {
		errors.email = 'Needed so we can tell you what happened to your submission.';
	} else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		// Deliberately loose. Anything stricter rejects addresses that are
		// actually valid, and the address is confirmed by a message arriving,
		// not by a regex.
		errors.email = 'That does not look like an email address.';
	}

	if (!PRO_OPTIONS.includes(review?.pro_membership)) {
		errors.pro_membership = 'Pick one, including "Not sure" if you are not.';
	} else if (
		review.pro_membership === PRO_NAME_REQUIRED_FOR &&
		!review?.pro_membership_name?.trim()
	) {
		errors.pro_membership_name = 'Which organization?';
	}

	return errors;
}

/**
 * Whether the submit action may be enabled.
 *
 * `eula_agreement` always gates this — the general EULA is the one
 * statement every type can equally agree to, worded generically rather than
 * toward one kind of work the way `rights_confirmation` necessarily is
 * (built for audio's "recording and composition", which reads oddly for a
 * comic). Spec section 6 asks for the button to be *disabled* until this is
 * checked, rather than validating on click, so the requirement is visible
 * before the attempt rather than after it.
 *
 * `rights_confirmation` only joins the gate when `rightsSectionApplies`
 * says the Rights section is actually shown (a stated PRO relationship,
 * not "Not a member") — see that function's own comment for why it is tied
 * to `pro_membership` rather than to `type`.
 * @param {Record<string, any>} review
 */
export function consentGiven(review) {
	if (review?.eula_agreement !== true) return false;
	if (rightsSectionApplies(review)) return review?.rights_confirmation === true;
	return true;
}

/**
 * Everything, for the final review step.
 * @param {{ entry: Record<string, any>, review: Record<string, any> }} submission
 * @returns {ErrorMap}
 */
export function validateSubmission({ entry, review }) {
	return { ...validateEntry(entry), ...validateReview(review) };
}

/**
 * Strips a form draft down to exactly the shape `ring.json` takes.
 *
 * This is what gets sent as `entry`, and it is the reason the payload can be
 * trusted not to carry Section 2.2 data by accident: the entry half is built
 * by naming its fields, never by spreading the form state and deleting the
 * private ones. `id` and an optional `creator_id` are added by the backend.
 *
 * Empty repeatable rows are dropped here rather than in the UI, so a
 * half-typed row a submitter abandoned does not become a schema violation.
 * @param {Record<string, any>} entry
 */
export function toRingEntry(entry) {
	/** @type {Record<string, any>} */
	const out = {
		creator: entry.creator.trim(),
		type: entry.type,
		why: entry.why.trim(),
		source_url: entry.source_url.trim(),
		tags: (entry.tags ?? []).map((/** @type {string} */ t) => t.trim()).filter(Boolean)
	};

	const tracks = (entry.tracks ?? [])
		.filter((/** @type {any} */ t) => t?.label?.trim() && t?.media_url?.trim())
		.map((/** @type {any} */ t) => ({ label: t.label.trim(), media_url: t.media_url.trim() }));
	if (entry.type === 'audio') out.form = entry.form;
	if (entry.type === 'audio' && tracks.length) out.tracks = tracks;

	if (entry.type === 'comic') {
		out.pages = (entry.pages ?? [])
			.filter((/** @type {any} */ p) => p?.image_url?.trim())
			.map((/** @type {any} */ p) => {
				/** @type {Record<string, string>} */
				const page = { image_url: p.image_url.trim() };
				if (p.caption?.trim()) page.caption = p.caption.trim();
				return page;
			});
	}

	if (entry.type === 'art') {
		out.artworks = (entry.artworks ?? [])
			.filter((/** @type {any} */ artwork) => artwork?.image_url?.trim() && artwork?.alt?.trim())
			.map((/** @type {any} */ artwork) => {
				/** @type {Record<string, string>} */
				const item = {
					image_url: artwork.image_url.trim(),
					alt: artwork.alt.trim()
				};
				for (const field of ['title', 'year', 'medium', 'external_url']) {
					if (artwork[field]?.trim()) item[field] = artwork[field].trim();
				}
				return item;
			});
	}

	if (entry.type === 'text') {
		out.excerpts = (entry.excerpts ?? [])
			.filter((/** @type {any} */ sample) => stripHtml(sample?.text).trim())
			.map((/** @type {any} */ sample) => {
				/** @type {Record<string, string>} */
				const item = { text: sanitizeExcerptHtml(sample.text.trim()) };
				// Title first in the emitted object so a member file reads in the
				// order a person would write it: what the piece is, then the piece.
				if (sample.title?.trim()) {
					return {
						title: sample.title.trim(),
						...item,
						...(sample.audio_url?.trim() ? { audio_url: sample.audio_url.trim() } : {})
					};
				}
				if (sample.audio_url?.trim()) item.audio_url = sample.audio_url.trim();
				return item;
			});
	}
	if (entry.thumb_url?.trim()) {
		out.thumb_url = entry.thumb_url.trim();
		const x = Number(entry.thumb_position?.x);
		const y = Number(entry.thumb_position?.y);
		if (Number.isFinite(x) && Number.isFinite(y)) out.thumb_position = { x, y };
	}
	if (entry.type === 'game' && entry.preview_url?.trim()) {
		out.preview_url = entry.preview_url.trim();
	}
	// Omitted entirely when false: the schema says to omit it for everything
	// that is not explicit, rather than writing `explicit: false` everywhere.
	if (entry.type === 'game' && entry.trailer_url?.trim()) {
		out.trailer_url = entry.trailer_url.trim();
	}
	if (entry.explicit === true) out.explicit = true;

	return out;
}
