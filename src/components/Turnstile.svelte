<script>
	import { onMount, onDestroy } from 'svelte';
	import { TURNSTILE_SITE_KEY } from '$lib/config.js';
	import { uid } from '$lib/uid.js';

	/**
	 * Cloudflare Turnstile, rendered only when `TURNSTILE_SITE_KEY` is set —
	 * empty means the widget does not render at all, matching `config.js`'s
	 * own "unset means off, not broken" posture for that key. No wrapper
	 * library: Cloudflare's plain implicit-render contract (a `cf-turnstile`
	 * div plus its API script) needs nothing more than this.
	 *
	 * Verification of the resulting token happens server-side, in the n8n
	 * workflow each webhook already posts to — this static site has nowhere
	 * to hold the matching secret key, same reasoning as `SUBMISSION_WEBHOOK_URL`.
	 * @type {{ token: string }}
	 */
	// eslint-disable-next-line no-useless-assignment -- read/written from the onMount/reset closures below, not this top-level scope
	let { token = $bindable('') } = $props();

	const suffix = uid().replace(/[^a-zA-Z0-9]/g, '');
	const cbSuccess = `indienodeTurnstileOk_${suffix}`;
	const cbExpired = `indienodeTurnstileExpired_${suffix}`;
	const cbError = `indienodeTurnstileError_${suffix}`;

	/** @type {HTMLDivElement | undefined} */
	let widgetEl = $state();

	function loadScript() {
		if (document.querySelector('script[data-turnstile-api]')) return;
		const script = document.createElement('script');
		script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
		script.async = true;
		script.defer = true;
		script.dataset.turnstileApi = 'true';
		document.head.appendChild(script);
	}

	/**
	 * Named rather than an inline arrow assigned to `win[cbSuccess]` — an
	 * inline `@type` cast written directly inside an arrow function's own
	 * parameter parens is mishandled by Svelte's compiler in some files,
	 * producing invalid "parenthesized pattern" syntax once compiled, which
	 * only breaks under strict-mode evaluation (SSR). A `@param` above a
	 * named function's own declaration is untouched by that transform.
	 * @param {string} value
	 */
	function onTurnstileSuccess(value) {
		token = value;
	}

	function onTurnstileReset() {
		token = '';
	}

	/** @type {string | undefined} */
	let widgetId;

	onMount(() => {
		if (!TURNSTILE_SITE_KEY) return;
		const win = /** @type {any} */ (window);
		win[cbSuccess] = onTurnstileSuccess;
		win[cbExpired] = onTurnstileReset;
		win[cbError] = onTurnstileReset;
		// Cloudflare renders `.cf-turnstile` containers once, when its script
		// first loads. A widget mounted after that — the contact form coming
		// back for "Send another message", or /update switching between change
		// and remove — is a container nobody scans, so it never shows a
		// challenge and the submit fails server-side for want of a token. Once
		// the API is present, render this container explicitly instead.
		if (win.turnstile?.render && widgetEl) {
			widgetId = win.turnstile.render(widgetEl, {
				sitekey: TURNSTILE_SITE_KEY,
				theme: 'auto',
				callback: onTurnstileSuccess,
				'expired-callback': onTurnstileReset,
				'error-callback': onTurnstileReset
			});
		} else {
			loadScript();
		}
	});

	onDestroy(() => {
		if (typeof window === 'undefined') return;
		const win = /** @type {any} */ (window);
		if (widgetId !== undefined) {
			try {
				win.turnstile?.remove?.(widgetId);
			} catch {
				// Already gone with its container; nothing to clean up.
			}
		}
		delete win[cbSuccess];
		delete win[cbExpired];
		delete win[cbError];
	});

	/**
	 * So a caller facing a retryable submit failure can get a fresh token
	 * before retrying, rather than reusing (or resubmitting with) a spent one.
	 */
	export function reset() {
		token = '';
		const win = /** @type {any} */ (typeof window === 'undefined' ? undefined : window);
		if (win?.turnstile && widgetEl) {
			win.turnstile.reset(widgetId ?? widgetEl);
		}
	}
</script>

{#if TURNSTILE_SITE_KEY}
	<div
		bind:this={widgetEl}
		class="cf-turnstile"
		data-sitekey={TURNSTILE_SITE_KEY}
		data-theme="auto"
		data-callback={cbSuccess}
		data-expired-callback={cbExpired}
		data-error-callback={cbError}
	></div>
{/if}
