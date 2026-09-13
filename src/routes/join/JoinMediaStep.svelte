<script>
	/**
	 * The media step of `/join`: the work itself.
	 *
	 * Split out of the route because it is the largest single step and the one
	 * with the most branches — five entry types, each collecting something
	 * different, doubled by whether the submitter already has a site (URLs they
	 * host) or is having one generated (files we embed).
	 *
	 * Reads the two stores directly rather than being handed them. They are
	 * singletons and this is a step of one specific form, not a reusable
	 * widget; passing them would add ceremony without adding a seam. What the
	 * route still owns, and passes, is where this step sits in the walk —
	 * whether Continue is allowed, and what Back and Continue do.
	 *
	 * @type {{ canAdvance: boolean, onBack: () => void, onNext: () => void }}
	 */
	let { canAdvance, onBack, onNext } = $props();

	import FormField from '../../components/FormField.svelte';
	import ArtworkMetadataFields from '../../components/ArtworkMetadataFields.svelte';
	import TextSampleEditor from '../../components/TextSampleEditor.svelte';
	import {
		submissionStore as form,
		newArtwork,
		newExcerpt,
		newPage,
		newTrack
	} from '$lib/submissionStore.svelte.js';
	import { generatorDraftStore } from '$lib/generator/generatorDraftStore.svelte.js';
	import { MAX_ARTWORKS, MAX_EXCERPTS, MAX_PAGES, MAX_TRACKS } from '$lib/submissionValidation.js';
	import { ACCEPTED_IMAGE_TYPES, rejectionReason } from '$lib/generator/assets.js';
	import { createNewRowFocus, focusHeading } from '$lib/formRowFocus.svelte.js';
	import { uid } from '$lib/uid.js';
	import { NEOCITIES_URL, FILE_GARDEN_URL, NEKOWEB_URL } from '$lib/config.js';
	import { flyFade } from '$lib/transitions.js';

	// This step's own rows. A separate tracker from the one the route keeps for
	// the site step's social links: they are independent lists, and sharing one
	// would let adding a row in one place scroll the other.
	const { mark: markNewRow, scrollNewRowIntoView } = createNewRowFocus();

	const entry = $derived(form.entry);
	const generator = $derived(generatorDraftStore.generator);

	// Typed image URLs are asked about once they stop changing: is each one
	// really an image, or the page it sits on? (`$lib/mediaUrlCheck.js`.) An
	// effect rather than an input handler, so a draft restored from storage is
	// checked too, not only a URL being typed now.
	$effect(() => {
		form.scheduleMediaChecks();
	});
	const CHECKING = 'Checking that this link is an image…';

	/** The generated-page branch caps works at the same three tracks do. */
	const MAX_WORKS = MAX_TRACKS;

	// Moved here from JoinEntryStep.svelte: this is what a musician is actually
	// deciding when they reach this step (bundle vs. link out, and if linking
	// out, to where), not back at the step that only asks what kind of work
	// this is. The gate is still just `entry.type === 'audio'`.
	const HOSTING = [
		{
			host: 'archive.org',
			plays: 'Yes',
			level: 'yes',
			why: 'Free, permanent, built for this, and sends the cross-origin header. The standing recommendation.'
		},
		{
			host: 'File Garden',
			plays: 'Yes',
			level: 'yes',
			why: 'Direct file links allow cross-origin playback, so tracks can join the queue here.'
		},
		{
			host: 'Your own site',
			plays: 'Yes',
			level: 'yes',
			why: 'As long as the file is served with an Access-Control-Allow-Origin header.'
		},
		{
			host: 'Bandcamp',
			plays: 'No',
			level: 'no',
			why: 'Its direct audio URLs expire within about a day. The embedded player never expires, but cannot tell this site when a track ends, so it cannot take part in a queue.'
		},
		{
			host: 'YouTube',
			plays: 'No',
			level: 'no',
			why: 'Its terms prohibit playing a video’s audio on its own, and its embed brings ads and tracking this project does not put on your visitors.'
		},
		{
			host: 'Spotify, Apple Music, SoundCloud',
			plays: 'No',
			level: 'no',
			why: 'Platform players cannot hand a file to this site. Link out with source_url instead.'
		}
	];

	/**
	 * Whether the no-site "host it separately" choice already has something to
	 * submit. Read into a typed local first rather than calling `.some`
	 * directly on `entry.tracks`, for the same compiler reason `isNotUid`
	 * exists below.
	 */
	const hasAnyTrackUrl = $derived.by(() => {
		/** @type {{ media_url?: string }[]} */
		const tracks = entry.tracks ?? [];
		return tracks.some((t) => Boolean(t.media_url?.trim()));
	});

	const mediaHeading = $derived(
		/** @type {Record<string, string>} */ ({
			audio: 'Your tracks',
			comic: 'Your pages',
			text: 'Your text samples',
			game: 'Your screenshots',
			art: 'Your artwork'
		})[entry.type] ?? 'The work itself'
	);

	/**
	 * A named predicate rather than an inline arrow with a `@type` cast on its
	 * own parameter: Svelte's compiler mishandles that idiom in `.svelte`
	 * files, wrapping the parameter in parens and emitting invalid syntax.
	 * @param {{ uid: string }} row
	 * @param {string} uid
	 */
	function isNotUid(row, uid) {
		return row.uid !== uid;
	}

	/** @param {string} uid */
	function removeTrack(uid) {
		entry.tracks = entry.tracks.filter((row) => isNotUid(row, uid));
	}

	/** @param {string} uid */
	function removePage(uid) {
		entry.pages = entry.pages.filter((row) => isNotUid(row, uid));
	}
	/** @param {string} uid */
	function removeArtwork(uid) {
		entry.artworks = entry.artworks.filter((row) => isNotUid(row, uid));
	}

	function addExcerpt() {
		if (entry.excerpts.length >= MAX_EXCERPTS) return;
		const sample = newExcerpt();
		entry.excerpts = [...entry.excerpts, sample];
		markNewRow(sample.uid);
	}

	/** @param {string} uid */
	function removeExcerpt(uid) {
		entry.excerpts = entry.excerpts.filter((row) => isNotUid(row, uid));
	}

	// Named, rather than an inline arrow, specifically so the newly created
	// row's own uid is available to hand to markNewRow — an inline arrow
	// discards that value the instant the assignment finishes, with nothing
	// left to scroll to afterward.
	function addTrack() {
		const track = newTrack();
		entry.tracks = [...entry.tracks, track];
		markNewRow(track.uid);
	}

	function addPage() {
		const page = newPage();
		entry.pages = [...entry.pages, page];
		markNewRow(page.uid);
	}

	function addArtwork() {
		const artwork = newArtwork();
		entry.artworks = [...entry.artworks, artwork];
		markNewRow(artwork.uid);
	}

	/**
	 * The no-site branch's own repeatable rows, holding real uploaded files
	 * rather than URLs. `generatorDraftStore.save` is debounced for text fields
	 * (label/caption), same as everywhere else in this form, but a file
	 * selection calls `saveNow` instead: a chosen file is exactly the kind of
	 * change worth writing to IndexedDB immediately, since losing it to a
	 * closed tab a moment later would mean re-picking it.
	 *
	 * Every function below reads `generator.works` into an explicitly-typed
	 * local first, rather than calling `.map`/`.filter` directly on the
	 * loosely-typed store value, for the same compiler reason `isNotUid` exists.
	 * @typedef {{ uid: string, label?: string, caption?: string, alt?: string, title?: string, year?: string, medium?: string, external_url?: string, file: File | null }} WorkRow
	 */

	function addWork() {
		const row =
			entry.type === 'art'
				? {
						uid: uid(),
						file: null,
						alt: '',
						title: '',
						year: '',
						medium: '',
						external_url: ''
					}
				: { uid: uid(), file: null };
		/** @type {WorkRow[]} */
		const works = [...(generator.works ?? []), row];
		generatorDraftStore.save({ generator: { works } });
		markNewRow(row.uid);
	}

	/** @param {string} uid */
	function removeWork(uid) {
		/** @type {WorkRow[]} */
		const current = generator.works ?? [];
		generatorDraftStore.saveNow({ generator: { works: current.filter((w) => w.uid !== uid) } });
	}

	/** @param {WorkRow} work */
	function hasArtFileAndAlt(work) {
		return Boolean(work.file && work.alt?.trim());
	}

	/**
	 * @param {string} uid
	 * @param {Record<string, any>} patch
	 */
	function updateWorkText(uid, patch) {
		/** @type {WorkRow[]} */
		const current = generator.works ?? [];
		const works = current.map((w) => (w.uid === uid ? { ...w, ...patch } : w));
		generatorDraftStore.save({ generator: { works } });
	}

	/**
	 * @param {string} uid
	 * @param {Event} event
	 */
	function updateWorkFile(uid, event) {
		const input = /** @type {HTMLInputElement} */ (event.currentTarget);
		const file = input.files?.[0] ?? null;

		// Audio is the case that needs this most: it is copied into the export
		// byte-for-byte and never decoded, so nothing downstream would notice
		// the wrong file until it failed to play on the creator's own site.
		const reason = file ? rejectionReason(file, entry.type === 'audio' ? 'audio' : 'image') : null;
		workErrors = { ...workErrors, [uid]: reason ?? '' };
		if (reason) {
			input.value = '';
			return;
		}

		/** @type {WorkRow[]} */
		const current = generator.works ?? [];
		const works = current.map((w) => (w.uid === uid ? { ...w, file } : w));
		generatorDraftStore.saveNow({ generator: { works } });
	}

	/** @type {Record<string, string>} */
	let workErrors = $state({});

	/**
	 * Takes the file back off a row without taking the row with it.
	 *
	 * Distinct from `removeWork` on purpose: a comic page and an artwork both
	 * carry their own typed-in metadata beside the file (a caption, a title
	 * and its required alt text), and for a game the single row *is* the
	 * screenshot slot, so deleting the row to swap a file would throw away
	 * either the writing or the slot itself. Picking a different file already
	 * replaces one, so this is specifically for the case a file was chosen by
	 * mistake and the right answer is nothing at all.
	 *
	 * The native input keeps displaying the old filename until its own `value`
	 * is cleared, which would otherwise leave the control contradicting the
	 * hint right beside it.
	 * @param {string} uid
	 * @param {string} inputId
	 */
	function clearWorkFile(uid, inputId) {
		/** @type {WorkRow[]} */
		const current = generator.works ?? [];
		const works = current.map((w) => (w.uid === uid ? { ...w, file: null } : w));
		generatorDraftStore.saveNow({ generator: { works } });
		const input = document.getElementById(inputId);
		if (input instanceof HTMLInputElement) input.value = '';
	}
</script>

<h2 tabindex="-1" use:focusHeading>{mediaHeading}</h2>

{#if !entry.type}
	<p class="note">Pick a type on the previous step first.</p>
{:else if entry.has_own_site === 'no' && entry.type === 'audio'}
	<p class="note">
		A quick note before you pick: we highly recommend owning your own webspace, which is why we
		generally don't recommend rented spaces like SoundCloud, social media sites, and the like.
	</p>

	<FormField id="f-audio-hosting" label="How do you want to host the audio itself?">
		{#snippet children(describedBy)}
			<div class="hosting-bubble-row" aria-describedby={describedBy}>
				<label
					class="hosting-bubble"
					class:checked={(generator.audioHosting ?? 'bundle') === 'bundle'}
				>
					<input
						type="radio"
						name="audio_hosting"
						value="bundle"
						checked={(generator.audioHosting ?? 'bundle') === 'bundle'}
						onchange={() => generatorDraftStore.save({ generator: { audioHosting: 'bundle' } })}
					/>
					Bundle it into my generated page
				</label>
				<label class="hosting-bubble" class:checked={generator.audioHosting === 'external'}>
					<input
						type="radio"
						name="audio_hosting"
						value="external"
						checked={generator.audioHosting === 'external'}
						onchange={() => generatorDraftStore.save({ generator: { audioHosting: 'external' } })}
					/>
					I'll host it separately and link to it
				</label>
			</div>
		{/snippet}
	</FormField>

	{#if generator.audioHosting === 'external'}
		<div class="note-panel" in:flyFade={{ y: 8, duration: 220 }}>
			<p>A few places that work:</p>
			<!-- eslint-disable svelte/no-navigation-without-resolve -- external provider sites -->
			<div class="hosting-rows">
				<div class="hosting-row">
					<img src="/images/hosting/neocities.png" alt="" width="44" height="44" />
					<div class="hosting-row-body">
						<p class="hosting-row-title">Neocities</p>
						<p class="note">
							Free static page hosting with an in-browser editor. The free tier blocks audio files;
							its Supporter tier allows them.
						</p>
					</div>
					<a
						class="hosting-row-link"
						href={NEOCITIES_URL}
						target="_blank"
						rel="noopener noreferrer"
						aria-label="Visit Neocities"><span aria-hidden="true">&rarr;</span></a
					>
				</div>
				<div class="hosting-row">
					<img src="/images/hosting/file-garden.png" alt="" width="44" height="44" />
					<div class="hosting-row-body">
						<p class="hosting-row-title">File Garden</p>
						<p class="note">
							Free direct file hosting for your audio. Pair it with Neocities or any other host for
							the page itself.
						</p>
					</div>
					<a
						class="hosting-row-link"
						href={FILE_GARDEN_URL}
						target="_blank"
						rel="noopener noreferrer"
						aria-label="Visit File Garden"><span aria-hidden="true">&rarr;</span></a
					>
				</div>
				<div class="hosting-row">
					<img src="/images/hosting/nekoweb.png" alt="" width="44" height="44" />
					<div class="hosting-row-body">
						<p class="hosting-row-title">Nekoweb</p>
						<p class="note">
							One host for both your page and audio, with no restriction on file types.
						</p>
					</div>
					<a
						class="hosting-row-link"
						href={NEKOWEB_URL}
						target="_blank"
						rel="noopener noreferrer"
						aria-label="Visit Nekoweb"><span aria-hidden="true">&rarr;</span></a
					>
				</div>
			</div>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
			<h3 class="hosting-divider">Already have a host? Link it below.</h3>
		</div>

		<!--
			Same label + direct-link markup as the has-own-site audio branch
			below, duplicated rather than shared via a snippet. A standalone
			{#snippet} whose body calls a component-local function (removeTrack
			here) from inside an {#each} fails to build under this project's
			current Vite 8 / rolldown-vite pipeline with an opaque PARSE_ERROR
			pointing at an unrelated line -- confirmed by elimination down to a
			bare `onclick={removeTrack}` with no wrapper and no arguments. Calling
			an imported store's own method (form.touch()) from the same position
			is unaffected; only a reference to a sibling top-level function in
			this component is what breaks it. If duplication here is ever
			"cleaned up" into a shared snippet, this is why it was not already.
		-->
		{#each entry.tracks as track, i (track.uid)}
			<div class="repeat-row" use:scrollNewRowIntoView={track.uid}>
				<FormField
					id="f-track-label-{track.uid}"
					label="Track {i + 1} name"
					error={form.entryErrors[`tracks.${i}.label`]}
				>
					{#snippet children(describedBy)}
						<input
							id="f-track-label-{track.uid}"
							class="control"
							type="text"
							bind:value={track.label}
							oninput={() => form.touch()}
							aria-describedby={describedBy}
							aria-invalid={Boolean(form.entryErrors[`tracks.${i}.label`])}
						/>
					{/snippet}
				</FormField>
				<FormField
					id="f-track-url-{track.uid}"
					label="Direct link to the file"
					error={form.entryErrors[`tracks.${i}.media_url`]}
				>
					{#snippet children(describedBy)}
						<input
							id="f-track-url-{track.uid}"
							class="control"
							type="url"
							placeholder="https://"
							bind:value={track.media_url}
							oninput={() => form.touch()}
							aria-describedby={describedBy}
							aria-invalid={Boolean(form.entryErrors[`tracks.${i}.media_url`])}
						/>
					{/snippet}
				</FormField>
				<button type="button" class="clear-button" onclick={() => removeTrack(track.uid)}>
					Remove track {i + 1}
				</button>
			</div>
		{/each}

		{#if entry.tracks.length < MAX_TRACKS}
			<button type="button" class="btn btn-ghost" onclick={addTrack}>Add a track</button>
		{:else}
			<p class="note">
				That is the cap of {MAX_TRACKS}. Remove one if you would rather include something else;
				nothing is dropped silently.
			</p>
		{/if}

		{#if !hasAnyTrackUrl}
			<p class="note">At least one link is needed before this step is done.</p>
		{/if}
	{:else}
		<p>
			Up to {MAX_WORKS} tracks. Upload the actual files: they will be embedded in the page we build for
			you in a moment.
		</p>
		{#each generator.works ?? [] as work, i (work.uid)}
			<div class="repeat-row" use:scrollNewRowIntoView={work.uid}>
				<FormField id="f-work-label-{work.uid}" label="Track {i + 1} name">
					{#snippet children(describedBy)}
						<input
							id="f-work-label-{work.uid}"
							class="control"
							type="text"
							value={work.label ?? ''}
							oninput={(e) =>
								updateWorkText(work.uid, {
									label: /** @type {HTMLInputElement} */ (e.currentTarget).value
								})}
							aria-describedby={describedBy}
						/>
					{/snippet}
				</FormField>
				<FormField
					id="f-work-file-{work.uid}"
					label="Audio file"
					hint={work.file ? work.file.name : 'MP3, WAV, or similar.'}
					error={workErrors[work.uid]}
				>
					{#snippet children(describedBy)}
						<div class="file-row">
							<input
								id="f-work-file-{work.uid}"
								class="control"
								type="file"
								accept="audio/*"
								onchange={(e) => updateWorkFile(work.uid, e)}
								aria-describedby={describedBy}
							/>
							{#if work.file}
								<button
									type="button"
									class="clear-button"
									onclick={() => clearWorkFile(work.uid, `f-work-file-${work.uid}`)}
								>
									Clear file
								</button>
							{/if}
						</div>
					{/snippet}
				</FormField>
				<button type="button" class="clear-button" onclick={() => removeWork(work.uid)}>
					Remove track {i + 1}
				</button>
			</div>
		{/each}
		{#if (generator.works?.length ?? 0) < MAX_WORKS}
			<button type="button" class="btn btn-ghost" onclick={addWork}>Add a track</button>
		{:else}
			<p class="note">That is the cap of {MAX_WORKS}.</p>
		{/if}
		<p class="note">
			<strong>No files yet? Skip this.</strong> Your generated page will still list you with a cover image
			if you add one on the next step.
		</p>
	{/if}
{:else if entry.has_own_site === 'no' && entry.type === 'comic'}
	<p>Up to {MAX_WORKS} pages. Upload the actual page images.</p>
	{#each generator.works ?? [] as work, i (work.uid)}
		<div class="repeat-row" use:scrollNewRowIntoView={work.uid}>
			<FormField
				id="f-work-file-{work.uid}"
				label="Page {i + 1} image"
				required
				hint={work.file ? work.file.name : undefined}
				error={workErrors[work.uid]}
			>
				{#snippet children(describedBy)}
					<div class="file-row">
						<input
							id="f-work-file-{work.uid}"
							class="control"
							type="file"
							accept={ACCEPTED_IMAGE_TYPES.join(',')}
							onchange={(e) => updateWorkFile(work.uid, e)}
							aria-describedby={describedBy}
						/>
						{#if work.file}
							<button
								type="button"
								class="clear-button"
								onclick={() => clearWorkFile(work.uid, `f-work-file-${work.uid}`)}
							>
								Clear file
							</button>
						{/if}
					</div>
				{/snippet}
			</FormField>
			<FormField id="f-work-caption-{work.uid}" label="Caption (optional)">
				{#snippet children(describedBy)}
					<input
						id="f-work-caption-{work.uid}"
						class="control"
						type="text"
						value={work.caption ?? ''}
						oninput={(e) =>
							updateWorkText(work.uid, {
								caption: /** @type {HTMLInputElement} */ (e.currentTarget).value
							})}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</FormField>
			<button type="button" class="clear-button" onclick={() => removeWork(work.uid)}>
				Remove page {i + 1}
			</button>
		</div>
	{/each}
	{#if (generator.works?.length ?? 0) < MAX_WORKS}
		<button type="button" class="btn btn-ghost" onclick={addWork}>Add a page</button>
	{:else}
		<p class="note">That is the cap of {MAX_WORKS}.</p>
	{/if}
{:else if entry.has_own_site === 'no' && entry.type === 'art'}
	<p>
		Choose one to {MAX_ARTWORKS} works. Mixed portrait, landscape, and square images are welcome; the
		gallery keeps their full proportions.
	</p>
	{#each generator.works ?? [] as work, i (work.uid)}
		<div class="repeat-row" use:scrollNewRowIntoView={work.uid}>
			<FormField
				id="f-art-file-{work.uid}"
				label="Artwork {i + 1} image"
				required
				hint={work.file ? work.file.name : undefined}
				error={workErrors[work.uid]}
			>
				{#snippet children(describedBy)}
					<div class="file-row">
						<input
							id="f-art-file-{work.uid}"
							class="control"
							type="file"
							accept={ACCEPTED_IMAGE_TYPES.join(',')}
							onchange={(event) => updateWorkFile(work.uid, event)}
							aria-describedby={describedBy}
						/>
						{#if work.file}
							<button
								type="button"
								class="clear-button"
								onclick={() => clearWorkFile(work.uid, `f-art-file-${work.uid}`)}
							>
								Clear file
							</button>
						{/if}
					</div>
				{/snippet}
			</FormField>
			<ArtworkMetadataFields
				artwork={work}
				index={i}
				idPrefix={`f-art-${work.uid}`}
				onInput={() => updateWorkText(work.uid, {})}
			/>
			<button type="button" class="clear-button" onclick={() => removeWork(work.uid)}>
				Remove artwork {i + 1}
			</button>
		</div>
	{/each}
	{#if (generator.works?.length ?? 0) < MAX_ARTWORKS}
		<button type="button" class="btn btn-ghost" onclick={addWork}>Add artwork</button>
	{:else}
		<p class="note">That is the cap of {MAX_ARTWORKS}.</p>
	{/if}
	{#if !(generator.works ?? []).some(hasArtFileAndAlt)}
		<p class="note">At least one image and text description are required.</p>
	{/if}
{:else if entry.has_own_site === 'no' && entry.type === 'game'}
	<p>One screenshot or cover image, required so your page has something to show.</p>
	{#if generator.works?.[0]}
		<div use:scrollNewRowIntoView={generator.works[0].uid}>
			<FormField
				id="f-work-file-{generator.works[0].uid}"
				label="Screenshot"
				required
				error={workErrors[generator.works[0].uid]}
				hint={generator.works[0].file
					? generator.works[0].file.name
					: 'Any size works; wide screenshots read best.'}
			>
				{#snippet children(describedBy)}
					<div class="file-row">
						<input
							id="f-work-file-{generator.works[0].uid}"
							class="control"
							type="file"
							accept={ACCEPTED_IMAGE_TYPES.join(',')}
							onchange={(e) => updateWorkFile(generator.works[0].uid, e)}
							aria-describedby={describedBy}
						/>
						{#if generator.works[0].file}
							<button
								type="button"
								class="clear-button"
								onclick={() =>
									clearWorkFile(generator.works[0].uid, `f-work-file-${generator.works[0].uid}`)}
							>
								Clear file
							</button>
						{/if}
					</div>
				{/snippet}
			</FormField>
		</div>
	{:else}
		<button type="button" class="btn btn-ghost" onclick={addWork}> Add a screenshot </button>
	{/if}
{:else if entry.type === 'audio'}
	<p>
		Up to {MAX_TRACKS}, so the ring stays a sampler rather than a catalog. Each link must point at a
		direct audio file you host.
	</p>

	{#each entry.tracks as track, i (track.uid)}
		<div class="repeat-row" use:scrollNewRowIntoView={track.uid}>
			<FormField
				id="f-track-label-{track.uid}"
				label="Track {i + 1} name"
				error={form.entryErrors[`tracks.${i}.label`]}
			>
				{#snippet children(describedBy)}
					<input
						id="f-track-label-{track.uid}"
						class="control"
						type="text"
						bind:value={track.label}
						oninput={() => form.touch()}
						aria-describedby={describedBy}
						aria-invalid={Boolean(form.entryErrors[`tracks.${i}.label`])}
					/>
				{/snippet}
			</FormField>
			<FormField
				id="f-track-url-{track.uid}"
				label="Direct link to the file"
				error={form.entryErrors[`tracks.${i}.media_url`]}
			>
				{#snippet children(describedBy)}
					<input
						id="f-track-url-{track.uid}"
						class="control"
						type="url"
						placeholder="https://"
						bind:value={track.media_url}
						oninput={() => form.touch()}
						aria-describedby={describedBy}
						aria-invalid={Boolean(form.entryErrors[`tracks.${i}.media_url`])}
					/>
				{/snippet}
			</FormField>
			<button type="button" class="clear-button" onclick={() => removeTrack(track.uid)}>
				Remove track {i + 1}
			</button>
		</div>
	{/each}

	{#if entry.tracks.length < MAX_TRACKS}
		<button type="button" class="btn btn-ghost" onclick={addTrack}>Add a track</button>
	{:else}
		<p class="note">
			That is the cap of {MAX_TRACKS}. Remove one if you would rather include something else;
			nothing is dropped silently.
		</p>
	{/if}

	<p class="note">
		<strong>No direct file? Skip this.</strong> Your entry still joins the ring with its cover art and
		a link out. It simply will not play here.
	</p>
{:else if entry.type === 'comic'}
	<p>At least one page, up to {MAX_PAGES}. Each is an image you host.</p>
	{#if form.entryErrors.pages}
		<p class="inline-error" role="alert">{form.entryErrors.pages}</p>
	{/if}
	{#each entry.pages as page, i (page.uid)}
		<div class="repeat-row" use:scrollNewRowIntoView={page.uid}>
			<FormField
				id="f-page-url-{page.uid}"
				label="Page {i + 1} image"
				hint={form.mediaCheckPending(`pages.${i}.image_url`)
					? CHECKING
					: 'The image file itself, not the page it appears on: right-click the page and choose "Copy image address".'}
				required
				error={form.entryErrors[`pages.${i}.image_url`]}
			>
				{#snippet children(describedBy)}
					<input
						id="f-page-url-{page.uid}"
						class="control"
						type="url"
						placeholder="https://"
						bind:value={page.image_url}
						oninput={() => form.touch()}
						aria-describedby={describedBy}
						aria-invalid={Boolean(form.entryErrors[`pages.${i}.image_url`])}
					/>
				{/snippet}
			</FormField>
			<FormField id="f-page-cap-{page.uid}" label="Caption (optional)">
				{#snippet children(describedBy)}
					<input
						id="f-page-cap-{page.uid}"
						class="control"
						type="text"
						bind:value={page.caption}
						oninput={() => form.touch()}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</FormField>
			<button type="button" class="clear-button" onclick={() => removePage(page.uid)}>
				Remove page {i + 1}
			</button>
		</div>
	{/each}
	{#if entry.pages.length < MAX_PAGES}
		<button type="button" class="btn btn-ghost" onclick={addPage}>Add a page</button>
	{/if}
{:else if entry.type === 'art'}
	<p>
		Choose one to {MAX_ARTWORKS} works. Images are contained rather than cropped, and the first work becomes
		the fallback cover when no separate cover is supplied.
	</p>
	{#if form.entryErrors.artworks}
		<p class="inline-error" role="alert">{form.entryErrors.artworks}</p>
	{/if}
	{#each entry.artworks as artwork, i (artwork.uid)}
		<div class="repeat-row" use:scrollNewRowIntoView={artwork.uid}>
			<FormField
				id="f-art-image-{artwork.uid}"
				label="Artwork {i + 1} image"
				hint={form.mediaCheckPending(`artworks.${i}.image_url`)
					? CHECKING
					: 'The image file itself, not the page it appears on: right-click the artwork and choose "Copy image address".'}
				required
				error={form.entryErrors[`artworks.${i}.image_url`]}
			>
				{#snippet children(describedBy)}
					<input
						id="f-art-image-{artwork.uid}"
						class="control"
						type="url"
						placeholder="https://"
						bind:value={artwork.image_url}
						oninput={() => form.touch()}
						aria-describedby={describedBy}
						aria-invalid={Boolean(form.entryErrors[`artworks.${i}.image_url`])}
					/>
				{/snippet}
			</FormField>
			<ArtworkMetadataFields
				{artwork}
				index={i}
				idPrefix={`f-art-${artwork.uid}`}
				errors={form.entryErrors}
				onInput={() => form.touch()}
			/>
			<button type="button" class="clear-button" onclick={() => removeArtwork(artwork.uid)}>
				Remove artwork {i + 1}
			</button>
		</div>
	{/each}
	{#if entry.artworks.length < MAX_ARTWORKS}
		<button type="button" class="btn btn-ghost" onclick={addArtwork}>Add artwork</button>
	{:else}
		<p class="note">That is the cap of {MAX_ARTWORKS}.</p>
	{/if}
{:else if entry.type === 'text'}
	{#each entry.excerpts as sample, i (sample.uid)}
		<div class="repeat-row" use:scrollNewRowIntoView={sample.uid}>
			<FormField
				id={`f-excerpt-title-${sample.uid}`}
				label={`Sample ${i + 1} title (optional)`}
				hint={i === 0
					? 'A chapter, an essay title, the first line of a poem. Leave it blank for an excerpt from something untitled.'
					: undefined}
			>
				{#snippet children(describedBy)}
					<input
						id={`f-excerpt-title-${sample.uid}`}
						class="control"
						type="text"
						bind:value={sample.title}
						oninput={() => form.touch()}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</FormField>
			<FormField
				id={`f-excerpt-${sample.uid}`}
				label={`Text sample ${i + 1}`}
				hint={i === 0
					? 'Enough to give someone the voice of it. You can include up to three samples.'
					: undefined}
				required={i === 0}
				error={i === 0 ? form.entryErrors.excerpts : undefined}
			>
				<!-- Tipex has no `id`/`aria-describedby` prop to receive
				     FormField's usual wiring (it renders its own
				     contenteditable region, not a single input this
				     component can address), so the label/hint/error above
				     stay visible but aren't programmatically tied to it the
				     way every other control in this form is. -->
				<TextSampleEditor
					body={sample.text}
					onUpdate={(html) => {
						sample.text = html;
						form.touch();
					}}
				/>
			</FormField>
			<FormField
				id={`f-excerpt-audio-${sample.uid}`}
				label="Your own recording (optional)"
				hint="A direct link to you reading this sample aloud. Leave it blank and visitors hear an automatic read-aloud instead."
				error={form.entryErrors[`excerpts.${i}.audio_url`]}
			>
				{#snippet children(describedBy)}
					<input
						id={`f-excerpt-audio-${sample.uid}`}
						class="control"
						type="url"
						placeholder="https://"
						bind:value={sample.audio_url}
						oninput={() => form.touch()}
						aria-describedby={describedBy}
						aria-invalid={Boolean(form.entryErrors[`excerpts.${i}.audio_url`])}
					/>
				{/snippet}
			</FormField>
			{#if entry.excerpts.length > 1}
				<button type="button" class="clear-button" onclick={() => removeExcerpt(sample.uid)}>
					Remove sample {i + 1}
				</button>
			{/if}
		</div>
	{/each}
	{#if entry.excerpts.length < MAX_EXCERPTS}
		<button type="button" class="btn btn-ghost" onclick={addExcerpt}>Add a sample</button>
	{/if}
{:else if entry.type === 'game'}
	<FormField
		id="f-preview"
		label="Muted preview clip (optional)"
		hint={form.mediaCheckPending('preview_url')
			? 'Checking that this link is an image or video…'
			: 'Never plays audio on its own, and never autoplays with sound.'}
		error={form.entryErrors.preview_url}
	>
		{#snippet children(describedBy)}
			<input
				id="f-preview"
				class="control"
				type="url"
				placeholder="https://"
				bind:value={entry.preview_url}
				oninput={() => form.touch()}
				aria-describedby={describedBy}
				aria-invalid={Boolean(form.entryErrors.preview_url)}
			/>
		{/snippet}
	</FormField>
	<FormField
		id="f-trailer"
		label="YouTube trailer (optional)"
		hint="Loaded only after someone presses play. The privacy-enhanced YouTube player is used; YouTube may still collect data or show ads once opened."
		error={form.entryErrors.trailer_url}
	>
		{#snippet children(describedBy)}
			<input
				id="f-trailer"
				class="control"
				type="url"
				placeholder="https://youtu.be/…"
				bind:value={entry.trailer_url}
				oninput={() => form.touch()}
				aria-describedby={describedBy}
				aria-invalid={Boolean(form.entryErrors.trailer_url)}
			/>
		{/snippet}
	</FormField>
{/if}

{#if entry.type === 'audio'}
	<details class="help musician-help">
		<summary>Musicians: what makes a track actually playable here</summary>
		<p>
			A track plays here only when its link points at a direct audio file at a host that allows
			cross-origin requests. That is what lets it join the queue, hand over to the next track when
			it ends, and drive the animated background.
		</p>
		<div class="table-scroll">
			<table>
				<thead>
					<tr>
						<th scope="col">Where your audio lives</th>
						<th scope="col">Plays here</th>
						<th scope="col">Why</th>
					</tr>
				</thead>
				<tbody>
					{#each HOSTING as row (row.host)}
						<tr>
							<th scope="row">{row.host}</th>
							<td><span class="req" data-req={row.level}>{row.plays}</span></td>
							<td>{row.why}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</details>
{/if}

<div class="actions">
	<button type="button" class="btn btn-ghost" onclick={onBack}>Back</button>
	<button type="button" class="btn btn-primary" disabled={!canAdvance} onclick={onNext}>
		Continue
	</button>
</div>
