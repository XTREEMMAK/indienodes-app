<script>
	/**
	 * The content-rule attestations, shared by /join (consent step) and
	 * /update (review step) so an update cannot skip a check a new submission
	 * has to pass. Presentational only: each form keeps its own state and
	 * decides what the answers gate (see `validateAttestations` and
	 * `attestationsGiven` in submissionValidation.js).
	 *
	 * The adult-content question has no default. Its confirmation only exists
	 * after "Yes": switching back to "No" hides it and clears it, so a stale
	 * confirmation can never travel with a "No".
	 *
	 * @typedef {{
	 *   aiAttestation?: boolean,
	 *   rightsConfirmation?: boolean,
	 *   adultContent?: '' | 'yes' | 'no',
	 *   adultContentConfirmation?: boolean,
	 *   missing?: Record<string, string>,
	 *   showMusicProSentence?: boolean,
	 *   idPrefix?: string,
	 *   onchange?: () => void
	 * }} Props
	 */

	/** @type {Props} */
	let {
		aiAttestation = $bindable(false),
		rightsConfirmation = $bindable(false),
		adultContent = $bindable(''),
		adultContentConfirmation = $bindable(false),
		missing = {},
		showMusicProSentence = false,
		idPrefix = 'attest',
		onchange
	} = $props();

	const stillNeeded = $derived(Object.values(missing));

	/** @param {'yes' | 'no'} value */
	function chooseAdultContent(value) {
		adultContent = value;
		if (value !== 'yes') adultContentConfirmation = false;
		onchange?.();
	}
</script>

<div class="attestations">
	<h3>Content rules</h3>

	<label class="option attestation">
		<input type="checkbox" bind:checked={aiAttestation} onchange={() => onchange?.()} />
		<span class="option-description attestation-text">
			I confirm that the music, art, writing, voice performances, and game design in my featured
			works were made by people, as described in the content rules.
		</span>
	</label>

	<label class="option attestation">
		<input type="checkbox" bind:checked={rightsConfirmation} onchange={() => onchange?.()} />
		<span class="option-description attestation-text">
			I hold the rights to the works I am featuring. None of them are covers, uncleared samples, fan
			work using characters I do not own, or performances owned by a client.
			{#if showMusicProSentence}
				I understand that PRO membership does not prevent me from submitting, but I am disclosing it
				accurately above.
			{/if}
		</span>
	</label>

	<fieldset class="attestation adult-question">
		<legend>
			Does your website include adult content?
			<span class="required" aria-hidden="true">*</span>
			<span class="sr-only">(required)</span>
		</legend>
		<div class="option-row">
			<label class="option">
				<input
					type="radio"
					name={`${idPrefix}-adult-content`}
					value="yes"
					checked={adultContent === 'yes'}
					onchange={() => chooseAdultContent('yes')}
				/>
				<span class="option-label">Yes</span>
			</label>
			<label class="option">
				<input
					type="radio"
					name={`${idPrefix}-adult-content`}
					value="no"
					checked={adultContent === 'no'}
					onchange={() => chooseAdultContent('no')}
				/>
				<span class="option-label">No</span>
			</label>
		</div>

		{#if adultContent === 'yes'}
			<label class="option adult-confirmation">
				<input
					type="checkbox"
					bind:checked={adultContentConfirmation}
					onchange={() => onchange?.()}
				/>
				<span class="option-description attestation-text">
					I confirm that adult content on my website sits behind a clear content warning, and that I
					have marked this Node as explicit if any work I feature is adult content.
				</span>
			</label>
		{/if}
	</fieldset>

	{#if stillNeeded.length}
		<div class="still-needed" role="status">
			<p>Before you can continue:</p>
			<ul>
				{#each stillNeeded as message (message)}
					<li>{message}</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

<style>
	.attestations {
		max-width: 66ch;
		margin-bottom: 1.6rem;
	}

	.attestation {
		margin: 0 0 1rem;
		padding: 1rem 1.2rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
	}

	.attestation-text {
		font-size: var(--text-sm);
		line-height: 1.55;
	}

	.adult-question legend {
		padding: 0 0.3rem;
		font-weight: 600;
	}

	.required {
		color: var(--accent);
	}

	.option-row {
		display: flex;
		flex-wrap: wrap;
		gap: 1.4rem;
		margin-top: 0.4rem;
	}

	.adult-confirmation {
		margin-top: 1rem;
	}

	.still-needed {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.still-needed p {
		margin: 0 0 0.3rem;
	}

	.still-needed ul {
		margin: 0;
		padding-left: 1.2rem;
		list-style: disc;
	}
</style>
