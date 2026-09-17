<script>
	import { onDestroy } from 'svelte';
	import { Tipex } from '@friendofsvelte/tipex';
	import './textSampleEditor.css';

	/**
	 * `headings: false` drops the block-level controls, leaving bold, italic,
	 * underline, strike, undo, redo and plain paste. The bio uses it: every
	 * generated template renders that field inside a paragraph of its own, so
	 * offering headings there would produce markup the sanitizer has to throw
	 * away — better not to offer it.
	 * @type {{ body?: string, onUpdate?: (html: string) => void, headings?: boolean }}
	 */
	let { body = '', onUpdate, headings = true } = $props();

	/**
	 * What the last paste attempt did, or 'idle' when it has nothing to
	 * report. Held as a state rather than a label string because the button
	 * shows an icon: the outcome still has to reach a sighted user (briefly,
	 * through the icon and the tooltip) and a screen reader user (through the
	 * live region below), and those want the meaning rather than the wording.
	 * @type {'idle' | 'pasted' | 'empty' | 'unsupported'}
	 */
	let pasteState = $state('idle');
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let pasteReset;

	const PASTE_MESSAGES = {
		idle: 'Paste plain text',
		pasted: 'Pasted as plain text',
		empty: 'Clipboard is empty',
		unsupported: 'This browser blocks reading the clipboard — use Ctrl+V'
	};

	const pasteMessage = $derived(PASTE_MESSAGES[pasteState]);

	/**
	 * Tiptap parses a string passed to `insertContent` as HTML. Escape the
	 * clipboard first so the Paste tool cannot smuggle unsupported formatting
	 * back into an intentionally small toolbar; line breaks remain line breaks.
	 * @param {string} text
	 */
	function plainTextHtml(text) {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/\r\n?/g, '\n')
			.replace(/\n/g, '<br>');
	}

	/**
	 * Clipboard reads require a secure browser context and user permission.
	 * When a browser refuses the read, leave focus in the editor and say what
	 * works everywhere instead of failing silently.
	 * @param {import('@friendofsvelte/tipex').TipexEditor} editor
	 */
	async function paste(editor) {
		if (!editor) return;
		clearTimeout(pasteReset);
		try {
			const text = await navigator.clipboard.readText();
			if (text) editor.chain().focus().insertContent(plainTextHtml(text)).run();
			else editor.chain().focus().run();
			pasteState = text ? 'pasted' : 'empty';
		} catch {
			editor.chain().focus().run();
			pasteState = 'unsupported';
		}
		// The refusal case is a full sentence telling someone what to do
		// instead, so it gets longer to be read than a one-word confirmation.
		pasteReset = setTimeout(
			() => (pasteState = 'idle'),
			pasteState === 'unsupported' ? 4000 : 1800
		);
	}

	onDestroy(() => clearTimeout(pasteReset));
</script>

<Tipex
	{body}
	autofocus={false}
	class="tipex-control"
	onupdate={({ editor }) => onUpdate?.(editor.getHTML())}
>
	{#snippet controlComponent(editor)}
		<div class="tipex-controller text-sample-controller">
			<div class="tipex-basic-controller-wrapper">
				{#if headings}
					<button
						type="button"
						class="tipex-edit-button tipex-button-extra tipex-button-rigid"
						class:active={editor?.isActive('heading', { level: 1 })}
						disabled={!editor}
						onclick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
						aria-label="Heading 1"
						title="Heading 1"><span class="tipex-button-label">H1</span></button
					>
					<button
						type="button"
						class="tipex-edit-button tipex-button-extra tipex-button-rigid"
						class:active={editor?.isActive('heading', { level: 2 })}
						disabled={!editor}
						onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
						aria-label="Heading 2"
						title="Heading 2"><span class="tipex-button-label">H2</span></button
					>
					<button
						type="button"
						class="tipex-edit-button tipex-button-extra tipex-button-rigid"
						class:active={editor?.isActive('heading', { level: 3 })}
						disabled={!editor}
						onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
						aria-label="Heading 3"
						title="Heading 3"><span class="tipex-button-label">H3</span></button
					>
					<button
						type="button"
						class="tipex-edit-button tipex-button-extra tipex-button-rigid"
						class:active={editor?.isActive('paragraph')}
						disabled={!editor}
						onclick={() => editor?.chain().focus().setParagraph().run()}
						aria-label="Paragraph"
						title="Paragraph"><span class="tipex-button-label">P</span></button
					>
				{/if}

				<div class="tipex-divider"></div>

				<button
					type="button"
					class="tipex-edit-button tipex-button-extra tipex-button-rigid"
					class:active={editor?.isActive('bold')}
					disabled={!editor}
					onclick={() => editor?.chain().focus().toggleBold().run()}
					aria-label="Bold"
					title="Bold"><span class="tipex-button-label"><strong>B</strong></span></button
				>
				<button
					type="button"
					class="tipex-edit-button tipex-button-extra tipex-button-rigid"
					class:active={editor?.isActive('italic')}
					disabled={!editor}
					onclick={() => editor?.chain().focus().toggleItalic().run()}
					aria-label="Italic"
					title="Italic"><span class="tipex-button-label"><em>I</em></span></button
				>
				<button
					type="button"
					class="tipex-edit-button tipex-button-extra tipex-button-rigid"
					class:active={editor?.isActive('underline')}
					disabled={!editor}
					onclick={() => editor?.chain().focus().toggleUnderline().run()}
					aria-label="Underline"
					title="Underline"><span class="tipex-button-label"><u>U</u></span></button
				>
				<button
					type="button"
					class="tipex-edit-button tipex-button-extra tipex-button-rigid"
					class:active={editor?.isActive('strike')}
					disabled={!editor}
					onclick={() => editor?.chain().focus().toggleStrike().run()}
					aria-label="Strikethrough"
					title="Strikethrough"><span class="tipex-button-label"><s>S</s></span></button
				>

				<div class="tipex-divider"></div>

				<button
					type="button"
					class="tipex-edit-button tipex-button-extra tipex-button-rigid"
					disabled={!editor?.can().undo()}
					onclick={() => editor?.chain().focus().undo().run()}
					aria-label="Undo"
					title="Undo"><span class="tipex-button-label" aria-hidden="true">↶</span></button
				>
				<button
					type="button"
					class="tipex-edit-button tipex-button-extra tipex-button-rigid"
					disabled={!editor?.can().redo()}
					onclick={() => editor?.chain().focus().redo().run()}
					aria-label="Redo"
					title="Redo"><span class="tipex-button-label" aria-hidden="true">↷</span></button
				>
				<button
					type="button"
					class="tipex-edit-button tipex-button-extra tipex-button-rigid paste-button"
					disabled={!editor}
					onclick={() => paste(editor)}
					aria-label={pasteMessage}
					title={pasteMessage}
				>
					<span class="tipex-button-label">
						{#if pasteState === 'pasted'}
							<!-- A tick for the moment after a successful paste, since the
							     icon is the only visible thing left to carry that. -->
							<svg
								viewBox="0 0 24 24"
								width="15"
								height="15"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								aria-hidden="true"
							>
								<path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
						{:else}
							<!-- Clipboard, inline rather than from an icon package: this
							     project has no icon library and adding one for a single
							     mark would be a dependency-posture change (see the note in
							     ComicViewer.svelte on exactly this). -->
							<svg
								viewBox="0 0 24 24"
								width="15"
								height="15"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								aria-hidden="true"
							>
								<rect x="8.5" y="2.5" width="7" height="4" rx="1.2" />
								<path
									d="M15.5 4.5H18a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						{/if}
					</span>
				</button>
			</div>
			<!--
				The outcome used to be the button's own text, which an icon cannot
				carry. A polite live region keeps that announcement for screen
				reader users; `title`/`aria-label` above carry it on hover and
				focus, and the tick carries it visually.
			-->
			<span class="sr-only" role="status" aria-live="polite">
				{pasteState === 'idle' ? '' : pasteMessage}
			</span>
		</div>
	{/snippet}
</Tipex>
