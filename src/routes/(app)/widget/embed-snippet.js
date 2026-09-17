// Kept out of +page.svelte on purpose: a literal `<script>...</script>` tag
// pair inside a .svelte file's own <script> block confuses Svelte's
// single-file-component parser, which scans for those tags the same way an
// HTML parser does, regardless of them being inside a JS string. A plain .js
// file has no such constraint.

/**
 * `site-id` is included in the snippet rather than left for the member to
 * discover: it is what makes Previous and Next resolve to *that member's*
 * actual neighbours in the ring instead of an arbitrary starting point, and
 * a snippet that quietly omits it would leave every embed slightly wrong in
 * a way nobody would think to look for. Shown with a placeholder value so it
 * reads as something to fill in.
 * The versioned URL is what gets handed out, not the bare `/embed.js`. A
 * member pastes this once and then never thinks about it again, so pinning
 * them to a major version is what lets this project ship a breaking change
 * later without silently altering something on their site. `/embed.js` still
 * exists and still tracks latest, for anyone who wants that on purpose.
 * @param {string} origin
 * @param {string} [siteId] the member's own ring.json `id`
 * @returns {string}
 */
export function embedSnippet(origin, siteId = 'your-ring-entry-id') {
	return `<script type="module" src="${origin}/embed.v1.js"></script>\n<indienode-widget site-id="${siteId}"></indienode-widget>`;
}

/**
 * The sandboxed-iframe embed: the default, recommended interactive tier
 * (`WIDGET_TIERS`'s `widget` id), in front of `embedSnippet` above as the
 * `widget-script` advanced/compatibility option. See
 * `src/routes/embed-frame/+page.svelte` and `docs/decisions.md`'s
 * widget-iframe-isolation entry for why: a `<script>` tag runs with the
 * embedding page's own JavaScript authority, where this iframe's sandbox
 * forces an opaque origin regardless of which URL served it, unable to
 * touch that page's cookies, storage, or DOM at all.
 *
 * `site-id` travels as a query parameter rather than an element attribute,
 * since `/embed-frame` reads it from its own document's URL rather than
 * from anything a host page sets on the iframe element after the fact.
 *
 * No `allow-same-origin` in the sandbox list -- that is the isolation
 * property itself, not an oversight. `allow-popups` plus
 * `allow-popups-to-escape-sandbox` are what let Prev/Next/Random still open
 * a member's site in a real, unsandboxed new tab; without the second flag
 * the popup would inherit this frame's own sandbox restrictions.
 * @param {string} origin
 * @param {string} [siteId] the member's own ring.json `id`
 * @returns {string}
 */
export function embedFrameSnippet(origin, siteId = 'your-ring-entry-id') {
	const src = `${origin}/embed-frame?site-id=${encodeURIComponent(siteId)}`;
	return `<iframe src="${src}" title="IndieNodes webring" width="260" height="150" style="border:0;" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" loading="lazy"></iframe>`;
}
