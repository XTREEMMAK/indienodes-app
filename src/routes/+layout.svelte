<script>
	import { onMount } from 'svelte';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AmbientBackground from '../components/AmbientBackground.svelte';
	import ThemeToggle from '../components/ThemeToggle.svelte';
	import AboutModal from '../components/AboutModal.svelte';
	import FeedbackPrompt from '../components/FeedbackPrompt.svelte';
	import ComicViewer from '../components/ComicViewer.svelte';
	import TextViewer from '../components/TextViewer.svelte';
	import NavDrawer from '../components/NavDrawer.svelte';
	import ArrangeMenu from '../components/ArrangeMenu.svelte';
	import AudioPlayer from '../components/AudioPlayer.svelte';
	import AudioDebugPanel from '../components/AudioDebugPanel.svelte';
	import AmbientView from '../components/AmbientView.svelte';
	import Modal from '../components/Modal.svelte';
	import MobileMoreMenu from '../components/MobileMoreMenu.svelte';
	import { preferencesStore } from '$lib/preferencesStore.svelte.js';
	import { skinStore } from '../skins/skinStore.svelte.js';
	import { audioPlayerStore } from '$lib/audioPlayerStore.svelte.js';
	import { STORAGE_KEYS } from '$lib/storageKeys.js';
	import { feedbackStore } from '$lib/feedbackStore.svelte.js';
	import { comicViewerStore } from '$lib/comicViewerStore.svelte.js';
	import { textViewerStore } from '$lib/textViewerStore.svelte.js';
	import { editModeStore } from '$lib/editModeStore.svelte.js';
	import { layoutStore } from '$lib/layoutStore.svelte.js';
	import { ringStore } from '$lib/ringStore.svelte.js';
	import { flyFade, outFade } from '$lib/transitions.js';
	import { SITE_ORIGIN } from '$lib/config.js';

	const SITE_DESCRIPTION =
		'A webring for indie creators: audio, comics and visual art, writing, and games.';

	// The real logo, same asset AboutModal and RingLoading already use, and
	// by the same served-path reference (files under static/ are not part
	// of the module graph). Not `Logo.svelte`'s abstract four-square mark,
	// which is the favicon's own icon, a deliberately different, simpler
	// thing from the actual logo — see docs/decisions.md.
	const LOGO_SRC = '/images/IndieNodes_Logo.webp';

	// `data` is not destructured: the layout load returns only `releases`, and
	// its one consumer (AboutModal) reads it from `page.data` directly rather
	// than being threaded a prop through the whole tree.
	let { children } = $props();

	// The sandboxed widget-embed target (src/routes/embed-frame) is not a
	// page of this app in any sense a visitor would recognize -- it is
	// loaded cross-origin inside a stranger's iframe, at whatever tiny size
	// they gave it. None of this app's chrome, ambient background, or
	// locally-scoped preferences belong there, and initializing them is not
	// just wasted work: this route is embedded via a sandbox with no
	// `allow-same-origin`, so it gets a forced opaque origin on every load,
	// and `preferencesStore`/`skinStore` reading and writing `localStorage`
	// against an origin that cannot persist anything is a real failure mode
	// to route around, not a redundancy to shrug off.
	const isEmbedFrame = $derived(page.url.pathname === resolve('/embed-frame'));

	$effect(() => {
		if (isEmbedFrame) return;
		return preferencesStore.init();
	});

	$effect(() => {
		if (isEmbedFrame) return;
		skinStore.init();
	});

	// One fetch for the whole app, started at the root so it is already in
	// flight whichever route the visitor landed on. Repeat calls are no-ops.
	$effect(() => {
		if (isEmbedFrame) return;
		ringStore.ensureLoaded();
	});

	const isField = $derived(page.url.pathname === resolve('/'));
	const isLists = $derived(page.url.pathname === resolve('/lists'));
	const isMembers = $derived(page.url.pathname === resolve('/members'));
	const isSettings = $derived(page.url.pathname === resolve('/settings'));
	const isContact = $derived(page.url.pathname === resolve('/contact'));

	// Nav is a right-side drawer on desktop (NavDrawer) and the existing
	// bottom tab bar on mobile; opening the drawer is the only thing that can
	// set this, and the trigger button that does so is itself hidden on
	// mobile. Guarded anyway: resizing down out of desktop width while it
	// happens to be open would otherwise leave it floating over the mobile
	// layout it has no role in.
	let drawerOpen = $state(false);

	$effect(() => {
		if (!drawerOpen) return;
		const query = window.matchMedia('(max-width: 64rem)');
		function handleChange() {
			if (query.matches) drawerOpen = false;
		}
		query.addEventListener('change', handleChange);
		return () => query.removeEventListener('change', handleChange);
	});

	// The mobile "+" trigger's own add/reset menu. Unlike the desktop
	// right-click menu (in +page.svelte) it carries no "Done arranging": the
	// bar's adjacent Arrange button already collapses back to the full bar in
	// one tap, so a second exit control here would be redundant.
	let mobileMenuPos = $state(/** @type {{ x: number, y: number } | null} */ (null));
	let mobileMoreOpen = $state(false);

	// Ambient mode is deliberately session-only. The one thing persisted is
	// the visitor's first-use acknowledgement that launching it plays audio,
	// exactly as locked in docs/decisions.md.
	const AMBIENT_CONSENT_KEY = STORAGE_KEYS.ambientConsent.key;
	let ambientOpen = $state(false);
	let ambientConsentOpen = $state(false);

	function hasAmbientConsent() {
		try {
			return localStorage.getItem(AMBIENT_CONSENT_KEY) === 'true';
		} catch {
			return false;
		}
	}

	function startAmbient() {
		drawerOpen = false;
		editModeStore.disable();
		ambientConsentOpen = false;
		ambientOpen = true;
	}

	function requestAmbient() {
		if (hasAmbientConsent()) {
			startAmbient();
		} else {
			ambientConsentOpen = true;
		}
	}

	// The one-time rating prompt. Counted once per session, and opened only
	// after the store says this browser has earned it — see
	// feedbackStore.svelte.js for the boundaries, and docs/decisions.md for why
	// a third dialog was accepted at all.
	let feedbackOpen = $state(false);

	// Counting is deliberately NOT in the $effect below. `countVisit` writes
	// `visits`, and that effect reads it through `eligible`, so doing both in
	// one place makes the effect retrigger itself — which loops forever on any
	// browser where the session guard cannot be written (a private window, a
	// full quota). onMount runs once and reads nothing reactive.
	onMount(() => feedbackStore.countVisit());

	// `?debug=rating-test` opens the prompt immediately, skipping the real
	// ten-visit wait — same `import.meta.env.DEV` + URL-param gate
	// AudioDebugPanel already uses, and the same reasoning: dev-only so
	// nothing reachable by a real visitor forces this. Bypasses `eligible`
	// entirely, including `answered`, so the same browser can retrigger it
	// on every reload without clearing storage in between.
	//
	// `?debug=rating-test-support` opens straight to the Ko-fi step instead
	// — the step a real visitor only reaches by rating first, and only when
	// VITE_KOFI_URL is actually set (see FeedbackPrompt's `send()`), which a
	// dev environment often has no reason to configure. `initialStep` is
	// FeedbackPrompt's own escape hatch for exactly this: previewing that
	// step's copy and layout without needing Ko-fi configured or a rating
	// actually sent.
	/** @type {Record<string, 'rating' | 'support'>} */
	const DEBUG_RATING_STEPS = { 'rating-test': 'rating', 'rating-test-support': 'support' };
	const debugRatingStep = $derived(
		import.meta.env.DEV ? DEBUG_RATING_STEPS[page.url.searchParams.get('debug') ?? ''] : undefined
	);

	$effect(() => {
		if (debugRatingStep) {
			feedbackOpen = true;
			return;
		}
		// Deferred past the ambient dialog and past first paint: arriving on top
		// of the page someone just opened is the difference between an ask and
		// an interruption.
		if (!feedbackStore.eligible || ambientConsentOpen || ambientOpen) return;
		const timer = setTimeout(() => {
			if (feedbackStore.eligible) feedbackOpen = true;
		}, 4000);
		return () => clearTimeout(timer);
	});

	function confirmAmbient() {
		try {
			localStorage.setItem(AMBIENT_CONSENT_KEY, 'true');
		} catch {
			// Consent still applies for this session if storage is unavailable.
		}
		startAmbient();
	}

	$effect(() => {
		if (!editModeStore.active) mobileMenuPos = null;
		if (editModeStore.active) mobileMoreOpen = false;
	});

	/** @param {MouseEvent} event */
	function openMobileAddMenu(event) {
		const rect = /** @type {HTMLElement} */ (event.currentTarget).getBoundingClientRect();
		mobileMenuPos = { x: rect.left, y: rect.top };
	}
</script>

<svelte:head>
	<!-- type is required, not decorative: without it, a browser has to sniff
	     the response to tell this is SVG rather than assume PNG like the two
	     app.html fallback links below, and at least one real browser gets
	     that wrong and falls back to those instead of this one. -->
	<link rel="icon" type="image/svg+xml" href={favicon} />

	<!-- Site-wide defaults: every route sets its own <title>, but none has a
	     reason to differ on description or preview image, so one block here
	     covers all of them without inventing per-page copy nobody asked for.
	     Absolute URLs built from SITE_ORIGIN rather than hardcoded, since a
	     relative og:image is not reliably resolved by the platforms that read
	     it and the origin is a build-time input now. -->
	<meta name="description" content={SITE_DESCRIPTION} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="IndieNodes" />
	<meta property="og:title" content="IndieNodes" />
	<meta property="og:description" content={SITE_DESCRIPTION} />
	<meta property="og:url" content="{SITE_ORIGIN}/" />
	<meta property="og:image" content="{SITE_ORIGIN}/icons/og-image.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="The IndieNodes logo: four rounded, color-coded nodes." />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="IndieNodes" />
	<meta name="twitter:description" content={SITE_DESCRIPTION} />
	<meta name="twitter:image" content="{SITE_ORIGIN}/icons/og-image.png" />
</svelte:head>

{#if isEmbedFrame}
	{@render children()}
{:else}
	{#if preferencesStore.background === 'drifty-stars'}
		<AmbientBackground variant="drifty-stars" />
	{/if}

	{#snippet arrangeButton()}
		{#if editModeStore.active}
			<div class="arrange-history" transition:flyFade={{ x: 12, duration: 180 }}>
				<button
					type="button"
					class="tool-button glass-panel"
					aria-label="Undo arrangement"
					title="Undo arrangement"
					disabled={!layoutStore.canUndo}
					onclick={() => layoutStore.undo()}
				>
					<svg
						viewBox="0 0 24 24"
						width="20"
						height="20"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path
							d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</button>
				<button
					type="button"
					class="tool-button glass-panel"
					aria-label="Redo arrangement"
					title="Redo arrangement"
					disabled={!layoutStore.canRedo}
					onclick={() => layoutStore.redo()}
				>
					<svg
						viewBox="0 0 24 24"
						width="20"
						height="20"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path
							d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</button>
			</div>
		{/if}
		<button
			type="button"
			class="tool-button glass-panel"
			class:active={editModeStore.active}
			aria-pressed={editModeStore.active}
			aria-label={editModeStore.active ? 'Done arranging' : 'Arrange field'}
			title={editModeStore.active ? 'Done arranging' : 'Arrange field'}
			onclick={() => editModeStore.toggle()}
		>
			<svg
				viewBox="0 0 24 24"
				width="20"
				height="20"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<rect x="3" y="3" width="7" height="7" rx="1.5" />
				<rect x="14" y="3" width="7" height="7" rx="1.5" />
				<rect x="3" y="14" width="7" height="7" rx="1.5" />
				<path d="M17.5 14.5v6M14.5 17.5h6" stroke-linecap="round" />
			</svg>
		</button>
	{/snippet}

	{#snippet ambientMark()}
		<svg
			viewBox="0 0 24 24"
			width="20"
			height="20"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			aria-hidden="true"
		>
			<path d="M4 16.5c2-5.7 4-5.7 6 0s4 5.7 6 0 4-5.7 4-5.7" stroke-linecap="round" />
			<path
				d="M4 9c1.4-3.4 2.9-3.4 4.3 0s2.9 3.4 4.3 0S15.5 5.6 17 9"
				stroke-linecap="round"
				opacity=".65"
			/>
		</svg>
	{/snippet}

	<div class="app-shell">
		<!-- Two small floating pills instead of a full-width bar, so nothing
	     reserves space in the page's own layout: `main` below gets the full
	     viewport height rather than "viewport minus the nav." The hamburger
	     trigger only exists at desktop width; mobile's nav is the bottom tab
	     bar further down, unchanged in kind, just carrying two more items. -->
		<a href={resolve('/')} class="brand-float glass-panel">
			<img src={LOGO_SRC} alt="" width="26" height="26" />
			<span class="brand-text">IndieNodes</span>
		</a>

		<button
			type="button"
			class="menu-trigger glass-panel"
			class:open={drawerOpen}
			aria-haspopup="dialog"
			aria-expanded={drawerOpen}
			aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
			onclick={() => (drawerOpen = !drawerOpen)}
		>
			<!-- Three bars that morph into an X via CSS transform rather than
		     swapping between two separate SVGs: swapping was instant, and
		     "animate when pressed" asked for the open/close itself to read as
		     motion, not just a change of state. -->
			<span class="bar bar-1" aria-hidden="true"></span>
			<span class="bar bar-2" aria-hidden="true"></span>
			<span class="bar bar-3" aria-hidden="true"></span>
		</button>

		{#if isField}
			<button
				type="button"
				class="ambient-trigger glass-panel"
				onclick={requestAmbient}
				aria-label="Start ambient view"
				title="Ambient view"
			>
				{@render ambientMark()}
				<span>Ambient</span>
			</button>
		{/if}

		<!-- Mobile's top-right cluster, mirroring where the hamburger sits on
	     desktop. Theme and Arrange live here rather than in the bottom bar
	     because neither is a destination: every other item in that bar changes
	     *where you are*, and these two change how the app looks and behaves.
	     Keeping them there also made the bar's item count depend on the route
	     (Arrange only exists on Field), so every navigation shifted the
	     remaining icons sideways under the thumb that had just tapped one. A
	     fixed cluster up here cannot move the destinations. -->
		<div class="mobile-tools">
			{#if isField}
				{@render arrangeButton()}
			{/if}
			<ThemeToggle variant="icon" />
		</div>

		<!-- Desktop's counterpart to .mobile-tools above: same two controls,
	     same reasoning (neither is a destination, so neither belongs inside
	     NavDrawer's list of places to go). Floating here rather than living
	     inside the drawer means they stay reachable without opening it, and
	     bottom-right keeps them clear of the brand mark and drawer trigger
	     both anchored to the top. Theme sits closest to the corner; Arrange
	     sits to its left. -->
		<div class="desktop-tools">
			{#if isField}
				{@render arrangeButton()}
			{/if}
			<ThemeToggle variant="icon" />
		</div>

		<NavDrawer open={drawerOpen} onClose={() => (drawerOpen = false)} />

		<AboutModal />

		<Modal
			open={ambientConsentOpen}
			title="Start ambient view?"
			onClose={() => (ambientConsentOpen = false)}
		>
			<p class="consent-copy">
				Ambient view can play audio while visual work fills the screen. Playback starts only when
				you press Play. This confirmation is shown only once on this device.
			</p>
			<div class="consent-actions">
				<button
					type="button"
					class="btn btn-secondary"
					onclick={() => (ambientConsentOpen = false)}
				>
					Not now
				</button>
				<button type="button" class="btn btn-primary" onclick={confirmAmbient}
					>Enter ambient view</button
				>
			</div>
		</Modal>

		<FeedbackPrompt
			open={feedbackOpen}
			onClose={() => (feedbackOpen = false)}
			initialStep={debugRatingStep === 'support' ? 'support' : undefined}
		/>

		<AmbientView open={ambientOpen} onClose={() => (ambientOpen = false)} />

		<!-- Mounted once here, not per card: the reader has to survive the node
	     that opened it rotating on to a different entry. See
	     comicViewerStore for the rest of the reasoning. -->
		<ComicViewer
			open={comicViewerStore.open}
			pages={comicViewerStore.entry?.type === 'art'
				? (comicViewerStore.entry?.artworks ?? [])
				: (comicViewerStore.entry?.pages ?? [])}
			creator={comicViewerStore.entry?.creator ?? ''}
			entryId={comicViewerStore.entry?.id ?? ''}
			kind={comicViewerStore.entry?.type === 'art' ? 'art' : 'comic'}
			initialPage={comicViewerStore.initialPage}
			onClose={() => comicViewerStore.hide()}
		/>

		<!-- Same single-mount reasoning as ComicViewer above, via its own
	     textViewerStore -- a separate store and reader rather than folding
	     into the one above, since that one's shape (pages, kind) and its
	     pan/zoom engine are image-specific with nothing for prose to reuse. -->
		<TextViewer
			open={textViewerStore.open}
			entry={textViewerStore.entry}
			onClose={() => textViewerStore.hide()}
		/>

		<!-- Layout-level, not on the field page: a queue has to keep playing while
	     the visitor moves between Field, Lists, and Members, and mounting
	     it per route would tear the audio element down on every navigation. -->
		<AudioPlayer entries={ringStore.entries} />
		<AudioDebugPanel />

		<main>
			{#key page.url.pathname}
				<div
					class="page-transition"
					in:flyFade={{ x: 14, duration: 220, delay: 70 }}
					out:outFade={{ duration: 120 }}
				>
					{@render children()}
				</div>
			{/key}
		</main>

		<nav
			class="nav-mobile glass-panel"
			class:player-open={audioPlayerStore.mobilePanelOpen}
			aria-hidden={audioPlayerStore.mobilePanelOpen}
			inert={audioPlayerStore.mobilePanelOpen}
			aria-label="Primary"
		>
			{#if isField && editModeStore.active}
				<!-- Arranging collapses the bar to just the two controls arranging
			     needs: the destinations underneath aren't reachable mid-drag
			     anyway, and the add/reset menu that used to sit in a permanent
			     bar above the grid belongs behind a tap, same as desktop's
			     right-click, not inline on a surface meant to show artwork. -->
				<button
					type="button"
					class="mobile-item active"
					aria-pressed="true"
					onclick={() => editModeStore.toggle()}
				>
					<svg
						viewBox="0 0 24 24"
						width="22"
						height="22"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<rect x="3" y="3" width="7" height="7" rx="1.5" />
						<rect x="14" y="3" width="7" height="7" rx="1.5" />
						<rect x="3" y="14" width="7" height="7" rx="1.5" />
						<path d="M17.5 14.5v6M14.5 17.5h6" stroke-linecap="round" />
					</svg>
					<span>Done</span>
				</button>
				<button
					type="button"
					class="mobile-item"
					aria-haspopup="menu"
					aria-expanded={mobileMenuPos !== null}
					onclick={openMobileAddMenu}
				>
					<svg
						viewBox="0 0 24 24"
						width="22"
						height="22"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path d="M12 5v14M5 12h14" stroke-linecap="round" />
					</svg>
					<span>Add</span>
				</button>
			{:else}
				{#if isField}
					<button type="button" class="mobile-item active" onclick={requestAmbient}>
						{@render ambientMark()}
						<span>Ambient</span>
					</button>
				{:else}
					<a href={resolve('/')} class="mobile-item">
						<svg
							viewBox="0 0 24 24"
							width="22"
							height="22"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path d="M3 11l9-7 9 7" stroke-linecap="round" stroke-linejoin="round" />
							<path
								d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
						<span>Field</span>
					</a>
				{/if}
				<a href={resolve('/lists')} class="mobile-item" class:active={isLists}>
					<svg
						viewBox="0 0 24 24"
						width="22"
						height="22"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path
							d="M12 20.5s-7.5-4.6-10-9.3C.4 8 1.7 4.5 5 3.4c2.1-.7 4.3.1 5.6 1.9L12 7l1.4-1.7c1.3-1.8 3.5-2.6 5.6-1.9 3.3 1.1 4.6 4.6 3 7.8-2.5 4.7-10 9.3-10 9.3Z"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					<span>Lists</span>
				</a>
				<a href={resolve('/members')} class="mobile-item" class:active={isMembers}>
					<svg
						viewBox="0 0 24 24"
						width="22"
						height="22"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="8.5" />
						<circle cx="12" cy="3.5" r="1.9" fill="currentColor" stroke="none" />
						<circle cx="20.5" cy="12" r="1.9" fill="currentColor" stroke="none" />
						<circle cx="12" cy="20.5" r="1.9" fill="currentColor" stroke="none" />
						<circle cx="3.5" cy="12" r="1.9" fill="currentColor" stroke="none" />
					</svg>
					<span>Members</span>
				</a>
				{#if !audioPlayerStore.isEmpty}
					<!-- This is the way back to the player after its in-player Hide
				     control restores the main navigation. While the player is open,
				     the entire nav is replaced by its transport row below rather than
				     competing with it for the same bottom-screen space. -->
					<button
						type="button"
						class="mobile-item mobile-audio-item"
						class:pulse={audioPlayerStore.playing}
						onclick={() => audioPlayerStore.openMobilePanel()}
						aria-label="Open audio player"
						aria-expanded="false"
					>
						<span class="mobile-audio-circle">
							<!-- A steady "now playing" mark, not a play triangle: this
						     control opens the player without changing playback. -->
							<svg
								viewBox="0 0 24 24"
								width="10"
								height="10"
								fill="currentColor"
								aria-hidden="true"
							>
								<rect x="4" y="10" width="3" height="6" rx="1" />
								<rect x="10.5" y="6" width="3" height="14" rx="1" />
								<rect x="17" y="12" width="3" height="4" rx="1" />
							</svg>
						</span>
						<span>Player</span>
					</button>
				{/if}
				<button
					type="button"
					class="mobile-item"
					class:active={mobileMoreOpen || isSettings || isContact}
					aria-haspopup="menu"
					aria-expanded={mobileMoreOpen}
					onclick={() => (mobileMoreOpen = !mobileMoreOpen)}
				>
					<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
						<circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle
							cx="19"
							cy="12"
							r="1.8"
						/>
					</svg>
					<span>More</span>
				</button>
			{/if}
		</nav>

		<MobileMoreMenu open={mobileMoreOpen} onClose={() => (mobileMoreOpen = false)} />

		{#if mobileMenuPos}
			<ArrangeMenu
				x={mobileMenuPos.x}
				y={mobileMenuPos.y}
				onAdd={(type) => layoutStore.add(type)}
				onReset={() => layoutStore.reset()}
				onClose={() => (mobileMenuPos = null)}
			/>
		{/if}
	</div>
{/if}

<style>
	.app-shell {
		min-height: 100vh;
	}

	/* Floating rather than in-flow, on purpose: this is the actual point of
     the whole restructure. A full-width header bar, even a short one,
     still reserves real space above `main` in the page's own layout; a
     `position: fixed` pill does not, so the field view's node canvas gets
     the full viewport height instead of "viewport minus the nav." */
	.brand-float {
		position: fixed;
		top: 1.2rem;
		left: 1.2rem;
		z-index: 10;
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.65rem 1rem;
		color: var(--text);
		text-decoration: none;
		/* Off by default so the glow itself is what announces the hover,
		   rather than popping in at full strength on the first frame. */
		box-shadow: 0 0 0 0 color-mix(in oklch, var(--accent) 55%, transparent);
		transition: box-shadow 200ms ease;
	}

	.brand-float img {
		border-radius: var(--radius-sm);
	}

	.brand-float:hover,
	.brand-float:focus-visible {
		animation: brand-pulse 1.8s ease-in-out infinite;
	}

	@keyframes brand-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 color-mix(in oklch, var(--accent) 45%, transparent);
		}
		50% {
			box-shadow: 0 0 1.1rem 0.2rem color-mix(in oklch, var(--accent) 45%, transparent);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.brand-float:hover,
		.brand-float:focus-visible {
			animation: none;
			box-shadow: 0 0 0.8rem 0.1rem color-mix(in oklch, var(--accent) 45%, transparent);
		}
	}

	.brand-text {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--text-base);
	}

	.menu-trigger {
		position: fixed;
		top: 1.2rem;
		right: 1.2rem;
		/* Above NavDrawer's own backdrop (100) and panel (101): this button
       doubles as the close control while the drawer is open (its bars
       morph into an X), so it has to stay clickable and visible above both
       rather than being covered the moment the backdrop appears. */
		z-index: 102;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 3rem;
		height: 3rem;
		padding: 0;
		border: none;
		color: var(--text);
		cursor: pointer;
		transition: transform 120ms ease;
	}

	.menu-trigger:active {
		transform: scale(0.9);
	}

	.bar {
		position: absolute;
		left: 50%;
		width: 1.15rem;
		height: 2px;
		border-radius: 999px;
		background: currentColor;
		transform: translateX(-50%);
		transition:
			top 220ms ease,
			transform 220ms ease,
			opacity 150ms ease;
	}

	.bar-1 {
		top: calc(50% - 0.35rem);
	}
	.bar-2 {
		top: 50%;
	}
	.bar-3 {
		top: calc(50% + 0.35rem);
	}

	.menu-trigger.open .bar-1 {
		top: 50%;
		transform: translateX(-50%) rotate(45deg);
	}
	.menu-trigger.open .bar-2 {
		opacity: 0;
		transform: translateX(-50%) scale(0);
	}
	.menu-trigger.open .bar-3 {
		top: 50%;
		transform: translateX(-50%) rotate(-45deg);
	}

	@media (prefers-reduced-motion: reduce) {
		.menu-trigger,
		.bar {
			transition-duration: 1ms;
		}
	}

	.menu-trigger:hover {
		color: var(--accent);
	}

	/* Beside the hamburger as documented, with a text label because a bare
	   waveform icon does not communicate that this launches a distinct mode.
	   First-use audio consent still happens in the dialog above. */
	.ambient-trigger {
		position: fixed;
		top: 1.2rem;
		right: 5rem;
		z-index: 10;
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		height: 3rem;
		padding: 0 0.9rem;
		border: none;
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 700;
		cursor: pointer;
	}

	.ambient-trigger:hover,
	.ambient-trigger:focus-visible {
		color: var(--accent);
	}

	.consent-copy {
		margin: 0;
		color: var(--text-muted);
	}

	.consent-actions {
		display: flex;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}

	main {
		position: relative;
		min-height: 100vh;
		/* flyFade slides the incoming page in from translateX(14px); without
       this, that transient offset pokes past the viewport edge and
       triggers a horizontal scrollbar for the ~200ms of the transition. */
		overflow-x: hidden;
	}

	/* Padding lives here, not on main. An absolutely positioned child's
     containing block is its ancestor's padding box, not its content box,
     so inset: 0 on the outgoing element during outFade would ignore
     padding on main and land 1rem too high. Owning the padding at this
     level keeps both the static (incoming) and absolute (outgoing) states
     consistent.
     Top padding clears the floating brand/menu pills above (their own
     1.2rem offset plus their own height), at every width: the brand mark
     floats on mobile too, just without its text. */
	.page-transition {
		padding: 5.5rem 1.65rem 1.65rem;
	}

	/* ---------------------------------------------------- mobile nav bar ---
   * A fixed bottom tab bar, not a hamburger drawer here too: this product
   * is mobile-app-adjacent (tap-and-go through nodes), and a thumb reaches
   * the bottom of the screen far more easily one-handed than the top, so
   * the primary destinations get to stay one tap away rather than two.
   * Arrange and the theme control are destinations-adjacent but not
   * destinations themselves, so they sit in .mobile-tools instead of in
   * this bar (see that rule's own comment above, and .desktop-tools for
   * the equivalent floating cluster above this breakpoint).
   * Hidden entirely above the breakpoint, where the drawer trigger takes
   * over.
   *
   * Switches at 64rem, kept from when this measured the desktop nav row's
   * own crowding (it doesn't carry that row any more, but 64rem still
   * reads as the right general narrow/wide split and nothing has argued
   * for moving it). Deliberately NOT the same breakpoint the field grid
   * uses to collapse to one column; see FieldGrid.
   */
	.nav-mobile {
		display: none;
	}

	/* Desktop's own floating bottom-right cluster (see .desktop-tools below)
	   takes over from here; mobile gets its own top-right cluster instead
	   (.mobile-tools), covered by the @media block below. */
	.mobile-tools {
		display: none;
	}

	/* A ring expanding outward and fading, not the previous slow in-place
	   glow: an attention cue for something not currently in view should read
	   as "notice me," which a ripple communicates in one glance where a soft
	   breathing pulse reads as ambient decoration. ease-out matches that —
	   a sharp, immediate start with a gentle fade at the outer edge, rather
	   than easing symmetrically in both directions. */
	@keyframes mobile-audio-pulse {
		0% {
			box-shadow: 0 0 0 0 color-mix(in oklch, var(--accent) 55%, transparent);
		}
		70% {
			box-shadow: 0 0 0 0.65rem color-mix(in oklch, var(--accent) 0%, transparent);
		}
		100% {
			box-shadow: 0 0 0 0 color-mix(in oklch, var(--accent) 0%, transparent);
		}
	}

	/* Shared by both clusters (mobile's top-right .mobile-tools and
	   desktop's bottom-right .desktop-tools below), so the button looks and
	   behaves identically in either position — not scoped inside either
	   breakpoint's own @media block, since both need it now. */
	.tool-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		height: 2.75rem;
		padding: 0;
		border: none;
		color: var(--text);
		cursor: pointer;
		transition: transform 120ms ease;
	}

	.tool-button:active {
		transform: scale(0.9);
	}

	.tool-button.active {
		color: var(--accent);
	}

	.arrange-history {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.tool-button:disabled {
		opacity: 0.4;
		cursor: default;
		pointer-events: none;
	}

	/* Bottom-right counterpart to the top-left brand mark and top-right
	   drawer trigger: Theme sits closest to the corner (last in DOM order,
	   so rightmost in this row), Arrange to its left when the Field route
	   makes it relevant. Hidden below 64rem, where .mobile-tools (top-right)
	   carries both instead. */
	.desktop-tools {
		position: fixed;
		bottom: 1.2rem;
		right: 1.2rem;
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	@media (max-width: 64rem) {
		.brand-text {
			display: none;
		}

		.menu-trigger {
			display: none;
		}

		.ambient-trigger {
			display: none;
		}

		.desktop-tools {
			display: none;
		}

		.mobile-tools {
			position: fixed;
			top: 1.2rem;
			right: 1.2rem;
			/* Under the drawer's backdrop (100) rather than above it: unlike the
			   hamburger these are not close controls, and the drawer does not
			   open on mobile anyway. */
			z-index: 20;
			display: flex;
			align-items: center;
			gap: 0.5rem;
		}

		.nav-mobile {
			display: flex;
			position: fixed;
			left: 0.75rem;
			right: 0.75rem;
			bottom: 0.75rem;
			z-index: 20;
			padding: 0.5rem 0.25rem calc(0.5rem + env(safe-area-inset-bottom));
			border-radius: var(--radius-lg);
			justify-content: space-around;
			transition:
				opacity 160ms ease,
				transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
		}

		.nav-mobile.player-open {
			opacity: 0;
			transform: translateY(calc(100% + 1rem));
			pointer-events: none;
		}

		.mobile-item {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 0.2rem;
			flex: 1;
			padding: 0.4rem 0.2rem;
			background: none;
			border: none;
			color: var(--text-muted);
			font-family: inherit;
			font-size: 0.75rem;
			text-decoration: none;
			cursor: pointer;
		}

		.mobile-item.active {
			color: var(--accent);
		}

		/* .mobile-item already supplies the flex-column layout, gap, base
		   color, and .active -> accent color every sibling nav item uses;
		   this only adds what's specific to the circle + its pulse. Sized
		   and aligned to sit inside the bar like every other item's icon,
		   not raised above it as a floating FAB: that treatment fit the old
		   design where the circle *was* the primary play/pause action, but
		   this control is a peer nav toggle now, and a badge oversized
		   enough to need a negative margin to fit reads as clipping outside
		   the bar rather than as emphasis. */
		.mobile-audio-item {
			position: relative;
			min-width: 0;
		}

		/* 1.375rem (22px) matches every sibling icon's own box exactly, so
		   the label after it lands on the same baseline as theirs instead
		   of being pushed down by a taller icon slot. */
		.mobile-audio-circle {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 1.375rem;
			height: 1.375rem;
			border-radius: 999px;
			background: var(--accent);
			color: white;
		}

		.mobile-audio-item.pulse .mobile-audio-circle {
			animation: mobile-audio-pulse 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
		}

		/* So content never sits underneath the fixed bottom bar. */
		main {
			padding-bottom: 5.5rem;
		}
	}

	@media (max-width: 64rem) and (prefers-reduced-motion: reduce) {
		.mobile-audio-item.pulse .mobile-audio-circle {
			animation: none;
			box-shadow: 0 0 0.8rem 0.15rem color-mix(in oklch, var(--accent) 50%, transparent);
		}
	}
</style>
