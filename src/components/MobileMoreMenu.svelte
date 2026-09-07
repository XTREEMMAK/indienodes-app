<script>
	/** @type {{ open?: boolean, onClose?: () => void }} */
	let { open = false, onClose } = $props();

	import { resolve } from '$app/paths';
	import { afterNavigate } from '$app/navigation';
	import { fade } from 'svelte/transition';
	import { aboutModalStore } from '$lib/aboutModalStore.svelte.js';
	import { flyFade } from '$lib/transitions.js';

	function close() {
		onClose?.();
	}

	afterNavigate(close);
</script>

{#if open}
	<button
		type="button"
		class="menu-backdrop"
		onclick={close}
		aria-label="Close more menu"
		transition:fade={{ duration: 120 }}
	></button>
	<div
		class="more-menu glass-panel"
		role="menu"
		tabindex="-1"
		aria-label="More destinations"
		onkeydown={(event) => event.key === 'Escape' && close()}
		transition:flyFade={{ y: 16, duration: 180 }}
	>
		<a href={resolve('/widget')} role="menuitem">
			<svg
				viewBox="0 0 24 24"
				width="19"
				height="19"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path d="M9 6 3 12l6 6M15 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
			Get Widget Code
		</a>
		<button
			type="button"
			role="menuitem"
			onclick={() => {
				aboutModalStore.show();
				close();
			}}
		>
			<svg
				viewBox="0 0 24 24"
				width="19"
				height="19"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="9" />
				<path d="M12 11v6" stroke-linecap="round" />
				<circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none" />
			</svg>
			About
		</button>
		<a href={resolve('/settings')} role="menuitem">
			<svg
				viewBox="0 0 24 24"
				width="19"
				height="19"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="3" />
				<path
					d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.5-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3h-6l-.3 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.5L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7.6 7.6 0 0 0 1.7 1L9 21h6l.3-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.5Z"
				/>
			</svg>
			Settings
		</a>
		<a href={resolve('/contact')} role="menuitem">
			<svg
				viewBox="0 0 24 24"
				width="19"
				height="19"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<rect x="3" y="5" width="18" height="14" rx="2" />
				<path d="m3.5 6 8.5 7 8.5-7" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
			Contact
		</a>
	</div>
{/if}

<style>
	.menu-backdrop {
		position: fixed;
		inset: 0;
		z-index: 48;
		border: 0;
		background: rgb(0 0 0 / 0.18);
	}

	.more-menu {
		position: fixed;
		right: 0.75rem;
		bottom: calc(7.5rem + env(safe-area-inset-bottom));
		z-index: 49;
		display: grid;
		width: min(13rem, calc(100vw - 1.5rem));
		padding: 0.45rem;
		border-radius: var(--radius-lg);
	}

	.more-menu a,
	.more-menu button {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		width: 100%;
		padding: 0.7rem 0.75rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-weight: 700;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}

	.more-menu a:hover,
	.more-menu button:hover,
	.more-menu a:focus-visible,
	.more-menu button:focus-visible {
		background: var(--glass-bg);
		color: var(--accent);
	}
</style>
