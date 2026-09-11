<script>
	import { fade } from 'svelte/transition';
	import { page } from '$app/state';
	import Modal from './Modal.svelte';
	import { outFade } from '$lib/transitions.js';
	import { aboutModalStore } from '$lib/aboutModalStore.svelte.js';
	import { GITHUB_URL, GITHUB_ISSUES_URL, KOFI_URL, EARLY_ACCESS } from '$lib/config.js';
	// Named import, not the default. `import pkg from '.../package.json'`
	// pulls the whole file into the client bundle for one field: every
	// script, every dependency and its version, all shipped to visitors.
	// A named import lets it be tree-shaken down to the string.
	import { version } from '../../package.json';

	// static/images/IndieNodes_Logo.webp, referenced by its served root path
	// rather than imported: files under static/ are not part of the module
	// graph (they are copied through as-is), the same reason app.html's icon
	// and manifest links are plain paths rather than imports.
	const LOGO_SRC = '/images/IndieNodes_Logo.webp';

	// Release history is parsed from CHANGELOG.md once, at build time (see
	// src/routes/+layout.js), the same "read the changelog instead of
	// hand-maintaining a second list" approach GGRequestz's own About modal
	// uses, adapted for a site with no server to do that parse per request.
	const releases = $derived(page.data.releases ?? []);
	// Capped for the same reason GGRequestz caps its own list server-side: a
	// long project history should cost the list a scrollbar, not make the
	// modal's layout dependent on how many releases have shipped.
	const RELEASE_LIST_CAP = 10;

	// Support drops out entirely when KOFI_URL is unset (build-time, so this
	// never changes after load) rather than showing a tab whose text promises
	// a donation link that isn't there — the same "unset means off, not
	// broken" posture Turnstile.svelte already has for its own widget.
	const TABS = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'principles', label: 'Principles' },
		{ id: 'source', label: 'Source & License' },
		...(KOFI_URL ? [{ id: 'support', label: 'Support' }] : [])
	];

	let activeTab = $state('overview');

	function close() {
		aboutModalStore.hide();
		// Reset after the close transition finishes, not immediately: an
		// instant reset would flash the Overview tab in place of whatever was
		// showing while the modal is still fading out.
		setTimeout(() => (activeTab = 'overview'), 250);
	}
</script>

<Modal open={aboutModalStore.open} title="About IndieNodes" showTitle={false} onClose={close}>
	<div class="brand">
		<img src={LOGO_SRC} alt="" width="112" height="112" />
		<p class="brand-name">IndieNodes</p>
		<p class="brand-version">Version {version}</p>
	</div>

	<div class="tabs" role="tablist" aria-label="About sections">
		{#each TABS as tab (tab.id)}
			<button
				type="button"
				role="tab"
				id="about-tab-{tab.id}"
				aria-selected={activeTab === tab.id}
				aria-controls="about-panel-{tab.id}"
				class="tab"
				class:active={activeTab === tab.id}
				onclick={() => (activeTab = tab.id)}
			>
				{#if tab.id === 'overview'}
					<svg
						viewBox="0 0 24 24"
						width="18"
						height="18"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="9" />
						<path d="M12 11v6" stroke-linecap="round" />
						<circle
							cx="12"
							cy="7.5"
							r="0.25"
							fill="currentColor"
							stroke="currentColor"
							stroke-width="1.5"
						/>
					</svg>
				{:else if tab.id === 'principles'}
					<svg
						viewBox="0 0 24 24"
						width="18"
						height="18"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path d="M12 3l7 3v6c0 4.4-2.9 7.7-7 9-4.1-1.3-7-4.6-7-9V6z" stroke-linejoin="round" />
						<path d="M9 12l2 2 4-4" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				{:else if tab.id === 'source'}
					<svg
						viewBox="0 0 24 24"
						width="18"
						height="18"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path
							d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				{:else}
					<svg
						viewBox="0 0 24 24"
						width="18"
						height="18"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path
							d="M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-7"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<rect x="2" y="8" width="20" height="4" rx="1" />
						<path
							d="M12 8V20M12 8c0-2.5-1.5-4-3.5-4S5 5.5 5 7s1.3 1 3.5 1M12 8c0-2.5 1.5-4 3.5-4S19 5.5 19 7s-1.3 1-3.5 1"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				{/if}
				{tab.label}
			</button>
		{/each}
	</div>

	<div class="panel-container">
		{#key activeTab}
			<div class="panel" in:fade={{ duration: 120 }} out:outFade={{ duration: 120 }}>
				{#if activeTab === 'overview'}
					<div role="tabpanel" id="about-panel-overview" aria-labelledby="about-tab-overview">
						<!-- First, above the description, because "what is this?"
						     and "why is it so empty?" are the same question while
						     the ring is still small, and answering the second one
						     second leaves the visitor to draw their own conclusion
						     in the meantime. The status chip in the corner is the
						     label; this is the paragraph it is short for. -->
						{#if EARLY_ACCESS}
							<p class="phase-note">
								<strong>IndieNodes is in Early Access.</strong> The app works, but the ring is still being
								built — we're recruiting founding creators before the wider launch. Expect it to feel
								sparse for now, and expect it to fill in. Joining is free, and every submission is reviewed
								by a person.
							</p>
						{/if}
						<p>
							IndieNodes is a lightweight, decentralized way to stumble into real indie creators'
							work: audio, comics and visual art, writing, and games. It is a webring, not a
							platform. There is no account system, no server-side user data, and no algorithm
							deciding what you see, only a field of nodes you arrange yourself.
						</p>
						<p>
							The data is the API. A single public file, <code>ring.json</code>, is the actual
							product. Everything you're using right now, this field view, the embeddable widget
							other sites paste in, is a client of that data. Any one of them can be retired without
							taking the ring down.
						</p>
					</div>
				{:else if activeTab === 'principles'}
					<div role="tabpanel" id="about-panel-principles" aria-labelledby="about-tab-principles">
						<!-- Icons rather than disc bullets: each of these is a promise
						     about a specific thing the app refuses to do, and a mark
						     saying which thing carries that faster than a bullet does.
						     Inlined in the house style (24 viewBox, currentColor
						     stroke), matching how every other icon here is written. -->
						<ul class="principle-list">
							<li>
								<svg
									viewBox="0 0 24 24"
									width="18"
									height="18"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									aria-hidden="true"
								>
									<path
										d="M15 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
									<circle cx="8.5" cy="7" r="3.5" />
									<path d="M16 6l5 5M21 6l-5 5" stroke-linecap="round" />
								</svg>
								<span>No accounts, no server-side tracking of anything you do here.</span>
							</li>
							<li>
								<svg
									viewBox="0 0 24 24"
									width="18"
									height="18"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									aria-hidden="true"
								>
									<path d="M4 20V10M10 20V4M16 20v-6" stroke-linecap="round" />
									<path d="M3 3l18 18" stroke-linecap="round" />
								</svg>
								<span>No recommendation algorithm and no behavioral inference, ever.</span>
							</li>
							<li>
								<svg
									viewBox="0 0 24 24"
									width="18"
									height="18"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									aria-hidden="true"
								>
									<path d="M11 5L6 9H3v6h3l5 4z" stroke-linecap="round" stroke-linejoin="round" />
									<path d="M16 9l5 6M21 9l-5 6" stroke-linecap="round" />
								</svg>
								<span>
									Nothing plays sound without you asking. No autoplay with audio, no unrequested
									video with sound.
								</span>
							</li>
							<li>
								<svg
									viewBox="0 0 24 24"
									width="18"
									height="18"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									aria-hidden="true"
								>
									<rect x="4" y="10" width="16" height="10" rx="2" />
									<path d="M8 10V7a4 4 0 0 1 8 0v3" stroke-linecap="round" />
								</svg>
								<span
									>Likes never leave your browser. They live in local storage, not on a server.</span
								>
							</li>
							<li>
								<svg
									viewBox="0 0 24 24"
									width="18"
									height="18"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									aria-hidden="true"
								>
									<path
										d="M4 19.5l6.5-9 3 4.2 2.2-3L20 19.5z"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
									<circle cx="8.5" cy="7.5" r="1.8" />
									<path d="M3 3l18 18" stroke-linecap="round" />
								</svg>
								<span>No AI artists. Every entry is the work of a person.</span>
							</li>
						</ul>
					</div>
				{:else if activeTab === 'source'}
					<div role="tabpanel" id="about-panel-source" aria-labelledby="about-tab-source">
						<p>
							IndieNodes is open source, licensed <strong>GPL-3.0-or-later</strong>. The code and
							<code>ring.json</code> live on GitHub.
						</p>
						<div class="link-row">
							<!-- eslint-disable svelte/no-navigation-without-resolve -- external URLs from config.js, not app routes; disabled as a block since prettier is free to wrap these tags across lines, which breaks an eslint-disable-next-line's line-proximity to the actual href -->
							<a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" class="icon-link">
								<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
									<path
										fill="currentColor"
										d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.75 2.7 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.42.36.78 1.07.78 2.16 0 1.56-.01 2.82-.01 3.2 0 .3.21.66.79.55A10.51 10.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5"
									/>
								</svg>
								GitHub
							</a>
							<a
								href={GITHUB_ISSUES_URL}
								target="_blank"
								rel="noopener noreferrer"
								class="icon-link"
							>
								<svg
									viewBox="0 0 24 24"
									width="18"
									height="18"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									aria-hidden="true"
								>
									<circle cx="12" cy="12" r="9" />
									<path d="M12 8v5M12 16h.01" stroke-linecap="round" />
								</svg>
								Issue tracker
							</a>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						</div>

						{#if releases.length > 0}
							<!-- Absent rather than empty when the parse finds nothing, so a
							     malformed CHANGELOG.md costs this section instead of
							     rendering a bare heading over nothing. -->
							<div class="releases">
								<h3>Release history</h3>
								<ul class="release-list">
									<!-- eslint-disable svelte/no-navigation-without-resolve -- external URL built from config.js's GITHUB_URL, not an app route; a block disable, not next-line, since prettier is free to wrap this tag's attributes across lines and push href away from a next-line comment -->
									{#each releases.slice(0, RELEASE_LIST_CAP) as release (release.version)}
										<li>
											<a
												href="{GITHUB_URL}/blob/main/CHANGELOG.md#{release.anchor}"
												target="_blank"
												rel="noopener noreferrer"
												class="release-row"
											>
												<span class="release-version">
													v{release.version}
													{#if release.version === version}
														<span class="release-current">(current)</span>
													{/if}
												</span>
												<span class="release-date">{release.date}</span>
											</a>
										</li>
									{/each}
									<!-- eslint-enable svelte/no-navigation-without-resolve -->
								</ul>
							</div>
						{/if}
					</div>
				{:else}
					<div role="tabpanel" id="about-panel-support" aria-labelledby="about-tab-support">
						<p>
							IndieNodes runs no ads or third-party tracking code of its own, which means no revenue
							stream funds it that way on purpose. If you'd like to help cover hosting, that's the
							only kind of support that exists here: a donation, not a subscription and not a paid
							tier.
						</p>
						<p>
							Game trailers are the one opt-in third-party surface. Nothing is requested from
							YouTube until you press Trailer; then its privacy-enhanced player loads, and YouTube
							may collect data or show ads under its own policies.
						</p>
						<p>
							Donating never changes what surfaces. There is no code path where a payment affects
							which creators appear, how often, or in what order.
						</p>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external URL from config.js, not an app route -->
						<a class="kofi-link" href={KOFI_URL} target="_blank" rel="noopener noreferrer">
							<!-- Ko-fi's own mark, not a generic mug: the Support tab's one
							     external brand deserves the actual logo rather than a
							     lookalike, the same reasoning the GitHub link already
							     followed in Source & License. -->
							<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
								<path
									fill="currentColor"
									d="M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493 1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182 2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195-1.09-2-1.298-4.155-1.298-7.506 0-2.181.857-3.402 3.012-3.714 1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545 1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142 0 1.533.858 2.857 1.949 3.897.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896 1.117-1.039 1.974-2.364 1.974-3.897 0-1.662-1.247-3.142-3.039-3.142-1.065 0-1.792.545-2.338 1.298-.493-.753-1.246-1.298-2.312-1.298"
								/>
							</svg>
							Support on Ko-fi
						</a>
					</div>
				{/if}
			</div>
		{/key}
	</div>
</Modal>

<style>
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 1.6rem;
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		padding: 0.5rem 0.2rem 0.75rem;
		margin-bottom: -1px;
		color: var(--text-muted);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}

	.tab:hover {
		color: var(--text);
	}

	.tab.active {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}

	.panel-container {
		/* position: relative anchors the outgoing panel's outFade (position:
       absolute during its own exit), so switching tabs overlays the old
       content fading out instead of stacking both in normal flow, the
       same "pop" bug the page-level route transition had.
       A fixed height, not min-height: the modal used to resize itself to
       whichever tab was open, which read as the dialog jumping around
       rather than just its content changing. Tall enough for the tallest
       panel (Source & License, once its release list is showing) with a
       little headroom; shorter panels just leave blank space below, and
       overflow-y is a safety net rather than the intended fit. */
		position: relative;
		height: 28rem;
		overflow-y: auto;
	}

	p {
		color: var(--text);
	}

	p + p {
		margin-top: 1.2rem;
	}

	/* The left-accent callout the forms already use for their own interim
	   notices (`.interim-note` on /contact, /join and /update). Matched rather
	   than invented so "this is a temporary state of the site, not part of the
	   content" reads the same wherever it appears -- it is the same kind of
	   message, and this is the fourth place to need it. */
	.phase-note {
		margin-bottom: 1.2rem;
		padding: 0.7rem 1rem;
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
	}

	.principle-list {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		padding-left: 0;
		list-style: none;
	}

	.principle-list li {
		display: flex;
		align-items: flex-start;
		gap: 0.7rem;
		color: var(--text);
	}

	.principle-list svg {
		/* Nudged down to sit on the first line's optical centre rather than
		   its box top, which reads as misaligned on the items that wrap. */
		flex-shrink: 0;
		margin-top: 0.15rem;
		color: var(--accent);
	}

	.brand {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.5rem;
		margin-bottom: 1.6rem;
	}

	.brand img {
		width: 7rem;
		height: 7rem;
		border-radius: var(--radius-md);
	}

	.brand-name {
		margin-top: 0.3rem;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--text-xl);
	}

	.brand-version {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.releases {
		margin-top: 1.6rem;
	}

	.releases h3 {
		margin-bottom: 0.6rem;
		color: var(--text-muted);
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.release-list {
		display: block;
		max-height: 10rem;
		overflow-y: auto;
		padding-left: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		list-style: none;
	}

	.release-list li + li {
		border-top: 1px solid var(--border);
	}

	.release-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.6rem 0.8rem;
		color: var(--text);
		text-decoration: none;
		font-size: var(--text-sm);
	}

	.release-row:hover {
		background: var(--glass-bg);
	}

	.release-version {
		font-weight: 600;
	}

	.release-current {
		margin-left: 0.3rem;
		color: var(--text-muted);
		font-weight: 400;
		font-size: var(--text-xs);
	}

	.release-date {
		color: var(--text-muted);
		font-size: var(--text-xs);
	}

	.link-row {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin-top: 1.2rem;
	}

	.icon-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text);
		text-decoration: none;
		font-weight: 600;
	}

	.icon-link:hover {
		color: var(--accent);
	}

	.kofi-link {
		/* flex + fit-content + auto margins rather than a text-align: center
		   wrapper: the button stays exactly as wide as its own content and
		   centres itself, with no extra element in the markup to do it. */
		display: flex;
		width: fit-content;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1.6rem;
		margin-inline: auto;
		padding: 1.05rem 2.05rem;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: white;
		text-decoration: none;
		font-weight: 600;
	}

	.kofi-link:hover {
		background: var(--accent-hover);
	}

	/* The base type scale (see app.css) is tuned for desktop reading
	   distance; unscaled, it also wraps "Source & License" onto two lines
	   in this modal's narrower mobile width. One step down the same scale
	   for each element here, not an ad-hoc value, and not a change to the
	   scale itself, which every other surface still reads at full size. */
	@media (max-width: 64rem) {
		.panel {
			font-size: var(--text-sm);
		}

		.tab {
			font-size: var(--text-xs);
		}

		.brand-name {
			font-size: var(--text-lg);
		}

		.brand-version {
			font-size: var(--text-xs);
		}
	}
</style>
