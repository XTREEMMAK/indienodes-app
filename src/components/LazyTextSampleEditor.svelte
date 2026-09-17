<script>
	/**
	 * `TextSampleEditor`, loaded on first use.
	 *
	 * The editor brings Tiptap, ProseMirror and a syntax highlighter with it
	 * (about 570 kB of JavaScript before compression) plus its stylesheet, and
	 * /join and /update only show it for a text sample or the bio dialog. A
	 * static import put all of that into both routes' first load. Props pass
	 * straight through, so call sites use this exactly like the editor itself.
	 *
	 * The placeholder holds the editor's own minimum height, so the form does
	 * not jump when the editor arrives.
	 * @type {{ body?: string, onUpdate?: (html: string) => void, headings?: boolean }}
	 */
	let props = $props();

	const editor = import('./TextSampleEditor.svelte');
</script>

{#await editor}
	<div class="editor-placeholder" aria-busy="true">
		<span class="sr-only">Loading the text editor…</span>
	</div>
{:then { default: TextSampleEditor }}
	<TextSampleEditor {...props} />
{:catch}
	<p class="editor-failed" role="alert">
		The text editor could not load. Reload the page to try again.
	</p>
{/await}

<style>
	.editor-placeholder {
		min-height: 12rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
	}

	.editor-failed {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
