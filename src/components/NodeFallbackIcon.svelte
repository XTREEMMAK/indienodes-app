<script>
	import './nodeFallbackAnimations.css';

	// Shared no-cover mark for the visual node types. Audio keeps its animated
	// waveform. These marks are decorative because the card already names its type.
	let { type } = $props();
</script>

<svg
	class="node-fallback-icon"
	data-node-fallback-icon={type}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if type === 'comic'}
		<path
			class="comic-page comic-page-left"
			d="M3.5 5.5c3.7-.7 6.5.2 8.5 2.2v11c-2-2-4.8-2.9-8.5-2.2v-11Z"
		/>
		<path
			class="comic-page comic-page-right"
			d="M20.5 5.5c-3.7-.7-6.5.2-8.5 2.2v11c2-2 4.8-2.9 8.5-2.2v-11Z"
		/>
	{:else if type === 'text'}
		<path class="paper" d="M6 3.5h8l4 4V12M14 3.5V8h4M6 3.5V20h6" />
		<g class="writing-pencil">
			<path d="m10 17 7-7 2.5 2.5-7 7-3 .5.5-3Z" />
			<path d="m15.8 11.2 2.5 2.5" />
		</g>
	{:else if type === 'art'}
		<rect class="art-frame" x="3.5" y="4" width="17" height="15.5" rx="1.2" />
		<circle class="art-sun" cx="16.8" cy="8.2" r="1.5" />
		<path class="art-landscape" d="m5.8 17 4.3-5 2.8 3 2-2.2 3.3 4.2H5.8Z" />
	{:else if type === 'craft'}
		<ellipse class="craft-flange" cx="12" cy="6" rx="6" ry="2.2" />
		<ellipse class="craft-flange" cx="12" cy="18" rx="6" ry="2.2" />
		<path class="craft-thread" d="M6 6v12M18 6v12M6 10.5c4 1.5 8 1.5 12 0M6 14c4 1.5 8 1.5 12 0" />
	{:else if type === 'game'}
		<path
			class="game-body"
			d="M7.5 8h9c2.3 0 3.7 1.4 4.2 3.6l1 4.1c.5 2.1-1.9 3.5-3.4 2l-2.1-2.2H7.8l-2.1 2.2c-1.5 1.5-3.9.1-3.4-2l1-4.1C3.8 9.4 5.2 8 7.5 8Z"
		/>
		<path class="game-pad" d="M7 10.8v4.4M4.8 13h4.4" />
		<circle class="game-button" cx="16" cy="11.7" r=".7" fill="currentColor" stroke="none" />
		<circle
			class="game-button game-button-secondary"
			cx="18.2"
			cy="14"
			r=".7"
			fill="currentColor"
			stroke="none"
		/>
	{/if}
</svg>

<style>
	.node-fallback-icon {
		display: block;
		width: clamp(4.25rem, 36%, 9rem);
		aspect-ratio: 1;
		color: color-mix(in oklch, var(--node-color, var(--accent)) 28%, white);
		opacity: 0.68;
		filter: drop-shadow(0 0.45rem 0.9rem rgb(0 0 0 / 0.2));
	}
</style>
