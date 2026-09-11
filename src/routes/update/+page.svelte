<script>
	/**
	 * The change-request form: how an existing node's creator corrects
	 * something after joining — a dead link, a swapped track, a rewritten
	 * pitch. Creator Nodes addendum, Section C; `docs/roadmap.md`'s "Node
	 * maintenance and change requests" entry. `/join` itself links here once
	 * a node already exists (see its own "please submit a change request
	 * form" line).
	 *
	 * Four steps rather than `/join`'s eight: there is no ownership branch, no
	 * site generator, no EULA to re-agree to. `type` and `creator` are locked
	 * — they identify the node, not describe the change — so only `why`,
	 * `tags`, `source_url`, and the type's own featured-work fields are
	 * editable here.
	 */
	import { scrollAffordance } from '$lib/scrollAffordance.js';
	import { onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import GlassPanel from '../../components/GlassPanel.svelte';
	import FormField from '../../components/FormField.svelte';
	import ArtworkMetadataFields from '../../components/ArtworkMetadataFields.svelte';
	import TextSampleEditor from '../../components/TextSampleEditor.svelte';
	import CoverPositionControls from '../../components/CoverPositionControls.svelte';
	import StepProgress from '../../components/StepProgress.svelte';
	import Honeypot from '../../components/Honeypot.svelte';
	import Turnstile from '../../components/Turnstile.svelte';
	import ExactDataDisclosure from '../../components/ExactDataDisclosure.svelte';
	import FieldNode from '../../components/FieldNode.svelte';
	import { ringStore } from '$lib/ringStore.svelte.js';
	import { hasBackend, useMock } from '$lib/submissionApi.js';
	import { flyFade, outFade } from '$lib/transitions.js';
	import { updateStore as form, UPDATE_STEPS } from '$lib/updateStore.svelte.js';
	import { newArtwork, newExcerpt, newTrack, newPage } from '$lib/submissionStore.svelte.js';
	import { snapToAllowedShape } from '$lib/nodeShape.js';
	import {
		FORM_OPTIONS,
		FORM_LABELS,
		MAX_ARTWORKS,
		MAX_EXCERPTS,
		MAX_PAGES,
		MAX_TRACKS,
		WHY_MAX_LENGTH
	} from '$lib/submissionValidation.js';
	import { createNewRowFocus, focusHeading } from '$lib/formRowFocus.svelte.js';

	const { mark: markNewRow, scrollNewRowIntoView } = createNewRowFocus();

	onMount(() => ringStore.ensureLoaded());

	const entry = $derived(form.entry);

	// A live preview of the cover, ported from JoinEntryStep.svelte's own
	// previewEntry/FieldNode pattern: this step previously offered a
	// thumb_url text input and CoverPositionControls' two framing sliders
	// with nothing rendering the picture either was describing, so a
	// creator adjusting focal point had no way to see the crop they were
	// choosing, and there was no way to notice a bad/broken cover URL
	// before submitting. `tracks`/`pages`/`artworks`/`excerpts` stay empty
	// the same way join's own preview leaves them: this card exists to show
	// the cover and framing, not to be a full reader, and it keeps the two
	// forms' preview behavior identical rather than one being a richer
	// simulation than the other for no functional reason.
	const previewType = $derived(
		/** @type {'audio' | 'comic' | 'text' | 'game' | 'art'} */ (entry.type || 'audio')
	);
	const previewSize = $derived(snapToAllowedShape(previewType, 8, 8));
	const previewEntry = $derived({
		id: form.nodeId || 'update-preview',
		creator: entry.creator?.trim() || 'Your name',
		type: previewType,
		why: entry.why?.trim() || 'Your one-line introduction will appear here.',
		thumb_url: entry.thumb_url?.trim() || '',
		thumb_position: entry.thumb_position ?? { x: 50, y: 50 },
		source_url: entry.source_url || '#',
		tags: entry.tags ?? [],
		tracks: [],
		pages: [],
		excerpts: [],
		verification_token: 'preview'
	});

	let tagDraft = $state('');

	function commitTag() {
		const value = tagDraft.trim().toLowerCase();
		if (value && !entry.tags.includes(value)) {
			entry.tags = [...entry.tags, value];
			form.touch();
		}
		tagDraft = '';
	}

	/** @param {KeyboardEvent} event */
	function onTagKeydown(event) {
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			commitTag();
		} else if (event.key === 'Backspace' && !tagDraft && entry.tags.length) {
			entry.tags = entry.tags.slice(0, -1);
		}
	}

	/**
	 * @param {string} value
	 * @param {string} tag
	 */
	function isNotTag(value, tag) {
		return value !== tag;
	}

	/** @param {string} tag */
	function toggleTag(tag) {
		entry.tags = entry.tags.includes(tag)
			? entry.tags.filter((value) => isNotTag(value, tag))
			: [...entry.tags, tag];
		form.touch();
	}

	/**
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

	function onNodeIdInput() {
		form.touch();
		form.lookup(ringStore.entries);
	}

	/**
	 * Rounds up rather than down — telling someone "1 minute" when 90 seconds
	 * actually remain invites a retry that fails again.
	 * @param {number} seconds
	 */
	function formatWait(seconds) {
		const minutes = Math.ceil(seconds / 60);
		return minutes <= 1 ? 'a minute' : `about ${minutes} minutes`;
	}

	let nodeQueryRead = false;

	// Arriving from the members list' change link. Query parameters are
	// unavailable while SvelteKit prerenders this static route, so this reads
	// once on hydration — the same shape /contact uses for `?report=`. The ring
	// may still be loading, hence the second effect below rather than looking
	// up here.
	$effect(() => {
		if (!browser || nodeQueryRead) return;
		nodeQueryRead = true;
		const requested = (page.url.searchParams.get('node') ?? '').trim().slice(0, 120);
		// The explicit member link takes precedence over a draft for another
		// node. This also covers opening "This is mine" in a new tab, where the
		// members page's click handler cannot reset the singleton first.
		if (requested && requested !== form.nodeId.trim()) {
			form.reset();
			form.nodeId = requested;
		}
	});

	// Resolve whatever is in the field once the ring is actually available.
	// Without this, a deep link that beats the fetch lands on "nothing matching
	// that locally" for a node which is right there.
	$effect(() => {
		const entries = ringStore.entries;
		if (!form.nodeId.trim() || form.node || entries.length === 0) return;
		untrack(() => form.lookup(entries));
	});

	// Filtered the way /join filters its own conditional step, so the progress
	// bar and the next/back walk can never disagree about which steps exist.
	const visibleSteps = $derived(
		UPDATE_STEPS.filter((s) => !s.applicable || s.applicable(form.intent))
	);
	const stepIndex = $derived(visibleSteps.findIndex((s) => s.id === form.step));

	function next() {
		const target = visibleSteps[stepIndex + 1];
		if (target) form.step = target.id;
	}

	function back() {
		const target = visibleSteps[stepIndex - 1];
		if (target) form.step = target.id;
	}

	/** @param {number} index */
	function stepReachable(index) {
		for (let i = 0; i < index; i++) {
			if (!form.isStepComplete(visibleSteps[i].id)) return false;
		}
		return true;
	}

	const reachableSteps = $derived(visibleSteps.map((_, i) => stepReachable(i)));

	/** @param {number} index */
	function goToIndex(index) {
		const target = visibleSteps[index];
		if (target && stepReachable(index)) form.step = target.id;
	}

	const canAdvance = $derived(form.isStepComplete(form.step));

	/**
	 * Human text for a verification that ran and came back negative.
	 *
	 * Mirrors `/join`'s own `verifyMessage` (same five reasons, same wording,
	 * kept as a second literal rather than a shared import since the two forms
	 * don't share a module today — see that file's own comment for why every
	 * reason `docs/n8n-workflow-runbook.md` §6 can send needs its own line.
	 * This page used to collapse `expired`/`redirect`/`unsafe_url` all into
	 * "token not found," which told a creator to re-check their paste when the
	 * real problem was something else entirely.
	 */
	const verifyMessage = $derived(
		{
			expired:
				'That token expired before we could check it. Generate a new one and try again — the window is short on purpose.',
			unsafe_url:
				'We could not safely check that address. Make sure it is a plain https:// link with no login or credentials baked in.',
			redirect:
				"That address redirects somewhere else, and we deliberately don't follow redirects. Use the final page it lands on instead — the exact URL your browser shows once it stops moving.",
			unreachable: 'We could not load that page at all. Check it is public and not behind a login.',
			token_not_found:
				'We reached the page, but the token was not on it yet. If you just added it, give your host a moment to publish and try again.'
		}[form.verifyFailure] ??
			(form.verifyFailure
				? 'We could not verify that page. Please try again; if this keeps happening, contact us.'
				: '')
	);

	/** @type {ReturnType<typeof Turnstile> | undefined} */
	let turnstileEl = $state();
	let turnstileToken = $state('');

	async function onSend() {
		await form.send(turnstileToken);
		if (form.error) turnstileEl?.reset();
	}
</script>

<svelte:head>
	<title>Change request, IndieNodes</title>
</svelte:head>

<div class="join-page">
	<h1 class="page-title">Change something you already sent</h1>

	{#if !hasBackend && !useMock}
		<div class="interim-note">
			<p>
				<strong>Change requests are closed right now.</strong> The form below is not accepting requests
				while the submission service is unavailable. Nothing you type here will be sent. Please check
				back.
			</p>
		</div>
	{:else if useMock}
		<div class="interim-note">
			<p>
				<strong>Development mode.</strong> No submission backend is configured, so this form is
				running against canned responses and nothing is sent anywhere. Add
				<code>?mock=fail-verify</code>, <code>network</code>, <code>rate-limited</code>, or
				<code>slow</code> to the URL to exercise the failure states.
			</p>
		</div>
	{/if}

	{#if form.reference}
		<GlassPanel class="done-panel">
			<h2>That is in.</h2>
			{#if form.intent === 'remove'}
				<p>
					A person reviews every removal before it happens, the same as a change. Your entry stays
					listed until then, and your own site was never touched either way.
				</p>
			{:else}
				<p>
					A person reviews every change request before it goes live; we will email you either way.
					Your node stays as it is until then.
				</p>
			{/if}
			<p class="reference-block">
				<span class="reference-label">Your reference</span>
				<code class="reference-code">{form.reference}</code>
			</p>
			<button
				type="button"
				class="btn btn-primary submit-again-button"
				onclick={() => form.reset()}
			>
				{form.intent === 'remove' ? 'Start something else' : 'Submit another request'}
			</button>
		</GlassPanel>
	{:else}
		<div class="join-layout">
			<StepProgress
				step={stepIndex}
				total={visibleSteps.length}
				labels={visibleSteps.map((s) => s.label)}
				reachable={reachableSteps}
				onStepClick={goToIndex}
			/>

			<div class="panel" id="update-panel">
				{#key form.step}
					<div
						use:scrollAffordance
						class="step-body"
						in:flyFade={{ x: 20, duration: 280, delay: 90 }}
						out:outFade={{ duration: 180 }}
					>
						{#if form.step === 'identify'}
							<h2 tabindex="-1" use:focusHeading>Which node is this?</h2>
							<p>
								Whichever you remember: your site's address, the name your entry is listed under, or
								the node id itself. If none of them come to mind, find yourself on the
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
								<a href={resolve('/members')}>members list</a> and use the change link there.
							</p>

							<FormField
								id="f-node-id"
								label="Your site, your name, or your node id"
								hint="A local lookup only, to prefill the next steps — the real check is proving you control the page, in a moment."
								required
							>
								{#snippet children(describedBy)}
									<input
										id="f-node-id"
										class="control"
										type="text"
										autocomplete="off"
										bind:value={form.nodeId}
										oninput={onNodeIdInput}
										aria-describedby={describedBy}
									/>
								{/snippet}
							</FormField>

							{#if form.matches.length > 0}
								<div class="note">
									<p>More than one entry matches. Which is yours?</p>
									<ul class="match-list">
										{#each form.matches as match (match.id)}
											<li>
												<button type="button" onclick={() => form.select(match)}>
													<strong>{match.creator}</strong>
													<span>{match.type} · {match.source_url}</span>
												</button>
											</li>
										{/each}
									</ul>
								</div>
							{:else if form.node}
								<p class="note">
									Found it: <strong>{form.node.creator}</strong> ({form.node.type}) —
									<code>{form.node.id}</code>.
								</p>
								{#if form.rateStatus?.blocked}
									<p class="note">
										A request for this entry went through recently. You can submit again in {formatWait(
											form.rateStatus.retryAfterSeconds ?? 0
										)} — you're welcome to keep going and fill out the rest in the meantime.
									</p>
								{/if}
							{:else if form.notFound}
								<p class="note">
									Nothing matching that locally — could be a stale local copy, or a different
									spelling. You can still continue: the fields on the next steps will start blank,
									and verification is what actually matters.
								</p>
							{/if}

							<div class="actions">
								<button type="button" class="btn btn-primary" disabled={!canAdvance} onclick={next}>
									Continue
								</button>
							</div>
						{:else if form.step === 'verify'}
							<h2 tabindex="-1" use:focusHeading>Prove this node is yours</h2>
							<p>
								This confirms that whoever is requesting this change can edit
								<code>{form.node?.source_url ?? 'the page on file for this node'}</code>.
							</p>

							{#if !form.token}
								<p>
									Press below and we will generate a token for you to place on that page. It expires
									on its own in 24 hours.
								</p>
								<button
									type="button"
									class="btn btn-primary"
									disabled={form.pending !== 'idle'}
									onclick={() => form.requestToken()}
								>
									{form.pending === 'issuing' ? 'Generating…' : 'Generate my token'}
								</button>
							{:else}
								<p>Add this to the page's HTML, if it is not there already:</p>
								<pre class="verification-snippet"><code
										>&lt;meta name="indienode-verification" content="{form.token}" /&gt;</code
									></pre>
								<p class="note">You can remove it once you are verified.</p>

								{#if form.verified}
									<p class="verified" role="status">✓ Verified. That page is yours.</p>
								{:else}
									<button
										type="button"
										class="btn btn-primary"
										disabled={form.pending !== 'idle'}
										onclick={() => form.runVerify()}
									>
										{form.pending === 'verifying' ? 'Checking…' : 'Verify'}
									</button>
									{#if verifyMessage}
										<p class="inline-error" role="alert">{verifyMessage}</p>
									{/if}
								{/if}
							{/if}

							{#if form.error}
								<p class="inline-error" role="alert">
									{form.error.message}
									{#if form.error.retryable}
										<button type="button" class="clear-button" onclick={() => form.clearError()}>
											Try again
										</button>
									{/if}
								</p>
							{/if}

							{#if form.verified}
								<!-- Offered only after control is proven, and only here: a
								     withdrawal is the same claim a correction makes, so it
								     belongs at the moment that claim has just been accepted
								     rather than as a link someone can find cold. -->
								<p class="leave-line">
									Would rather not be listed at all?
									<button
										type="button"
										class="link-button"
										onclick={() => form.setIntent('remove')}
									>
										Remove this entry from the ring
									</button>
								</p>
							{/if}

							<div class="actions">
								<button type="button" class="btn btn-ghost" onclick={back}>Back</button>
								<button type="button" class="btn btn-primary" disabled={!canAdvance} onclick={next}>
									Continue
								</button>
							</div>
						{:else if form.step === 'remove'}
							<h2 tabindex="-1" use:focusHeading>Remove this entry</h2>

							<p>
								This takes <strong>{form.node?.creator ?? 'your entry'}</strong> out of the ring.
								Your site is untouched — only the listing here goes. Nothing about you is kept
								afterwards, which is also why nobody can restore it for you later: rejoining means
								going through <a href={resolve('/join')}>the join form</a> again, which is short.
							</p>

							<FormField
								id="f-removal-reason"
								label="Anything you want to say about why (optional)"
								hint="Entirely up to you. It goes to whoever reviews this and nowhere else, and it changes nothing about whether the removal happens."
							>
								{#snippet children(describedBy)}
									<textarea
										id="f-removal-reason"
										class="control"
										rows="3"
										bind:value={form.removalReason}
										aria-describedby={describedBy}></textarea>
								{/snippet}
							</FormField>

							<label class="option confirm-removal">
								<input type="checkbox" bind:checked={form.removalConfirmed} />
								<span class="option-label"
									>I want this entry removed from the ring, and I understand it is not reversible.</span
								>
							</label>

							{#if form.error}
								<p class="inline-error" role="alert">
									{form.error.message}
									{#if form.error.retryable}
										<button type="button" class="clear-button" onclick={() => form.clearError()}>
											Try again
										</button>
									{/if}
								</p>
							{/if}

							<Honeypot bind:value={form.honeypot} />
							<Turnstile bind:token={turnstileToken} />

							<div class="actions">
								<button
									type="button"
									class="btn btn-ghost"
									onclick={() => form.setIntent('change')}
								>
									Change it instead
								</button>
								<button
									type="button"
									class="btn btn-danger"
									disabled={!form.removalConfirmed || form.pending !== 'idle'}
									onclick={() => form.sendRemoval(turnstileToken)}
								>
									{form.pending === 'submitting' ? 'Removing…' : 'Remove my entry'}
								</button>
							</div>
						{:else if form.step === 'edit'}
							<h2 tabindex="-1" use:focusHeading>What's changing?</h2>

							{#if !entry.type}
								<p class="note">
									This node wasn't found in the local copy of the ring, so type-specific fields
									(tracks, pages, and so on) aren't available here. The fields below still send —
									the review team can help with anything else.
								</p>
							{/if}

							<p class="hint-inline">
								{entry.creator || 'Creator'} · {entry.type || 'type unknown'} — neither is editable here;
								they identify the node rather than describe the change.
							</p>

							<FormField
								id="f-why"
								label="Why is this worth someone's time?"
								hint="One line, in your own voice."
								required
								error={form.entryErrors.why}
							>
								{#snippet children(describedBy)}
									<input
										id="f-why"
										class="control"
										type="text"
										maxlength={WHY_MAX_LENGTH}
										bind:value={entry.why}
										oninput={() => form.touch()}
										aria-describedby={describedBy}
										aria-invalid={Boolean(form.entryErrors.why)}
									/>
								{/snippet}
							</FormField>
							<p class="counter" class:over={entry.why.length > WHY_MAX_LENGTH}>
								{entry.why.length} / {WHY_MAX_LENGTH}
							</p>

							<FormField
								id="f-source"
								label="Where does this live?"
								hint={form.sourceUrlChanged
									? "Changed from what's on file — you'll re-confirm this on the review step."
									: 'The page people are sent to.'}
								required
								error={form.entryErrors.source_url}
							>
								{#snippet children(describedBy)}
									<input
										id="f-source"
										class="control"
										type="url"
										inputmode="url"
										placeholder="https://"
										bind:value={entry.source_url}
										oninput={() => form.touch()}
										aria-describedby={describedBy}
										aria-invalid={Boolean(form.entryErrors.source_url)}
									/>
								{/snippet}
							</FormField>

							<FormField
								id="f-tags"
								label="Tags"
								hint="At least one. Enter or comma to add."
								required
								error={form.entryErrors.tags}
							>
								{#snippet children(describedBy)}
									<input
										id="f-tags"
										class="control"
										type="text"
										autocomplete="off"
										bind:value={tagDraft}
										onkeydown={onTagKeydown}
										onblur={commitTag}
										aria-describedby={describedBy}
										aria-invalid={Boolean(form.entryErrors.tags)}
									/>
								{/snippet}
							</FormField>

							{#if entry.tags.length}
								<ul class="tag-list">
									{#each entry.tags as tag (tag)}
										<li>
											<button type="button" class="chip checked" onclick={() => toggleTag(tag)}>
												{tag}
												<span aria-hidden="true">×</span>
												<span class="sr-only">Remove tag</span>
											</button>
										</li>
									{/each}
								</ul>
							{/if}

							<label class="option">
								<input
									type="checkbox"
									bind:checked={entry.explicit}
									onchange={() => form.touch()}
								/>
								<span>
									<span class="option-label">This entry is exclusively explicit / NSFW content</span
									>
								</span>
							</label>

							{#if entry.type === 'audio'}
								<FormField
									id="f-form"
									label="Music or spoken?"
									hint="Queues never mix the two, so this has to be declared rather than left to tags."
									required
									error={form.entryErrors.form}
								>
									{#snippet children(describedBy)}
										<select
											id="f-form"
											class="control"
											bind:value={entry.form}
											onchange={() => form.touch()}
											aria-describedby={describedBy}
											aria-invalid={Boolean(form.entryErrors.form)}
										>
											<option value="" disabled>Choose one</option>
											{#each FORM_OPTIONS as opt (opt)}
												<option value={opt}>{FORM_LABELS[opt]}</option>
											{/each}
										</select>
									{/snippet}
								</FormField>

								<h3>Tracks</h3>
								<p class="note">Up to {MAX_TRACKS}. Each link must point at a direct audio file.</p>
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
										<button
											type="button"
											class="clear-button"
											onclick={() => removeTrack(track.uid)}
										>
											Remove track {i + 1}
										</button>
									</div>
								{/each}
								{#if entry.tracks.length < MAX_TRACKS}
									<button type="button" class="btn btn-ghost" onclick={addTrack}>Add a track</button
									>
								{/if}
							{/if}

							{#if entry.type === 'comic'}
								<h3>Pages</h3>
								<p class="note">Up to {MAX_PAGES}.</p>
								{#each entry.pages as pageRow, i (pageRow.uid)}
									<div class="repeat-row" use:scrollNewRowIntoView={pageRow.uid}>
										<FormField
											id="f-page-image-{pageRow.uid}"
											label="Page {i + 1} image"
											error={form.entryErrors[`pages.${i}.image_url`]}
										>
											{#snippet children(describedBy)}
												<input
													id="f-page-image-{pageRow.uid}"
													class="control"
													type="url"
													placeholder="https://"
													bind:value={pageRow.image_url}
													oninput={() => form.touch()}
													aria-describedby={describedBy}
													aria-invalid={Boolean(form.entryErrors[`pages.${i}.image_url`])}
												/>
											{/snippet}
										</FormField>
										<FormField id="f-page-caption-{pageRow.uid}" label="Caption (optional)">
											{#snippet children(describedBy)}
												<input
													id="f-page-caption-{pageRow.uid}"
													class="control"
													type="text"
													bind:value={pageRow.caption}
													oninput={() => form.touch()}
													aria-describedby={describedBy}
												/>
											{/snippet}
										</FormField>
										<button
											type="button"
											class="clear-button"
											onclick={() => removePage(pageRow.uid)}
										>
											Remove page {i + 1}
										</button>
									</div>
								{/each}
								{#if entry.pages.length < MAX_PAGES}
									<button type="button" class="btn btn-ghost" onclick={addPage}>Add a page</button>
								{/if}
							{/if}

							{#if entry.type === 'art'}
								<h3>Artworks</h3>
								<p class="note">
									One to {MAX_ARTWORKS} works. The first is the fallback cover when no separate cover
									is supplied.
								</p>
								{#if form.entryErrors.artworks}
									<p class="inline-error" role="alert">{form.entryErrors.artworks}</p>
								{/if}
								{#each entry.artworks as artwork, i (artwork.uid)}
									<div class="repeat-row" use:scrollNewRowIntoView={artwork.uid}>
										<FormField
											id="f-art-image-{artwork.uid}"
											label="Artwork {i + 1} image"
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
										<button
											type="button"
											class="clear-button"
											onclick={() => removeArtwork(artwork.uid)}
										>
											Remove artwork {i + 1}
										</button>
									</div>
								{/each}
								{#if entry.artworks.length < MAX_ARTWORKS}
									<button type="button" class="btn btn-ghost" onclick={addArtwork}
										>Add artwork</button
									>
								{/if}
							{/if}

							{#if entry.type === 'text'}
								{#each entry.excerpts as sample, i (sample.uid)}
									<div class="repeat-row" use:scrollNewRowIntoView={sample.uid}>
										<FormField
											id={`f-excerpt-title-${sample.uid}`}
											label={`Sample ${i + 1} title (optional)`}
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
											required={i === 0}
											error={i === 0 ? form.entryErrors.excerpts : undefined}
										>
											<!-- Tipex has no `id`/`aria-describedby` prop to receive
											     FormField's usual wiring (it renders its own
											     contenteditable region, not a single input this
											     component can address), so the label/error above
											     stay visible but aren't programmatically tied to
											     it the way every other control in this form is. -->
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
											<button
												type="button"
												class="clear-button"
												onclick={() => removeExcerpt(sample.uid)}
											>
												Remove sample {i + 1}
											</button>
										{/if}
									</div>
								{/each}
								{#if entry.excerpts.length < MAX_EXCERPTS}
									<button type="button" class="btn btn-ghost" onclick={addExcerpt}
										>Add a sample</button
									>
								{/if}
							{/if}

							{#if entry.type}
								<FormField
									id="f-thumb"
									label={entry.type === 'game' ? 'Cover image / screenshot' : 'Cover image'}
									required={entry.type === 'game'}
									error={form.entryErrors.thumb_url}
								>
									{#snippet children(describedBy)}
										<input
											id="f-thumb"
											class="control"
											type="url"
											placeholder="https://"
											bind:value={entry.thumb_url}
											oninput={() => form.touch()}
											aria-describedby={describedBy}
											aria-invalid={Boolean(form.entryErrors.thumb_url)}
										/>
									{/snippet}
								</FormField>
							{/if}

							{#if entry.thumb_url?.trim() && (entry.type === 'audio' || entry.type === 'game' || entry.type === 'art')}
								<CoverPositionControls
									position={entry.thumb_position}
									onChange={(position) => {
										entry.thumb_position = position;
										form.touch();
									}}
								/>
							{/if}

							{#if entry.type}
								<div class="node-preview-stage">
									<div
										class="node-preview-card"
										inert
										style:height="100%"
										style:aspect-ratio={`${previewSize.w} / ${previewSize.h}`}
									>
										<FieldNode
											entry={previewEntry}
											aspect={`${previewSize.w} / ${previewSize.h}`}
											motionReducedOverride={true}
										/>
									</div>
								</div>
							{/if}

							{#if entry.type === 'game'}
								<FormField
									id="f-preview"
									label="Preview link (optional)"
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

							{#if form.hasNewWork}
								<div class="explicit-panel">
									<label class="option">
										<input
											type="checkbox"
											bind:checked={form.rightsReaffirmed}
											onchange={() => form.touch()}
										/>
										<span>
											<span class="option-label">Rights, for what you just added</span>
											<span class="option-description">
												I confirm I hold full rights to the track(s), page(s), or artwork added or
												changed above, including that no third party holds a claim requiring
												separate compensation for its use here.
											</span>
										</span>
									</label>
								</div>
							{/if}

							<div class="actions">
								<button type="button" class="btn btn-ghost" onclick={back}>Back</button>
								<button type="button" class="btn btn-primary" disabled={!canAdvance} onclick={next}>
									Continue
								</button>
							</div>
						{:else}
							<h2 tabindex="-1" use:focusHeading>Review and send</h2>
							<p>
								This replaces the node's current entry once approved. Nothing is public until then.
							</p>

							<dl class="review">
								<dt>Node id</dt>
								<dd>{form.nodeId}</dd>
								<dt>Why</dt>
								<dd>{entry.why}</dd>
								<dt>Links to</dt>
								<dd class="wrap">
									{entry.source_url}
									{#if form.sourceUrlChanged}<span class="note-inline">(changed)</span>{/if}
								</dd>
								<dt>Tags</dt>
								<dd>{entry.tags.join(', ')}</dd>
							</dl>

							<ExactDataDisclosure value={form.preview} />

							<FormField
								id="f-email"
								label="Your email"
								hint="Used once, to tell you what happened to this request, then deleted."
								required
								error={form.emailError && form.email.trim() ? form.emailError : ''}
							>
								{#snippet children(describedBy)}
									<input
										id="f-email"
										class="control"
										type="email"
										autocomplete="email"
										bind:value={form.email}
										oninput={() => form.touch()}
										aria-describedby={describedBy}
									/>
								{/snippet}
							</FormField>

							<Honeypot bind:value={form.honeypot} />
							<Turnstile bind:this={turnstileEl} bind:token={turnstileToken} />

							{#if form.error}
								<p class="inline-error" role="alert">
									{form.error.message}
									{#if form.error.retryable}
										<button type="button" class="clear-button" onclick={() => form.clearError()}>
											Try again
										</button>
									{/if}
								</p>
							{/if}

							<div class="actions">
								<button type="button" class="btn btn-ghost" onclick={back}>Back</button>
								<button
									type="button"
									class="btn btn-primary"
									disabled={form.pending !== 'idle' || Boolean(form.emailError)}
									onclick={onSend}
								>
									{form.pending === 'submitting' ? 'Sending…' : 'Send request'}
								</button>
							</div>
						{/if}
					</div>
				{/key}
			</div>
		</div>

		<p class="footnote">
			Not what you're looking for? <a href={resolve('/join')}>Join the ring</a> instead.
		</p>
	{/if}
</div>

<style>
	.join-page {
		max-width: 72rem;
		margin: 0 auto;
		padding: 0 2rem 2rem;
		display: flex;
		flex-direction: column;
	}

	.page-title {
		flex-shrink: 0;
		margin: 1rem 0 0.9rem;
		font-size: var(--text-lg);
	}

	.interim-note {
		flex-shrink: 0;
		max-width: 60ch;
		margin-bottom: 0.9rem;
		padding: 0.7rem 1rem;
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
	}

	.interim-note p {
		margin: 0;
		font-size: var(--text-xs);
	}

	:global(.done-panel) {
		max-width: 60ch;
		margin: 1.4rem 0;
		padding: 2.2rem 2rem;
	}

	:global(.done-panel > p),
	:global(.done-panel > button) {
		margin-top: 1.2rem;
	}

	.reference-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
		text-align: center;
	}

	.reference-label {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}

	.reference-code {
		font-size: var(--text-lg);
		font-weight: 700;
		letter-spacing: 0.02em;
	}

	.submit-again-button {
		display: block;
		margin-inline: auto;
	}

	.join-layout {
		display: flex;
		flex-direction: column;
		gap: 1.75rem;
	}

	.panel {
		min-width: 0;
		position: relative;
	}

	.step-body {
		overflow-y: auto;
	}

	.step-body h2:focus-visible {
		outline-offset: 4px;
	}

	.panel h2 {
		margin-bottom: 0.8rem;
	}

	.panel h3 {
		margin: 2rem 0 0.6rem;
	}

	.panel p {
		max-width: 62ch;
		margin-bottom: 1.2rem;
	}

	.note {
		max-width: 62ch;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.verification-snippet {
		box-sizing: border-box;
		width: min(100%, 62ch);
		max-width: 100%;
		overflow-x: auto;
		margin: 0 0 1.2rem;
		padding: 0.9rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
		font-size: var(--text-sm);
		line-height: 1.5;
	}

	.note-inline {
		color: var(--text-faint);
		font-size: var(--text-xs);
	}

	.hint-inline {
		margin-bottom: 1.2rem;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.counter {
		margin-top: -1.4rem;
		margin-bottom: 1.8rem !important;
		color: var(--text-faint);
		font-size: var(--text-xs);
		text-align: right;
		max-width: 100%;
	}

	.counter.over {
		color: #e0455f;
	}

	.tag-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
		margin: 0 0 1.6rem;
		padding: 0;
		list-style: none;
	}

	.explicit-panel {
		margin: 1rem 0 2rem;
		max-width: 62ch;
		padding: 1.1rem 1.3rem;
		border: 1px solid rgb(234 179 8 / 0.5);
		border-radius: var(--radius-sm);
		background: rgb(234 179 8 / 0.1);
	}

	.explicit-panel .option {
		margin: 0;
	}

	.repeat-row {
		max-width: 62ch;
		margin-bottom: 1.6rem;
		padding: 1.2rem 1.2rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.inline-error {
		max-width: 62ch;
		color: #e0455f;
		font-size: var(--text-sm);
	}

	.verified {
		color: var(--type-game);
		font-weight: 600;
	}

	.review {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.6rem 1.4rem;
		max-width: 62ch;
		margin-bottom: 2rem;
	}

	.review dt {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.review dd {
		margin: 0;
	}

	.review dd.wrap {
		overflow-wrap: anywhere;
	}

	/* Pinned to the bottom of the scrolling step so Back and Continue are
	   always reachable, rather than sitting at the end of content the reader
	   has to get to first. Sticky rather than fixed: it stays inside the
	   panel's own column, so it neither spans the viewport on desktop nor
	   needs to know about the mobile bottom bar.

	   The padding and background are load-bearing, not decoration — content
	   scrolls underneath this, and without an opaque ground the two would
	   overlap illegibly. */
	.actions {
		position: sticky;
		bottom: 0;
		z-index: 2;
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin-top: 2.4rem;
		padding: 0.9rem 1rem 0.9rem;
		background: var(--bg);
	}

	/* Only while something is actually hidden below (see scrollAffordance.js):
	   a hairline to say the bar is covering content rather than ending it,
	   and a short fade above it so the covered content visibly passes under
	   rather than being cut. On the last screenful both disappear, which is
	   how the bar stops claiming there is more. */
	.step-body:global(.has-overflow):not(:global(.at-bottom)) .actions {
		box-shadow: 0 -1px 0 var(--border);
	}

	.step-body:global(.has-overflow):not(:global(.at-bottom)) .actions::before {
		content: '';
		position: absolute;
		inset: auto 0 100% 0;
		height: 1.4rem;
		background: linear-gradient(to top, var(--bg), transparent);
		pointer-events: none;
	}

	@media (prefers-reduced-motion: no-preference) {
		.actions {
			transition: box-shadow 160ms ease;
		}
	}

	.footnote {
		margin-top: 2rem;
		padding-top: 1.2rem;
		border-top: 1px solid var(--border);
		color: var(--text-muted);
		font-size: var(--text-sm);
		text-align: center;
	}

	.footnote a {
		color: var(--accent);
	}

	@media (max-width: 60rem) {
		.join-page {
			padding: 2rem 1.2rem 4rem;
		}

		.join-layout {
			gap: 1.4rem;
		}
	}

	.match-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin: 0.6rem 0 0;
		padding: 0;
		list-style: none;
	}

	.match-list button {
		display: flex;
		width: 100%;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.match-list button:hover,
	.match-list button:focus-visible {
		border-color: var(--accent);
	}

	.match-list span {
		color: var(--text-muted);
		font-size: var(--text-xs);
		overflow-wrap: anywhere;
	}

	/* Quiet, and only after verification: leaving is a real option, not a
	   thing to advertise to someone who came to fix a typo. */
	.leave-line {
		margin-top: 1.2rem;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.link-button {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}

	.confirm-removal {
		margin: 1.2rem 0;
		padding: 0.9rem 1rem;
		border: 1px solid color-mix(in oklch, #e0455f 45%, var(--border));
		border-radius: var(--radius-sm);
		background: color-mix(in oklch, #e0455f 6%, transparent);
	}

	.btn-danger {
		border: 1px solid color-mix(in oklch, #e0455f 55%, var(--border));
		background: #e0455f;
		color: white;
	}

	.btn-danger:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	@media (max-width: 40rem) {
		.join-page {
			--text-xs: 0.95rem;
			--text-sm: 1.15rem;
			--text-base: 1.4rem;
			--text-lg: 1.6rem;
			--text-xl: 1.8rem;
			--text-2xl: 2.2rem;
			padding-inline: 0.5rem;
			font-size: var(--text-base);
		}
	}

	/* Same card JoinEntryStep.svelte's own live preview uses, ported rather
	   than reinvented so the two forms' preview looks and behaves alike. */
	.node-preview-stage {
		display: grid;
		place-items: center;
		height: clamp(12rem, 32vh, 20rem);
		min-height: 0;
		padding: 1.2rem;
		margin-block: 0.5rem;
		border-radius: var(--radius-sm);
		background:
			radial-gradient(
				circle at 20% 20%,
				color-mix(in oklch, var(--accent) 16%, transparent),
				transparent 36%
			),
			var(--bg);
		overflow: hidden;
	}
	.node-preview-card {
		width: auto;
		max-width: 20rem;
		max-height: 100%;
	}
	.node-preview-card :global(.node) {
		height: 100%;
	}
</style>
