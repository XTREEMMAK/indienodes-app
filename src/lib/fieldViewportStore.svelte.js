/**
 * The field grid's live column count -- how many columns actually fit the
 * screen right now, already respecting Fit to view's cap on it.
 *
 * Shared because "Align form" is reachable from two right-click menus: the
 * field page's own (desktop) and the app shell's mobile "Arrange" trigger,
 * which sits in the layout rather than the page and so has no reference to
 * the page's FieldGrid instance to read this off of directly. FieldGrid
 * writes it on every change; `layoutStore.alignForm` reads it so both
 * callers align against what is actually on screen rather than the fixed
 * authored width, which is only ever correct by coincidence.
 *
 * Deliberately not persisted: it is a live measurement, not a preference,
 * and starts at 0 (read as "unknown yet, fall back to the authored width")
 * before the field has mounted and measured itself even once.
 */
function createFieldViewportStore() {
	let columns = $state(0);

	return {
		get columns() {
			return columns;
		},
		/** @param {number} value */
		setColumns(value) {
			columns = value;
		}
	};
}

export const fieldViewportStore = createFieldViewportStore();
