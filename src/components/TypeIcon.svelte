<script>
	// One glyph per content type, for places that name a type rather than
	// show an entry of it — the arrange menu's Add buttons today.
	//
	// Stroke-drawn on a 24x24 box with `currentColor`, matching every other
	// inline icon in this app (AmbientActionPanel's set is the reference), so
	// a caller colours it by setting `color` and nothing here needs to know
	// about themes or type colours.
	//
	// Decorative by default: these sit beside their own text label, so
	// announcing them would just repeat it. A caller using one *without* a
	// visible label passes `label` and gets an img role instead.

	// `label` carries an explicit default it does not appear to need, and it
	// is load-bearing. This is the trap NodeConfig.svelte's header records,
	// with the mechanism pinned down: the compiler attaches this JSDoc to
	// whatever it emits next, and a destructure with no defaults emits no
	// declaration of its own — so in a component this small the comment lands
	// on a generated template variable instead, producing a JSDoc cast
	// (`/** ... */ (`) that rolldown refuses to parse. A default makes Svelte
	// emit a real `let label = $.prop(...)` for it to attach to. svelte-check
	// and the dev server both accept either; only `npm run build` fails.
	/** @type {{ type: import('../lib/nodeShape.js').NodeType, label?: string }} */
	let { type, label = undefined } = $props();
</script>

<svg
	class="type-icon"
	viewBox="0 0 24 24"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
>
	{#if type === 'audio'}
		<!-- Beamed note: the one shape that reads as "sound" at 16px without
		     resorting to a speaker, which would mean playback instead. -->
		<path d="M9 17V5l10-2v12" />
		<circle cx="6.5" cy="17" r="2.5" />
		<circle cx="16.5" cy="15" r="2.5" />
	{:else if type === 'comic'}
		<path d="M4 5h16v11H10l-4.5 3.5V5Z" />
		<path d="M8 9.5h8M8 12.5h5" />
	{:else if type === 'text'}
		<path d="M6 3.5h8.5L19 8v12.5H6Z" />
		<path d="M14 3.5V8h5" />
		<path d="M9 12h7M9 15.5h7M9 19h4" />
	{:else if type === 'art'}
		<path d="M4 4.5h16v15H4Z" />
		<path d="m5 16.5 4.5-5.5 3 3.5 3-4 3.5 6" />
		<circle cx="9" cy="8.5" r="1.6" />
	{:else if type === 'craft'}
		<!-- Spool of thread with a loose end: a made, hand-held object, and
		     distinct from art's framed landscape at 16px. -->
		<ellipse cx="12" cy="6" rx="6" ry="2.2" />
		<ellipse cx="12" cy="18" rx="6" ry="2.2" />
		<path d="M6 6v12M18 6v12M6 10.5c4 1.5 8 1.5 12 0M6 14c4 1.5 8 1.5 12 0" />
	{:else if type === 'game'}
		<path d="M7.5 7.5h9a5.5 5.5 0 0 1 0 11h-9a5.5 5.5 0 0 1 0-11Z" />
		<path d="M10 11v3.5M8.25 12.75h3.5" />
		<circle cx="16" cy="12" r="1.1" />
		<circle cx="18" cy="14.5" r="1.1" />
	{:else}
		<!-- "Any": four marks around a centre, meaning several kinds at once
		     rather than any one of them. -->
		<circle cx="12" cy="12" r="2.5" />
		<path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
	{/if}
</svg>

<style>
	.type-icon {
		width: 1em;
		height: 1em;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
