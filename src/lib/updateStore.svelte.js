/**
 * State for the change-request form on `/update`.
 *
 * Structurally parallel to `submissionStore.svelte.js` (same
 * pending/error/verified/token/submissionId shape, same debounced-persist
 * localStorage draft, same `createAntiBot()` use) but for a narrower job:
 * editing one field of an *existing* ring entry rather than building a new
 * one from scratch. See the Creator Nodes addendum, Section C, and
 * `docs/roadmap.md`'s "Node maintenance and change requests" entry.
 *
 * **The node lookup here is not a security boundary.** It only prefills the
 * edit step from whatever `ring.json` this browser last fetched, which can
 * be stale or (for a not-yet-published node) simply absent. Re-verification
 * — the same token-in-a-`<meta>` mechanism `/join` already uses — is the
 * only real gate, checked server-side against the node's *current*
 * `source_url` on file, never against anything this store sends.
 */

import { browser } from '$app/environment';
import { STORAGE_KEYS } from './storageKeys.js';
import { findNodes } from './nodeLookup.js';
import {
	requestUpdateToken,
	bindSourceUrl as bindSourceUrlApi,
	verify,
	submitUpdate,
	requestRemoval,
	checkRateStatus
} from './submissionApi.js';
import { validateEntry, toRingEntry } from './submissionValidation.js';
import { createAntiBot } from './antiBot.svelte.js';
import { uid } from './uid.js';
import { SvelteSet } from 'svelte/reactivity';
import { stripHtml } from './ring.js';
import { newExcerpt } from './submissionStore.svelte.js';

const STORAGE_KEY = STORAGE_KEYS.updateDraft.key;

/** Written to storage this long after the last keystroke. */
const PERSIST_DEBOUNCE_MS = 400;

/**
 * `edit` and `remove` are the same slot wearing two faces: once someone has
 * proved they control the page, they either correct the entry or withdraw it.
 * Filtered by `applicable` the way `/join`'s own `site` step is, so the
 * progress bar and the next/back walk stay in agreement automatically rather
 * than being two lists to keep in step by hand.
 * @type {{ id: string, label: string, applicable?: (intent: string) => boolean }[]}
 */
export const UPDATE_STEPS = [
	{ id: 'identify', label: 'Identify' },
	{ id: 'verify', label: 'Verify' },
	{ id: 'edit', label: 'Edit', applicable: (intent) => intent !== 'remove' },
	{ id: 'remove', label: 'Remove', applicable: (intent) => intent === 'remove' },
	{ id: 'review', label: 'Review' }
];

/**
 * Generic over `fields` so the return type stays the concrete shape the
 * caller passed in, matching `submissionStore.svelte.js`'s own `row` and the
 * reason its doc comment gives: a bare `Record<string, any>` parameter
 * widens the return type to the same, which stopped `newExcerpt`/`seedExcerpt`
 * below from being checked against `entry.excerpts`'s declared element type.
 * @template {Record<string, any>} T
 * @param {T} fields
 * @returns {{ uid: string } & T}
 */
function row(fields) {
	return { uid: uid(), ...fields };
}

/**
 * Lifts one persisted excerpt row into the current object shape. A draft
 * saved before excerpts gained it still has the old plain-string form.
 *
 * Named rather than an inline `.map((sample) => ...)` with a per-parameter
 * JSDoc cast: that inline-cast idiom is mishandled by Svelte's compiler in
 * `.svelte.js` files (see `submissionStore.svelte.js`'s own `rekeyed` doc
 * comment for the full explanation) — a named function's `@param` above the
 * declaration is untouched by that transform.
 * @param {any} sample
 */
function normalizedExcerpt(sample) {
	return typeof sample === 'string'
		? { uid: uid(), title: '', text: sample, audio_url: '' }
		: sample;
}

function emptyEntry() {
	return {
		creator: '',
		type: '',
		// Audio only, required: 'music' or 'spoken'. Left blank rather than
		// defaulted, since a silent default would mislabel spoken entries --
		// this also applies to a pre-migration member with no form yet, which
		// must prefill blank rather than assume one on the creator's behalf.
		form: '',
		why: '',
		has_own_site: 'yes',
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

/**
 * Reads a saved draft, deliberately without the email.
 *
 * A draft written by an older build still has one stored, so this drops it on
 * the way in as well as never writing it out again — otherwise an address
 * saved before this change would keep coming back indefinitely.
 * @returns {{ nodeId: string, entry: ReturnType<typeof emptyEntry> } | null}
 */
function loadDraft() {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed?.nodeId) return null;
		const entry = { ...emptyEntry(), ...parsed.entry };
		// A draft saved before excerpts gained an object shape still has the
		// old plain-string form; lift it the same way `select()` (and
		// `ring.js`'s `normalizeEntry`) do, rather than leaving a raw string
		// where the rest of the app expects `.text`.
		if (Array.isArray(entry.excerpts)) {
			entry.excerpts = entry.excerpts.map(normalizedExcerpt);
		}
		return { nodeId: parsed.nodeId, entry };
	} catch {
		return null;
	}
}

/**
 * Loose, matching `submissionValidation.js`'s own reasoning: strict enough
 * to catch a typo, no stricter.
 * @param {string} value
 */
function isValidEmail(value) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Builds an independent store.
 *
 * Exported for tests only, for the same reason `submissionStore` exports its
 * own: this reads localStorage once at import, so without a factory there is
 * no way to seed storage and observe what came back.
 *
 * **Application code must use the `updateStore` singleton below.**
 */
export function createUpdateStore() {
	const draft = loadDraft();

	let nodeId = $state(draft?.nodeId ?? '');
	/**
	 * The published node as last fetched, or null before lookup / if not
	 * found locally.
	 * @type {Record<string, any> | null}
	 */
	let node = $state(null);
	let notFound = $state(false);
	/**
	 * Candidates when the query matched more than one node — two creators with
	 * similar names, most likely. Surfaced so the visitor picks, rather than
	 * this store guessing which of their neighbours they meant.
	 * @type {Record<string, any>[]}
	 */
	let matches = $state([]);
	/**
	 * The result of asking, as soon as a node is found, whether a fresh
	 * request for its `source_url` would be rate-limited right now. `null`
	 * until that check resolves (or if it never found anything worth
	 * surfacing) — see `checkRateStatus`'s own doc comment for why this is
	 * advisory only and never blocks `next`.
	 * @type {{ blocked: boolean, retryAfterSeconds: number | null } | null}
	 */
	let rateStatus = $state(null);
	let entry = $state(draft?.entry ?? emptyEntry());
	// Never restored from the draft, matching `/join`. An address is given for
	// one message; it should not outlive that message just because someone
	// closed the tab. Everything else in the draft still survives a reload,
	// which is the half that actually protects their work.
	let email = $state('');
	let rightsReaffirmed = $state(false);
	/**
	 * Which of the two things this visit is. Only ever set by an explicit
	 * choice on the verify step; nothing infers it, because inferring "they
	 * probably meant to delete" is not a mistake worth risking.
	 * @type {'change' | 'remove'}
	 */
	let intent = $state('change');
	/** Optional and free text — see `requestRemoval`'s note on why. */
	let removalReason = $state('');
	/** The deliberate act that arms removal, reset whenever intent changes. */
	let removalConfirmed = $state(false);

	/** uids seeded from the published node, so a row added afterward reads as new work. */
	let seededTrackUids = new SvelteSet();
	let seededPageUids = new SvelteSet();
	let seededArtworkUids = new SvelteSet();
	let seededExcerptUids = new SvelteSet();

	let step = $state('identify');
	let submissionId = $state('');
	let token = $state('');
	let expiresAt = $state('');
	let verified = $state(false);
	/** Set once the (changed) `source_url` has actually been attached to this submission. */
	let sourceUrlBound = $state(false);
	/** @type {'idle' | 'issuing' | 'verifying' | 'submitting'} */
	let pending = $state('idle');
	/** @type {import('./submissionError.js').WebhookError | null} */
	let error = $state(null);
	let verifyFailure = $state('');
	let reference = $state('');

	// Guards against a slower response from an earlier `select()` overwriting
	// `rateStatus` after a faster-typing visitor has already moved on to a
	// different node -- incremented on every call, and a response only
	// applies itself if it is still the most recent one requested.
	let rateStatusRequestId = 0;

	/** @param {string} sourceUrl */
	async function refreshRateStatus(sourceUrl) {
		rateStatus = null;
		if (!sourceUrl) return;
		const requestId = ++rateStatusRequestId;
		const result = await checkRateStatus(sourceUrl);
		if (requestId !== rateStatusRequestId) return; // superseded by a later selection
		if (result.blocked) rateStatus = result;
	}

	const antiBot = createAntiBot();

	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let persistTimer;

	function persist() {
		if (!browser) return;
		clearTimeout(persistTimer);
		persistTimer = setTimeout(() => {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodeId, entry }));
			} catch {
				// Private browsing, or a full quota — same posture as submissionStore.
			}
		}, PERSIST_DEBOUNCE_MS);
	}

	const entryErrors = $derived(validateEntry(entry));

	const emailError = $derived(
		email.trim()
			? isValidEmail(email.trim())
				? ''
				: 'That does not look like an email address.'
			: 'Needed so we can tell you what happened to your request.'
	);

	/**
	 * Named rather than an inline `node !== null && ...` expression directly
	 * inside `$derived(...)` — TS narrowing on `node` did not survive being
	 * written that way here (reported `node.source_url` against type
	 * `never`), the same class of svelte-check quirk `isNotUid`'s own doc
	 * comment describes elsewhere in this file. A real function body is
	 * narrowed correctly.
	 */
	function computeSourceUrlChanged() {
		if (node === null) return false;
		return entry.source_url.trim() !== node.source_url;
	}

	const sourceUrlChanged = $derived(computeSourceUrlChanged());

	/**
	 * Named rather than inline arrow functions passed to `.some()` below,
	 * and typed via `@param` on the function itself rather than a cast
	 * inside the arrow's parameter list — see `submissionStore.svelte.js`'s
	 * own `isNotUid` doc comment on why an inline `@type` cast written
	 * directly inside an arrow function's parens breaks under SSR here.
	 * @param {{ uid: string, label?: string, media_url?: string }} t
	 */
	function isNewTrack(t) {
		return !seededTrackUids.has(t.uid) && Boolean(t.label?.trim()) && Boolean(t.media_url?.trim());
	}

	/** @param {{ uid: string, image_url?: string }} p */
	function isNewPage(p) {
		return !seededPageUids.has(p.uid) && Boolean(p.image_url?.trim());
	}

	/** @param {{ uid: string, image_url?: string }} artwork */
	function isNewArtwork(artwork) {
		return !seededArtworkUids.has(artwork.uid) && Boolean(artwork.image_url?.trim());
	}

	/** @param {{ uid: string, text?: string }} sample */
	function isNewExcerpt(sample) {
		return !seededExcerptUids.has(sample.uid) && Boolean(stripHtml(sample.text ?? '').trim());
	}

	/** @param {{ label: string, media_url: string }} t */
	function seedTrack(t) {
		const r = row({ label: t.label, media_url: t.media_url });
		seededTrackUids.add(r.uid);
		return r;
	}

	/** @param {{ image_url: string, caption?: string }} p */
	function seedPage(p) {
		const r = row({ image_url: p.image_url, caption: p.caption ?? '' });
		seededPageUids.add(r.uid);
		return r;
	}

	/** @param {{ image_url: string, alt: string, title?: string, year?: string, medium?: string, external_url?: string }} artwork */
	function seedArtwork(artwork) {
		const r = row({
			image_url: artwork.image_url,
			alt: artwork.alt,
			title: artwork.title ?? '',
			year: artwork.year ?? '',
			medium: artwork.medium ?? '',
			external_url: artwork.external_url ?? ''
		});
		seededArtworkUids.add(r.uid);
		return r;
	}

	/** @param {{ title?: string, text: string, audio_url?: string }} sample */
	function seedExcerpt(sample) {
		const r = row({
			title: sample.title ?? '',
			text: sample.text,
			audio_url: sample.audio_url ?? ''
		});
		seededExcerptUids.add(r.uid);
		return r;
	}

	/**
	 * `seedExcerpt`, but for one entry straight off a found node: still
	 * possibly the legacy plain-string form, which is lifted to `{ text }`
	 * first. Named rather than inlined into the `.map()` call below for the
	 * same reason `normalizedExcerpt` above is: an inline JSDoc-cast arrow
	 * parameter breaks Svelte's compiler in `.svelte.js` files.
	 * @param {any} sample
	 */
	function seedFoundExcerpt(sample) {
		return seedExcerpt(typeof sample === 'string' ? { text: sample } : sample);
	}
	/** Any media row that was not part of the published node — the thing the rights re-affirmation is scoped to. */
	const hasNewWork = $derived(
		entry.tracks.some(isNewTrack) ||
			entry.pages.some(isNewPage) ||
			entry.artworks.some(isNewArtwork) ||
			entry.excerpts.some(isNewExcerpt)
	);

	return {
		get nodeId() {
			return nodeId;
		},
		set nodeId(value) {
			nodeId = value;
		},
		get node() {
			return node;
		},
		get notFound() {
			return notFound;
		},
		get entry() {
			return entry;
		},
		get email() {
			return email;
		},
		set email(value) {
			email = value;
			persist();
		},
		get emailError() {
			return emailError;
		},
		get rightsReaffirmed() {
			return rightsReaffirmed;
		},
		set rightsReaffirmed(value) {
			rightsReaffirmed = value;
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
		get sourceUrlChanged() {
			return sourceUrlChanged;
		},
		get hasNewWork() {
			return hasNewWork;
		},

		/** The entry exactly as it will be sent, for the review step. */
		get preview() {
			try {
				return toRingEntry(entry);
			} catch {
				return null;
			}
		},

		/** Records interaction for draft persistence; the dwell clock starts when the form loads. */
		touch() {
			antiBot.touch();
			persist();
		},

		clearError() {
			error = null;
			verifyFailure = '';
		},

		/**
		 * Whether `stepId` may be considered done, for gating Continue/the
		 * progress bar's click-to-jump — same shape as
		 * `submissionStore.isStepComplete`, just against this form's own,
		 * shorter step list.
		 * @param {string} stepId
		 */
		isStepComplete(stepId) {
			if (stepId === 'identify') return Boolean(nodeId.trim());
			if (stepId === 'verify') return verified;
			if (stepId === 'edit') {
				return Object.keys(entryErrors).length === 0 && (!hasNewWork || rightsReaffirmed);
			}
			// Removal is complete only once armed. The whole step exists to be
			// the deliberate act, so it cannot be walked past unticked.
			if (stepId === 'remove') return removalConfirmed;
			if (stepId === 'review') return Boolean(reference);
			return false;
		},

		get matches() {
			return matches;
		},

		get rateStatus() {
			return rateStatus;
		},

		/**
		 * Client-side lookup only — see this module's own top comment on why
		 * that is fine here. Seeds `entry` from whatever this browser has
		 * cached, matched on an id, a site URL, or a creator name; a miss
		 * leaves `entry` mostly blank rather than blocking anything, since the
		 * backend is the real authority.
		 * @param {Record<string, any>[]} entries
		 */
		lookup(entries) {
			const found = findNodes(entries ?? [], nodeId);
			// One answer is an answer; several is a question for the visitor.
			matches = found.length > 1 ? found : [];
			const one = found.length === 1 ? found[0] : null;
			node = one;
			notFound = nodeId.trim().length > 0 && found.length === 0;
			if (!one) return;

			this.select(one);
		},

		/**
		 * Commits one candidate as the node being changed, whether it was the
		 * only match or the one picked from a list.
		 * @param {Record<string, any>} found
		 */
		select(found) {
			node = found;
			matches = [];
			notFound = false;
			// Fire-and-forget: advisory only, and `select` itself stays
			// synchronous for its other callers. See `refreshRateStatus`'s own
			// comment on why a superseded response is discarded rather than
			// awaited here.
			refreshRateStatus(found.source_url ?? '');
			// The id the backend will be asked about is the matched node's own,
			// never the text that was typed to find it.
			nodeId = found.id;

			seededTrackUids = new SvelteSet();
			seededPageUids = new SvelteSet();
			seededArtworkUids = new SvelteSet();
			seededExcerptUids = new SvelteSet();
			entry = {
				creator: found.creator,
				type: found.type,
				// '' for a pre-migration audio member with no form yet, forcing a
				// choice before re-submission rather than assuming one.
				form: found.form ?? '',
				why: found.why ?? '',
				has_own_site: 'yes',
				source_url: found.source_url ?? '',
				tags: [...(found.tags ?? [])],
				tracks: (found.tracks ?? []).map(seedTrack),
				pages: (found.pages ?? []).map(seedPage),
				artworks: (found.artworks ?? []).map(seedArtwork),
				// Legacy plain-string samples (an older ring.json entry) are
				// lifted into the current shape first, the same way `ring.js`'s
				// `normalizeEntry` does for display. A node with no excerpts at
				// all still gets one blank row, matching `emptyEntry`'s default,
				// rather than leaving the edit step with nothing to fill in.
				excerpts:
					found.excerpts?.length || found.excerpt
						? (found.excerpts ?? [found.excerpt]).map(seedFoundExcerpt)
						: [newExcerpt()],
				thumb_url: found.thumb_url ?? '',
				thumb_position: {
					x: found.thumb_position?.x ?? 50,
					y: found.thumb_position?.y ?? 50
				},
				preview_url: found.preview_url ?? '',
				trailer_url: found.trailer_url ?? '',
				explicit: found.explicit === true
			};
			sourceUrlBound = false;
			persist();
		},

		/**
		 * Step one: get a token to place, tied to this node id rather than a
		 * brand-new submission. The backend looks up `nodeId`'s *current*
		 * `source_url` itself; nothing about which URL to check ever comes
		 * from this call.
		 */
		async requestToken() {
			if (pending !== 'idle' || !nodeId.trim()) return;
			pending = 'issuing';
			error = null;
			verifyFailure = '';
			try {
				const result = await requestUpdateToken(nodeId.trim(), {
					website: antiBot.honeypot,
					elapsed_ms: antiBot.elapsedMs
				});
				submissionId = result.submission_id;
				token = result.verification_token;
				expiresAt = result.expires_at;
				verified = false;
			} catch (e) {
				error = /** @type {any} */ (e);
			} finally {
				pending = 'idle';
			}
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
		 * Sends the change request. If `source_url` was edited away from the
		 * published value, it is attached to this submission first — reusing
		 * `bind_source_url`'s existing contract rather than a new one, the
		 * same verify-old-then-bind-new sequencing `/join`'s own
		 * site-generator branch already established. Never retried
		 * automatically, for the same reason `submissionStore.send` isn't.
		 * @param {string} [turnstileToken] Omitted when `Turnstile.svelte` isn't rendering one (`TURNSTILE_SITE_KEY` unset).
		 */
		async send(turnstileToken) {
			if (pending !== 'idle' || !verified) return;
			pending = 'submitting';
			error = null;
			try {
				if (sourceUrlChanged && !sourceUrlBound) {
					await bindSourceUrlApi(submissionId, entry.source_url.trim());
					sourceUrlBound = true;
				}
				const result = await submitUpdate({
					submission_id: submissionId,
					node_id: nodeId.trim(),
					entry: toRingEntry(entry),
					email: email.trim(),
					website: antiBot.honeypot,
					elapsed_ms: antiBot.elapsedMs,
					...(turnstileToken ? { turnstile_token: turnstileToken } : {})
				});
				reference = result.reference;
				if (browser) {
					clearTimeout(persistTimer);
					localStorage.removeItem(STORAGE_KEY);
				}
			} catch (e) {
				error = /** @type {any} */ (e);
			} finally {
				pending = 'idle';
			}
		},

		get intent() {
			return intent;
		},
		/** @param {'change' | 'remove'} value */
		setIntent(value) {
			if (intent === value) return;
			intent = value;
			// Arming does not survive changing your mind. Someone who ticks the
			// confirmation, goes back to editing, then returns should have to
			// mean it again.
			removalConfirmed = false;
			step = value === 'remove' ? 'remove' : 'edit';
		},

		get removalReason() {
			return removalReason;
		},
		set removalReason(value) {
			removalReason = value;
		},

		get removalConfirmed() {
			return removalConfirmed;
		},
		set removalConfirmed(value) {
			removalConfirmed = value;
		},

		/**
		 * Withdraws the node. Same guards as `send`: verified, not already in
		 * flight, and never retried automatically.
		 *
		 * The draft is cleared on success exactly as a change request clears
		 * it — there is nothing left to come back to, and leaving a draft
		 * behind would offer to resume editing an entry that no longer exists.
		 * @param {string} [turnstileToken]
		 */
		async sendRemoval(turnstileToken) {
			if (pending !== 'idle' || !verified || !removalConfirmed) return;
			pending = 'submitting';
			error = null;
			try {
				const result = await requestRemoval({
					submission_id: submissionId,
					node_id: nodeId.trim(),
					...(removalReason.trim() ? { reason: removalReason.trim() } : {}),
					website: antiBot.honeypot,
					elapsed_ms: antiBot.elapsedMs,
					...(turnstileToken ? { turnstile_token: turnstileToken } : {})
				});
				reference = result.reference;
				if (browser) {
					clearTimeout(persistTimer);
					localStorage.removeItem(STORAGE_KEY);
				}
			} catch (e) {
				error = /** @type {any} */ (e);
			} finally {
				pending = 'idle';
			}
		},

		/** Used by the "start over" affordance on the success screen. */
		reset() {
			nodeId = '';
			node = null;
			notFound = false;
			entry = emptyEntry();
			email = '';
			rightsReaffirmed = false;
			intent = 'change';
			removalReason = '';
			removalConfirmed = false;
			seededTrackUids = new SvelteSet();
			seededPageUids = new SvelteSet();
			seededArtworkUids = new SvelteSet();
			seededExcerptUids = new SvelteSet();
			step = 'identify';
			submissionId = '';
			token = '';
			expiresAt = '';
			verified = false;
			sourceUrlBound = false;
			reference = '';
			error = null;
			verifyFailure = '';
			antiBot.reset();
			if (browser) {
				clearTimeout(persistTimer);
				localStorage.removeItem(STORAGE_KEY);
			}
		}
	};
}

export const updateStore = createUpdateStore();
