<script>
	/**
	 * The entry step of `/join`: who the creator is, what kind of work this is,
	 * and the one line explaining why it is worth someone's time.
	 *
	 * Owns tag entry, which is the only genuinely interactive part: a free-text
	 * field that commits on Enter or comma, with suggestions drawn from what
	 * the ring already uses.
	 *
	 * Reads the submission store directly, like the other steps — it is a step
	 * of one specific form, not a reusable widget. The route passes only where
	 * this sits in the walk.
	 *
	 * @type {{ canAdvance: boolean, onBack: () => void, onNext: () => void }}
	 */
	let { canAdvance, onBack, onNext } = $props();

	import FormField from '../../components/FormField.svelte';
	import FieldNode from '../../components/FieldNode.svelte';
	import CoverPositionControls from '../../components/CoverPositionControls.svelte';
	import { submissionStore as form } from '$lib/submissionStore.svelte.js';
	import { ringStore } from '$lib/ringStore.svelte.js';
	import { generatorDraftStore } from '$lib/generator/generatorDraftStore.svelte.js';
	import { ACCEPTED_IMAGE_TYPES, rejectionReason } from '$lib/generator/assets.js';
	import { focusHeading } from '$lib/formRowFocus.svelte.js';
	import {
		ENTRY_TYPES,
		ENTRY_TYPE_LABELS,
		FORM_OPTIONS,
		FORM_LABELS,
		WHY_MAX_LENGTH
	} from '$lib/submissionValidation.js';
	import { ALLOWED_RATIOS, MIN_W, snapToAllowedShape } from '$lib/nodeShape.js';

	const entry = $derived(form.entry);
	const generator = $derived(generatorDraftStore.generator);
	let localCoverUrl = $state('');

	$effect(() => {
		const cover = generator.icon;
		if (!cover) {
			localCoverUrl = '';
			return;
		}

		const url = URL.createObjectURL(cover);
		localCoverUrl = url;
		return () => URL.revokeObjectURL(url);
	});

	/** Whatever the ring already uses, minus what this entry has taken. */
	const suggestedTags = $derived(
		[...new Set(ringStore.entries.flatMap((e) => e.tags ?? []))]
			.filter((t) => !entry.tags.includes(t))
			.sort()
			.slice(0, 14)
	);

	let tagDraft = $state('');
	let previewWidth = $state(8);
	let previewRatio = $state('1:1');
	const previewType = $derived(
		/** @type {'audio' | 'comic' | 'text' | 'game' | 'art'} */ (entry.type || 'audio')
	);
	const previewRatios = $derived(entry.type ? ALLOWED_RATIOS[previewType] : []);
	$effect(() => {
		entry.type;
		previewWidth = 8;
		previewRatio = '1:1';
	});
	const previewSize = $derived.by(() => {
		if (!entry.type) return { w: 8, h: 8 };
		const ratio = previewRatios.find(([w, h]) => `${w}:${h}` === previewRatio) ??
			previewRatios[0] ?? [1, 1];
		return snapToAllowedShape(
			previewType,
			previewWidth,
			Math.round((previewWidth * ratio[1]) / ratio[0])
		);
	});
	const previewForm = $derived(
		/** @type {'music' | 'spoken' | undefined} */ (
			entry.form === 'music' || entry.form === 'spoken' ? entry.form : undefined
		)
	);
	const previewEntry = $derived({
		id: 'join-preview',
		creator: entry.creator?.trim() || 'Your name',
		type: previewType,
		form: previewType === 'audio' ? previewForm : undefined,
		why: entry.why?.trim() || 'Your one-line introduction will appear here.',
		thumb_url: entry.has_own_site === 'no' ? localCoverUrl : entry.thumb_url?.trim() || '',
		thumb_position: entry.thumb_position ?? { x: 50, y: 50 },
		source_url: entry.source_url || '#',
		tags: entry.tags ?? [],
		tracks: [],
		pages: [],
		excerpts: [],
		verification_token: 'preview'
	});
	/** @param {number} w @param {number} h */
	function ratioLabel(w, h) {
		if (w === h) return 'Square';
		if (w < h) return w / h < 0.65 ? 'Tall' : 'Portrait';
		return w / h >= 1.75 ? 'Wide' : 'Landscape';
	}

	function commitTag() {
		const value = tagDraft.trim().toLowerCase();
		if (value && !entry.tags.includes(value)) {
			entry.tags = [...entry.tags, value];
			form.touch();
		}
		tagDraft = '';
	}

	let coverError = $state('');

	/**
	 * `accept` on the input is a filter in the picker dialog, not a rule: it is
	 * bypassed by drag-and-drop and by choosing "All files". `toWebp` would
	 * reject an undecodable file later anyway, but as a thrown error rather
	 * than as something the creator can read, so the check happens here.
	 * @param {Event} event
	 */
	function updateCoverFile(event) {
		const input = /** @type {HTMLInputElement} */ (event.currentTarget);
		const file = input.files?.[0] ?? null;
		coverError = file ? (rejectionReason(file, 'image') ?? '') : '';
		if (coverError) {
			input.value = '';
			generatorDraftStore.saveNow({ generator: { icon: null } });
			return;
		}
		generatorDraftStore.saveNow({ generator: { icon: file } });
	}

	/**
	 * Puts the cover back to having none. The cover is optional, so "I picked
	 * the wrong image and want none at all" is a real end state and not just a
	 * step on the way to picking another — choosing a different file already
	 * covers that case.
	 *
	 * Clears the input's own `value` as well, since the native control would
	 * otherwise keep showing the discarded filename next to a hint saying no
	 * cover is set.
	 */
	function clearCoverFile() {
		generatorDraftStore.saveNow({ generator: { icon: null } });
		const input = document.getElementById('f-cover-file');
		if (input instanceof HTMLInputElement) input.value = '';
	}

	/** @param {KeyboardEvent} event */
	function onTagKeydown(event) {
		// Comma as well as Enter: people type tag lists with commas, and
		// swallowing that is friendlier than adding "a, b, c" as one tag.
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			commitTag();
		} else if (event.key === 'Backspace' && !tagDraft && entry.tags.length) {
			entry.tags = entry.tags.slice(0, -1);
		}
	}
</script>

<h2 tabindex="-1" use:focusHeading>Your entry</h2>
<p>
	This is what people see on your card in the ring. Your node represents YOU as a creator, not one
	particular work.
</p>

<div class="entry-builder">
	<section class="entry-settings" aria-label="Entry settings">
		<FormField id="f-creator" label="Your name or studio" required error={form.entryErrors.creator}>
			{#snippet children(describedBy)}
				<input
					id="f-creator"
					class="control"
					type="text"
					autocomplete="off"
					bind:value={entry.creator}
					oninput={() => form.touch()}
					aria-describedby={describedBy}
					aria-invalid={Boolean(form.entryErrors.creator)}
				/>
			{/snippet}
		</FormField>

		<FormField
			id="f-type"
			label="What kind of work is this?"
			required
			error={form.entryErrors.type}
		>
			{#snippet children(describedBy)}
				<select
					id="f-type"
					class="control"
					bind:value={entry.type}
					onchange={() => form.touch()}
					aria-describedby={describedBy}
					aria-invalid={Boolean(form.entryErrors.type)}
				>
					<option value="" disabled>Choose one</option>
					{#each ENTRY_TYPES as type (type)}
						<option value={type}>{ENTRY_TYPE_LABELS[type]}</option>
					{/each}
				</select>
			{/snippet}
		</FormField>

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
		{/if}

		<FormField
			id="f-why"
			label="Why is this worth someone's time?"
			hint="One line, in your own voice. A node here is you, not one release — this is your introduction and your pitch combined, so it does more work than anything else on the card."
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

		{#if entry.has_own_site === 'yes'}
			<FormField
				id="f-source"
				label="Where does this live?"
				hint="The page you want visitors sent to, and the page you will prove you control in a moment."
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
						oninput={() => form.sourceUrlChanged()}
						aria-describedby={describedBy}
						aria-invalid={Boolean(form.entryErrors.source_url)}
					/>
				{/snippet}
			</FormField>
		{/if}

		{#if entry.has_own_site !== 'no'}
			<FormField
				id="f-thumb"
				label={entry.type === 'game' ? 'Node cover or screenshot' : 'Node cover'}
				hint={entry.type === 'game'
					? 'Required for games. It can be a portrait, logo, artwork, recent cover art, or a screenshot; it represents you as a creator, not just this work.'
					: 'Optional but encouraged. It does not have to be a portrait: use a logo, artwork, or cover art from a recent work. The node still represents you as a creator, not that single release.'}
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
		{:else}
			<FormField
				id="f-cover-file"
				label="Node cover (optional)"
				hint={generator.icon
					? generator.icon.name
					: 'It does not have to be a portrait: use a logo, artwork, or cover art from a recent work. Your node represents you as a creator, not that single work.'}
			>
				{#snippet children(describedBy)}
					<div class="file-row">
						<input
							id="f-cover-file"
							class="control"
							type="file"
							accept={ACCEPTED_IMAGE_TYPES.join(',')}
							onchange={updateCoverFile}
							aria-describedby={describedBy}
						/>
						{#if generator.icon}
							<button type="button" class="clear-button" onclick={clearCoverFile}>
								Clear cover
							</button>
						{/if}
					</div>
					{#if coverError}
						<p class="error" role="alert">{coverError}</p>
					{/if}
				{/snippet}
			</FormField>
		{/if}

		{#if (entry.thumb_url?.trim() || generator.icon) && (entry.type === 'audio' || entry.type === 'game')}
			<CoverPositionControls
				position={entry.thumb_position}
				onChange={(position) => {
					entry.thumb_position = position;
					form.touch();
				}}
			/>
		{/if}

		<FormField
			id="f-tags"
			label="Tags"
			hint="At least one. Genre, medium, mood, whatever fits. Enter or comma to add."
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
						<button type="button" class="chip checked" onclick={() => form.toggleTag(tag)}>
							{tag}
							<span aria-hidden="true">×</span>
							<span class="sr-only">Remove tag</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if suggestedTags.length}
			<p class="hint-inline">Already used in the ring:</p>
			<ul class="tag-list">
				{#each suggestedTags as tag (tag)}
					<li>
						<button type="button" class="chip" onclick={() => form.toggleTag(tag)}>
							{tag}
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="explicit-panel">
			<label class="option">
				<input type="checkbox" bind:checked={entry.explicit} onchange={() => form.touch()} />
				<span>
					<span class="option-label">This entry is exclusively explicit / NSFW content</span>
					<span class="option-description">
						Not "contains some mature moments" — this is for a creator whose work here is adult
						content through and through. Checking it hides this entry from the field, Members, and
						Lists until a visitor explicitly turns explicit content on for themselves.
					</span>
				</span>
			</label>

			<div class="explicit-examples">
				<div>
					<p class="explicit-examples-title">Check this for</p>
					<ul>
						<li>Explicit sexual content or nudity</li>
						<li>Graphic violence, gore, or fetish content</li>
						<li>Substance use depicted explicitly as a central theme</li>
						<li>Explicit language throughout, not occasional</li>
					</ul>
				</div>
				<div>
					<p class="explicit-examples-title">Leave unchecked for</p>
					<ul>
						<li>Occasional strong language</li>
						<li>Suggestive humor or romance without explicit depiction</li>
						<li>Violence typical of an M-rated game or a thriller novel</li>
						<li>Dark or mature themes handled without graphic depiction</li>
					</ul>
				</div>
			</div>
		</div>
	</section>
	{#if entry.type}
		<section class="node-preview-panel" aria-labelledby="node-preview-title">
			<p class="preview-eyebrow">Live node preview</p>
			<h3 id="node-preview-title">This is how you enter the field</h3>
			<p class="preview-note">
				The real ring design, updating as you type and when you add a cover.
			</p>
			<div class="node-preview-controls">
				{#if previewRatios.length > 1}
					<fieldset>
						<legend>Shape</legend>
						<div class="preview-option-row">
							{#each previewRatios as ratio (`${ratio[0]}:${ratio[1]}`)}
								<label class:checked={previewRatio === `${ratio[0]}:${ratio[1]}`}>
									<input
										type="radio"
										name="preview-ratio"
										value={`${ratio[0]}:${ratio[1]}`}
										bind:group={previewRatio}
									/>
									{ratioLabel(ratio[0], ratio[1])}
								</label>
							{/each}
						</div>
					</fieldset>
				{:else}
					<p class="preview-note"><strong>Shape:</strong> Square, fixed for this type</p>
				{/if}
				<label class="size-control"
					><span>Size <strong>{previewSize.w} x {previewSize.h}</strong></span>
					<input type="range" min={MIN_W} max="16" bind:value={previewWidth} />
				</label>
			</div>
			<div class="node-preview-stage">
				<div
					class="node-preview-card"
					inert
					style:aspect-ratio={`${previewSize.w} / ${previewSize.h}`}
					style:height={`${Math.min(100, 48 + previewSize.w * 3.25)}%`}
				>
					<FieldNode
						entry={previewEntry}
						aspect={`${previewSize.w} / ${previewSize.h}`}
						motionReducedOverride={true}
					/>
				</div>
			</div>
		</section>
	{/if}
</div>

<div class="actions">
	<button type="button" class="btn btn-ghost" onclick={onBack}>Back</button>
	<button type="button" class="btn btn-primary" disabled={!canAdvance} onclick={onNext}>
		Continue
	</button>
</div>

<style>
	.entry-builder {
		display: grid;
		grid-template-columns: minmax(28rem, 1fr) minmax(24rem, 0.85fr);
		align-items: start;
		gap: 1.25rem;
		width: 100%;
	}
	.entry-settings {
		min-width: 0;
	}
	.node-preview-panel {
		position: sticky;
		top: 0;
		max-width: none;
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
		margin: 0;
		padding: 1.15rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: linear-gradient(145deg, var(--bg-elevated), var(--bg));
	}
	.preview-eyebrow {
		margin: 0 0 0.2rem;
		color: var(--accent);
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.node-preview-panel h3 {
		margin: 0 0 0.35rem;
		font-size: var(--text-base);
	}
	.preview-note {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.node-preview-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.9rem 1.5rem;
		margin: 1rem 0;
		padding: 0.85rem 0;
		border-block: 1px solid var(--border);
	}
	.node-preview-controls fieldset {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.node-preview-controls legend,
	.size-control span {
		display: block;
		margin-bottom: 0.4rem;
		color: var(--text-muted);
		font-size: var(--text-xs);
		font-weight: 700;
	}
	.preview-option-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.preview-option-row label {
		position: relative;
		padding: 0.35rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--text-muted);
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.preview-option-row label.checked {
		border-color: var(--accent);
		color: var(--accent);
	}
	.preview-option-row input {
		position: absolute;
		opacity: 0;
	}
	.size-control {
		min-width: min(14rem, 100%);
		flex: 1;
	}
	.size-control input {
		width: 100%;
		accent-color: var(--accent);
	}
	.node-preview-stage {
		display: grid;
		place-items: center;
		height: clamp(14rem, calc(100dvh - 29rem), 24rem);
		min-height: 0;
		padding: 1.2rem;
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
		max-width: 24rem;
		max-height: 100%;
		transition:
			height 180ms ease,
			aspect-ratio 180ms ease;
	}
	.node-preview-card :global(.node) {
		height: 100%;
	}

	.hint-inline {
		margin-bottom: 0.5rem !important;
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

	.explicit-examples {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem 1.5rem;
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid rgb(234 179 8 / 0.35);
	}

	.explicit-examples-title {
		margin: 0 0 0.4rem;
		color: var(--text);
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.explicit-examples ul {
		margin: 0;
		padding-left: 1.1rem;
		list-style: disc;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		color: var(--text-muted);
		font-size: var(--text-xs);
	}
	@media (max-width: 64rem) {
		.entry-builder {
			grid-template-columns: 1fr;
		}
		.node-preview-panel {
			position: relative;
			order: -1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.node-preview-card {
			transition: none;
		}
	}
	@media (max-width: 32rem) {
		.explicit-examples {
			grid-template-columns: 1fr;
		}
	}
</style>
