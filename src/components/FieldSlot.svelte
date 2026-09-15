<script>
	/**
	 * One position in the field view, owning *when* it rotates. The parent
	 * owns *which* entry it shows and hands the next one down; this component
	 * only decides the timing and reports back with `onadvance`.
	 *
	 * Timing is per-slot rather than global on purpose. The previous design
	 * ran one timer for the whole field and swapped every visible node at the
	 * same instant, which is both the least calm way to present it and the
	 * worst case for the network: every card's cover image requested in one
	 * burst. Independent timers with jitter spread that out by construction.
	 *
	 * @type {{
	 *   entry: import('../lib/ring.js').RingEntry,
	 *   nodeId?: string,
	 *   index?: number,
	 *   rotating?: boolean,
	 *   pageVisible?: boolean,
	 *   intervalMs?: number,
	 *   onadvance?: () => void,
	 *   aspect?: string,
	 *   editMode?: boolean,
	 *   nodeType?: import('../lib/nodeShape.js').NodeType,
	 *   nodeTags?: string[],
	 *   nodeRotationOverrideMs?: number | null,
	 *   onTypeChange?: (type: import('../lib/nodeShape.js').NodeType) => void,
	 *   onTagsChange?: (tags: string[]) => void,
	 *   onRotationOverrideChange?: (ms: number | null) => void,
	 *   onRemove?: () => void
	 * }}
	 */
	let {
		entry,
		nodeId = '',
		index = 0,
		rotating = false,
		pageVisible = true,
		intervalMs = 14000,
		onadvance,
		aspect = '1 / 1',
		editMode = false,
		nodeType = 'any',
		nodeTags = [],
		nodeRotationOverrideMs = null,
		onTypeChange,
		onTagsChange,
		onRotationOverrideChange,
		onRemove
	} = $props();

	import { untrack } from 'svelte';
	import FieldNode from './FieldNode.svelte';
	import NodeConfig from './NodeConfig.svelte';
	import { comicViewerStore } from '$lib/comicViewerStore.svelte.js';
	import { textViewerStore } from '$lib/textViewerStore.svelte.js';

	/** Progress repaint cadence. Matches FieldNode's fill transition duration. */
	const TICK_MS = 120;
	/** Spread between neighbouring slots' first rotation, so they don't align. */
	const STAGGER_MS = 2200;
	/** Fraction of the base interval each cycle is randomly stretched/shrunk by. */
	const JITTER = 0.25;

	/** @param {number} base */
	function jittered(base) {
		return Math.round(base * (1 - JITTER + Math.random() * JITTER * 2));
	}

	let hovering = $state(false);
	let focused = $state(false);
	let elapsed = $state(0);
	let slotEl = $state(/** @type {HTMLDivElement | undefined} */ (undefined));
	// Defaults true so a slot isn't gated shut before its own observer has had
	// a chance to report in on first paint.
	let onScreen = $state(true);
	// Staggered on the first cycle only; every cycle after is plain jitter,
	// by which point the slots have already drifted apart on their own.
	// untrack because this genuinely is a one-time seed: a later change to
	// intervalMs should govern the *next* cycle, not retroactively rewrite
	// the countdown already in progress.
	let target = $state(untrack(() => jittered(intervalMs) + index * STAGGER_MS));

	// Rotation must never pull content out from under someone who is actually
	// engaging with it, so a slot holds while the pointer is over it or
	// keyboard focus is inside it. Page visibility comes from the parent,
	// which keeps one listener for the whole field instead of one per slot.
	// A slot scrolled out of view is folded into the same pause, since there
	// is no one there to see it rotate either.
	//
	// An open reader pauses every slot, not just the one that opened it. The
	// reader is a full-screen surface, so nothing behind it is being watched;
	// more to the point, the entry being read is still occupying its own slot,
	// and letting that slot rotate would swap the entry out from under the
	// person reading it — the exact thing the hover and focus holds exist to
	// prevent. Hover and focus cannot cover this case themselves: the reader
	// is mounted at the root layout, so opening it moves focus out of the slot
	// entirely.
	const readerOpen = $derived(comicViewerStore.open || textViewerStore.open);
	const paused = $derived(hovering || focused || !pageVisible || !onScreen || readerOpen);
	const progress = $derived(rotating ? Math.min(1, elapsed / target) : null);

	// Every rendered slot used to keep its interval running even off-screen,
	// only skipping its own work once inside the tick (the `paused` check
	// below). With a field of any size that's a lot of intervals ticking for
	// nothing. `rootMargin` gives nodes just past the fold a head start, so
	// scrolling one into view resumes an already-progressing bar rather than
	// a visible snap to life.
	$effect(() => {
		const el = slotEl;
		if (!el) return;

		const observer = new IntersectionObserver(
			([entry]) => (onScreen = entry?.isIntersecting ?? false),
			{ rootMargin: '200px' }
		);
		observer.observe(el);
		return () => observer.disconnect();
	});

	$effect(() => {
		// Tracked, unlike `paused`/`target` below: an on/off-screen transition
		// is the one thing that should actually tear down and recreate the
		// interval, since it changes whether there is any interval to run at
		// all. Hover and focus, which the callback below also reads, must not
		// do the same — that would tear down and restart the interval on
		// every hover.
		if (!rotating || !onScreen) return;

		// Reads inside this callback are deliberately outside the effect's
		// tracking context: it runs on a later tick, so `paused` and `target`
		// are read live without making this effect a dependent of them, which
		// would tear down and restart the interval on every hover.
		const id = setInterval(() => {
			if (paused) return;
			elapsed += TICK_MS;
			if (elapsed >= target) {
				elapsed = 0;
				target = jittered(intervalMs);
				onadvance?.();
			}
		}, TICK_MS);

		return () => clearInterval(id);
	});
</script>

<!-- role="presentation" because these handlers only track hover and focus to
     pause this slot's rotation; they add no interaction of their own, and
     every actionable control inside the card is its own button or link. -->
<div
	class="slot"
	role="presentation"
	bind:this={slotEl}
	onmouseenter={() => (hovering = true)}
	onmouseleave={() => (hovering = false)}
	onfocusin={() => (focused = true)}
	onfocusout={() => (focused = false)}
>
	<FieldNode {entry} {progress} progressPaused={paused} {aspect} {editMode} ambient />

	{#if editMode}
		<NodeConfig
			{nodeId}
			{nodeType}
			{nodeTags}
			{nodeRotationOverrideMs}
			{onTypeChange}
			{onTagsChange}
			{onRotationOverrideChange}
			{onRemove}
		/>
	{/if}
</div>

<style>
	.slot {
		position: relative;
		min-width: 0;
		height: 100%;
	}
</style>
