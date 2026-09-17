<script>
	import { onMount, untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { SvelteSet } from 'svelte/reactivity';
	import FieldNode from '../../../components/FieldNode.svelte';
	import { favoritesStore } from '$lib/favoritesStore.svelte.js';
	import { hiddenStore } from '$lib/hiddenStore.svelte.js';
	import { ringStore } from '$lib/ringStore.svelte.js';
	import { preferencesStore } from '$lib/preferencesStore.svelte.js';
	import { isVisibleTo } from '$lib/ring.js';
	import { flyFade, outFade } from '$lib/transitions.js';
	import Modal from '../../../components/Modal.svelte';

	// Brief section 8: "the surface previously called Favorites becomes
	// Lists, with two tabs: liked entries and Not for Me entries." Settings'
	// own tab pattern is reused here rather than invented fresh (roadmap.md
	// already points at it for the next thing that needed tabs on this page).
	const TABS = [
		{ id: 'liked', label: 'Liked' },
		{ id: 'not-for-me', label: 'Not for Me' }
	];
	let activeTab = $state('liked');

	/** The entry awaiting confirmation, or null. @type {import('$lib/ring.js').RingEntry | null} */
	let pendingUnlike = $state(null);

	function confirmUnlike() {
		if (!pendingUnlike) return;
		favoritesStore.toggle(pendingUnlike.id);
		pendingUnlike = null;
	}

	// Same first-load stagger as the field view (`src/routes/+page.svelte`);
	// see the comment there for why both a CSS animation and a Svelte
	// transition are needed together.
	const STAGGER_STEP_MS = 45;

	let firstLoad = $state(true);

	onMount(() => {
		const timer = setTimeout(() => (firstLoad = false), 900);
		return () => clearTimeout(timer);
	});

	// Liking or dismissing something does not exempt it from the explicit
	// filter: turning the filter back on should hide it here too, otherwise
	// the setting quietly means "except the ones you already found."
	const liked = $derived(
		ringStore.entries.filter(
			(entry) =>
				favoritesStore.isLiked(entry.id) && isVisibleTo(entry, preferencesStore.showExplicit)
		)
	);
	const dismissed = $derived(
		ringStore.entries.filter(
			(entry) => hiddenStore.isHidden(entry.id) && isVisibleTo(entry, preferencesStore.showExplicit)
		)
	);

	const activeEntries = $derived(activeTab === 'liked' ? liked : dismissed);

	// ------------------------------------------------------------- bulk ---

	let selectMode = $state(false);
	const selectedIds = new SvelteSet();

	/**
	 * The index (into `activeEntries`) of the last card clicked without
	 * Shift, i.e. the anchor a following Shift-click range-selects against.
	 * Plain state, not derived from `selectedIds`: the anchor is "where you
	 * last clicked," not "what's currently selected," and those can diverge
	 * (Select all sets neither, a stale prune can remove the anchor's own
	 * entry without moving the anchor itself).
	 * @type {number | null}
	 */
	let anchorIndex = $state(null);

	/** The count of selected entries awaiting bulk-unlike confirmation, or 0. */
	let pendingBulkUnlikeCount = $state(0);

	/** @param {string} id */
	function toggleSelected(id) {
		if (selectedIds.has(id)) selectedIds.delete(id);
		else selectedIds.add(id);
	}

	/**
	 * A plain click toggles just this card and becomes the new anchor. A
	 * Shift-click selects every card between the anchor and this one
	 * (inclusive), adding to whatever is already selected rather than
	 * replacing it — Shift-click is additive-only here, so it can never be
	 * the thing that quietly deselects something a plain click already
	 * chose.
	 * @param {string} id
	 * @param {number} index
	 * @param {MouseEvent} event
	 */
	function handleCardSelect(id, index, event) {
		if (event.shiftKey && anchorIndex !== null) {
			const [start, end] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
			for (let i = start; i <= end; i += 1) {
				selectedIds.add(activeEntries[i].id);
			}
		} else {
			toggleSelected(id);
		}
		anchorIndex = index;
	}

	function selectAll() {
		for (const entry of activeEntries) selectedIds.add(entry.id);
	}

	function clearSelection() {
		selectedIds.clear();
	}

	function exitSelectMode() {
		selectMode = false;
		selectedIds.clear();
		anchorIndex = null;
	}

	/** Bulk un-like is destructive the same way a single one is (the entry
	    leaves Lists altogether if it wasn't also hidden), so it goes through
	    the same kind of confirmation, just counted rather than named. */
	function requestBulkUnlike() {
		if (selectedIds.size === 0) return;
		pendingBulkUnlikeCount = selectedIds.size;
	}

	function confirmBulkUnlike() {
		for (const id of selectedIds) favoritesStore.toggle(id);
		pendingBulkUnlikeCount = 0;
		exitSelectMode();
	}

	/** Restoring is never destructive (same reasoning as the single-entry
	    hide toggle: it only ever moves an entry back into rotation), so
	    bulk restore needs no confirmation either. */
	function bulkRestore() {
		if (selectedIds.size === 0) return;
		for (const id of selectedIds) hiddenStore.toggle(id);
		exitSelectMode();
	}

	// A selected id can go stale without the visitor ever touching the bulk
	// bar: liking/hiding a card individually while select mode is on, the
	// mutual-exclusion side effects in FieldNode's own handlers, or the
	// explicit-content filter changing underneath the list. Pruning against
	// `activeEntries` on every change is what keeps a later bulk action from
	// ever toggling an id that no longer means what the selection thought it
	// meant.
	$effect(() => {
		const validIds = new Set(activeEntries.map((entry) => entry.id));
		// untrack: this both reads and prunes `selectedIds`, so without it the
		// effect would depend on its own writes and re-run an extra, wasted
		// time on every actual prune — the same trap `src/routes/+page.svelte`
		// already documents for `reconcile()`.
		untrack(() => {
			for (const id of [...selectedIds]) {
				if (!validIds.has(id)) selectedIds.delete(id);
			}
		});
	});

	// Selection is scoped to whichever list is on screen: switching tabs
	// exits select mode rather than leaving a selection bar that no longer
	// describes what's in view.
	$effect(() => {
		activeTab;
		exitSelectMode();
	});
</script>

<svelte:head>
	<title>Lists, IndieNodes</title>
</svelte:head>

<div class="lists-page">
	<h1>Lists</h1>
	<p class="lede">
		Liked and Not for Me entries, stored only in this browser's local storage. Nothing here is sent
		to a server.
	</p>

	<div class="tabs" role="tablist" aria-label="Lists">
		{#each TABS as tab (tab.id)}
			<button
				type="button"
				role="tab"
				id="lists-tab-{tab.id}"
				aria-selected={activeTab === tab.id}
				aria-controls="lists-panel-{tab.id}"
				class="tab"
				class:active={activeTab === tab.id}
				onclick={() => (activeTab = tab.id)}
			>
				{tab.label}
				{#if tab.id === 'liked' && liked.length > 0}
					<span class="tab-count">{liked.length}</span>
				{:else if tab.id === 'not-for-me' && dismissed.length > 0}
					<span class="tab-count">{dismissed.length}</span>
				{/if}
			</button>
		{/each}
	</div>

	{#if activeEntries.length > 0}
		<div class="select-bar">
			{#if !selectMode}
				<button type="button" class="select-toggle" onclick={() => (selectMode = true)}>
					Select
				</button>
			{:else}
				<span class="select-count">{selectedIds.size} selected</span>
				<button
					type="button"
					class="select-link"
					onclick={selectAll}
					disabled={selectedIds.size === activeEntries.length}
				>
					Select all
				</button>
				<button
					type="button"
					class="select-link"
					onclick={clearSelection}
					disabled={selectedIds.size === 0}
				>
					Clear
				</button>
				<div class="select-spacer"></div>
				{#if activeTab === 'liked'}
					<button
						type="button"
						class="bulk-action bulk-danger"
						disabled={selectedIds.size === 0}
						onclick={requestBulkUnlike}
					>
						Remove from Liked
					</button>
				{:else}
					<button
						type="button"
						class="bulk-action"
						disabled={selectedIds.size === 0}
						onclick={bulkRestore}
					>
						Restore
					</button>
				{/if}
				<button type="button" class="select-toggle" onclick={exitSelectMode}>Cancel</button>
			{/if}
		</div>
	{/if}

	<div class="panel-container">
		{#key activeTab}
			<div
				role="tabpanel"
				id="lists-panel-{activeTab}"
				aria-labelledby="lists-tab-{activeTab}"
				in:fade={{ duration: 120 }}
				out:outFade={{ duration: 120 }}
			>
				{#if activeEntries.length === 0 && !ringStore.settled}
					<!-- Ids live in local storage but the entries they point at come
					     from the ring, which is now fetched in the browser. Without
					     this, someone with either list would be told it was empty for
					     a moment. -->
					<div class="empty-state">
						<p>Loading the ring…</p>
					</div>
				{:else if activeEntries.length === 0}
					<div class="empty-state">
						{#if activeTab === 'liked'}
							<p>Nothing liked yet. Tap the heart on any node in the Field to add it here.</p>
						{:else}
							<p>
								Nothing marked Not for Me yet. Tap the eye-slash icon on any node in the Field to
								add it here.
							</p>
						{/if}
					</div>
				{:else}
					<div class="field" class:first-load={firstLoad}>
						{#each activeEntries as entry, i (entry.id)}
							<div
								class="node-slot"
								class:selected={selectMode && selectedIds.has(entry.id)}
								style:animation-delay={`${i * STAGGER_STEP_MS}ms`}
								in:flyFade={{ y: 20, duration: 320, delay: i * STAGGER_STEP_MS }}
							>
								<!-- `inert` while selecting, rather than leaving Visit/like/
								     hide/play reachable underneath the overlay below: a
								     keyboard user tabbing past would otherwise land on a
								     control that's invisible under the overlay but still
								     fires (a real link navigating, a real like toggling) the
								     moment it's activated. `inert` removes the whole subtree
								     from both focus and pointer interaction at once, rather
								     than something bespoke per control. -->
								<div class="node-content" inert={selectMode}>
									<FieldNode {entry} onUnlikeRequest={(target) => (pendingUnlike = target)} />
								</div>
								{#if selectMode}
									<!-- Covers the whole card: a plain click toggles just this
									     one and becomes the new range anchor; a Shift-click
									     selects everything between the anchor and here. Visit/
									     like/hide are inert underneath for the duration (see
									     `.node-content` above), so this is the only thing a
									     click on the card can do while selecting. -->
									<button
										type="button"
										class="select-overlay"
										onclick={(event) => handleCardSelect(entry.id, i, event)}
										aria-pressed={selectedIds.has(entry.id)}
										aria-label={selectedIds.has(entry.id)
											? `Deselect ${entry.creator}`
											: `Select ${entry.creator}`}
									>
										<span class="select-check" class:checked={selectedIds.has(entry.id)}>
											<svg
												viewBox="0 0 24 24"
												width="14"
												height="14"
												fill="none"
												stroke="currentColor"
												stroke-width="2.5"
												aria-hidden="true"
											>
												<path d="M5 12l5 5L19 7" stroke-linecap="round" stroke-linejoin="round" />
											</svg>
										</span>
									</button>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/key}
	</div>
</div>

<!-- The app's own dialog, not window.confirm(). A browser confirm is modal to
     the whole tab, cannot be styled or themed, reads as a security prompt
     rather than a question from this page, and on some platforms shows the
     origin next to it. This is a small question about a card the visitor is
     looking at, so it should look like it came from the card. Reuses the same
     Modal every other overlay here uses.

     Only guards a bare un-like. Marking a liked entry Not for Me also drops
     the like (the two are mutually exclusive, brief section 8) but doesn't
     go through this dialog: that entry moves to the Not for Me tab rather
     than leaving this page altogether, so there's nothing here to lose. -->
<Modal
	open={pendingUnlike !== null}
	title="Remove from your Liked list?"
	onClose={() => (pendingUnlike = null)}
>
	<p class="confirm-text">
		<strong>{pendingUnlike?.creator}</strong>
		will be removed from your Liked list. It stays in the ring, and you can like it again if you find
		it.
	</p>
	<div class="confirm-actions">
		<button type="button" class="confirm-no" onclick={() => (pendingUnlike = null)}>Keep it</button>
		<button type="button" class="confirm-yes" onclick={confirmUnlike}>Remove</button>
	</div>
</Modal>

<!-- Bulk un-like's own confirmation, same reasoning as the single one above,
     just counted rather than named: several entries leaving the Liked tab at
     once is the same kind of loss, only bigger. -->
<Modal
	open={pendingBulkUnlikeCount > 0}
	title={`Remove ${pendingBulkUnlikeCount} from your Liked list?`}
	onClose={() => (pendingBulkUnlikeCount = 0)}
>
	<p class="confirm-text">
		{pendingBulkUnlikeCount}
		{pendingBulkUnlikeCount === 1 ? 'entry' : 'entries'} will be removed from your Liked list. They stay
		in the ring, and you can like them again if you find them.
	</p>
	<div class="confirm-actions">
		<button type="button" class="confirm-no" onclick={() => (pendingBulkUnlikeCount = 0)}>
			Keep them
		</button>
		<button type="button" class="confirm-yes" onclick={confirmBulkUnlike}>Remove</button>
	</div>
</Modal>

<style>
	.confirm-text {
		color: var(--text);
	}

	.confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
		margin-top: 1.6rem;
	}

	.confirm-yes,
	.confirm-no {
		padding: 0.55rem 1.1rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}

	.confirm-no:hover {
		background: var(--glass-bg);
	}

	/* The destructive action carries the weight, and it is the one tinted
	   red: the safe choice should not be the one that looks like the button
	   you are meant to press. */
	.confirm-yes {
		border-color: #e0455f;
		background: #e0455f;
		color: #fff;
	}

	.confirm-yes:hover {
		filter: brightness(1.1);
	}

	/* Wider than the 52rem this page used to be capped at, which only ever
	   comfortably fit two columns: three needs the room. */
	.lists-page {
		max-width: 78rem;
		margin: 0 auto;
	}

	.lede {
		color: var(--text-muted);
		margin-bottom: 2rem;
	}

	/* Same tab styling as Settings (src/routes/settings/+page.svelte), reused
	   rather than reinvented. */
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 2rem;
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

	.tab-count {
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: var(--bg-elevated);
		color: var(--text-muted);
		font-size: var(--text-xs);
		font-weight: 700;
	}

	.tab.active .tab-count {
		color: var(--accent);
	}

	/* Required by `outFade` (`$lib/transitions.js`): the outgoing tabpanel
	   goes `position: absolute` for the length of its own exit, so it needs a
	   positioned ancestor to anchor against. Without this, switching tabs
	   left the outgoing panel positioning against a far-off ancestor instead
	   (nothing closer was ever `position: relative`), which is what read as
	   a node "popping really big" rather than fading out in place.
	   `min-height` lives here rather than on `.panel`, for the same reason
	   Settings' own version of this does: once the outgoing panel goes
	   absolute it stops contributing to this element's height. */
	.panel-container {
		position: relative;
		min-height: 20rem;
	}

	.select-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.7rem;
		margin-bottom: 1.2rem;
		min-height: 2.2rem;
	}

	.select-spacer {
		flex: 1;
	}

	.select-toggle {
		padding: 0.4rem 0.8rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}

	.select-toggle:hover {
		background: var(--glass-bg);
	}

	.select-count {
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.select-link {
		padding: 0;
		border: none;
		background: none;
		color: var(--accent);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}

	.select-link:hover:not(:disabled) {
		text-decoration: underline;
	}

	.select-link:disabled {
		color: var(--text-faint);
		cursor: not-allowed;
	}

	.bulk-action {
		padding: 0.4rem 0.9rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--accent);
		background: var(--accent);
		color: var(--bg-elevated);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 700;
		cursor: pointer;
	}

	.bulk-action:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	.bulk-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Same red as the single-unlike confirm's own destructive button
	   (`.confirm-yes`), for the same reason: this is the one bulk action
	   that removes entries from the surface entirely rather than moving
	   them to the other tab. */
	.bulk-action.bulk-danger {
		border-color: #e0455f;
		background: #e0455f;
	}

	.empty-state {
		padding: 3rem;
		text-align: center;
		border-radius: var(--radius-lg);
		border: 1px dashed var(--border);
		color: var(--text-muted);
	}

	.node-slot {
		position: relative;
		min-width: 0;
	}

	/* A visible ring around a selected card, since the checkbox alone (top
	   corner, easy to miss at a glance across a grid) shouldn't be the only
	   sign that a card counts toward the bulk action below. */
	.node-slot.selected {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
		border-radius: var(--radius-lg);
	}

	/* The card's own content, `inert` while selecting (see the template
	   comment). No layout role of its own beyond what FieldNode already
	   brings — this div exists only to carry the `inert` attribute. */
	.node-content {
		height: 100%;
	}

	/* Covers the card completely so the whole thing is one click target,
	   above `.node-content` (which is inert anyway while this is showing) and
	   above the card's own chrome. A plain, unstyled button rather than
	   giving it a visible fill: the card underneath still needs to read as
	   itself, just with a checkmark and a selection ring layered on. */
	.select-overlay {
		position: absolute;
		inset: 0;
		z-index: 5;
		border: none;
		border-radius: var(--radius-lg);
		padding: 0;
		background: transparent;
		cursor: pointer;
	}

	/* Floats off the card's own top-left corner rather than sitting inside
	   its padding, which is exactly where the type badge already lives —
	   overlapping it made both unreadable. A `<span>`, not a button: the
	   whole `.select-overlay` it sits inside is already the click target. */
	.select-check {
		position: absolute;
		top: -0.55rem;
		left: -0.55rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 999px;
		border: 2px solid var(--bg-elevated);
		background: var(--text-faint);
		color: transparent;
		box-shadow: var(--glass-shadow);
	}

	.select-check.checked {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}

	.field.first-load .node-slot {
		animation: node-stagger-in 320ms ease-out both;
	}

	@keyframes node-stagger-in {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.field.first-load .node-slot {
			animation-duration: 120ms;
			animation-delay: 0ms !important;
		}
	}

	.field {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.6rem;
	}

	/* Two columns at tablet width, matching the field view's own breakpoint
	   (src/routes/+page.svelte) — three would be cramped before there's
	   room for it. */
	@media (min-width: 40rem) {
		.field {
			grid-template-columns: repeat(2, 1fr);
			gap: 2rem;
		}
	}

	/* Three columns once the wider `.lists-page` container actually has the
	   room, so more of a list is visible without scrolling. This page's own
	   plain grid, unlike the field view's drag-arranged one, so there is no
	   fixed card size to match here — three narrower columns read better
	   than two wide ones once space allows it. */
	@media (min-width: 64rem) {
		.field {
			grid-template-columns: repeat(3, 1fr);
		}
	}
</style>
