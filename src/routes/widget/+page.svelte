<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import GlassPanel from '../../components/GlassPanel.svelte';
	import { SITE_ORIGIN } from '$lib/config.js';
	import { BADGE_STYLES, badgeAssetPath, embedHtmlFor } from '$lib/widgetTiers.js';
	import { embedSnippet, embedFrameSnippet } from './embed-snippet.js';

	/** @typedef {'widget' | 'badge' | 'text-link' | 'widget-script'} TabId */
	/** @type {{ id: TabId, label: string }[]} */
	const tabs = [
		{ id: 'widget', label: 'Full widget' },
		{ id: 'badge', label: 'Badges' },
		{ id: 'text-link', label: 'Text only' },
		{ id: 'widget-script', label: 'Advanced' }
	];

	let activeTab = $state(/** @type {TabId} */ ('widget'));
	let scriptReady = $state(false);

	onMount(() => {
		if (!browser) return;
		// Load this exactly as an external host page would, so the advanced
		// preview is the shipped widget rather than a separately maintained copy.
		const script = document.createElement('script');
		script.type = 'module';
		script.src = '/embed.js';
		script.onload = () => (scriptReady = true);
		document.head.appendChild(script);
	});

	const frameSnippet = embedFrameSnippet(SITE_ORIGIN);
	const scriptSnippet = embedSnippet(SITE_ORIGIN);
	const textSnippet = embedHtmlFor({ tier: 'text-link', origin: SITE_ORIGIN, entryType: 'audio' });
	const badgeSnippet = embedHtmlFor({
		tier: 'badge',
		badgeStyle: 'classic',
		origin: SITE_ORIGIN,
		entryType: 'audio'
	});

	/** @param {KeyboardEvent} event */
	function handleTabKey(event) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const current = tabs.findIndex((tab) => tab.id === activeTab);
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? tabs.length - 1
					: (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
		activeTab = tabs[next].id;
		requestAnimationFrame(() => document.getElementById(`widget-tab-${activeTab}`)?.focus());
	}
</script>

<svelte:head>
	<title>Widget, IndieNodes</title>
</svelte:head>

<div class="widget-page">
	<header class="page-intro">
		<p class="eyebrow">Share the ring</p>
		<h1>Embeddable widgets</h1>
		<p>
			Choose how visible you want IndieNodes to be on your site, from the full navigation widget to
			a quiet line in your footer.
		</p>
	</header>

	<div class="tabs" role="tablist" aria-label="Widget type" tabindex="-1" onkeydown={handleTabKey}>
		{#each tabs as tab (tab.id)}
			<button
				type="button"
				role="tab"
				id={`widget-tab-${tab.id}`}
				aria-controls={`widget-panel-${tab.id}`}
				aria-selected={activeTab === tab.id}
				tabindex={activeTab === tab.id ? 0 : -1}
				onclick={() => (activeTab = tab.id)}>{tab.label}</button
			>
		{/each}
	</div>

	<GlassPanel as="section" class="widget-showcase">
		<div
			class="tab-panel"
			role="tabpanel"
			id={`widget-panel-${activeTab}`}
			aria-labelledby={`widget-tab-${activeTab}`}
		>
			{#if activeTab === 'widget'}
				<div class="preview-column">
					<span class="column-label">Live preview</span>
					<div class="preview-stage full-preview">
						<iframe
							title="IndieNodes webring"
							width="260"
							height="150"
							style="border:0;"
							sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
							loading="lazy"
							src="/embed-frame"
						></iframe>
					</div>
				</div>
				<div class="info-column">
					<span class="column-label">Recommended</span>
					<h2>Full navigation widget</h2>
					<p>
						Gives visitors Previous, Random, and Next controls. It runs in a sandboxed frame with no
						access to your page's cookies, storage, or DOM.
					</p>
					<ul>
						<li>Best for a dedicated links area or sidebar</li>
						<li>Automatically supports light and dark mode</li>
						<li>No tracking or access to the rest of your site</li>
					</ul>
					<h3>Copy and paste</h3>
					<pre class="snippet"><code>{frameSnippet}</code></pre>
					<div class="required-setting">
						<strong>Required before publishing</strong>
						<p>
							Replace <code>your-ring-entry-id</code> with the exact <code>id</code> from your published
							IndieNodes ring entry. Previous and Next use it to find your site neighbors.
						</p>
					</div>
					<details>
						<summary>Match your site's accent and font</summary>
						<p>
							Add <code>accent</code> and <code>font</code> parameters to the frame URL. For
							example: <code>?accent=%232563eb&amp;font=Fira%20Code</code>.
						</p>
					</details>
				</div>
			{:else if activeTab === 'badge'}
				<div class="preview-column">
					<span class="column-label">Available styles</span>
					<div class="preview-stage badge-preview">
						{#each BADGE_STYLES as style (style.id)}
							<div class="badge-option">
								<div class="badge-image-wrap">
									<img
										src={badgeAssetPath(style.id, 'audio')}
										width="88"
										height="31"
										alt={`${style.label} IndieNodes badge`}
									/>
								</div>
								<div><strong>{style.label}</strong><span>{style.description}</span></div>
							</div>
						{/each}
					</div>
				</div>
				<div class="info-column">
					<span class="column-label">Compact</span>
					<h2>Traditional 88 × 31 badge</h2>
					<p>
						A familiar webring badge with a small footprint. Clicking it sends the visitor to a
						random IndieNodes member.
					</p>
					<ul>
						<li>Four visual styles</li>
						<li>No JavaScript</li>
						<li>Works anywhere an image link works</li>
					</ul>
					<h3>Classic badge code</h3>
					<pre class="snippet"><code>{badgeSnippet}</code></pre>
					<p class="small-note">
						Change <code>classic.svg</code> to <code>minimal.svg</code>, <code>mono.svg</code>, or
						<code>type-coded-audio.svg</code> to use another style.
					</p>
				</div>
			{:else if activeTab === 'text-link'}
				<div class="preview-column">
					<span class="column-label">Footer example</span>
					<div class="preview-stage footer-preview">
						<div class="sample-page">
							<div class="sample-content"></div>
							<footer>
								<a href={resolve('/go/random')} target="_blank" rel="noopener noreferrer">
									&lt;&lt; Member of IndieNodes &gt;&gt;
								</a>
								<span>© 2026 Your Name</span>
							</footer>
						</div>
					</div>
				</div>
				<div class="info-column">
					<span class="column-label">Most inconspicuous</span>
					<h2>Thin text-only link</h2>
					<p>
						A single line with no image, frame, or script. It fits neatly above or below a copyright
						notice when you want to support the ring without adding another visual block.
					</p>
					<ul>
						<li>Uses your site's existing link style</li>
						<li>Adds almost no height to a footer</li>
						<li>Opens a random member in a new tab</li>
					</ul>
					<h3>Copy and paste</h3>
					<pre class="snippet"><code>{textSnippet}</code></pre>
				</div>
			{:else}
				<div class="preview-column">
					<span class="column-label">Live preview</span>
					<div class="preview-stage full-preview">
						{#if scriptReady}
							<indienode-widget></indienode-widget>
						{:else}
							<p class="loading">Loading widget…</p>
						{/if}
					</div>
				</div>
				<div class="info-column">
					<span class="column-label">Advanced</span>
					<h2>Script and custom element</h2>
					<p>
						The same full widget without the iframe. Its styles remain isolated in a shadow root,
						but the script runs with your page's JavaScript privileges. Use this only when your site
						specifically needs a script embed.
					</p>
					<h3>Copy and paste</h3>
					<pre class="snippet"><code>{scriptSnippet}</code></pre>
					<div class="required-setting">
						<strong>Required before publishing</strong>
						<p>
							Replace <code>your-ring-entry-id</code> with the exact <code>id</code> from your published
							IndieNodes ring entry. Previous and Next use it to find your site neighbors.
						</p>
					</div>
					<details>
						<summary>Match your site's accent and font</summary>
						<pre class="snippet compact"><code
								>indienode-widget &lbrace;
	--indienode-accent: #2563eb;
	--indienode-font-family: 'Fira Code', monospace;
&rbrace;</code
							></pre>
					</details>
				</div>
			{/if}
		</div>
	</GlassPanel>
</div>

<style>
	.widget-page {
		width: min(72rem, 100%);
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.page-intro {
		max-width: 48rem;
	}
	.page-intro h1 {
		margin: 0.25rem 0 0.65rem;
	}
	.page-intro > p:last-child {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-lg);
	}
	.eyebrow,
	.column-label {
		margin: 0;
		color: var(--accent);
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.tabs {
		display: flex;
		align-self: flex-start;
		gap: 0.25rem;
		max-width: 100%;
		padding: 0.3rem;
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--glass-bg);
		backdrop-filter: blur(var(--glass-blur));
	}
	.tabs button {
		padding: 0.55rem 0.95rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--text-muted);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 650;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background 150ms ease,
			color 150ms ease,
			transform 120ms ease;
	}
	.tabs button:hover {
		color: var(--text);
	}
	.tabs button[aria-selected='true'] {
		background: var(--accent);
		color: white;
	}
	.tabs button:active {
		transform: scale(0.97);
	}
	:global(.widget-showcase) {
		padding: clamp(1.25rem, 3vw, 2.5rem);
	}
	.tab-panel {
		display: grid;
		grid-template-columns: minmax(18rem, 0.9fr) minmax(20rem, 1.1fr);
		gap: clamp(2rem, 5vw, 4rem);
		align-items: start;
	}
	.preview-column,
	.info-column {
		min-width: 0;
	}
	.preview-stage {
		min-height: 21rem;
		margin-top: 0.8rem;
		padding: 1.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background:
			linear-gradient(color-mix(in oklch, var(--text-muted) 8%, transparent) 1px, transparent 1px),
			linear-gradient(
				90deg,
				color-mix(in oklch, var(--text-muted) 8%, transparent) 1px,
				transparent 1px
			),
			var(--bg-elevated);
		background-size: 20px 20px;
	}
	.full-preview {
		display: grid;
		place-items: center;
	}
	.info-column h2 {
		margin: 0.35rem 0 0.8rem;
	}
	.info-column h3 {
		margin: 1.5rem 0 0.65rem;
		font-size: var(--text-base);
	}
	.info-column p {
		color: var(--text);
	}
	.info-column ul {
		margin: 1.2rem 0 0;
		padding-left: 1.25rem;
		color: var(--text-muted);
	}
	.info-column li + li {
		margin-top: 0.35rem;
	}
	.snippet {
		margin: 0;
		padding: 1rem 1.1rem;
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
		font-size: var(--text-xs);
		line-height: 1.55;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.snippet.compact {
		margin-top: 0.8rem;
	}
	.required-setting {
		margin-top: 0.8rem;
		padding: 0.85rem 1rem;
		border: 1px solid color-mix(in oklch, var(--accent) 55%, var(--border));
		border-radius: var(--radius-sm);
		background: color-mix(in oklch, var(--accent) 10%, var(--bg-elevated));
	}
	.required-setting strong {
		display: block;
		color: var(--accent);
		font-size: var(--text-sm);
	}
	.required-setting p {
		margin: 0.3rem 0 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.required-setting code {
		color: var(--text);
		font-weight: 700;
	}
	details {
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
	summary {
		color: var(--text);
		font-weight: 650;
		cursor: pointer;
	}
	details p {
		margin: 0.75rem 0 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.badge-preview {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.85rem;
	}
	.badge-option {
		display: grid;
		grid-template-columns: 7rem 1fr;
		align-items: center;
		gap: 0.9rem;
	}
	.badge-image-wrap {
		display: grid;
		place-items: center;
		min-height: 3.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg);
	}
	.badge-option strong,
	.badge-option span {
		display: block;
	}
	.badge-option span,
	.small-note {
		color: var(--text-muted) !important;
		font-size: var(--text-xs);
	}
	.footer-preview {
		display: flex;
		align-items: end;
	}
	.sample-page {
		width: 100%;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg);
		box-shadow: var(--shadow-sm);
	}
	.sample-content {
		height: 9rem;
		background:
			linear-gradient(var(--border), var(--border)) 1rem 1.2rem / 42% 0.65rem no-repeat,
			linear-gradient(var(--border), var(--border)) 1rem 2.4rem / 72% 0.35rem no-repeat,
			linear-gradient(var(--border), var(--border)) 1rem 3.1rem / 58% 0.35rem no-repeat;
	}
	.sample-page footer {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		padding: 0.7rem 1rem;
		border-top: 1px solid var(--border);
		color: var(--text-muted);
		font-size: 0.7rem;
		text-align: center;
	}
	.sample-page footer a {
		color: var(--text-muted);
		text-decoration-thickness: 1px;
		text-underline-offset: 0.15em;
	}
	.loading {
		color: var(--text-muted);
	}
	@media (max-width: 48rem) {
		.tab-panel {
			grid-template-columns: 1fr;
			gap: 1.75rem;
		}
		.preview-stage {
			min-height: 17rem;
		}
	}
	@media (max-width: 30rem) {
		.tabs {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			width: 100%;
			overflow: visible;
			border-radius: var(--radius-md);
		}
		.tabs button {
			padding-inline: 0.8rem;
		}

		.preview-stage {
			padding: 1rem;
		}
		.badge-option {
			grid-template-columns: 6.25rem 1fr;
		}
	}
</style>
