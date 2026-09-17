<script>
	/**
	 * A single page, not a stepper: name, email, message, send. Modeled on
	 * LBHQ's own `/request` form. No dedicated store — `submissionStore.svelte.js`'s
	 * own doc comment gives the test for when one earns its existence ("the
	 * draft outlives the page"), and filling three fields and pressing send
	 * in one visit has no such gap. Plain page-local `$state()` plus
	 * `createAntiBot()` is enough; nothing here persists across a reload.
	 */
	import GlassPanel from '../../../components/GlassPanel.svelte';
	import FormField from '../../../components/FormField.svelte';
	import Honeypot from '../../../components/Honeypot.svelte';
	import Turnstile from '../../../components/Turnstile.svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { hasBackend, useMock, send } from '$lib/contactApi.js';
	import { createAntiBot } from '$lib/antiBot.svelte.js';
	import { ringStore } from '$lib/ringStore.svelte.js';

	const antiBot = createAntiBot();

	let reportId = $state('');
	let basicReportMessage = $state('');
	let reportQueryRead = false;

	// Query parameters are intentionally unavailable while SvelteKit
	// prerenders this static route. Read them once on hydration instead; the
	// ordinary /contact HTML stays cacheable and a report navigation gains
	// its context as soon as the browser takes over.
	$effect(() => {
		if (!browser || reportQueryRead) return;
		reportQueryRead = true;
		reportId = (page.url.searchParams.get('report') ?? '').trim().slice(0, 120);
		if (!reportId) return;
		basicReportMessage = `Content report for node ${reportId}

What changed, looks unsafe, or no longer matches the approved entry:
`;
		if (!message) message = basicReportMessage;
	});

	const reportEntry = $derived(
		reportId ? ringStore.entries.find((entry) => entry.id === reportId) : undefined
	);

	let name = $state('');
	let email = $state('');
	let message = $state('');
	const MESSAGE_MAX_LENGTH = 2000;
	let reportPrefillUpgraded = false;

	$effect(() => {
		if (!reportEntry || reportPrefillUpgraded) return;
		reportPrefillUpgraded = true;
		// Upgrade only the untouched skeleton. If the visitor started typing
		// before ring.json finished loading, their words win.
		if (message !== basicReportMessage) return;
		message = `Content report for node ${reportEntry.id}
Creator: ${reportEntry.creator}
Approved destination: ${reportEntry.source_url}

What changed, looks unsafe, or no longer matches the approved entry:
`;
	});

	/** Errors show only after a field is left, not while first typing into an empty one. */
	let dirty = $state({ name: false, email: false, message: false });

	/** @type {'idle' | 'sending'} */
	let pending = $state('idle');
	/** @type {import('$lib/submissionError.js').WebhookError | null} */
	let error = $state(null);
	let reference = $state('');

	/** @param {string} value */
	function isValidEmail(value) {
		return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
	}

	const nameError = $derived(name.trim() ? '' : 'Tell us who you are.');
	const emailError = $derived(
		email.trim()
			? isValidEmail(email.trim())
				? ''
				: 'That does not look like an email address.'
			: 'Needed so we can reply.'
	);
	const messageError = $derived(
		message.trim()
			? message.length > MESSAGE_MAX_LENGTH
				? `Keep this to ${MESSAGE_MAX_LENGTH} characters; it is ${message.length}.`
				: ''
			: 'Say what this is about.'
	);
	const canSend = $derived(!nameError && !emailError && !messageError);

	/** @type {ReturnType<typeof Turnstile> | undefined} */
	let turnstileEl = $state();
	let turnstileToken = $state('');

	function touch() {
		antiBot.touch();
	}

	async function onSend() {
		if (pending !== 'idle' || !canSend) return;
		pending = 'sending';
		error = null;
		try {
			const result = await send({
				name: name.trim(),
				email: email.trim(),
				message: message.trim(),
				website: antiBot.honeypot,
				elapsed_ms: antiBot.elapsedMs,
				...(turnstileToken ? { turnstile_token: turnstileToken } : {})
			});
			reference = result.reference;
		} catch (e) {
			error = /** @type {any} */ (e);
			turnstileEl?.reset();
		} finally {
			pending = 'idle';
		}
	}

	function reset() {
		name = '';
		email = '';
		message = '';
		reference = '';
		error = null;
		antiBot.reset();
		// Siteverify accepts a token once, so the next message needs a new one.
		turnstileEl?.reset();
	}
</script>

<svelte:head>
	<title>Contact, IndieNodes</title>
</svelte:head>

<div class="contact-page">
	<h1 class="page-title">Get in touch</h1>

	{#if reportId}
		<div class="report-context">
			<p>
				<strong>Reporting {reportEntry?.creator ?? `node ${reportId}`}.</strong>
				The node ID and its approved destination are included below so maintainers can compare the current
				content with the reviewed entry. Add what you saw; do not include private or sensitive information.
			</p>
		</div>
	{/if}

	{#if !hasBackend && !useMock}
		<div class="interim-note">
			<p>
				<strong>The contact form is closed right now.</strong> Nothing you type here will be sent. Please
				check back.
			</p>
		</div>
	{:else if useMock}
		<div class="interim-note">
			<p>
				<strong>Development mode.</strong> No contact backend is configured, so this form is running
				against canned responses and nothing is sent anywhere. Add <code>?mock=network</code>,
				<code>rate-limited</code>, or <code>slow</code> to the URL to exercise the failure states.
			</p>
		</div>
	{/if}

	{#if reference}
		<GlassPanel class="done-panel">
			<h2>Sent.</h2>
			<p>We read every message and reply by email when one is needed.</p>
			<p class="reference-block">
				<span class="reference-label">Your reference</span>
				<code class="reference-code">{reference}</code>
			</p>
			<button type="button" class="btn btn-primary submit-again-button" onclick={reset}>
				Send another message
			</button>
		</GlassPanel>
	{:else}
		<GlassPanel class="form-panel">
			<FormField id="f-name" label="Your name" required error={dirty.name ? nameError : ''}>
				{#snippet children(describedBy)}
					<input
						id="f-name"
						class="control"
						type="text"
						autocomplete="name"
						bind:value={name}
						oninput={touch}
						onblur={() => (dirty.name = true)}
						aria-describedby={describedBy}
						aria-invalid={Boolean(dirty.name && nameError)}
					/>
				{/snippet}
			</FormField>

			<FormField
				id="f-email"
				label="Your email"
				hint="Used to deliver and reply to this message. Not an account or mailing list."
				required
				error={dirty.email ? emailError : ''}
			>
				{#snippet children(describedBy)}
					<input
						id="f-email"
						class="control"
						type="email"
						autocomplete="email"
						bind:value={email}
						oninput={touch}
						onblur={() => (dirty.email = true)}
						aria-describedby={describedBy}
						aria-invalid={Boolean(dirty.email && emailError)}
					/>
				{/snippet}
			</FormField>

			<FormField id="f-message" label="Message" required error={dirty.message ? messageError : ''}>
				{#snippet children(describedBy)}
					<textarea
						id="f-message"
						class="control"
						rows="6"
						maxlength={MESSAGE_MAX_LENGTH + 100}
						bind:value={message}
						oninput={touch}
						onblur={() => (dirty.message = true)}
						aria-describedby={describedBy}
						aria-invalid={Boolean(dirty.message && messageError)}></textarea>
				{/snippet}
			</FormField>
			<p class="counter" class:over={message.length > MESSAGE_MAX_LENGTH}>
				{message.length} / {MESSAGE_MAX_LENGTH}
			</p>

			<Honeypot bind:value={antiBot.honeypot} />
			<Turnstile bind:this={turnstileEl} bind:token={turnstileToken} />

			{#if error}
				<p class="inline-error" role="alert">
					{error.message}
					{#if error.retryable}
						<button type="button" class="clear-button" onclick={() => (error = null)}>
							Try again
						</button>
					{/if}
				</p>
			{/if}

			<div class="actions">
				<button
					type="button"
					class="btn btn-primary"
					disabled={pending !== 'idle' || !canSend || (!hasBackend && !useMock)}
					onclick={onSend}
				>
					{pending === 'sending' ? 'Sending…' : 'Send message'}
				</button>
			</div>
		</GlassPanel>
	{/if}
</div>

<style>
	.contact-page {
		max-width: 40rem;
		margin: 0 auto;
		padding: 0 2rem 4rem;
	}

	.page-title {
		margin: 1rem 0 0.9rem;
		font-size: var(--text-lg);
	}

	.interim-note {
		max-width: 60ch;
		margin-bottom: 0.9rem;
		padding: 0.7rem 1rem;
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
	}

	.report-context {
		max-width: 60ch;
		margin-bottom: 0.9rem;
		padding: 0.8rem 1rem;
		border: 1px solid color-mix(in oklch, var(--type-game) 55%, var(--border));
		border-left: 3px solid var(--type-game);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
	}

	.report-context p {
		margin: 0;
		font-size: var(--text-xs);
	}

	.interim-note p {
		margin: 0;
		font-size: var(--text-xs);
	}

	:global(.form-panel) {
		padding: 2rem 2rem 1.2rem;
	}

	:global(.done-panel) {
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

	.counter {
		margin-top: -1.4rem;
		margin-bottom: 1.8rem;
		color: var(--text-faint);
		font-size: var(--text-xs);
		text-align: right;
	}

	.counter.over {
		color: #e0455f;
	}

	.inline-error {
		color: #e0455f;
		font-size: var(--text-sm);
		margin-bottom: 1rem;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 1.2rem;
	}

	@media (max-width: 30rem) {
		.contact-page {
			padding: 0 1.2rem 4rem;
		}

		:global(.form-panel) {
			padding: 1.6rem 1.4rem 1rem;
		}
	}
</style>
