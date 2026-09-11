<script>
	// A node with no entry to show: either its type has nothing in the ring
	// yet, or every matching entry is already on screen in another node.
	//
	// This exists so a node is never invisible. Rendering nothing when a node
	// had no content made it possible to add a node and then have no way to
	// select or delete it, since its configuration lives on the node itself.
	// It also quietly misrepresented the ring as smaller than it is.
	//
	// Prose in line comments and the type on one line: see the note in
	// NodeConfig.svelte for why a multi-line block comment here breaks the
	// production build while passing every other check.

	import { resolve } from '$app/paths';
	import { EARLY_ACCESS } from '$lib/config.js';

	/**
	 * `cause` (brief section 7c) distinguishes why this slot has nothing. See
	 * `shortageCause` on the field page for the order these are decided in;
	 * the job here is only to say each one in a way that names what would fix
	 * it. `null`/omitted keeps the original generic message (every matching
	 * entry is already on screen elsewhere).
	 * @type {{ node: { id: string, type: 'audio'|'comic'|'text'|'game'|'art'|'any', tags?: string[], x: number, y: number, w: number, h: number }, editMode?: boolean, cause?: 'ring-empty' | 'node-tags-empty' | 'global-tags-empty' | 'hidden-exhausted' | null }}
	 */
	let { node, editMode = false, cause = null } = $props();

	// Two of the causes are about the configuration being edited right now, so
	// they survive into arrange mode where the others are replaced by the
	// generic "leave it, it fills in" message. Being told your tag selection
	// matches nothing is only actionable while the menu that sets it is open.
	const CONFIG_CAUSES = ['node-tags-empty', 'global-tags-empty'];
	const showCause = $derived(!editMode || CONFIG_CAUSES.includes(cause ?? ''));

	const tagList = $derived((node.tags ?? []).join(', '));

	const LABEL = {
		audio: 'audio',
		comic: 'comic',
		text: 'writing',
		game: 'game',
		art: 'art',
		any: 'ring'
	};

	// Matches the badge a filled card carries, and matters more here: an empty
	// node has no artwork to say what it is, so while arranging it is otherwise
	// a blank rectangle being resized with nothing to identify it.
	const TYPE_LABEL = {
		audio: 'Audio',
		comic: 'Comic',
		text: 'Text',
		game: 'Game',
		art: 'Art',
		any: 'Any'
	};
</script>

<div class="empty-node" data-type={node.type} style:--node-aspect={`${node.w} / ${node.h}`}>
	{#if editMode}
		<span class="type-badge">{TYPE_LABEL[node.type]}</span>
	{/if}
	<p class="message">
		{#if !showCause}
			Nothing to show here yet. Pick another type, or leave it: it fills in as the ring grows.
		{:else if cause === 'ring-empty'}
			The ring doesn't have any {LABEL[node.type]} entries yet.
			<!-- Named fix, same as `global-tags-empty` and `hidden-exhausted`
			     below: this message's job is to say what would change it, and
			     while the ring is still being built the honest answer is that
			     somebody has to join. Without this the sparse field is several
			     dead ends at once and no route out of them -- /join is behind
			     the menu, so nothing on screen offers it.

			     A plain inline link rather than a button, and only on this
			     cause. Several of these are on screen at the same time by the
			     nature of a ring this small, and three buttons competing for
			     the same click would read as a campaign; three sentences that
			     happen to name the same fix read as the truth. -->
			{#if EARLY_ACCESS}
				It's still being built — <a href={resolve('/join')}>add yours</a>.
			{/if}
		{:else if cause === 'node-tags-empty'}
			No {LABEL[node.type]} tagged <strong>{tagList}</strong> in the ring yet. Change this node's tags
			from its own menu.
		{:else if cause === 'global-tags-empty'}
			<!-- The one message that has to point somewhere else in the app. A
			     node narrowed to tags its owner also excluded globally would
			     otherwise sit empty forever with nothing to say why, which is
			     the objection two tag layers had to answer (docs/decisions.md). -->
			There is {LABEL[node.type]} tagged <strong>{tagList}</strong>, but your global tag preference
			leaves it out.
			<a href={resolve('/settings')}>Adjust it in Settings</a>.
		{:else if cause === 'hidden-exhausted'}
			Your Not for Me list is why this is empty. Restore some from
			<a href={resolve('/lists')}>Lists</a>, or wait for more members to join.
		{:else}
			No {LABEL[node.type]} to show right now.
		{/if}
	</p>
</div>

<style>
	.empty-node {
		--node-color: var(--type-audio);
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		aspect-ratio: var(--node-aspect, 1 / 1);
		padding: 1.2rem;
		text-align: center;
		border-radius: var(--radius-lg);
		/* Dashed rather than solid, and un-tinted: a placeholder should read
		   as an absence, not as another card competing for attention. */
		border: 1px dashed var(--border);
		background: color-mix(in oklch, var(--node-color) 6%, transparent);
	}

	/* Same chip a filled card carries, in the same corner, so the two read as
	   one thing. Absolutely placed because this node centres its message. */
	.type-badge {
		position: absolute;
		top: 0.85rem;
		left: 0.85rem;
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		background: var(--bg-elevated);
		color: var(--node-color);
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.empty-node[data-type='game'] {
		--node-color: var(--type-game);
	}
	.empty-node[data-type='comic'] {
		--node-color: var(--type-comic);
	}
	.empty-node[data-type='text'] {
		--node-color: var(--type-text);
	}
	.empty-node[data-type='art'] {
		--node-color: var(--type-art);
	}
	.empty-node[data-type='any'] {
		--node-color: var(--text-muted);
	}

	.message {
		margin: 0;
		max-width: 26ch;
		color: var(--text-muted);
		font-size: var(--text-xs);
	}

	.message strong {
		color: var(--text);
		font-weight: 600;
	}

	.message a {
		color: var(--accent);
	}

	.message a:hover {
		text-decoration: underline;
	}
</style>
