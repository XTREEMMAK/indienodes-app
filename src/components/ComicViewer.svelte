<script>
	/**
	 * Full-screen comic reader: the brief's surface (b) for comics, finally
	 * built.
	 *
	 * Adapted from KeyJayOnline_v2's `ContentViewerModal.svelte` (a sibling
	 * project), which `docs/open-questions.md` flagged as reusable "in shape"
	 * rather than as a drop-in. That reading held up. What ported is the
	 * interaction model, which is the genuinely hard and well-tuned part:
	 * click/wheel/double-tap zoom, drag-to-pan with momentum, two-finger
	 * pinch, long-press-to-pan, horizontal swipe paging, keyboard nav, a grid
	 * of all pages, and auto-hiding chrome on touch.
	 *
	 * What did not port, and why, since the original's five dependencies are
	 * exactly what made it "not a drop-in":
	 *
	 * - `@iconify/svelte` -> inline SVG in this project's house style. This
	 *   repo has no icon library and adding one for a single component would
	 *   be a dependency-posture change (see the Three.js note in decisions).
	 * - `sanitizeHtml` -> not needed. `caption` is a plain string in
	 *   `schema/ring.schema.json` and is rendered as text, never as HTML, so
	 *   there is nothing to sanitize and no sanitizer to get wrong.
	 * - `imageCache` / `SkeletonImage` -> a local `loaded` flag. The ring's
	 *   own `imagePreloader` already warms images elsewhere; a second caching
	 *   layer here would be two things owning the same job.
	 * - `modalHistory` -> replaced with SvelteKit shallow history. On mobile,
	 *   opening this full-screen surface adds one same-URL history entry so
	 *   Android/browser Back closes the viewer before leaving the field. The
	 *   viewer's own Close and Escape actions consume that entry as well.
	 * - The original's `imageFitStyle` computed a scale from each page's known
	 *   width and height. `pages[]` here carries only `image_url` and an
	 *   optional `caption`, so there are no intrinsic dimensions to read and
	 *   plain `object-fit: contain` does the same job without them.
	 *
	 * Escape-to-close and body scroll lock mirror `Modal.svelte` rather than
	 * being reinvented, so every overlay in this app behaves the same way.
	 *
	 * @type {{
	 *   open?: boolean,
	 *   pages?: { image_url: string, caption?: string, alt?: string, title?: string, year?: string, medium?: string, external_url?: string }[],
	 *   creator?: string,
	 *   entryId?: string,
	 *   initialPage?: number,
	 *   kind?: 'comic' | 'art',
	 *   onClose?: () => void
	 * }}
	 */
	let {
		open = false,
		pages = [],
		creator = '',
		entryId = '',
		initialPage = 0,
		kind = 'comic',
		onClose = () => {}
	} = $props();

	import { fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { pushState } from '$app/navigation';
	import { page as appPage } from '$app/state';
	import { reducedMotion } from '$lib/motion.svelte.js';
	import { favoritesStore } from '$lib/favoritesStore.svelte.js';
	import { hiddenStore } from '$lib/hiddenStore.svelte.js';
	import { hideEntry, likeEntry } from '$lib/entryCuration.js';
	import {
		INACTIVITY_TIMEOUT,
		LONG_PRESS_TIME,
		POST_DRAG_COOLDOWN,
		ZOOM_MIN,
		flickVelocity,
		isClickNotDrag,
		isDoubleTap,
		isTap,
		isTapNotPan,
		nextZoomOnToggle,
		nextZoomOnWheel,
		pinchZoom,
		shouldCoast,
		shouldSnapBack,
		swipeDirection,
		touchDistance
	} from '$lib/viewerGestures.js';

	/**
	 * Mirrors FieldNode's own like/hide handlers, including the mutual
	 * exclusion between them and recording the journal event on the way in
	 * only, so acting from the reader and acting from a card are the same
	 * action rather than two that drift apart. The brief (section 8) puts
	 * both controls on the static reader too, not just the field and Lists.
	 */
	function handleLike() {
		likeEntry(entryId);
	}

	function handleHide() {
		hideEntry(entryId);
	}

	const isTouchDevice = browser && 'ontouchstart' in window;

	let currentPage = $state(0);
	let zoomLevel = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let isPanning = $state(false);
	let loaded = $state(false);
	let showAllPages = $state(false);
	let overlaysVisible = $state(true);
	let isFullscreen = $state(false);
	let captionExpanded = $state(false);

	/** @type {HTMLElement | undefined} */
	let rootEl = $state(undefined);

	const VIEWER_HISTORY_KEY = 'indienodesViewer';
	let viewerHistorySequence = 0;
	let viewerHistoryToken = '';

	// Non-reactive gesture bookkeeping. None of it renders, and making it
	// reactive would only invite an effect to depend on it by accident.
	let touchState = /** @type {'idle'|'waiting'|'swiping'|'panning'|'pinching'} */ ('idle');
	let dragStartX = 0;
	let dragStartY = 0;
	let dragStartPanX = 0;
	let dragStartPanY = 0;
	let totalDragDistance = 0;
	let pressStartedOnStage = false;
	let touchStartX = 0;
	let touchStartY = 0;
	let touchStartTime = 0;
	let lastTouchX = 0;
	let lastTouchY = 0;
	let lastTouchEnd = 0;
	let lastTapTime = 0;
	let lastTapX = 0;
	let lastTapY = 0;
	let initialPinchDistance = 0;
	let initialPinchZoom = 1;
	let prevMoveX = 0;
	let prevMoveY = 0;
	let prevMoveTime = 0;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let longPressTimer = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let inactivityTimer = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let dragCooldownTimer = null;
	let momentumRaf = 0;

	const totalPages = $derived(pages.length);
	const page = $derived(pages[currentPage] ?? null);
	const hasNext = $derived(currentPage < totalPages - 1);
	const hasPrev = $derived(currentPage > 0);
	const zoomed = $derived(zoomLevel > 1);
	const zoomPercent = $derived(Math.round(zoomLevel * 100));
	const isArt = $derived(kind === 'art');
	const itemLabel = $derived(isArt ? 'artwork' : 'page');
	const pageCaption = $derived(
		page?.caption ??
			(isArt ? [page?.title, page?.medium, page?.year].filter(Boolean).join(' · ') : '')
	);
	const pageAlt = $derived(
		isArt
			? page?.alt || page?.title || `Artwork ${currentPage + 1}`
			: pageCaption
				? `Page ${currentPage + 1}: ${pageCaption}`
				: `Page ${currentPage + 1}`
	);

	// Reset to a known state whenever the viewer opens, so reopening never
	// resumes mid-zoom on whatever page was last read.
	$effect(() => {
		if (!open) return;
		currentPage = Math.min(Math.max(initialPage, 0), Math.max(totalPages - 1, 0));
		resetZoom();
		loaded = false;
		captionExpanded = false;
		showAllPages = false;
		overlaysVisible = true;
	});

	// The viewer is a full-screen navigation layer on phones. A shallow
	// same-URL entry makes the platform Back action peel off this layer before
	// it can leave the field (or an Ambient session beneath it).
	$effect(() => {
		if (!open) {
			viewerHistoryToken = '';
			return;
		}
		if (!browser || !window.matchMedia('(max-width: 64rem)').matches || viewerHistoryToken) return;

		viewerHistorySequence += 1;
		viewerHistoryToken = `${entryId || kind}:${Date.now()}:${viewerHistorySequence}`;
		pushState('', {
			...appPage.state,
			[VIEWER_HISTORY_KEY]: viewerHistoryToken
		});
	});

	/**
	 * Zoom and pan only.
	 *
	 * Deliberately does **not** touch `loaded`. An earlier version did, which
	 * conflated two unrelated things: "put the view back to 1x" and "a
	 * different image is about to arrive." Resetting zoom does not change
	 * `src`, so no `load` event ever follows, and clearing `loaded` left the
	 * spinner up forever over a perfectly good image. That was reachable three
	 * ways (the reset button, the `0` key, and Escape while zoomed) and is
	 * exactly the reported "zooming back out enters a loading state that never
	 * finishes". `loaded` belongs to the image, so only a page change clears
	 * it.
	 */
	function resetZoom() {
		cancelMomentum();
		zoomLevel = 1;
		panX = 0;
		panY = 0;
		isPanning = false;
	}

	/** @param {number} index */
	function goToPage(index) {
		if (index === currentPage || index < 0 || index >= totalPages) return;
		currentPage = index;
		resetZoom();
		// A different page really is loading, and its caption is a different
		// caption, so both reset here rather than on every zoom change.
		loaded = false;
		captionExpanded = false;
		showAllPages = false;
	}

	/**
	 * An image already in the browser cache can finish loading before Svelte
	 * attaches the `load` handler, so the event never arrives and the spinner
	 * would sit over an image that is already on screen. Checking `complete`
	 * on mount closes that race. `naturalWidth` guards the case where
	 * `complete` is true because the load *failed*.
	 * @param {HTMLImageElement} node
	 */
	function trackLoaded(node) {
		if (node.complete && node.naturalWidth > 0) loaded = true;
	}

	function nextPage() {
		if (hasNext) goToPage(currentPage + 1);
	}
	function prevPage() {
		if (hasPrev) goToPage(currentPage - 1);
	}

	function toggleZoom() {
		const next = nextZoomOnToggle(zoomLevel);
		zoomLevel = next;
		if (next === ZOOM_MIN) {
			panX = 0;
			panY = 0;
		}
	}

	/** @param {WheelEvent} event */
	function handleWheel(event) {
		event.preventDefault();
		const next = nextZoomOnWheel(zoomLevel, event.deltaY);
		if (next === null) return;
		zoomLevel = next;
		if (zoomLevel === ZOOM_MIN) {
			panX = 0;
			panY = 0;
		}
	}

	// ------------------------------------------------------ mouse panning ---

	/** @param {MouseEvent} event */
	function handleMouseDown(event) {
		// A touch device also fires synthetic mouse events after a tap. The
		// original guarded this with a 500ms window since the last touchend,
		// which is what stops a tap from being handled twice.
		if (Date.now() - lastTouchEnd < 500) return;
		// Bound to `.stage`, so reaching here means the press began on the
		// page itself. `mouseup` has to live on the window (a pan that ends
		// off the stage, or outside the window entirely, still has to finish),
		// and without this flag that window handler treats *every* release
		// anywhere as a click on the page: pressing the caption, a nav arrow,
		// or a toolbar button would silently zoom the page underneath it.
		// Caught exactly that way, by a caption click leaving the page at 120%.
		pressStartedOnStage = true;
		if (zoomLevel <= 1) return;
		isPanning = true;
		dragStartX = event.clientX;
		dragStartY = event.clientY;
		dragStartPanX = panX;
		dragStartPanY = panY;
		totalDragDistance = 0;
		overlaysVisible = false;
		clearInactivity();
		event.preventDefault();
	}

	/** @param {MouseEvent} event */
	function handleMouseMove(event) {
		if (!isPanning) return;
		const dx = event.clientX - dragStartX;
		const dy = event.clientY - dragStartY;
		totalDragDistance = Math.hypot(dx, dy);
		panX = dragStartPanX + dx;
		panY = dragStartPanY + dy;
	}

	function handleMouseUp() {
		if (Date.now() - lastTouchEnd < 500) return;
		const onStage = pressStartedOnStage;
		pressStartedOnStage = false;
		// A release that did not begin on the page belongs to whatever control
		// was pressed, not to the page.
		if (!onStage) return;
		if (!isPanning) {
			toggleZoom();
			return;
		}
		isPanning = false;
		// Under a few pixels this was a click that happened to wobble, not a
		// drag, so it should still zoom.
		if (isClickNotDrag(totalDragDistance)) {
			toggleZoom();
		} else {
			if (dragCooldownTimer) clearTimeout(dragCooldownTimer);
			dragCooldownTimer = setTimeout(() => (dragCooldownTimer = null), POST_DRAG_COOLDOWN);
		}
	}

	// ----------------------------------------------------------- momentum ---

	function cancelMomentum() {
		if (momentumRaf) {
			cancelAnimationFrame(momentumRaf);
			momentumRaf = 0;
		}
	}

	/**
	 * Keeps a flicked page coasting after the finger leaves, which is what
	 * makes panning a large page feel physical rather than sticky.
	 * @param {number} vx
	 * @param {number} vy
	 */
	function startMomentum(vx, vy) {
		if (reducedMotion.current) {
			isPanning = false;
			return;
		}
		const friction = 0.9;
		function animate() {
			vx *= friction;
			vy *= friction;
			panX += vx * 16;
			panY += vy * 16;
			if (shouldCoast(vx, vy)) {
				momentumRaf = requestAnimationFrame(animate);
			} else {
				momentumRaf = 0;
				isPanning = false;
			}
		}
		momentumRaf = requestAnimationFrame(animate);
	}

	// -------------------------------------------------------------- touch ---

	function handleDoubleTap() {
		if (zoomLevel > 1) {
			cancelMomentum();
			zoomLevel = 1;
			panX = 0;
			panY = 0;
			if (isTouchDevice) resetInactivity();
		} else {
			zoomLevel = 2;
			if (isTouchDevice) {
				overlaysVisible = false;
				clearInactivity();
			}
		}
	}

	/** @param {TouchEvent} event */
	function handleTouchStart(event) {
		cancelMomentum();
		const touches = event.touches;

		if (touches.length === 2) {
			touchState = 'pinching';
			if (longPressTimer) clearTimeout(longPressTimer);
			initialPinchDistance = touchDistance(touches);
			initialPinchZoom = zoomLevel;
			overlaysVisible = false;
			clearInactivity();
			event.preventDefault();
			return;
		}

		const touch = touches[0];
		lastTouchX = touch.clientX;
		lastTouchY = touch.clientY;
		touchStartX = touch.clientX;
		touchStartY = touch.clientY;
		touchStartTime = Date.now();
		prevMoveX = touch.clientX;
		prevMoveY = touch.clientY;
		prevMoveTime = Date.now();

		if (zoomLevel > 1) {
			touchState = 'panning';
			isPanning = true;
			dragStartX = touch.clientX;
			dragStartY = touch.clientY;
			dragStartPanX = panX;
			dragStartPanY = panY;
			totalDragDistance = 0;
			return;
		}

		// At 1x a single finger is ambiguous: it could be the start of a swipe
		// to the next page or of a press-and-drag to inspect detail. Waiting
		// briefly is what tells them apart, rather than guessing from the
		// first few pixels of movement.
		touchState = 'waiting';
		longPressTimer = setTimeout(() => {
			if (touchState !== 'waiting') return;
			touchState = 'panning';
			isPanning = true;
			zoomLevel = 2;
			dragStartX = lastTouchX;
			dragStartY = lastTouchY;
			dragStartPanX = panX;
			dragStartPanY = panY;
			totalDragDistance = 0;
		}, LONG_PRESS_TIME);
	}

	/** @param {TouchEvent} event */
	function handleTouchMove(event) {
		const touches = event.touches;

		if (touchState === 'pinching' && touches.length === 2) {
			event.preventDefault();
			zoomLevel = pinchZoom(initialPinchZoom, initialPinchDistance, touchDistance(touches));
			if (zoomLevel <= 1) {
				panX = 0;
				panY = 0;
			}
			return;
		}

		if (touches.length !== 1) return;
		const touch = touches[0];

		if (touchState === 'waiting') {
			const dx = touch.clientX - touchStartX;
			const dy = touch.clientY - touchStartY;
			if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
				if (longPressTimer) clearTimeout(longPressTimer);
				touchState = 'swiping';
			}
		}

		if (touchState === 'panning') {
			event.preventDefault();
			const moveDx = touch.clientX - dragStartX;
			const moveDy = touch.clientY - dragStartY;
			totalDragDistance = Math.hypot(moveDx, moveDy);
			panX = dragStartPanX + moveDx;
			panY = dragStartPanY + moveDy;
			prevMoveX = lastTouchX;
			prevMoveY = lastTouchY;
			prevMoveTime = Date.now();
		}

		lastTouchX = touch.clientX;
		lastTouchY = touch.clientY;
	}

	/** @param {TouchEvent} event */
	function handleTouchEnd(event) {
		if (longPressTimer) clearTimeout(longPressTimer);
		const endTime = Date.now();
		lastTouchEnd = endTime;
		const duration = endTime - touchStartTime;

		if (touchState === 'pinching') {
			// Snap back to exactly 1x rather than leaving it at 1.04, which
			// would keep pan enabled and the chrome hidden for no visible zoom.
			if (shouldSnapBack(zoomLevel)) {
				zoomLevel = 1;
				panX = 0;
				panY = 0;
				if (isTouchDevice) resetInactivity();
			}
			touchState = 'idle';
			return;
		}

		if (touchState === 'panning') {
			// Quick and nearly stationary means a tap, which exits zoom. Both
			// conditions are needed: a short deliberate drag is not a tap.
			if (isTapNotPan(totalDragDistance, duration)) {
				isPanning = false;
				cancelMomentum();
				zoomLevel = 1;
				panX = 0;
				panY = 0;
				if (isTouchDevice) resetInactivity();
			} else {
				const { vx, vy } = flickVelocity(
					{ x: lastTouchX, y: lastTouchY, time: Date.now() },
					{ x: prevMoveX, y: prevMoveY, time: prevMoveTime }
				);
				if (shouldCoast(vx, vy)) startMomentum(vx, vy);
				else isPanning = false;
			}
			touchState = 'idle';
			return;
		}

		if (touchState === 'swiping' || touchState === 'waiting') {
			const end = event.changedTouches[0];
			const endX = end ? end.clientX : lastTouchX;
			const endY = end ? end.clientY : lastTouchY;
			const diffX = touchStartX - endX;
			const diffY = touchStartY - endY;

			if (isTap(diffX, diffY, duration)) {
				const doubleTapped = isDoubleTap(
					{ now: endTime, x: endX, y: endY },
					{ time: lastTapTime, x: lastTapX, y: lastTapY }
				);
				if (doubleTapped) {
					handleDoubleTap();
					lastTapTime = 0;
				} else {
					lastTapTime = endTime;
					lastTapX = endX;
					lastTapY = endY;
					if (isTouchDevice) {
						if (overlaysVisible) {
							overlaysVisible = false;
							clearInactivity();
						} else {
							resetInactivity();
						}
					}
				}
				touchState = 'idle';
				return;
			}

			const swipe = swipeDirection(diffX, diffY, duration);
			if (swipe) {
				if (swipe === 'next') nextPage();
				else prevPage();
				if (isTouchDevice) resetInactivity();
			}
		}

		touchState = 'idle';
	}

	// ----------------------------------------------------- chrome autohide ---

	function clearInactivity() {
		if (inactivityTimer) clearTimeout(inactivityTimer);
		inactivityTimer = null;
	}

	function resetInactivity() {
		clearInactivity();
		overlaysVisible = true;
		if (!isTouchDevice) return;
		inactivityTimer = setTimeout(() => (overlaysVisible = false), INACTIVITY_TIMEOUT);
	}

	function handlePointerActivity() {
		if (isPanning || dragCooldownTimer) return;
		overlaysVisible = true;
	}

	// -------------------------------------------------------- fullscreen ---

	async function toggleFullscreen() {
		if (!rootEl) return;
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await rootEl.requestFullscreen();
		} catch {
			// Refused (iOS Safari will not fullscreen a non-video element).
			// The viewer already covers the viewport, so this costs the
			// browser chrome staying visible and nothing else.
		}
	}

	$effect(() => {
		if (!open) return;
		const sync = () => (isFullscreen = !!document.fullscreenElement);
		document.addEventListener('fullscreenchange', sync);
		return () => document.removeEventListener('fullscreenchange', sync);
	});

	/** @param {KeyboardEvent} event */
	function handleKeydown(event) {
		if (!open) return;
		if (event.key === 'Escape') {
			if (showAllPages) {
				showAllPages = false;
			} else if (zoomed) {
				resetZoom();
			} else {
				close();
			}
			return;
		}
		if (event.key === 'ArrowRight') nextPage();
		else if (event.key === 'ArrowLeft') prevPage();
		else if (event.key === 'Home') goToPage(0);
		else if (event.key === 'End') goToPage(totalPages - 1);
		else if (event.key === '+' || event.key === '=') toggleZoom();
		else if (event.key === '0') resetZoom();
		else if (event.key.toLowerCase() === 'g') showAllPages = !showAllPages;
		else if (event.key.toLowerCase() === 'f') toggleFullscreen();
	}

	// Body scroll lock, matching Modal.svelte's own approach rather than
	// inventing a second one.
	$effect(() => {
		if (!open) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});

	$effect(() => {
		return () => {
			cancelMomentum();
			clearInactivity();
			if (longPressTimer) clearTimeout(longPressTimer);
			if (dragCooldownTimer) clearTimeout(dragCooldownTimer);
		};
	});

	function finishClose() {
		if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
		cancelMomentum();
		clearInactivity();
		onClose();
	}

	function handlePopstate() {
		if (!open || !viewerHistoryToken) return;
		viewerHistoryToken = '';
		finishClose();
	}

	function close() {
		if (browser && viewerHistoryToken) {
			// Closing in the UI must consume the same shallow entry Back would;
			// otherwise the next Back press would land on an invisible viewer step.
			history.back();
			return;
		}
		finishClose();
	}
</script>

<svelte:window
	onpopstate={handlePopstate}
	onkeydown={handleKeydown}
	onmousemove={handleMouseMove}
	onmouseup={handleMouseUp}
	ontouchend={handleTouchEnd}
/>

{#if open}
	<div
		class="viewer"
		class:chrome-hidden={!overlaysVisible}
		bind:this={rootEl}
		role="dialog"
		aria-modal="true"
		aria-label={creator
			? `${creator}, ${isArt ? 'art gallery' : 'comic reader'}`
			: isArt
				? 'Art gallery'
				: 'Comic reader'}
		transition:fade={{ duration: reducedMotion.current ? 0 : 160 }}
	>
		<header class="bar top">
			<div class="titles">
				<p class="creator-name">{creator}</p>
			</div>
			<div class="tools">
				<span class="counter" aria-live="polite">{currentPage + 1} / {totalPages}</span>
				<button
					type="button"
					class="tool"
					class:on={hiddenStore.isHidden(entryId)}
					onclick={handleHide}
					aria-pressed={hiddenStore.isHidden(entryId)}
					aria-label={hiddenStore.isHidden(entryId)
						? `Show ${creator} in the field again`
						: `${creator} is not for me`}
					title={hiddenStore.isHidden(entryId) ? 'Show in field again' : 'Not for me'}
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
						<path d="M9.7 9.7a3 3 0 0 0 4.24 4.24" stroke-linecap="round" stroke-linejoin="round" />
						<path d="M2.5 2.5l19 19" stroke-linecap="round" />
					</svg>
				</button>
				<button
					type="button"
					class="tool like-tool"
					class:on={favoritesStore.isLiked(entryId)}
					onclick={handleLike}
					aria-pressed={favoritesStore.isLiked(entryId)}
					aria-label={favoritesStore.isLiked(entryId)
						? `Remove ${creator} from favorites`
						: `Add ${creator} to favorites`}
					title={favoritesStore.isLiked(entryId) ? 'Remove from favorites' : 'Add to favorites'}
				>
					<svg
						viewBox="0 0 24 24"
						width="18"
						height="18"
						fill={favoritesStore.isLiked(entryId) ? 'currentColor' : 'none'}
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
				<button
					type="button"
					class="tool"
					class:on={showAllPages}
					onclick={() => (showAllPages = !showAllPages)}
					aria-pressed={showAllPages}
					aria-label={isArt ? 'All artworks' : 'All pages'}
					title={`${isArt ? 'All artworks' : 'All pages'} (G)`}
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
						<rect x="3" y="3" width="7" height="7" rx="1.5" />
						<rect x="14" y="3" width="7" height="7" rx="1.5" />
						<rect x="3" y="14" width="7" height="7" rx="1.5" />
						<rect x="14" y="14" width="7" height="7" rx="1.5" />
					</svg>
				</button>
				<button
					type="button"
					class="tool"
					onclick={toggleFullscreen}
					aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
					title="Full screen (F)"
				>
					{#if isFullscreen}
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
								d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"
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
								d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					{/if}
				</button>
				<button
					type="button"
					class="tool"
					onclick={close}
					aria-label={isArt ? 'Close gallery' : 'Close reader'}
					title="Close (Esc)"
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
						<path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
					</svg>
				</button>
			</div>
		</header>

		{#if showAllPages}
			<div class="grid-view" transition:fade={{ duration: reducedMotion.current ? 0 : 120 }}>
				{#each pages as p, i (p.image_url + i)}
					<button
						type="button"
						class="thumb"
						class:current={i === currentPage}
						onclick={() => goToPage(i)}
						aria-label={`${isArt ? 'Artwork' : 'Page'} ${i + 1}`}
						aria-current={i === currentPage}
					>
						<img
							src={p.image_url}
							alt=""
							loading="lazy"
							decoding="async"
							referrerpolicy="no-referrer"
						/>
						<span class="thumb-num">{i + 1}</span>
					</button>
				{/each}
			</div>
		{:else}
			<!-- The stage is a direct-manipulation surface: it claims the wheel,
			     drag, pinch, and swipe. `role="application"` is what tells
			     assistive tech that, the same reasoning FieldGrid's own items
			     use while arranging. Paging and zoom also have real buttons and
			     key bindings, so nothing here is pointer-only. -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="stage"
				role="application"
				aria-label={`${isArt ? 'Artwork' : 'Comic page'}. Arrow keys to move between ${isArt ? 'works' : 'pages'}, plus to zoom, zero to reset.`}
				onwheel={handleWheel}
				onmousedown={handleMouseDown}
				ontouchstart={handleTouchStart}
				ontouchmove={handleTouchMove}
				onmousemove={handlePointerActivity}
			>
				{#if page}
					{#key currentPage}
						<img
							class="page"
							class:loaded
							class:panning={isPanning}
							src={page.image_url}
							alt={pageAlt}
							draggable="false"
							decoding="async"
							referrerpolicy="no-referrer"
							onload={() => (loaded = true)}
							use:trackLoaded
							style:transform={`translate(${panX}px, ${panY}px) scale(${zoomLevel})`}
							style:cursor={zoomed ? (isPanning ? 'grabbing' : 'grab') : 'zoom-in'}
						/>
					{/key}
					{#if !loaded}
						<div class="loading" aria-hidden="true"><span class="spinner"></span></div>
					{/if}
				{/if}
			</div>

			{#if hasPrev}
				<button
					type="button"
					class="page-nav prev"
					onclick={prevPage}
					aria-label={`Previous ${itemLabel}`}
				>
					<svg
						viewBox="0 0 24 24"
						width="26"
						height="26"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</button>
			{/if}
			{#if hasNext}
				<button
					type="button"
					class="page-nav next"
					onclick={nextPage}
					aria-label={`Next ${itemLabel}`}
				>
					<svg
						viewBox="0 0 24 24"
						width="26"
						height="26"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</button>
			{/if}

			<footer class="bar bottom">
				{#if pageCaption}
					<!-- Captions clamp to two lines and expand on click: a long
					     one would otherwise take a third of a phone screen away
					     from the page it is describing. -->
					<button
						type="button"
						class="caption"
						class:expanded={captionExpanded}
						onclick={() => (captionExpanded = !captionExpanded)}
						aria-expanded={captionExpanded}
					>
						{pageCaption}
					</button>
				{:else}
					<span></span>
				{/if}
				<div class="zoom-tools">
					<span class="zoom-level">{zoomPercent}%</span>
					<button
						type="button"
						class="tool"
						onclick={toggleZoom}
						aria-label="Zoom in"
						title="Zoom (+)"
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
							<circle cx="11" cy="11" r="7" />
							<path d="M20 20l-3.5-3.5M11 8v6M8 11h6" stroke-linecap="round" />
						</svg>
					</button>
					<button
						type="button"
						class="tool"
						onclick={resetZoom}
						disabled={!zoomed}
						aria-label="Reset zoom"
						title="Reset zoom (0)"
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
							<circle cx="11" cy="11" r="7" />
							<path d="M20 20l-3.5-3.5M8 11h6" stroke-linecap="round" />
						</svg>
					</button>
				</div>
			</footer>
		{/if}
	</div>
{/if}

<style>
	.viewer {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		/* Near-opaque and neutral rather than themed: a comic page is the only
		   thing that should have a color in here, and a tinted surround would
		   sit inside the artwork's own contrast. */
		background: rgb(8 8 10 / 0.97);
		color: #f4f4f5;
		overflow: hidden;
		overscroll-behavior: contain;
		touch-action: none;
	}

	.bar {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.9rem 1.1rem;
		background: linear-gradient(to bottom, rgb(0 0 0 / 0.75), transparent);
		transition: opacity 200ms ease;
	}

	.bar.top {
		top: 0;
	}

	.bar.bottom {
		bottom: 0;
		top: auto;
		align-items: flex-end;
		background: linear-gradient(to top, rgb(0 0 0 / 0.75), transparent);
	}

	/* Chrome fades out on touch devices while reading, and comes back on tap.
	   Kept as opacity plus pointer-events rather than display, so it can
	   animate and so a hidden bar cannot swallow a tap meant for the page. */
	.chrome-hidden .bar,
	.chrome-hidden .page-nav {
		opacity: 0;
		pointer-events: none;
	}

	.titles {
		min-width: 0;
	}

	.creator-name {
		font-family: var(--font-display);
		font-size: var(--text-base);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tools,
	.zoom-tools {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-shrink: 0;
	}

	.counter,
	.zoom-level {
		margin-right: 0.4rem;
		color: rgb(255 255 255 / 0.7);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}

	.tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.3rem;
		height: 2.3rem;
		border: none;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.08);
		color: inherit;
		cursor: pointer;
	}

	.tool:hover:not(:disabled) {
		background: rgb(255 255 255 / 0.18);
	}

	.tool.on {
		background: var(--accent);
		color: #fff;
	}

	/* Same liked red as FieldNode's and AudioPlayer's own heart, rather than
	   the generic accent every other "on" tool here uses. */
	.like-tool.on {
		background: #e0455f;
		color: #fff;
	}

	.tool:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.stage {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

	.page {
		max-width: 94vw;
		max-height: 94vh;
		/* contain, never cover: a comic page is composed art whose gutters and
		   borders are part of the work, so it is shown whole. */
		object-fit: contain;
		opacity: 0;
		transform-origin: center;
		transition:
			opacity 200ms ease,
			transform 180ms ease;
		user-select: none;
		-webkit-user-drag: none;
	}

	.page.loaded {
		opacity: 1;
	}

	/* No transition while a finger or pointer is dragging: the transform is
	   already following the input, and easing it would lag a full frame
	   behind and read as sludge. */
	.page.panning {
		transition: opacity 200ms ease;
	}

	.loading {
		position: absolute;
		display: grid;
		place-items: center;
	}

	.spinner {
		width: 2rem;
		height: 2rem;
		border: 2px solid rgb(255 255 255 / 0.2);
		border-top-color: rgb(255 255 255 / 0.8);
		border-radius: 999px;
		animation: spin 800ms linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.page-nav {
		position: absolute;
		top: 50%;
		z-index: 2;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 3rem;
		height: 3rem;
		margin-top: -1.5rem;
		border: none;
		border-radius: 999px;
		background: rgb(0 0 0 / 0.45);
		color: #fff;
		cursor: pointer;
		transition: opacity 200ms ease;
	}

	.page-nav:hover {
		background: rgb(0 0 0 / 0.7);
	}

	.page-nav.prev {
		left: 1rem;
	}
	.page-nav.next {
		right: 1rem;
	}

	.caption {
		max-width: 42rem;
		padding: 0;
		border: none;
		background: none;
		color: rgb(255 255 255 / 0.82);
		font: inherit;
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}

	.caption.expanded {
		-webkit-line-clamp: unset;
		line-clamp: unset;
	}

	.grid-view {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
		align-content: start;
		gap: 0.8rem;
		padding: 5rem 1.1rem 1.5rem;
		overflow-y: auto;
	}

	.thumb {
		position: relative;
		padding: 0;
		border: 2px solid transparent;
		border-radius: var(--radius-sm);
		background: rgb(255 255 255 / 0.06);
		cursor: pointer;
		overflow: hidden;
		aspect-ratio: 3 / 4;
	}

	.thumb.current {
		border-color: var(--accent);
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thumb-num {
		position: absolute;
		bottom: 0.3rem;
		right: 0.4rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: rgb(0 0 0 / 0.65);
		color: #fff;
		font-size: var(--text-xs);
	}

	@media (max-width: 40rem) {
		.page-nav {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.page,
		.bar,
		.page-nav {
			transition: none;
		}
		.spinner {
			animation: none;
		}
	}
</style>
