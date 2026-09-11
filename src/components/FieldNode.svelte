<script>
	/**
	 * A single ring entry, rendered as a square card. Used by both the field
	 * view and the Lists page, so the like state and visit-out behavior
	 * only exist in one place.
	 *
	 * Tapping a node is supposed to open the reader (brief section 7c); the
	 * reader doesn't exist yet, so this links out to source_url instead, as
	 * an explicit "Visit" button rather than making the whole card a silent
	 * link. Revisit once the reader exists (docs/open-questions.md).
	 *
	 * This component is the *shell*: the card frame, the type color, the
	 * cover image and its scrim, the badge, the like and hide toggles, the
	 * text, the Visit button, and the optional rotation progress indicator. The
	 * type-specific ornament layered over that background lives in a separate
	 * stage component per type (./stages/), so a richer future treatment (the
	 * roadmap's record player, comic book, console, book) is a new file rather
	 * than a rewrite of everything here.
	 *
	 * Background is the entry's own cover image via `coverImageUrl()`, which
	 * applies to every type, not just games and comics. Entries without one
	 * fall back to a wash of the type color.
	 *
	 * `aspect` comes from the node's configured cell span rather than being
	 * fixed at 1/1, so a wide comic node is genuinely wide. Audio and game
	 * are constrained to square upstream (src/lib/nodeShape.js), not here.
	 *
	 * @type {{
	 *   entry: import('../lib/ring.js').RingEntry,
	 *   progress?: number | null,
	 *   progressPaused?: boolean,
	 *   aspect?: string,
	 *   editMode?: boolean,
	 *   ambient?: boolean,
	 *   showCurateControls?: boolean,
	 *   showActions?: boolean,
	 *   immersive?: boolean,
	 *   motionReducedOverride?: boolean | null,
	 *   onUnlikeRequest?: (entry: import('../lib/ring.js').RingEntry) => void
	 * }}
	 *
	 * `ambient` is true only from the field view (FieldSlot passes it; Lists
	 * does not). It does two things the brief's section 8 asks for
	 * specifically there and nowhere else: the like/hide controls stay
	 * invisible until hover or focus, so the field doesn't read as a rating
	 * grid, and a currently-hidden entry that is still occupying this slot
	 * (dismissal doesn't swap it out immediately, see section 11) visibly goes
	 * quiet in place rather than carrying on as if nothing happened.
	 */
	let {
		entry,
		progress = null,
		progressPaused = false,
		aspect = '1 / 1',
		editMode = false,
		ambient = false,
		showCurateControls = true,
		showActions = true,
		immersive = false,
		motionReducedOverride = null,
		onUnlikeRequest
	} = $props();

	import { onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import { favoritesStore } from '$lib/favoritesStore.svelte.js';
	import { hiddenStore } from '$lib/hiddenStore.svelte.js';
	import { audioPlayerStore } from '$lib/audioPlayerStore.svelte.js';
	import { journalStore } from '$lib/journalStore.svelte.js';
	import { comicViewerStore } from '$lib/comicViewerStore.svelte.js';
	import { textViewerStore } from '$lib/textViewerStore.svelte.js';
	import { hideEntry, likeEntry } from '$lib/entryCuration.js';
	import { coverImageUrl } from '$lib/ring.js';
	import { preload } from '$lib/imagePreloader.js';
	import { reducedMotion } from '$lib/motion.svelte.js';
	import { playSkinSound } from '$lib/skinSound.js';
	import { flyFade, outFade } from '$lib/transitions.js';
	import { DEFAULT_NODE_SKIN_ID, loadNodeSkin, resolveNodeStage } from '../skins/registry.js';
	import * as basicNodeSkin from '../skins/node/basic/index.js';
	import { skinStore } from '../skins/skinStore.svelte.js';
	import TextSpeechButton from './TextSpeechButton.svelte';

	const TYPE_LABEL = { audio: 'Audio', comic: 'Comic', text: 'Text', game: 'Game', art: 'Art' };
	const FORM_LABEL = { music: 'Music', spoken: 'Spoken' };
	let trailerPlaying = $state(false);
	let trailerPausedTrackKey = /** @type {string | null} */ (null);

	const cover = $derived(coverImageUrl(entry));
	const coverPosition = $derived(
		`${entry.thumb_position?.x ?? 50}% ${entry.thumb_position?.y ?? 50}%`
	);

	// Only audio entries with at least one usable track get a play control.
	// An audio entry with no playable file is a legitimate shape, not a
	// broken one: a creator whose music only lives somewhere that cannot
	// supply a stable direct file still belongs in the ring, and still gets
	// its cover, its badge, and its Visit link. It just does not play here.
	const playable = $derived(
		entry.type === 'audio' && (entry.tracks ?? []).some((track) => !!track.media_url)
	);
	const isCurrent = $derived(playable && audioPlayerStore.isCurrentEntry(entry.id));
	const isPreviewing = $derived(playable && audioPlayerStore.isPreviewEntry(entry.id));

	// What the play control will actually do, decided once here rather than
	// inline in the template. With nothing loaded it plays; with a queue
	// already running it auditions instead, because replacing a queue somebody
	// built by hand is destructive and should never be what a single click on
	// an unrelated node does. "+ Queue" beside it is the deliberate version.
	const willPreview = $derived(playable && !isCurrent && !audioPlayerStore.isEmpty);

	/** @param {boolean} open */
	function handleTrailerChange(open) {
		trailerPlaying = open;
		if (open) {
			if (audioPlayerStore.playing && audioPlayerStore.current) {
				trailerPausedTrackKey = audioPlayerStore.current.key;
				audioPlayerStore.setPlaying(false);
			}
			return;
		}
		const shouldResume =
			trailerPausedTrackKey && audioPlayerStore.current?.key === trailerPausedTrackKey;
		trailerPausedTrackKey = null;
		if (shouldResume && !audioPlayerStore.playing) audioPlayerStore.setPlaying(true);
	}

	onDestroy(() => handleTrailerChange(false));

	function handlePlayControl() {
		if (isPreviewing) {
			audioPlayerStore.stopPreview();
		} else if (isCurrent) {
			audioPlayerStore.toggle();
		} else if (audioPlayerStore.isEmpty) {
			audioPlayerStore.playEntry(entry, cover);
		} else {
			audioPlayerStore.previewEntry(entry, cover);
		}
	}

	function handleLike() {
		// Un-liking is destructive on a surface that only shows liked entries:
		// the card disappears from under the pointer, and the visitor has no
		// way back to it except remembering what it was. Lists passes
		// `onUnlikeRequest` to intercept exactly that case. Everywhere else,
		// and for liking in either direction, the toggle stays immediate,
		// because a mis-click there costs one more click to undo with the card
		// still in front of you.
		if (favoritesStore.isLiked(entry.id) && onUnlikeRequest) {
			onUnlikeRequest(entry);
			return;
		}
		likeEntry(entry.id);
	}

	function handleHide() {
		hideEntry(entry.id);
	}

	function handleVisit() {
		// "Opened" means leaving for the creator's own site.
		journalStore.record(entry.id, 'opened');
	}

	// Comics and Art share the full-screen image viewer, but keep their own
	// semantics there: pages are sequential; artworks are independent works.
	// Text has its own reader instead (see `textViewerStore`): a text sample
	// is prose, not imagery, and the comic/art viewer's pan-and-zoom gesture
	// engine has nothing to offer it.
	const viewable = $derived(
		(entry.type === 'comic' && (entry.pages ?? []).some((page) => Boolean(page?.image_url))) ||
			(entry.type === 'art' &&
				(entry.artworks ?? []).some((artwork) => Boolean(artwork?.image_url))) ||
			(entry.type === 'text' &&
				(entry.excerpts ?? []).some((sample) => Boolean(sample?.text?.trim())))
	);

	function handleView() {
		// Opening the viewer is the in-app equivalent of a visit: it is the
		// visitor choosing to look closely at the creator's representative work.
		journalStore.record(entry.id, 'opened');
		if (entry.type === 'text') {
			textViewerStore.show(entry);
			return;
		}
		comicViewerStore.show(entry);
	}

	// Fed by `TextStage`'s own rotation, so the card's read-aloud control
	// (further down) always acts on whichever sample is actually showing
	// rather than always the first one.
	let currentTextExcerptIndex = $state(0);

	/** @param {number} index */
	function handleExcerptChange(index) {
		currentTextExcerptIndex = index;
	}

	// A text stage alternates between introducing the creator and reading
	// their work, and the creator name and pitch belong to this component
	// rather than to the stage, so the stage cannot clear them itself. It
	// says when it has started reading and this steps that chrome out of the
	// way. The actions row deliberately stays: Visit, Read, and the
	// read-aloud control are how someone acts on what they are reading, so
	// they are exactly what should remain reachable mid-read.
	let textReading = $state(false);

	/** @param {boolean} value */
	function handleReadingChange(value) {
		textReading = value;
	}

	// A stage can rotate content inside one creator entry (Art cycles its
	// artworks). The ordinary `progress` prop only exists when the field has
	// another creator to deal into this slot, so keep the stage countdown as a
	// fallback for the one-creator/multiple-works case.
	let stageProgress = $state(/** @type {number | null} */ (null));

	/** @param {number | null} value */
	function handleStageProgressChange(value) {
		stageProgress = value;
	}

	// Keyed by URL rather than a bare boolean: a slot reuses this component
	// across rotations, so a failure recorded for one entry's image must not
	// suppress the next entry's perfectly good one.
	let failedUrl = $state(/** @type {string | null} */ (null));
	const hasImage = $derived(!!cover && failedUrl !== cover);

	// True only when this slot's *current* entry was dismissed while still on
	// screen (brief section 11): the pool stops offering it for future draws
	// immediately, but this specific card doesn't swap out until its own
	// rotation timer fires, so in the meantime it sits here quietly rather
	// than carrying on as an ordinary, inviting card.
	const quiet = $derived(ambient && hiddenStore.isHidden(entry.id));

	// The Field's passive card surface mirrors the clearest in-app action for
	// each medium. Game is intentionally absent: loading a third-party trailer
	// or opening an external site is a larger choice and keeps its labelled
	// Trailer/Visit control. Lists is also absent (ambient is Field-only), so
	// reviewing saved entries retains its existing explicit-control model.
	const hasPrimaryAction = $derived(
		ambient && !editMode && !quiet && (playable || viewable) && entry.type !== 'game'
	);
	function handlePrimaryAction() {
		if (!hasPrimaryAction) return;
		if (entry.type === 'audio') handlePlayControl();
		else handleView();
	}

	const TAP_SLOP_PX = 10;
	const SECONDARY_ACTION_SELECTOR =
		'button, a, input, select, textarea, iframe, [contenteditable="true"], [role="button"]';

	/** @typedef {{ element: Element, left: number, top: number }} ScrollSnapshot */
	/** @typedef {{ pointerId: number, x: number, y: number, cancelled: boolean, scroll: ScrollSnapshot[] }} PrimaryTap */
	let primaryTap = /** @type {PrimaryTap | null} */ (null);
	let suppressPrimaryClick = false;

	/**
	 * Capture every scrollable ancestor, including the document scroller. A
	 * touch can move the page vertically or the fitted Field horizontally;
	 * either means the gesture was navigation, not activation.
	 * @param {Element} target
	 * @returns {ScrollSnapshot[]}
	 */
	function captureScroll(target) {
		const snapshots = [];
		let current = target.parentElement;
		while (current) {
			snapshots.push({ element: current, left: current.scrollLeft, top: current.scrollTop });
			current = current.parentElement;
		}
		const root = document.scrollingElement;
		if (root && !snapshots.some((snapshot) => snapshot.element === root)) {
			snapshots.push({ element: root, left: root.scrollLeft, top: root.scrollTop });
		}
		return snapshots;
	}

	/** @param {ScrollSnapshot[]} snapshots */
	function scrollChanged(snapshots) {
		return snapshots.some(
			(snapshot) =>
				snapshot.element.scrollLeft !== snapshot.left || snapshot.element.scrollTop !== snapshot.top
		);
	}

	/** @param {EventTarget | null} target */
	function isSecondaryActionTarget(target) {
		return target instanceof Element && Boolean(target.closest(SECONDARY_ACTION_SELECTOR));
	}

	/** @param {PointerEvent} event */
	function handlePrimaryPointerDown(event) {
		suppressPrimaryClick = false;
		primaryTap = null;
		if (!hasPrimaryAction || !event.isPrimary || event.button !== 0) return;
		if (isSecondaryActionTarget(event.target)) return;
		primaryTap = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			cancelled: false,
			scroll: captureScroll(/** @type {Element} */ (event.currentTarget))
		};
	}

	/** @param {PointerEvent} event */
	function handlePrimaryPointerMove(event) {
		if (!primaryTap || primaryTap.pointerId !== event.pointerId) return;
		if (Math.hypot(event.clientX - primaryTap.x, event.clientY - primaryTap.y) > TAP_SLOP_PX) {
			primaryTap.cancelled = true;
		}
	}

	/** @param {PointerEvent} event */
	function handlePrimaryPointerUp(event) {
		if (!primaryTap || primaryTap.pointerId !== event.pointerId) return;
		const moved = Math.hypot(event.clientX - primaryTap.x, event.clientY - primaryTap.y);
		suppressPrimaryClick =
			primaryTap.cancelled || moved > TAP_SLOP_PX || scrollChanged(primaryTap.scroll);
		primaryTap = null;
	}

	function handlePrimaryPointerCancel() {
		if (primaryTap) suppressPrimaryClick = true;
		primaryTap = null;
	}

	/** @param {MouseEvent} event */
	function handlePrimaryClick(event) {
		if (!hasPrimaryAction || isSecondaryActionTarget(event.target)) return;
		const selection = window.getSelection();
		const selectionInside =
			!selection?.isCollapsed &&
			selection?.anchorNode instanceof Node &&
			/** @type {Element} */ (event.currentTarget).contains(selection.anchorNode);
		if (suppressPrimaryClick || selectionInside) {
			event.preventDefault();
			suppressPrimaryClick = false;
			return;
		}
		suppressPrimaryClick = false;
		handlePrimaryAction();
	}

	let loadedNodeSkin = $state(
		/** @type {import('../skins/contracts.js').NodeSkinModule | null} */ (null)
	);

	$effect(() => {
		const id = skinStore.nodeSkin;
		if (id === DEFAULT_NODE_SKIN_ID) {
			loadedNodeSkin = null;
			return;
		}
		let active = true;
		loadNodeSkin(id)
			.then((skin) => {
				if (active) loadedNodeSkin = skin;
			})
			.catch((error) => {
				if (active) loadedNodeSkin = null;
				console.error(`Could not load node skin "${id}".`, error);
			});
		return () => {
			active = false;
		};
	});

	const ActiveStage = $derived(resolveNodeStage(loadedNodeSkin, entry.type, basicNodeSkin));
	const visibleProgress = $derived(progress ?? (ambient ? stageProgress : null));

	// A slot reuses this shell across entries and a visitor can switch skins
	// without replacing the entry. Neither should leave a prior stage's timer
	// displayed while the next stage mounts.
	$effect(() => {
		entry.id;
		ActiveStage;
		stageProgress = null;
	});

	const skinMotionReduced = $derived(motionReducedOverride ?? reducedMotion.current);
	const skinServices = $derived(
		/** @type {import('../skins/contracts.js').NodeSkinServices} */ ({
			preloadImage: preload,
			playSound: playSkinSound,
			play: handlePlayControl,
			read: handleView,
			visit: handleVisit
		})
	);
</script>

<div
	class="node"
	data-type={entry.type}
	class:has-image={hasImage}
	class:quiet
	class:trailer-playing={trailerPlaying}
	class:text-reading={textReading}
	class:has-primary-action={hasPrimaryAction}
	class:immersive
	style:--node-aspect={aspect}
>
	<!--
		Keyed on the entry, so a rotation crossfades the *contents* of the card
		while the card itself stays put: the frame, its color, its rounded
		corners, and the progress bar below all belong to the node (a fixed
		position in the field), not to whichever entry is passing through it.
		Transitioning the whole node instead would read as the node leaving and
		a different one arriving, which is not what happens.

		The layer is absolutely positioned and carries the frame's own flex
		column, so the outgoing and incoming copies stack rather than pushing
		each other around during the crossfade, the same technique the page
		transition and the About modal's tab panels already use.
	-->
	{#key entry.id}
		<!-- The labelled Play/Read/View control remains the keyboard equivalent. -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="entry-layer"
			in:flyFade={{ x: 20, duration: 280, delay: 90 }}
			out:outFade={{ duration: 180 }}
			onpointerdown={handlePrimaryPointerDown}
			onpointermove={handlePrimaryPointerMove}
			onpointerup={handlePrimaryPointerUp}
			onpointercancel={handlePrimaryPointerCancel}
			onclick={handlePrimaryClick}
		>
			{#if hasImage}
				<!-- The blurred bed every image-bearing card sits on. Deliberately the
				     same image the stage shows in front, so a card reads as one object
				     rather than a photo pasted onto unrelated wallpaper. Scaled up
				     slightly because a blur samples past its own edges and would
				     otherwise show a soft transparent rim. -->
				<img
					class="backdrop"
					src={cover}
					alt=""
					aria-hidden="true"
					decoding="async"
					referrerpolicy="no-referrer"
					style:object-position={coverPosition}
				/>
			{/if}

			<div class="stage-layer">
				<ActiveStage
					{entry}
					{cover}
					{hasImage}
					paused={progressPaused}
					motionReduced={skinMotionReduced}
					services={skinServices}
					onImageError={() => (failedUrl = cover)}
					onTrailerChange={handleTrailerChange}
					onExcerptChange={handleExcerptChange}
					onReadingChange={handleReadingChange}
					onStageProgressChange={handleStageProgressChange}
				/>
			</div>

			<div class="scrim" aria-hidden="true"></div>

			<!-- The like and hide toggles go while arranging: they sit above the
			     configuration layer and covered the Remove control underneath it,
			     and arranging is not the moment for curating anyway.
			     The type badge stays. It is the one thing on a card that says what
			     kind of node is being resized, which is exactly what you need to
			     know while resizing it — the whole row used to go with the toggles,
			     on the reasoning that the node's own menu states the type, but that
			     means opening a menu per node to read something a chip already
			     says. -->
			<div class="top-row">
				<span class="type-badge"
					>{TYPE_LABEL[entry.type]}{entry.type === 'audio' && entry.form
						? ` · ${FORM_LABEL[entry.form]}`
						: ''}</span
				>
				{#if showCurateControls && !editMode}
					<div class="curate-controls" class:hover-reveal={ambient}>
						<button
							type="button"
							class="hide-toggle"
							class:dismissed={hiddenStore.isHidden(entry.id)}
							onclick={handleHide}
							aria-pressed={hiddenStore.isHidden(entry.id)}
							aria-label={hiddenStore.isHidden(entry.id)
								? `Show ${entry.creator} in the field again`
								: `${entry.creator} is not for me`}
							title={hiddenStore.isHidden(entry.id) ? 'Show in field again' : 'Not for me'}
						>
							<svg
								viewBox="0 0 24 24"
								width="17"
								height="17"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								aria-hidden="true"
							>
								<path
									d="M2.5 12S6 4.5 12 4.5c1.28 0 2.46.28 3.52.74M21.5 12S19.4 16.4 15.4 18.4M17.4 6.6A18.5 18.5 0 0 1 21.5 12M2.5 12A18.4 18.4 0 0 0 8.6 17.4"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
								<path
									d="M9.7 9.7a3 3 0 0 0 4.24 4.24"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
								<path d="M2.5 2.5l19 19" stroke-linecap="round" />
							</svg>
						</button>
						<button
							type="button"
							class="like-toggle"
							class:liked={favoritesStore.isLiked(entry.id)}
							onclick={handleLike}
							aria-pressed={favoritesStore.isLiked(entry.id)}
							aria-label={favoritesStore.isLiked(entry.id)
								? `Remove ${entry.creator} from favorites`
								: `Add ${entry.creator} to favorites`}
							title={favoritesStore.isLiked(entry.id)
								? 'Remove from favorites'
								: 'Add to favorites'}
						>
							<svg
								viewBox="0 0 24 24"
								width="18"
								height="18"
								fill={favoritesStore.isLiked(entry.id) ? 'currentColor' : 'none'}
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
						</button>
					</div>
				{/if}
			</div>

			<div class="content">
				<h3 class="creator-name">{entry.creator}</h3>
				<p class="why">{entry.why}</p>

				{#if showActions}
					<div class="actions">
						<!-- eslint-disable svelte/no-navigation-without-resolve -- entry.source_url is creator-owned, external, not an app route; a block disable rather than next-line, since prettier is free to wrap this tag's attributes across lines and push href away from the comment -->
						<a
							class="visit-button"
							href={entry.source_url}
							target="_blank"
							rel="noopener noreferrer"
							onclick={handleVisit}
						>
							Visit &rarr;
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->

						{#if viewable && !editMode}
							<!-- Kept as the visible, labelled route even though the passive
						     card surface now mirrors it in Field browse mode. Lists still
						     uses this control alone, and Visit remains a separate explicit
						     choice everywhere. -->
							<button
								type="button"
								class="read-button"
								onclick={handleView}
								aria-label={entry.type === 'art'
									? `View ${entry.creator}'s gallery`
									: `Read ${entry.creator}`}
								title={entry.type === 'art' ? 'View gallery' : 'Read here'}
							>
								<svg
									viewBox="0 0 24 24"
									width="15"
									height="15"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									aria-hidden="true"
								>
									<path
										d="M12 6.5C10.5 5 8.5 4.5 4 4.5v13c4.5 0 6.5.5 8 2 1.5-1.5 3.5-2 8-2v-13c-4.5 0-6.5.5-8 2z"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
									<path d="M12 6.5v13" stroke-linecap="round" />
								</svg>
							</button>
						{/if}

						{#if entry.type === 'text' && !editMode}
							<TextSpeechButton {entry} excerptIndex={currentTextExcerptIndex} />
						{/if}

						{#if playable && !editMode}
							<!-- With nothing loaded, this plays. With a queue already
						     running it previews instead: the main audio ducks, this
						     sounds, and the queue is left exactly as it was. That
						     asymmetry is the point. Replacing a queue somebody built
						     by hand is destructive, and it should take a deliberate
						     action rather than being what one click on an unrelated
						     node happens to do.

						     "+ Queue" beside it is the deliberate version, and it
						     appears under exactly the same condition, so the pair
						     reads as "hear it" next to "keep it". -->
							<button
								type="button"
								class="play-button"
								class:playing={(isCurrent && audioPlayerStore.playing) || isPreviewing}
								onclick={handlePlayControl}
								aria-label={isPreviewing
									? `Stop previewing ${entry.creator}`
									: isCurrent && audioPlayerStore.playing
										? `Pause ${entry.creator}`
										: willPreview
											? `Preview ${entry.creator}`
											: `Play ${entry.creator}`}
								title={isPreviewing
									? 'Stop preview'
									: isCurrent && audioPlayerStore.playing
										? 'Pause'
										: willPreview
											? 'Preview (keeps your queue)'
											: 'Play'}
							>
								{#if isPreviewing}
									<svg
										viewBox="0 0 24 24"
										width="16"
										height="16"
										fill="currentColor"
										aria-hidden="true"
									>
										<rect x="6" y="6" width="12" height="12" rx="1.5" />
									</svg>
								{:else if isCurrent && audioPlayerStore.playing}
									<svg
										viewBox="0 0 24 24"
										width="16"
										height="16"
										fill="currentColor"
										aria-hidden="true"
									>
										<path d="M7 5h4v14H7zM13 5h4v14h-4z" />
									</svg>
								{:else if willPreview}
									<!-- A play triangle inside a broken ring: the same verb,
								     marked as provisional, so the control says it will
								     not disturb the queue before it is clicked rather
								     than only in its tooltip. -->
									<svg
										viewBox="0 0 24 24"
										width="16"
										height="16"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										aria-hidden="true"
									>
										<path
											d="M12 3a9 9 0 0 1 8.5 6.1M21 12a9 9 0 0 1-5.5 8.3M12 21a9 9 0 0 1-8.5-6.1M3 12a9 9 0 0 1 5.5-8.3"
											stroke-linecap="round"
										/>
										<path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
									</svg>
								{:else}
									<svg
										viewBox="0 0 24 24"
										width="16"
										height="16"
										fill="currentColor"
										aria-hidden="true"
									>
										<path d="M7 5l12 7-12 7z" />
									</svg>
								{/if}
							</button>

							{#if !audioPlayerStore.isEmpty && !isCurrent}
								<button
									type="button"
									class="queue-button"
									onclick={() => audioPlayerStore.addEntry(entry, cover)}
									aria-label={`Add ${entry.creator} to the queue`}
									title="Add to queue"
								>
									<!-- The same up-next mark the player's queue control uses.
								     Inlined rather than shared, matching how every other
								     icon in this app is handled (the arrange and about
								     marks are likewise repeated across components). -->
									<svg
										viewBox="0 0 24 24"
										width="15"
										height="15"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										aria-hidden="true"
									>
										<path d="M4 6h11M4 11h11M4 16h7" stroke-linecap="round" />
										<path d="M16 12.5l5 3-5 3z" fill="currentColor" stroke="none" />
									</svg>
								</button>
							{/if}
						{/if}

						{#if !editMode}
							<!-- eslint-disable svelte/no-navigation-without-resolve -- the app route is resolved below before the report query is appended -->
							<a
								class="report-button"
								href={`${resolve('/contact')}?report=${encodeURIComponent(entry.id)}`}
								aria-label={`Report a problem with ${entry.creator}`}
								title="Report changed or unsafe content"
							>
								<svg
									viewBox="0 0 24 24"
									width="15"
									height="15"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									aria-hidden="true"
								>
									<path
										d="M5 21V4m0 1h11l-1.7 3L16 11H5"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg>
							</a>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/key}

	{#if visibleProgress !== null}
		<!-- Per-node, because each slot now runs its own rotation timer: a single
		     shared bar cannot represent several independent countdowns at once.
		     Presentational only, hence aria-hidden; nothing here is actionable
		     and the rotation it counts down to is ambient, not an alert. -->
		<div class="progress-track" class:paused={progressPaused} aria-hidden="true">
			<div
				class="progress-fill"
				style:width={`${Math.min(100, Math.max(0, visibleProgress * 100))}%`}
			></div>
		</div>
	{/if}
</div>

<style>
	.node {
		--node-color: var(--type-audio);
		position: relative;
		/* Inside gridstack the cell already has a height, so filling it is
		   what keeps the card matching its span. The aspect-ratio is the
		   fallback for the pre-hydration flow layout and for Lists,
		   which renders these cards outside any grid. */
		aspect-ratio: var(--node-aspect, 1 / 1);
		height: 100%;
		/* Lets the card adapt to its own size rather than the viewport's: a
		   node's dimensions depend on its cell span and the column count, so
		   two cards at one viewport width can differ wildly.
		   `size` rather than `inline-size` because the binding constraint is
		   vertical. A 2:1 card at 391x196 has exactly the same room for text
		   as a square 196x196 one, and querying width alone let the wide card
		   overflow while the square one was correctly handled. Safe here
		   because the card's height never depends on its contents: it comes
		   from the grid cell, or from aspect-ratio outside the grid. */
		container-type: size;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: var(--radius-lg);
		border: 1px solid var(--glass-border);
		box-shadow: var(--glass-shadow);
		background: color-mix(in oklch, var(--node-color) 55%, var(--bg-elevated) 45%);
	}

	/* Browse-mode affordance for cards with one unambiguous in-app action.
	   Uses the individual scale property so it composes independently from
	   Gridstack's positioning transforms. FieldGrid lets the item wrapper
	   overflow while browsing, so the extra one percent is not clipped. */
	.node.has-primary-action {
		cursor: pointer;
		scale: 1;
		transition:
			scale 160ms ease,
			box-shadow 160ms ease,
			border-color 160ms ease;
	}

	@media (hover: hover) and (pointer: fine) {
		.node.has-primary-action:hover,
		.node.has-primary-action:focus-within {
			scale: 1.01;
			border-color: color-mix(in oklch, var(--node-color) 65%, var(--glass-border));
			box-shadow:
				var(--glass-shadow),
				inset 0 0 0 1px color-mix(in oklch, var(--node-color) 28%, transparent);
		}
	}

	/* Ambient view uses the node as the viewport rather than as a card in a
	   grid. The app-owned shell still supplies the stage, scrim, and creator
	   caption, while the mode owns all playback and secondary controls. */
	.node.immersive {
		width: 100%;
		height: 100%;
		aspect-ratio: auto;
		border: 0;
		border-radius: 0;
		box-shadow: none;
	}

	.node.immersive .content {
		padding: 5rem 1.25rem 7rem;
	}

	.node[data-type='game'] {
		--node-color: var(--type-game);
	}

	.node[data-type='comic'] {
		--node-color: var(--type-comic);
	}

	.node[data-type='text'] {
		--node-color: var(--type-text);
	}

	.node[data-type='art'] {
		--node-color: var(--type-art);
	}

	/* A card with a real cover image doesn't need the color wash behind it,
     just enough of a scrim over the image for the overlaid text and
     controls to stay legible regardless of what the image looks like.

     Tinted toward the node's own type color rather than the flat near-black
     (#14120f) this used to be. The backdrop image is only partly opaque, so
     that plate showed through everywhere the artwork itself is dark, which
     on most covers is the outer edges: the card read as a black vignette
     with a black rim tracing the rounded corners, rather than as a card in
     its type color. Measured rather than assumed: pixels just outside the
     corner radius are clean page background, so this was never a clipping
     leak, only the plate showing through. */
	.node.has-image {
		background: color-mix(in oklch, var(--node-color) 38%, #191510);
	}

	/* Layer order, back to front: blurred backdrop, the stage's own
	   presentation, the legibility scrim, then chrome and text. Tunable as
	   custom properties because "some blur, not too much" is a judgement
	   that wants adjusting against real artwork rather than guessing once. */
	.node {
		--node-backdrop-blur: 20px;
		/* Raised from 0.55: the plate behind this is deliberately dark, so a
		   thinner backdrop let that darkness dominate the card's edges. */
		--node-backdrop-opacity: 0.72;
		--node-backdrop-scale: 1.12;
	}

	/* Carries the frame's own layout so the entry's layers sit exactly where
	   they did before this wrapper existed (.content still bottom-aligns via
	   margin-top:auto). Absolute rather than in flow so the outgoing copy can
	   overlay the incoming one for the length of the crossfade instead of
	   stacking below it and doubling the card's height mid-transition. */
	.entry-layer {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
	}

	.backdrop {
		position: absolute;
		inset: 0;
		z-index: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transform: scale(var(--node-backdrop-scale));
		filter: blur(var(--node-backdrop-blur)) saturate(1.15);
		opacity: var(--node-backdrop-opacity);
	}

	.stage-layer {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.node.trailer-playing .stage-layer {
		z-index: 5;
	}

	/* Only meaningful over an image: a color-tinted top fading to a dark
     base, so the type is still identifiable at a glance even with a photo
     behind it, and the text sitting at the bottom stays readable no
     matter how bright or busy that photo is. Over the plain color wash
     (no image) this would just muddy a background that already has the
     contrast the body text needs, so it's transparent there. */
	.scrim {
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
	}

	.node.has-image .scrim {
		background: linear-gradient(
			to bottom,
			color-mix(in oklch, var(--node-color) 45%, transparent) 0%,
			transparent var(--node-scrim-clear, 35%),
			rgb(0 0 0 / var(--node-scrim-depth, 0.75)) 100%
		);
	}

	/* Comics stay closest to untouched: the page is the work, and a scrim
	   sweeping up through it is an edit. The darkening is pushed down to
	   just the band the creator name and Visit button actually occupy, and
	   made shallower, which is enough for legibility without washing the art. */
	.node[data-type='comic'].has-image {
		--node-scrim-clear: 62%;
		--node-scrim-depth: 0.68;
	}

	/* Album art and screenshots are contained rather than filling the card,
	   so the text mostly sits over blurred backdrop rather than over the
	   artwork itself and needs less help. */
	.node[data-type='audio'].has-image,
	.node[data-type='game'].has-image {
		--node-scrim-clear: 45%;
		--node-scrim-depth: 0.7;
	}

	/* Deeper and earlier than every other type: a text sample is read, not
	   glanced at like a caption, and `TextStage` sits it well above the
	   creator-name band this scrim was originally tuned for, so the darkening
	   has to cover most of the card rather than just its bottom third. */
	.node[data-type='text'].has-image {
		--node-scrim-clear: 15%;
		--node-scrim-depth: 0.82;
	}

	/* The identity half of a text card, cleared while the writing half has the
	   floor. Faded rather than removed: the band keeps its height, so the
	   actions row below it does not jump up and reflow the card mid-read.
	   `visibility` follows the fade so the name and pitch are not still
	   announced or focusable once they are invisible. */
	.node.text-reading .creator-name,
	.node.text-reading .why {
		opacity: 0;
		visibility: hidden;
		transition:
			opacity 700ms ease,
			visibility 0s linear 700ms;
	}

	.node .creator-name,
	.node .why {
		transition:
			opacity 700ms ease,
			visibility 0s linear 0s;
	}

	.top-row {
		position: relative;
		z-index: 3;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 0.85rem;
	}

	.type-badge {
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		background: var(--bg-elevated);
		color: var(--node-color);
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		white-space: nowrap;
	}

	.curate-controls {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	/* Field view only (`ambient`): invisible until the card is hovered or
	   focused, per brief section 8, so a grid of many cards doesn't read as a
	   rating grid at rest. Opacity rather than `display`/`visibility`, so a
	   keyboard user tabbing onto the hide button still gets it, and so the
	   fade is an actual transition rather than a snap. Lists never sets
	   `ambient`, so its controls stay permanently visible there, which is the
	   point of a page meant for reviewing what you've marked either way. */
	.curate-controls.hover-reveal {
		opacity: 0;
		transition: opacity 150ms ease;
	}

	.node:hover .curate-controls.hover-reveal,
	.node:focus-within .curate-controls.hover-reveal {
		opacity: 1;
	}

	.like-toggle,
	.hide-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.2rem;
		height: 2.2rem;
		flex-shrink: 0;
		border-radius: 999px;
		border: none;
		background: var(--bg-elevated);
		color: var(--text-muted);
		cursor: pointer;
	}

	.like-toggle.liked {
		color: #e0455f;
	}

	/* Dismissed reads the same weight as liked (a filled ground rather than a
	   color change alone), but in a neutral tone rather than the heart's red:
	   this isn't a "bad" state to warn about, just a toggled-off entry, the
	   same way an un-pressed vs. pressed button differs anywhere else here. */
	.hide-toggle.dismissed {
		background: var(--text-muted);
		color: var(--bg-elevated);
	}

	/* "Goes quiet in place" (brief section 11): this slot's current entry was
	   just dismissed but hasn't been swapped out yet, since that only happens
	   on the node's own scheduled rotation, not immediately. Dimmed and
	   desaturated rather than removed, so the card visibly reads as "on its
	   way out" without actually disappearing (which would be the instant
	   refill this guardrail exists to avoid) or staying fully vivid (which
	   would look like nothing happened at all). `.top-row` is deliberately
	   excluded, so the hide toggle stays reachable to undo the mis-click that
	   put a card in this state. */
	.node.quiet .backdrop,
	.node.quiet .stage-layer,
	.node.quiet .scrim,
	.node.quiet .content {
		opacity: 0.35;
		filter: grayscale(0.6);
		transition:
			opacity 240ms ease,
			filter 240ms ease;
	}

	/* Nothing in the dimmed content band should still be reachable: Visit,
	   Read, Play, and Queue are all offers to engage further with an entry
	   the visitor just said they don't want. */
	.node.quiet .content {
		pointer-events: none;
	}

	/* The metadata band gets its own ground, fading upward out of the card's
	   bottom edge rather than sitting as a hard-edged panel.

	   This matters most on a card with *no* cover image, which is the case
	   that had nothing at all behind its text: the `.scrim` element is always
	   in the DOM but only `.node.has-image .scrim` ever gives it a
	   background, so the creator name and why were sitting directly on the
	   flat type wash with `AudioStage`'s animated bars showing through them,
	   with contrast left entirely to the theme's `--text`.

	   The two cases need opposite gradients, because they use different text
	   colors. A no-image card uses the theme's own `--text`, so its gradient
	   mixes the node color toward `--bg-elevated`, the surface `--text` is
	   guaranteed to contrast against: that deepens the band in dark mode and
	   lightens it in light mode, which is the correct direction in both. A
	   `has-image` card pins its text to a fixed light color, so there a plain
	   dark gradient is right, kept shallow because the scrim already darkens
	   this exact band and a second full-strength one would visibly double. */
	.content {
		position: relative;
		z-index: 3;
		display: flex;
		flex-direction: column;
		margin-top: auto;
		padding: 0.85rem;
		background: linear-gradient(
			to top,
			color-mix(in oklch, var(--node-color) 32%, var(--bg-elevated)) 0%,
			color-mix(in oklch, var(--node-color) 44%, var(--bg-elevated)) 55%,
			transparent 100%
		);
	}

	.node.has-image .content {
		background: linear-gradient(
			to top,
			rgb(0 0 0 / 0.42) 0%,
			rgb(0 0 0 / 0.24) 45%,
			transparent 100%
		);
	}

	/* Body text sits on the plain color-wash background outside image mode
     (theme's own --text tokens already have the contrast they need there)
     and on the scrim's dark base inside it, so it is pinned to a fixed
     light color there regardless of theme. */
	.creator-name,
	.why {
		color: var(--text);
	}

	.node.has-image .creator-name,
	.node.has-image .why {
		color: #f2ede2;
	}

	/* The card is square and its own content (badge row, creator name, why,
     Visit button) has to fit inside that fixed shape rather than pushing it
     taller, so the creator name and why opt out of the page's own type scale
     (--text-lg headings, --text-base body) entirely, in favor of smaller
     fixed sizes, tight line-heights, and hard line clamps here. Sized to
     still fit a worst case (a creator name that actually wraps to its full 2
     lines) at the smallest card width the field view's grid produces, not
     just at the largest. Without that, a long name alone could push the why
     text and Visit button below the visible, clipped card edge, which is
     exactly the bug this was tuned against.

     A node represents a creator, not a single work (see the Creator Nodes
     addendum), so this heading shows `entry.creator` rather than a
     work-level title — there is no more title field for it to show. */
	.creator-name {
		margin: 0 0 0.35rem;
		font-size: 1.3rem;
		line-height: 1.15;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.why {
		margin: 0;
		font-size: 1.05rem;
		line-height: 1.3;
		opacity: 0.9;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.6rem;
	}

	.visit-button {
		display: inline-flex;
		flex-shrink: 0;
		padding: 0.35rem 0.9rem;
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
		color: var(--node-color);
		font-size: 1.05rem;
		font-weight: 700;
		text-decoration: none;
	}

	.visit-button:hover {
		background: var(--node-color);
		color: var(--bg-elevated);
	}

	.play-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2.1rem;
		height: 2.1rem;
		border: none;
		border-radius: 999px;
		background: var(--bg-elevated);
		color: var(--node-color);
		cursor: pointer;
	}

	.play-button:hover,
	.play-button.playing {
		background: var(--node-color);
		color: var(--bg-elevated);
	}

	/* Circular and icon-only, matching the play button beside it. As a text
	   pill reading "+ Queue" it was the widest control in the row and the
	   first thing to crowd a small card, for a label the play button next to
	   it never needed either.

	   A solid chip, not the outline it used to be. As a transparent button it
	   borrowed --bg-elevated for both border and icon, which is #171d2c in
	   dark mode: on a card with cover art that is a near-black ring sitting
	   on a dark scrim, which is what read as "greyed out". An outline can
	   only ever be as legible as whatever happens to be behind it, and behind
	   it here is an arbitrary photograph, so there was no pair of colors that
	   worked everywhere. The solid chip brings its own ground, which is why
	   every other control on a node (.visit-button, .play-button,
	   .like-toggle) already uses exactly this treatment. Hierarchy against
	   Play comes from the icon, not from weight. */
	.queue-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2.1rem;
		height: 2.1rem;
		border: none;
		border-radius: 999px;
		background: var(--bg-elevated);
		color: var(--node-color);
		cursor: pointer;
	}

	.queue-button:hover {
		background: var(--node-color);
		color: var(--bg-elevated);
	}

	/* Same solid chip as every other control on a node, for the reason in the
	   queue button's own note: an outline is only ever as legible as the
	   artwork behind it, and here that artwork is a comic page. */
	.read-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2.1rem;
		height: 2.1rem;
		border: none;
		border-radius: 999px;
		background: var(--bg-elevated);
		color: var(--node-color);
		cursor: pointer;
	}

	.read-button:hover {
		background: var(--node-color);
		color: var(--bg-elevated);
	}

	/* Kept deliberately quieter than Visit/Play: reporting is always
	   reachable, but a moderation escape hatch should not become one of the
	   card's primary calls to action. The accessible label carries the full
	   meaning for an icon whose visible footprint stays small. */
	.report-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		align-self: center;
		width: 2.1rem;
		height: 2.1rem;
		margin-left: auto;
		border-radius: 999px;
		background: color-mix(in oklch, var(--bg-elevated) 85%, transparent);
		color: var(--text-muted);
		text-decoration: none;
	}

	.report-button:hover,
	.report-button:focus-visible {
		background: var(--bg-elevated);
		color: var(--text);
	}

	/* Under roughly 240px tall there is not room for the creator name, why,
	   and the Visit button: the button gets pushed past the card's clipped
	   edge, measured as a real 23px overflow. The why line is the right
	   thing to drop, being the only part that is commentary rather than
	   identity or action. */
	@container (max-height: 15rem) {
		.why {
			display: none;
		}
	}

	/* Shorter still, only the creator name and the way out survive. */
	@container (max-height: 10rem) {
		.creator-name {
			-webkit-line-clamp: 1;
			line-clamp: 1;
		}
	}

	.progress-track {
		position: absolute;
		z-index: 3;
		left: 0;
		right: 0;
		bottom: 0;
		height: 0.25rem;
		background: rgb(0 0 0 / 0.25);
	}

	/* A lit gradient that drifts along its own length, rather than the flat
	   --bg-elevated block this used to be. The countdown is the one piece of
	   ambient motion the resting field has, so it gets to look alive: the
	   node's own type color at full strength through white and back, sliding
	   continuously. `background-size: 200%` with an animated position is what
	   makes it travel; the fill's *width* still encodes the actual progress,
	   so the drift is decoration layered on real data, not a fake busy-bar. */
	.progress-fill {
		height: 100%;
		background: linear-gradient(
			90deg,
			color-mix(in oklch, var(--node-color) 70%, white) 0%,
			#ffffff 25%,
			color-mix(in oklch, var(--node-color) 85%, white) 50%,
			#ffffff 75%,
			color-mix(in oklch, var(--node-color) 70%, white) 100%
		);
		background-size: 200% 100%;
		animation: progress-drift 2.4s linear infinite;
		box-shadow: 0 0 6px color-mix(in oklch, var(--node-color) 60%, transparent);
		/* Matches the tick cadence in FieldSlot so the fill reads as a smooth
		   sweep rather than a visible staircase. */
		transition: width 120ms linear;
	}

	@media (prefers-reduced-motion: reduce) {
		.node.has-primary-action {
			scale: 1;
			transition: none;
		}
	}

	@keyframes progress-drift {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: 0 0;
		}
	}

	/* Paused is shown, not hidden: the countdown really has stopped because
	   the visitor is on this node, and a bar that kept creeping would be
	   lying about when the content is going to change under them. The drift
	   stops with it, for the same reason: motion here would imply the
	   countdown is still running. */
	.progress-track.paused .progress-fill {
		opacity: 0.45;
		animation-play-state: paused;
		transition: none;
	}

	@media (prefers-reduced-motion: reduce) {
		/* Content still rotates under reduced motion (a data change, not
		   motion), but the sweeping fill and the drifting gradient are exactly
		   the kind of continuous movement the preference is about, so the bar
		   holds still and keeps only its color. */
		.progress-fill {
			animation: none;
			transition: none;
		}
	}
</style>
