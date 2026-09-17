<script>
	/**
	 * The attestations about the featured works themselves, shared by /join's
	 * consent step and /update's review step so an update cannot skip a check a
	 * new submission has to pass.
	 *
	 * `includeRights` exists because the two flows carry the rights statement
	 * differently. /join folds it into the one General EULA checkbox, which
	 * already affirms holding full rights, rather than asking the same thing
	 * twice a line apart; /update has no EULA box to fold it into, so it asks
	 * for rights here on its own.
	 *
	 * The adult-content disclosure is not here: it sits beside the `explicit`
	 * checkbox it belongs with (see AdultContentDisclosure.svelte).
	 *
	 * @typedef {{
	 *   aiAttestation?: boolean,
	 *   rightsConfirmation?: boolean,
	 *   includeRights?: boolean,
	 *   missing?: Record<string, string>,
	 *   showMusicProSentence?: boolean,
	 *   onchange?: () => void
	 * }} Props
	 */

	/** @type {Props} */
	let {
		aiAttestation = $bindable(false),
		rightsConfirmation = $bindable(false),
		includeRights = false,
		missing = {},
		showMusicProSentence = false,
		onchange
	} = $props();

	const stillNeeded = $derived(
		[missing.ai_attestation, includeRights ? missing.rights_confirmation : ''].filter(Boolean)
	);
</script>

<div class="attestations">
	<label class="option attestation">
		<input type="checkbox" bind:checked={aiAttestation} onchange={() => onchange?.()} />
		<span class="option-description attestation-text">
			I confirm that the music, art, writing, voice performances, and game design in my featured
			works were made by people, as described in the content rules.
		</span>
	</label>

	{#if includeRights}
		<label class="option attestation">
			<input type="checkbox" bind:checked={rightsConfirmation} onchange={() => onchange?.()} />
			<span class="option-description attestation-text">
				I hold the rights to the works I am featuring. None of them are covers, uncleared samples,
				fan work using characters I do not own, or performances owned by a client.
				{#if showMusicProSentence}
					I understand that PRO membership does not prevent me from submitting, but I am disclosing
					it accurately above.
				{/if}
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

<style>
	.attestations {
		max-width: 66ch;
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

	.still-needed {
		margin: 0 0 1rem;
		padding-left: 1.2rem;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
