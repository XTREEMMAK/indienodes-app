<script>
	/**
	 * Hosts the gridstack instance for the field view.
	 *
	 * The seam with gridstack, verified empirically before committing to it:
	 * **Svelte owns the DOM elements and their contents; gridstack owns their
	 * geometry.** Svelte renders the `.grid-stack-item` children with `gs-*`
	 * attributes and `GridStack.init()` adopts them in place. Dragging does
	 * not reorder DOM children (gridstack positions absolutely), so keyed
	 * `{#each}` reconciliation and gridstack never fight over the same thing.
	 *
	 * Two consequences worth knowing before editing this:
	 *
	 * 1. After init, writing `gs-x` from Svelte is inert. gridstack tracks
	 *    position in its own engine and applies inline styles, so programmatic
	 *    moves (the keyboard handlers below, and any store-side size change)
	 *    must go through `grid.update()`. The store is the reload-time truth;
	 *    the engine is the runtime truth.
	 * 2. Nodes added after init are invisible to gridstack until
	 *    `makeWidget()` is called on them, which the sync effect handles.
	 *
	 * @type {{
	 *   nodes: import('../lib/layoutStore.svelte.js').FieldNodeConfig[],
	 *   editMode?: boolean,
	 *   fitToView?: boolean,
	 *   onGeometryChange?: (changed: { id: string, x: number, y: number, w: number, h: number }[]) => void,
	 *   onReorder?: (order: string[]) => void,
	 *   children: import('svelte').Snippet<[import('../lib/layoutStore.svelte.js').FieldNodeConfig]>
	 * }}
	 */
	let {
		nodes,
		editMode = false,
		fitToView = false,
		onGeometryChange,
		onReorder,
		children
	} = $props();

	import { onMount, tick, untrack } from 'svelte';
	import { GRID_COLUMNS, MIN_W, snapToAllowedShape } from '$lib/nodeShape.js';
	import { columnsForWidth, computeCenteredLayout } from '$lib/fieldLayout.js';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { reducedMotion } from '$lib/motion.svelte.js';
	// Static CSS import so the stylesheet is in the build's CSS bundle and
	// present on first paint; only the JS is deferred. Without this the
	// prerendered grid would flash unstyled before hydration.
	import 'gridstack/dist/gridstack.css';

	let gridEl = $state(/** @type {HTMLElement | undefined} */ (undefined));
	let viewportEl = $state(/** @type {HTMLElement | undefined} */ (undefined));
	let ready = $state(false);
	let revealed = $state(false);
	let cellSize = $state({ w: 0, h: 0 });
	let columnCount = $state(0);
	let windowWidth = $state(0);
	// True while the stored layout is being re-applied to the engine, so the
	// change events that causes are not persisted back as if they were edits.
	let restoring = false;
	// True from the moment a pointer drag or resize begins until it ends.
	//
	// While a gesture is running the engine is the only authority on geometry,
	// and the two store-to-engine effects below stand down. They used to run
	// mid-drag, and the damage was not subtle: gridstack grows and shrinks the
	// grid container continuously while a node is in flight, that resize
	// re-measures the cell pitch, and the responsive effect reads the pitch —
	// so every few frames it recomputed a layout and called `grid.update()` on
	// the very node under the pointer. That both snapped the node back and left
	// gridstack refusing every subsequent move for the rest of the drag
	// (`moveNodeCheck` returns false once its own drag state has been written
	// out from under it), while the neighbours it had pushed aside kept the
	// positions they were pushed to. Dragging below the authored column count
	// therefore looked like it did nothing at all, except for disarranging
	// everything around the node that would not move.
	//
	// $state, not a plain flag: clearing it is what re-runs those effects, so
	// the layout settles once the gesture is actually over.
	let interacting = $state(false);

	// Which nodes are held for a group move. Shift-click toggles membership;
	// a plain click on a node replaces the whole set with just that one, the
	// same convention file managers and design tools use. Local component
	// state, not layoutStore: this is ephemeral arrange-mode UI, not part of
	// the persisted layout, the same reasoning `interacting`/`dragStart`
	// above already follow.
	let selectedIds = /** @type {Set<string>} */ (new SvelteSet());
	// The shift-drag sweep, in viewport coordinates while it is running.
	// Null whenever no sweep is in progress, which is also what the overlay
	// renders from.
	/** @type {{ fromX: number, fromY: number, toX: number, toY: number } | null} */
	let marquee = $state(null);
	// Below this, a sweep was really a click that wobbled. Same value and
	// same reasoning as `FieldNode`'s own tap slop, kept as its own constant
	// rather than imported because the two are about different gestures and
	// have no reason to move together.
	const SWEEP_SLOP_PX = 10;
	// A sweep ends with a click event on the grid background, and that
	// background click is what normally clears the selection — so the click
	// that ends a sweep would immediately undo the sweep's own result. Set
	// when a real sweep completes, read and cleared by that click.
	let sweepJustEnded = false;

	$effect(() => {
		// Selection is meaningless once arranging stops, and on the mobile
		// stack a drag already means reorder rather than a group move (see
		// the `change` handler's own column-count branch), so a selection
		// made at full width has nothing to apply to there either.
		if (!editMode || columnCount < GRID_COLUMNS) selectedIds.clear();
	});

	$effect(() => {
		if (!editMode) return;
		// Window-level rather than folded into handleKeydown's per-node
		// listener below: gridstack's own mousedown handler calls
		// preventDefault (needed to stop text selection while dragging),
		// which as a side effect suppresses the browser's default
		// focus-on-click — so a card just clicked to select it is never
		// actually the focused element, and a per-node keydown would never
		// see the Escape press that followed. Verified empirically: clicking
		// a card and checking document.activeElement afterward is <body>,
		// not the card.
		/** @param {KeyboardEvent} event */
		function onKeydown(event) {
			if (event.key === 'Escape' && selectedIds.size > 0) selectedIds.clear();
		}
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});
	/** @type {import('gridstack').GridStack | null} */
	let grid = null;

	// A plain array, not a reactive collection: this is bookkeeping for an
	// imperative library, nothing renders from it, and making it reactive
	// would only invite an effect to depend on it by accident.
	/** @type {string[]} Ids gridstack already knows about. */
	let known = [];
	// The field exactly as it stood when the current drag began, plus whose drag
	// it is. Together they let a drop be resolved from that clean starting point
	// rather than from whatever the pointer churned through on the way; see
	// `replayDrop`.
	/** @type {{ id: string, x: number, y: number, w: number, h: number }[] | null} */
	let dragStart = null;
	/** @type {string | null} */
	let draggedId = null;
	// Where the pointer was when the drag began and where it was let go. The
	// drop cell is derived from these rather than from the engine, because by
	// the end of a drag the engine's own idea of where the node is has been
	// bent by every collision along the way — see `replayDrop`.
	/** @type {{ x: number, y: number } | null} */
	let dragPointerStart = null;
	/** @type {{ x: number, y: number } | null} */
	let dragPointerEnd = null;
	// The rest of a multi-select, when the grabbed node is one member of it —
	// everyone `handleGridPointerMove` should visually drag along live. Plain
	// array, not $state: nothing renders from reading it, only from the CSS
	// this file writes directly onto each follower's element, matching how
	// `known` above is bookkeeping for an imperative library rather than
	// component state. `resizeFollowerIds` below is this same idea for a
	// corner-resize gesture rather than a move.
	/** @type {string[]} */
	let dragFollowerIds = [];
	// The resize equivalent of dragStart/draggedId above: the field as it
	// stood when the current resize began, plus which node is being resized.
	// Used by `replayGroupScale` to scale the rest of a multi-select together
	// when the grabbed node turns out to have been resized by a corner.
	/** @type {{ id: string, x: number, y: number, w: number, h: number }[] | null} */
	let resizeStart = null;
	/** @type {string | null} */
	let resizedId = null;
	// Which corner handle, if any, the press that started the current resize
	// actually landed on. gridstack's own `resizestart` callback is no help
	// here — its event argument reports `.grid-stack-item` as the target
	// regardless of which of the five handles was grabbed (verified
	// empirically), not the handle element itself. And the two dimensions
	// changing together is not a substitute either: a pure single-edge drag
	// on a node whose type only allows non-square ratios still comes out of
	// drop-time snapping with both w and h different (also verified
	// empirically, dragging just the east handle on a comic node) — snapping
	// is real and pre-existing, unrelated to which handle was pressed. So
	// this is set from a plain native pointerdown listener in the capture
	// phase, which sees the real target before gridstack's own handling of
	// the same event does.
	/** @type {'se' | 'sw' | null} */
	let grabbedCorner = null;
	// grabbedCorner frozen at the moment the current resize gesture started,
	// read by the `change` handler once the gesture ends. A stable snapshot
	// rather than reading the live flag there directly, matching how
	// dragPointerStart/dragPointerEnd above freeze pointer state per gesture
	// rather than trusting whatever the live value happens to be later.
	/** @type {'se' | 'sw' | null} */
	let resizeCorner = null;
	// Pointer coordinates at the start and end of the current resize, the
	// resize equivalent of dragPointerStart/dragPointerEnd. Needed for
	// exactly the reason replayDrop's own header comment gives for drag:
	// gridstack's own live resize can be disturbed by the *other* selected
	// members still sitting at their pre-scale size and position mid-gesture
	// (verified empirically — the same nominal drag produced a different
	// final size run to run, because the grabbed node's growing footprint
	// could brush a still-unmoved sibling and get its own live collision
	// handling involved before this file's code ever runs). The single
	// resized node's reported final geometry is exactly as unreliable here as
	// gridstack's mid-drag position was for a move — so `replayGroupScale`
	// computes the group's scale from raw pointer travel instead of trusting
	// it, the same fix for the same class of problem.
	/** @type {{ x: number, y: number } | null} */
	let resizePointerStart = null;
	/** @type {{ x: number, y: number } | null} */
	let resizePointerEnd = null;
	// dragFollowerIds' own counterpart for a corner resize: the rest of a
	// multi-select, when the node being resized is a member of it and the
	// handle grabbed was a corner (an edge resize never populates this — see
	// `resizeCorner`'s own comment on why edge and corner are told apart, and
	// `replayGroupScale`'s doc comment on why only a corner has an obvious
	// meaning for scaling a 2D group at all).
	/** @type {string[]} */
	let resizeFollowerIds = [];

	/**
	 * The live DOM element for a node id, or null once it's gone. Shared
	 * rather than a local const inside each of `replayDrop`, `replayGroupScale`
	 * and the live group-drag preview below, since all three need the exact
	 * same lookup and a `querySelector` restated three times is one more
	 * place for the selector itself to drift out of sync with the others.
	 * @param {string} id
	 * @returns {import('gridstack').GridItemHTMLElement | null}
	 */
	function elementFor(id) {
		return /** @type {import('gridstack').GridItemHTMLElement | null} */ (
			gridEl?.querySelector(`.grid-stack-item[gs-id="${CSS.escape(id)}"]`) ?? null
		);
	}

	/** Every node's current cell, read from the engine. */
	function snapshotGeometry() {
		if (!gridEl) return [];
		return [...gridEl.querySelectorAll('.grid-stack-item[gs-id]')].flatMap((el) => {
			const id = el.getAttribute('gs-id');
			const node = /** @type {import('gridstack').GridItemHTMLElement} */ (el).gridstackNode;
			if (typeof id !== 'string' || !node) return [];
			return [{ id, x: node.x ?? 0, y: node.y ?? 0, w: node.w ?? 1, h: node.h ?? 1 }];
		});
	}

	/**
	 * Re-resolves a completed drag from the arrangement it started in.
	 *
	 * gridstack pushes neighbours out of the way continuously as the pointer
	 * moves, and those pushes accumulate: it has no notion of undoing them if
	 * the pointer moves on. Its one mechanism for putting things back, the
	 * floating pack, only ever walks a displaced node *upward* toward where it
	 * started — so anything shoved upward during a drag can never be restored,
	 * and dragging a node up and back down left the whole column permanently
	 * shifted, having committed positions the visitor only ever passed through.
	 *
	 * So the path is discarded. Every other node goes back exactly where it was
	 * when the drag began, the dragged node goes where the pointer actually left
	 * it, and the engine resolves that single move. The result depends only on
	 * where the drop landed, which is the thing the visitor chose.
	 *
	 * The drop cell comes from the pointer rather than from the engine, and that
	 * distinction is the whole fix. Once a node has been shoved into the cell
	 * the dragged node came from, gridstack will not let the dragged node back
	 * in — it refuses any move covering less than half of an occupant — so a
	 * node dragged away and returned reported a final position one or two cells
	 * short of where it began, and everything else was resolved against that
	 * wrong answer. The pointer has no such memory: it is simply where the
	 * visitor let go.
	 *
	 * When the grabbed node is part of a multi-select group (`selectedIds`,
	 * size > 1), every member moves by the same pointer-derived delta rather
	 * than just the one under the cursor — a group drag, not several
	 * independent ones. The delta is clamped once, against whichever member
	 * would go out of bounds first, and that same clamped delta is applied to
	 * the whole group, so the group moves as one rigid shape and a wall never
	 * lets one member advance past the others. Everything *not* in the moving
	 * set still goes back to its `base` position first, same as the
	 * single-node case, and gridstack's own collision push resolves any
	 * overlap between a moving member and a stationary neighbour exactly the
	 * way it already does for a single dragged node.
	 *
	 * @param {{ id: string, x: number, y: number, w: number, h: number }[]} base
	 * @param {string} movedId
	 * @returns {{ id: string, x: number, y: number, w: number, h: number }[] | null}
	 */
	function replayDrop(base, movedId) {
		if (!grid || !gridEl) return null;
		const movedEl = elementFor(movedId);
		const start = base.find((node) => node.id === movedId);
		if (!movedEl || !start) return null;

		const movingIds =
			selectedIds.has(movedId) && selectedIds.size > 1 ? selectedIds : new SvelteSet([movedId]);
		const moving = base.filter((node) => movingIds.has(node.id));

		let dx = 0;
		let dy = 0;
		if (dragPointerStart && dragPointerEnd && cellSize.w > 0 && cellSize.h > 0) {
			dx = Math.round((dragPointerEnd.x - dragPointerStart.x) / cellSize.w);
			dy = Math.round((dragPointerEnd.y - dragPointerStart.y) / cellSize.h);
		}
		// Clamp once against the whole group, taking the most restrictive
		// bound any member imposes, rather than clamping each member on its
		// own — independent clamping would let a member nearer an edge stop
		// early while the rest kept going, breaking the shape a multi-select
		// drag is supposed to preserve.
		for (const node of moving) {
			dx = Math.max(-node.x, Math.min(dx, columnCount - node.w - node.x));
			dy = Math.max(-node.y, dy);
		}

		restoring = true;
		grid.batchUpdate();
		for (const node of base) {
			const el = elementFor(node.id);
			if (!el) continue;
			if (movingIds.has(node.id)) {
				grid.update(el, { x: node.x + dx, y: node.y + dy, w: node.w, h: node.h });
			} else {
				grid.update(el, { x: node.x, y: node.y, w: node.w, h: node.h });
			}
		}
		grid.batchUpdate(false);
		restoring = false;

		return snapshotGeometry();
	}

	/**
	 * The anchor-relative scale math shared by `replayGroupScale` (applied at
	 * drop time) and `handleGridPointerMove`'s live preview (applied as a CSS
	 * transform, every pointer move) — factored out once rather than restated
	 * in both places, because this exact formula has already needed real
	 * empirical debugging more than once (see `replayGroupScale`'s own
	 * history) and a second, independent copy is a second place for it to go
	 * wrong without the other noticing.
	 *
	 * `dxCells`/`dyCells` are the caller's job to derive — drop time reads
	 * them from `resizePointerStart`/`resizePointerEnd`, the live preview
	 * from `resizePointerStart` and whatever the current pointer position is
	 * — everything below this line is pure geometry with no notion of when
	 * the gesture actually is.
	 *
	 * `se`/`sw` are the only corner handles this app configures
	 * (`draggable`/`resizable` options above), so height only ever grows
	 * downward and the top edge is always the anchor; `corner` is what says
	 * which side anchors width.
	 *
	 * @param {{ id: string, x: number, y: number, w: number, h: number }[]} base
	 * @param {string} resizedId
	 * @param {'se' | 'sw'} corner
	 * @param {number} dxCells
	 * @param {number} dyCells
	 * @returns {{
	 *   scaleW: number,
	 *   scaleH: number,
	 *   targets: Map<string, { rawX: number, rawY: number, rawW: number, rawH: number }>
	 * } | null}
	 */
	function computeGroupScale(base, resizedId, corner, dxCells, dyCells) {
		const start = base.find((node) => node.id === resizedId);
		if (!start || start.w <= 0 || start.h <= 0) return null;

		// se grows width to the right (+dx widens); sw grows it to the left
		// (a more negative dx widens, since the handle itself moved left).
		// Both grow height downward regardless of which corner.
		const widthDeltaCells = corner === 'sw' ? -dxCells : dxCells;
		const newW = Math.max(MIN_W, start.w + widthDeltaCells);
		const newH = Math.max(1, start.h + dyCells);
		const scaleW = newW / start.w;
		const scaleH = newH / start.h;

		const moving = base.filter((node) => selectedIds.has(node.id));
		if (moving.length < 2) return null;

		const groupLeft = Math.min(...moving.map((n) => n.x));
		const groupRight = Math.max(...moving.map((n) => n.x + n.w));
		const groupTop = Math.min(...moving.map((n) => n.y));
		const anchorsRight = corner === 'sw';

		const targets = new SvelteMap();
		for (const node of moving) {
			const rawW = node.w * scaleW;
			const rawH = node.h * scaleH;
			const rawX = anchorsRight
				? groupRight - (groupRight - (node.x + node.w)) * scaleW - rawW
				: groupLeft + (node.x - groupLeft) * scaleW;
			const rawY = groupTop + (node.y - groupTop) * scaleH;
			targets.set(node.id, { rawX, rawY, rawW, rawH });
		}
		return { scaleW, scaleH, targets };
	}

	/**
	 * Scales every other selected node's box when the grabbed one turns out to
	 * have been resized by a corner handle — see `resizeCorner`'s own comment
	 * for how that is actually known (not from comparing `w`/`h`, which the
	 * drop-time ratio snap can change either one of on its own, corner or
	 * not) and the `change` handler for what decides whether this runs at all
	 * rather than the ordinary single-node resize path. An edge handle
	 * (`e`/`s`/`w`, one dimension only) has no obvious meaning for a 2D group
	 * and is deliberately excluded there.
	 *
	 * The scale factor comes from raw pointer travel
	 * (`resizePointerStart`/`resizePointerEnd`), not from gridstack's own
	 * reported final size for the grabbed node — verified empirically to
	 * matter, not assumed: the grabbed node's growing footprint can brush a
	 * still-unmoved sibling mid-gesture (every other selected member is still
	 * sitting at its pre-scale size and position until this function runs
	 * after the gesture ends), pulling that node's own live collision
	 * handling into a resize this file never asked for, and the same nominal
	 * drag produced a different final size run to run because of it. This is
	 * the exact class of problem `replayDrop`'s own header comment describes
	 * for a plain move, and the fix is the same one: trust the pointer, not
	 * the path the engine actually took to get there.
	 *
	 * Each member's resulting size is still snapped to its own type's allowed
	 * ratio afterward, same as any other resize in this app — a deliberate
	 * choice over keeping the scale exact, so a mixed-type group (a
	 * square-locked audio node next to a wide comic one, say) never ends up
	 * with a member outside the shapes its type is normally allowed.
	 *
	 * @param {{ id: string, x: number, y: number, w: number, h: number }[]} base
	 * @param {string} resizedId
	 * @param {'se' | 'sw'} corner
	 * @returns {{ id: string, x: number, y: number, w: number, h: number }[] | null}
	 */
	function replayGroupScale(base, resizedId, corner) {
		if (!grid || !gridEl) return null;
		if (!resizePointerStart || !resizePointerEnd || cellSize.w <= 0 || cellSize.h <= 0) return null;

		const dxCells = Math.round((resizePointerEnd.x - resizePointerStart.x) / cellSize.w);
		const dyCells = Math.round((resizePointerEnd.y - resizePointerStart.y) / cellSize.h);
		const result = computeGroupScale(base, resizedId, corner, dxCells, dyCells);
		if (!result) return null;
		const { targets } = result;
		const moving = base.filter((node) => selectedIds.has(node.id));

		const groupLeft = Math.min(...moving.map((n) => n.x));
		const groupRight = Math.max(...moving.map((n) => n.x + n.w));
		const groupTop = Math.min(...moving.map((n) => n.y));
		const anchorsRight = corner === 'sw';

		// Closest to the anchor first. gridstack evaluates collision live as
		// each grid.update() call within the batch lands, not deferred to the
		// end of it (verified empirically) -- so placing a far member before
		// a near one can have the near one's own placement read as colliding
		// with where the far one already sits, even though the two boxes
		// never actually overlap once every update in the batch has landed.
		// The annotation goes above rather than inline in the parameter list:
		// an inline `/** @type */` comment on an arrow parameter makes
		// Svelte's own printer emit the parameter parenthesised — `((n)) =>`
		// — which is not valid JavaScript, and breaks SSR evaluation of every
		// route that imports this file.
		/** @param {{ x: number, y: number, w: number, h: number }} n */
		const anchorDistance = (n) =>
			Math.hypot(anchorsRight ? groupRight - (n.x + n.w) : n.x - groupLeft, n.y - groupTop);
		const orderedMoving = [...moving].sort((a, b) => anchorDistance(a) - anchorDistance(b));

		restoring = true;
		grid.batchUpdate();
		for (const node of base) {
			if (selectedIds.has(node.id)) continue;
			const el = elementFor(node.id);
			if (el) grid.update(el, { x: node.x, y: node.y, w: node.w, h: node.h });
		}
		for (const node of orderedMoving) {
			const el = elementFor(node.id);
			const target = targets.get(node.id);
			if (!el || !target) continue;

			const type = nodes.find((n) => n.id === node.id)?.type;
			const snapped = type
				? snapToAllowedShape(type, target.rawW, target.rawH)
				: { w: Math.max(1, Math.round(target.rawW)), h: Math.max(1, Math.round(target.rawH)) };

			grid.update(el, {
				x: Math.max(0, Math.round(target.rawX)),
				y: Math.max(0, Math.round(target.rawY)),
				w: snapped.w,
				h: snapped.h
			});
		}
		grid.batchUpdate(false);
		restoring = false;

		return snapshotGeometry();
	}

	/** Reads the real cell pitch so the edit-mode dot grid lines up with it. */
	function measureCells() {
		if (!grid) return;
		const w = grid.cellWidth();
		const h = grid.getCellHeight(true);
		// Assigned only when the numbers actually differ. This runs from a
		// ResizeObserver on the grid element, which gridstack resizes on its own
		// throughout a drag, and a fresh object literal is a fresh identity even
		// when the pitch has not moved a pixel — enough on its own to re-run
		// every effect reading it, several times a second, mid-gesture.
		if (cellSize.w !== w || cellSize.h !== h) cellSize = { w, h };
		columnCount = grid.getColumn();
	}

	/**
	 * The grid cell under a point on screen, so a node added from the
	 * right-click menu can land where the pointer was.
	 *
	 * Exported rather than done by the caller because the pitch is this
	 * component's own business: the page holding the menu knows the click
	 * position and nothing about columns or cell height, and teaching it
	 * would mean two places deriving the same geometry.
	 *
	 * `getBoundingClientRect` is viewport-relative and so is a pointer event,
	 * so scroll needs no separate handling — a click far down a long field
	 * resolves to the row actually under it.
	 * @param {number} clientX
	 * @param {number} clientY
	 * @param {number} [width] Intended node width in cells, so the result can
	 *   be clamped to keep the whole node on the canvas rather than letting it
	 *   hang off the right edge and be shoved back by the engine.
	 * @returns {{ x: number, y: number } | undefined} undefined before the
	 *   grid exists, which the caller reads as "no opinion, use the default".
	 */
	export function cellFromPoint(clientX, clientY, width = 1) {
		if (!gridEl || !cellSize.w || !cellSize.h) return undefined;
		const rect = gridEl.getBoundingClientRect();
		const column = Math.floor((clientX - rect.left) / cellSize.w);
		const row = Math.floor((clientY - rect.top) / cellSize.h);
		const lastColumn = Math.max(0, columnCount - width);
		return {
			x: Math.max(0, Math.min(column, lastColumn)),
			y: Math.max(0, row)
		};
	}

	// ------------------------------------------------------- fit to view ---
	//
	// The field's default is a fixed cell size: a node holds the size it was
	// given, and a wider screen buys more columns rather than bigger cards. Once
	// there are fewer columns than the arrangement was authored against, the
	// layout is re-derived to fit (see `computeCenteredLayout`), so a narrow
	// screen reflows rather than shrinking anything.
	//
	// Fit mode answers the other want: keep the composition filling the screen
	// rather than sitting in the left of a canvas wider than it. All it does is
	// cap the column count at the authored width, so no empty columns are added
	// to the right of the arrangement. It caps upward only — below the authored
	// count it collapses like the default, because a composition rendered at
	// 45px a card is not a composition preserved.
	//
	// It used to scale by *height* instead, shrinking the pitch until the whole
	// arrangement fitted one screen and pinning the grid to that width. The
	// result was a narrow centred column with dead margins either side of it —
	// no longer draggable canvas, on a screen with plenty of room.

	/**
	 * The gap gridstack leaves around each item, in pixels.
	 *
	 * Shared with this component's CSS through a custom property rather than
	 * written down twice, because the resize grips depend on it: gridstack
	 * positions them against the grid *item*, while the card they are meant
	 * to sit on is inset this far inside it. A grip inset that ignored the
	 * margin sits outside the card by exactly this much.
	 */
	const GRID_MARGIN_PX = 8;

	let viewportSize = $state({ w: 0, h: 0 });

	// The open canvas's own pitch. Only meaningful at the authored column count
	// — the mobile stack is four full-width columns and simply fills whatever
	// it is given — and only *applied* once it has stopped tracking the
	// viewport, since up to that point gridstack's `cellHeight: 'auto'` derives
	// exactly this number on its own and pinning a width would be a no-op that
	// only risks disagreeing with it by a fraction of a pixel.
	// The column count this container calls for. Derived from the measured
	// container rather than the engine's current count, which is what it feeds:
	// reading the engine here would be circular.
	//
	// Fit mode caps the count at the authored width; it does not pin it there.
	// Capping is the whole of what the toggle buys — the composition fills the
	// screen instead of sitting in the left of a wider canvas — and it only
	// applies upward. Downward, fit collapses exactly like the default: pinning
	// 24 columns onto a phone left cards 45px across, in six columns, which is
	// neither the arrangement preserved nor anything legible.
	const wantedColumns = $derived(
		fitToView
			? Math.min(GRID_COLUMNS, columnsForWidth(viewportSize.w))
			: columnsForWidth(viewportSize.w)
	);

	// The dot grid is a viewport-filling layer, so it needs to be told where the
	// grid actually is to keep its lattice on real cell boundaries. Written
	// straight to the element rather than held in state: it updates on scroll,
	// and a reactive value here would re-run every effect reading it.
	let arrangeCanvasEl = $state(/** @type {HTMLElement | undefined} */ (undefined));

	$effect(() => {
		const active = editMode || exiting;
		const canvas = arrangeCanvasEl;
		const el = gridEl;
		if (!active || !canvas || !el) return;

		let frame = 0;
		const sync = () => {
			frame = 0;
			const rect = el.getBoundingClientRect();
			canvas.style.setProperty('--dot-x', `${rect.left}px`);
			canvas.style.setProperty('--dot-y', `${rect.top}px`);
		};
		// Coalesced to a frame: scrolling fires far faster than anything can be
		// painted, and this only ever moves a background by a few pixels.
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(sync);
		};
		sync();

		window.addEventListener('scroll', schedule, { passive: true });
		window.addEventListener('resize', schedule);
		const observer = new ResizeObserver(schedule);
		observer.observe(el);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', schedule);
			observer.disconnect();
		};
	});

	onMount(() => {
		let disposed = false;
		/** @type {ResizeObserver | undefined} */
		let observer;
		let revealFrame = 0;
		/** @param {PointerEvent} event */
		const handlePointerDownCapture = (event) => {
			const target = /** @type {HTMLElement} */ (event.target);
			grabbedCorner = target.closest('.ui-resizable-se')
				? 'se'
				: target.closest('.ui-resizable-sw')
					? 'sw'
					: null;
		};

		/**
		 * Reads gridstack's own settled state, sorted into reading order.
		 *
		 * Used below the authored column count, where a completed drag is
		 * read as a reorder rather than a placement (see the `change`
		 * handler). By the time `change` fires, gridstack's own collision
		 * handling has already resolved the drop into a definite (y, x)
		 * arrangement, so sorting by that is the visitor's intended new
		 * sequence, not a guess at it.
		 * @returns {string[] | null}
		 */
		function deriveOrderFromDom() {
			if (!gridEl) return null;
			const items = [...gridEl.querySelectorAll('.grid-stack-item')]
				.map((el) => {
					const id = el.getAttribute('gs-id');
					const node = /** @type {import('gridstack').GridItemHTMLElement} */ (el).gridstackNode;
					return typeof id === 'string' ? { id, x: node?.x ?? 0, y: node?.y ?? 0 } : null;
				})
				.filter((item) => item !== null);
			items.sort((a, b) => a.y - b.y || a.x - b.x);
			return items.map((item) => item.id);
		}

		(async () => {
			const { GridStack } = await import('gridstack');
			if (disposed || !gridEl) return;

			const instance = GridStack.init(
				{
					column: GRID_COLUMNS,
					// Square cells, so a node that is 16 wide and 9 tall really is
					// 16:9. The per-type shape rules are meaningless otherwise.
					cellHeight: 'auto',
					cellHeightThrottle: 100,
					margin: GRID_MARGIN_PX,
					// Reduced layouts begin in their compact, reorder-oriented mode.
					// The authored 24-column canvas enables floating reactively below.
					float: false,
					disableDrag: true,
					disableResize: true,
					// Handles on every edge except the top, which is where the
					// node's own configuration bar sits while editing. Default is
					// 'se' alone, which was both hard to find and directly under
					// that bar, so resizing appeared not to work at all.
					resizable: { handles: 'e, se, s, sw, w' },
					alwaysShowResizeHandle: true,
					// The whole card is the drag surface. `cancel` keeps a press
					// on an actual control from starting a drag instead; the
					// default list omits anchors, so Visit is added explicitly.
					draggable: { cancel: 'button, a, select, input, textarea, option' },
					placeholderClass: 'field-drop-target',
					columnOpts: {
						// Without columnMax the grid silently runs at 12 columns no
						// matter what `column` says, because it defaults to 12 and
						// caps it. That capped every 16-wide node to 12, which made
						// 16:9 literally unreachable and made resizing look broken
						// rather than constrained. v13 positions items from a
						// --gs-column-width custom property, so an arbitrary column
						// count needs no extra stylesheet.
						columnMax: GRID_COLUMNS
						// No breakpoints, deliberately. gridstack picks a column count
						// from `window.innerWidth`, but the number that actually matters
						// is how wide the *container* is — the window includes page
						// gutters and, under zoom, bears little relation to it. The count
						// is derived from the measured container instead, in an effect
						// below; leaving `breakpoints` empty is what makes gridstack's own
						// `checkDynamicColumn` bail out rather than fight it.
						//
						// It used to step 24 -> 21 -> 18 -> ... -> 4 on hardcoded widths so
						// a node kept its authored *cell* width. That protected card size,
						// but it also dropped columns while the arrangement still fitted
						// perfectly well, and below the authored count a node wider than
						// the grid is clamped — so coordinates stopped being trustworthy
						// and the whole layout had to be re-derived from reading order.
						// Now the count only drops once holding it would shrink cards past
						// reading; see `columnsForWidth`.
					}
				},
				gridEl
			);
			if (!instance) return;

			known = nodes.map((node) => node.id);

			// Shape is snapped here, on the way to the store, rather than in a
			// `resizestop` handler that adjusts the engine directly.
			//
			// That was the original approach and it fought itself: `change`
			// still reported the raw dragged size, the store recorded that
			// unsnapped value, and the store-to-engine sync effect below then
			// pushed it straight back onto the engine, undoing the snap. The
			// visible symptom was resizing that appeared to do nothing at all.
			// Snapping before the store sees it makes the store authoritative,
			// and the sync effect then corrects the engine rather than fighting.

			// One handler per pointer event, deliberately: gridstack keeps
			// exactly one callback each (`_gsEventHandler[name] = callback`, a
			// plain assignment, unlike `change` which goes through
			// addEventListener), so registering a second `resizestop` listener
			// would silently replace the one below rather than run beside it.
			// That is why the gesture flag is folded into the resize handlers
			// instead of being tracked by a pair of its own.
			instance.on('dragstart', (event, element) => {
				if (grid !== instance) return;
				interacting = true;
				const id = element?.gridstackNode?.id;
				draggedId = typeof id === 'string' ? id : null;
				dragStart = snapshotGeometry();
				// gridstack types its callback argument as a bare Event; the drag
				// events it forwards carry pointer coordinates.
				const grabbed = /** @type {MouseEvent} */ (event);
				dragPointerStart = { x: grabbed?.clientX ?? 0, y: grabbed?.clientY ?? 0 };
				dragPointerEnd = null;
				// Everyone else in the selection, if the grabbed node is part of
				// one — what handleGridPointerMove visually drags along live. See
				// that function's own comment for why this has to be a CSS
				// overlay rather than moving these through the engine mid-drag.
				dragFollowerIds =
					draggedId && selectedIds.has(draggedId) && selectedIds.size > 1
						? [...selectedIds].filter((id) => id !== draggedId)
						: [];
			});

			instance.on('dragstop', (event) => {
				if (grid !== instance) return;
				interacting = false;
				const released = /** @type {MouseEvent} */ (event);
				dragPointerEnd = { x: released?.clientX ?? 0, y: released?.clientY ?? 0 };
				// Cleared synchronously, not in the microtask below with the rest
				// of this gesture's bookkeeping: this is the live preview's own
				// CSS, and it has to be gone the instant the gesture ends,
				// whether or not a `change` follows to give every follower its
				// real, settled position moments later.
				for (const id of dragFollowerIds) {
					const el = elementFor(id);
					if (!el) continue;
					el.style.transform = '';
					el.classList.remove('group-gesture-follower');
				}
				dragFollowerIds = [];
				// gridstack emits its final `change` synchronously after this, so
				// the drag's own bookkeeping has to outlive the handler by exactly
				// that long. A drop that changed nothing produces no `change` to
				// consume it, hence the microtask rather than clearing on the next
				// drag.
				queueMicrotask(() => {
					draggedId = null;
					dragStart = null;
					dragPointerStart = null;
					dragPointerEnd = null;
				});
			});

			instance.on('resizestart', (event, element) => {
				if (grid !== instance) return;
				interacting = true;
				const id = element?.gridstackNode?.id;
				resizedId = typeof id === 'string' ? id : null;
				resizeStart = snapshotGeometry();
				resizeCorner = grabbedCorner;
				const grabbed = /** @type {MouseEvent} */ (event);
				resizePointerStart = { x: grabbed?.clientX ?? 0, y: grabbed?.clientY ?? 0 };
				resizePointerEnd = null;
				// Same condition replayGroupScale itself gates on at drop time —
				// see handleGridPointerMove for what this drives while the
				// gesture is still live.
				resizeFollowerIds =
					resizeCorner && resizedId && selectedIds.has(resizedId) && selectedIds.size > 1
						? [...selectedIds].filter((id) => id !== resizedId)
						: [];
				// A follower's vertical position is ordinary document flow, not an
				// explicit `top` (only `left` is set inline, from --gs-column-width)
				// -- confirmed empirically: growing the grabbed node's own real
				// height live, mid-gesture, reflows every later sibling's rendered
				// top even though its own row index never changed, which showed up
				// as a follower's preview visibly drifting off its anchor by
				// however many pixels the grabbed node had grown by so far. Pinning
				// an explicit `top` here freezes that flow position for the
				// gesture's duration, so the translate/scale below is the only
				// thing still moving it; resizestop puts `top` back to nothing.
				for (const id of resizeFollowerIds) {
					const el = elementFor(id);
					if (el) el.style.top = `${el.offsetTop}px`;
				}
			});

			instance.on('resizestop', (event) => {
				if (grid !== instance) return;
				// Cleared before the `change` gridstack emits next, so the store
				// update that lands there is what the settling effects see.
				interacting = false;
				const released = /** @type {MouseEvent} */ (event);
				resizePointerEnd = { x: released?.clientX ?? 0, y: released?.clientY ?? 0 };
				// Synchronous, not deferred to the microtask below, for the same
				// reason dragstop's own cleanup of dragFollowerIds is: this is
				// live-preview CSS, and it has to be gone the instant the gesture
				// ends regardless of what replayGroupScale does moments later.
				for (const id of resizeFollowerIds) {
					const el = elementFor(id);
					if (!el) continue;
					el.style.transform = '';
					el.style.transformOrigin = '';
					el.style.top = '';
					el.classList.remove('group-gesture-follower');
				}
				resizeFollowerIds = [];
				// Same deferral dragstop's own comment explains: change fires
				// synchronously right after this, and needs resizeStart/resizedId
				// still in place when it does.
				queueMicrotask(() => {
					resizedId = null;
					resizeStart = null;
					resizePointerStart = null;
					resizePointerEnd = null;
				});
			});

			instance.on('change', (_event, items) => {
				// gridstack can emit into a listener after the instance it
				// belongs to has been destroyed (crossing a breakpoint tears
				// one down while its own change is still unwinding), and any
				// call back into it then throws. `grid` is nulled first on
				// teardown, so this identity check is what marks it stale.
				if (grid !== instance) return;
				if (restoring) return;
				if (!items?.length) return;

				if (instance.getColumn() < GRID_COLUMNS) {
					// The mobile stack, and only ever the mobile stack: above that
					// breakpoint the canvas holds all 24 authored columns and takes
					// the branch below. Here a node authored 16 cells wide does not
					// fit in 4 columns at all, so x/y describes nothing worth saving
					// and a drag means "put it here in the reading order" instead.
					// The stacking effect regenerates clean coordinates from that
					// order on the next tick. This is also what makes touch dragging
					// work as reordering on a phone.
					const order = deriveOrderFromDom();
					// Only when the sequence actually differs. A drag that ends where
					// it started still reports a change (gridstack shuffled the
					// neighbours on the way and packed them back), and writing that to
					// the store persisted a layout nobody edited and re-ran the
					// responsive effect for nothing.
					if (order && order.some((id, index) => nodes[index]?.id !== id)) onReorder?.(order);
					return;
				}

				// A completed drag is resolved from the arrangement it started in
				// rather than from whatever the pointer pushed through on the way;
				// see `replayDrop`. Only a drag has a snapshot, so a resize falls
				// through to the incremental path below.
				if (dragStart && draggedId) {
					const base = dragStart;
					const movedId = draggedId;
					// Consumed rather than left for a second `change`, which
					// `replayDrop`'s own updates would otherwise trigger.
					dragStart = null;
					const settled = replayDrop(base, movedId);
					if (settled) {
						// A drop that put everything back exactly where it began is
						// not an edit and is not worth writing.
						const sameAsBefore = settled.every((node) => {
							const was = base.find((candidate) => candidate.id === node.id);
							return was && was.x === node.x && was.y === node.y && was.w === node.w;
						});
						if (!sameAsBefore) onGeometryChange?.(settled);
						return;
					}
				}

				// A corner-handle resize of a node that is part of a multi-select
				// scales the whole group together; see `replayGroupScale`. An edge
				// resize, or a corner resize outside a multi-select, falls through
				// to the ordinary per-item path below exactly as before this
				// existed. Which handle was actually grabbed comes from
				// `resizeCorner`, frozen at `resizestart` — not from comparing w/h
				// here, which that field's own comment explains is not a safe
				// substitute.
				if (resizeStart && resizedId) {
					const base = resizeStart;
					const id = resizedId;
					const corner = resizeCorner;
					resizeStart = null;
					if (corner && selectedIds.has(id) && selectedIds.size > 1) {
						const settled = replayGroupScale(base, id, corner);
						if (settled) {
							onGeometryChange?.(settled);
							return;
						}
					}
				}

				// Only the authored column count round-trips losslessly. At a
				// reduced count a node wider than the grid is clamped to fit
				// (a 16-wide node becomes 12 at 12 columns), and persisting
				// that silently rewrote the saved layout: resizing a window
				// down and back up permanently shrank every wide node. The
				// narrow view is a rendering of the layout, not an edit of it.
				const changed = items
					.filter((item) => typeof item.id === 'string')
					.map((item) => {
						const id = /** @type {string} */ (item.id);
						const node = nodes.find((n) => n.id === id);
						const rawW = item.w ?? 1;
						const rawH = item.h ?? 1;
						const snapped = node ? snapToAllowedShape(node.type, rawW, rawH) : { w: rawW, h: rawH };
						return { id, x: item.x ?? 0, y: item.y ?? 0, w: snapped.w, h: snapped.h };
					});
				if (changed.length) onGeometryChange?.(changed);
			});

			grid = instance;
			measureCells();

			observer?.disconnect();
			observer = new ResizeObserver(() => measureCells());
			observer.observe(gridEl);
			// Capture phase, so this sees the real press target before gridstack's
			// own same-element handling of the same event does — see
			// `grabbedCorner`'s own comment for why `resizestart` can't tell us
			// this itself. Reset on every press, not just set on a match, so a
			// stale true from a previous corner grab can never leak into an
			// unrelated later gesture (a body drag, an edge resize).
			gridEl?.addEventListener('pointerdown', handlePointerDownCapture, true);
			instance.on('change', () => {
				if (grid !== instance) return;
				// Not while we are the ones writing. `measureCells` sets state the
				// layout effects read, and those effects are what triggered this
				// change — so re-measuring here closed the loop: effect writes
				// positions, gridstack announces them, the measurement moves, the
				// effect runs again. It only terminated if the engine happened to
				// land exactly where the effect asked, and gravity does not always
				// allow that. Genuine size changes still arrive by ResizeObserver.
				if (restoring) return;
				measureCells();
			});

			ready = true;

			// `ready` deliberately starts the store-to-engine effects below; it
			// cannot also mean "safe to paint" because those effects may still
			// replace gridstack's first responsive/default placement with the
			// visitor's actual layout. Gridstack animates that correction, so a
			// fixed one- or two-frame delay can still reveal nodes while they are
			// travelling. Watch their painted rectangles instead and reveal only
			// after consecutive stable frames. The cap prevents an unrelated
			// animation or noisy fractional measurement from hiding the field.
			const revealStartedAt = performance.now();
			let previousGeometry = '';
			let stableFrames = 0;
			/** @param {number} now */
			function revealWhenSettled(now) {
				if (disposed || !gridEl) return;
				const geometry = [...gridEl.querySelectorAll('.grid-stack-item')]
					.map((item) => {
						const rect = item.getBoundingClientRect();
						return [rect.x, rect.y, rect.width, rect.height]
							.map((value) => value.toFixed(1))
							.join(',');
					})
					.join('|');

				if (geometry && geometry === previousGeometry) stableFrames += 1;
				else stableFrames = 0;
				previousGeometry = geometry;

				if (stableFrames >= 2 || now - revealStartedAt >= 700) {
					revealed = true;
					return;
				}
				revealFrame = requestAnimationFrame(revealWhenSettled);
			}
			revealFrame = requestAnimationFrame(revealWhenSettled);
		})();

		return () => {
			disposed = true;
			cancelAnimationFrame(revealFrame);
			observer?.disconnect();
			gridEl?.removeEventListener('pointerdown', handlePointerDownCapture, true);
			grid?.destroy(false);
			grid = null;
		};
	});

	// Adopt nodes Svelte rendered after init, and forget removed ones.
	$effect(() => {
		const ids = nodes.map((n) => n.id);
		if (!grid || !ready) return;

		tick().then(() => {
			if (!grid || !gridEl) return;
			for (const id of ids) {
				if (known.includes(id)) continue;
				const el = gridEl.querySelector(`.grid-stack-item[gs-id="${CSS.escape(id)}"]`);
				if (el) {
					grid.makeWidget(/** @type {HTMLElement} */ (el));
					known.push(id);
				}
			}

			// Dropping the id from `known` is not enough on its own: Svelte
			// removes the element, but gridstack keeps its own record of that
			// widget in the engine indefinitely, and nothing above ever told
			// it otherwise. That went unnoticed while removal was one-way --
			// until undo made re-adding a removed node possible, and gridstack
			// met an id it still believed it owned. It resolves that collision
			// by renaming the *new* widget (`n-art-1` came back as
			// `n-art-1_1`), which silently desynchronises the engine from the
			// store: every later geometry change for that node is then
			// reported under an id `applyGeometry` cannot find, so moving or
			// resizing it stops persisting at all.
			//
			// `removeDOM` is false because the element is Svelte's and is
			// already gone; this is only about the engine forgetting it.
			for (const id of known.filter((candidate) => !ids.includes(candidate))) {
				const stale = grid.engine.nodes.find((node) => node.id === id);
				if (stale) grid.engine.removeNode(stale, false, false);
			}
			known = known.filter((id) => ids.includes(id));
		});
	});

	// Push store-side geometry changes into gridstack's engine.
	//
	// Necessary because after init, gridstack stops reading the `gs-*`
	// attributes Svelte renders: it keeps position in its own engine and
	// applies inline styles from there. So a size change that originates in
	// the store rather than from a drag (changing a node's type re-snaps it
	// to that type's allowed shape) would update the attribute and change
	// nothing visible. Compared before writing, so the drag path (which
	// already agrees with the engine) is a no-op rather than a feedback loop.
	$effect(() => {
		const snapshot = nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));
		// Depends on the column count as well as the store. A trip down to a
		// reduced count leaves gridstack's engine holding a reflowed layout:
		// wide nodes clamped, and everything repacked into the narrower grid.
		// The store never changed, so without the column dependency this had
		// no reason to re-run and the field stayed visibly wrong for the rest
		// of the session even though a reload was correct.
		const columns = columnCount;
		// Read before the guard, and bail while a gesture is in flight: see
		// `interacting`'s own note. Reading it here is also what re-runs this
		// effect when the gesture ends, so a drop still settles.
		const busy = interacting;
		if (!grid || !ready || busy || columns < GRID_COLUMNS) return;

		untrack(() => {
			if (!grid || !gridEl) return;

			// Position as well as size. Restoring only w and h left every node
			// sitting wherever the narrow reflow had repacked it, which is the
			// more obvious half of the damage: a node authored at 8,0 came back
			// at 0,8.
			const pending = [];
			for (const wanted of snapshot) {
				const el = /** @type {import('gridstack').GridItemHTMLElement | null} */ (
					gridEl.querySelector(`.grid-stack-item[gs-id="${CSS.escape(wanted.id)}"]`) ?? null
				);
				const current = el?.gridstackNode;
				if (!el || !current) continue;
				// Column restoration can recover the engine geometry from its
				// cache without needing an update. Clear the narrow layout's
				// visual offset even for those already-correct nodes.
				el.style.transform = '';
				if (
					current.x !== wanted.x ||
					current.y !== wanted.y ||
					current.w !== wanted.w ||
					current.h !== wanted.h
				) {
					pending.push({ el, wanted });
				}
			}
			if (!pending.length) return;

			// Batched and flagged: applied one at a time each update would
			// reflow against the others and land somewhere else again, and
			// every one of those intermediate states would be persisted as if
			// the visitor had made it.
			restoring = true;
			grid.batchUpdate();
			for (const { el, wanted } of pending) {
				grid.update(el, { x: wanted.x, y: wanted.y, w: wanted.w, h: wanted.h });
			}
			grid.batchUpdate(false);
			restoring = false;
		});
	});

	// The complement of the effect above: at any column count other than the
	// authored one, gridstack's own reflow is discarded in favor of the
	// deterministic, centered layout from computeCenteredLayout(). See that
	// function for why its output is not trustworthy here.
	$effect(() => {
		const columns = columnCount;
		const nodeList = nodes;
		// cellWidth is read here, not inside untrack, so a plain window resize
		// that changes the pixel size of a cell without crossing a column-count
		// breakpoint still recomputes the sub-cell nudge below. Cell geometry
		// itself (gs-x/w) does not need to change for that; only the pixel
		// value of half a cell does.
		const cellWidth = cellSize.w;
		// The effect this guard matters most for: it reads the cell pitch, which
		// is exactly what gridstack churns while dragging. See `interacting`.
		const busy = interacting;
		if (!grid || !ready || busy || columns === 0 || columns >= GRID_COLUMNS) return;

		const wantedLayout = computeCenteredLayout(nodeList, columns);

		untrack(() => {
			if (!grid || !gridEl) return;

			const pending = [];
			for (const wanted of wantedLayout) {
				const el = /** @type {import('gridstack').GridItemHTMLElement | null} */ (
					gridEl.querySelector(`.grid-stack-item[gs-id="${CSS.escape(wanted.id)}"]`) ?? null
				);
				const current = el?.gridstackNode;
				if (!el || !current) continue;
				if (
					current.x !== wanted.x ||
					current.y !== wanted.y ||
					current.w !== wanted.w ||
					current.h !== wanted.h
				) {
					pending.push({ el, wanted });
				}
				// The half-cell visual correction, applied to every item in this
				// layout regardless of whether its grid coordinates just changed:
				// a resize that only changes cellWidth still needs its pixel
				// value updated even when x/y/w/h are already correct.
				el.style.transform = wanted.nudge ? `translateX(${wanted.nudge * cellWidth}px)` : '';
			}
			if (!pending.length) return;

			// Batched and flagged for the same reason as the effect above: an
			// unbatched pass would have each update reflow against the
			// others, and the `change` guard elsewhere already refuses to
			// persist a reduced-column state, but restoring still keeps the
			// intermediate positions out of onGeometryChange entirely.
			restoring = true;
			grid.batchUpdate();
			for (const { el, wanted } of pending) {
				grid.update(el, { x: wanted.x, y: wanted.y, w: wanted.w, h: wanted.h });
			}
			grid.batchUpdate(false);
			restoring = false;
		});
	});

	// The column count, derived from the room actually available.
	//
	// The authored count while the arrangement fits at a legible pitch, fewer as
	// the container narrows, four at the bottom — which is the single-column
	// stack. Dropping columns rather than pitch is the whole point: cards stop
	// shrinking and the layout gets taller instead, re-arranged by
	// `computeCenteredLayout` to fit whatever width is left.
	//
	// Skipped entirely while fitting, which pins the authored count on purpose
	// and owns the pitch itself.
	$effect(() => {
		const wanted = wantedColumns;
		const active = ready;
		const busy = interacting;
		if (!grid || !active || busy || !viewportSize.w) return;
		if (grid.getColumn() === wanted) return;

		restoring = true;
		// 'none' so a column change rescales nothing: widths are authored in cells
		// and the layout below re-derives every position from scratch anyway.
		grid.column(wanted, 'none');
		restoring = false;
		measureCells();
	});

	// Each mode gets the collision model that matches what its drop means.
	//
	// The open canvas floats: it stores literal x/y, so deliberate empty space is
	// meaningful and top gravity would pull a node straight back out of any gap
	// it was placed in.
	//
	// The mobile stack does not float, and that is load-bearing rather than
	// merely tidy. A drop there is a reorder, and top gravity is what makes a
	// downward drag *become* one: the dragged card displaces the one below it and
	// the column repacks around the swap. Floating here instead slid every card
	// below the pointer down by the same amount, leaving the reading order
	// exactly as it was — a drag that looked like it worked and reordered nothing.
	$effect(() => {
		const columns = columnCount;
		const active = ready;
		if (!grid || !active || columns === 0) return;

		// Everywhere except the narrowest layout. Top gravity is what turns a
		// downward drag on the stack into a reorder, but in the re-arranging tier
		// above it it fought `computeCenteredLayout`: that packer leaves a gap
		// under a short node sharing a row with a tall one, and gravity pulls the
		// next row up into it, so the engine never settles where the effect asked
		// and the effect kept re-asking.
		const shouldFloat = columns > MIN_W;
		if (grid.getFloat() === shouldFloat) return;

		restoring = true;
		grid.float(shouldFloat);
		restoring = false;
	});

	// Tells the rest of the page a gesture is in progress, so the ambient
	// background can hold its orbiting blobs still for the duration. They are
	// the most expensive thing on the page to rasterize, and a drag is when the
	// browser can least afford it — see AmbientBackground's own note. A class on
	// <body> rather than a store because nothing needs to *react* to this, only
	// to be styled by it, and the two components share no other state.
	$effect(() => {
		const busy = interacting;
		document.body.classList.toggle('field-dragging', busy);
		return () => document.body.classList.remove('field-dragging');
	});

	// Edit mode gates interaction. Move is offered at every width: on the open
	// canvas a drop is a placement, and on the mobile stack it is read as a
	// reorder (see the `change` handler), which is what makes touch dragging
	// work as reordering on a phone instead of needing a separate mechanism.
	//
	// Resize is off on the mobile stack alone, and the same window measurement
	// gates it that gridstack uses to choose the stack in the first place — so
	// resizing is available exactly when the canvas is at its authored column
	// count, and never at a count where a node's width has been clamped to fit.
	//
	// `editMode` and `columnCount` are read here, before the guard, on
	// purpose: an effect's dependencies for its *next* run come from what it
	// read on its *last* run, and `grid`/`ready` start false, so the guard
	// used to return before either was ever read. The very first run past
	// that guard then only depended on whichever of `grid`/`ready` had most
	// recently changed, not on `editMode` at all, so toggling arrange mode
	// afterward never re-ran this effect and drag silently stayed disabled.
	// Reading them unconditionally, matching every other effect below,
	// keeps them tracked regardless of which run first clears the guard.
	$effect(() => {
		const columns = columnCount;
		const wantMove = editMode;
		const wantResize = editMode && columns >= GRID_COLUMNS;
		if (!grid || !ready) return;
		grid.enableMove(wantMove);
		grid.enableResize(wantResize);
	});

	// One ripple through the dot grid's columns the moment arrange mode
	// switches on, and one burst the moment it switches back off — reading
	// the grid's dots as visibly acknowledging each transition rather than
	// static chrome silently appearing and disappearing. Both are one-shot,
	// driven off the two edges of `editMode` (the guard below fires on
	// either edge, unlike the entrance-only version this replaced).
	let waving = $state(false);
	let exiting = $state(false);
	let wasEditMode = false;
	// One `.dot-wave-col` per column, keyed on the index itself, covering the
	// whole viewport rather than just the grid.
	//
	// The dot canvas is the full screen now, but the wave was still generated
	// one column per *grid* column starting at the grid's own left edge — so it
	// rippled across the arrangement and left the page gutters bare until the
	// animation ended and the resting background popped in behind it. Indices
	// run negative through the gutter on the left so the lattice still lines up
	// with the grid it is standing in for.
	/** @type {number[]} */
	const waveColumns = $derived.by(() => {
		const cell = cellSize.w;
		if (!cell || !windowWidth) return [];
		const gutter = Math.max(0, (windowWidth - viewportSize.w) / 2);
		const before = Math.ceil(gutter / cell);
		const after = Math.ceil((windowWidth - gutter) / cell);
		return Array.from({ length: before + after }, (_, index) => index - before);
	});
	const waveFirst = $derived(waveColumns.length ? waveColumns[0] : 0);
	const waveLast = $derived(waveColumns.length ? waveColumns[waveColumns.length - 1] : 0);
	const waveCentre = $derived((waveFirst + waveLast) / 2);
	$effect(() => {
		if (editMode === wasEditMode) return;
		wasEditMode = editMode;
		if (reducedMotion.current) return;

		if (editMode) {
			waving = true;
			// Matches .dot-wave-col's own 700ms animation-duration below, plus
			// the last column's stagger delay (22ms/column, matching its own
			// animation-delay below); untrack so a mid-wave resize (columnCount
			// changing) cannot itself re-trigger this effect.
			const totalMs = 700 + untrack(() => waveColumns.length) * 22;
			const timer = setTimeout(() => {
				waving = false;
			}, totalMs);
			return () => clearTimeout(timer);
		}

		// The exit burst: .arrange-canvas is kept mounted (see the template's
		// `editMode || exiting`) for exactly this long after Done arranging is
		// pressed, so the dots have somewhere to still be while they animate
		// away instead of vanishing the instant the class comes off. Distance
		// from the middle column, not index, drives each column's own delay
		// here (see --exp-d in the template) — a burst radiates outward from
		// its center, it does not sweep from one edge like the entrance does.
		exiting = true;
		const totalCols = untrack(() => waveColumns.length);
		const maxDistFromCenter = Math.ceil(totalCols / 2);
		// Matches .dot-wave-col.exploding's own 550ms duration, plus the
		// farthest column's stagger delay (18ms per step of distance).
		const totalMs = 550 + maxDistFromCenter * 18;
		const timer = setTimeout(() => {
			exiting = false;
		}, totalMs);
		return () => clearTimeout(timer);
	});

	// Measures the room a fitted layout has to work with.
	//
	// Width comes from the wrapper, which is always full-bleed and so cannot
	// be affected by what we do to the grid inside it. Height comes from the
	// window, deliberately NOT from the wrapper: the wrapper's height is set
	// by its own content, so measuring it would feed the cell size back into
	// the thing that determines the cell size, and the field would either
	// oscillate or settle on an arbitrary size.
	$effect(() => {
		const el = viewportEl;
		if (!el) return;

		const measure = () => {
			windowWidth = window.innerWidth;
			viewportSize = { w: el.clientWidth, h: window.innerHeight };
			// Re-read the grid's own numbers here too. Its ResizeObserver cannot
			// be relied on alone: while the canvas is pinned wider than its
			// container the grid element stops changing size, so a window resize
			// that crosses the mobile breakpoint would otherwise leave
			// `columnCount` reporting the count we just left.
			measureCells();
		};
		measure();

		const observer = new ResizeObserver(measure);
		observer.observe(el);
		window.addEventListener('resize', measure);
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', measure);
		};
	});

	/**
	 * Shift-click toggles a node in/out of the group; a plain click replaces
	 * the whole selection with just that one, the standard multi-select
	 * convention. Only meaningful in the open canvas — the mobile stack's
	 * drag already means reorder, not a group move (see the `change`
	 * handler's own column-count branch).
	 *
	 * Gridstack's own drag detection already suppresses the native `click`
	 * a real drag would otherwise fire (verified empirically, not assumed —
	 * the header comment's own history is why that distinction gets checked
	 * here rather than trusted on the library's behalf), so this needs no
	 * pointer-travel tracking of its own the way `FieldNode`'s primary-tap
	 * handling does for the resting field.
	 * @param {MouseEvent} event
	 * @param {string} nodeId
	 */
	function handleNodeClick(event, nodeId) {
		if (!editMode || columnCount < GRID_COLUMNS) return;
		// The same selector gridstack's own `draggable.cancel` option uses to
		// keep a press on a real control from starting a drag — matched here
		// so a click on the type dropdown, a tag chip, or Visit toggles that
		// control rather than the card's selection.
		if (
			/** @type {HTMLElement} */ (event.target).closest(
				'button, a, select, input, textarea, option'
			)
		)
			return;

		if (event.shiftKey) {
			if (selectedIds.has(nodeId)) selectedIds.delete(nodeId);
			else selectedIds.add(nodeId);
		} else {
			selectedIds.clear();
			selectedIds.add(nodeId);
		}
	}

	/**
	 * Clears the selection on a click that lands on the grid's own background
	 * rather than bubbling up from a card — the `currentTarget`/`target`
	 * check is what tells the two apart, same pattern `NavDrawer`'s backdrop
	 * click uses.
	 * @param {MouseEvent} event
	 */
	function handleGridBackgroundClick(event) {
		// A sweep finishes with a click on this same background. Clearing here
		// would throw away the selection the sweep just made, so the sweep
		// claims that one click on its way out.
		if (sweepJustEnded) {
			sweepJustEnded = false;
			return;
		}
		if (event.target === event.currentTarget) selectedIds.clear();
	}

	/**
	 * Shift-drag across empty canvas to sweep up every node the rectangle
	 * touches.
	 *
	 * Only from the background, never from a card: with a card under the
	 * pointer that press is gridstack's to interpret as a drag, and taking it
	 * would mean a selected group could no longer be moved by grabbing one of
	 * its own members. Shift is what separates a sweep from the plain
	 * background click that clears the selection.
	 *
	 * Touching counts, rather than requiring a node to be fully enclosed —
	 * the same rule design tools use, and the forgiving one at these card
	 * sizes, where enclosing even two of them takes most of the viewport.
	 * Additive, for the same reason shift-click is: shift means "and also".
	 * @param {PointerEvent} event
	 */
	function handleGridPointerDown(event) {
		if (!editMode || columnCount < GRID_COLUMNS) return;
		if (!event.shiftKey || event.button !== 0) return;
		if (event.target !== event.currentTarget) return;
		// Otherwise the browser starts a text selection across the whole page
		// as the pointer moves.
		event.preventDefault();
		/** @type {HTMLElement} */ (event.currentTarget).setPointerCapture(event.pointerId);
		marquee = {
			fromX: event.clientX,
			fromY: event.clientY,
			toX: event.clientX,
			toY: event.clientY
		};
	}

	/**
	 * Drags or scales the rest of a multi-select along with the one node
	 * gridstack is actually moving or resizing, so the group visually
	 * travels or grows as one shape instead of only the grabbed card
	 * changing while everyone else it's selected alongside sits frozen
	 * until the gesture ends. Without this the shape of the selection was
	 * only ever *true* before the gesture started and after it ended —
	 * during the gesture itself there was nothing on screen to judge where
	 * the group would land, and worse, gridstack's own live collision
	 * handling for the one node it knows is changing could shove a
	 * still-stationary member of the same selection out of its way, which
	 * looked exactly like the selection breaking apart even though nothing
	 * about the final, committed arrangement (still resolved by
	 * `replayDrop`/`replayGroupScale`, unchanged by any of this) was ever
	 * actually wrong.
	 *
	 * A pure CSS overlay, not a real move or resize: this never calls
	 * `grid.update()` on a follower mid-gesture, which is exactly the thing
	 * `replayDrop`'s own header comment already warns is unrecoverable once
	 * gridstack's collision engine gets involved for more than the one node
	 * it is actually tracking. Every follower's transform is discarded the
	 * instant the gesture ends (`dragstop`/`resizestop`, synchronously) and
	 * its real, settled position is set moments later the same way it
	 * already was — from the pointer's start and end, never from wherever a
	 * mid-gesture transform happened to leave the element.
	 *
	 * The resize case reuses `computeGroupScale`, the same pure geometry
	 * `replayGroupScale` applies for real at drop time, so the live preview
	 * and the committed result can never independently drift apart the way
	 * restating this formula a second time would risk. `translate() scale()`
	 * (in that order, with `transform-origin: 0 0`) is what lets one
	 * transform both resize a follower from its own top-left corner and
	 * reposition it relative to the anchor in a single declaration: per the
	 * CSS transform-function composition order, `scale()` — the rightmost
	 * function — applies first, against the origin, and `translate()` then
	 * shifts that already-scaled box by a fixed pixel amount unaffected by
	 * the scale, which is exactly the "grows from the anchor, and everything
	 * else's distance from that anchor grows with it" shape the drop-time
	 * math already computes in grid cells.
	 *
	 * Reuses this handler rather than adding a second listener for either
	 * gesture: gridstack's own `drag` event fires far too coarsely for a
	 * smooth follow (confirmed empirically — two firings across a 40-step
	 * move that produced over forty native `pointermove` events on this same
	 * element), so the raw pointer position already being tracked here for
	 * the marquee sweep is the thing to drive both from instead.
	 * @param {PointerEvent} event
	 */
	function handleGridPointerMove(event) {
		if (marquee) {
			marquee = { ...marquee, toX: event.clientX, toY: event.clientY };
			return;
		}

		if (draggedId && dragFollowerIds.length && dragPointerStart) {
			const dx = event.clientX - dragPointerStart.x;
			const dy = event.clientY - dragPointerStart.y;
			for (const id of dragFollowerIds) {
				const el = elementFor(id);
				if (!el) continue;
				el.classList.add('group-gesture-follower');
				el.style.transform = `translate(${dx}px, ${dy}px)`;
			}
			return;
		}

		if (
			resizedId &&
			resizeFollowerIds.length &&
			resizeStart &&
			resizeCorner &&
			resizePointerStart &&
			cellSize.w > 0 &&
			cellSize.h > 0
		) {
			const dxCells = Math.round((event.clientX - resizePointerStart.x) / cellSize.w);
			const dyCells = Math.round((event.clientY - resizePointerStart.y) / cellSize.h);
			const result = computeGroupScale(resizeStart, resizedId, resizeCorner, dxCells, dyCells);
			if (!result) return;
			const { scaleW, scaleH, targets } = result;
			for (const id of resizeFollowerIds) {
				const node = resizeStart.find((n) => n.id === id);
				const el = elementFor(id);
				const target = targets.get(id);
				if (!node || !el || !target) continue;
				const dxpx = (target.rawX - node.x) * cellSize.w;
				const dypx = (target.rawY - node.y) * cellSize.h;
				el.classList.add('group-gesture-follower');
				el.style.transformOrigin = '0 0';
				el.style.transform = `translate(${dxpx}px, ${dypx}px) scale(${scaleW}, ${scaleH})`;
			}
		}
	}

	/** @param {PointerEvent} event */
	function handleGridPointerUp(event) {
		if (!marquee) return;
		const box = marqueeBox(marquee);
		marquee = null;
		/** @type {HTMLElement} */ (event.currentTarget).releasePointerCapture?.(event.pointerId);
		// A sweep that never really moved is a shift-click on empty space, and
		// selecting nothing is the honest result of that — but it must not
		// count as a sweep, or it would also eat the click that clears.
		if (box.width < SWEEP_SLOP_PX && box.height < SWEEP_SLOP_PX) return;
		sweepJustEnded = true;

		for (const el of gridEl?.querySelectorAll('.grid-stack-item[gs-id]') ?? []) {
			const id = el.getAttribute('gs-id');
			if (!id) continue;
			const rect = el.getBoundingClientRect();
			const touches =
				rect.left < box.right &&
				rect.right > box.left &&
				rect.top < box.bottom &&
				rect.bottom > box.top;
			if (touches) selectedIds.add(id);
		}
	}

	/** @param {{ fromX: number, fromY: number, toX: number, toY: number }} m */
	function marqueeBox(m) {
		const left = Math.min(m.fromX, m.toX);
		const top = Math.min(m.fromY, m.toY);
		return {
			left,
			top,
			right: Math.max(m.fromX, m.toX),
			bottom: Math.max(m.fromY, m.toY),
			width: Math.abs(m.toX - m.fromX),
			height: Math.abs(m.toY - m.fromY)
		};
	}

	/**
	 * Keyboard equivalents for drag and resize. gridstack provides none, and
	 * the field is fully keyboard navigable today, so pointer-only placement
	 * would be a real regression. Routed through `grid.update()` for the
	 * reason in the header comment.
	 * @param {KeyboardEvent} event
	 * @param {import('../lib/layoutStore.svelte.js').FieldNodeConfig} node
	 */
	function handleKeydown(event, node) {
		if (!editMode || !grid) return;
		// Arrow presses on the mobile reorder buttons bubble through this
		// application widget too. They belong to the focused button, not to the
		// card-wide keyboard placement control.
		if (event.target !== event.currentTarget) return;
		const deltas = {
			ArrowLeft: [-1, 0],
			ArrowRight: [1, 0],
			ArrowUp: [0, -1],
			ArrowDown: [0, 1]
		};
		const delta = deltas[/** @type {keyof typeof deltas} */ (event.key)];
		if (!delta) return;

		const el = /** @type {import('gridstack').GridItemHTMLElement} */ (event.currentTarget);
		event.preventDefault();

		if (event.shiftKey) {
			// Matches the pointer gate above: sizing is meaningless on the mobile
			// stack, where every node is one full-width column regardless.
			if (columnCount < GRID_COLUMNS) return;
			// Step by a whole cell then snap, so each press lands on the next
			// permitted size rather than nudging toward one that never arrives.
			const step = 2;
			const snapped = snapToAllowedShape(
				node.type,
				node.w + delta[0] * step,
				node.h + delta[1] * step
			);
			grid.update(el, snapped);
			return;
		}

		// Read the engine's current position rather than the store's, so this
		// still moves the node exactly one step from wherever it actually is:
		// below the authored column count that can differ from `node.x/y`,
		// which describe the authored-width arrangement, not the recomputed
		// one currently on screen.
		const current = el.gridstackNode;
		const baseX = current?.x ?? node.x;
		const baseY = current?.y ?? node.y;
		grid.update(el, {
			x: Math.max(0, baseX + delta[0]),
			y: Math.max(0, baseY + delta[1])
		});
	}

	/**
	 * Moves one node through the narrow layout's reading order. This uses the
	 * same order callback as a completed phone-width drag, so authored desktop
	 * geometry stays untouched and the responsive layout effect animates the
	 * cards into their new rows.
	 * @param {string} id
	 * @param {-1 | 1} direction
	 */
	function moveInOrder(id, direction) {
		const order = nodes.map((node) => node.id);
		const from = order.indexOf(id);
		const to = from + direction;
		if (from < 0 || to < 0 || to >= order.length) return;
		[order[from], order[to]] = [order[to], order[from]];
		onReorder?.(order);
	}
</script>

<div
	class="grid-viewport"
	bind:this={viewportEl}
	style:--cell-w={`${cellSize.w}px`}
	style:--cell-h={`${cellSize.h}px`}
>
	{#if editMode || exiting}
		<!-- Purely decorative, sized and positioned independently of
		     .grid-stack below (see .arrange-canvas's own comment): the actual
		     grid never resizes to draw this, so entering arrange mode cannot
		     itself pop the real container taller. First in DOM order, same as
		     the wave overlay nested inside it used to be, so plain paint order
		     already puts it behind every card without a z-index.

		     Stays mounted through `exiting` (editMode is already false by
		     then) so the exit burst below has a canvas to still be on while
		     it animates away, instead of the whole thing vanishing the
		     instant Done arranging is pressed. -->
		<div
			class="arrange-canvas"
			class:waving
			class:exiting
			bind:this={arrangeCanvasEl}
			aria-hidden="true"
		>
			{#if waving || exiting}
				<div class="dot-wave" aria-hidden="true">
					{#each waveColumns as i (i)}
						<!-- --i positions the column (always left-to-right, matching
						     the real grid underneath).
						     --d: entrance-only, a reversed index driving *when* a
						     column ripples in, so that sweeps right-to-left while
						     columns still sit where they actually belong.
						     --exp-d/--exp-x: exit-only. --exp-d is distance from the
						     middle column (unsigned), so the burst radiates outward
						     from the center rather than sweeping from an edge.
						     --exp-x is signed distance from center, driving *which
						     way* each column flies outward (left of center goes
						     further left, right goes further right). -->
						<span
							class="dot-wave-col"
							class:exploding={exiting}
							style:--i={i}
							style:--d={waveLast - i}
							style:--exp-d={Math.abs(i - waveCentre)}
							style:--exp-x={i - waveCentre}
						></span>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
	<div
		class="grid-stack"
		style="--grid-margin: {GRID_MARGIN_PX}px"
		class:gs-ready={ready}
		class:gs-visible={revealed}
		class:edit-mode={editMode}
		bind:this={gridEl}
		role="presentation"
		onclick={handleGridBackgroundClick}
		onpointerdown={handleGridPointerDown}
		onpointermove={handleGridPointerMove}
		onpointerup={handleGridPointerUp}
		onpointercancel={handleGridPointerUp}
	>
		{#each nodes as node, nodeIndex (node.id)}
			<!--
			The gs-* attributes are gridstack's own DOM contract, which it reads
			on init() and keeps updated thereafter; svelte-check does not know
			them, hence the spread. `role="application"` is deliberate rather
			than incidental: in edit mode this really is a direct-manipulation
			widget that claims the arrow keys, which is exactly what that role
			warns assistive tech about. Outside edit mode it carries no role or
			tab stop at all, so the resting field stays plain content.
		-->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="grid-stack-item"
				class:selected={selectedIds.has(node.id)}
				{...{
					'gs-id': node.id,
					'gs-x': node.x,
					'gs-y': node.y,
					'gs-w': node.w,
					'gs-h': node.h
				}}
				role={editMode ? 'application' : undefined}
				tabindex={editMode ? 0 : undefined}
				aria-label={editMode
					? columnCount >= GRID_COLUMNS
						? `${node.type} node, ${node.w} by ${node.h}. Arrow keys to move, shift and arrow keys to resize. Shift-click to select multiple nodes and move them together.`
						: `${node.type} node, ${node.w} by ${node.h}. Arrow keys to move.`
					: undefined}
				onkeydown={(event) => handleKeydown(event, node)}
				onclick={(event) => handleNodeClick(event, node.id)}
			>
				<div class="grid-stack-item-content">
					{@render children(node)}
				</div>
				{#if editMode && columnCount === 4 && nodes.length > 1}
					<div class="mobile-reorder" role="group" aria-label="Reorder node">
						<button
							type="button"
							disabled={nodeIndex === 0}
							aria-label={`Move ${node.type} node up`}
							title="Move node up"
							onclick={() => moveInOrder(node.id, -1)}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="m6 14 6-6 6 6" />
							</svg>
						</button>
						<button
							type="button"
							disabled={nodeIndex === nodes.length - 1}
							aria-label={`Move ${node.type} node down`}
							title="Move node down"
							onclick={() => moveInOrder(node.id, 1)}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="m6 10 6 6 6-6" />
							</svg>
						</button>
					</div>
				{/if}
			</div>
		{/each}
	</div>
	{#if marquee}
		{@const box = marqueeBox(marquee)}
		<!-- position: fixed and viewport coordinates, so the rectangle tracks
		     the pointer exactly even though the grid it sits over scrolls and
		     is itself positioned. Purely decorative: the selection it produces
		     is announced by the cards' own selected state, so this carries no
		     role of its own. -->
		<div
			class="sweep"
			aria-hidden="true"
			style:left={`${box.left}px`}
			style:top={`${box.top}px`}
			style:width={`${box.width}px`}
			style:height={`${box.height}px`}
		></div>
	{/if}
</div>

<style>
	.grid-viewport {
		position: relative;
		width: 100%;
	}

	/* The shift-drag sweep. Same blue the selected cards use, so the
	   rectangle and the thing it is about to select read as one gesture.
	   pointer-events: none because the sweep is driven by the grid
	   underneath it — an overlay that swallowed the pointer would end the
	   drag the moment it appeared. */
	.sweep {
		position: fixed;
		z-index: 3;
		pointer-events: none;
		border: 1px solid #3b82f6;
		border-radius: var(--radius-sm);
		background: color-mix(in oklch, #3b82f6 14%, transparent);
	}

	.grid-stack {
		position: relative;
		z-index: 1;
		width: 100%;
		min-height: 20rem;
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transition: opacity 180ms ease-out;
	}

	/* Visibility is separate from `gs-ready`: ready enables the geometry
	   restoration effects, while visible is delayed until those effects have
	   settled. That distinction prevents the generic pre-init layout from
	   painting for a frame before saved/responsive positions take over. */
	.grid-stack.gs-visible {
		opacity: 1;
		visibility: visible;
		pointer-events: auto;
	}

	@media (prefers-reduced-motion: reduce) {
		.grid-stack {
			transition: none;
		}
	}

	/* Covers only the moment before gridstack has initialized (prerendered
	   HTML, or a slow chunk): gridstack now runs at every width (down to 4
	   columns on the narrowest phones), so this is no longer a permanent
	   narrow-viewport layout, just a brief fallback so items are not all
	   stacked at the same absolute position for that moment. */
	.grid-stack:not(.gs-ready) {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1.25rem;
		height: auto !important;
	}

	@media (max-width: 40rem) {
		.grid-stack:not(.gs-ready) {
			grid-template-columns: 1fr;
		}
	}

	.grid-stack:not(.gs-ready) :global(.grid-stack-item) {
		position: relative;
		width: auto;
		height: auto;
		min-height: 0;
		inset: auto;
		transform: none;
	}

	/* gridstack's own stylesheet positions the item's content box absolutely,
	   which contributes no height to its parent. Left alone here, every card
	   would collapse to a sliver during this fallback. Returning it to normal
	   flow lets the card's aspect-ratio set the height from the available
	   width instead. */
	.grid-stack:not(.gs-ready) :global(.grid-stack-item-content) {
		position: relative;
		inset: auto;
		height: auto;
	}

	/* Gridstack's own selector is more specific and applies hidden/auto
	   overflow to this box. Force browse cards to paint their 1% hover scale
	   beyond the cell instead of shaving the expanded edges. The node itself
	   still owns overflow:hidden, preserving its rounded internal clipping. */
	.grid-stack-item-content {
		inset: 0;
		overflow: visible !important;
	}

	/* On the four-column phone layout every node spans the full row. These
	   controls make that sequence directly editable without a long touch-drag.
	   They sit opposite NodeConfig and are real buttons, so GridStack's drag
	   cancellation selector already keeps taps from beginning a drag. */
	.mobile-reorder {
		position: absolute;
		top: 0.5rem;
		left: 0.5rem;
		z-index: 6;
		display: flex;
		overflow: hidden;
		border: 1px solid var(--glass-border);
		border-radius: 999px;
		background: color-mix(in oklch, var(--bg-elevated) 92%, transparent);
		box-shadow: 0 3px 12px rgb(0 0 0 / 0.18);
		backdrop-filter: blur(6px);
	}

	.mobile-reorder button {
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		padding: 0;
		place-items: center;
		border: 0;
		background: transparent;
		color: var(--text);
		cursor: pointer;
	}

	.mobile-reorder button + button {
		border-left: 1px solid var(--glass-border);
	}

	.mobile-reorder button:hover:not(:disabled),
	.mobile-reorder button:focus-visible {
		background: color-mix(in oklch, var(--accent) 14%, transparent);
		color: var(--accent);
	}

	.mobile-reorder button:disabled {
		color: var(--text-faint);
		cursor: not-allowed;
		opacity: 0.55;
	}

	.mobile-reorder svg {
		width: 1.35rem;
		height: 1.35rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.25;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* Inside a live grid the cell already encodes the node's shape, so the
	   card fills it rather than re-deriving that shape from `aspect-ratio`.
	   Both were applied at once before, and they disagree: a node spanning
	   w by h cells is `w*cell + (w-1)*gap` wide but only `h*cell + (h-1)*gap`
	   tall, which is not the w/h the ratio asks for. The card therefore came
	   up fractionally short of its own cell, by an error that grows with the
	   span — which is what made the resize grips look correctly placed on a
	   small node and visibly off one on a large one. FieldNode keeps the
	   ratio for the pre-hydration flow layout and for Lists, neither of which
	   has a cell to fill. */
	.grid-stack.gs-ready :global(.node),
	.grid-stack.gs-ready :global(.empty-node) {
		aspect-ratio: auto;
		width: 100%;
	}

	/* A scaled card must also paint above its neighbours rather than being
	   partially covered by whichever grid item happens to follow it. */
	.grid-stack:not(.edit-mode)
		:global(
			.grid-stack-item:has(.node.has-primary-action:hover, .node.has-primary-action:focus-within)
		) {
		z-index: 2;
	}

	/* Extra bottom padding gives visible empty grid to drag into — real
	   layout space on the actual grid, not decorative, which is why it stays
	   here rather than moving to .arrange-canvas below with everything else
	   about the dots.

	   A fixed length rather than four cells deep. Deriving it from the pitch
	   made the document's height a function of the container's width, and the
	   width is a function of whether the page is tall enough to want a
	   scrollbar — a loop that shook the whole view while dragging. The gutter
	   is reserved in app.css now too, so either fix alone would hold; both are
	   cheap and the dependency was never worth having. */
	.grid-stack.edit-mode {
		padding-bottom: 16rem;
	}

	/* The snap targets, shown only while arranging. Sized from gridstack's
	   own measured cell pitch rather than a percentage of the container: the
	   vertical pitch is a row height, not a fraction of the container's
	   height, so a percentage put the dots on a grid that did not exist.
	   A sibling of .grid-stack, not part of it, and positioned with an
	   explicit height rather than `inset: 0` — deliberately: an earlier
	   version put this same background directly on `.grid-stack.edit-mode`
	   with `min-height` reaching down to the viewport edge, which made the
	   real grid container itself pop instantly taller the moment arrange
	   mode turned on (gridstack's actual draggable box growing, not just a
	   decorative canvas). Decoupled here: `.grid-viewport` (the positioning
	   parent) never changes size, this layer is free to be visually taller
	   than it without dragging the real grid's own layout along, and
	   `overflow: hidden` keeps it from ever painting past the space it was
	   actually given. `5.5rem`/`1.65rem` match `+layout.svelte`'s own
	   `.page-transition` padding, the space reserved above/below `main` for
	   the floating brand/menu pills — the same pair `/join`'s fixed-height
	   screen already subtracts for the same reason (see that page's own
	   `.join-page` comment), reused here rather than re-deriving a second
	   constant for the same offset. */
	/* Spans the whole arrangement, not one screenful of it.
	   This was a fixed `100dvh` box, which is right only while the field
	   happens to fit on screen: as soon as nodes ran past the fold the dots
	   stopped at the viewport edge and everything below sat on bare page, so
	   the canvas looked cut off exactly when there was most to arrange.
	   Stretching to the container instead keeps the dots under every node.

	   `bottom: 0` is safe against the note on the element itself about not
	   letting this pop the real container taller: it is absolutely
	   positioned, so it takes its height from the grid rather than
	   contributing any. The min-height keeps a short field from collapsing
	   the canvas to nothing. */
	.arrange-canvas {
		/* Fixed to the viewport, not sized to the arrangement.

		   It is the surface the field is being arranged on, so it covers the
		   whole screen however few nodes there are and however far down they
		   reach. Sizing it to the grid meant it started below the header, ended
		   at the last row, and left bare page above and below once anything
		   scrolled — and giving it a min-height instead only made an absolutely
		   positioned box overflow its parent, which lengthened the page.
		   Fixed positioning takes it out of flow entirely: it can neither fall
		   short of the viewport nor add a single pixel of scroll to it.

		   Only the lattice tracks the grid, through --dot-x/--dot-y, so the dots
		   still land on real cell boundaries as the field scrolls beneath. */
		position: fixed;
		inset: 0;
		z-index: 0;
		overflow: hidden;
		pointer-events: none;
		background-image: radial-gradient(
			circle at 1px 1px,
			color-mix(in oklch, var(--text-muted) 55%, transparent) 1.5px,
			transparent 0
		);
		background-size: var(--cell-w, 2rem) var(--cell-h, 2rem);
		background-position: calc(4px + var(--dot-x, 0px)) calc(4px + var(--dot-y, 0px));
	}

	/* Hidden for the animation's own length: left in place, the resting
	   background sat visibly still directly underneath the rippling overlay
	   columns, so the "wave" read as a copy drawn on top of the real grid
	   rather than the grid itself moving. Suppressing the real one while
	   `waving` and letting the overlay (which uses this exact same pattern,
	   see `.dot-wave-col` below) stand in for it until it clears reads as
	   one grid actually rippling instead of two overlapping ones. */
	.arrange-canvas.waving,
	.arrange-canvas.exiting {
		background-image: none;
	}

	/* One ripple across the resting dot grid above, played once when arrange
	   mode switches on (see the `waving` effect). Each column repeats the
	   exact same dot pattern as `.arrange-canvas`'s own background, just
	   clipped to one cell's width, so the overlay is visually identical to
	   the grid at rest until it animates. */
	.dot-wave {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.dot-wave-col {
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(var(--dot-x, 0px) + var(--cell-w, 2rem) * var(--i));
		width: var(--cell-w, 2rem);
		background-image: radial-gradient(
			circle at 1px 1px,
			color-mix(in oklch, var(--text-muted) 55%, transparent) 1.5px,
			transparent 0
		);
		background-size: var(--cell-w, 2rem) var(--cell-h, 2rem);
		/* The same lattice the resting canvas draws, so the sweep ends exactly
		   where the grid it is standing in for begins. Horizontally that comes
		   from `left` above, which already starts at --dot-x; vertically it has
		   to be said here. A flat `4px` left the wave's dots offset from the
		   real ones by --dot-y wrapped into a cell — about a third of one — so
		   the whole grid appeared to jump into place as the animation ended. */
		background-position: 4px calc(4px + var(--dot-y, 0px));
		/* `both`, not the default `none`: without it, a column sits fully
		   opaque at its plain (unanimated) style for the whole span before
		   its own delay elapses — the entire grid would still pop in at once
		   the instant arrange mode turns on, just with a bump animating over
		   it later, rather than each column only fading into view as the
		   ripple actually reaches it. `both` applies the 0% keyframe (which
		   is invisible) for the whole delay, then holds the 100% keyframe
		   once done, instead of springing back to the plain, non-keyframed
		   style either side of the animation.
		   `ease-out`, not `ease-in-out`: applies to both segments this
		   keyframe set has (0%→55% and 55%→100% independently, which is how
		   a browser distributes one timing function across intermediate
		   keyframes), so the settle back to rest at 100% actually decelerates
		   into place instead of arriving at full speed and stopping dead. */
		animation: dot-wave 700ms ease-out both;
		/* Matches the `waving` effect's own totalMs calc in the script above.
		   --d (not --i): a separate, reversed index so the ripple direction
		   can differ from the columns' own left-to-right physical order. */
		animation-delay: calc(var(--d) * 22ms);
	}

	/* translateY only, no scaleY: this column spans .arrange-canvas's full
	   viewport-derived height (see that element's own comment), and scaling
	   a tall element forces the browser to resample its repeating
	   radial-gradient background every frame rather than just translating
	   already-rendered pixels. That resampling is what read as jitter, worse
	   the farther a dot sat from the transform-origin doing the scaling
	   (i.e. worst near the top) — confirmed by removing the scale outright
	   and watching it disappear. A plain translate moves the whole rendered
	   background as one rigid, GPU-composited unit with nothing to
	   resample, so it stays smooth regardless of how tall the strip is. */
	@keyframes dot-wave {
		0% {
			opacity: 0;
			transform: translateY(0.6rem);
		}
		55% {
			opacity: 1;
			transform: translateY(-0.5rem);
		}
		100% {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* The exit burst (see the `exiting` effect in the script). Overrides
	   .dot-wave-col's own entrance `animation`/`animation-delay` outright
	   (higher specificity, same property names) rather than needing a
	   separate element — the same column strips just play a different
	   keyframe outward instead of in. --exp-x carries both direction and
	   magnitude (signed distance from the middle column), so the whole grid
	   reads as scattering apart from its own center rather than every column
	   flying the same way. */
	.dot-wave-col.exploding {
		animation: dot-explode 550ms ease-in both;
		animation-delay: calc(var(--exp-d) * 18ms);
	}

	@keyframes dot-explode {
		0% {
			opacity: 1;
			transform: translateX(0) scaleY(1);
		}
		100% {
			opacity: 0;
			transform: translateX(calc(var(--exp-x) * 2.75rem)) scaleY(0.4);
		}
	}

	.grid-stack.edit-mode :global(.grid-stack-item) {
		cursor: grab;
	}

	.grid-stack.edit-mode :global(.grid-stack-item:active) {
		cursor: grabbing;
	}

	.grid-stack.edit-mode :global(.grid-stack-item:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
		border-radius: var(--radius-lg);
	}

	/* Persistent, unlike :focus-visible above: several cards can carry this
	   at once with only one of them (if any) actually focused, so it needs
	   its own rule rather than reusing focus's. Deliberately blue rather
	   than var(--accent) (a warm rust/orange in this app): selection is a
	   universal UI convention independent of brand color, and reusing the
	   accent would read as "this card is special" the same way :focus-visible
	   already does, rather than "this card is selected" specifically. A flush
	   box-shadow ring instead of outline, since outline needs an offset gap
	   to read as a ring and that gap made two adjacent selected cards look
	   like they shared one boundary; box-shadow sits directly on the card
	   edge and stays legible packed tight against a neighbour. */
	.grid-stack.edit-mode :global(.grid-stack-item.selected) {
		box-shadow: 0 0 0 3px #3b82f6;
		border-radius: var(--radius-lg);
	}

	/* Applied and removed directly by handleGridPointerMove/dragstop/
	   resizestop, not from editMode/selectedIds like every other rule in
	   this file — its whole lifetime is the span of one drag-or-resize
	   gesture, which is imperative by nature. Shared by both gestures: a
	   move sets only `transform: translate()`, a resize sets
	   `transform: translate() scale()` plus `transform-origin`, but the
	   z-index/transition treatment below is identical either way. Same
	   z-index gridstack's own .ui-draggable-dragging/.ui-resizable-resizing
	   use, so a follower and the one node gridstack is natively changing sit
	   at the same visual layer instead of the followers passing *under*
	   other cards they slide past or grow across. `transition: none` for the
	   same reason gridstack's own dragging/resizing classes override
	   transition on themselves (.grid-stack-animate
	   .ui-draggable-dragging/.ui-resizable-resizing in gridstack.css): this
	   sets a fresh transform on nearly every pointermove, and a card
	   animating toward each new value instead of snapping to it would lag
	   visibly behind the one card actually under the cursor. */
	.grid-stack.edit-mode :global(.grid-stack-item.group-gesture-follower) {
		z-index: 10000;
		transition: none;
	}

	/* Where the node will land. gridstack's default is a faint fill that
	   effectively vanishes on a dark background, so this is an explicit
	   accent-tinted, dashed target that reads in both themes. */
	.grid-stack :global(.field-drop-target > .placeholder-content),
	.grid-stack :global(.field-drop-target) {
		background: color-mix(in oklch, var(--accent) 22%, transparent);
		border: 2px dashed var(--accent);
		border-radius: var(--radius-lg);
	}

	/* Resize grips. gridstack ships them nearly invisible and auto-hidden,
	   which made resizing undiscoverable; these are always visible while
	   arranging and sized to be a real pointer target.

	   Bars hugging their own edge rather than dots floating beside it. As
	   equal circles sitting half outside the card, a grip was the same shape
	   whichever edge it belonged to and sat nearly as close to the
	   neighbouring node as to its own — with nodes packed together that made
	   it genuinely ambiguous which card a grip would resize. An edge grip is
	   now a short bar lying along the edge it controls, so it reads as part
	   of that edge, and every grip is pulled in tight against the card so the
	   nearest thing to it is always the node it belongs to. */
	.grid-stack.edit-mode {
		/* One geometry for all five grips: every one is a stroke of the same
		   thickness whose centreline lies on the card's own outline. The
		   edges are straight runs of it, the corners are the arc between
		   them. That is what makes them read as one set rather than as bars
		   plus a separate decoration.

		   The margin term is not optional. Gridstack positions handles
		   against the grid item, but the card is inset by the grid's own
		   margin, so an offset measured from the item alone leaves a grip
		   floating in the gutter by that much — which is what made the
		   earlier values look almost right and never quite land. */
		--handle-thickness: 0.4rem;
		--handle-offset: calc(var(--grid-margin, 8px) - var(--handle-thickness) / 2);
	}

	.grid-stack.edit-mode :global(.ui-resizable-handle) {
		background: var(--accent);
		border: 1px solid var(--bg-elevated);
		border-radius: var(--radius-sm);
		opacity: 0.9;
		z-index: 3;
	}

	/* Edge grips: a bar along the edge, short enough to leave the corners to
	   the corner grips and centred so it cannot be mistaken for one. */
	.grid-stack.edit-mode :global(.ui-resizable-e),
	.grid-stack.edit-mode :global(.ui-resizable-w) {
		width: var(--handle-thickness);
		height: 1.9rem;
		top: 50%;
		margin-top: -0.95rem;
		cursor: ew-resize;
	}

	.grid-stack.edit-mode :global(.ui-resizable-e) {
		right: var(--handle-offset);
	}

	.grid-stack.edit-mode :global(.ui-resizable-w) {
		left: var(--handle-offset);
	}

	.grid-stack.edit-mode :global(.ui-resizable-s) {
		width: 1.9rem;
		height: var(--handle-thickness);
		bottom: var(--handle-offset);
		left: 50%;
		margin-left: -0.95rem;
		cursor: ns-resize;
	}

	/* The corner grip is the arc between the two edge runs: same stroke
	   thickness, same centreline, so it continues the card's outline rather
	   than sitting near it. Drawn with two borders and a radius rather than
	   as a shape, which keeps it tied to `--radius-lg` — change the card's
	   corner and the grip follows.

	   Two numbers make it concentric with the card's own corner. The radius
	   is the card's plus half the stroke, so the stroke straddles the card's
	   curve exactly as the edge runs straddle its edges. The box is then
	   exactly that radius, which leaves no straight arms at all: arms are
	   what made the previous version overshoot the curve and read as a
	   bracket laid over the corner instead of as part of it. */
	.grid-stack.edit-mode :global(.ui-resizable-se),
	.grid-stack.edit-mode :global(.ui-resizable-sw) {
		--handle-arc: calc(var(--radius-lg) + var(--handle-thickness) / 2);
		width: var(--handle-arc);
		height: var(--handle-arc);
		bottom: var(--handle-offset);
		background: none;
		border: 0;
		border-radius: 0;
		/* Gridstack rotates the south-east handle 45 degrees for its own
		   default diagonal icon. Harmless for a dot; fatal for an arc, which
		   it swings off the corner it is supposed to trace. */
		transform: none;
		/* Legible over whatever artwork the card happens to be showing; the
		   edge runs get the same from their own 1px outline. */
		filter: drop-shadow(0 0 1px var(--bg-elevated));
	}

	.grid-stack.edit-mode :global(.ui-resizable-se) {
		right: var(--handle-offset);
		border-right: var(--handle-thickness) solid var(--accent);
		border-bottom: var(--handle-thickness) solid var(--accent);
		border-bottom-right-radius: var(--handle-arc);
		cursor: nwse-resize;
	}

	.grid-stack.edit-mode :global(.ui-resizable-sw) {
		left: var(--handle-offset);
		border-left: var(--handle-thickness) solid var(--accent);
		border-bottom: var(--handle-thickness) solid var(--accent);
		border-bottom-left-radius: var(--handle-arc);
		cursor: nesw-resize;
	}
</style>
