<script>
	/**
	 * Both adult-content questions, and the one definition that governs them.
	 *
	 * They are genuinely different questions: `explicit` is about the works
	 * featured on this Node, the disclosure is about the site a visitor is sent
	 * to. Asked a step apart they read as the same question twice; asked inside
	 * one panel the required one reads as optional, because the checkbox beside
	 * it is not. So: one section, one shared definition of what counts as adult
	 * content, and two panels that look like the different things they are.
	 *
	 * Used by /join's entry step and /update's edit step, which is also how the
	 * definition reached /update at all: it used to exist only on /join.
	 *
	 * @typedef {{
	 *   explicit?: boolean,
	 *   adultContent?: '' | 'yes' | 'no',
	 *   adultContentConfirmation?: boolean,
	 *   missing?: Record<string, string>,
	 *   idPrefix?: string,
	 *   onchange?: () => void
	 * }} Props
	 */

	/** @type {Props} */
	let {
		explicit = $bindable(false),
		adultContent = $bindable(''),
		adultContentConfirmation = $bindable(false),
		missing = {},
		idPrefix = 'adult',
		onchange
	} = $props();

	const stillNeeded = $derived(
		[missing.adult_content, missing.adult_content_confirmation].filter(Boolean)
	);

	/** @param {'yes' | 'no'} value */
	function choose(value) {
		adultContent = value;
		if (value !== 'yes') adultContentConfirmation = false;
		onchange?.();
	}
</script>

<section class="adult-section" aria-labelledby="{idPrefix}-adult-heading">
	<h3 id="{idPrefix}-adult-heading">Adult content</h3>
	<p class="section-lead">What counts as adult content here, for both questions below:</p>

	<div class="examples">
		<div>
			<p class="examples-title">Adult content</p>
			<ul>
				<li>Explicit sexual content or nudity</li>
				<li>Graphic violence, gore, or fetish content</li>
				<li>Substance use depicted explicitly as a central theme</li>
				<li>Explicit language throughout, not occasional</li>
			</ul>
		</div>
		<div>
			<p class="examples-title">Not adult content</p>
			<ul>
				<li>Occasional strong language</li>
				<li>Suggestive humor or romance without explicit depiction</li>
				<li>Violence typical of an M-rated game or a thriller novel</li>
				<li>Dark or mature themes handled without graphic depiction</li>
			</ul>
		</div>
	</div>

	<div class="panel works-panel">
		<label class="option">
			<input type="checkbox" bind:checked={explicit} onchange={() => onchange?.()} />
			<span>
				<span class="option-label">This Node features adult content</span>
				<span class="option-description">
					Tick this if any work you feature here is adult content. Explicit Nodes are hidden from
					the field, Members, Lists, and the widget until a visitor turns explicit content on in
					Settings.
				</span>
			</span>
		</label>
	</div>

	<div
		class="panel site-panel"
		class:has-error={stillNeeded.length > 0}
		role="group"
		aria-labelledby="{idPrefix}-site-question"
	>
		<p class="site-question" id="{idPrefix}-site-question">
			Does your website include adult content?
			<span class="required" aria-hidden="true">*</span>
			<span class="sr-only">(required)</span>
		</p>
		<p class="option-description">
			About the site a visitor is sent to, not the works you feature above. Answer this either way.
		</p>
		<div class="option-row">
			<label class="option">
				<input
					type="radio"
					name="{idPrefix}-adult-content"
					value="yes"
					checked={adultContent === 'yes'}
					onchange={() => choose('yes')}
				/>
				<span class="option-label">Yes</span>
			</label>
			<label class="option">
				<input
					type="radio"
					name="{idPrefix}-adult-content"
					value="no"
					checked={adultContent === 'no'}
					onchange={() => choose('no')}
				/>
				<span class="option-label">No</span>
			</label>
		</div>

		{#if adultContent === 'yes'}
			<label class="option site-confirmation">
				<input
					type="checkbox"
					bind:checked={adultContentConfirmation}
					onchange={() => onchange?.()}
				/>
				<span class="option-description">
					I confirm that adult content on my website sits behind a clear content warning, and that I
					have marked this Node as explicit if any work I feature is adult content.
				</span>
			</label>
		{/if}

		{#if stillNeeded.length}
			<ul class="still-needed" role="status">
				{#each stillNeeded as message (message)}
					<li>{message}</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

<style>
	.adult-section {
		margin: 1rem 0 2rem;
		max-width: 62ch;
	}

	.adult-section h3 {
		margin: 0 0 0.3rem;
	}

	.section-lead {
		margin: 0 0 0.8rem;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.examples {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem 1.5rem;
		margin-bottom: 1.2rem;
	}

	.examples-title {
		margin: 0 0 0.4rem;
		color: var(--text);
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.examples ul {
		margin: 0;
		padding-left: 1.1rem;
		list-style: disc;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		color: var(--text-muted);
		font-size: var(--text-xs);
	}

	.panel {
		margin: 0 0 1rem;
		padding: 1.1rem 1.3rem;
		border-radius: var(--radius-sm);
	}

	/* The optional one keeps the caution treatment it has always had: ticking
	   it changes who sees the Node. */
	.works-panel {
		border: 1px solid rgb(234 179 8 / 0.5);
		background: rgb(234 179 8 / 0.1);
	}

	.works-panel .option {
		margin: 0;
	}

	/* Deliberately not the same surface: a required question inside the same
	   container as an optional checkbox reads as optional too. */
	.site-panel {
		border: 1px solid var(--border);
		background: var(--bg-elevated);
	}

	.site-panel.has-error {
		border-color: var(--accent);
	}

	.site-question {
		margin: 0 0 0.4rem;
		font-weight: 600;
	}

	.required {
		color: var(--accent);
	}

	.option-row {
		display: flex;
		flex-wrap: wrap;
		gap: 1.4rem;
		margin-top: 0.8rem;
	}

	.site-confirmation {
		margin-top: 1rem;
	}

	.still-needed {
		margin: 0.8rem 0 0;
		padding-left: 1.2rem;
		color: var(--accent);
		font-size: var(--text-sm);
	}

	@media (max-width: 32rem) {
		.examples {
			grid-template-columns: 1fr;
		}
	}
</style>
