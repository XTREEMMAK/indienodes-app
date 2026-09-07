<script>
	/**
	 * Every member of the ring, as a plain list.
	 *
	 * This is deliberately the one place a directory is allowed to exist. The
	 * brief is explicit that the *field view* must never grow a filter, a
	 * search, or a category browser, because the moment it does it has become
	 * a directory again and the point of removing choice is lost. That rule
	 * is about the ambient surface, not about the whole app: a webring that
	 * cannot tell you who is in it is hiding its own membership, and members
	 * reasonably want to see the ring they joined. Keeping it on its own
	 * route is what lets both things be true.
	 *
	 * It has a search field, and that is not a contradiction of the rule
	 * above: the rule protects the *field view* from becoming a browsable
	 * catalogue. This page already is one, deliberately, and a directory you
	 * cannot search is just a long page. What search must never do is leak
	 * back the other way into the ambient surface.
	 */
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import { coverImageUrl, isVisibleTo } from '$lib/ring.js';
	import { ringStore } from '$lib/ringStore.svelte.js';
	import { preferencesStore } from '$lib/preferencesStore.svelte.js';
	import { reducedMotion } from '$lib/motion.svelte.js';
	import { updateStore } from '$lib/updateStore.svelte.js';

	let { data } = $props();

	const TYPE_LABEL = { audio: 'Audio', comic: 'Comic', text: 'Text', game: 'Game', art: 'Art' };

	// Server-rendered `data.entries` for first paint (this page's whole job is
	// being crawlable, so it must render without JavaScript), then the live
	// store once it has arrived.
	//
	// The two are not always the same file. The load function fetches
	// `/ring.json` directly while the store honours `VITE_RING_URL`, so with
	// `npm run dev:fixture` the field showed 50 fixture entries and this page
	// showed the 5 real ones. It is also the freshness split the client-side
	// fetch was introduced to close: baked-in data is the ring as of the last
	// deploy, so without this a new member appeared everywhere except the page
	// that lists members.
	// A successful empty response is authoritative: it means the final member
	// was withdrawn. Falling back whenever `entries.length === 0` would keep a
	// stale, prerendered member visible until the next deploy. During loading,
	// or if the live request fails, the server-rendered copy remains the useful
	// fallback.
	const source = $derived(ringStore.status === 'ready' ? ringStore.entries : data.entries);

	// Sorted by creator rather than left in ring.json's own order, which is
	// submission order and means nothing to a reader. Locale-aware so
	// non-ASCII creator names sort where a person would expect.
	const members = $derived(
		[...source]
			.filter((entry) => isVisibleTo(entry, preferencesStore.showExplicit))
			.sort((a, b) => a.creator.localeCompare(b.creator, undefined, { numeric: true }))
	);

	let query = $state('');
	const failedCovers = new SvelteSet();

	/** @param {string} id */
	function markCoverFailed(id) {
		failedCovers.add(id);
	}

	/**
	 * The text a query is matched against.
	 *
	 * Deliberately wider than the creator name. Someone looking for their own
	 * entry may remember the site they linked rather than the name they used,
	 * and someone browsing types "comic" expecting the comics -- which works
	 * because the type label is in here, so a type filter would be a second
	 * control doing what the first already does.
	 *
	 * The URL contributes its host only. A full URL would match on `https`
	 * and on whatever path segments happen to exist, so a two-letter query
	 * could pull in every entry at once.
	 * @param {import('$lib/ring.js').RingEntry} entry
	 */
	function haystack(entry) {
		let host = '';
		try {
			host = new URL(entry.source_url).host;
		} catch {
			// A malformed URL is the ring's problem, not the search box's;
			// the entry stays findable by everything else.
		}
		return [
			entry.creator,
			entry.why,
			TYPE_LABEL[entry.type] ?? entry.type,
			entry.tags.join(' '),
			host
		]
			.join(' ')
			.toLowerCase();
	}

	// Every term has to appear, in any order and any field, so "lantern comic"
	// finds Paper Lantern Comics the same way "paper lantern" does. Substring
	// rather than fuzzy: a typo-tolerant match on a five-entry ring returns
	// everything and reads as broken.
	const terms = $derived(query.toLowerCase().split(/\s+/).filter(Boolean));

	const filtered = $derived(
		terms.length === 0
			? members
			: members.filter((entry) => terms.every((t) => haystack(entry).includes(t)))
	);

	// Paginated rather than one growing list. At five entries a full list was
	// the honest presentation; past a screenful it stops being one, and the
	// page's job is letting someone find a member rather than scroll past
	// everyone. Client-side, since the whole ring is already in memory (the
	// store fetches it once) and paging it costs no extra request.
	const PAGE_SIZE = 12;

	let currentPage = $state(1);

	const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));

	// Clamped rather than reset. Turning the explicit filter back on can shrink
	// the list under someone sitting on page 4, and snapping them to page 1
	// would lose their place for a change they made somewhere else entirely.
	$effect(() => {
		if (currentPage > pageCount) currentPage = pageCount;
	});

	const visible = $derived(filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));
	const rangeStart = $derived(filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1);
	const rangeEnd = $derived(Math.min(currentPage * PAGE_SIZE, filtered.length));

	/**
	 * Page numbers to render, with gaps collapsed to an ellipsis so the control
	 * stays a fixed width whether the ring has 3 members or 3000.
	 * @returns {(number | 'gap')[]}
	 */
	const pageItems = $derived.by(() => {
		if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
		/** @type {(number | 'gap')[]} */
		const items = [1];
		const from = Math.max(2, currentPage - 1);
		const to = Math.min(pageCount - 1, currentPage + 1);
		if (from > 2) items.push('gap');
		for (let i = from; i <= to; i += 1) items.push(i);
		if (to < pageCount - 1) items.push('gap');
		items.push(pageCount);
		return items;
	});

	/** @param {number} page */
	function goToPage(page) {
		currentPage = Math.min(Math.max(page, 1), pageCount);
		// Back to the top of the list, not the top of the document: the heading
		// and the join call-to-action are not what someone paging through the
		// ring is looking for.
		listEl?.scrollIntoView({
			behavior: reducedMotion.current ? 'auto' : 'smooth',
			block: 'start'
		});
	}

	let listEl = $state(/** @type {HTMLElement | undefined} */ (undefined));
</script>

<svelte:head>
	<title>Members, IndieNodes</title>
</svelte:head>

<div class="members-page">
	<h1>Ring members</h1>
	<p class="lede">
		Everyone currently in the ring. {members.length}
		{members.length === 1 ? 'entry' : 'entries'}, linking straight out to the creators' own sites.
	</p>

	{#if members.length > 0}
		<div class="member-search">
			<label class="sr-only" for="member-search">Search ring members</label>
			<!-- type="search" for the platform clear button and the right mobile
			     keyboard. No submit: the whole ring is already in memory, so
			     making someone press enter would add a step to hide nothing. -->
			<input
				id="member-search"
				class="control"
				type="search"
				autocomplete="off"
				placeholder="Search by name, site, tag, or type"
				bind:value={query}
				oninput={() => (currentPage = 1)}
			/>
			<!-- Announced rather than only drawn, because a filter that silently
			     reorders the page under a screen reader is a page that appears to
			     have lost its content. -->
			<p class="search-status" role="status" aria-live="polite">
				{#if terms.length > 0}
					{filtered.length}
					{filtered.length === 1 ? 'match' : 'matches'}
				{/if}
			</p>
		</div>
	{/if}

	<a class="join-cta" href={resolve('/join')}>
		<span>
			<strong>Join the ring</strong>
			<span class="join-sub">Add your own site, audio, comic, writing, or game.</span>
		</span>
		<span class="join-arrow" aria-hidden="true">&rarr;</span>
	</a>

	{#if members.length === 0}
		<div class="empty-state">
			<p>The ring has no members yet.</p>
		</div>
	{:else if filtered.length === 0}
		<div class="empty-state">
			<p>No members match &ldquo;{query}&rdquo;.</p>
			<button type="button" class="clear-search" onclick={() => (query = '')}>
				Show all {members.length} members
			</button>
		</div>
	{:else}
		<ul class="member-list" bind:this={listEl}>
			{#each visible as entry (entry.id)}
				{@const cover = coverImageUrl(entry)}
				{@const hasCover = Boolean(cover) && !failedCovers.has(entry.id)}
				<li class="member" class:has-cover={hasCover} data-type={entry.type}>
					<div class="thumb" aria-hidden="true">
						{#if hasCover}
							<img
								src={cover}
								alt=""
								loading="lazy"
								decoding="async"
								referrerpolicy="no-referrer"
								onerror={() => markCoverFailed(entry.id)}
							/>
						{/if}
					</div>

					<div class="member-text">
						<p class="member-creator">{entry.creator}</p>
						<p class="member-why">{entry.why}</p>
						{#if entry.tags.length > 0}
							<ul class="tags">
								{#each entry.tags as tag (tag)}
									<li>{tag}</li>
								{/each}
							</ul>
						{/if}
					</div>

					<div class="member-side">
						<span class="type-badge">{TYPE_LABEL[entry.type] ?? entry.type}</span>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- creator-owned external site, not an app route -->
						<a class="visit" href={entry.source_url} target="_blank" rel="noopener noreferrer">
							Visit &rarr;
						</a>
						<!-- The node id is shown nowhere else in this app, so this link is
						     how a creator who no longer remembers theirs reaches the change
						     form at all. Quiet on purpose: it is for the one person on this
						     page it belongs to, not for everyone reading it. -->
						<!-- eslint-disable svelte/no-navigation-without-resolve -- resolved app route with an appended node query -->
						<a
							class="claim"
							href={`${resolve('/update')}?node=${encodeURIComponent(entry.id)}`}
							onclick={() => updateStore.reset()}
						>
							This is mine
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</div>
				</li>
			{/each}
		</ul>

		{#if pageCount > 1}
			<nav class="pagination" aria-label="Ring members pages">
				<p class="page-range" aria-live="polite">
					Showing {rangeStart} to {rangeEnd} of {members.length}
				</p>
				<div class="page-controls">
					<button
						type="button"
						class="page-step"
						onclick={() => goToPage(currentPage - 1)}
						disabled={currentPage === 1}
						aria-label="Previous page"
					>
						<svg
							viewBox="0 0 24 24"
							width="16"
							height="16"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</button>

					{#each pageItems as item, i (item === 'gap' ? `gap-${i}` : item)}
						{#if item === 'gap'}
							<span class="page-gap" aria-hidden="true">&hellip;</span>
						{:else}
							<button
								type="button"
								class="page-number"
								class:current={item === currentPage}
								onclick={() => goToPage(item)}
								aria-label={`Page ${item}`}
								aria-current={item === currentPage ? 'page' : undefined}
							>
								{item}
							</button>
						{/if}
					{/each}

					<button
						type="button"
						class="page-step"
						onclick={() => goToPage(currentPage + 1)}
						disabled={currentPage === pageCount}
						aria-label="Next page"
					>
						<svg
							viewBox="0 0 24 24"
							width="16"
							height="16"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</button>
				</div>
			</nav>
		{/if}
	{/if}
</div>

<style>
	.pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.8rem;
		margin-top: 1.6rem;
	}

	.page-range {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.page-controls {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.page-step,
	.page-number {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2.2rem;
		height: 2.2rem;
		padding: 0 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}

	.page-step:hover:not(:disabled),
	.page-number:hover:not(.current) {
		background: var(--glass-bg);
	}

	.page-step:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.page-number.current {
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
		font-weight: 700;
	}

	.page-gap {
		padding: 0 0.2rem;
		color: var(--text-muted);
	}

	@media (max-width: 34rem) {
		.pagination {
			justify-content: center;
		}
	}

	.members-page {
		max-width: 52rem;
		margin: 0 auto;
	}

	.lede {
		color: var(--text-muted);
		margin-bottom: 1.6rem;
	}

	.member-search {
		margin-bottom: 1.6rem;
	}

	/* Reserves its line whether or not it has text, so typing the first
	   character does not shove the whole list down by a row. */
	.search-status {
		min-height: 1.4em;
		margin: 0.5rem 0 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.clear-search {
		margin-top: 0.9rem;
		padding: 0.5rem 0.9rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.clear-search:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.join-cta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 2rem;
		padding: 1rem 1.2rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--accent);
		background: color-mix(in oklch, var(--accent) 10%, transparent);
		color: var(--text);
		text-decoration: none;
	}

	.join-cta:hover {
		background: color-mix(in oklch, var(--accent) 18%, transparent);
	}

	.join-cta strong {
		display: block;
		font-size: var(--text-base);
	}

	.join-sub {
		display: block;
		margin-top: 0.15rem;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.join-arrow {
		flex-shrink: 0;
		color: var(--accent);
		font-size: var(--text-lg);
	}

	.empty-state {
		padding: 3rem;
		text-align: center;
		border-radius: var(--radius-lg);
		border: 1px dashed var(--border);
		color: var(--text-muted);
	}

	.member-list {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		padding: 0;
		list-style: none;
	}

	.member {
		--member-color: var(--type-audio);
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 1rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--border);
		/* A color stripe rather than a fully tinted row: the type is worth
		   seeing at a glance down the list, but five saturated rows stacked
		   would read as five alerts. */
		border-left: 3px solid var(--member-color);
		background: var(--bg-elevated);
	}

	.member[data-type='game'] {
		--member-color: var(--type-game);
	}
	.member[data-type='comic'] {
		--member-color: var(--type-comic);
	}
	.member[data-type='text'] {
		--member-color: var(--type-text);
	}
	.member[data-type='art'] {
		--member-color: var(--type-art);
	}

	.thumb {
		flex-shrink: 0;
		width: 3.5rem;
		height: 3.5rem;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: color-mix(in oklch, var(--member-color) 30%, var(--bg));
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.member-text {
		flex: 1;
		min-width: 0;
	}

	.member-creator {
		font-weight: 700;
	}

	.member-why {
		margin-top: 0.3rem;
		font-size: var(--text-sm);
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.5rem;
		padding: 0;
		list-style: none;
	}

	.tags li {
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		color: var(--text-muted);
		font-size: var(--text-xs);
	}

	.member-side {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.6rem;
	}

	.type-badge {
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		background: color-mix(in oklch, var(--member-color) 18%, transparent);
		color: var(--member-color);
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.claim {
		color: var(--text-muted);
		font-size: var(--text-xs);
		text-decoration: none;
	}

	.claim:hover,
	.claim:focus-visible {
		color: var(--accent);
		text-decoration: underline;
	}

	.visit {
		color: var(--accent);
		font-size: var(--text-sm);
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}

	.visit:hover {
		text-decoration: underline;
	}

	@media (max-width: 34rem) {
		.members-page {
			--text-xs: 0.95rem;
			--text-sm: 1.15rem;
			--text-base: 1.4rem;
			--text-lg: 1.6rem;
			--text-xl: 1.8rem;
			--text-2xl: 2.2rem;
			font-size: var(--text-base);
		}

		.member {
			flex-wrap: wrap;
		}

		.member:not(.has-cover) .thumb {
			display: none;
		}

		.member.has-cover {
			position: relative;
			isolation: isolate;
			min-height: 10rem;
			overflow: hidden;
			border-color: color-mix(in oklch, var(--member-color) 65%, transparent);
			background: #111;
			color: white;
		}

		.member.has-cover .thumb {
			position: absolute;
			inset: 0;
			z-index: 0;
			width: auto;
			height: auto;
			border-radius: 0;
		}

		.member.has-cover .thumb::after {
			content: '';
			position: absolute;
			inset: 0;
			background: linear-gradient(110deg, rgb(0 0 0 / 0.82), rgb(0 0 0 / 0.58));
		}

		.member.has-cover .member-text,
		.member.has-cover .member-side {
			position: relative;
			z-index: 1;
		}

		.member.has-cover .tags li {
			border-color: rgb(255 255 255 / 0.42);
			color: rgb(255 255 255 / 0.86);
			background: rgb(0 0 0 / 0.2);
		}

		.member.has-cover .type-badge {
			background: rgb(0 0 0 / 0.5);
			color: white;
		}

		.member.has-cover .visit {
			color: white;
		}

		.member.has-cover .claim {
			color: rgb(255 255 255 / 0.78);
		}

		.member-side {
			flex-direction: row;
			align-items: center;
			width: 100%;
			justify-content: space-between;
		}
	}
</style>
