<script>
	// A positioned popup for the two things arranging needs beyond moving and
	// resizing nodes directly: adding one, and starting over. Replaces what
	// used to be a bar sitting permanently above the field whenever edit mode
	// was on. That bar was chrome competing with the field's own artwork for
	// attention on a surface whose point is being idle the rest of the time,
	// for controls that are only needed occasionally. A menu that appears on
	// request and closes itself is quieter.
	//
	// Positioning is the caller's job, not this component's: `x`/`y` are
	// viewport coordinates, which the desktop caller takes from a right-click
	// event and the mobile caller takes from a trigger button's own bounding
	// box. Clamped here so the menu cannot render partly off-screen near an
	// edge or corner.
	//
	// Mechanics mirror NodeConfig's own dropdown (pointerdown-outside and
	// Escape both close it) rather than inventing a second pattern for the
	// same kind of popup.
	//
	// `onExit` is optional and left out entirely by the mobile caller: on
	// mobile, exiting arrange mode is already one tap away on the adjacent
	// "Arrange" bottom-bar button, so repeating it here would be redundant.
	//
	// The menu also opens *outside* arrange mode, where it collapses to the
	// single control that makes sense there: a way in. Add and Reset are
	// meaningless when there is no arranging happening and no drag handles on
	// screen, so offering them would be chrome for its own sake; what the
	// right-click is actually for at that point is getting into the mode
	// without going to the header first.

	import { untrack } from 'svelte';
	import TypeIcon from './TypeIcon.svelte';
	import { fieldPresetsStore } from '../lib/fieldPresetsStore.svelte.js';

	/** @type {{ x: number, y: number, editMode?: boolean, fitToView?: boolean, onAdd: (type: import('../lib/nodeShape.js').NodeType) => void, onReset: () => void, onExit?: () => void, onEnter?: () => void, onToggleFit?: () => void, onClose: () => void }} */
	let {
		x,
		y,
		editMode = true,
		fitToView = false,
		onAdd,
		onReset,
		onExit,
		onEnter,
		onToggleFit,
		onClose
	} = $props();

	/** @type {{ id: import('../lib/nodeShape.js').NodeType, label: string }[]} */
	const ADD_TYPES = [
		{ id: 'audio', label: 'Audio' },
		{ id: 'comic', label: 'Comic' },
		{ id: 'text', label: 'Text' },
		{ id: 'art', label: 'Art' },
		{ id: 'game', label: 'Game' },
		{ id: 'any', label: 'Any' }
	];

	// Which preset slot's row is showing its inline name field, for both
	// saving into an empty slot and renaming a filled one. No native
	// `prompt()` anywhere in this codebase, so naming is an inline text
	// input rather than a dialog.
	let presetEditIndex = $state(/** @type {number | null} */ (null));
	let presetNameInput = $state('');

	/** @param {number} index */
	function beginSavePreset(index) {
		presetEditIndex = index;
		presetNameInput = `Preset ${index + 1}`;
	}

	/** @param {number} index */
	function beginRenamePreset(index) {
		const slot = fieldPresetsStore.slots[index];
		presetEditIndex = index;
		presetNameInput = slot?.name ?? '';
	}

	/** @param {number} index */
	function confirmPresetEdit(index) {
		const slot = fieldPresetsStore.slots[index];
		if (slot) fieldPresetsStore.rename(index, presetNameInput);
		else fieldPresetsStore.save(index, presetNameInput);
		presetEditIndex = null;
	}

	/** @param {number} index */
	function loadPreset(index) {
		fieldPresetsStore.load(index);
		onClose();
	}

	let menuEl = $state(/** @type {HTMLElement | undefined} */ (undefined));
	// The caller's raw coordinate is only ever a starting point, corrected
	// below once the menu has real dimensions to clamp against, so this
	// deliberately captures x/y once rather than tracking them.
	let placed = $state(untrack(() => ({ left: x, top: y })));

	// Clamped after the menu has real dimensions to measure, not before: its
	// size depends on its content, so there is nothing to clamp against on
	// the same tick it is given a raw click position.
	$effect(() => {
		const el = menuEl;
		if (!el) return;
		const margin = 8;
		const rect = el.getBoundingClientRect();
		const left = Math.min(x, window.innerWidth - rect.width - margin);
		const top = Math.min(y, window.innerHeight - rect.height - margin);
		placed = { left: Math.max(margin, left), top: Math.max(margin, top) };
	});

	$effect(() => {
		/** @param {PointerEvent} event */
		function handlePointerDown(event) {
			const target = /** @type {Node} */ (event.target);
			if (menuEl && !menuEl.contains(target)) onClose();
		}
		/** @param {KeyboardEvent} event */
		function handleKey(event) {
			if (event.key === 'Escape') onClose();
		}

		document.addEventListener('pointerdown', handlePointerDown, true);
		document.addEventListener('keydown', handleKey);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown, true);
			document.removeEventListener('keydown', handleKey);
		};
	});
</script>

<div
	bind:this={menuEl}
	class="menu glass-panel"
	role="menu"
	style:left="{placed.left}px"
	style:top="{placed.top}px"
>
	{#if editMode}
		<span class="section-label">Add node</span>
		<div class="add-group">
			{#each ADD_TYPES as option (option.id)}
				<button
					type="button"
					class="add-chip"
					data-type={option.id}
					onclick={() => {
						onAdd(option.id);
						onClose();
					}}
				>
					<TypeIcon type={option.id} />
					{option.label}
				</button>
			{/each}
		</div>

		<div class="divider" role="separator"></div>
		<button
			type="button"
			class="row-button"
			onclick={() => {
				onReset();
				onClose();
			}}
		>
			<svg
				viewBox="0 0 24 24"
				width="16"
				height="16"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path d="M3 12a9 9 0 1 0 3-6.7L3 8" stroke-linecap="round" stroke-linejoin="round" />
				<path d="M3 3v5h5" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
			<span>Reset layout</span>
		</button>

		<div class="divider" role="separator"></div>
		<span class="section-label">Presets</span>
		<div class="preset-list">
			{#each fieldPresetsStore.slots as slot, index (index)}
				{#if presetEditIndex === index}
					<div class="preset-row preset-edit">
						<input
							type="text"
							class="preset-name-input"
							bind:value={presetNameInput}
							placeholder={`Preset ${index + 1}`}
							aria-label="Preset name"
							onkeydown={(event) => {
								if (event.key === 'Enter') confirmPresetEdit(index);
							}}
						/>
						<button
							type="button"
							class="icon-button"
							aria-label="Confirm preset name"
							onclick={() => confirmPresetEdit(index)}
						>
							<svg
								viewBox="0 0 24 24"
								width="14"
								height="14"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								aria-hidden="true"
							>
								<path d="M5 12.5l4.5 4.5L19 7" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
						</button>
						<button
							type="button"
							class="icon-button"
							aria-label="Cancel"
							onclick={() => (presetEditIndex = null)}
						>
							<svg
								viewBox="0 0 24 24"
								width="14"
								height="14"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								aria-hidden="true"
							>
								<path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
							</svg>
						</button>
					</div>
				{:else}
					<div class="preset-row">
						<button
							type="button"
							class="row-button preset-main"
							disabled={!slot}
							onclick={() => loadPreset(index)}
						>
							<span>{slot ? slot.name : `Empty — Slot ${index + 1}`}</span>
						</button>
						{#if slot}
							<button
								type="button"
								class="icon-button"
								aria-label="Rename preset"
								onclick={() => beginRenamePreset(index)}
							>
								<svg
									viewBox="0 0 24 24"
									width="14"
									height="14"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									aria-hidden="true"
								>
									<path
										d="M4 20h4l10-10-4-4L4 16v4Z"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg>
							</button>
							<button
								type="button"
								class="icon-button"
								aria-label="Clear preset"
								onclick={() => fieldPresetsStore.clear(index)}
							>
								<svg
									viewBox="0 0 24 24"
									width="14"
									height="14"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									aria-hidden="true"
								>
									<path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
								</svg>
							</button>
						{:else}
							<button
								type="button"
								class="icon-button"
								aria-label="Save current arrangement to this slot"
								onclick={() => beginSavePreset(index)}
							>
								<svg
									viewBox="0 0 24 24"
									width="14"
									height="14"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									aria-hidden="true"
								>
									<path d="M12 5v14M5 12h14" stroke-linecap="round" />
								</svg>
							</button>
						{/if}
					</div>
				{/if}
			{/each}
		</div>

		{#if onExit}
			<div class="divider" role="separator"></div>
			<button
				type="button"
				class="row-button"
				onclick={() => {
					onExit();
					onClose();
				}}
			>
				<svg
					viewBox="0 0 24 24"
					width="16"
					height="16"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					aria-hidden="true"
				>
					<path d="M5 12.5l4.5 4.5L19 7" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				<span>Done arranging</span>
			</button>
		{/if}
	{:else}
		<button
			type="button"
			class="row-button"
			onclick={() => {
				onEnter?.();
				onClose();
			}}
		>
			<svg
				viewBox="0 0 24 24"
				width="16"
				height="16"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<rect x="3" y="3" width="7" height="7" rx="1.5" />
				<rect x="14" y="3" width="7" height="7" rx="1.5" />
				<rect x="3" y="14" width="7" height="7" rx="1.5" />
				<path d="M17.5 14.5v6M14.5 17.5h6" stroke-linecap="round" />
			</svg>
			<span>Arrange field</span>
		</button>
	{/if}

	{#if onToggleFit}
		<!-- Offered in both modes, unlike everything above it. Fit changes the
		     cell pitch rather than the arrangement, so it does not interfere
		     with dragging and there is no reason to make someone leave arrange
		     mode to reach for it. -->
		<div class="divider" role="separator"></div>
		<button
			type="button"
			class="row-button toggle-row"
			role="menuitemcheckbox"
			aria-checked={fitToView}
			onclick={() => {
				onToggleFit();
				onClose();
			}}
		>
			<span class="row-label">
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
						d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				Fit to view
			</span>
			{#if fitToView}
				<svg
					viewBox="0 0 24 24"
					width="16"
					height="16"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					aria-hidden="true"
				>
					<path d="M5 12.5l4.5 4.5L19 7" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			{/if}
		</button>
	{/if}
</div>

<style>
	.menu {
		position: fixed;
		z-index: 50;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		/* Slightly wider than the original fixed 14rem, to fit the Presets
		   section's rename input alongside its two icon buttons without
		   wrapping. Clamped so it still can't overflow a narrow viewport. */
		width: min(17rem, calc(100vw - 1rem));
		padding: 0.9rem;
		border-radius: var(--radius-md);
	}

	.section-label {
		color: var(--text-muted);
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.add-group {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.add-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
	}

	.add-chip[data-type='audio']:hover {
		border-color: var(--type-audio);
		color: var(--type-audio);
	}
	.add-chip[data-type='comic']:hover {
		border-color: var(--type-comic);
		color: var(--type-comic);
	}
	.add-chip[data-type='text']:hover {
		border-color: var(--type-text);
		color: var(--type-text);
	}
	.add-chip[data-type='game']:hover {
		border-color: var(--type-game);
		color: var(--type-game);
	}
	.add-chip[data-type='art']:hover {
		border-color: var(--type-art);
		color: var(--type-art);
	}
	.add-chip[data-type='any']:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.divider {
		height: 1px;
		background: var(--border);
	}

	.row-button {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		text-align: left;
		padding: 0.3rem 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}

	.row-button svg {
		flex-shrink: 0;
		color: var(--text-muted);
	}

	.row-button:hover svg {
		color: inherit;
	}

	/* The toggle row nests its icon and label together so the check mark can
	   be pushed to the far end by the row's own space-between. */
	.row-label {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.row-button:hover {
		color: var(--accent);
	}

	/* The checked state sits at the far end of the row, so the label stays
	   left-aligned with every other row in the menu whether or not the mark
	   is showing. */
	.toggle-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		width: 100%;
	}

	.toggle-row[aria-checked='true'] {
		color: var(--accent);
	}

	.preset-list {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.preset-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.preset-main {
		flex: 1;
		min-width: 0;
		font-weight: 500;
	}

	.preset-main span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.preset-main:disabled {
		color: var(--text-muted);
		cursor: default;
	}

	.preset-main:disabled:hover {
		color: var(--text-muted);
	}

	.preset-name-input {
		flex: 1;
		min-width: 0;
		padding: 0.25rem 0.45rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
	}

	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.6rem;
		height: 1.6rem;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-muted);
		cursor: pointer;
	}

	.icon-button:hover {
		color: var(--accent);
		background: color-mix(in oklch, var(--accent) 10%, transparent);
	}
</style>
