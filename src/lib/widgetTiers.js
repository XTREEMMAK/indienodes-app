import { embedSnippet, embedFrameSnippet } from '../routes/(app)/widget/embed-snippet.js';
import { MARK_DATA_URI } from '../widget/mark.js';

/**
 * Four independent embeddable artifacts a creator can paste onto their own
 * site (brief section 7a, amended by `tmp/IndieNode_Section7a_Widget_Tiers_Addendum.md`,
 * and again by the widget-iframe-isolation entry in `decisions.md` that
 * added `widget-script`). Not visual variants of one component: `widget` and
 * `widget-script` are two different embeds of the same Prev/Next/Random
 * custom element (a sandboxed iframe and a raw `<script>` tag,
 * respectively), and the other two are plain links this module builds as
 * strings, with no shared runtime between any of them (addendum section 1,
 * "every client is disposable").
 *
 * Tier choice is purely a display preference. Nothing here writes to
 * `ring.json`, the submission payload, or anything the backend sees: a
 * creator's choice only decides which snippet this app hands them (or, for
 * a generator-built site, which markup gets embedded in the export), never
 * anything about the entry's own visibility, rotation, or placement
 * (addendum section 3, mirroring brief section 3's "money never changes
 * what surfaces").
 */

/** @typedef {'widget' | 'widget-script' | 'badge' | 'text-link'} WidgetTierId */

/** @type {{ id: WidgetTierId, label: string, description: string }[]} */
export const WIDGET_TIERS = [
	{
		id: 'widget',
		label: 'Full widget',
		description: 'Prev / Next / Random, in a sandboxed frame with no access to your page.'
	},
	{
		id: 'widget-script',
		label: 'Full widget (advanced)',
		description:
			"The same widget as a script tag instead of a frame. Runs with your page's own JavaScript privileges — most sites want the version above."
	},
	{
		id: 'badge',
		label: 'Badge',
		description: 'A small 88×31 image, the traditional webring size. Click goes to a random member.'
	},
	{
		id: 'text-link',
		label: 'Text link',
		description: 'A plain line of text, no image. For footer space too thin for even a badge.'
	}
];

/**
 * `typesOnly`, when present, would restrict a style to a subset of
 * `ring.json` entry types. The addendum itself (section 5) only resolves
 * type-coded for audio (blue) and games (green), deferring comic/text on
 * the grounds that brief section 9 left those two colors open — but that
 * was stale by the time this was built: `src/app.css`'s comic (`#a855f7`)
 * and text (`#f59e0b`) tokens are already locked (see "LOCKED: All four
 * type colors" above), not placeholders, so all four types get a real,
 * settled color and none of them need `typesOnly` to exclude anything.
 */

/** @type {{ id: string, label: string, description: string, typesOnly?: string[] }[]} */
export const BADGE_STYLES = [
	{
		id: 'classic',
		label: 'Classic',
		description: 'The official IndieNodes logo on a dark ground.'
	},
	{
		id: 'minimal',
		label: 'Minimal',
		description: 'Official logo only, no text. The smallest visual weight.'
	},
	{
		id: 'type-coded',
		label: 'Type-coded',
		description: "Tinted with your node's own content-type color."
	},
	{
		id: 'mono',
		label: 'Mono',
		description: 'The official logo with an adaptive frame and wordmark for unusual sites.'
	}
];

/**
 * @param {string} entryType
 * @returns {typeof BADGE_STYLES}
 */
export function badgeStylesFor(entryType) {
	return BADGE_STYLES.filter((style) => !style.typesOnly || style.typesOnly.includes(entryType));
}

/**
 * @param {string} style
 * @param {string} entryType
 * @returns {string} path under `static/badges/`
 */
export function badgeAssetPath(style, entryType) {
	const file = style === 'type-coded' ? `type-coded-${entryType}.svg` : `${style}.svg`;
	return `/badges/${file}`;
}

/**
 * Where every badge and text-link click goes. A real page on this site
 * rather than an inline script: the text-link tier's own markup is not
 * allowed to carry a script at all (addendum section 2.3, "no script beyond
 * the link target itself"), so the redirect has to be reachable purely by
 * URL for both lighter tiers to share one mechanism instead of two.
 * @param {string} origin
 */
export function randomRedirectUrl(origin) {
	return `${origin}/go/random`;
}

/**
 * A still of the full widget, for the live preview only (both the `widget`
 * and `widget-script` tiers use it — see `embedHtmlFor`'s two shapes below).
 *
 * The real embeds are a `type="module"` script (`widget-script`) or a
 * cross-origin iframe (`widget`), and the preview itself renders into a
 * `srcdoc` iframe sandboxed without `allow-same-origin`. A module script is
 * always fetched in CORS mode, and from an opaque origin that is a request
 * the preview cannot reliably make. Nesting the real iframe tier inside that
 * same sandboxed preview is not obviously safer or more reliable — a
 * sandboxed ancestor forces its own restrictions onto anything nested inside
 * it, in ways not worth relying on for a preview whose only job is showing
 * what the embed will look like, not proving the mechanism works. So both
 * tiers get the same static stand-in, and the badge and text tiers (an
 * `<img>` and an `<a>`, no CORS or nesting involved) render normally.
 *
 * The preview's job is to show what the page will look like, not to be a
 * second running copy of the widget. `embedHtmlFor` still produces the real
 * script for the export, so what a creator downloads is unchanged and the
 * widget on their live site is the real one.
 *
 * Static markup rather than a rasterized or SVG picture: this inherits the
 * viewer's own light/dark preference the way the real widget does, keeps its
 * text as text at any zoom, and needs no second asset to fetch or keep in
 * step. It reuses `MARK_DATA_URI`, so the logo is not a copy of the logo —
 * it is the same bytes the widget itself draws.
 *
 * The buttons are inert on purpose. A preview that navigated the ring would
 * be lying about what a still is, and it sits inside a sandbox that should
 * not be running someone else's ring anyway.
 * @param {string} label What the widget says under its controls.
 * @returns {string}
 */
export function widgetPreviewHtml(label = 'A live Prev / Random / Next widget') {
	return `<div class="indienodes-widget-preview" role="img" aria-label="Preview of the IndieNodes ring widget">
	<span class="inw-brand"><img src="${MARK_DATA_URI}" width="22" height="22" alt="" /><span class="inw-wordmark">IndieNodes</span></span>
	<span class="inw-controls"><span class="inw-btn">&larr; Prev</span><span class="inw-btn">Random</span><span class="inw-btn">Next &rarr;</span></span>
	<span class="inw-note">${label}</span>
</div>
<style>
.indienodes-widget-preview {
	--inw-bg: #fdfcf9; --inw-border: #ddd6c8; --inw-text: #221f1a;
	--inw-muted: #6b6558; --inw-control: #f7f4ee;
	box-sizing: border-box; display: block; max-width: 15rem;
	padding: 0.7rem 0.8rem; border: 1px solid var(--inw-border);
	border-radius: 0.7rem; background: var(--inw-bg); color: var(--inw-text);
	font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
	font-size: 1rem; line-height: 1.4; text-align: left;
}
@media (prefers-color-scheme: dark) {
	.indienodes-widget-preview {
		--inw-bg: #1a1712; --inw-border: #3a362b; --inw-text: #f2ede2;
		--inw-muted: #b3a996; --inw-control: #221f1a;
	}
}
.indienodes-widget-preview * { box-sizing: border-box; }
.inw-brand { display: flex; align-items: center; justify-content: center; gap: 0.45rem; }
.inw-wordmark { font-weight: 700; font-size: 1.05rem; letter-spacing: 0.01em; }
.inw-controls { display: flex; gap: 0.35rem; margin-top: 0.55rem; }
.inw-btn {
	flex: 1; padding: 0.3rem 0.1rem; border: 1px solid var(--inw-border);
	border-radius: 0.4rem; background: var(--inw-control); color: var(--inw-text);
	font-size: 0.8rem; text-align: center; white-space: nowrap;
}
.inw-note { display: block; margin-top: 0.5rem; font-size: 0.72rem; color: var(--inw-muted); text-align: center; }
</style>`;
}

/**
 * The copy-paste markup for a given tier. Mirrors `embedFrameSnippet`/
 * `embedSnippet` for the `widget`/`widget-script` tiers exactly (the same
 * functions, so a tier switch is never a second, slightly different
 * implementation of what those already do).
 * @param {{
 *   tier: WidgetTierId,
 *   badgeStyle?: string,
 *   origin: string,
 *   siteId?: string,
 *   entryType: string
 * }} options
 * @returns {string}
 */
export function embedHtmlFor({ tier, badgeStyle, origin, siteId, entryType }) {
	if (tier === 'widget') return embedFrameSnippet(origin, siteId);
	if (tier === 'widget-script') return embedSnippet(origin, siteId);

	const href = randomRedirectUrl(origin);

	if (tier === 'text-link') {
		// A fixed phrase, not freely editable, so the ring stays recognizable
		// across every member site that carries it (addendum section 2.3).
		return `<a href="${href}" target="_blank" rel="noopener noreferrer">&lt;&lt; Member of IndieNodes &gt;&gt;</a>`;
	}

	const style = badgeStylesFor(entryType).some((s) => s.id === badgeStyle) ? badgeStyle : 'classic';
	const src = `${origin}${badgeAssetPath(/** @type {string} */ (style), entryType)}`;
	return `<a href="${href}" target="_blank" rel="noopener noreferrer"><img src="${src}" width="88" height="31" alt="Member of IndieNodes" /></a>`;
}
