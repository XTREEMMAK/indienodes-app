import { browser } from '$app/environment';
import { STORAGE_KEYS } from './storageKeys.js';
import { bindSourceUrl as bindSourceUrlApi, issueToken, submit, verify } from './submissionApi.js';
import {
	consentGiven,
	toRingEntry,
	validateEntry,
	validateReview
} from './submissionValidation.js';
import { generatorDraftStore } from './generator/generatorDraftStore.svelte.js';
import { deriveRingEntry } from './generator/data.js';
import { uid } from './uid.js';
import { uniqueEntryId } from './slug.js';
import { ringStore } from './ringStore.svelte.js';
import { createAntiBot } from './antiBot.svelte.js';
import { stripHtml } from './ring.js';

/**
 * State for the multi-step submission form on `/join`.
 *
 * A store rather than page-local `$state` for the usual reason in this
 * project (`preferencesStore`, `filtersStore`, `ringStore` all take this
 * shape), plus one specific to this form: the draft outlives the page. A
 * submitter leaves to go and paste a token onto their own site, and coming
 * back to an empty form would be the single worst moment in the flow to lose
 * their work.
 *
 * **The draft key is catalogued `exportable: false` in `storageKeys.js`,**
 * where that decision now lives alongside its stated reason: a draft holds an
 * email address. Section 2.2 of the spec exists to keep email out of
 * everywhere it does not belong, and a file the visitor downloads and moves
 * between devices is squarely inside that. (This was previously described as
 * the key being *absent* from a list in `localData.js`, which made an argued
 * exclusion indistinguishable from someone having forgotten to add it — the
 * ambiguity the catalog exists to remove.)
 * What persists here is the Section 2.1 half only; email and the two consent
 * checkboxes stay in memory and are gone on reload, which is the correct
 * behaviour for a consent checkbox regardless.
 */

const STORAGE_KEY = STORAGE_KEYS.submissionDraft.key;

/** Written to storage this long after the last keystroke. */
const PERSIST_DEBOUNCE_MS = 400;

/**
 * Minimum time between a submitter's first keystroke and their submission.
 * Mirrors the threshold the backend enforces; this copy exists so the form
 * can avoid sending something it knows will be rejected, not as the control
 * itself. The real check is server-side, where it cannot be edited out.
 */
export const MIN_DWELL_MS = 15000;

/**
 * `applicable` is optional and defaults to "always" when absent. Only the
 * `site` step needs it today: it exists solely for a creator with no site
 * of their own yet, so it has no reason to appear, or to occupy a slot in
 * the join page's own `visibleSteps` filtering (which both the progress
 * bar and `next`/`back` read), for anyone who answered `ownership`'s
 * question "yes."
 *
 * `ownership` is its own step, asked before anything else about the entry,
 * rather than the first field on `entry` alongside creator/why: it is
 * the one answer that changes the shape of everything after it (whether
 * `entry` even asks for `source_url`, whether `media` collects URLs or
 * files, whether `site` exists at all), so it earns being asked on its own
 * rather than blending into a step that also happens to be about something
 * else.
 *
 * `label` is kept terse on purpose, one or two words, not a description of
 * the step: `StepProgress.svelte` lays every label out in one horizontal
 * row (`justify-content: space-between` across up to eight of them at
 * once), and a phrase-length label wraps to two or three lines there,
 * pushing the whole bar taller and crowding whatever's below it. The
 * step's own `<h2>` heading, not this label, is where the fuller framing
 * belongs — this exists to be glanced at, not read.
 * @type {{ id: string, label: string, applicable?: (entry: Record<string, any>) => boolean }[]}
 */
export const STEPS = [
	{ id: 'prep', label: 'Start' },
	{ id: 'ownership', label: 'Ownership' },
	{ id: 'entry', label: 'Entry' },
	{ id: 'media', label: 'Your work' },
	{
		id: 'site',
		label: 'Your page',
		applicable: (entry) => entry.has_own_site === 'no'
	},
	{ id: 'verify', label: 'Verify' },
	{ id: 'consent', label: 'Consent' },
	{ id: 'submit', label: 'Submit' }
];

/** A fresh, empty entry half. */
function emptyEntry() {
	return {
		creator: '',
		type: '',
		// Audio only, required: 'music' or 'spoken'. Left blank rather than
		// defaulted, since a silent default would mislabel spoken entries.
		form: '',
		why: '',
		// '' (undecided) / 'yes' / 'no'. Gates whether `source_url` below is
		// asked for now (owns a site already) or produced later by the
		// generator flow (the `site` step) and only typed in once it exists.
		has_own_site: '',
		source_url: '',
		/** @type {string[]} */
		tags: [],
		/** @type {{ uid: string, label: string, media_url: string }[]} */
		tracks: [],
		/** @type {{ uid: string, image_url: string, caption: string }[]} */
		pages: [],
		/** @type {{ uid: string, image_url: string, alt: string, title: string, year: string, medium: string, external_url: string }[]} */
		artworks: [],

		/** @type {{ uid: string, title: string, text: string, audio_url: string }[]} */
		excerpts: [newExcerpt()],
		thumb_url: '',
		thumb_position: { x: 50, y: 50 },
		preview_url: '',
		trailer_url: '',
		explicit: false
	};
}

/** A fresh, empty review half. Never persisted. */
function emptyReview() {
	return {
		email: '',
		pro_membership: '',
		pro_membership_name: '',
		rights_confirmation: false,
		eula_agreement: false
	};
}

/**
 * A named predicate rather than an inline arrow with a `@type` cast on its
 * own parameter: Svelte's compiler mishandles that idiom in `.svelte.js`
 * files, wrapping the parameter in parens and emitting invalid syntax (the
 * same hazard `JoinMediaStep.svelte`'s own `isNotUid` avoids).
 * @param {{ media_url?: string }} track
 */
function hasTrackUrl(track) {
	return Boolean(track?.media_url?.trim());
}

/**
 * Rows carry a `uid` used as the `{#each}` key. Index keys would smear
 * values across rows when one in the middle is removed: Svelte would reuse
 * the DOM node and its focus/selection state for a different row's data.
 *
 * Generic over `fields` so the return type stays the concrete shape the
 * caller passed in (`{ uid } & T`) rather than widening to `Record<string,
 * any>`, which is what let `newTrack`/`newPage` disagree with
 * `entry.tracks`/`entry.pages`'s declared element types in `emptyEntry`.
 * @template {Record<string, any>} T
 * @param {T} fields
 * @returns {{ uid: string } & T}
 */
function row(fields) {
	return { uid: uid(), ...fields };
}

/** @returns {{ uid: string, label: string, media_url: string }} */
export function newTrack() {
	return row({ label: '', media_url: '' });
}

/** @returns {{ uid: string, image_url: string, caption: string }} */
export function newPage() {
	return row({ image_url: '', caption: '' });
}
/** @returns {{ uid: string, image_url: string, alt: string, title: string, year: string, medium: string, external_url: string }} */
export function newArtwork() {
	return row({ image_url: '', alt: '', title: '', year: '', medium: '', external_url: '' });
}

/** @returns {{ uid: string, title: string, text: string, audio_url: string }} */
export function newExcerpt() {
	return row({ title: '', text: '', audio_url: '' });
}

/**
 * Re-keys one persisted repeatable row with a fresh uid.
 *
 * Named rather than an inline `.map((t) => row({ ...t }))` with a per-
 * parameter JSDoc cast: that inline-cast idiom is mishandled by Svelte's
 * compiler in `.svelte.js` files, which wraps the parameter in an extra
 * layer of parens and produces invalid "parenthesized pattern" syntax once
 * compiled, breaking only under strict-mode evaluation (SSR in dev). A
 * `@param` above a named function's declaration is untouched by that
 * transform.
 * @param {Record<string, any>} raw
 */
function rekeyed(raw) {
	// The stored uid has to be removed before `row` sees it. `row` spreads its
	// argument *after* setting a fresh uid, so passing the row through intact
	// let the old value overwrite the new one — which made this a no-op for
	// exactly the rows it exists to re-key, every row loaded from storage.
	const fields = { ...raw };
	delete fields.uid;
	return row(fields);
}

/**
 * `rekeyed`, for one persisted excerpt row — except a draft written before
 * excerpts gained this shape stored a plain string instead of `{ text,
 * audio_url }`, so that legacy form is lifted the same way `ring.js`'s
 * `normalizeEntry` does for persisted ring.json entries. Named for the same
 * reason `rekeyed` itself is: see its own doc comment.
 * @param {any} sample
 */
function rekeyedExcerpt(sample) {
	return rekeyed(typeof sample === 'string' ? { title: '', text: sample, audio_url: '' } : sample);
}

/**
 * Reads a persisted draft, defensively.
 *
 * Anything unexpected is discarded rather than repaired. A corrupt draft is
 * worth losing; a draft that half-loads into a form is worth much less than
 * nothing, because the submitter cannot tell which half is real.
 *
 * The explicit return type matters beyond documentation: without it, the
 * spread of `parsed` (from `JSON.parse`, typed `any`) widens the inferred
 * return type to `any` throughout, which would then require an inline type
 * cast everywhere `entry.tags` is read downstream. Declaring the shape here
 * keeps that containment local to this one function.
 * @returns {ReturnType<typeof emptyEntry>}
 */
function loadDraft() {
	if (!browser) return emptyEntry();
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return emptyEntry();
		const parsed = JSON.parse(raw);
		const base = emptyEntry();
		return {
			...base,
			...parsed,
			tags: Array.isArray(parsed.tags) ? parsed.tags : [],
			// Re-key on load: uids from a previous session are meaningless to
			// this one's DOM, and regenerating them is cheaper than trusting
			// whatever was in storage to be unique.
			tracks: Array.isArray(parsed.tracks) ? parsed.tracks.map(rekeyed) : [],
			pages: Array.isArray(parsed.pages) ? parsed.pages.map(rekeyed) : [],
			artworks: Array.isArray(parsed.artworks) ? parsed.artworks.map(rekeyed) : [],
			// A draft persisted before excerpts gained a uid/audio_url shape
			// still has the old plain-string form; lift each into the current
			// shape the same way `ring.js`'s `normalizeEntry` does for
			// persisted ring.json entries, rather than discarding the draft.
			excerpts: Array.isArray(parsed.excerpts)
				? parsed.excerpts.map(rekeyedExcerpt)
				: [newExcerpt()]
		};
	} catch {
		return emptyEntry();
	}
}

/**
 * Builds an independent store.
 *
 * Exported for tests only. The draft is the one thing in this app whose loss
 * costs a submitter work they cannot recover, and it is a module singleton
 * that reads localStorage once at import — so without a factory there is no
 * way to seed storage and observe the result, and it went untested for that
 * reason. `vi.resetModules()` does not help (the evaluated module is handed
 * back) and a cache-busting dynamic import is not statically analysable by
 * Vite.
 *
 * **Application code must use the `submissionStore` singleton below.** A
 * second instance would keep its own draft and quietly disagree with the one
 * the form is bound to.
 */
export function createSubmissionStore() {
	let entry = $state(loadDraft());
	let review = $state(emptyReview());

	// Backend-owned. Never editable from the form, and never persisted: a
	// token outliving a reload would let the flow resume against a submission
	// the backend may have already expired.
	let submissionId = $state('');
	let token = $state('');
	let expiresAt = $state('');
	let verified = $state(false);
	/** Set once `source_url` has been attached, for the no-site branch. */
	let sourceUrlBound = $state(false);

	/**
	 * The relative paths the most recent export actually wrote (`assets/
	 * track-1.mp3`, and so on), for the no-site branch only. Kept here
	 * rather than in `generatorDraftStore` because it is a property of one
	 * export *run*, not of the draft itself — re-exporting after an edit
	 * produces a new one, and stale paths from a previous run must never be
	 * combined with a `source_url` typed in after the edit that invalidated
	 * them.
	 * @type {import('./generator/zipExport.js').ExportAssetPaths | null}
	 */
	let lastExportAssetPaths = $state(null);

	let step = $state('prep');
	/** @type {'idle' | 'issuing' | 'verifying' | 'submitting'} */
	let pending = $state('idle');
	/** @type {import('./submissionError.js').WebhookError | null} */
	let error = $state(null);
	/** Set when verification ran and came back negative, which is not an error. */
	let verifyFailure = $state('');
	let reference = $state('');

	const antiBot = createAntiBot();

	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let persistTimer;

	function persist() {
		if (!browser) return;
		clearTimeout(persistTimer);
		persistTimer = setTimeout(() => {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
			} catch {
				// Private browsing, or a full quota. Losing the draft is
				// survivable and there is nothing useful to say about it here.
			}
		}, PERSIST_DEBOUNCE_MS);
	}

	const entryErrors = $derived(validateEntry(entry));
	const reviewErrors = $derived(validateReview(review));

	/**
	 * Which fields each step is responsible for, so a step can be marked
	 * complete without validating fields the submitter has not reached yet.
	 */
	const stepFields = {
		ownership: ['has_own_site'],
		entry: ['creator', 'type', 'form', 'why', 'source_url', 'thumb_url', 'tags'],
		media: ['tracks', 'pages', 'artworks', 'excerpts', 'preview_url', 'trailer_url'],
		consent: ['email', 'pro_membership', 'pro_membership_name']
	};

	/** @param {string} stepId */
	function stepErrors(stepId) {
		const fields = stepFields[/** @type {keyof typeof stepFields} */ (stepId)] ?? [];
		const all = { ...entryErrors, ...reviewErrors };
		/** @type {Record<string, string>} */
		const out = {};
		for (const [key, message] of Object.entries(all)) {
			// Repeatable rows report as `tracks.0.media_url`; match on the root.
			const root = key.split('.')[0];
			// A generated-page game's cover comes from the screenshot uploaded on
			// the media step; there is no URL to ask for on Entry.
			if (stepId === 'entry' && entry.has_own_site === 'no' && root === 'thumb_url') continue;
			if (fields.includes(root)) out[key] = message;
		}
		return out;
	}

	return {
		get entry() {
			return entry;
		},
		get review() {
			return review;
		},
		get step() {
			return step;
		},
		set step(value) {
			step = value;
		},
		get pending() {
			return pending;
		},
		get error() {
			return error;
		},
		get verifyFailure() {
			return verifyFailure;
		},
		get token() {
			return token;
		},
		get expiresAt() {
			return expiresAt;
		},
		get verified() {
			return verified;
		},
		get reference() {
			return reference;
		},
		get honeypot() {
			return antiBot.honeypot;
		},
		set honeypot(value) {
			antiBot.honeypot = value;
		},
		get entryErrors() {
			return entryErrors;
		},
		get reviewErrors() {
			return reviewErrors;
		},
		get consentGiven() {
			return consentGiven(review);
		},

		/** The entry exactly as it will be sent, for the review step. */
		get preview() {
			try {
				return toRingEntry(entry);
			} catch {
				return null;
			}
		},

		stepErrors,

		/** @param {string} stepId */
		isStepComplete(stepId) {
			if (stepId === 'verify') return verified;
			if (stepId === 'prep') return true;
			if (stepId === 'submit') return Boolean(reference);

			// The consent step's own Continue button is the last chance to
			// stop someone from advancing without having actually agreed to
			// anything -- the review step past it validates nothing about
			// consent itself (it only disables Submit), so a submitter who
			// clicked through here would otherwise land there with no
			// explanation why Submit won't respond. `consentGiven` already
			// encodes which checkboxes matter for this review (EULA always,
			// Rights only when a PRO relationship makes it apply).
			if (stepId === 'consent') {
				return Object.keys(stepErrors(stepId)).length === 0 && consentGiven(review);
			}

			if (stepId === 'media') {
				// Every one of `media`'s own fields is conditional on
				// `entry.type` (tracks for audio, pages for comic, and so
				// on): with no type chosen yet, none of those conditions
				// fire and stepErrors comes back empty, which would
				// otherwise mark an untouched step "done" simply because it
				// had nothing to validate against yet.
				if (!entry.type) return false;

				// The no-site branch collects real uploaded files into
				// generatorDraftStore, not the URL fields validateEntry
				// checks, so completeness here has to read that store
				// instead of stepErrors for the three types that need an
				// actual file (audio is required only when the creator has
				// chosen to host it separately rather than bundle it — see
				// below; text needs nothing file-shaped in either branch).
				if (entry.has_own_site === 'no') {
					/** @type {{ file?: Blob | null, alt?: string }[]} */
					const works = generatorDraftStore.generator.works ?? [];
					if (entry.type === 'comic') return works.some((w) => w.file);
					if (entry.type === 'game') return Boolean(works[0]?.file);
					if (entry.type === 'art') return works.some((w) => w.file && w.alt?.trim());
					if (entry.type === 'text')
						return entry.excerpts?.some((sample) => stripHtml(sample.text).trim());
					if (entry.type === 'audio') {
						// Bundle mode (the default, and the only choice that
						// existed before this) stays exactly as permissive as
						// always — no file is ever required. Choosing to host
						// the audio separately instead means the generated
						// page will carry no bundled track at all, so at least
						// one typed URL is required here or the submission
						// would go out with nothing to play. Deliberately not
						// enforced in validateEntry: that file is schema-level
						// and cross-checked against ring.schema.json by its own
						// anti-drift test, and "external" has no schema
						// representation — it is a client-only UI choice, so
						// the rule belongs at this step-gate level instead,
						// same as the comic/game file requirements just above.
						if (generatorDraftStore.generator.audioHosting === 'external') {
							return entry.tracks?.some(hasTrackUrl) ?? false;
						}
						return true;
					}
				}
			}

			if (stepId === 'site') {
				// Complete once an export has actually been produced, not
				// merely once a template is picked: `verify`'s no-site
				// branch depends on `lastExportAssetPaths` existing to
				// derive the real ring.json fields later.
				//
				// The name check mirrors generator/data.js's own fallback
				// (`generator.displayName?.trim() || entry.creator?.trim()`)
				// rather than requiring `displayName` alone: the field's
				// input shows the entry step's creator name as its
				// *placeholder* ("Defaults to your name or studio from the
				// entry step"), which a visitor reasonably reads as already
				// filled in, but a placeholder is never part of an input's
				// actual value. Requiring `displayName` itself left Continue
				// disabled behind a field that looked complete on screen.
				return (
					Boolean(generatorDraftStore.generator.displayName?.trim() || entry.creator?.trim()) &&
					lastExportAssetPaths !== null
				);
			}

			return Object.keys(stepErrors(stepId)).length === 0;
		},

		/** Records interaction for draft persistence; the dwell clock starts when the form loads. */
		touch() {
			antiBot.touch();
			persist();
		},

		/**
		 * Invalidates the ownership proof as soon as an existing-site URL is
		 * edited. The backend binds `submissionId` and `token` to the exact URL
		 * sent to `issueToken`; keeping them after an edit would make Verify
		 * continue checking the old address even though the form displays the
		 * new one.
		 */
		sourceUrlChanged() {
			submissionId = '';
			token = '';
			expiresAt = '';
			verified = false;
			sourceUrlBound = false;
			verifyFailure = '';
			error = null;
			this.touch();
		},

		/** @param {string} tag */
		toggleTag(tag) {
			entry.tags = entry.tags.includes(tag)
				? entry.tags.filter((t) => t !== tag)
				: [...entry.tags, tag];
			this.touch();
		},

		clearError() {
			error = null;
			verifyFailure = '';
		},

		/**
		 * Commits the `source_url` and gets a token bound to it.
		 *
		 * Re-issuing after the URL changes is deliberate and not an
		 * optimization to remove later: the token is bound server-side to the
		 * URL it was issued for, so a token obtained for one URL is worthless
		 * against another, and reusing it would fail verification in a way
		 * that looks like the submitter's mistake.
		 *
		 * **For the no-site branch, `entry.source_url` does not exist yet.**
		 * This is called from the `site` step instead, before export, with no
		 * URL at all — the token still has to be minted so it can be baked
		 * into the exported HTML, per `submission-form-spec.md` section 4's
		 * sequence. `bindSourceUrl` below is the second half of that: it
		 * attaches the real URL to this same submission once the creator has
		 * uploaded their site and typed it in.
		 */
		async requestToken() {
			if (pending !== 'idle') return;
			pending = 'issuing';
			error = null;
			verifyFailure = '';
			try {
				const result = await issueToken({
					source_url: entry.has_own_site === 'no' ? null : entry.source_url.trim(),
					type: entry.type,
					website: antiBot.honeypot,
					elapsed_ms: antiBot.elapsedMs
				});
				submissionId = result.submission_id;
				token = result.verification_token;
				expiresAt = result.expires_at;
				verified = false;
				sourceUrlBound = false;
			} catch (e) {
				error = /** @type {any} */ (e);
			} finally {
				pending = 'idle';
			}
		},

		/**
		 * The no-site branch's counterpart to committing `source_url` up
		 * front: attaches the creator's now-real site URL to the submission
		 * a token was already issued for (see `requestToken` above), derives
		 * the ring.json-shaped fields (`tracks`/`pages`/`thumb_url`) from the
		 * most recent export's own asset paths, and merges them into `entry`
		 * — this is the one point in the no-site flow where `entry` finally
		 * becomes a submittable ring entry rather than a placeholder.
		 * @param {string} sourceUrl
		 */
		async bindSourceUrl(sourceUrl) {
			if (pending !== 'idle' || !submissionId || !lastExportAssetPaths) return;
			pending = 'issuing';
			error = null;
			try {
				await bindSourceUrlApi(submissionId, sourceUrl);
				entry.source_url = sourceUrl;
				Object.assign(
					entry,
					deriveRingEntry(
						entry,
						generatorDraftStore.generator.works ?? [],
						lastExportAssetPaths,
						sourceUrl
					)
				);
				sourceUrlBound = true;
				persist();
			} catch (e) {
				error = /** @type {any} */ (e);
			} finally {
				pending = 'idle';
			}
		},

		get sourceUrlBound() {
			return sourceUrlBound;
		},

		get lastExportAssetPaths() {
			return lastExportAssetPaths;
		},

		/**
		 * Records what the `site` step's most recent export actually wrote,
		 * so `bindSourceUrl` above can derive `entry`'s media fields from the
		 * exact paths that export produced rather than recomputing them.
		 * @param {import('./generator/zipExport.js').ExportAssetPaths} assetPaths
		 */
		recordExport(assetPaths) {
			lastExportAssetPaths = assetPaths;
			// A previously bound URL was derived from a now-superseded
			// export; re-exporting after an edit has to invalidate it rather
			// than leave `entry` pointing at assets the new zip may not even
			// contain under the same names.
			sourceUrlBound = false;
		},

		async runVerify() {
			if (pending !== 'idle' || !submissionId) return;
			pending = 'verifying';
			error = null;
			verifyFailure = '';
			try {
				const result = await verify(submissionId);
				verified = result.verified;
				if (!result.verified) verifyFailure = result.reason ?? 'token_not_found';
			} catch (e) {
				error = /** @type {any} */ (e);
			} finally {
				pending = 'idle';
			}
		},

		/**
		 * Sends the submission. Never retried automatically: see
		 * `submissionApi.submit`.
		 */
		async send() {
			if (pending !== 'idle' || !verified) return;
			pending = 'submitting';
			error = null;
			try {
				const result = await submit({
					submission_id: submissionId,
					/**
					 * The id the form has been showing, and the one already baked
					 * into a generated site's footer embed. Sent so approval can
					 * keep it instead of re-deriving one the creator's published
					 * page would no longer match. Advisory: the backend uses it
					 * only when it is still free, and re-derives otherwise.
					 *
					 * Deliberately a sibling of `entry` rather than a field on it.
					 * `toRingEntry` output is validated against ring.schema.json,
					 * which sets `additionalProperties: false`, so an extra key
					 * there would fail the entry it is meant to help.
					 */
					requested_id: uniqueEntryId(
						entry,
						ringStore.entries.map((e) => e.id)
					),
					entry: toRingEntry(entry),
					review: {
						email: review.email.trim(),
						rights_confirmation: review.rights_confirmation,
						pro_membership: review.pro_membership,
						pro_membership_name: review.pro_membership_name.trim(),
						eula_agreement: review.eula_agreement
					},
					website: antiBot.honeypot,
					elapsed_ms: antiBot.elapsedMs
				});
				reference = result.reference;
				// Both drafts have served their purpose, and each holds a copy
				// of everything just sent (the generator draft down to the
				// actual image/audio Blobs). Clear them at the one moment it is
				// certainly safe to.
				if (browser) {
					clearTimeout(persistTimer);
					localStorage.removeItem(STORAGE_KEY);
				}
				if (entry.has_own_site === 'no') await generatorDraftStore.discard();
			} catch (e) {
				error = /** @type {any} */ (e);
			} finally {
				pending = 'idle';
			}
		},

		/** Used by the "start over" affordance on the success screen. */
		reset() {
			entry = emptyEntry();
			review = emptyReview();
			submissionId = '';
			token = '';
			expiresAt = '';
			verified = false;
			sourceUrlBound = false;
			lastExportAssetPaths = null;
			reference = '';
			error = null;
			verifyFailure = '';
			step = 'prep';
			antiBot.reset();
			if (browser) localStorage.removeItem(STORAGE_KEY);
			generatorDraftStore.discard();
		}
	};
}

export const submissionStore = createSubmissionStore();
