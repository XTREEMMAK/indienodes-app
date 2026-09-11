<script>
	import { onMount, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import FieldGrid from '../components/FieldGrid.svelte';
	import FieldSlot from '../components/FieldSlot.svelte';
	import ArrangeMenu from '../components/ArrangeMenu.svelte';
	import RingLoading from '../components/RingLoading.svelte';
	import EmptyNode from '../components/EmptyNode.svelte';
	import NodeConfig from '../components/NodeConfig.svelte';
	import { aboutModalStore } from '$lib/aboutModalStore.svelte.js';
	import { createDecks } from '$lib/entryDeck.js';
	import { filtersStore } from '$lib/filtersStore.svelte.js';
	import { hiddenStore } from '$lib/hiddenStore.svelte.js';
	import { layoutStore } from '$lib/layoutStore.svelte.js';
	import { MIN_W } from '$lib/nodeShape.js';
	import { channelKey, matchesTags, matchesType } from '$lib/nodeChannel.js';
	import { editModeStore } from '$lib/editModeStore.svelte.js';
	import { preferencesStore } from '$lib/preferencesStore.svelte.js';
	import { coverImageUrl, isVisibleTo } from '$lib/ring.js';
	import { ringStore } from '$lib/ringStore.svelte.js';
	import { preload } from '$lib/imagePreloader.js';
	import { EARLY_ACCESS } from '$lib/config.js';

	// Seconds-on-screen now comes from the visitor's own per-type setting
	// (preferences.js `DEFAULT_ROTATION_MS`, adjustable in Settings), not one
	// global constant, per brief section 7c: a track is sampled in seconds and
	// a comic page has to be read, so one interval cannot serve both. Each
	// node still jitters its own value per cycle and staggers its first one
	// (FieldSlot), so nodes of the same type drift apart rather than rotating
	// in lockstep.
	let pageVisible = $state(true);

	// The toggle lives in the header (see editModeStore for why), so this
	// page reads the mode rather than owning it.
	const editMode = $derived(editModeStore.active);

	// Add-node/reset/exit live in a menu summoned on demand rather than a bar
	// sitting permanently over the field: null when closed, viewport
	// coordinates when open. Desktop opens it with a right-click anywhere on
	// the field surface, in *either* mode: outside arrange it collapses to a
	// single "Arrange field" entry (see ArrangeMenu), which is what makes
	// right-click a quick way in and out rather than something that only
	// works once you are already arranging.
	let menuPos = $state(/** @type {{ x: number, y: number } | null} */ (null));
	let fieldGrid = $state(/** @type {any} */ (null));

	/**
	 * Adds a node where the menu was opened rather than at the field's
	 * origin. The position is read before `layoutStore.add` runs because the
	 * menu closes itself on choosing an option, which clears `menuPos`.
	 * @param {import('$lib/nodeShape.js').NodeType} type
	 */
	function addNodeAtMenu(type) {
		const at = menuPos ? fieldGrid?.cellFromPoint(menuPos.x, menuPos.y, MIN_W) : undefined;
		layoutStore.add(type, at);
	}

	/**
	 * Last mode the menu was reconciled against. A plain variable, not
	 * `$state`, so comparing it cannot itself become a reactive dependency,
	 * matching the `lastSignature` pattern further down this file. Seeded
	 * with the mode's known initial value rather than by reading the derived
	 * here, which would only capture that first value anyway and reads as a
	 * mistake to anyone (or any linter) checking for exactly that.
	 */
	let lastEditMode = false;

	// Closed on any mode change, in both directions: the menu's contents
	// differ per mode, so leaving it open across a switch would leave
	// controls for the mode that just ended sitting on screen.
	$effect(() => {
		if (editMode === lastEditMode) return;
		lastEditMode = editMode;
		menuPos = null;
	});

	/** @param {MouseEvent} event */
	function handleContextMenu(event) {
		// Links keep their native menu: right-clicking a card's Visit button to
		// open a creator's site in a new tab is a real thing to want, and
		// swallowing it to offer "Arrange field" instead would be a bad trade.
		if (/** @type {HTMLElement} */ (event.target).closest('a')) return;
		event.preventDefault();
		menuPos = { x: event.clientX, y: event.clientY };
	}

	onMount(() => {
		// One listener for the whole field rather than one per node; each node
		// folds this into its own pause state alongside its hover and focus.
		function handleVisibilityChange() {
			pageVisible = document.visibilityState === 'visible';
		}
		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
	});

	// Three layers, narrowing in order, and they are different kinds of thing.
	//
	// `visibleEntries` applies the explicit gate: what is eligible to be in a
	// pool at all. Not a preference to be shaped, which is why it is applied
	// first and separately, and why it does not live in `filtersStore`.
	//
	// `entries` then applies the visitor's global tag preference — the broad
	// "not this, anywhere" layer. A node's own tags narrow further still,
	// per channel, in `poolsByChannel` below. Both tag layers are the
	// visitor's, both are local-only, and an empty selection at either adds
	// no restriction. The global layer was once slated for removal when tags
	// moved onto nodes; it stays, and the empty-node explanation in
	// `shortageCause` is what makes the two legible together rather than
	// leaving a node mysteriously empty (docs/decisions.md).
	//
	// `hiddenStore` is deliberately NOT part of this filter, unlike the two
	// above it. `entries` (and `byId`, built from it below) has to keep
	// resolving an entry that gets hidden while it's the one currently
	// occupying a slot, or that slot's "is my current assignment still valid"
	// check below would treat the hide as an instant removal and swap the
	// card out immediately. Brief section 11 requires the opposite: a
	// dismissed node "goes quiet in place" and the slot only refills on its
	// own normal rotation, never right away. `eligibleEntries`, just below,
	// is where hidden actually takes effect: it is what future picks draw
	// from, so a hidden entry stops being *offered* immediately even though
	// anything already on screen stays put until its own turn.
	const visibleEntries = $derived(
		ringStore.entries.filter((entry) => isVisibleTo(entry, preferencesStore.showExplicit))
	);
	const entries = $derived(visibleEntries.filter((entry) => filtersStore.matches(entry)));
	const hasActiveFilters = $derived(filtersStore.tags.size > 0);

	/** What a rotation may newly draw from. See `entries`' own comment above. */
	const eligibleEntries = $derived(entries.filter((entry) => !hiddenStore.isHidden(entry.id)));

	const nodes = $derived(layoutStore.nodes);
	const byId = $derived(new Map(entries.map((entry) => [entry.id, entry])));

	/**
	 * Each node's channel identity, by node id.
	 *
	 * Precomputed rather than derived inside `poolFor`, which sits in the
	 * rotation hot path: it is called from `takeNext` and, via `canRotate`,
	 * from the template for every node on screen. Building the key there
	 * would allocate a string per node per render for a value that only
	 * changes when the layout does.
	 */
	const channelKeys = $derived(
		new Map(nodes.map((node) => [node.id, channelKey(node.type, node.tags)]))
	);

	/**
	 * The distinct channels on the field: two identically configured nodes
	 * share one entry here, and so one pool and one deck. Deduplication is the
	 * Map constructor's own — a repeated key overwrites with an equivalent
	 * value, since the key is derived from exactly the two fields the value
	 * holds.
	 */
	const channels = $derived(
		new Map(
			nodes.map((node) => [channelKey(node.type, node.tags), { type: node.type, tags: node.tags }])
		)
	);

	/**
	 * Every channel's pool, built once per `eligibleEntries` or layout change.
	 *
	 * Built as a map rather than filtered on demand for the reason above:
	 * filtering per call made a single rotation cost O(nodes squared * ring
	 * size) and allocated a fresh array of the whole pool each time, which is
	 * what would turn a large ring into GC churn on a phone. One pass here
	 * makes every later lookup O(1).
	 *
	 * Bucketed by type first and narrowed by tags second, so the common case
	 * — an untagged node — reuses its type's array by reference instead of
	 * copying it, exactly as before tags existed. Only a tagged channel pays
	 * for a filtered copy, and only one copy per distinct tag selection no
	 * matter how many nodes share it.
	 */
	const poolsByChannel = $derived.by(() => {
		/** @type {Record<string, import('$lib/ring.js').RingEntry[]>} */
		const byType = { audio: [], comic: [], text: [], game: [], art: [] };
		for (const entry of eligibleEntries) byType[entry.type]?.push(entry);
		byType.any = eligibleEntries;

		return new Map(
			[...channels].map(([key, channel]) => {
				const base = byType[channel.type] ?? eligibleEntries;
				return [
					key,
					channel.tags.length === 0
						? base
						: base.filter((entry) => matchesTags(entry, channel.tags))
				];
			})
		);
	});

	/**
	 * The pool a node draws from: entries of its own type, narrowed by its own
	 * tags. This is what makes a node a channel rather than a slot.
	 * @param {import('$lib/layoutStore.svelte.js').FieldNodeConfig} node
	 */
	function poolFor(node) {
		return poolsByChannel.get(channelKeys.get(node.id) ?? '') ?? eligibleEntries;
	}

	/** Entry id currently shown, keyed by node id. @type {Record<string, string | null>} */
	let assigned = $state({});
	/** Entry id warmed and waiting, keyed by node id. @type {Record<string, string | null>} */
	let queued = $state({});

	/**
	 * Per-type decks. See `entryDeck.js` for why this is a deck rather than a
	 * random pick, and for the cursor it replaced.
	 */
	const decks = createDecks();

	// Plain arrays rather than Sets: transient scratch recomputed per call,
	// not reactive state, and the exclude list is at most two per node.

	/** Ids on screen or spoken for, so nothing appears twice at once. */
	function spokenFor() {
		return [...Object.values(assigned), ...Object.values(queued)].filter((id) => id !== null);
	}

	/**
	 * Next unclaimed entry for a node's channel.
	 *
	 * Keyed by the channel rather than by the type, which is what keeps two
	 * same-type nodes with different tags from dealing out of one another's
	 * sequence: their pools differ, so a shared deck would let the VGM node
	 * consume the lo-fi node's upcoming entries and vice versa.
	 * @param {import('$lib/layoutStore.svelte.js').FieldNodeConfig} node
	 * @param {(string | null)[]} exclude
	 */
	function takeNext(node, exclude) {
		return decks.take(
			channelKeys.get(node.id) ?? node.type,
			poolFor(node).map((entry) => entry.id),
			exclude
		);
	}

	/** Warms a queued entry's cover so its swap lands on a decoded image. */
	/** @param {string | null} id */
	function warm(id) {
		if (!id) return;
		const entry = byId.get(id);
		if (entry) preload(coverImageUrl(entry));
	}

	/**
	 * Reconciles assignments against the current nodes and pool, preserving
	 * what is already on screen wherever it is still valid. Deliberately not
	 * a reseed: adding or removing one node should not reshuffle every other
	 * node's content, which would be a jarring way to answer a small edit.
	 *
	 */
	function reconcile() {
		/** @type {(string | null)[]} */
		const claimed = [];
		/** @type {Record<string, string | null>} */
		const nextAssigned = {};

		for (const node of nodes) {
			const current = assigned[node.id];
			const entry = current ? byId.get(current) : undefined;
			// Tags are part of "still valid" as much as type is: narrowing a
			// node's tags has to move an entry that no longer belongs off it,
			// or the configuration would appear not to have taken effect until
			// the slot's next scheduled rotation.
			const stillValid =
				entry &&
				matchesType(entry, node.type) &&
				matchesTags(entry, node.tags) &&
				!claimed.includes(current);
			if (stillValid && current) {
				nextAssigned[node.id] = current;
				claimed.push(current);
			}
		}

		for (const node of nodes) {
			if (nextAssigned[node.id]) continue;
			const id = takeNext(node, claimed);
			if (id) claimed.push(id);
			nextAssigned[node.id] = id;
		}

		/** @type {Record<string, string | null>} */
		const nextQueued = {};
		for (const node of nodes) {
			const id = takeNext(node, claimed);
			if (id) claimed.push(id);
			nextQueued[node.id] = id;
		}

		assigned = nextAssigned;
		queued = nextQueued;
		Object.values(nextQueued).forEach(warm);
	}

	/**
	 * Promotes a node's warmed queue entry into view, then queues and warms
	 * the next. Falls back to picking fresh when nothing was queued, which
	 * happens when a type's pool is barely larger than the nodes using it.
	 * @param {string} nodeId
	 */
	function advance(nodeId) {
		const node = nodes.find((n) => n.id === nodeId);
		if (!node) return;

		const promoted = queued[nodeId] ?? takeNext(node, spokenFor());
		if (!promoted) return;

		assigned = { ...assigned, [nodeId]: promoted };
		queued = { ...queued, [nodeId]: null };

		const following = takeNext(node, spokenFor());
		queued = { ...queued, [nodeId]: following };
		warm(following);
	}

	/**
	 * How many entries of each type are on screen right now.
	 *
	 * Derived once per assignment change rather than recomputed inside
	 * `canRotate`, because `canRotate` is called from the template for every
	 * node, and a single rotation reassigns `assigned` and so re-runs all of
	 * them. Scanning the pool per node made that O(nodes squared * ring size)
	 * per rotation; counting here makes it a comparison.
	 */
	const shownCountByChannel = $derived.by(() => {
		/** @type {import('$lib/ring.js').RingEntry[]} */
		const shown = [];
		for (const id of Object.values(assigned)) {
			if (!id) continue;
			const entry = byId.get(id);
			if (entry) shown.push(entry);
		}
		return new Map(
			[...channels].map(([key, channel]) => [
				key,
				shown.filter(
					(entry) => matchesType(entry, channel.type) && matchesTags(entry, channel.tags)
				).length
			])
		);
	});

	/**
	 * Whether a node has anywhere to rotate to: an entry in its own channel
	 * that is not already on screen somewhere.
	 *
	 * A pool holds something unshown exactly when it is larger than the count
	 * of its own channel currently displayed, so this needs no scan of either.
	 * @param {import('$lib/layoutStore.svelte.js').FieldNodeConfig} node
	 */
	function canRotate(node) {
		const key = channelKeys.get(node.id) ?? '';
		return poolFor(node).length > (shownCountByChannel.get(key) ?? 0);
	}

	/**
	 * Why a node has nothing assigned at all (as opposed to a quiet-in-place
	 * card, which still has an assignment). Brief section 7c: the message an
	 * empty slot shows has to say which of several different things is true.
	 *
	 * The order is the order the layers narrow in, so each answer is the
	 * *first* thing that emptied the pool rather than the last, and each one
	 * names something the visitor can actually act on:
	 *
	 * - `'ring-empty'`: the ring itself has nothing of this type. Nothing the
	 *   visitor has set is responsible, so pointing at their own lists or
	 *   settings here would send them looking in the wrong place.
	 * - `'node-tags-empty'`: the ring has this type, but nothing carrying the
	 *   tags *this node* asks for. The fix is on the node, one menu away.
	 * - `'global-tags-empty'`: this node's own configuration is satisfiable —
	 *   there really is content of this type with these tags — and the
	 *   visitor's global tag preference is what removed it. **This is the
	 *   state that made two tag layers look like a bad idea in the first
	 *   place** (docs/decisions.md): a node sitting empty forever with the
	 *   cause in a different part of the app. It is answerable rather than
	 *   fatal, and the answer is that the node says so and links to the
	 *   setting responsible, which is what this branch exists to enable.
	 * - `'hidden-exhausted'`: everything that would have matched is on the
	 *   visitor's own Not for Me list.
	 * - `null`: none of the above. An empty slot can still happen because
	 *   every matching entry is already on screen in another node, which
	 *   keeps its existing generic message.
	 *
	 * Only ever called for a slot that is already empty, so the repeated
	 * filtering here is off the hot path that `poolsByChannel` exists to
	 * protect.
	 * @param {import('$lib/layoutStore.svelte.js').FieldNodeConfig} node
	 */
	function shortageCause(node) {
		const ofType = visibleEntries.filter((entry) => matchesType(entry, node.type));
		if (ofType.length === 0) return 'ring-empty';

		const tagged = ofType.filter((entry) => matchesTags(entry, node.tags));
		if (tagged.length === 0) return 'node-tags-empty';

		const withinGlobal = tagged.filter((entry) => filtersStore.matches(entry));
		if (withinGlobal.length === 0) return 'global-tags-empty';

		const eligible = withinGlobal.filter((entry) => !hiddenStore.isHidden(entry.id));
		if (eligible.length === 0 && hiddenStore.size > 0) return 'hidden-exhausted';
		return null;
	}

	// Reconcile when the *composition* changes: which nodes exist and how each
	// is configured — its type and its tags, since either one changes what the
	// node is allowed to show. Deliberately not the whole node objects,
	// because those also change on every drag and resize, and reseeding
	// content because someone nudged a node two cells left would be absurd.
	const composition = $derived(nodes.map((n) => `${n.id}:${channelKey(n.type, n.tags)}`).join('|'));

	/**
	 * Last state reconcile() ran against. Plain variables, not `$state`, so
	 * comparing them here cannot itself become a reactive dependency.
	 *
	 * Tracked against `eligibleEntries`, not `entries`: decks are built from
	 * `poolFor`, which now draws from `eligibleEntries` (`entries` minus
	 * hidden), so that is the set whose changes actually invalidate a deck.
	 * Reacting to a hide this way is safe for what's already on screen, even
	 * though `assigned`/`byId` stay resolvable against the wider `entries` —
	 * `reconcile`'s own "is my current pick still valid" check only reads
	 * `byId`, never `hiddenStore`, so re-running it on a hide cannot force a
	 * quiet-in-place card out early; it only refreshes each slot's *next*
	 * pick and its decks so neither hands out an id that just got hidden.
	 *
	 * Tracked by array identity rather than by joining every id into a
	 * string. Both are `$derived`, so a new array means the set genuinely
	 * changed, and the old string built roughly 200 KB of ids on every
	 * evaluation once a ring reached ten thousand entries just to prove
	 * nothing had.
	 * @type {import('$lib/ring.js').RingEntry[] | null}
	 */
	let lastEligibleEntries = null;
	let lastComposition = '';

	// Both values are read unconditionally, before any early return, so they
	// are always tracked as dependencies of this effect regardless of which
	// branch it takes. Reading one only after an early exit on the other is
	// how an effect ends up silently never re-running.
	//
	// untrack for the same reason as before: reconcile() both reads and
	// writes assignment state, so without it this effect would depend on its
	// own writes and re-run on every rotation. That trap has bitten twice.
	$effect(() => {
		const nextEligibleEntries = eligibleEntries;
		const nextComposition = composition;
		if (nextEligibleEntries === lastEligibleEntries && nextComposition === lastComposition) return;

		// A changed eligible set starts every deck's pass over. `take` already
		// refuses to deal an id that has left the pool, so this is no longer
		// load-bearing for correctness — but a filter change is a different
		// browsing session in spirit, and resuming a half-dealt pass from
		// before it would show a narrower slice than the new filter allows.
		if (nextEligibleEntries !== lastEligibleEntries) decks.reset();

		lastEligibleEntries = nextEligibleEntries;
		lastComposition = nextComposition;
		untrack(() => reconcile());
	});

	const visibleCount = $derived(Object.values(assigned).filter((id) => id !== null).length);

	/**
	 * Whether the intro animation has had time to finish.
	 *
	 * `ring.json` is a static file and usually resolves in well under the
	 * length of the animation, so without this the logo would be cut off
	 * mid-zoom on most loads, which reads as a glitch rather than an intro.
	 * Holding for the animation's own duration means the loading state either
	 * plays fully or not at all.
	 */
	let introDone = $state(false);

	onMount(() => {
		// Skipped entirely when the ring is already in memory. This is a
		// loading state, and there is nothing to load when navigating back
		// from Lists; replaying it there would be theatre, and the kind
		// that gets annoying by the third time.
		if (ringStore.status === 'ready') {
			introDone = true;
			return;
		}
		const timer = setTimeout(() => (introDone = true), 900);
		return () => clearTimeout(timer);
	});

	const ringPending = $derived(ringStore.status === 'idle' || ringStore.status === 'loading');

	// Held until the ring has arrived *and* the intro has played out, so the
	// logo is never cut off mid-zoom by a file that resolved in 40ms. A
	// failure opts out immediately: it gets its own branch rather than
	// sitting under a loading message that will never resolve.
	const showLoading = $derived((ringPending || !introDone) && ringStore.status !== 'error');
</script>

<svelte:head>
	<title>IndieNodes</title>
</svelte:head>

<div class="field-page" role="presentation" oncontextmenu={handleContextMenu}>
	{#if nodes.length === 0}
		<div class="empty-state">
			<h1>IndieNodes</h1>
			<p>Your field has no nodes. Add one to start seeing work from the ring.</p>
			<button type="button" class="primary-button" onclick={() => editModeStore.enable()}>
				Arrange field
			</button>
		</div>
	{:else if showLoading}
		<!-- The ring is fetched in the browser rather than baked into this
		     page, so there is a moment before any entry exists. Saying "the
		     ring is empty" during it would be wrong. -->
		<RingLoading />
	{:else if visibleCount === 0 && ringStore.status === 'error'}
		<!-- Distinct from an empty ring, and the distinction matters: this
		     used to fall through to "the ring is empty right now", which sent
		     you looking at the content when the actual problem was that the
		     file never arrived. -->
		<div class="empty-state">
			<h1>IndieNodes</h1>
			<p class="status">The ring could not be loaded.</p>
			<button type="button" class="primary-button" onclick={() => ringStore.ensureLoaded()}>
				Try again
			</button>
		</div>
	{:else if visibleCount === 0 && eligibleEntries.length === 0}
		<!-- Only when there is genuinely nothing left to draw from. A field
		     where every node happens to be empty is a different situation and
		     falls through to the grid below: the ring still has content, each
		     node's own message can say precisely which layer excluded it, and
		     every node stays configurable. Answering that case here instead
		     would replace several accurate explanations with one wrong one —
		     "no entries match your filters" is false when the filters match
		     plenty and it is the node configuration that matches none. -->
		<div class="empty-state">
			<h1>IndieNodes</h1>
			<p>A webring for indie creators: audio, comics and visual art, writing, and games.</p>
			{#if entries.length === 0 && hasActiveFilters}
				<p class="status">
					No entries match your current filters.
					<a href={resolve('/settings')}>Adjust them in Settings</a>.
				</p>
			{:else if entries.length > 0 && hiddenStore.size > 0}
				<!-- Section 7c's "ring itself vs. hidden list" branch, at the scale
				     where every node on screen is empty at once rather than just
				     one. Saying "the ring is empty" here would be wrong for the same
				     reason `shortageCause`/`EmptyNode` exist below: the ring has
				     content, the visitor's own Not for Me list is why none of it is
				     eligible right now. -->
				<p class="status">
					Your Not for Me list is why nothing is showing. Restore some from
					<a href={resolve('/lists')}>Lists</a>, or wait for more members to join.
				</p>
			{:else if EARLY_ACCESS}
				<!-- The one branch where a visitor is looking at nothing at all,
				     which during Early Access is the most useful moment there is
				     to ask them to join rather than to explain and stop.

				     It leads with the widget on purpose. "Be early" is a promise
				     about a ring that does not exist yet, and asking someone to
				     bet on that is the whole difficulty of a cold start; the
				     widget is a thing they get working on their own site the day
				     they join, whether the ring has two members or two hundred.
				     That is the honest reason to join a small ring, so it is the
				     one stated first.

				     Nothing here hides how small the ring is -- the sentence
				     below says so plainly. A directory that pretends to be full
				     is found out on the first click; one that says it is being
				     built is just accurate, and the invitation is what that
				     accuracy is for. -->
				<p class="status">
					IndieNodes is in Early Access, building its founding ring. The ring has no entries yet, so
					there is nothing to browse — but joining already gets you a discovery widget for your own
					site.
				</p>
				<p class="status">
					It's free, and every submission is reviewed by a person before it joins the ring.
				</p>
				<a class="primary-button" href={resolve('/join')}>Become a founding creator</a>
				<p class="status">
					See
					<button type="button" class="about-link" onclick={() => aboutModalStore.show()}>
						About
					</button> for what IndieNodes is.
				</p>
			{:else}
				<p class="status">
					The ring is empty right now. See
					<button type="button" class="about-link" onclick={() => aboutModalStore.show()}>
						About
					</button> for what IndieNodes is.
				</p>
			{/if}
		</div>
	{:else}
		<FieldGrid
			bind:this={fieldGrid}
			{nodes}
			{editMode}
			fitToView={preferencesStore.fitToView}
			onGeometryChange={(changed) => layoutStore.applyGeometry(changed)}
			onReorder={(order) => layoutStore.reorderTo(order)}
		>
			{#snippet children(node)}
				{@const entry = assigned[node.id] ? byId.get(assigned[node.id] ?? '') : undefined}
				{#if entry}
					<FieldSlot
						{entry}
						nodeId={node.id}
						index={nodes.findIndex((n) => n.id === node.id)}
						rotating={canRotate(node) && !editMode}
						{pageVisible}
						intervalMs={preferencesStore.rotationFor(node.type)}
						onadvance={() => advance(node.id)}
						aspect={`${node.w} / ${node.h}`}
						{editMode}
						nodeType={node.type}
						nodeTags={node.tags}
						onTypeChange={(type) => layoutStore.setType(node.id, type, ringStore.entries)}
						onTagsChange={(tags) => layoutStore.setTags(node.id, tags)}
						onRemove={() => layoutStore.remove(node.id)}
					/>
				{:else}
					<!-- Always render something. A node whose pool is empty still
					     has to be selectable and removable, since its controls
					     live on the node itself. -->
					<div class="empty-slot">
						<!-- The cause is passed while arranging too, unlike before.
						     Two of its answers are about the configuration being
						     edited right now, and EmptyNode keeps the generic
						     arranging message for the rest. -->
						<EmptyNode {node} {editMode} cause={shortageCause(node)} />
						{#if editMode}
							<NodeConfig
								nodeId={node.id}
								nodeType={node.type}
								nodeTags={node.tags}
								onTypeChange={(type) => layoutStore.setType(node.id, type, ringStore.entries)}
								onTagsChange={(tags) => layoutStore.setTags(node.id, tags)}
								onRemove={() => layoutStore.remove(node.id)}
							/>
						{/if}
					</div>
				{/if}
			{/snippet}
		</FieldGrid>
	{/if}

	{#if menuPos}
		<ArrangeMenu
			x={menuPos.x}
			y={menuPos.y}
			{editMode}
			fitToView={preferencesStore.fitToView}
			onAdd={addNodeAtMenu}
			onReset={() => layoutStore.reset()}
			onExit={() => editModeStore.disable()}
			onEnter={() => editModeStore.enable()}
			onToggleFit={() => preferencesStore.toggleFitToView()}
			onClose={() => (menuPos = null)}
		/>
	{/if}
</div>

<style>
	.field-page {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		/* Full-bleed rather than a centred column: node sizes are now set by
		   their own cell spans, so the container no longer has to constrain
		   width to keep cards a sensible size. */
		width: 100%;
	}

	.empty-state {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		text-align: center;
		min-height: 60vh;
		max-width: 40rem;
		/* `.field-page`'s `align-items: stretch` sizes this to its max-width
		   rather than the page's full width, but stretch only sets a size —
		   it has no opinion on position, so without this the clamped box sits
		   flush against the left edge instead of in the middle of the page. */
		margin: 0 auto;
	}

	.empty-state p {
		margin-top: 1.2rem;
		color: var(--text-muted);
	}

	.status {
		font-size: var(--text-sm);
	}

	.about-link {
		background: none;
		border: none;
		padding: 0;
		margin: 0;
		font: inherit;
		font-size: inherit;
		color: var(--accent);
		cursor: pointer;
	}

	.about-link:hover {
		text-decoration: underline;
	}

	.status a {
		color: var(--accent);
	}

	.status a:hover {
		text-decoration: underline;
	}

	.primary-button {
		margin-top: 1.6rem;
		padding: 0.7rem 1.4rem;
		border: none;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: white;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.primary-button:hover {
		background: var(--accent-hover);
	}

	/* The Early Access branch uses this on an <a>, not a <button>: it navigates
	   to /join, and a link that navigates should be a link. Anchors bring a
	   default underline and are inline, neither of which a <button> has, so
	   both are reset here rather than in a second near-identical class. */
	a.primary-button {
		display: inline-block;
		text-decoration: none;
	}

	.empty-slot {
		position: relative;
		height: 100%;
	}
</style>
