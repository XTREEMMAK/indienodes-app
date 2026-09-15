<script>
	import { tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import { MediaQuery } from 'svelte/reactivity';
	import GlassPanel from '../../components/GlassPanel.svelte';
	import { preferencesStore } from '$lib/preferencesStore.svelte.js';
	import { reducedMotion } from '$lib/motion.svelte.js';
	import { filtersStore } from '$lib/filtersStore.svelte.js';
	import { hiddenStore } from '$lib/hiddenStore.svelte.js';
	import { journalStore } from '$lib/journalStore.svelte.js';
	import { browser, dev } from '$app/environment';
	import { resolve } from '$app/paths';
	import { buildExport, summarize, exportFilename, applyImport } from '$lib/localData.js';
	import { ROTATION_MIN_MS, ROTATION_MAX_MS } from '$lib/preferences.js';
	import { ringStore } from '$lib/ringStore.svelte.js';
	import { flyFade, outFade } from '$lib/transitions.js';
	import { NODE_SKINS, UI_SKINS } from '../../skins/registry.js';
	import { skinStore } from '../../skins/skinStore.svelte.js';

	const TABS = [
		{ id: 'appearance', label: 'Appearance' },
		{ id: 'content', label: 'Content' }
	];

	let activeTab = $state('appearance');

	// Both tabs below share the same vertical-tab-list layout (one title on
	// the left, one section's content on the right) rather than a stack of
	// every section shown at once — see `.subtabs-layout`'s own CSS comment
	// for why that stopped scaling once Content had seven sections. Content
	// got this first; Appearance reuses the identical markup/CSS once a
	// second tab actually needed it too, rather than duplicating a
	// near-identical block.
	const APPEARANCE_SECTIONS = [
		{ id: 'theme', label: 'Theme' },
		{ id: 'background', label: 'Background' },
		{ id: 'ui-skin', label: 'UI Skin' },
		{ id: 'node-skin', label: 'Node Skin' },
		{ id: 'startup-mode', label: 'Startup mode' }
	];
	let activeAppearanceSection = $state('theme');

	const CONTENT_SECTIONS = [
		{ id: 'explicit', label: 'Explicit content' },
		{ id: 'audio-playlist', label: 'Audio playlist' },
		{ id: 'entry-types', label: 'Entry types' },
		{ id: 'tags', label: 'Tags' },
		{ id: 'not-for-me', label: 'Not for Me' },
		{ id: 'rotation', label: 'Rotation pace' },
		{ id: 'your-data', label: 'Your data' },
		{ id: 'journal', label: 'Your discovery journal' }
	];
	let activeContentSection = $state('explicit');

	// On a phone the sub-tabs become a drill-down list instead of a tab strip.
	// Eight labels wrapped into a paragraph of links there, with no way to tell
	// at a glance which was selected or what any of them held. A list of rows,
	// each saying what its section is currently set to, and one section at a
	// time behind it with a way back, is how a settings screen reads on a
	// phone. Wide screens keep the sticky sidebar. The query matches
	// `.subtabs-layout`'s own breakpoint below.
	const narrow = new MediaQuery('max-width: 56rem', false);
	let appearanceDrilled = $state(false);
	let contentDrilled = $state(false);

	/**
	 * Opens one section from the phone list and moves focus to its panel, so a
	 * screen reader lands on what was just opened rather than on a list that
	 * is no longer there.
	 * @param {string} tab `'appearance'` or `'content'`
	 * @param {string} sectionId
	 */
	async function drillInto(tab, sectionId) {
		if (tab === 'appearance') {
			activeAppearanceSection = sectionId;
			appearanceDrilled = true;
		} else {
			activeContentSection = sectionId;
			contentDrilled = true;
		}
		await tick();
		document.getElementById(`${tab}-section-panel-${sectionId}`)?.focus({ preventScroll: true });
	}

	/**
	 * Back to the phone list, returning focus to the row that was left.
	 * @param {string} tab `'appearance'` or `'content'`
	 */
	async function drillOut(tab) {
		const sectionId = tab === 'appearance' ? activeAppearanceSection : activeContentSection;
		if (tab === 'appearance') appearanceDrilled = false;
		else contentDrilled = false;
		await tick();
		document.getElementById(`${tab}-section-row-${sectionId}`)?.focus();
	}

	/**
	 * @param {{ id: string, label: string }[]} sections
	 * @param {string} id
	 */
	function sectionLabel(sections, id) {
		return sections.find((section) => section.id === id)?.label;
	}

	/** @param {string} id */
	function selectTab(id) {
		activeTab = id;
		appearanceDrilled = false;
		contentDrilled = false;
	}

	/** @type {{ id: 'light' | 'dark' | 'system', label: string, description: string }[]} */
	const THEME_OPTIONS = [
		{
			id: 'light',
			label: 'Light',
			description: 'Always light, regardless of your system setting.'
		},
		{ id: 'dark', label: 'Dark', description: 'Always dark, regardless of your system setting.' },
		{ id: 'system', label: 'System', description: "Follows your device's setting, live." }
	];

	/** @type {{ id: 'field' | 'ambient', label: string, description: string }[]} */
	const STARTUP_MODE_OPTIONS = [
		{
			id: 'field',
			label: 'Field',
			description: 'Open into the node grid, same as every visit before this setting existed.'
		},
		{
			id: 'ambient',
			label: 'Ambient',
			description:
				"Open straight into Ambient view. Still asks for the one-time audio consent first if you haven't given it yet."
		}
	];

	/** @type {{ id: 'none' | 'drifty-stars', label: string, description: string }[]} */
	const BACKGROUND_OPTIONS = [
		{
			id: 'none',
			label: 'None',
			description: 'No background animation. Costs nothing.'
		},
		{
			id: 'drifty-stars',
			label: 'Drifty Stars',
			description:
				'Drifting particles behind the page. Default: it has a low memory cost, but leave it off on low-powered devices if you notice any strain. Runs for as long as a page is open. Respects your reduced-motion setting, caps at 30fps, and pauses in a background tab.'
		}
	];

	// Tags aren't a fixed enum like type, so the options list is whatever
	// actually appears across the ring right now rather than a hardcoded
	// set, sorted so the list order doesn't shuffle as entries change.
	const availableTags = $derived(
		[...new Set(ringStore.entries.flatMap((entry) => entry.tags))].sort()
	);

	const matchCount = $derived(
		ringStore.entries.filter((entry) => filtersStore.matches(entry)).length
	);

	// Ordered by the default pace rather than alphabetically, so the list
	// itself shows the reasoning: quickest medium at the top, slowest at the
	// bottom. `any` is included because an `any` node is a real node type a
	// visitor can place, and it would otherwise be the one thing on the field
	// with no control over it.
	const ROTATION_TYPES = [
		{ id: 'audio', label: 'Audio', color: 'var(--type-audio)' },
		{ id: 'game', label: 'Game', color: 'var(--type-game)' },
		{ id: 'art', label: 'Art', color: 'var(--type-art)' },
		{ id: 'any', label: 'Any type', color: 'var(--text-muted)' },
		{ id: 'text', label: 'Text', color: 'var(--type-text)' },
		{ id: 'comic', label: 'Comic', color: 'var(--type-comic)' }
	];

	// Schema order (submissionValidation.js's ENTRY_TYPES), unlike the pacing
	// ladder above which orders by how long each medium takes to sample. No
	// `any` here: that is a Field slot concept, never a value an entry's own
	// `type` carries.
	const AMBIENT_TYPES = [
		{ id: 'audio', label: 'Audio', color: 'var(--type-audio)' },
		{ id: 'comic', label: 'Comic', color: 'var(--type-comic)' },
		{ id: 'text', label: 'Text', color: 'var(--type-text)' },
		{ id: 'game', label: 'Game', color: 'var(--type-game)' },
		{ id: 'art', label: 'Art', color: 'var(--type-art)' }
	];

	// One line per phone-list row saying what the section is set to now, so
	// the list answers "what have I changed" without opening anything. Empty
	// where a section has no single current value worth summarising.
	/** @type {Record<string, string>} */
	const sectionSummaries = $derived({
		theme: THEME_OPTIONS.find((option) => option.id === preferencesStore.theme)?.label ?? '',
		background:
			BACKGROUND_OPTIONS.find((option) => option.id === preferencesStore.background)?.label ?? '',
		'ui-skin': UI_SKINS.find((option) => option.id === skinStore.uiSkin)?.label ?? '',
		'node-skin': NODE_SKINS.find((option) => option.id === skinStore.nodeSkin)?.label ?? '',
		'startup-mode':
			STARTUP_MODE_OPTIONS.find((option) => option.id === preferencesStore.startupMode)?.label ??
			'',
		explicit: preferencesStore.showExplicit ? 'Shown' : 'Hidden',
		'audio-playlist': preferencesStore.randomizeAudioTracks ? 'Shuffled' : 'In order',
		'entry-types': `${AMBIENT_TYPES.filter((type) => preferencesStore.isAmbientTypeVisible(type.id)).length} of ${AMBIENT_TYPES.length} in Ambient`,
		tags: filtersStore.tags.size ? `${filtersStore.tags.size} selected` : 'All',
		'not-for-me': `${hiddenStore.size} ${hiddenStore.size === 1 ? 'entry' : 'entries'}`,
		journal: `${journalStore.size} ${journalStore.size === 1 ? 'entry' : 'entries'}`
	});

	/** @param {number} ms */
	function formatSeconds(ms) {
		return `${Math.round(ms / 1000)}s`;
	}

	// --------------------------------------------------------- your data ---

	/** @type {HTMLInputElement | undefined} */
	let fileInput = $state(undefined);
	let importMessage = $state('');
	let importFailed = $state(false);

	// Recomputed after an import or a journal clear rather than derived from a
	// store: localData reads localStorage directly, which is not reactive, so
	// a bump is what tells this to look again.
	let dataVersion = $state(0);
	const exportItems = $derived.by(() => {
		dataVersion;
		return browser ? summarize() : [];
	});

	function handleExport() {
		const blob = new Blob([JSON.stringify(buildExport(), null, 2)], {
			type: 'application/json'
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = exportFilename();
		link.click();
		// Revoked on the next tick, not immediately: revoking synchronously
		// after click() can race the browser's own read of the blob.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	/** @param {Event} event */
	async function handleImport(event) {
		const input = /** @type {HTMLInputElement} */ (event.currentTarget);
		const file = input.files?.[0];
		if (!file) return;

		importMessage = '';
		importFailed = false;

		try {
			const parsed = JSON.parse(await file.text());
			const result = applyImport(parsed);
			if (!result.ok) {
				importFailed = true;
				importMessage = result.error ?? 'That file could not be imported.';
			} else {
				const ignoredNote = result.ignored?.length
					? ` ${result.ignored.length} unrecognised item(s) were skipped.`
					: '';
				importMessage = `Restored: ${result.restored?.join(', ')}.${ignoredNote} Reload to see everything applied.`;
				dataVersion += 1;
			}
		} catch {
			importFailed = true;
			importMessage = 'That file is not valid JSON.';
		}

		// Cleared so re-picking the same file fires `change` again.
		input.value = '';
	}
</script>

<svelte:head>
	<title>Settings, IndieNodes</title>
</svelte:head>

<div class="settings-page">
	{#snippet sectionList(tab = 'content', sections = CONTENT_SECTIONS, label = '')}
		<ul class="section-list glass-panel" aria-label={label}>
			{#each sections as section (section.id)}
				<li>
					<button
						type="button"
						id="{tab}-section-row-{section.id}"
						class="section-row"
						onclick={() => drillInto(tab, section.id)}
					>
						<span class="section-row-text">
							<span class="section-row-label">{section.label}</span>
							{#if sectionSummaries[section.id]}
								<span class="section-row-summary">{sectionSummaries[section.id]}</span>
							{/if}
						</span>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
					</button>
				</li>
			{/each}
		</ul>
	{/snippet}

	{#snippet backButton(tab = 'content', label = '')}
		<button type="button" class="section-back" onclick={() => drillOut(tab)}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
			{label}
		</button>
	{/snippet}

	<h1>Settings</h1>
	<p class="lede">
		Preferences and filters live only in this browser's local storage. Nothing here is sent to a
		server.
	</p>

	<div class="tabs" role="tablist" aria-label="Settings sections">
		{#each TABS as tab (tab.id)}
			<button
				type="button"
				role="tab"
				id="settings-tab-{tab.id}"
				aria-selected={activeTab === tab.id}
				aria-controls="settings-panel-{tab.id}"
				class="tab"
				class:active={activeTab === tab.id}
				onclick={() => selectTab(tab.id)}
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<div class="panel-container">
		{#key activeTab}
			<div class="panel" in:fade={{ duration: 120 }} out:outFade={{ duration: 120 }}>
				{#if activeTab === 'appearance'}
					<div
						role="tabpanel"
						id="settings-panel-appearance"
						aria-labelledby="settings-tab-appearance"
						class="panel-body"
					>
						<div class="subtabs-layout">
							{#if narrow.current && !appearanceDrilled}
								{@render sectionList('appearance', APPEARANCE_SECTIONS, 'Appearance settings')}
							{:else if narrow.current}
								{@render backButton('appearance', 'Appearance')}
							{:else}
								<div
									class="section-tabs"
									role="tablist"
									aria-label="Appearance settings"
									aria-orientation="vertical"
								>
									{#each APPEARANCE_SECTIONS as section (section.id)}
										<button
											type="button"
											role="tab"
											id="appearance-section-tab-{section.id}"
											aria-selected={activeAppearanceSection === section.id}
											aria-controls="appearance-section-panel-{section.id}"
											class="section-tab"
											class:active={activeAppearanceSection === section.id}
											onclick={() => (activeAppearanceSection = section.id)}
										>
											{section.label}
										</button>
									{/each}
								</div>
							{/if}

							{#if !narrow.current || appearanceDrilled}
								<div class="section-panel-container">
									{#key activeAppearanceSection}
										<div
											role={narrow.current ? 'region' : 'tabpanel'}
											id="appearance-section-panel-{activeAppearanceSection}"
											aria-labelledby={narrow.current
												? undefined
												: `appearance-section-tab-${activeAppearanceSection}`}
											aria-label={narrow.current
												? sectionLabel(APPEARANCE_SECTIONS, activeAppearanceSection)
												: undefined}
											tabindex="-1"
											class="section-panel"
											in:flyFade={{ x: 16, duration: 200, delay: 80 }}
											out:outFade={{ duration: 150 }}
										>
											<GlassPanel as="section" class="settings-section">
												{#if activeAppearanceSection === 'theme'}
													<div class="section-header">
														<h2>Theme</h2>
													</div>
													<fieldset>
														<legend class="sr-only">Theme</legend>
														{#each THEME_OPTIONS as option (option.id)}
															<label class="option">
																<input
																	type="radio"
																	name="theme"
																	value={option.id}
																	checked={preferencesStore.theme === option.id}
																	onchange={() => preferencesStore.setTheme(option.id)}
																/>
																<span>
																	<span class="option-label">{option.label}</span>
																	<span class="option-description">{option.description}</span>
																</span>
															</label>
														{/each}
													</fieldset>
												{:else if activeAppearanceSection === 'background'}
													<div class="section-header">
														<h2>Background</h2>
													</div>
													{#if reducedMotion.current}
														<p class="reduced-motion-note">
															Your system's reduced-motion setting is on. Drifty Stars will show as
															a single still frame instead of animating, on purpose: it's the same
															setting that keeps this page's own transitions short.
														</p>
													{/if}
													<fieldset>
														<legend class="sr-only">Background</legend>
														{#each BACKGROUND_OPTIONS as option (option.id)}
															<label class="option">
																<input
																	type="radio"
																	name="background"
																	value={option.id}
																	checked={preferencesStore.background === option.id}
																	onchange={() => preferencesStore.setBackground(option.id)}
																/>
																<span>
																	<span class="option-label">{option.label}</span>
																	<span class="option-description">{option.description}</span>
																</span>
															</label>
														{/each}
													</fieldset>
												{:else if activeAppearanceSection === 'ui-skin'}
													<div class="section-header">
														<h2>UI Skin</h2>
														<p class="section-description">
															The app's own chrome — panels, buttons, backgrounds. Independent of
															Node Skin below: the two are chosen separately, and a future skin can
															bundle both without them being locked together.
														</p>
													</div>
													<fieldset>
														<legend class="sr-only">UI Skin</legend>
														{#each UI_SKINS as option (option.id)}
															<label class="option">
																<input
																	type="radio"
																	name="ui-skin"
																	value={option.id}
																	checked={skinStore.uiSkin === option.id}
																	onchange={() => skinStore.setUiSkin(option.id)}
																/>
																<span>
																	<span class="option-label">{option.label}</span>
																	<span class="option-description">{option.description}</span>
																</span>
															</label>
														{/each}
													</fieldset>
												{:else if activeAppearanceSection === 'node-skin'}
													<div class="section-header">
														<h2>Node Skin</h2>
														<p class="section-description">
															How a ring-entry card looks, animates, and sounds. Independent of UI
															Skin above.
														</p>
													</div>
													<fieldset>
														<legend class="sr-only">Node Skin</legend>
														{#each NODE_SKINS as option (option.id)}
															<label class="option">
																<input
																	type="radio"
																	name="node-skin"
																	value={option.id}
																	checked={skinStore.nodeSkin === option.id}
																	onchange={() => skinStore.setNodeSkin(option.id)}
																/>
																<span>
																	<span class="option-label">{option.label}</span>
																	<span class="option-description">{option.description}</span>
																</span>
															</label>
														{/each}
													</fieldset>
													<p class="skin-tools">
														{#if dev}
															<!-- /dev/skins is not a SvelteKit route: it is served by the skinLab() dev
														     middleware in vite.config.js, which mounts src/dev/skin-lab.js from its
														     own HTML shell. `resolve()` is typed over real routes and rejects it on
														     a clean checkout. The path is a {@const} inside this block rather than a
														     literal attribute because Svelte hoists fully-static markup to module
														     scope, which would survive the dead-code elimination of `{#if dev}` and
														     leak the developer surface into production builds — scripts/
														     verify-production-build.js fails the build on exactly that. -->
															{@const skinLabHref = '/dev/skins'}
															<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- see above -->
															<a href={skinLabHref}>Open the skin laboratory</a>
														{/if}
													</p>
												{:else if activeAppearanceSection === 'startup-mode'}
													<div class="section-header">
														<h2>Startup mode</h2>
														<p class="section-description">Which mode the app opens into.</p>
													</div>
													<fieldset>
														<legend class="sr-only">Startup mode</legend>
														{#each STARTUP_MODE_OPTIONS as option (option.id)}
															<label class="option">
																<input
																	type="radio"
																	name="startup-mode"
																	value={option.id}
																	checked={preferencesStore.startupMode === option.id}
																	onchange={() => preferencesStore.setStartupMode(option.id)}
																/>
																<span>
																	<span class="option-label">{option.label}</span>
																	<span class="option-description">{option.description}</span>
																</span>
															</label>
														{/each}
													</fieldset>
												{/if}
											</GlassPanel>
										</div>
									{/key}
								</div>
							{/if}
						</div>
					</div>
				{:else}
					<div
						role="tabpanel"
						id="settings-panel-content"
						aria-labelledby="settings-tab-content"
						class="panel-body"
					>
						<!-- A vertical tab list on the left (one title per section) and one
						     section's content on the right, rather than every section
						     stacked and visible at once: with seven of them, reaching the
						     one you actually wanted used to mean scrolling past six
						     others. On a phone it becomes a drill-down list instead (see
						     `narrow` in the script). Shared with the Appearance tab's own
						     four sections, hence the generic name. -->
						<div class="subtabs-layout">
							{#if narrow.current && !contentDrilled}
								{@render sectionList('content', CONTENT_SECTIONS, 'Content settings')}
							{:else if narrow.current}
								{@render backButton('content', 'Content')}
							{:else}
								<div
									class="section-tabs"
									role="tablist"
									aria-label="Content settings"
									aria-orientation="vertical"
								>
									{#each CONTENT_SECTIONS as section (section.id)}
										<button
											type="button"
											role="tab"
											id="content-section-tab-{section.id}"
											aria-selected={activeContentSection === section.id}
											aria-controls="content-section-panel-{section.id}"
											class="section-tab"
											class:active={activeContentSection === section.id}
											onclick={() => (activeContentSection = section.id)}
										>
											{section.label}
										</button>
									{/each}
								</div>
							{/if}

							{#if !narrow.current || contentDrilled}
								<div class="section-panel-container">
									{#key activeContentSection}
										<div
											role={narrow.current ? 'region' : 'tabpanel'}
											id="content-section-panel-{activeContentSection}"
											aria-labelledby={narrow.current
												? undefined
												: `content-section-tab-${activeContentSection}`}
											aria-label={narrow.current
												? sectionLabel(CONTENT_SECTIONS, activeContentSection)
												: undefined}
											tabindex="-1"
											class="section-panel"
											in:flyFade={{ x: 16, duration: 200, delay: 80 }}
											out:outFade={{ duration: 150 }}
										>
											<GlassPanel as="section" class="settings-section">
												{#if activeContentSection === 'explicit'}
													<div class="section-header">
														<h2>Explicit content</h2>
														<p class="section-description">
															Creators declare this on their own entry. Filtered out unless you turn
															it on, and the setting applies everywhere at once: the field, Members,
															and your Lists.
														</p>
													</div>
													<label class="option">
														<input
															type="checkbox"
															checked={preferencesStore.showExplicit}
															onchange={(event) =>
																preferencesStore.setShowExplicit(event.currentTarget.checked)}
														/>
														<span>
															<span class="option-label">Show explicit content</span>
															<span class="option-description">
																Off by default. Entries marked explicit stay hidden until you ask
																for them.
															</span>
														</span>
													</label>
												{:else if activeContentSection === 'audio-playlist'}
													<div class="section-header">
														<h2>Audio playlist</h2>
														<p class="section-description">
															Choose how a node's tracks enter your playlist when you press Play or
															+ Queue. This does not rearrange anything already queued.
														</p>
													</div>
													<label class="option">
														<input
															type="checkbox"
															checked={preferencesStore.randomizeAudioTracks}
															onchange={(event) =>
																preferencesStore.setRandomizeAudioTracks(
																	event.currentTarget.checked
																)}
														/>
														<span>
															<span class="option-label">Randomize tracks within each node</span>
															<span class="option-description">
																Each time an audio node is played or added, its tracks are inserted
																in a new random order. Nodes remain grouped together.
															</span>
														</span>
													</label>
												{:else if activeContentSection === 'entry-types'}
													<div class="section-header">
														<h2>Entry types</h2>
														<p class="section-description">
															Content type is set per node now, not globally. Use
															<strong>Arrange</strong> on the Field to add a node and choose what it pulls,
															so you can keep an audio node beside a comic node instead of narrowing everything
															at once.
														</p>
													</div>

													<div class="section-header">
														<h3>Ambient View</h3>
														<p class="section-description">
															Ambient has no nodes to arrange, so it draws from every type by
															default. Turn a type off to keep it out of Ambient's rotation on this
															device — audio also leaves the sound dock — without touching the
															Field.
														</p>
													</div>
													<fieldset>
														<legend class="sr-only">Ambient View entry types</legend>
														{#each AMBIENT_TYPES as type (type.id)}
															<label class="option">
																<input
																	type="checkbox"
																	checked={preferencesStore.isAmbientTypeVisible(type.id)}
																	onchange={(event) =>
																		preferencesStore.setAmbientTypeVisible(
																			type.id,
																			event.currentTarget.checked
																		)}
																/>
																<span>
																	<span class="option-label">
																		<span
																			class="type-swatch"
																			style:background={type.color}
																			aria-hidden="true"
																		></span>
																		{type.label}
																	</span>
																</span>
															</label>
														{/each}
													</fieldset>
												{:else if activeContentSection === 'tags'}
													<div class="section-header">
														<h2>Tags</h2>
														<p class="section-description">
															Every tag currently used across the ring. Leave all unchecked to see
															every tag.
														</p>
													</div>
													{#if availableTags.length === 0 && !ringStore.settled}
														<p class="empty-note">Loading the ring…</p>
													{:else if availableTags.length === 0}
														<p class="empty-note">No tags in the ring yet.</p>
													{:else}
														<div class="chip-group">
															{#each availableTags as tag (tag)}
																<label class="chip" class:checked={filtersStore.tags.has(tag)}>
																	<input
																		type="checkbox"
																		checked={filtersStore.tags.has(tag)}
																		onchange={() => filtersStore.toggleTag(tag)}
																	/>
																	{tag}
																</label>
															{/each}
														</div>
													{/if}

													<div class="filter-footer">
														<p class="match-count">
															{matchCount} of {ringStore.entries.length} entries match these filters.
														</p>
														{#if filtersStore.tags.size > 0}
															<button
																type="button"
																class="clear-button"
																onclick={() => filtersStore.clear()}
															>
																Clear filters
															</button>
														{/if}
													</div>
												{:else if activeContentSection === 'not-for-me'}
													<div class="section-header">
														<h2>Not for Me</h2>
														<p class="section-description">
															Nodes you marked Not for Me stop rotating into the field on this
															device. They stay in the ring for everyone else. Restore them one at a
															time from the <a href={resolve('/lists')}>Not for Me tab on Lists</a>,
															or clear the whole list at once here.
														</p>
													</div>
													<div class="filter-footer">
														<p class="match-count">
															{hiddenStore.size}
															{hiddenStore.size === 1 ? 'entry' : 'entries'} dismissed on this device.
														</p>
														{#if hiddenStore.size > 0}
															<button
																type="button"
																class="clear-button"
																onclick={() => hiddenStore.clear()}
															>
																Clear dismissed
															</button>
														{/if}
													</div>
												{:else if activeContentSection === 'rotation'}
													<div class="section-header">
														<h2>Rotation pace</h2>
														<p class="section-description">
															How long a node holds an entry before moving on, per content type.
															Audio is quick to sample; a comic page has to be read. This changes
															pacing only: every entry still appears, and you still never choose
															what comes next.
														</p>
													</div>
													<div class="pace-list">
														{#each ROTATION_TYPES as type (type.id)}
															<div class="pace-row">
																<label class="pace-label" for="pace-{type.id}">
																	<span
																		class="pace-swatch"
																		style:background={type.color}
																		aria-hidden="true"
																	></span>
																	{type.label}
																</label>
																<input
																	id="pace-{type.id}"
																	type="range"
																	min={ROTATION_MIN_MS}
																	max={ROTATION_MAX_MS}
																	step="1000"
																	value={preferencesStore.rotationFor(type.id)}
																	oninput={(event) =>
																		preferencesStore.setRotation(
																			type.id,
																			Number(event.currentTarget.value)
																		)}
																/>
																<span class="pace-value"
																	>{formatSeconds(preferencesStore.rotationFor(type.id))}</span
																>
															</div>
														{/each}
													</div>
													<button
														type="button"
														class="clear-button"
														onclick={() => preferencesStore.resetRotation()}
													>
														Reset to defaults
													</button>
												{:else if activeContentSection === 'your-data'}
													<div class="section-header">
														<h2>Your data</h2>
														<p class="section-description">
															Everything IndieNodes knows about you is in this browser and nowhere
															else. You can take all of it with you, or bring it from another
															device.
														</p>
													</div>

													{#if exportItems.length === 0}
														<p class="empty-note">Nothing stored yet.</p>
													{:else}
														<ul class="data-list">
															{#each exportItems as item (item.key)}
																<li>
																	<span>{item.label}</span>
																	{#if item.count !== null}
																		<span class="data-count">{item.count}</span>
																	{/if}
																</li>
															{/each}
														</ul>
														<p class="empty-note">
															The discovery journal is a fuller record of what you have looked at
															than your likes are. It never leaves this browser on its own;
															downloading it is the one time it can.
														</p>
													{/if}

													<div class="data-actions">
														<button
															type="button"
															class="data-button"
															onclick={handleExport}
															disabled={exportItems.length === 0}
														>
															Download my data
														</button>
														<button
															type="button"
															class="data-button"
															onclick={() => fileInput?.click()}
														>
															Import from a file
														</button>
														<input
															bind:this={fileInput}
															type="file"
															accept="application/json,.json"
															class="sr-only"
															onchange={handleImport}
														/>
													</div>

													{#if importMessage}
														<p class="import-message" class:error={importFailed} role="status">
															{importMessage}
														</p>
													{/if}
												{:else if activeContentSection === 'journal'}
													<h2>Your discovery journal</h2>
													<p class="reduced-motion-note">
														A local record of what you have opened, liked, and listened through. It
														never leaves this browser, nothing is sent anywhere, and nothing reads
														it back to decide what you are shown. It exists so your own history is
														yours to look at.
													</p>
													<div class="filter-footer">
														<p class="match-count">
															{journalStore.size}
															{journalStore.size === 1 ? 'entry' : 'entries'} recorded on this device.
														</p>
														{#if journalStore.size > 0}
															<button
																type="button"
																class="clear-button"
																onclick={() => {
																	journalStore.clear();
																	dataVersion += 1;
																}}
															>
																Clear journal
															</button>
														{/if}
													</div>
												{/if}
											</GlassPanel>
										</div>
									{/key}
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{/key}
	</div>
</div>

<style>
	.settings-page {
		/* Wider than the Appearance tab strictly needs, so the Content tab's
		   two columns have real room: at 48rem a 2-column grid left each
		   column too narrow for the rotation sliders and tag chips to breathe.
		   Appearance just ends up with a little more margin around its two
		   panels, which costs nothing. */
		max-width: 64rem;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1.6rem;
	}

	.lede {
		color: var(--text-muted);
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		border-bottom: 1px solid var(--border);
	}

	.tab {
		display: inline-flex;
		align-items: center;
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

	/* Same fix as AboutModal's tab panels: the outgoing panel goes
	   position:absolute during its own exit (outFade), so switching tabs
	   overlays the old content fading out instead of stacking both in
	   normal flow and popping the layout. min-height lives on the
	   container, not the panel, for the same reason: once the outgoing
	   panel goes absolute it stops contributing to this element's height. */
	.panel-container {
		position: relative;
		min-height: 26rem;
	}

	.panel-body {
		display: flex;
		flex-direction: column;
		gap: 1.6rem;
	}

	/* Shared by both tabs: a fixed-width vertical tab rail plus one flexible
	   content column, rather than every section stacked and visible at
	   once. Collapses to the tabs sitting above the content, in a row,
	   below the breakpoint this used to collapse the old two-column stack
	   at. Content needed this first (seven sections make the old layout a
	   long scroll); Appearance reuses the identical block once it grew a
	   third and fourth section (UI Skin, Node Skin) of its own. */
	.subtabs-layout {
		display: grid;
		grid-template-columns: 12rem minmax(0, 1fr);
		gap: 2rem;
		align-items: start;
	}

	.section-tabs {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		/* Sticky rather than static: the right column can run considerably
		   taller than seven tab labels (Tags' chip grid, the rotation
		   sliders), and losing the tab list off the top of the viewport while
		   scrolling a long section would mean scrolling back up just to
		   switch to a shorter one. */
		position: sticky;
		top: 1.5rem;
	}

	.section-tab {
		text-align: left;
		padding: 0.6rem 0.85rem;
		border: none;
		border-left: 2px solid transparent;
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		background: none;
		color: var(--text-muted);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		line-height: 1.3;
		cursor: pointer;
	}

	.section-tab:hover {
		color: var(--text);
		background: var(--glass-bg);
	}

	.section-tab.active {
		color: var(--accent);
		border-left-color: var(--accent);
		background: var(--glass-bg);
	}

	/* Same fix as the outer tab switch above, and the same one Lists needed
	   (docs/decisions.md): outFade's outgoing panel goes position:absolute
	   for the length of its own exit, so it needs a positioned ancestor to
	   anchor against, and min-height belongs here rather than on the panel
	   itself for the same reason — once the outgoing panel goes absolute it
	   stops contributing to this element's height. */
	.section-panel-container {
		position: relative;
		min-height: 20rem;
	}

	/* Below this width the sidebar is not rendered at all: the phone list and
	   back button below replace it (see `narrow` in the script, which uses the
	   same breakpoint). */
	@media (max-width: 56rem) {
		.subtabs-layout {
			grid-template-columns: 1fr;
			gap: 0.9rem;
		}
	}

	.section-list {
		margin: 0;
		padding: 0.3rem;
		list-style: none;
	}

	.section-list li + li {
		border-top: 1px solid var(--border);
	}

	.section-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		min-height: 3.25rem;
		padding: 0.6rem 0.75rem;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.section-row:hover {
		background: var(--glass-bg);
	}

	/* Summary under the label rather than beside it: side by side, a phone's
	   width squeezed labels like "Explicit content" onto two lines. */
	.section-row-text {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.section-row-label {
		font-weight: 600;
	}

	.section-row-summary {
		overflow: hidden;
		color: var(--text-muted);
		font-size: var(--text-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.section-row svg,
	.section-back svg {
		flex: 0 0 auto;
		width: 1.1rem;
		height: 1.1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.section-row svg {
		color: var(--text-muted);
	}

	.section-back {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		justify-self: start;
		min-height: 2.75rem;
		padding: 0.4rem 0.75rem 0.4rem 0.4rem;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--accent);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.section-back:hover {
		background: var(--glass-bg);
	}

	.section-panel:focus {
		outline: none;
	}

	:global(.settings-section) {
		padding: 2.5rem;
	}

	@media (max-width: 56rem) {
		:global(.settings-section) {
			padding: 1.25rem;
		}
	}

	.section-header {
		margin-bottom: 1.6rem;
	}

	h2 {
		margin-bottom: 0.4rem;
	}

	.section-description {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.section-description a {
		color: var(--accent);
	}

	.section-description a:hover {
		text-decoration: underline;
	}

	.reduced-motion-note {
		margin-bottom: 1.6rem;
		padding: 1.2rem 1.65rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.skin-tools {
		margin-top: 1.5rem;
		font-size: var(--text-sm);
	}

	.skin-tools a {
		color: var(--accent);
		font-weight: 700;
	}

	fieldset {
		border: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 1.45rem;
	}

	/* .option, .option-label, .option-description, .chip-group and .chip now
	   live in src/app.css, shared with the submission form on /join. */

	/* Same dot as .pace-swatch, but with its own margin rather than relying
	   on a flex parent's gap: .option-label is a plain block, not a flex
	   row, since every other user of it is text-only. */
	.type-swatch {
		display: inline-block;
		width: 0.65rem;
		height: 0.65rem;
		margin-right: 0.5rem;
		border-radius: 999px;
	}

	.empty-note {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.filter-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		/* Used to be a standalone element between two panels, spaced by
		   panel-body's flex gap. Now it sits inside a panel, directly under
		   whatever content precedes it, so it needs its own top margin. */
		margin-top: 1.2rem;
	}

	/* ...except after the journal's reduced-motion-note, which already
	   carries its own 1.6rem bottom margin; without this override the two
	   would stack into a noticeably bigger gap than every other pair of
	   stacked elements in this tab. */
	.reduced-motion-note + .filter-footer {
		margin-top: 0;
	}

	.match-count {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.pace-list {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		margin-bottom: 1rem;
	}

	.pace-row {
		display: grid;
		grid-template-columns: 7.5rem minmax(0, 1fr) 2.5rem;
		align-items: center;
		gap: 0.8rem;
	}

	.pace-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.pace-swatch {
		width: 0.65rem;
		height: 0.65rem;
		flex-shrink: 0;
		border-radius: 999px;
	}

	.pace-value {
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	@media (max-width: 34rem) {
		.pace-row {
			grid-template-columns: minmax(0, 1fr) 2.5rem;
		}

		.pace-label {
			grid-column: 1 / -1;
		}
	}

	.data-list {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 0.8rem;
		padding: 0;
		list-style: none;
	}

	.data-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		font-size: var(--text-sm);
	}

	.data-count {
		color: var(--text-muted);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}

	.data-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 1rem;
	}

	.data-button {
		padding: 0.5rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}

	.data-button:hover:not(:disabled) {
		background: var(--glass-bg);
		border-color: var(--accent);
		color: var(--accent);
	}

	.data-button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.import-message {
		margin-top: 0.8rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.import-message.error {
		color: #e0455f;
	}

	/* .clear-button and .sr-only now live in src/app.css. */
</style>
