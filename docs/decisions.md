# Build decisions

Decisions made while building that were not fully specified by the brief or the bootstrap prompt, recorded using the brief's LOCKED / PENDING convention. LOCKED here means "settled for this codebase," not "unchangeable"; it just should not be relitigated without a reason.

## Resource resolution (bootstrap prompt section 1.5)

Checked the local filesystem before reaching for the network, as instructed. Results:

- `IndieNode_v2_Brief.md`: found at the repository root, as expected.
- GG Requestz (source of the ambient background): found locally at a sibling checkout, `../ggrequestz`. Used `src/components/AmbientBackground.svelte`, `src/routes/profile/+page.svelte` (for the preference-wiring pattern only), and the `.theme-glass` rules in `src/app.css` for the glass chrome tuning.
- KeyJayOnline_v2 (possible source of the comic viewer): found locally at a sibling checkout, `../keyjayonline.com_v2`. Its `ContentViewerModal.svelte` was located and read for the reuse evaluation, but **not ported yet**. See `open-questions.md`; the bootstrap prompt asks for a report and a go-ahead before committing to reuse it.

Nothing was pulled from the network for source code. The GPL-3.0-or-later license text in `LICENSE` was fetched from `gnu.org` (the canonical source for that text), which is the one deliberate network fetch in phase 0.

## LOCKED: Type checking via JSDoc, not TypeScript

The bootstrap prompt's file scaffold lists plain `.js` files (`theme.js`, `preferences.js`, `ring.js`) rather than `.ts`, and the sibling projects consulted (GG Requestz, KeyJayOnline_v2) follow the same pattern. `sv create` was run with `--types jsdoc`, which type-checks via `svelte-check` against JSDoc annotations without a TypeScript build step.

## LOCKED: Type faces

- Display: Newsreader (variable), for headings and titles.
- Body: Karla (variable), for everything else.

Both self-hosted via `@fontsource-variable/*` packages (bundled at build time, not loaded from a font CDN at runtime, per the no-third-party-origin rule). Chosen deliberately over the more generic Inter-and-a-serif pairing, but kept quiet rather than expressive, per the brief's instruction that entry content should carry the personality, not the chrome.

## LOCKED: Ambient background palette

The GG Requestz source is an ember-and-gold palette built for a dark-only game library. Repaletted here as a warm ember, gold, and cool blue set that works in both a light and a dark variant, driven entirely by CSS custom properties (`--ambient-*` tokens in `app.css`) rather than hardcoded colors in the component, so retuning the palette later is a token edit, not a component edit.

Canvas particle colors are read once from computed CSS custom properties at mount time, since a `<canvas>` fill color cannot reference `var()` directly. They do not live-update if the theme changes while the background is already mounted; the blobs and base gradient, which are plain CSS, do update live. Considered acceptable for a decorative, opt-in, off-by-default effect; revisit if it turns out to look wrong on a fast theme toggle.

## LOCKED: `ring.json` served via a symlink

The bootstrap prompt's scaffold places `ring.json` at the repository root (source-of-truth, versioned with the rest of the repo), but a SvelteKit static build serves files from `static/`. Rather than duplicating the file or adding a copy step to the build, `static/ring.json` is a symlink to `../ring.json`, so there is exactly one file on disk and it is servable at `/ring.json` in both dev and the production build.

## LOCKED: `_placeholder` as a real schema field

The seed data needed to be "plainly marked as placeholders in the file" (bootstrap prompt section 5.3), but the schema also sets `additionalProperties: false`. Rather than smuggling placeholder status into the `id` or `creator` strings only, `_placeholder` is a documented optional boolean in `schema/ring.schema.json`. A real submission should omit it; the validator does not currently reject it if present and `true`, since the schema treats it as informational rather than a moderation gate. Whether the publishing pipeline should reject `_placeholder: true` entries outright is open; see `open-questions.md`.

## LOCKED: Widget is a standalone custom element, not a SvelteKit route

This resolves the "widget layout isolation" question flagged in phase 0. The embeddable widget (`src/widget/Widget.svelte`) compiles to a `<indienode-widget>` custom element with an open shadow root, via Svelte's `customElement` compiler option. It is built by a separate Vite config (`vite.widget.config.js`, library mode) into `static/embed.js`, entirely outside the main SvelteKit app: no `$app/*` imports, no access to this app's theme or preferences, no shared CSS with `app.css`.

This was the more direct reading of the bootstrap prompt's own instructions: "must degrade gracefully inside someone else's stylesheet, so scope its CSS tightly" only makes sense if the widget's markup sits directly in the host page's DOM (an iframe would not need CSS scoping at all, since it is already fully isolated). A shadow root gives that same isolation without a hand-rolled CSS reset or a class-prefixing convention: the host page's styles cannot reach in, and the widget's styles cannot leak out, by construction. `src/routes/widget/+page.svelte` is a demo and embed-snippet page, not the widget itself; it loads the built `/embed.js` client-side with a plain `document.createElement('script')` (not a dynamic `import()`, which the SSR build tries to resolve statically and fails on, since `/embed.js` is a runtime static asset, not a module in this project's graph) and renders the real custom element, so what a visitor sees there is exactly what a site owner would get from pasting the snippet.

## LOCKED: About is a modal, not a route

`/about` was a full page in phase 0; it is now `AboutModal`, opened from the nav (and from an inline link on the home page) via a small shared open/close store (`src/lib/aboutModalStore.svelte.js`) so either trigger can open the same instance, which is mounted once at the root layout. No shallow-routing or URL sync was added (no `?about=1` or history entry), so there is currently no direct link to open it; if that turns out to matter, it is a small addition on top of the existing store rather than a rearchitecture.

The underlying `Modal` component (`src/components/Modal.svelte`) is intentionally generic (backdrop, Escape, click-outside, scroll lock, focus-on-open) rather than About-specific, since other modal needs are plausible later (the brief's reader and field view both involve overlay-like interactions).

## LOCKED: Dark mode is blue-leaning, not brown-leaning

The original dark palette (background, borders, muted text, accent, and the ambient background's gradient/blobs/particles) was warm: brown-black surfaces, an ember accent, amber-dominant ambient blobs. Retuned to a blue-slate base (background, elevated surfaces, borders, muted/faint text all shifted toward blue-gray) with a blue accent (`#6ea8f0`, replacing the ember `#e08a5f`), and the ambient background's cool blob and particles made more prominent relative to the warm ones. Light mode was left untouched; this was scoped to dark mode specifically.

## LOCKED: Ambient background retuned for perceptibility

Automated verification (headless Chromium, comparing computed blob transforms and full-canvas image hashes over time) confirmed the original animation was running correctly; it was just slow enough (45-55s per blob rotation, sub-pixel-per-frame particle drift) that it could read as static on a quick glance, especially in the areas covered by a blurred glass panel. Particle drift speed and opacity-breathing speed both roughly doubled, and blob rotation periods roughly halved (down to 16-26s). Still slow and ambient by design, just unambiguously alive rather than requiring several seconds of attention to confirm.

`npm run dev` and `npm run build` both run `npm run build:widget` first, so `static/embed.js` is always current. It is gitignored (`decisions.md` treats it the same as `/build`: a build artifact of `src/widget/`, not source).

The widget reuses `src/lib/ring.js`'s `loadRing()`, extended to take an optional absolute URL, rather than duplicating the ring-normalization logic. It does not reuse `src/lib/theme.js` or `preferences.js`: the widget has no personalization or theme preference of its own (locked rule), and instead follows `prefers-color-scheme` directly, matching whatever the visitor's OS is set to regardless of what the host page or IndieNodes' own theme setting happen to be.

## LOCKED: Mobile nav is a fixed bottom tab bar, top nav hides below 40rem

Not a squeezed-in hamburger menu: the brief frames this as closer to a mobile app (tap through nodes) than a marketing site, and a fixed bottom bar keeps the primary destinations reachable one-handed. `.nav-desktop` (text links) and `.nav-mobile` (icon + label tab bar) are two separate markup blocks in `+layout.svelte`, toggled by one media query rather than one nav restyled with CSS, since a real tab bar's structure (fixed position, icon-over-label, active-state coloring) is different enough from a text nav that sharing markup would mean fighting the cascade more than it would save.

This also fixed a real bug, not just a preference: at narrow widths the old single top nav (four text links plus the brand and theme toggle in one row) didn't fit and forced ~200px of horizontal overflow on the whole page, which was the reported "content floating left" symptom. Confirmed fixed: `document.documentElement.scrollWidth` now equals `clientWidth` at 553px, where it was 759 vs 553 before.

## LOCKED: Logo is four rounded nodes in the four type colors

Four rounded squares, three full-size and one smaller in the bottom-right corner, filled with `--type-audio`, `--type-game`, `--type-text`, `--type-comic` respectively. Doubles as the favicon (hardcoded hex there, since a favicon loads as a standalone document with no access to the page's CSS custom properties). Ties the mark directly to the type-color system already in the design tokens rather than being an arbitrary icon. The tradeoff noted at the time was that two of the four colors (comic, text) were still PENDING; those are now locked at their original values, so the logo and favicon need no retouching after all.

## LOCKED: All four type colors

Comic and text carried placeholder values through phase 0 and are now confirmed unchanged: audio `#3b82f6`, game `#22c55e`, comic `#a855f7`, text `#f59e0b`. Audio and game were locked by the brief (section 9); comic and text were the brief's own section 12 open question.

Confirmed rather than repicked because they have had a real trial: the field view renders all four as full-card backgrounds in both light and dark themes, and they stay clearly distinguishable at a glance, which is the actual job. The PENDING markers are removed from `src/app.css`, and the favicon's hardcoded hexes now match a locked set rather than provisional values.

Fixed a latent bug while wiring it up: `app.css` had named the games token `--type-games` (plural, matching the brief's "Games" label) while the schema's `type` enum uses singular `"game"`. Any `var(--type-${entry.type})` interpolation for a game entry silently resolved to nothing. Renamed the token to `--type-game` (and `--type-game-soft`) to match the schema's actual values, so every future call site that does `--type-${type}` just works instead of needing its own audio/games lookup table (which is what the standalone widget bundle does instead, since it can't share these tokens at all).

## LOCKED: Field view first pass is a static grid with partial per-type motion, not the full ambient field

Built enough to be real and testable now, with the gaps between this and the brief's fuller description logged in `open-questions.md` rather than silently treated as done: a CSS grid of up to `MAX_VISIBLE_NODES` (6, matching the brief's prototype) nodes loaded from `ring.json` via a `+page.js` load function (so it prerenders like everything else, no runtime fetch), each with a heart toggle backed by a new `favoritesStore` (localStorage, mirrors `preferencesStore`'s pattern). Per-type motion is partial: audio gets a pulsing bar visualization, comic gets a slow background-image zoom when a page image is present, text and game stay static (game deliberately, per the brief's "static screenshot by default" rule). Not built yet: the slot-rotation behavior, and tap-to-open-reader (see `open-questions.md`).

Superseded in part by the two decisions below: rotation, a 4x4 desktop grid, and node styling all changed substantially in a later round. Left in place as the record of what phase 0 actually shipped.

## LOCKED: FieldNode is a square card, colored by type, with an optional cover image

Redesigned from the original rectangular card: `.node` is `aspect-ratio: 1/1`, background is a `color-mix(in oklch, ...)` wash of the entry's own type color (not just a colored badge on an otherwise neutral card), and the type badge sits on a light `--bg-elevated` chip for contrast against that color regardless of theme. When the entry has a usable image (a comic's first page, a game's `thumb_url`), it fills the card as a cover photo instead of the color wash, with a scrim gradient (type-color tint fading to dark) behind the text so it stays readable over any photo. Visit is a real button, not a bare link.

Title/creator/why text opts out of the page's own type scale (`--text-lg`/`--text-base`) in favor of small fixed sizes with hard line-clamps (title and why to 2 lines, creator to 1 with ellipsis). This was not optional polish: at the card sizes this grid actually produces on common desktop widths, using the page's normal type scale caused the Visit button to be pushed below the card's visible, `overflow: hidden` edge whenever a title happened to wrap to 2 lines. Verified empirically (Playwright, comparing each card's rendered height against its Visit button's position) across viewport widths from 700px to 1920px after tuning, not just eyeballed at one size.

## LOCKED: Content cycling rotates the whole visible window on a shared timer, with a desktop progress bar

`src/routes/+page.svelte` rotates all `MAX_VISIBLE_NODES` at once to the next window of the filtered pool every `ROTATION_INTERVAL_MS`, rather than the brief's "one slot rotates in a new entry" (see `open-questions.md`), per explicit direction this session: a single progress bar filling toward one shared "round" transition, with the incoming set animating in sequentially (`in:flyFade`, staggered by index) once it lands. The bar itself is desktop-only (hidden below the 40rem mobile-nav breakpoint, `+layout.svelte`), fixed to the bottom of the viewport.

Rotation pauses (timer stopped, remaining time preserved rather than reset) while the pointer is over any node, while keyboard focus is inside the field, or while the tab isn't visible, and resumes from where it left off rather than restarting the round. This was an explicit requirement, not a nice-to-have: cycling must never carry a node away out from under someone actually looking at or interacting with it. Implementation note for future changes to this effect: the `$effect` that resets rotation when the filtered pool changes wraps its state writes in `untrack()`, because without it, reading `isHovering`/`hasFocusWithin`/`isPageVisible`/`canRotate` inside `syncPauseState()` (called from that effect) makes the effect a dependent of all of them too, so it would silently reset the rotation position on every hover or focus change instead of only when the pool actually changes. Caught via Playwright, not by inspection.

The desktop field grid also moved from `auto-fill`/`minmax` (which capped out around 3-4 columns inside a 72rem container regardless of screen width) to an explicit 4-column step at a 78rem breakpoint inside a 120rem container, so a 4x4 grid (`MAX_VISIBLE_NODES` raised from 6 to 16) reads as genuinely large cards on a real desktop display rather than shrinking to fit the old cap. The breakpoint is 78rem rather than the more obvious 64rem specifically because 64rem was measured to produce ~220px cards, too narrow for a 2-line title without reintroducing the overflow bug above.

Filters (`filtersStore.svelte.js`, by `type` and by `tags`) narrow the pool the field view draws from, surfaced as a "Content" tab in a new tabbed Settings page (alongside the existing Theme/Background controls under an "Appearance" tab). This is deliberately not a filter control inside the field view itself: the brief (section 7c) is explicit that a filter control there turns the field back into a directory. The Settings tabs reuse the same tab-pop fix as `AboutModal` (`outFade` + a `position: relative` container holding a fixed `min-height`), rather than reintroducing that bug fresh in a second tabbed UI.

## LOCKED: Two-column field grid, sized by container width

Moved from a fixed 4-column grid of up to 16 nodes to 2 columns of up to 6, back to the brief's section 7c prototype count. The load-bearing part is the container width, not the column count: with square cards, the grid's `max-width` is what sets card size, so two columns inside the 120rem container the 4-column layout used would have inflated each card to roughly 900px. At 52rem they land near 400px, which is about where the 4-column cards already sat and what was approved as "good sizing." A single column stays in place below the 40rem mobile-nav breakpoint.

`max-width` and `MAX_VISIBLE_NODES` in `src/routes/+page.svelte` are the two knobs if this ever needs retuning; nothing else depends on the column count.

## LOCKED: Rotation is per-node, on independent jittered timers

Replaces the single global timer that swapped every visible node at once. Each slot (`src/components/FieldSlot.svelte`) owns its own countdown, jittered per cycle and staggered on its first, so slots drift apart rather than moving in lockstep. The parent (`src/routes/+page.svelte`) owns only _which_ entry each slot shows, including skipping entries already on screen so nothing appears twice.

Three reasons, in order of weight:

1. It is what the brief actually described (section 7c: "one slot rotating in a new entry every few seconds"). The global timer was a deviation, adopted mid-session for a shared progress bar.
2. It is calmer. A whole-field swap is the least ambient thing the field view could do.
3. It fixes the real network burst. One global timer meant every visible card requested its cover image in the same instant, up to 16 at once. Independent timers spread that out by construction, which is why the preloader's concurrency cap is a backstop rather than the main defense.

**The shared bottom progress bar was removed as a direct consequence**, replaced by a thin per-card fill. A single bar cannot represent six independent countdowns, so keeping it would have meant showing a number that was true of nothing. Pausing is per-slot too: a slot holds while the pointer is over it or focus is inside it, so rotation never pulls content away from the one node someone is actually engaging with, while the other five keep going. Page visibility is the exception and stays global, with one listener in the parent rather than one per slot.

Implementation note carried forward: the `$effect` that reseeds slots when the filter pool changes wraps its writes in `untrack()`. Without it, the reads inside the helpers it calls make the effect a dependent of its own writes, so it re-runs on every single slot rotation and resets the whole field. This is the second time that exact trap has come up here.

## LOCKED: Field browse nodes mirror one primary in-app action across their passive surface

The Field now treats the non-control area of an Audio, Art, Comic, or Text node as a
convenience target for the same action its labelled control already exposes: play or
queue-preserving preview for Audio, the gallery for Art, and the appropriate reader for
Comic and Text. This is deliberately Field-only. Lists remains a review surface with
explicit controls, Arrange mode reserves the card as a drag surface, and Game keeps its
labelled Trailer and Visit choices rather than turning an incidental card tap into a
third-party embed load or external navigation.

This does not turn the shell into a button containing other buttons or add a duplicate
tab stop. A delegated handler covers the passive surface and filters every nested
control; the existing labelled Play, Read, or View button remains the keyboard and
assistive-technology route to the same action. Pointer activation is accepted only for a
primary pointer that stays within 10 CSS pixels and does not trigger pointercancel, change any ancestor scroll
position, or leave selected text inside the card. That protects both vertical page
scrolling and the fitted Field's horizontal scrolling from accidental activation.

Cards with this primary action use scale: 1.01 plus an internal border highlight on
fine-pointer hover/focus. The scale initially exposed Gridstack's more-specific
hidden/auto overflow rule, so the Field now explicitly lets the item-content wrapper
paint overflow and raises the active grid item's stacking order above its neighbours.
The node itself still clips its internal artwork to the rounded card. Touch gets no
hover-only scale, Arrange mode has no actionable class, and reduced-motion keeps scale
at one.

## LOCKED: Cover images come from `thumb_url` for every type

`coverImageUrl()` in `src/lib/ring.js` is the single place this is decided: `thumb_url` first for any type, falling back to a comic's first page.

This fixed a real bug rather than adding a feature. The schema has always declared `thumb_url` at the top level with `allOf` rules that only make it _required_ for `game`, never forbidden elsewhere, and the test fixture already carried real cover art on an audio entry (Bandcamp album art) and a text entry (a site header image). But `FieldNode` read the field only for game entries, so that artwork was silently discarded and both cards rendered as flat color washes. The schema's description had said "Game only.", which is what the code had been written against; the description was corrected to match what the schema actually enforces.

## LOCKED: Image preloading only, with a concurrency cap

`src/lib/imagePreloader.js` warms a slot's next cover image (fetch plus `decode()`) while the current one is still on screen, deduped by URL and capped at 3 concurrent loads.

Deliberately _only_ images. There is no data-prefetch layer because there is nothing to prefetch: `ring.json` is fetched once, in full, by the field view's `+page.js`, so every entry's metadata is already in memory and a node swap costs zero requests for data. The image is the only per-swap network cost _of a field node swap_ — audio has its own, larger one at a track boundary, which the next entry is about. Worth stating plainly because "preload the node data" is the intuitive framing and it would have meant building a caching layer for a problem that does not exist. The scaling question this does raise (fetching the whole ring at production size) is logged in `open-questions.md`.

## Decided: no next-track audio buffering yet, and why that is not the same as "never"

Nothing is warmed ahead of a track change. One `<audio preload="metadata">` serves the whole queue, and `loadTrack()` in `AudioPlayer.svelte` assigns `el.src` — that assignment is the moment the fetch starts. `handleTrackEnded` advances the store, the effect calls `loadTrack`, and only then does the browser go looking for the next file. Every boundary is a cold start, on media a creator hosts themselves, often at a different origin needing fresh DNS and TLS. The gap is real and it was correctly identified.

It is still not worth closing yet, for four reasons that compound.

**The ring is a sampler, not a record.** `schema/ring.schema.json` caps `tracks` at three, in its own words "so the ring stays a sampler, not a full catalog host." Consecutive queue items are therefore usually two different creators rather than two movements of one work. Gapless playback is a property continuous material needs; a short breath between two unrelated creators is not obviously a defect, and is arguably the honest punctuation for what is actually happening.

**Whether the queue gets used at all is already an open question.** `open-questions.md` records the watch-item verbatim: if most audio entries end up link-only, "the queue, finish detection, and the reactive background become features almost nothing in the ring can use." A link-only audio member — listed and linked but not playable in-app — is a supported shape, not a degraded one. Building a refinement onto a feature whose usage is explicitly unproven is speculative in the specific way this project tries to avoid.

**There is nothing to measure, yet.** `members/` held no files when this reasoning was first written; it now holds two, one of which (`audio-key-jay`) has three real playable tracks. That is not the population this argument needs: one audio member on one host is not "representative hosts," so the stall still cannot be timed against the range of CORS behaviour that actually determines whether gapless is achievable, and a fix still cannot be shown to have worked. This remains decisive for the same reason as before, with a narrower gap left to close: optimising a latency that has not yet been observed across more than one real host, on a result that would still be unfalsifiable.

**True gapless is not uniformly possible here, and the ceiling is not effort.** Sample-accurate handoff needs Web Audio scheduling, which needs decodable audio. Tracks from hosts that refuse CORS still play, but only because `handleMediaError` learns the refusal and reloads without the attribute — and a non-CORS `MediaElementAudioSourceNode` outputs zeros, so those tracks cannot be decoded at all. The achievable result is gapless on some hosts and not others, which is worse than a consistent short pause: inconsistent behaviour reads as a bug where uniform behaviour reads as a property.

**What flips this.** Two things together, not either alone: audio members with playable `media_url` tracks actually exist in the ring, _and_ a measured boundary stall against representative hosts is long enough to hear. Both are checkable against a populated `ring.json` without re-deriving any of the above.

**The cheap version, recorded so it is not reinvented under pressure.** If the trigger fires, the first thing to build is not gapless. It is a hidden second `<audio preload="auto">` holding the next queue item's URL, which never plays and is never connected to the audio graph — it exists only to warm the HTTP cache so the real element's later `src` assignment hits it. That is cheap precisely because it touches none of the delicate parts: no `ensureAnalysis` changes, no second `MediaElementAudioSourceNode`, no mirroring of the `corsDenied` learning, no change to which element is audible. What it costs is bytes fetched from creators' own hosts for tracks a visitor may well skip — which is the same instinct that made `preload="metadata"` the original choice, so the trade is a real one to make deliberately rather than a free win.

## LOCKED: Per-type visuals live in registered skin stages

`src/components/FieldNode.svelte` is the application-owned shell: frame, type color, cover image and scrim, badge, curation controls, creator text, Visit, playback and reader actions, and progress. The selected Node Skin supplies only the visual stage layered inside that shell.

Basic Nodes owns the original four stages under `src/skins/node/basic/stages/`. `src/skins/registry.js` discovers skin manifests and resolves the active stage through one uniform prop contract. A partial skin falls back to Basic Nodes for every type it does not implement.

The host passes controlled services for image preloading, user-triggered sound, and application actions. Skin code does not import stores directly. That boundary keeps accessibility, navigation, playback policy, and persistent state stable while allowing a skin to implement its own cassette, comic book, console, book, animation, and interaction treatment. See `skin-authoring.md` for the contract.

## LOCKED: You tune a channel, you do not pick the song

The resolution to the guardrail tension logged in `open-questions.md`, and the principle the whole arrangeable-field design now rests on.

The brief forbids a filter or search control inside the ambient field view (section 11) because the point of that surface is removing choice. An arrangeable field with per-node type pinning looked like it violated that. The distinction that resolves it: **configuring a node is defining a channel, choosing its content would be picking an item.** Placing a node that only pulls hip-hop is tuning a station. Picking which hip-hop entry appears in it is the thing that would turn the field back into a directory, and it stays impossible.

Concretely, what a visitor can and cannot do:

- **Can:** place a node, size it, pin it to a type, and narrow it by tag ("this is my VGM slot", "this one is comics").
- **Cannot:** choose which entry appears, pin an entry in place, reorder what comes next, or see a list of what is available to pick from.

Serendipity survives because the visitor never knows which entry surfaces next; they have only shaped the pool it comes from. Two further mitigations hold the line: layout editing lives behind an explicit edit mode that is off by default, so the resting state is still an idle surface, and configuration is a one-time setup rather than an ongoing decision the field keeps asking about.

## LOCKED: Node configuration replaces global content filters

Content filtering moves from one global setting to per-node configuration. A node carries its own type and tag constraints, so "a hip-hop music node next to a VGM music node" is expressible, which the global filter could never do.

The global `filtersStore` and the Settings > Content tab were **superseded, not yet removed** — they were to stay until per-node config existed and then come out. **That half was reversed once per-node tags were actually built; see the next section.** The type half of this decision stands: a node declares its own type and there is no global type filter.

Rejected alternatives, and why:

- **Global as a hard exclusion, nodes narrowing within it.** Creates a dead state with no good explanation: a node configured for content the global filter excludes just sits empty forever, and the fix is in a different part of the app than the symptom.
- **Global as defaults for new nodes.** No conflict case, but the setting stops describing anything you can currently see, which makes it a confusing thing to leave in Settings.

## A `$props()` destructure with no defaults breaks the production build

Recorded because it passes `npm run check`, `npm run lint`, and the dev
server, and fails only `npm run build` — with a parse error pointing at a
line number in compiled output that does not exist in the source.

Svelte attaches the JSDoc above a props destructure to whatever it emits
next. A destructure carrying at least one default emits a real declaration
(`let label = $.prop(...)`) for the comment to land on. One with **no**
defaults emits none, so in a small component the comment falls through onto
a generated template variable and becomes a JSDoc cast — `/** ... */ (` —
which rolldown refuses to parse.

So: **give at least one prop a default**, even an explicit `= undefined`,
whenever the destructure is preceded by a `/** @type */`. `TypeIcon.svelte`
carries the note at the site of the fix. This is the concrete mechanism
behind the vaguer warning `NodeConfig.svelte` has carried for a while about
block comments being "hoisted into a `var` declaration"; the comment shape
was never the trigger, the missing declaration was.

## Resize grips are positioned against the grid item, not the card

Two independent offsets had to be reconciled before the arrange-mode grips
would sit on the card at every node size, and each looked like the whole
problem on its own:

- **The card did not fill its own cell.** `FieldNode` applied `height: 100%`
  and `aspect-ratio` together inside the grid. Those disagree: a node
  spanning `w` by `h` cells is `w*cell + (w-1)*gap` wide but only
  `h*cell + (h-1)*gap` tall, which is not the `w/h` the ratio asks for, so
  the card came up fractionally short by an error that **grows with the
  span**. That is what made a grip look right on a small node and visibly
  off on a large one. The grid now clears `aspect-ratio` on a ready grid;
  `FieldNode` keeps it for the pre-hydration flow layout and for Lists,
  neither of which has a cell to fill.
- **Gridstack positions handles against the item, while the card is inset by
  the grid's own margin.** A grip inset measured from the item alone lands
  outside the card by exactly that margin. `GRID_MARGIN_PX` is now the one
  source for both the grid option and the CSS (`--grid-margin`), and the
  grip inset is `calc(var(--grid-margin) + 0.3rem)`.

Corner grips are drawn as a rounded L rather than filled squares: an L names
which corner it is and implies two axes at once, where the edge bars each
imply one. Keep the elbow radius well under half the box, or the two strokes
lose their straight runs and the mark reads as an arc.

## LOCKED: Two tag layers, and the empty node that explains them

Per-node tags are built, and the global tag filter **stayed**. This reverses
the removal half of the decision above, which had ruled out exactly this
shape ("global as a hard exclusion, nodes narrowing within it") on one
specific objection: a node configured for content the global filter excludes
"just sits empty forever, and the fix is in a different part of the app than
the symptom."

The objection was right about the failure and wrong that it was structural.
Both halves of it are addressable, and are addressed:

- **"Sits empty forever."** `shortageCause()` in `src/routes/+page.svelte`
  now walks the layers in the order they narrow and returns the _first_ one
  that emptied the pool, so `global-tags-empty` is a distinguishable state
  rather than an indistinguishable blank. It fires only when the node's own
  configuration is genuinely satisfiable — there really is content of that
  type with those tags — and the global preference is what removed it.
- **"The fix is in a different part of the app than the symptom."** So the
  symptom names the fix. `EmptyNode` renders that cause as "There is _art_
  tagged _pixel_, but your global tag preference leaves it out," with a link
  to Settings. A pointer to the responsible control is the thing whose
  absence made the dead state fatal.

Why keep the layer at all, rather than take the simpler route the original
decision assumed: the two answer different questions and neither substitutes
for the other. The global filter is a standing preference that applies
wherever entries are drawn — "not horror, anywhere" — and holds for nodes
that do not exist yet. A node's tags shape one channel inside whatever that
leaves. Folding the global layer into per-node tags would mean re-expressing
one preference once per node and re-applying it by hand to every node added
afterwards, which is not the same capability in a more distributed form; it
is a worse version of a different one. An empty selection at either layer
adds no restriction, so the common case — nothing set anywhere — is still
the whole ring.

Two supporting rules keep the dead state rare rather than merely legible:

- **The per-node picker only offers tags entries of that node's type
  actually carry** (`tagsForType`). A comic node is never offered a tag only
  audio entries have, so the most obvious way to configure a node into
  nothing is simply not reachable.
- **Retyping a node prunes tags the new type cannot carry**
  (`pruneTagsForType`) rather than clearing them or keeping them all.
  Switching Any to Audio keeps a genre that still means something; switching
  Audio to Comic drops one that cannot.

**One consequence at the page level, which is easy to get wrong.** The
field's own "nothing to show" state must not fire merely because every node
happens to be empty. It now requires the eligible set itself to be empty;
otherwise the grid renders and each node explains its own case. The
alternative replaces several accurate per-node explanations with one wrong
global one — "no entries match your filters" is false when the filters match
plenty and it is the node configuration that matches none.

`src/lib/nodeChannel.js` owns what a channel means against a ring (the
pure half, tested); `layoutStore` only stores `type` and `tags`; the field
page composes them and memoizes one pool per distinct channel rather than
one per node.

Per-node config also makes the global type filter straightforwardly redundant: "no game content anywhere" is expressed by not placing a game node.

## LOCKED: Aspect ratios are constrained per type

Node resizing snaps to a per-type set of allowed ratios rather than being free-form:

| Type  | Allowed ratios              | Why                                                                                        |
| ----- | --------------------------- | ------------------------------------------------------------------------------------------ |
| Audio | 1:1 only                    | The ornament is a physical object (record player, cassette deck) and reads wrong stretched |
| Game  | 1:1 only                    | Same: a console is an object, not a panel                                                  |
| Comic | 1:1, plus wider (16:9, 3:2) | Cover art and page spreads both work; a wide node can show a spread                        |
| Text  | 1:1, plus wider             | A book or excerpt card tolerates a banner shape                                            |
| Art   | 1:1, plus wider             | Not a schema type yet; listed for when it is                                               |

Free resize with self-adapting ornaments was rejected: it multiplies the work per ornament and invites a record player stretched into a letterbox, which is exactly the failure the ornamental direction is meant to avoid.

Portrait ratios for comics were raised and deliberately left out of this first set, since comic covers are often taller than wide and a 16:9 comic node may crop them awkwardly. Worth revisiting once the comic ornament exists and there is something real to look at.

## LOCKED: gridstack.js for the slot grid, not a hand-rolled one

This reverses the earlier call in this file to hand-roll the drag/resize grid. That call was made on a weak reading of gridstack ("it wants to own the DOM Svelte owns") and the facts do not support it.

What checking actually showed: gridstack 13.x is MIT, has **zero runtime dependencies**, ships its own TypeScript types, and shipped six releases in the month before this decision. The Svelte-specific wrappers are the dead ends, not gridstack itself (`svelte-gridstack` is an abandoned 0.0.2; `svelte-grid` last moved in 2023 and targets Svelte 3/4), but no wrapper is needed.

**The integration seam is gridstack owns geometry, Svelte owns the DOM.** Refined during implementation. The original plan had gridstack create the wrappers with Svelte `mount()`ing a component into each; both shapes were spiked and the simpler one won. Svelte renders the `.grid-stack-item` children itself with `gs-*` attributes, and `GridStack.init()` adopts them in place.

Measured rather than assumed, because the stated objection to this shape was that gridstack would fight keyed `{#each}` reconciliation. It does not: dragging an item across the grid left DOM order completely unchanged (`a,b,c` before and after, with collision reflow working), since gridstack positions absolutely rather than reordering children, and Svelte state inside a dragged item survived untouched. With no conflict to avoid, this needs no `mount()`/`unmount()` bookkeeping, keeps Svelte transitions working on the items, and stays idiomatic.

Two consequences that are easy to trip over, both commented in `FieldGrid.svelte`:

- **After init, writing `gs-x` from Svelte is inert.** gridstack keeps position in its own engine and applies inline styles from there. Anything that changes geometry from the store side rather than by dragging (changing a node's type re-snaps its shape) must call `grid.update()`, or the attribute changes and nothing moves. This was a real bug: a node's cells went to `4x4` while it kept rendering at `925x462`.
- **Nodes Svelte adds after init are invisible to gridstack** until `makeWidget()` is called on them.

The decisive factor is collision detection and reflow. That is the genuinely hard, easy-to-get-subtly-wrong part of a drag grid, and it is the part gridstack has already solved along with serialization (`save()` / `load()` maps almost directly onto the layout store) and responsive column re-mapping.

Three things are still ours to build, so this is not a free win:

- **Per-type aspect ratio locking.** gridstack has per-widget `minW`/`maxW`/`minH`/`maxH` but no ratio constraint, so the allowed-ratio snapping above needs a resize handler.
- **Keyboard move and resize.** gridstack does not provide it, and the field is fully keyboard navigable today, so pointer-only positioning would be a real regression.
- **The edit-mode dot grid**, which is a CSS overlay either way.

Worth stating plainly: this would be the project's **first real runtime dependency** (only `@fontsource-variable/*` qualifies today). It is bundled at build time rather than loaded from a CDN, so it does not violate the no-third-party-origin rule, but it is a genuine change in the dependency posture and the actual bundled weight should be measured at integration time rather than assumed.

## LOCKED: Node cards adapt by container height, not viewport width

`FieldNode` sets `container-type: size` and drops its `why` line below roughly 240px of card height, then its creator line below 160px.

Both parts of that are load-bearing and were arrived at by measurement:

- **Container, not media query.** A node's size now depends on its cell span and the current column count, so two cards at the same viewport width can differ enormously. Only a container query can respond to the card's own size.
- **`size`, not `inline-size`.** The binding constraint is vertical. A 2:1 card at 391x196 has exactly the same room for text as a square 196x196 one, so querying width alone fixed the square cards and left the wide ones overflowing by 23px. This is safe here only because a card's height never depends on its contents: it comes from the grid cell, or from `aspect-ratio` outside the grid.

The `why` line is the right thing to drop first because it is the only part of a card that is commentary rather than identity or action.

## The rolldown parse trap, for the third time

Recorded because it has now cost real time three times and every cheap check misses it.

**Symptom:** `npm run build` fails with `[PARSE_ERROR] Unexpected token` and often names no file, or names a file whose source looks obviously fine. `npm run check`, `npm run lint`, and the Svelte compiler itself all pass, because Svelte's parser accepts the input and only rolldown's does not.

**Cause:** an inline JSDoc type cast, `/** @type {...} */ (expr)`, written inside a **template expression**:

```svelte
onchange={(event) => onTypeChange?.(/** @type {any} */ (event.currentTarget.value))}
```

The identical cast is completely fine inside a `<script>` block, which is what makes it confusing. The fix is to move the handler into the script and cast there.

A related shape to know: when Svelte can optimize a component's `$props()` destructuring away entirely, a comment sitting directly above it gets hoisted between `var` and its identifier in the emitted JS, which rolldown also rejects.

**The lesson that matters:** `npm run build` is not an optional final step in this project. It is the only check that catches this class of error, so it belongs in every verification pass, not just the ones before a release.

## LOCKED: A node always renders, even with nothing to show

`EmptyNode` renders a dashed placeholder when a node has no entry to display, either because its type has nothing in the ring or because every match is already on screen elsewhere.

This is not decoration. A node's controls (type picker, remove) live on the node itself, so rendering nothing when a node had no content made it possible to add a node and then have no way to select or delete it. It also quietly misrepresented the ring as smaller than it is.

## LOCKED: Arrange lives in the header, and edit chrome never floats

Two related fixes to the same mistake.

The Arrange toggle moved from a floating pill over the field into the header, beside the theme toggle (`editModeStore` holds the state, since the toggle and the thing it controls are in different components). It does not belong in the main nav: every nav item changes _where you are_, and this changes _how the app behaves_, which is exactly what the theme toggle next to it does.

The add-node and reset controls moved from a fixed overlay into normal flow above the grid. That was not a taste decision. As a fixed overlay the bar silently covered whatever sat beneath it, including nodes' resize grips: a handle would be visible and correctly positioned while `elementFromPoint` at its centre returned the bar's Reset button, so resizing did nothing in that corner of the field and looked broken. Anything that floats over an interactive canvas will eventually eat a click meant for the canvas.

## LOCKED: 24 columns, and the columnMax trap

The grid runs at 24 columns, not 12. Cells are square, so a 16:9 node needs w/h = 16/9 in whole cells, and the only such size within a sane column count is 16x9, which does not fit in 12 columns at all. At 12 the widest expressible shape was 2:1, so asking for 16:9 quietly produced something else.

**`columnOpts.columnMax` defaults to 12 and silently caps `column`.** Setting `column: 24` alone left `getColumn()` returning 12, which clamped every 16-wide node to 12 and made 16:9 unreachable. This presented as "resize doesn't work" rather than as a configuration error, because the target size simply did not exist. gridstack v13 positions items from a `--gs-column-width` custom property, so an arbitrary column count needs no extra stylesheet.

## LOCKED: Sizes are a menu, and snapping happens on the way to the store

Two changes that together made resizing behave.

`nodeShape.js` lists **explicit allowed sizes** per type rather than a ratio plus a scale multiplier. The multiplier version had to infer a scale from whatever was dragged and then clamp it, which made resizing unpredictable: some drags produced no change, and widening could land on a shape narrower than it started. A fixed menu of sizes is what "snap" should mean, and nearest-by-distance selection makes the result feel like the shape you were reaching for.

Snapping happens in the `change` handler, on the way to the store, **not** in a `resizestop` handler that adjusts gridstack's engine. The latter fought itself: `change` still reported the raw dragged size, the store recorded that unsnapped value, and the store-to-engine sync effect pushed it straight back onto the engine, undoing the snap. The visible symptom was resizing that appeared to do nothing at all. Snapping before the store sees it keeps the store authoritative and leaves the sync effect correcting the engine rather than fighting it.

Resize handles are also on five edges rather than gridstack's default `'se'` alone, and always visible while arranging. The single default handle was both hard to find and sat directly under the node's own configuration bar, which is why that bar moved to the top of the card.

## LOCKED: Shapes are ratio families, not a menu of sizes

`nodeShape.js` constrains a node's **ratio** and lets width follow the pointer, rather than snapping to a list of fixed sizes.

The fixed-size version was wrong in a way that read as a broken control. Six discrete sizes left gaps far larger than a normal drag, so pulling a 16x9 comic to 14x9, 18x9, 20x9, or 16x6 all landed back on 16x9. Every one of those gestures looked like the resize had silently refused to commit, and dragging shorter appeared to do nothing at all.

Ratios per type are now: square only for audio and game; a full ladder from 9:16 through 2:1 for comic, text, and any (9:16, 2:3, 3:4, 1:1, 3:2, 16:9, 2:1).

The ladder runs in both directions on purpose. An earlier version stopped at 1:1 on the tall end, so dragging a comic node taller could only ever snap back down to a square, which is the wrong constraint for the two types that are most often portrait: a comic page and an article are both taller than they are wide. 2:1 exists at the other end so dragging the bottom edge shorter has somewhere to land rather than dead-ending at 16:9.

Height is rounded to whole cells, so a ratio is exact only where it divides evenly (16:9 at w=16). Elsewhere the card is within half a cell of nominal, which is not visually distinguishable at these sizes.

## LOCKED: Cards are layered, and each type presents its own media

`FieldNode` is now four layers back to front: a blurred backdrop, the type's stage, a legibility scrim, then chrome and text. The stage components finally do real work rather than existing purely as seams.

**The backdrop is the card's own cover image, blurred**, not a separate asset or a flat colour. A card then reads as one object instead of a photo pasted onto unrelated wallpaper. Blur, opacity, and scale are custom properties (`--node-backdrop-*`) because "some blur, not too much" is a judgement that wants tuning against real artwork.

Per type, and the reasoning rather than just the rule:

- **Audio** contains the art over its own blur. Cover art is composed as a square with its title near an edge, so filling a wide card crops exactly the part worth seeing.
- **Comic** contains the page, uncropped, with no zoom. A page is composed art whose gutters and borders are part of the work. The scrim is also pushed down to just the band the text occupies (`--node-scrim-clear: 62%`), because a gradient sweeping up through the art is an edit, and the instruction was that comics show their page unedited.
- **Text** fills. A header or social card is already made to be cropped, and letterboxing it would give it a reverence it was not designed for.
- **Game** plays its preview, falling back to the screenshot. See below.

## Game previews autoplay: a deliberate departure from brief section 7b

Recorded prominently because it reverses a rule this codebase has cited repeatedly.

Brief section 7b specifies "static screenshot by default; muted preview loads on explicit tap; controls to unmute are a further explicit action". `GameStage` now autoplays `preview_url` when an entry has one. This was asked for directly and is the owner's call to make, but it is a real reversal rather than an oversight.

Three guarantees keep it inside the rules that were **not** relaxed, and all three are verified:

- **Muted always, with no control to unmute.** Section 11's "nothing autoplays with sound" holds absolutely.
- **Never plays under `prefers-reduced-motion`.** That visitor gets the poster frame, which is exactly the old static behaviour.
- **Only plays while on screen and while the tab is visible** (IntersectionObserver plus the existing visibility signal), so a field of game nodes cannot quietly drain a phone battery or somebody's data on video nobody is looking at.

A failed or refused video falls back to the screenshot rather than showing an error state. Worth revisiting if the field ever holds many game nodes at once, since the guarantees limit the cost but do not remove it.

## LOCKED: Arrange mode hides curation and pockets configuration

While arranging, a node hides its type badge and like toggle, and everything past "this node exists" sits behind a three-dot menu.

Both halves fix something real. The like toggle occupied the card's top-right corner and rendered above the configuration layer, so it sat directly on top of the Remove control and took the click meant for it. And a permanently visible type dropdown plus a Remove button on every card turned a field of artwork into a field of forms, which is a poor trade on a surface whose whole point is showing the work.

Hiding the badge costs nothing, because the menu states the node's type anyway, which is what the badge was there to say. Liking is also not the task during arrange; it is available the moment you leave the mode.

The menu is a sibling of the card rather than a child, so it can extend past a small node instead of being clipped by the card's own `overflow: hidden`.

## LOCKED: One breakpoint, not two; gridstack runs at every width down to 4 columns

Superseded the "gridstack is not used below 640px" design below: the plain-CSS-column flow mode it describes is gone, and gridstack now runs continuously from the authored 24 columns down to 4.

**64rem (1024px) still switches the header to the mobile tab bar**, unchanged from before.

**The narrow breakpoint is gone.** It existed to route around the same 5103px-tall-node bug the column ladder below already had to solve for its own reduced counts: at gridstack's literal one-column mode, `cellHeight: 'auto'` derives a square cell from the full container width, and a node 9 cells tall inherits that width as its height. The breakpoint ladder (see the column-count entry below) already stops at 4 rather than 1 for exactly this reason, and 4 is safe at every phone width in practice, because `MIN_W` in `nodeShape.js` clamps every node to a full-width single column there regardless: the same visual result flow mode gave, without needing a second, parallel system to get it. Removing flow mode deleted the `matchMedia` teardown/rebuild watcher, the `.flow` CSS, and the stylesheet workaround for `.grid-stack-item-content`'s absolute positioning it required (that div's positioning is only a problem when gridstack isn't the one managing it).

- **The stored desktop arrangement still can never be rewritten by a visit on a phone**, now for a different reason than "gridstack isn't running": drag below the authored column count is read as a reorder, not a placement, and `layoutStore.reorderTo()` deliberately never touches `x`/`y`/`w`/`h`. See the reorder entry below.
- **"Move up" / "Move down" are gone.** They existed because the narrow view had no other way to reorder without gridstack running. Dragging now works at every width, including by touch (see below), so those buttons and `layoutStore.move()` were retired rather than kept as a redundant second path.

## LOCKED: Column count is responsive, and only the authored count may be saved

Node size used to be a fixed share of the viewport at every width: 24 columns everywhere meant an 8-cell node was always 32% wide, which reads well at 1600px (516px) and badly at 700px (216px). The column count now steps down on smaller screens (12, 15, 18, 21, 24), so a node keeps its authored cell width and therefore takes a larger share of a smaller viewport. Measured result: roughly 405 to 620px across the whole range instead of 216 to 622.

`layout: 'none'` is what makes that work. gridstack's default rescales `w` along with the column count, which preserves the proportion and so would have changed nothing at all.

**The catch, and the rule that follows from it.** At a reduced column count a node wider than the grid is clamped to fit: a 16-wide node becomes 12 at 12 columns, and that is lossy. Persisting it silently rewrote the saved layout, so resizing a window down and back up permanently shrank every wide node. Two guards, both verified across repeated round trips through every breakpoint:

- **Geometry is only persisted at the authored column count.** Below it the field is a rendering of the layout, not an edit of it.
- **Resize is only offered at the authored count**, since there is no coherent "make this one wider" at a width about to be recomputed out from under it. Drag is offered at every count now; see the reorder entry below for how that stopped being a "discard the change" problem.

The store-to-engine sync also depends on the column count, not just the store. Coming back up from a reduced count leaves gridstack's engine holding a reflowed layout while the store never changed, so without that dependency the field stayed visibly wrong for the rest of the session even though a reload was correct.

That sync restores **position as well as size**, applied in a single batch. An earlier version restored only `w` and `h`, which fixed the clamped widths and left every node sitting wherever the narrow reflow had repacked it: a node authored at 8,0 came back at 0,8. Position is the more obvious half of the damage and was the half that went unnoticed, because the verification compared sizes only. Batching matters too: applied one at a time, each update reflows against the others and lands somewhere else again. A `restoring` flag suppresses persistence for the duration, so the intermediate states are not written back as if the visitor had made them.

Two gridstack lifecycle traps found here, both guarded in `FieldGrid`:

- Its stylesheet reads sizing from custom properties on the container (`--gs-cell-height` and friends). `destroy()` leaves them behind, and a stale `--gs-cell-height` sized every card to exactly one cell (64px) after returning to a narrow viewport. First load at that width looked fine only because they had never been set.
- It can emit `change` into a listener whose instance has already been destroyed, and any call back into that instance throws. The active-instance identity check is what marks a listener stale.

## LOCKED: A deterministic packer replaces gridstack's own column-change reflow

Below the authored column count, gridstack's built-in response to a column change is discarded and rebuilt from scratch by a shelf-packer in `FieldGrid.svelte` (`computeCenteredLayout`).

The built-in reflow proportionally rescales each node's `x`, then resolves whatever collisions that creates through general-purpose move logic, and the two together produce gaps with no consistent side: one row flush against the left edge, the next starting two columns in, another ten columns in. Reported as everything pushing right; measured as inconsistent in both directions depending on the row. There was no arrangement being protected by leaning on gridstack's own math here, since dragging and resizing are only offered at the authored width, so replacing it outright was the available option, not a workaround.

The packer places nodes in list order, left to right and top to bottom, clamping width to the column count and scaling height to match so a node's aspect ratio survives being narrowed (gridstack's own clamp held height fixed, which visibly squashed a 16:9 node toward 4:3). Each finished row is then centered.

**Centering an integer grid coordinate can only get within one cell of true center.** `gs-x` has to be a whole column, and a row whose leftover space is an odd number of columns cannot split evenly: the two sides differ by a full cell, which was still visibly off-center at two of the five reduced breakpoints (15 and 21 columns specifically, where an 8-wide node leaves an odd leftover). Caught by screenshot, not by the pixel measurements alone, which read as "off by one cell" and undersold how it actually looked.

The fix carries a `nudge` value (0 or 0.5 cells) alongside each placed node's integer position, applied as a CSS `transform: translateX()` rather than through gridstack's coordinate system at all, since that system cannot express half a cell. This is purely a rendering correction: it does not touch `gs-x`, is cleared on returning to the authored column count (where every row spans exactly the full width and no correction is ever needed), and is recomputed independent of a column-count change, since a plain window resize that only changes the pixel size of a cell still needs its pixel nudge recalculated even though the grid coordinates it is correcting have not moved.

## LOCKED: The main nav collapsed into a drawer on desktop so the field view's canvas gets the full viewport height

The header used to be a full-width bar in the page's own flex-column layout: `main` got `flex: 1`, which is "viewport minus whatever the header actually rendered at." Even a short bar still reserves that space. The nav is now two independent floating pills, `position: fixed` and out of that layout entirely: `Logo` top-left, a hamburger trigger top-right on desktop. `main` is `min-height: 100vh` directly, with no header box subtracted from it.

**`NavDrawer.svelte`** holds what used to be the header's link row plus the Arrange and theme controls, as a right-side slide-out. It deliberately mirrors `Modal.svelte`'s mechanics (backdrop click to close, Escape, body scroll lock, focus-on-open) rather than inventing new ones, and deliberately does **not** add a stricter Tab focus trap, because `Modal` doesn't either; matching that baseline keeps every overlay in the app behaving the same way instead of drawer being the one exception.

**Desktop-only by construction.** Mobile keeps the bottom tab bar as its only nav, now carrying two more items (Arrange, gated to the Field route same as the drawer's copy; and theme, via `ThemeToggle`'s new `bar` variant) rather than getting a second, redundant drawer. A phone's thumb already reaches the bottom of the screen more easily than a hamburger in a corner would ask it to, which is the same reasoning that put the tab bar there in the first place.

**`ThemeToggle` gained variants (`pill` / `drawer` / `bar`) instead of being copied three times.** All three share the same cycling logic and the same per-theme icon; only the outer layout and sizing differ. The alternative, three components each hand-rolling "cycle light/dark/system," would have meant three places to keep in sync for one behavior.

The trigger button doubles as the drawer's close control (its icon swaps hamburger to X while open) rather than adding a separate close button inside the panel: it is already fixed in place and already visible above the backdrop (`z-index: 102`, above the backdrop's 100 and the panel's 101), so a second control would have been redundant chrome for the sake of it.

**A caught bug worth naming:** the drawer's own Arrange button originally toggled edit mode but never closed the drawer, unlike every other action in it (the nav links and the About button both close on click). Caught by Playwright, not by eye: the toggle visibly worked, so nothing about it looked broken in a screenshot, but a real user would have been left staring at the panel instead of the field view they had just asked to arrange.

Guarded against one resize edge case: `drawerOpen` can only become `true` via the trigger button, which is itself hidden below the mobile breakpoint, so the drawer cannot be opened from a phone. But it could already be open on a wide window that then gets resized narrower, so a `matchMedia` listener force-closes it when that boundary is crossed, mirroring the same category of guard `FieldGrid` already needed for its own breakpoint transitions.

## LOCKED: A drop below the authored column count reorders instead of placing, which is what makes universal drag safe

Drag used to be disabled below the authored 24 columns entirely, because a dropped position there could not be saved losslessly: a 16-wide node clamped to fit a 12-column grid, and persisting that clamped width would have silently shrunk the node on a later reload. That gating is gone. `FieldGrid`'s `change` handler now checks `instance.getColumn() !== GRID_COLUMNS` and, when true, reads gridstack's own settled `(y, x)` positions back out of the DOM (`deriveOrderFromDom`), sorts into reading order, and calls `onReorder` with the resulting id sequence instead of persisting geometry. `layoutStore.reorderTo(order)` applies that as a pure list-order change and deliberately never touches `x`, `y`, `w`, or `h`, so there is nothing lossy left to worry about: the existing `computeCenteredLayout` effect already reactively depends on the store's node order, and regenerates a clean, centered arrangement from the new order on the next tick.

This is also what makes **touch dragging work at all on a phone**: rather than needing a separate reorder mechanism for narrow widths, the same drag gesture that resizes and repositions on desktop now reorders on a phone, because gridstack's own touch support (bundled via `dd-draggable.js`, wired automatically whenever `isTouch` is true) runs unconditionally once move is enabled.

**The bug that shipped alongside this, caught only by an actual touch-drag test, not by `svelte-check`:** the effect that gates interaction:

```js
$effect(() => {
	if (!grid || !ready) return;
	grid.enableMove(editMode);
	grid.enableResize(editMode && columnCount === GRID_COLUMNS);
});
```

never reacted to `editMode` changing after the first time the guard passed. An `$effect`'s tracked dependencies come from what it reads on its _own_ run, not from a fixed list at creation; `grid`/`ready` start false, so on early runs the guard returned before `editMode` or `columnCount` were ever read, and whichever run first happened to clear the guard is the one whose dependency set stuck. The result: `grid.enableMove()` was called once, correctly, and then never again, so toggling arrange mode later left dragging silently disabled at every column count, mouse or touch, no error anywhere. Fixed by reading `editMode` and `columnCount` unconditionally before the guard, matching the pattern the file's three other effects already followed. Reproduced and verified fixed with Playwright, dispatching real `TouchEvent`s at a 390px viewport and confirming both the visible reorder and the persisted `layoutStore` order changed; a coordinate-based CDP touch simulation confirmed the same result the way a real device would deliver the gesture.

## LOCKED: Add/reset/exit moved from a permanent bar into a menu summoned on demand

`FieldEditBar`, a bar rendered above the grid for the whole duration of edit mode, is gone. In its place, `ArrangeMenu.svelte` is a positioned popup (mirroring `NodeConfig`'s own dropdown mechanics: `pointerdown`-outside and Escape both close it) that appears only when asked for, at the coordinates the caller gives it.

**Desktop:** right-click anywhere on the field while arranging opens it at the cursor (`+page.svelte`'s `oncontextmenu`, gated on `editMode` so the browser's own context menu still works everywhere else and at every other time). The menu here includes "Done arranging," so exiting edit mode no longer requires a trip back to the header drawer.

**Mobile:** the bottom tab bar itself changes shape while arranging, rather than gaining a seventh item or showing an inline bar above the grid. `Field` / `Favorites` / `About` / `Settings` / `Theme` are not reachable mid-arrange anyway, so the bar collapses to just two controls: `Arrange` (now doubling as the exit control, same toggle as always) and a `+` that opens the same `ArrangeMenu`, positioned above the button by measuring its own bounding box. The mobile variant omits "Done arranging": the adjacent `Arrange` button already does that in one tap, so repeating it in the menu would be redundant chrome.

`ArrangeMenu` clamps its own position after mounting (measuring its real dimensions against the viewport, not guessing beforehand), which is what lets the same component serve both a click near a screen edge on desktop and a button pinned to the bottom of a phone screen without ever rendering off-canvas.

The now-dead `canReorder`/`onMove` prop chain (`+page.svelte` → `FieldSlot` → `NodeConfig`) was removed along with "Move up" / "Move down," since dragging replaced it everywhere; see the reorder entry above.

## LOCKED: PWA icon set and social preview image are generated, not hand-exported

`static/images/IndieNodes_Logo.png` (1920x1920, RGBA) is the master asset; `scripts/generate-icons.js` (sharp, a new devDependency) renders every derived size into `static/icons/` rather than each being exported by hand from a design tool. Re-run it after the master logo changes; nothing in the build pipeline does this automatically.

**The logo's diagonal cutout is transparent, not white.** It reads as white against a white canvas, which is how it looked in isolation, but is genuinely alpha-zero: composited over the app's dark background (`#0f1420`, matching `--bg` in `app.css`) it shows that color through instead. This is correct, intended behavior for a mark meant to sit on more than one background, not a rendering bug, but it did catch out the first pass of this script: `sharp`'s `resize(..., { background })` only fills letterboxing from a fit mismatch and never touches a source image's own alpha, so an already-square resize with that option produced a PNG that still claimed to be opaque-backed while remaining fully transparent underneath. `apple-touch-icon.png` needs a real opaque backing (iOS renders transparent regions black rather than showing the home screen through them), so it and the maskable icon both go through an explicit `.flatten({ background })` (or an opaque `create` canvas composited under the logo) instead of trusting `resize`'s option to do it.

**The maskable icon pads the logo to 70% of the canvas before flattening it onto the brand background**, keeping it inside the safe zone various Android launchers clip to (roughly the inner 80%, cropped to whatever shape the device theme uses) with margin to spare.

**The social preview image (`og-image.png`, 1200x630) is the logo centered on the same brand background, with no rendered text.** Adding a wordmark would need `sharp`'s SVG-to-raster path (backed by librsvg) and a font this environment is not guaranteed to have, for a detail every OG consumer already renders as real text anyway: `og:title` and `og:description` appear alongside the image on every platform that reads them, so the image's job is just to be a clean, recognizable mark, not to duplicate text the platform already shows.

`favicon.svg` (the hand-built four-square SVG mark, unrelated to this logo file) stays the primary favicon; the generated 32px and 16px PNGs are a fallback for the shrinking set of browsers without SVG-favicon support, plus whatever a PWA install or an iOS home-screen add reads instead of the SVG.

## LOCKED: A manifest, and site-wide Open Graph and Twitter Card tags

`static/manifest.webmanifest` names the app, points at the generated icon set (192, 512, and a separate maskable 512 entry per spec, since `any` and `maskable` purposes are distinct icon list entries even when nothing else differs), and sets `background_color`/`theme_color` to the same `#0f1420` the icons themselves are flattened onto, so a PWA install's splash screen does not visibly seam against the icon it is shown next to.

Description, Open Graph, and Twitter Card `<meta>` tags live in `app.html` rather than per-route `<svelte:head>` blocks, because every route already sets its own `<title>` but none currently has a reason to differ on description or preview image; a single site-wide block covers that without inventing per-page copy nobody asked for yet. `theme-color` is declared twice, once per `prefers-color-scheme` value, matching the light/dark backgrounds in `app.css` rather than picking one.

**`og:url` and `og:image` point at `https://indienode.example`, a placeholder**, because this project has not been assigned a production domain yet and both tags are required to be absolute URLs to work at all (a relative `og:image` is not reliably resolved by the platforms that read it). `.example` is IANA-reserved specifically for this purpose (RFC 2606), so it cannot collide with a real site by accident. Flagged with a `TODO` comment in `app.html` for whenever a real domain is chosen.

## LOCKED: The app's display name is IndieNodes, plural

Renamed from IndieNode throughout every user-visible surface: page titles, the header brand mark, the About modal, `README.md`, the manifest's `name`/`short_name`, and the Open Graph/Twitter tags. Left deliberately untouched: `docs/bootstrap-prompt.md` and `IndieNode_v2_Brief.md` (the original spec documents this project was built from, which record what was actually said at the time, not what the product is called today), the `<indienode-widget>` custom element tag and the `indienode:*` localStorage key prefixes (technical identifiers with their own compatibility surface, not display text a visitor reads), and the `indienode.example` placeholder domain (a URL slug, not a title).

## LOCKED: Header micro-interactions animate both ways, not just in

Two places played an entrance animation but not an exit, or no animation at all where a state change deserved one:

**`NavDrawer` closed instantly.** Its backdrop and panel used a CSS `animation` triggered by mounting (`{#if open}`), which by construction has no reverse: removing the element removes it immediately, mid-frame, because a CSS `animation` isn't told to finish before the element it's attached to disappears. Replaced with `svelte/transition`'s `fade` on the backdrop and this project's own `flyFade` (`$lib/transitions.js`) on the panel, both of which Svelte keeps in the DOM for the length of an _outro_ too, not only an intro; the panel now slides back out to the right on close, the reverse of how it arrived, instead of vanishing. `flyFade` also already carries its own `prefers-reduced-motion` handling, so the drawer needed no separate reduced-motion CSS of its own once the two hand-rolled `@keyframes` blocks (and their own reduced-motion override) came out.

**The hamburger trigger swapped between two unrelated SVGs.** Instant, and per the brief for this round, not what "animate when pressed" was asking for. Replaced with three `<span class="bar">` elements, always present, that CSS-transform between a hamburger and an X based on a `.open` class: the top and bottom bars rotate 45°/-45° into place, the middle one scales to nothing. Because this is a persistent element toggling a class rather than a mount/unmount, a plain `transition:` on the bars' `transform`/`opacity` animates cleanly in both directions with no Svelte transition directive needed. Paired with a small `:active { transform: scale(0.9) }` press response on the button itself, so the trigger reads as pressed even for the instant between tap and the drawer's own animation starting.

## LOCKED: A hover glow on the brand mark, not a static hover state

`.brand-float` (the floating logo-and-wordmark pill, top-left) gained a `box-shadow` pulse on hover and focus: a `@keyframes` animation cycling the shadow's blur and spread between zero and a soft accent-tinted halo, 1.8s per cycle, looping only while hovered or focused rather than running at rest. `prefers-reduced-motion` gets the peak glow as a static `box-shadow` instead of the loop, matching the project's standing rule that a small, non-looping visual cue survives that preference even when a large or repeating one would not (see `flyFade`'s own doc comment for the same reasoning applied to motion instead of a shadow).

## LOCKED: The first-visit layout is a centered column, not a full-width spread

`layoutStore`'s `defaultLayout()` used to place its four shipped nodes edge to edge across the entire 24-column canvas: a comic touching the right edge, a text node touching the left one. Read as "fill the viewport" rather than a composed arrangement, which is what prompted the redesign. Every node now sits inside a 16-column band centered in the 24-column canvas (`x=4` to `x=20`, margin on both sides), and within that band the two square nodes (audio, game) align to the hero comic's own left and right edges rather than to the canvas's, so the whole thing reads as one deliberate column instead of four independent placements that happen to share a page. Sizes vary deliberately too: a 16:9 hero, two smaller 1:1 squares, and a portrait 3:4 text node, rather than four similarly-sized cards.

This is still only the _first_ visit's arrangement. `defaultLayout()` is reached only when `localStorage` holds nothing yet (see `load()` in the same file); anything a visitor does after that persists exactly as before, and a returning visitor with a saved layout never sees this composition again regardless of how it changes in a future update.

## LOCKED: The About modal gets a real logo, a release history, and the real Ko-fi mark

Three changes, all in `AboutModal.svelte`, modeled on GG Requestz's own About modal (a sibling project, `../ggrequestz`, consulted directly for this):

**Logo and version header.** The modal body now opens with the real logo (`static/images/IndieNodes_Logo.webp`, referenced by its served path rather than imported, since files under `static/` aren't part of the module graph), the app name, and `Version {pkg.version}`, above the tab bar. Superseded by the centered, title-less redesign below.

**Release history, parsed from `CHANGELOG.md` at build time.** GG Requestz parses its own changelog server-side, per request; this site has no server, so `src/routes/+layout.js` does the same parse once, at build time, via a `?raw` import (Vite's built-in raw-text loader) and returns it as layout data, available anywhere via `page.data.releases` since every route already prerenders. The parser reads only `## [X.Y.Z] - YYYY-MM-DD` headings, matching Keep a Changelog's own format this file already follows, and does not touch body content or reformat the headings themselves, both because that's out of scope and because GitHub's own anchor rendering depends on the heading looking exactly like that. Each entry links to `{GITHUB_URL}/blob/main/CHANGELOG.md#{anchor}`, with `anchor` built the way GitHub's slugifier actually does it (verified against a live rendering rather than derived blind): lowercase, brackets and periods stripped, remaining spaces and the separating dash collapsed to hyphens, so `[1.4.0] - 2026-07-29` anchors at `140---2026-07-29`. Capped at 10 entries (matching GG Requestz's own server-side cap) inside a scrollable list, so the modal's layout stays independent of how long the project's history gets.

**A real Ko-fi mark instead of a generic mug.** The Support tab's donate button used a hand-drawn cup-with-steam icon; replaced with Ko-fi's actual logo (fetched from Simple Icons, a permissively-licensed brand-icon set, rather than approximated from memory) for the same reason the GitHub link already used GitHub's own mark rather than a generic code-bracket icon.

## LOCKED: The About modal's header is centered and title-less, and the modal is a fixed size

Two follow-on refinements to the header built above.

**Centered logo, wordmark, and version, stacked, not the modal's own repeated heading.** The dialog previously showed "About IndieNodes" as `Modal`'s own `<h2>`, and _also_ the logo and "IndieNodes" side by side just below it, the app's name said twice in two different type treatments in the first two lines. `Modal.svelte` gained a `showTitle` prop (default `true`, so every other consumer is unaffected): `title` still sets the dialog's accessible name unconditionally, `showTitle={false}` only stops it from also rendering as visible text. About passes `showTitle={false}` and lets its own centered lockup, logo at 7rem (up from 3.5rem, doubled, actually reads as the header now rather than a small accompaniment), "IndieNodes" beneath it, `Version {pkg.version}` beneath that, be the only title on screen. With no visible `<h2>`, the header row's `justify-content: space-between` would otherwise have pulled the lone close button to the start rather than leaving it top-right; a `.dialog-header.untitled { justify-content: flex-end }` class covers that case in `Modal.svelte` itself, not just in About.

**A fixed panel height, not `min-height`.** Switching tabs used to resize the dialog to whatever that tab's content needed, which read as the dialog itself jumping rather than just its content changing. `.panel-container` is now a fixed `height` (28rem) with `overflow-y: auto` as a safety net rather than the intended fit. That number is not a guess: measured each tab's natural (unconstrained) content height via Playwright first (304 to 442px across the four tabs, driven mostly by the release list and the two-paragraph tabs), then set the fixed height to clear the tallest with a little headroom, and re-verified afterward that `scrollHeight === clientHeight` on every tab, i.e. nothing is actually relying on the scroll fallback at this size.

## LOCKED: The default field is small, masonry, and portrait-favoring, not one large hero

Second revision to `defaultLayout()` in the same session. The centered composition from the previous round still used one large 16-wide hero and two 7×7 squares; too big, and it didn't demonstrate that comic and text are allowed to run _tall_, only that they can run wide.

Every node now starts at `MIN_W` (4), the smallest width the shape rules allow, full stop, including audio and game, which were not asked to shrink specifically but "we don't want the nodes too large" was general. Comic and text take the tall end of their ratio family (`[2, 3]`, portrait) instead of the wide end (`[16, 9]`) they had before, both because a shape a type is merely _allowed_ to take only reads as an intentional default when the default actually uses it, and because `[2, 3]` at `w=4` is an exact match (`h=6`), same as `[1, 1]` (square) at `w=4` (`h=4`): every node in this layout is already a legal shape, nothing here depends on `snapToAllowedShape` to correct it.

**Two columns, two nodes stacked in each, is real masonry, not an approximation of it.** Comic and text (both height 6) stack in the left column; audio and game (both height 4) stack in the right. The columns land at different total heights (12 vs. 8) for the same reason a Pinterest-style layout staggers: the items in them are different heights, not because either column was told to be shorter. Column x-positions are computed from `MIN_W` (`columnA = 8`, `columnB = columnA + MIN_W`) rather than hardcoded, so resizing `MIN_W` in `nodeShape.js` later would not silently leave this composition off-center. The whole two-column block still sits centered in the 24-column canvas with margin on both sides, continuing the "composed column, not a viewport-filling spread" rule the previous version of this layout established.

Verified against real content, not just the placeholder seed data: rebuilt once with `ring.json` temporarily swapped for `testing/fixtures/ring.test.json` (AshZone's real _XENO_ Bandcamp release among the entries), screenshotted, then the real `ring.json` restored immediately and diff-verified byte-identical. The masonry composition held up with genuinely uneven real content (a two-line title, real cover art) the same way it did with the placeholder set. One thing that check surfaced, not caused by this resize specifically: the _XENO_ cover art has its own "XENO" wordmark baked into the image, sitting close enough to where the card overlays its own title that the two read as doubled text at this card size. Recorded as an open question rather than fixed here, since it is about where one specific piece of real artwork places its own text, not a sizing regression.

## LOCKED: `ring.json` carries one real, unverified entry alongside the placeholders

AshZone's _XENO_ (`audio-ashzone-xeno`) moved from the test fixture into the real `ring.json`, at the request that it stay there rather than only being swapped in for one verification pass. Two small departures from copying the fixture entry verbatim, both because this file is no longer a fixture once the entry lives here:

- **`id` dropped the fixture's `test-` prefix** (`test-audio-ashzone-xeno` to `audio-ashzone-xeno`), and **`tags` dropped `real-source`**, a tag that only meant something as bookkeeping inside `testing/fixtures/ring.test.json` (marking which fixture entries came from live third-party sources instead of generated local ones). Neither means anything once the entry is outside that file.
- **`verification_token` is `unverified-seed-entry`, not `test-fixture-not-verified` and not a fabricated real token.** The entry is genuinely real (an actual, live Bandcamp release), but not genuinely _verified_: there is no submission pipeline yet to check a `<meta name="indienode-verification">` tag against AshZone's page, and the fixture's own honest token language ("test-fixture-not-verified") stops being accurate once "test fixture" is no longer what this file is. `unverified-seed-entry` says the same true thing in the right register: real content, added directly rather than through a verified submission.

Not marked `_placeholder`, since that field's own schema description is "marks a seed or example entry; real submissions must omit this field," and this is real content, not an example standing in for one. It sits alongside the four `_placeholder: true` entries rather than replacing any of them, since removing the placeholder audio entry was not asked for and the two now demonstrate different things: one shows the multi-track layout with clearly fake data, the other shows the same layout with a real release.

Bandcamp's streaming URLs are tokenized and expire in a few hours (see `testing/README.md`); they were refreshed via `testing/scripts/refresh-bandcamp-track.mjs` immediately before copying into `ring.json` to start as fresh as possible, but nothing about this entry stops them from going stale again the same way they would in the test fixture. `thumb_url` (a plain, non-tokenized image URL) is unaffected.

## LOCKED: A queue-based audio player, mounted at the layout

The field can now play audio. `audioPlayerStore.svelte.js` owns the queue and the playhead, `AudioPlayer.svelte` owns the single `<audio>` element and mounts once in the root layout, and a play control on each audio node drives the store. That split is what lets a node's button, the queue list, and the end-of-queue prompt all address one queue without any of them holding a reference to the element.

**Layout-level, not page-level**, because a queue has to survive navigating from Field to Favorites to Members. Mounting it per route would tear the element down on every navigation and stop the music, which is the one thing a player must not do.

**A queue item is a track, not an entry.** The schema caps audio at three tracks, and "add this node to the playlist" has to mean all of its tracks, so flattening at the point of queueing is what makes both the grouped display and the single-action add work.

**Play and Add are two buttons, not one smart one.** "Play this now" and "play this after what I am already listening to" are different intents, and a single control has to guess which one was meant. Add only appears once there is a queue to add to, so the resting state stays a single button. Adding never interrupts what is playing, which was the explicit requirement.

**Reordering moves the queue under the playhead, not the playhead.** `move()` tracks the currently-playing item by its own key and re-derives the index afterward, so dragging tracks around cannot change which one is audible. Verified: reordering a five-item queue left "Harbor Light" playing throughout. Up/down buttons rather than drag-and-drop, because this list has to be usable with a thumb on a phone and up/down needs no pointer capture, no drop targets, and no separate keyboard path bolted on later.

**Reaching the end stops and asks.** This is the brief's "keep going" expansion (section 8) and it is explicit there: a visible yes/no, never an automatic continuation. `suggestNext` (in `audioSuggest.js`, a plain module rather than `.svelte.js` so its scratch `Set`s do not trip `svelte/prefer-svelte-reactivity`) scores unplayed audio entries by tags shared with what was just played, falling back to a random unplayed entry when nothing matches, so the prompt is never a dead end. The request mentioned honoring node genre preferences; those do not exist yet (they arrive with per-node tag channels, see `roadmap.md`), so the tags of the audio the visitor actually just chose are the closest honest proxy available today.

**The queue is deliberately not persisted**, unlike favorites, preferences, and the layout. A queue is something you are doing right now, and restoring one on a later visit would mean the site comes back holding audio nobody just asked for, which is the wrong side of section 11 even while paused.

**A plain `<audio>`, not Wavesurfer.js**, which the brief names in section 4. Wavesurfer draws a waveform: it wants a tall, focused view of one track, and it would mean decoding every queued file up front. This is a transport bar for a queue. Wavesurfer still fits the reader when the reader is built; the two are not competing for the same job.

## LOCKED: Right-click works in both modes, and links keep their own menu

The field's context menu used to require already being in arrange mode, which made it useless for the thing it is most convenient for: getting into and out of that mode. It now opens in either mode and changes shape, offering the add/reset/done set while arranging and collapsing to a single "Arrange field" entry outside it. Add and Reset are omitted outside arrange deliberately: with no drag handles and no dot grid on screen they would be controls for a mode the visitor is not in.

One deliberate carve-out: right-clicking a link falls through to the browser's own menu. Opening a creator's site in a new tab from a card's Visit button is a real thing to want, and swallowing that to offer "Arrange field" instead would be a bad trade.

## LOCKED: The widget is a badge, not a card, and its buttons travel

The embeddable widget previewed the current entry (badge, title, creator, why, a Visit link) inside a 22rem card, which is the size of a sidebar ad on someone else's site. It is now two lines: the ring's mark and name, then Previous / Random / Next, at 15rem.

Dropping the preview forces the buttons to mean something different, and the more correct thing: they now **travel** to a member's site rather than cycling an invisible preview in place. They open in a new tab rather than replacing the host page, because unlike a classic webring this is a script running inside someone else's site and taking their visitor away without asking is not ours to do.

**`site-id` is what makes Previous and Next honest.** A webring's neighbours are relative to which member you are currently on, and an embedded script cannot know that by itself. Members set it to their own `ring.json` id, and the snippet on the join page and the `/widget` page both include it rather than leaving it to be discovered. Without it the widget picks a random starting point, so at least Next walks the ring instead of funnelling every site's visitors to entry zero.

The mark is inline SVG, not an `<img>` pointing at the ring's domain: it runs on a third-party origin, where an inline mark cannot fail on a blocked request, and it can be animated in CSS rather than needing a pre-rendered animation. The idle animation is a slow staggered breath rather than a spin, because this sits on someone else's page indefinitely and has to stay in the corner of the eye rather than pull attention off their content.

## LOCKED: Members and Join are their own routes; the field stays a field

A webring that cannot tell you who is in it is hiding its own membership, so `/members` lists every entry and `/join` explains how to get in.

This does not contradict the brief's rule that the field view must never grow a filter, a search, or a category browser (section 7c). That rule is about the ambient surface specifically: the moment _that_ view grows a directory, the goal of removing choice is lost. Putting the directory on its own route is what lets both things be true at once.

`/join` documents what actually exists today, which is a pull request or an issue against the public repo, plus the `<meta name="indienode-verification">` ownership check. There is no submission form, no account, and no moderation queue (see `open-questions.md`), and saying so plainly beats shipping a form that emails nobody.

Nav placement: both live in the desktop drawer, which has room. The mobile tab bar gains only **Members**, with Join reachable from the prominent call-to-action at the top of that page, because the bar already carries six items on the field route and a seventh would start truncating labels. Measured at 390px: no label overflows at six.

## LOCKED: Node presentation fixes (plate, progress, crossfade)

Three changes to `FieldNode`, all in the current Basic Nodes look:

**The near-black plate is gone.** A card with cover art sat on a flat `#14120f`, and since the blurred backdrop over it is only partly opaque, that plate showed through everywhere the artwork itself was dark, which on most covers is the outer edges. The result read as a black vignette with a black rim tracing the rounded corners. Measured before changing anything: pixels just outside the corner radius are clean page background, so this was never a clipping leak, only the plate showing through. The plate is now tinted toward the node's own type color and the backdrop is more opaque (0.55 to 0.72), so the card reads as a card in its type color.

**The rotation progress bar is a lit, drifting gradient** rather than a flat `--bg-elevated` block: the type color through white and back, sliding along its own length. The fill's _width_ still encodes real progress, so the drift is decoration layered on real data rather than a fake busy-bar, and it pauses with the countdown, because motion there would imply a countdown that has actually stopped is still running.

**Rotation crossfades the card's contents, not the card.** The entry's layers are wrapped in a keyed block with a slide-fade in and an absolute fade out; the frame, its color, its corners, and the progress bar stay put, because those belong to the node (a fixed position in the field) rather than to whichever entry is passing through it. Transitioning the whole node would read as the node leaving and a different one arriving, which is not what happens.

## LOCKED: The ambient background reacts to audio, but only where the audio can legally be read

Drifting particles speed up with what is playing: sustained loudness stretches their velocity gently, and a detected transient adds a short kick on top, so a beat reads as a push rather than the whole field simply running faster through loud passages. `audioLevelStore` carries a smoothed `level` and a decaying `pulse` from `AudioPlayer` (the only component with the audio element) to `AmbientBackground`; the two are siblings in the root layout and neither owns the other.

**The hard constraint, measured rather than assumed: this cannot work for most audio, and attempting it naively does not merely fail, it silences playback.** Reading samples out of a media element requires Web Audio, and Web Audio refuses cross-origin media that has not opted into CORS. Against Bandcamp's CDN, which sends no `Access-Control-Allow-Origin` on its streams:

- Setting `crossorigin="anonymous"` on the element makes the stream **fail to load at all** (`MEDIA_ELEMENT_ERROR`, code 4).
- Leaving the attribute off and attaching an analyser anyway makes every frequency bin read **0**, which is not just a dead visualisation: a `MediaElementAudioSourceNode` on a tainted source outputs zeros into the graph, so the visitor hears **nothing**.

So the player **probes before wiring anything**. A cross-origin `HEAD` fetch that succeeds proves the host sends the header Web Audio needs; one that throws proves it does not, and the audio path is then left completely untouched. Verified both ways: playing the Bandcamp entry leaves `crossOrigin` null and playback advancing normally, while a same-origin file engages the analyser and reports a real non-zero level with playback unaffected.

The probe result is cached **by origin, not by URL**, because CORS is an origin-level policy: one answer covers an album's three tracks, and a blocked cross-origin fetch always writes to the console and cannot be silenced, so this also keeps that unavoidable noise to one line per host per session instead of one per track.

`active` is a separate flag from `level` because silence and no-analysis are the same number, and a background that treated them alike would be claiming to react when it is not. With nothing playing the multiplier is exactly 1 and the field drifts at its original pace.

## LOCKED: Player refinements (volume, metadata ground, queue motion)

**Volume lives in the component, not the queue store**, and is the one piece of player state worth persisting (`indienode:volume:v1`). It is a property of this device's playback rather than of the queue, which is deliberately never restored. Mute remembers the level it interrupted so unmuting returns there rather than to full. The slider is the first control to drop on a narrow screen, before even the seek bar: a phone has hardware volume keys and rarely a precise pointer, which makes an on-screen slider the least useful thing in that row.

**The now-playing block gets its own gradient ground.** It is the only part of the bar that changes as you listen, so separating it from the controls around it is worth a surface of its own. Angled and fading to transparent rather than a hard-edged box, and tinted with the audio type's own color so it reads as belonging to this player rather than as generic chrome.

**The queue slides rather than fades.** It is physically growing out of the bar it is attached to, so animating its height is what makes it read as the bar expanding instead of a separate surface appearing over one. Svelte's `slide` keeps the element mounted for its outro, so it closes as well as it opens, which a CSS `max-height` toggle on a conditional block would not.

## LOCKED: The analyser constraint is CORS, not same-origin

Worth stating plainly because the natural reading of the previous round's note was "audio must come from our own domain, so the reactive background will never work for a webring." That is not the constraint.

Web Audio can read **same-origin audio, or any cross-origin audio whose host sends `Access-Control-Allow-Origin`**. Measured: `archive.org` serves audio with `ACAO: *` (verified through its redirect to the final `audio/mpeg` node), and GitHub Pages does the same. Bandcamp sends nothing, on either its streams or its pages, which is why it alone is excluded.

So the feature is live for a real slice of plausible creator hosting, not dead. And an iframe embed is not a workaround for it: a cross-origin iframe's audio is entirely unreachable from the parent page, so embedding makes analysis strictly less possible, not more. An artist who wants the reactive background (and queue membership, and finish detection) needs one direct, CORS-readable file; see the two-tier recommendation in `open-questions.md`.

## LOCKED: No platform players. Audio is playable only from a direct file the artist hosts

This reverses the Bandcamp embed shipped one round earlier, and it closes the whole "which platform do we integrate with" line of questioning rather than swapping one platform for another. `platform_embed`, `PlatformEmbed.svelte`, and `embedStore` are all removed.

**YouTube was evaluated and is not available for this.** The specific proposal (accept a YouTube link, play only its audio) is named and prohibited in the YouTube API Developer Policies: **III.I.7** forbids "separate, isolate, or modify the audio or video components of any YouTube audiovisual content," **III.I.9** forbids "a background player, meaning a player that is not displayed in the page, tab, or screen that the user is viewing," **III.I.5** forbids "modify, interfere with, replace, or block advertisements," and **III.I.6** forbids "modify, build upon, or block any portion or functionality of a YouTube player."

A _visible_ YouTube embed is permitted and, on the technical merits, was the strongest option found anywhere in this investigation: the IFrame Player API fires `onStateChange` with state `0` (ended) and exposes `playVideo()`, `pauseVideo()`, `setVolume()`, and `seekTo()`, so unlike Bandcamp it could have been a real queue member with genuine finish detection, the exact thing the embed work was missing.

**It was rejected on the project's own stated terms, not on capability.** `IndieNode_v2_Brief.md` locks the funding model as "Donation only, not ad-supported," with the rationale that "ads require third-party trackers, which conflicts directly with the project's anti-surveillance premise," and `AboutModal.svelte` publishes "IndieNodes has no ads and no third-party trackers." A YouTube embed serves Google's ads and Google's tracking, and III.I.5 forbids blocking either. Taking it would have required editing that promise out of the app first. Recorded here specifically so this does not get re-proposed as a clever workaround: the blocker is a published commitment, not a technical gap.

**Self-hosting was evaluated and rejected too.** The question raised was whether a voluntary submission moves the liability, given SoundCloud appears to operate this way. It does not, for three reasons:

1. **Copyright infringement is strict liability.** Intent and good faith are not elements of the claim. A submitter's warranty buys a contract claim against that submitter, worth whatever they can pay; it does not make the hosting itself lawful.
2. **DMCA §512(c) is narrower than "a user gave it to us."** It shields passive storage at the direction of a user and is not available to services that initiate the provision of the material themselves. A curated ring with human review before publication sits closer to the second description than to a pure upload host. It also requires a designated agent registered with the Copyright Office, kept current, plus a repeat-infringer policy and expeditious takedowns.
3. **Safe harbor grants no license.** On-demand streaming needs the composition as well as the recording: performance rights through a PRO and mechanicals through the MLC. An artist affiliated with ASCAP, BMI, or SESAC, or with any publisher, may be unable to grant the composition side even when they want to.

And **SoundCloud does not get away with it, it pays for it**: direct licensing deals with Warner and with Merlin (20,000+ indie labels and distributors), plus a royalty payout system, content fingerprinting, and safe harbor together. The licensing was near-existential for them for years. Hosting would also invert this project's own thesis (`ring.json` is the product, there is no server) harder than the scraper would have, and add storage, bandwidth, moderation, and recurring compliance cost to a donation-funded project.

Assessed from public sources; not legal advice, and worth a lawyer's read before any hosting decision is actually made.

**What replaces it.** An audio entry is playable when it carries a `tracks[].media_url` pointing at a direct file the artist hosts somewhere that permits cross-origin requests. That already delivers everything the embed could not: queue membership, finish detection, and the reactive background, with no infrastructure and no liability here. `archive.org` is the standing recommendation (free, permanent, purpose-built, and verified to send `Access-Control-Allow-Origin: *`).

**And `tracks` became optional for audio**, which is the other half of the decision. An audio entry with no playable file is now a supported shape rather than a schema error: a **link-only member**, listed in the field and the members list with its cover art and a link out, with no play control. The ring's job is discovery and traffic; in-app playback is a bonus not every creator can offer, and refusing a Bandcamp-only artist entry altogether would serve the ring worse than listing them. `ring.json`'s XENO entry is exactly this case and is now link-only, which also means nothing in the repo expires any more.

## LOCKED: Selection is a shuffled deck per visitor, not a cursor through the file

Entry selection used to walk a per-type cursor through `ring.json` in array order, starting at zero for everyone. Because the pool order is identical for every visitor (it is one static file), **every visitor with the default layout opened on the same entries in the same slots**, and members near the top of the file were shown far more often than members near the bottom. For a webring whose purpose is circulating attention, that is close to the opposite of the intent.

Each type now gets a deck of its ids, Fisher-Yates shuffled once per visitor and dealt from, refilled by reshuffling when it empties. A deck rather than picking at random each time, because plain random repeats: at the ring sizes a young webring actually has, the same entry would reappear while others went unseen. A deck shows everything of a type once before anything repeats, then reshuffles for the next pass.

Verified three ways: five fresh browser contexts produced five different first screens (before this, all five were identical); 200 trials of a full pass over a 13-entry pool contained zero duplicates; and consecutive passes deal in different orders. Decks are cleared whenever the entry set changes, so a filter change or the ring finishing loading cannot leave a deck holding ids no longer in the pool.

## LOCKED: Pools are bucketed once, not filtered per lookup

`poolFor` did `entries.filter(...)` on every call, and `canRotate` calls it from the template for every node. Reassigning `assigned` on a single rotation invalidated all of them, so one rotation cost **O(nodes² × ring size)** and allocated a fresh copy of the pool per node. Measured at 12 nodes and 2,000 entries that is roughly 300,000 operations per rotation, which would surface as GC churn on a phone before it showed as CPU.

Pools are now bucketed by type in one `$derived.by` pass per entries change, and `canRotate` compares a pool's length against a derived count of that type currently on screen instead of scanning both. Per-rotation cost drops to **O(nodes²)**, independent of ring size. The reconcile trigger also stopped concatenating every entry id into a signature string (roughly 200 KB at ten thousand entries, rebuilt on each evaluation just to prove nothing had changed) in favour of array-identity comparison.

Worth recording as the general finding: **JSON parsing was never the scaling problem.** Measured at 2ms for 1,000 entries, 14ms at 10,000, 84ms at 50,000. The cost was always in what the render path did with the parsed data, and in how many times the build shipped it.

## LOCKED: The ring is fetched once, client-side, not baked into every page

`+layout.js` and each of four `+page.js` files all called `loadRing`. SvelteKit dedupes the _fetch_ during prerendering but serialises the _response_ per load function, so the whole ring was embedded twice into each of four prerendered pages, plus shipped again as `ring.json`: **eight copies in the build.** Measured before the change: 38% of `index.html` was inlined ring JSON, at five entries. That grows linearly with membership, so at 500 members it is roughly 2.3 MB of HTML across those pages, and it is inlined rather than cacheable.

Ring data now comes from `src/lib/ringStore.svelte.js`, a module-level store fetched once in the browser and shared by every route, with the in-flight promise held so concurrent callers do not race. Measured after: `index.html` went from 18,142 to 10,747 bytes, with **zero** inlined ring JSON.

This also closed a freshness split that came with prerendering. Baked-in data meant the first paint showed the ring as of the last deploy while a later client-side navigation showed it live, so whether a new member appeared depended on how you arrived. Every surface reading from the store now sees the live file, and adding a member no longer needs a rebuild.

**`/members` keeps its server-side load, deliberately.** It is the page whose entire job is being crawlable and linking out, which is most of what a webring is for, and rendering it only after JavaScript would undercut that. It carries the one remaining inlined copy; the build still went from eight to one.

The cost is that entries are no longer present at first paint, so the field, Favorites, and the Settings tag list each need a brief loading state. They say "Loading the ring…" rather than showing a spinner, and more importantly rather than showing their empty state, which would otherwise tell someone with favourites that they had none.

**Not done, and deliberately:** sharding, or splitting a selection index out from display data. A selection-only index measures at 14% of full ring size and becomes genuinely useful somewhere past 5,000 members. Building it now would be solving a problem this project does not have, and the four changes above raise the ceiling far enough that it is unlikely to.

## LOCKED: The playback effect is idempotent, and analysis never interrupts audio

A bug worth recording in full, because both halves are traps this codebase can hit again.

**The symptom:** with local (CORS-permitting) audio, the play button flapped between play and pause. Measured: **10,938 `play` events and 10,938 `pause` events in six seconds**, perfectly alternating. The audio itself was fine, `currentTime` advanced and `readyState` was 4; it was the _state_ that never settled, so the UI oscillated.

**The sustaining mechanism: a self-feeding effect.** The `<audio>` element's `play` and `pause` handlers write into `audioPlayerStore.playing`, and the effect that drives playback _reads_ that same value. Because the effect issued `play()` or `pause()` unconditionally on every run, its own side effects re-triggered it. That is a loop waiting for a trigger, and it only needed one perturbation to start.

The effect now compares against the element's real state first (`wantPlaying && el.paused`), so a re-run for any reason at all is a no-op and nothing can feed itself. `setPlaying` also ignores no-op writes, since it is fed by events that fire far more often than the value changes. This is the same family as the `untrack` trap already recorded here: an effect that both reads and writes related state needs an explicit reason not to re-enter.

**The trigger: analysis interrupting playback.** `ensureAnalysis` used to set `crossOrigin` and then call `el.load()` to apply it, because `crossOrigin` only affects the _next_ load. But `load()` aborts playback, which fires `pause`, which the store recorded as "not playing", which put it in a fight with the effect above.

It now sets `crossOrigin` for next time and returns, never touching a resource already playing. The cost is that the first track of a session does not drive the reactive background; every track after it does, because the element persists and reloads in CORS mode when its `src` changes. Verified: track one plays cleanly, track two plays _and_ reports a live level.

That trade is the point. **Interrupting audio someone is listening to, in order to animate a background, is the wrong trade even when it works.** The analyser is decorative; the audio is the product.

Worth noting this only ever reproduced with local fixture audio. Against Bandcamp the CORS probe failed and `ensureAnalysis` bailed before reaching any of it, so making the fixture serve real CORS-permitting audio is what surfaced a bug that had been latent since the analyser landed.

## LOCKED: CORS mode is chosen before `src`, never after

Three bugs came out of one mistake, and the mistake is worth naming precisely: **`crossOrigin` selects the mode a resource is fetched in, so it only means anything before `src` is assigned.**

Setting it afterwards was tried twice, both times to enable the reactive background on audio that was already playing, and both attempts failed differently. Calling `load()` to apply it aborted playback, fired `pause`, and set off the play/pause oscillation recorded above. Setting it _without_ `load()` avoided that but silently invalidated the loaded resource, so dragging the playhead restarted the track from zero, and the analyser could still never attach to the track actually playing.

The element is now pointed at a track through one function that sets `crossOrigin` and then `src`, in that order. CORS mode is chosen optimistically and learned by trying: a host that refuses fails the load outright (`MEDIA_ELEMENT_ERROR`, code 4), which is caught, recorded against that origin, and retried once without CORS. The cost falls only on hosts that refuse, only on their first track, and it costs them the background rather than their audio.

That also removed the `HEAD` probe that used to run before playback. It was worse on both counts it existed to serve: it delayed the first track from every new host, and a blocked cross-origin request always writes to the console, so it left an error on screen for every host that had simply not opted in.

## LOCKED: Overlays close on backdrop self-clicks, not by stopping propagation

`NavDrawer` and `Modal` both kept a backdrop click from closing them by calling `stopPropagation()` on the panel. That looks equivalent to checking the click target and is not: it also stopped clicks reaching `document`, which is where SvelteKit's router listens for link navigations. Every link inside the drawer therefore fell back to a **native full-page navigation**.

The visible cost was much larger than the cause suggests. A full page load tears down the whole app, so it restarted the ring fetch on every navigation and, worse, killed any audio that was playing. The player is mounted in the layout precisely so a queue survives moving between Field, Favorites, and Members, and drawer navigation was the one path quietly breaking that promise.

Both now close only when the click landed on the backdrop itself (`event.target === event.currentTarget`), leaving propagation alone. `NavDrawer` additionally closes on `afterNavigate` rather than on link click, which also covers back and forward.

**Worth generalising:** `stopPropagation` in an app with a document-level router is never local. It silently disables framework behaviour for everything inside it.

## LOCKED: The field's loading state is the logo, and a failure says so

The field had no first impression: it is deliberately idle once settled, so the moment it loads is the only one available. That moment now shows the real logo materialising from oversized, transparent, and blurred into place, with a loading line beneath it.

Held for the length of its own animation so a `ring.json` that resolves in 40ms does not cut the logo off mid-zoom, and skipped entirely when the ring is already in memory, since there is nothing to load when returning from another route. Reduced motion keeps the fade and drops the zoom.

Separately, and more importantly: **a ring that failed to load no longer reports itself as empty.** It previously fell through to "the ring is empty right now", which sent you looking at content when the actual problem was that the file never arrived, and it is exactly what happened when the fixture server was not running.

## LOCKED: The background follows the beat, not the loudness

The reactive background shipped looking inert, and the reason was a measurement nobody had taken: **overall energy on real music is almost a constant.** Sampled across AshZone's XENO, full-spectrum energy sat between 0.40 and 0.53 for six seconds straight. Driving particle speed from it produced a flat 1.9x multiplier that never returned to 1x, so there was no rest to contrast against and nothing read as a reaction.

Two changes, both from measurement rather than taste:

**Beats come from the bass, relative to its own recent past.** Bins 1 to 6 (roughly 170Hz to 1.2kHz) are averaged against a 1.5 second rolling window, and a beat is when that jumps above the window by a ratio. The threshold is **1.12**, which looks low until you measure a modern master: XENO's bass band averages 0.87 of full scale, so a kick physically cannot be 1.3x its own average. There is no headroom, and a threshold chosen by intuition rather than by looking never fired at all.

**The analyser's own smoothing was the other half.** `smoothingTimeConstant` was 0.7, which averages each bin with previous frames and flattens exactly the transients being searched for; beat detection fired **zero** times until it dropped to 0.2.

The consumer then weights the beat heavily (`pulse * 5`) and sustained level barely (`level * 0.5`), so the field returns to its resting pace between hits. Verified at the point that actually matters, the multiplier the particle loop uses: exactly **1.0 with nothing playing**, and **1.0 to 5.58 during playback**, with 163 of 209 frames at rest and 28 clear surges.

**A testing note worth keeping.** Reading these values from Playwright by importing the store gave 0.00 while the real value peaked at 0.86: `$lib/…` and `/src/lib/…` resolve to separate module instances, so an injected import can observe a _different copy_ of a singleton than the app is using. Twice in this project that produced a convincing false negative. Instrument the running code, or measure the observable output, rather than importing state from outside.

## LOCKED: A control on a node is a solid chip, never an outline

The Queue button was the one exception and it was a mistake, not a variation. As a transparent button it took `--bg-elevated` for both its border and its icon, which is `#171d2c` in dark mode, so on a card carrying cover art it rendered as a near-black ring on a dark scrim. That is what "greyed out and hard to see" was.

It had already needed one patch for this: a `.node:not(.has-image)` branch swapping the border to `--text` at 40% alpha, because the same treatment was invisible against a flat color wash too. Two special cases for one button is the signal.

**The general rule this settles: an outline control is only ever as legible as whatever happens to be behind it, and behind a control on a node is an arbitrary photograph under a variable scrim.** There is no border color that survives all four type colors, both themes, and any cover art a member might submit. A solid chip brings its own ground, so contrast stops depending on content the project does not control. `.visit-button`, `.play-button`, and `.like-toggle` had all independently arrived at the same treatment already.

Both `.node:not(.has-image)` overrides were deleted rather than kept, since they exist only to compensate for transparency.

Hierarchy between Play and Queue now comes from the icon rather than from visual weight. That is enough here specifically because the two sit side by side and are read together; it would not be enough for controls separated on a page.

## LOCKED: Fit to view changes the cell pitch, not the canvas

The responsive behavior this sits beside is the column ladder: fewer columns on smaller screens, nodes keeping their authored cell width, rows repacked by `computeCenteredLayout`. That keeps cards a readable size, which is the right default, and it does so by **changing where nodes sit relative to each other**. A composition somebody arranged does not survive it.

Fit mode answers the other want, and the implementation is one number. The layout is stored in cells (`{x, y, w, h}`), and gridstack derives every pixel from the cell size, so scaling the arrangement to the viewport means computing a cell pitch:

```
cellPx = clamp(min(availW / 24, availH / layoutRows), MIN_CELL_PX, MAX_CELL_PX)
```

and applying it as an explicit `cellHeight` plus a `24 * cellPx` container width. **Nothing writes `x/y/w/h`.** The arrangement is not restored on the way out, it was never touched, which is why returning the window to its original size reproduces the original field exactly rather than approximately.

**Rejected: a CSS `transform: scale()` on the grid container.** It is the more obvious implementation and it is wrong here. gridstack's drag and resize math reads raw pointer coordinates and does not compensate for a scaled ancestor, so every gesture would be offset by `1/scale` and a dropped node would land somewhere other than where it was released. That would have forced fit and arrange to be mutually exclusive. Scaling the cell keeps every pixel gridstack computes honest, so both modes run together.

Three consequences worth knowing:

- **The column ladder has to be switched off, not overridden.** gridstack re-derives its column count from `opts.columnOpts` on every resize, so a bare `column(24)` is silently undone the next time the window moves. `checkDynamicColumn()` bails immediately when `columnOpts` is absent, so nulling it (and restoring the saved reference on exit) is the supported way to say "not right now."
- **Order matters on exit.** Restoring `cellHeight('auto')` is what flips `_isAutoCellHeight` back on and re-attaches the `ResizeObserver` that gridstack disconnected when a pixel height was pinned. Clearing the width override afterwards changes the element's width, which is the event that makes it re-evaluate breakpoints and restore the responsive column count by itself.
- **Height must not be measured from the wrapper.** The wrapper's height comes from its content, and its content's size is what the measurement decides, so reading it would feed the cell size back into itself. Width comes from the wrapper (always full-bleed, so unaffected by what happens inside it); height comes from `window.innerHeight`.

Container queries behave differently from the transform version, and correctly: `FieldNode` uses `container-type: size`, so it measures the real, smaller card and drops its `why` and creator lines as things shrink. Text stays at its own readable scale instead of being shrunk along with the layout.

Below `MIN_CELL_PX` the pitch clamps and the field scrolls horizontally. Past that point the honest answer is that the arrangement is bigger than the screen, not that cards should keep shrinking.

## LOCKED: Play means preview once there is a queue

`playEntry()` replaces the queue outright. That is correct when nothing is loaded and destructive once somebody has built a queue by hand, and a single click on an unrelated node should not be able to do it.

So the control's meaning depends on one thing only: **empty player, Play plays. Non-empty player, Play auditions.** The preview ducks the music, sounds, and leaves the queue untouched; "+ Queue" beside it is how an audition becomes a commitment. Those two buttons already appeared under exactly the same condition (`!isEmpty && !isCurrent`), so the pair now reads as "hear it" next to "keep it" with no new chrome on a card that starts at the smallest width the shape rules allow.

This does not reverse the earlier "Play and Add are two buttons, not one smart one" decision, which was about **Play vs. Add** and still holds; both are still present. This is about **replace vs. audition**, where the non-destructive option is always the safe default and the destructive one should be reached for deliberately (clear the queue, then play).

Implementation notes that are load-bearing:

- **Two `<audio>` elements, not one.** Sharing would mean reassigning `src`, which discards the main track's loaded resource and its position, and drags the whole `crossOrigin`-before-`src` problem into a path with no need of it. A second element makes "put it back" a no-op rather than a reload.
- **The duck is a separate multiplier from `volume`.** `el.volume = (muted ? 0 : volume) * duckGain`, with the slider bound to `volume` alone. The requirement that a fade must not move the visitor's own control is then structural rather than something the UI has to remember not to display.
- **The main element's `play`/`pause` events are ignored while previewing.** They are the app ducking it, not the visitor pausing it. Without that guard the preview's own pause writes back `playing = false`, and the music never resumes on its own. `playing` deliberately stays `true` for the whole preview, because nobody asked the music to stop.
- **The playback reconcile effect reads its `previewing` guard before its early returns.** Third time this file has had to say it: an effect's tracked dependencies come from what it read on its own run, so a guard read after an early return would let the run that first passes decide the dependency set forever, and the preview would never release the main element.
- **Ramping `el.volume`, not a Web Audio `GainNode`.** Gain requires the host to allow cross-origin reads, and a fade has to work for every source unconditionally. `src/lib/audioRamp.js` is a plain rAF ramp with an ease-out, since a linear fade reads as an abrupt stop at the quiet end.

**The preview lane does not drive the reactive background.** A `MediaElementAudioSourceNode` can only be created once per element and re-pointing it is a hazard this project has already been bitten by. The analyser stays on the main element; a preview simply does not animate the field. Decorative, and not worth risking the audio path for.

## LOCKED: The discovery journal is write-only with respect to selection

Gamification was raised and rejected on the project's own terms (the brief's Fojworks note, and section 11's "no notifications, unread counts, streaks, or return-prompting mechanics"). What survived that discussion was a **record**, not a game, and `journalStore` is the substrate for it: entries opened, liked, and listened through, in `localStorage`, capped at 500 events, clearable from Settings.

**The one rule that makes it legitimate, and it is not a style preference: nothing that decides what a visitor is shown may read this store.** Not the shuffled decks in `+page.svelte`, not `audioSuggest.js`, not any pool or filter. Recording what somebody did is a record. Feeding it back into what they see next is "behavioral inference," which the brief forbids by name (section 8: "draws only from declared `tags` data, never inferred behavior"), and the entire distinction between the two is whether anything reads the file.

Recording points are deliberately narrow. `listened` fires only when a track reaches its own end, because starting something and skipping it is not listening to it, and **never for a preview**, which is an audition by definition. `liked` fires on liking only, not unliking, since removing a like is a correction to a record rather than an event in one.

It is built now, ahead of anything that displays it, for one reason: **a trail that starts recording the day its view ships is empty on arrival.** The data has to accumulate first.

## LOCKED: No leaderboard, and no Three.js for the trail visualization

Two rejections recorded so they are not re-proposed.

**No leaderboard, ever.** It needs a server, comparison across users, and an account system. This project has explicitly rejected all three, so this is the clearest line in the whole discussion and there is nothing to weigh.

**The trail visualization is 2D canvas or SVG, not Three.js.** Four reasons, in order of weight:

1. This project has exactly **one** runtime dependency (gridstack), and adding that one was treated here as a genuine change in dependency posture requiring measurement, not a free win. Three.js is a much larger commitment for a decorative surface.
2. Roughly 150 KB gzipped, landing on a codebase that just fought `index.html` from 18,142 bytes down to 10,747 and moved the changelog parse server-side to save 22 KB. Spending all of that back on one page's ornament inverts work that was done deliberately.
3. The app's visual language is 2D canvas plus CSS. A single 3D surface would read as a different product bolted on, not as this one.
4. `prefers-reduced-motion` and the "calm, ambient" rule mean this should be near-static anyway, which discards exactly what 3D buys (parallax, orbit, continuous motion). `AmbientBackground.svelte` already demonstrates that a 2D particle field carries this aesthetic.

Worth revisiting only if **screen saver mode** is built and wants real 3D. That is a far better justification than a profile page, and it is a different decision from this one.

## The production domain is `https://indienodes.us`

Replaces the `indienode.example` placeholder (RFC 2606's reserved TLD) in `src/lib/config.js`, `src/app.html`'s Open Graph and Twitter tags, `schema/ring.schema.json`'s `$id`, `README.md`, and `src/widget/embed.js`. The widget bakes `SITE_ORIGIN` in at build time, so `static/embed.js` must be rebuilt for it to take effect; `npm run build` and `npm run dev` both run `build:widget` first, so that happens automatically.

Caught in the same pass, and worth recording because it would have shipped: **`RING_JSON_URL` was still pointed at `http://localhost:4174/ring.test.json`** from a local testing session, with the real line commented out above it and a note to revert before committing. The widget is the one place that value is read, and it runs on other people's sites, so an embed built from that state would have asked every visitor's own machine for the ring. `testing/README.md` documents that override as a temporary step; the lesson is that a "revert before committing" comment is not a mechanism, and this one survived several rounds of work.

`GITHUB_URL` and `KOFI_URL` are still `TODO` placeholders and are **not** resolved by this. See `open-questions.md`.

**Overridable with `VITE_SITE_ORIGIN`, and that override is build-time only.** `adapter-static` emits plain files with no server process, so nothing is running when a visitor arrives that could read an environment variable. In Docker that means `--build-arg`, not `-e` on `docker run`, and changing the origin needs a rebuild rather than a restart. Documented in `.env.example` because the opposite assumption is the natural one.

This is also why the Open Graph and Twitter tags moved out of `app.html` and into `+layout.svelte`'s `<svelte:head>`: `app.html` is copied through verbatim with no substitution of any kind, so an absolute URL there can only ever be a literal. They still prerender, so nothing that reads them can tell the difference.

## LOCKED: The comic reader is an adaptation of KeyJayOnline_v2's viewer, not a port of it

Resolves the phase-0 question about whether that component was reusable. It was, in exactly the way `open-questions.md` predicted: the interaction model carried over almost intact, and none of the chrome did.

**What came across** is the part that is genuinely hard to get right and was already tuned against real use: click and wheel and double-tap zoom, drag-to-pan with momentum, two-finger pinch, long-press-to-pan at 1x, horizontal swipe paging, a grid of all pages, and chrome that auto-hides on touch while reading.

**What did not, and why**, since its five dependencies are what made it not a drop-in:

- `@iconify/svelte` to inline SVG. Adding an icon library for one component is the dependency-posture change this project keeps declining.
- `sanitizeHtml` dropped entirely. `caption` is a plain string in the schema and is rendered as text, so there is nothing to sanitize and no sanitizer to misconfigure.
- `imageCache` / `SkeletonImage` to a local `loaded` flag. `imagePreloader` already owns image warming here; a second caching layer would be two things doing one job.
- `modalHistory` dropped deliberately. It pushed a history entry so Android back closed the viewer. No other overlay in this app does that, and adding it to one would make that one the exception.
- Its `imageFitStyle` computed a scale from each page's known width and height. `pages[]` carries only `image_url` and an optional `caption`, so there are no intrinsic dimensions and `object-fit: contain` does the same job without them.

**A real bug found in the adaptation, worth recording because the shape recurs.** `mouseup` has to be bound to the window: a pan that ends off the stage, or outside the window, still has to finish. But the same handler also treats a release as a click-to-zoom, so **every** release anywhere in the viewer zoomed the page, including presses on the caption, the nav arrows, and the toolbar. It surfaced as Escape refusing to close: clicking the caption had silently zoomed to 120%, and Escape at >1x resets zoom before it closes. Fixed with a flag set by the stage's own `mousedown`, so the window handler can tell a release that belongs to the page from one that belongs to a control. **Generalisable: a handler on the window cannot assume the interaction started where it cares about.**

## The rolldown parse trap, for the fourth time, now in dev SSR

Recorded again because this occurrence broke a rule the previous entry stated.

The previous note says an inline JSDoc cast is "completely fine inside a `<script>` block" and only breaks in a template expression. That is not the full rule. This time the cast was inside a `<script>`, in a `$derived(...)` argument and in an arrow function's parameter list:

```js
const pageImages = $derived(
	/** @type {{ image_url?: string }[]} */ (entry.pages ?? [])
		.map((page) => page?.image_url)
		.filter((/** @type {unknown} */ url) => typeof url === 'string')
);
```

`npm run check`, `npm run lint`, **and `npm run build` all passed.** It failed only in the dev server, as `Invalid destructuring assignment target` from Vite's SSR transform, naming `+page.svelte` (an importer) rather than the file at fault.

**The corrected rule: a JSDoc cast is safe only as a block comment on its own line above a declaration. Anywhere inside an expression, including a `<script>` block, is a hazard.** The fix is always the same: hoist it to a typed `const` on its own line.

**And `npm run build` is no longer sufficient as the single gate.** It was the check that caught the previous three. This one needed the dev server actually running, which means a verification pass should load a page, not just compile one.

## LOCKED: The widget ships versioned, and the versioned URL is the one handed out

`/embed.v1.js` and `/embed.js` are both built (`vite.widget.config.js` copies one to the other), and `embedSnippet()` hands out the versioned one. `/embed.js` stays as "latest" for anyone tracking it on purpose and for snippets pasted before this existed.

They are byte-identical today, which is exactly the point. **This option cannot be added retroactively.** Once members have `<script src=".../embed.js">` sitting in their markup, the only ways to ship a breaking change are to break their sites or to ask every one of them to edit a page they pasted once and forgot about. Paying nothing now to keep that door open is a much better trade than needing it later and not having it.

The alternative considered was freezing the contract instead: one URL, and a promise never to change the tag name, attributes, or behaviour incompatibly. Rejected because a promise is not a mechanism, and the cost of being wrong lands on other people's sites rather than on this repo.

"v1" here means the widget's public contract (the `indienode-widget` tag, its attributes, its behaviour), not the app's version. A v2 would be a new file, not a bump of this one.

## LOCKED: Seed data is gated at publish, not by the validator

`npm run validate` checks shape and accepts `_placeholder: true`. `npm run validate:publish` runs the same checks and additionally hard-rejects any placeholder entry.

The split is the whole decision. `ring.json` legitimately carries four seed entries right now: they are what gives the field view content before real members exist. A blanket rule would fail the repo against its own committed data, and a validator that fails on a correct state is one people learn to ignore, which costs more than the check was worth.

The actual risk is narrower than "placeholders exist." It is "placeholders reach the live ring," which happens at exactly one moment, so the gate belongs at that moment. Default mode also now _reports_ the placeholder count rather than staying silent, since the failure mode being guarded against is nobody noticing they are still there.

Resolved: `validate-ring.yml` — which lived here when this was written and moved to `indienodes-ring` in the ring split (see the ring-split entry below) — runs `validate:publish` on every pull request that touches `ring.json` or its schema — triggered by the PR itself, not by merge or a schedule. See `docs/n8n-workflow-runbook.md` and the "PR authentication..." entry below for how that PR gets opened in the first place.

## LOCKED: The export is all local data, not just likes

Brief section 8 asks for liked entries to be downloadable and re-importable. `src/lib/localData.js` exports every `indienode:*` key instead: favorites, journal, layout, preferences, filters, volume.

Wider than the brief's wording, deliberately. "Your data lives only in your browser" is a promise that only means something if you can take all of it with you, and a visitor who moves devices, gets their likes back, and loses the field they arranged has not actually moved. The keys are stored as opaque strings rather than parsed, so adding a key later is a one-line change here and not a schema this module has to understand.

**The journal is the part that needed a decision, and the answer is to say so rather than to omit it.** It is a fuller record of someone's browsing than a like list is, and an export is the one moment it can leave the browser. The Settings panel lists exactly what is in the file and states that plainly before anything is downloaded. Leaving it out would have kept it permanently trapped on one device and reset the trail visualization on every device change, which is a worse answer to a privacy concern than informed consent is.

Import validates the envelope and refuses anything it does not recognise, rather than doing its best with a partial file: it writes directly to storage other parts of the app read on boot, and a half-understood file is how someone ends up with a corrupt layout and no idea why. Unknown keys are reported and skipped, so a file from a future version cannot inject keys this build knows nothing about.

## LOCKED: Ring scaling is a tripwire, not a build

`ring.json` is still fetched whole by every visitor, and stays that way.

The numbers this rests on were measured, not guessed: parsing costs 2ms at 1,000 entries, 14ms at 10,000, and 84ms at 50,000, and a selection-only index (id, type, tags) measures at roughly 14% of full ring size. The cost was never the parse; it was what the render path did with the result, and that was already fixed.

**The trigger: split a selection index out of `ring.json` when the file passes roughly 500 KB, or about 2,000 entries, whichever comes first.** At the current five entries that is a long way off, and building it now would be solving a problem this project does not have while adding a second file to keep in sync.

Recorded as a number rather than as "revisit when it hurts" for one reason: an unstated threshold is not a decision, it is a thing rediscovered as an emergency. Anyone touching the ring's data flow should check the file size against this line first.

## LOCKED: Display face is a sans, and Newsreader is gone

`--font-display` is Space Grotesk Variable; `--font-body` stays Karla Variable. This reverses the earlier "Type faces" entry, which paired a serif display face with a sans body.

The reason given for the change is the product's own register: this is meant to read as indie and unpolished-on-purpose, and a serif headline reads editorial, closer to a magazine than to a webring. That is a taste call and it is the owner's to make.

**Two faces rather than collapsing to one.** Aliasing `--font-display` to `--font-body` was the cheaper option (one less font download, zero dependencies) and was rejected: headings and body then become texturally identical, and hierarchy has to come entirely from weight and size, which tends to read corporate-neutral. A distinct display face is what carries the character the change is being made for.

A dependency swap, not an addition: `@fontsource-variable/newsreader` was removed as `@fontsource-variable/space-grotesk` was added, so the bundle is roughly flat and the count of runtime dependencies is unchanged.

## LOCKED: Rotation pace is per type, with defaults and a visitor control

Brief section 7c (v0.2) scopes rotation timing per content type and makes it visitor-adjustable. Both halves are now built. The single global `ROTATION_INTERVAL_MS` is gone.

Defaults, in `preferences.js`: **audio 10s, game 14s, any 14s, text 16s, comic 22s**, bounded 5s to 60s, with a slider per type in Settings.

The ladder is ordered by how long the medium takes to take in, not by preference. A few seconds is enough to decide whether a track is for you; an excerpt has to be parsed; a comic page has to be actually read, and the comic card is now cycling its own pages underneath, so it needs the longest hold of the four. `any` sits mid-range because such a node could be showing anything.

**This is a pacing control, not a filter, and the distinction is the reason it does not violate section 7c's no-filter rule.** A filter changes which entries are eligible to appear. Pace changes only how long one stays. Every entry in the pool still surfaces and the visitor still never picks what comes next. The control also lives in Settings rather than on the field itself, so the ambient surface stays free of chrome that invites decisions.

One load-bearing detail in `loadPreferences`: `rotationMs` is merged a level deeper than every other key. A plain top-level spread would let a stored object carrying only one type replace the whole map, leaving the other types undefined and their nodes rotating on `NaN`. That shape is reachable in practice from an older export, a hand-edited file, or a future build that adds a fifth type. Values are also clamped on load, so a stored file cannot produce a node that rotates every 4ms.

## LOCKED: Un-liking from Favorites confirms first, and the dialog is ours

Removing a like from `/favorites` opens a confirmation dialog. Removing one anywhere else stays immediate.

The asymmetry is the decision. On the field, un-liking costs one click to undo with the card still in front of you. On Favorites, the card is the only thing showing that entry, so it vanishes from under the pointer and the visitor has no route back except remembering what it was. That is destructive in a way the same gesture is not elsewhere, and only that case is worth interrupting.

**The app's own `Modal`, not `window.confirm()`.** A browser confirm is modal to the whole tab, cannot be themed, shows the origin next to it on some platforms, and reads as a security prompt rather than a question from the page. This is a small question about a card the visitor is looking at, so it should look like it came from that card. It also reuses the same Escape, backdrop, scroll-lock, and focus mechanics every other overlay here uses.

The destructive button is the one tinted red and the safe one is the plain outline, so the default-looking button is not the one that deletes something.

## The submission-guidance question is settled: stay neutral

`/join` presents playable audio as a bonus and link-only as a normal kind of member. That wording is now the decision rather than a placeholder awaiting one.

Pushing `archive.org` harder would raise the share of playable entries, which matters because the queue, finish detection, and the reactive background are all inert for a link-only member. It was still declined: asking a Bandcamp-only artist to re-upload their work elsewhere is real friction, the webring's entire pitch is that joining is cheap, and the benefit accrues more to this site than to the artist being asked to do the work.

What would reopen it is measurement, not preference. If the live ratio of playable to link-only turns out low enough that those three features serve almost nothing, that is evidence, and `open-questions.md` already flags that ratio as the thing to watch.

## LOCKED: Settings > Content is two independent columns, not one long stack

The tab had grown to six panels (explicit content, entry types, tags, rotation pace, your data, your discovery journal) as each of those landed separately over several rounds, and reading it meant scrolling past all six to find one.

Split left/right by kind rather than by a reflowing masonry (`column-count`): left is everything about what you see (explicit content, entry types, tags and its match count), right is everything about behavior and your data (rotation pace, export/import, the journal). Explicit placement was chosen over a CSS-columns reflow specifically so a panel can never be split across the column break and DOM order still matches reading order; a `column-count: 2` layout would have needed `break-inside: avoid` tuned against viewport widths the page was not otherwise built to reason about.

`.filter-footer` (the match-count row under Tags, and the entry-count row under the journal) used to be a standalone element between two panels, spaced by the page's own flex gap. Moved inside its panel, it needed its own top margin; the journal's copy of it sits directly under a paragraph that already carries bottom margin, so that specific pairing is overridden back to zero rather than doubling the gap.

The page's `max-width` grew from 48rem to 64rem so each column has real room: at 48rem a two-column grid left each side too narrow for the rotation sliders and tag chips to read comfortably. Appearance, which still has only two panels, just gets a little more margin around them; nothing there needed the width and nothing broke from getting it. Collapses to one column below 56rem, same idea as `/join`'s sidebar collapsing on mobile.

## LOCKED: The submission form's backend is an n8n webhook workflow, kept separate from the publishing pipeline

`submission-form-spec.md` section 5 asks the system to generate a `verification_token` and run an automated reachability check against `source_url`. Neither had an obvious home: the brief locks static site generation with no required backend for the reader or widget, and the only server named anywhere is the Docker/Semaphore/Ansible pipeline, which today only builds and deploys `ring.json` after an entry is already approved.

**A dedicated backend does exactly three things** (accept the submission, generate the token, run the check) and writes nothing to `ring.json` directly. A passing submission still becomes a pull request through the existing human spot-check and existing pipeline, unchanged from today.

**The platform is n8n, reached over a single webhook.** This was left open when the shape was first locked ("which serverless platform"), and it closed by noticing that the question underneath it had grown: the same round that made review private (below) also introduced a second surface, the review queue, and left _that_ undecided too. n8n answers both at once rather than one at a time. Its HTTP Request node is the reachability check, its own storage is the queue, a Discord or email notification carrying Approve/Reject links is the maintainer's review surface, and its GitHub node opens the final PR. One service, already run for this project's other form handling, instead of a function plus a datastore plus an admin page.

Nothing about the original reasoning changes: this is still separate from the publishing pipeline, still writes nothing to `ring.json` directly, and still is not something a reader, the widget, or the ring itself needs running. What changed is the noun, not the constraint.

**The env var that points at it is deliberately generic: `VITE_SUBMISSION_WEBHOOK_URL`, not anything naming n8n.** The site's side of this is "POST JSON to a URL and read a JSON reply," which is the entire contract; encoding the vendor into the variable name would make swapping the implementation a rename across the codebase, the `.env.example`, the Dockerfile, and the publish workflow, for no benefit at the call site.

**The browser posts to that URL directly, because there is nowhere else for it to post from.** `src/routes/+layout.js` sets `prerender = true` globally and the adapter is `adapter-static`, so no `+server.js` in this repo can ever execute in production. This has a consequence worth stating plainly rather than discovering later: the webhook URL ships inside the public client bundle. That is acceptable because the URL is not a credential and was never treated as one, but it does mean every abuse control has to live on the n8n side, and it is why the spam decision below is written the way it is.

**Rejected: extending the publishing webserver itself.** It was the more minimal-seeming option, one fewer service to run, and was turned down anyway, because it would make a server that currently only handles deploys load-bearing for intake too. That is a materially bigger claim on "no required backend" than the pipeline makes today, and the whole point of naming that promise explicitly in the brief was so it would not get widened by increments like this one.

**Rejected: skipping the automated check for a first version and verifying by eye.** Cheaper to ship, and was turned down because it leaves section 5's automated step permanently unbuilt rather than genuinely deferred; nothing about a human-only version naturally becomes the automated one later; it would need to be rebuilt as a second project rather than extended.

This also settles that **the submission form replaces the pull request and issue paths on `/join` outright rather than running alongside them.** One documented way in, once the form exists. Rejected keeping both: a form and a PR path that lead to the same place are two things to keep in sync and explain to a submitter choosing between them, for a project whose entire pitch is that joining should be simple.

`/join` now carries an explicit interim notice stating the form is not built yet and that the page will be rewritten around it when it is, rather than presenting the pull-request instructions as the settled design.

Resolved: see "LOCKED: PR authentication is a fine-grained PAT scoped to this repo, and the merge click stays manual," below, and `docs/n8n-workflow-runbook.md`.

## LOCKED: Ambient view's audio consent is a one-time confirmation, not a permanent label

**Interaction revision:** ambient entry no longer starts audio. It selects the first preview in a paused state, and the visible Play control is the action that begins playback. The one-time confirmation and storage key remain for expectation-setting, but they are no longer being used as permission to autoplay.

Brief section 11 permits ambient view's simultaneous audio-plus-visual presentation, but nothing now relies on launch itself as permission to make sound: the visible Play button is the explicit playback action. The launch control and first-use copy still carry the meaning that audio is available in the mode.

**Decided: the first press explains that the mode can play audio and that playback begins only from Play; accepting opens the mode and is remembered locally so every later launch is immediate.** The preference key remains `indienode:ambient-consent:v1`.

**Rejected: folding the meaning into the control's own label instead** (e.g. "Ambient View (plays audio)", visible always, no dialog ever). That was the more consistent option with how every other first-party action in this app already works, since nothing else here uses a confirmation dialog for a non-destructive action. It lost because a label only functions as consent if it is actually read, and a confirmation is unambiguous exactly once, at the one moment it matters, and then gets out of the way permanently rather than sitting as permanent chrome nobody looks at again.

Worth being deliberate about precedent here: this is the second confirmation dialog in the whole app. The first, Favorites' un-like prompt, guards against losing data and is not a precedent for this one, which guards a promise instead. The bar for a third dialog anywhere in this app should stay high; two is already more than the rest of the app needed.

## LOCKED: Ambient audio completion and visual interaction use separate clocks

Ambient audio no longer shares a duration with visual rotation. The selected ambient media element emits the completion signal and only that real `ended` event advances an actively playing track. Pausing, opening visual actions, or choosing a different visual cannot truncate it. The separate discovery card can explicitly replace the selection, but its own timed rotation never can.

Visual rotation pauses while its contextual interaction layer is open. A single tap gives a neutral light flash, dims the canvas, and slides two large, full-width creator rows into the center of the viewport. The audio row carries Like, Not for Me, and Visit; the visual row carries those three plus Next and Report. Tapping the dimmed area or the explicit close control dismisses the rows and resumes visual rotation with a fresh interval. Double-tap still likes the corresponding visual, but leaves the interaction layer visible so the result and its undo remain discoverable.

The square audio-discovery card is deliberately a second content lane rather than a duplicate now-playing display. It excludes the selected track, rotates between other playable nodes or another track from the same node, and slides in from the right with a cover-first surface, a small Audio chip, and an animated time-to-rotation bar. Extra clearance above the sound dock keeps the two controls visually distinct. Preview temporarily pauses the selected ambient track, plays the candidate once, and resumes from the preserved position; Play this replaces the selection. Hiding the card stops any one-off preview and returns visual prominence, while the options sheet can restore it. Playlist access stays in the bottom transport because that control belongs to what is already playing, not to discovery.

## LOCKED: Mobile's audio nav item is one open/dismiss control, and the player's × still clears

The mobile bar promoted active audio as two adjacent controls: a raised circle that toggled play/pause, and a small "Player" label beside it that opened the detail sheet. Read as one thing, which is how a nav item is read, that is a play button — so the control appeared to do something other than its actual job, which is calling up and dismissing the player.

**Decided: one control, and it toggles the sheet.** Playback is driven from inside the sheet, which has its own transport. The icon is an equalizer mark rather than a play triangle, because an icon implying playback would promise something a tap there no longer does. The whole column is the tap target, matching every sibling nav item rather than limiting the hit area to the circle.

Two consequences worth stating, since both were bugs rather than choices:

- **The sheet's × clears, on mobile as on desktop.** It used to soft-dismiss on mobile, collapsing the sheet while playback continued and leaving no way to actually stop from that surface. A close control reads as "get rid of this" on either viewport. The soft dismiss is the nav button's job, and now only its job.
- **The item sits inside the bar.** It was a raised circle pulled above the bar's edge by a negative margin, which suited it while it was the primary transport action, but as a peer nav toggle it read as clipping out of the container. It is now sized to match its siblings' icon box exactly, so its label sits on their baseline.

The attention pulse runs only while audio is playing _and_ the sheet is closed: a notification pulse exists to point at something not currently in view, and pulsing the control the visitor is already looking at has nothing left to draw attention to. It is suppressed entirely under `prefers-reduced-motion`.

Appearing and disappearing animates the item's own flex-basis (`flexReveal` in `transitions.js`) rather than only fading. The point is not this item's motion but its siblings': continuously changing its width forces the row to reflow every frame, so the other items slide over to make room instead of snapping to a new size the instant it mounts.

## LOCKED: Ambient's view controls are their own dock, not the tail of the player

Unobstructed view and the options menu sat inside the sound dock, after the transport.
Read as one surface, which is how a dock is read, that made them look like two more
playback controls that happened to do something unrelated — the same conflation of
intent that made the mobile audio nav item read as a play button.

**Decided: two docks side by side.** The sound dock speaks for the audio; a second,
auto-width dock to its right speaks for the view. A shared row positions them, so the
pair still centres as one cluster without either owning the other's controls.

Its landmark is "View and options", deliberately not "Ambient view controls": the
overlay itself is already a region named "Ambient view", and two landmarks whose names
share a prefix are a navigation problem for anyone moving between them by name.

## LOCKED: A game trailer plays with sound on request, and borrows the audio lane

`GameStage` autoplays a game's `preview_url` muted on the card, and its own note says it
"carries no control to unmute" so the no-autoplay-with-sound rule holds absolutely. That
guarantee is about the _card_, where nothing was asked for.

**Decided: ambient's tap menu offers the trailer with sound.** An explicit tap is a
request, which is the exact thing brief section 11 distinguishes from autoplay, so this
does not relax the rule — but it does relax `GameStage`'s stronger phrasing for one
surface, which is worth recording rather than leaving as an apparent contradiction.

Playing it borrows the audio lane and hands it back on close, and holds visual rotation
while it is up. No new schema: `preview_url` already exists, game-only.

## LOCKED: One helper owns "silence whatever is sounding"

Three things in ambient interrupt audio — the discovery audition, a game trailer, and
the text reader — and the first of them had grown its own pair of flags to remember
which lane it had paused. Copying that twice more is how the curation rules drifted.

**Decided: `borrowSilence` / `returnSilence`.** One thing sounds at a time is a property
of the mode, not of whichever feature is interrupting. `returnSilence` re-checks that the
preview lane still holds the track it paused, because ambient may have moved on while
the borrowed sound played, and resuming then would restart something already left behind.

## LOCKED: The text reader uses the browser's synthesiser, not a bundled model

`roadmap.md` named [tiny-tts](https://github.com/tronghieuit/tiny-tts) and left three
questions open: which voice, whose synthesis, and whether it stays local-only. Answering
them changed the pick.

**Decided: the Web Speech API's `speechSynthesis`.** tiny-tts is a genuine option —
Apache-2.0, genuinely local, one consistent voice everywhere — but it is a ~3.4 MB ONNX
model plus the ONNX Runtime WASM to run it, and what it would read is an `excerpts` array
the schema caps at three short samples. Several megabytes of neural synthesiser to read a
paragraph is the wrong trade for a project whose thesis is staying lightweight, and it
would be a dependency-posture change of the kind this document treats as significant.
`speechSynthesis` costs zero bytes and ships with the browser.

**Local-only is enforced, not promised.** The privacy hazard people associate with the
Web Speech API belongs to its other half: `SpeechRecognition` uploads audio to a vendor.
Synthesis is a separate path, and each voice carries a `localService` flag saying whether
it runs on-device. The reader refuses a remote voice outright; a device offering only
network voices reports no voice, and the control is absent rather than present and
quietly uploading the passage. That is the same unset-means-off posture Turnstile and the
Ko-fi link already use.

**Which voice: whichever local one matches the page language, preferring the platform
default.** Not a setting, because the honest set of choices differs on every OS and a
picker listing whatever this machine happens to have is not a preference worth carrying
between devices.

Reading holds the slide rather than letting rotation continue underneath, since advancing
mid-passage leaves the voice describing something no longer on screen, and it borrows the
audio lane like every other interruption: two voices at once is unusable.

**Worth revisiting if tiny-tts's voice quality turns out to matter more than the size
cost implies.** This decision was made on size and dependency posture, not on how either
option actually sounds — `speechSynthesis` quality varies a lot by platform and by
whichever local voice a given OS happens to ship, and no side-by-side listen against
tiny-tts's model has been done. If tiny-tts is meaningfully more natural, that is the
specific trade to re-run: same ~3.4 MB cost, same three-short-excerpts payload, weighed
against quality this time instead of against nothing.

## LOCKED: A rule that more than one surface needs gets a seam, not a second copy

The 2026-08-21 audit listed duplication across several components as separate findings.
The two days after it writing `AmbientView` showed they were one: that component
independently re-implemented curation, deck rotation, fullscreen handling, and an audio
element lifecycle, because there was no shared vocabulary for any of them to reach for.
The curation rule had already drifted apart by then without anyone noticing.

**Decided: when a second surface needs a rule, the rule moves into a module and both
surfaces call it — the second copy is never the answer.** `entryCuration.js`,
`entryDeck.js`, `storageKeys.js`, `fieldLayout.js`, and `viewerGestures.js` are that
applied. It is not a general push toward extraction: each exists because a specific rule
was stated in more than one place, or was impossible to test where it lived.

The corollary matters as much. **What moves is the deciding, not the machinery.**
`viewerGestures.js` holds the thresholds, while ComicViewer keeps its state machine,
timers, and element wiring — moving those would be a large refactor of code with no
coverage to protect it, which is a reason for care rather than boldness. Likewise
ambient's surfaces keep their own follow-up behaviour and call the shared rule for the
part that is shared.

**Rejected: splitting the large components first.** The audit sequenced its
recommendations that way. The splits are real work on existing pain, but they do not
compound, and the interim showed the seams do: every new surface copies what it finds.
Stopping the bleeding came first; the splits remain open and each wants its own review.

## LOCKED: One catalog owns every storage key, and portability is never a default

`localData.js` kept its own array of the keys an export carries. Adding a key to the
app therefore meant remembering to edit a second file, and five features' worth of keys
did not: twelve keys were being stored and seven were listed. Two of those gaps were
flagged in the 2026-08-21 audit; a third (ambient's consent flag) was introduced _after_
it, which is the argument for a structural fix rather than a one-time sweep.

**Decided: `src/lib/storageKeys.js` is the single catalog** — every key with its label,
whether it is exportable, and, when it is not, why. `localData.js` derives its lists
from it rather than restating them.

`exportable` has no default. A key that omits it fails the catalog's own test, as does a
key that appears in source without being catalogued at all — the test scans `src/` for
`indienode:*` literals and compares. That is what stops the next feature from silently
opting itself out of export, which is exactly how the drift happened.

**Non-exportable is a real answer, but it has to be an argued one.** Three keys are held
back, each with a stated reason: the two form drafts, because they hold a contact email
the visitor has not chosen to submit and an export is a file that moves between devices
over channels this app cannot see; and the minimized player position, because it is
viewport-specific pixel geometry that gets clamped back into bounds on a different
screen anyway.

Skin selection and the ambient consent acknowledgement are now exported. Both are
preferences in the same tier as theme, and a visitor who moves devices and gets their
likes back but loses their skin has not really moved.

**Rejected: deriving the catalog from a scan instead of declaring it.** The scan is the
right _check_ but the wrong source: it can tell you a key exists, never whether it should
travel, and a scan-driven registry would make every new key exportable by default —
which for a draft holding an email address is the one direction that must never be
automatic.

**Every store reads and writes through the catalog's helpers, and the key literals live
only there.** Five stores — favorites, hidden, filters, skins, preferences — wrote
without a guard, so a private window or a full quota threw out of the click handler and
the interaction _failed_ rather than merely not persisting. `safeReadJson` /
`safeWriteJson` make that one contract in one place. Stores import
`STORAGE_KEYS.<name>.key` rather than repeating the string, and the catalog's test fails
on a raw `indienode:*` literal anywhere in production code, since a key written outside
the catalog is a key that skipped the portability decision.

Test files are exempt from that rule, and the catalog's test pins all twelve literals
instead: a key is where a visitor's data already lives, so renaming one silently orphans
it, and that should have to be a deliberate, visible change rather than a rename that
type-checks cleanly.

## LOCKED: Ambient view adopts a queue it finds playing rather than previewing over it

Ambient entry used to deal its own audio unconditionally, through the preview lane, which ducked whatever the visitor already had playing down to silence and started something unrelated. The lane choice was right — a preview never disturbs a hand-built queue — but applying it to _every_ entry made the mode read as a second, separate player that had discarded the queue on the way in.

**Decided: if a queue is already playing when ambient opens, ambient speaks for that queue instead of dealing over it.** The bottom dock becomes a view onto the real queue: its transport drives `audioPlayerStore.toggle()`, its metadata comes from the current queue item, and the playlist sheet shows what it always showed. Only when nothing is queued does ambient deal its own audio into the preview lane, exactly as before.

Leaving adopted mode is always an explicit act, never incidental: pressing Play this on the discovery card, or anything else that calls `advanceAudio`, hands the sound to ambient and ducks the queue underneath — never clears it — and exiting restores the prior context. This keeps the original guarantee ("a queue built before entering is ducked, not replaced") while removing the case where the visitor never asked for a replacement in the first place.

**Rejected: always adopting, and dropping the preview lane from ambient entirely.** Ambient's whole discovery premise is that it can offer audio the visitor did not pick, which needs a lane that is not the queue.

## LOCKED: Output volume is a store, not player-component state

Volume began as component state on `AudioPlayer.svelte`, correctly reasoned at the time: it is a property of this device's playback rather than of the queue, so it did not belong in `audioPlayerStore`. That reasoning still holds and the value still does not belong in the queue store.

What changed is that `AudioPlayer` stopped being the only thing that makes sound. Ambient view owns a third element for its one-off discovery previews, and with the value trapped in a sibling component that element had no way to read it: every ambient audition played at full volume regardless of the slider, and went on sounding while the player was muted.

**Decided: volume and mute live in `audioSettingsStore.svelte.js`, which every sounding element reads.** Consumers read `outputVolume` rather than combining volume and mute themselves, so "muted means zero" is stated once. The storage key is unchanged (`indienode:volume:v1`), so this is invisible to local-data export. Mute stays session-only for the same reason it always was: restoring one on a later visit presents as an app that plays nothing.

## LOCKED: Unobstructed view removes our chrome; a track change announces itself

Ambient already requests element fullscreen on entry, which removes the _browser's_ furniture but leaves the dock, the discovery card, and every other control this app draws. There was no way to reach the mode's actual premise — a screen showing nothing but rotating visual work.

**Decided: an unobstructed toggle in the dock and the options sheet hides all ambient chrome, and a single tap anywhere brings it back.** Entering states the way out once, because in that mode there is deliberately no visible control left to infer it from. Double-tap-to-like is suppressed while unobstructed so the single tap has one unambiguous meaning.

That mode removes the only thing reporting playback, which is why it arrives with its own answer: **a track change raises a brief "Now playing" announcement.** It is deliberately not gated on playback having started — ambient deals its first track paused, so requiring that meant the seed was never taken and the first _real_ change was swallowed as though it were the first track. What is suppressed is the first track seen in a session, which is the one the visitor already knows about. `role="status"` with `aria-live="polite"`, not an alert: a track change is informational and should not interrupt a screen reader mid-sentence.

## LOCKED: Ambient hands off to the reader by releasing fullscreen, not by re-mounting it

Ambient's tap menu offers the comic reader for a visual that has pages, so a sample can actually be read rather than only watched rotating past.

The reader is mounted once at the root layout (see `comicViewerStore`'s own note), which makes it a _sibling_ of the element holding browser fullscreen — and a fullscreen element renders only itself and its descendants, so the reader would have opened invisibly underneath.

**Decided: releasing fullscreen is the handoff.** Ambient exits element fullscreen before showing the reader, and its own `fullscreenchange` listener ignores that exit rather than reading it as the visitor leaving the mode. The overlay is `position: fixed` over the viewport, so ambient stays exactly where it was underneath, and the reader offers its own fullscreen control.

**Rejected: mounting a second reader inside the ambient overlay.** Two mounts driven by one store means two readers open at once, and it would duplicate a 1,250-line component to work around a stacking rule.

## LOCKED: A game entry's "the game itself" is `source_url`, nothing type-specific

Raised as an open question and closed by noticing it was already answered: every entry type links out through the same field, and a game asking for a second, dedicated destination would be the one type carrying a field no other type has for no stated reason. Wherever the developer says the game lives (a storefront page, their own site) is exactly what `source_url` and the Visit control already point at.

## LOCKED: The submission form reviews privately first, and a pull request is the last step, not the review surface

Section 5's original design (`submission-form-spec.md` v0.2) had a passing automated check open a public PR immediately, with a human reviewing the submission there. Revisited once email entered the picture: this project now collects an email address at submission time, and a public PR is the wrong place for one to ever sit, even briefly.

**A passing submission lands in a private review queue instead. A human reviews everything from inside it, including email, and only approval opens a PR.** That PR carries just the `ring.json`-shaped public fields; email and every other Section 2.2 field are stripped before it exists and the email itself is deleted from the queue at that point. Nothing about a submission is public until a human has already looked at all of it and said yes.

**Rejected: keeping the automated check as the only gate, with no human review at all.** Considered and turned down in the same round this was decided: the automated check is fast and worth keeping as a pre-filter, but it stays exactly that, a pre-filter. A human reviews every submission regardless of whether it passed, which is what the thin-moderation standard already committed to before email ever entered the picture; nothing about adding email changes that half of the decision.

**Rejected: an async check with no synchronous confirmation, notified later by email.** This was the shape section 5 implied before v0.2's "Verify" step existed, and it does not survive contact with "no accounts": before email was collected there was no channel to reach a submitter after they left the page at all, which is what made the synchronous in-form Verify step (locked last round) the only workable design. Email does not reopen this. It is scoped to one submission's own resolution, not to standing outreach, so it is used to report a review outcome after the fact, not to replace the up-front synchronous check that already has to happen before anything is public.

**The PR did not go away, and it is worth being explicit about why it stayed.** It is still the best-fit tool this project already has for a human to look over one JSON object before it joins a public, versioned file, which is exactly what a PR review is. What changed is only when it happens: last, after a human has already approved the submission from the private queue, rather than first, as the review surface itself. A submitter's email is never part of it.

**`email` itself is scoped to this submission's own back-and-forth only, and that scope was a real choice, not the only option on the table.** The alternative on offer was a standing mailing list, "updates on the Webring" read literally as something a member hears from again later, not just about their own submission. That was declined: it is a materially bigger feature than a submission form needs, it would need its own retention policy and an unsubscribe mechanism, and it sits uneasily against the brief's anti-surveillance premise even though a mailing list is not technically an account. What shipped instead: email is retained only until the submission it belongs to is resolved, approved or rejected, and deleted after either outcome. It is never written to `ring.json` and never appears in the pull request Section 5 eventually opens.

**The review queue is n8n-native, and that is what closed the last open piece of this decision.** When this was first locked, where the queue lives and what a maintainer looks at were called out as a real second surface that should be decided on its own terms rather than assumed to come for free. It was decided on its own terms, and the answer is that it comes for free after all, because the platform chosen for intake already has both halves: n8n holds the pending submission, and the maintainer's surface is a Discord or email notification carrying signed one-time Approve and Reject links. No database, and no protected admin page to build.

**Rejected: a datastore plus a small admin page** (a table the maintainer browses, filters, and revisits). It is the more durable and more auditable option, and it lost on scale: this is a webring reviewing entries one at a time, not a queue deep enough to need browsing or filtering. A notification a maintainer acts on immediately is the whole job, and the rejected version adds a service to run and a second authenticated surface to secure for a workload that never justifies either.

Approval is also where `email` deletion stops being policy and becomes mechanism: the same workflow run that opens the PR strips and deletes the entire Section 2.2 block, so there is no window in which the queue holds an email for a submission that is already public, and no cleanup job that has to be trusted to run later.

**Resolved:** see "LOCKED: PR authentication is a fine-grained PAT scoped to this repo, and the merge click stays manual," below, and `docs/n8n-workflow-runbook.md`.

## LOCKED: PR authentication is a fine-grained PAT scoped to this repo, and the merge click stays manual

Two things this and the entry above both flagged as open: how the n8n workflow authenticates to GitHub to open the PR, and whether that PR still needs a separate human merge click given a maintainer already approved the submission a step earlier in the queue. Both are now decided.

**The GitHub node authenticates as a fine-grained Personal Access Token scoped to only this repository**, with `Contents: Read & Write` and `Pull requests: Read & Write` permissions, stored as an n8n credential. Not a GitHub App, not a classic full-access PAT, not a separate bot user account. Fine-grained plus single-repo scope is the smallest blast radius GitHub's PAT model offers for what this needs to do, and it lives entirely inside n8n's own credential store — never touching this repo's secrets, because there is nowhere in a static-`adapter-static` repo to hold a secret at runtime anyway, the same reasoning `.env.example`'s Turnstile section already gives for its secret key.

**The merge click stays manual.** `submission-form-spec.md` section 7 already reasoned through this as a "working recommendation"; this makes it final rather than provisional. `npm run validate:publish` needs to run against the composed file at merge time, and a maintainer approving an entry in the private queue is not the same act as confirming the file it produces still validates — those are different moments and different checks. A CI check that runs `validate:publish` on the PR (see the new `validate-ring.yml` workflow) is what makes this concrete: a required check only means something if a human merge step still exists to gate on it, since an auto-merge would make the check purely decorative once queue-approval already happened.

See `docs/n8n-workflow-runbook.md` for the PR-creation mechanics this decision governs.

## LOCKED: The verification token is issued by the backend, never chosen by the submitter

`/join` currently instructs submitters to pick their own random string as a `verification_token`, which is what the page could offer with no backend to ask. `submission-form-spec.md` section 2.2 has always said system-generated. The page, not the spec, was wrong, and this closes the gap in the spec's favor.

The reason is not tidiness. **A submitter-chosen token is not a proof of control at all.** The check is "does this string appear at that URL," so anyone free to choose the string can choose one that is _already_ there: a word from the page's own text, a phrase from someone else's profile bio. A token they pick and a token they find are indistinguishable to the check, which means the whole verification step can be passed against a page the submitter has never had access to. A backend-issued random token cannot be selected for that property, because the submitter learns it only after the URL is already committed.

That last clause is load-bearing and is why the flow issues the token against a stored `source_url` rather than accepting one at submit time. If the workflow verified whatever URL the final submission happened to carry, a submitter could verify a page they control and submit a different one, and verification would be decorative. The URL the token was issued for is the URL that gets checked, and it is re-checked server-side at submit.

**Rejected: generating the token client-side with `crypto.randomUUID()`.** It is genuinely random and needs no round trip, and it lost because the randomness is not the part that matters. Anything the client generates, the client can also replace before sending, so the guarantee reduces to trusting the submitter not to substitute a string they already found on the target page, which is exactly the property the backend-issued token exists to remove.

## LOCKED: Submission spam defense is honeypot plus dwell time plus server-side rate limiting, and no third-party scripts

The webhook URL is public (see the backend decision above), so the form is callable by anything that reads the page source. Something has to stand between that and the review queue, because the queue's cost is a human reading every item in it.

**What shipped:** a honeypot field a real submitter never sees and never fills, a minimum elapsed time between first keystroke and submit, and rate limiting plus duplicate detection inside n8n keyed on a salted hash of `source_url`. The first two are free and client-side; the third is the one that actually enforces anything. A verified voluntary removal bypasses the wait because a recent join or update must not force someone to remain published; the accepted removal still records the normal hash and timestamp, so later submissions remain limited.

**Superseded 2026-08-31: Cloudflare Turnstile was added after all** (see `.env.example`'s `VITE_TURNSTILE_SITE_KEY` section, `docs/n8n-workflow-runbook.md` §2.2, and `TURNSTILE_ENABLED` in `scripts/n8n/build_workflows.py` — no dedicated LOCKED entry exists for this one, so those are the record), guarding `submit_update`/`request_removal`/Contact. The paragraph immediately below is kept as-written for the record of what was actually decided at the time and why — the anti-surveillance reasoning still holds for `issue_token`/`verify`/`submit` on `/join`, which stayed unguarded — but treat any line below claiming "no third-party script of any kind" as describing a state this project no longer fully occupies, not the current one.

With Turnstile now doing the actual bot-defense job, the rate-limit window's remaining job is narrower — bounding how often one source can add a fresh row to the human review queue, not stopping bots on its own — which is why it was shortened from one hour to ten minutes the same day. That is a change to the window's value, not to this decision's shape: same key, same read/write split, same removal exemption.

**Original reasoning, as decided (see the note above for what has since changed): Rejected Cloudflare Turnstile or any equivalent CAPTCHA.** It is materially better at stopping real bots, and it was turned down because this site currently loads no third-party script of any kind and that is a property worth more than the marginal filtering. The brief's anti-surveillance premise is not satisfied by picking the most privacy-respecting challenge widget; it is satisfied by not embedding someone else's script in a page that has none. If submission spam ever becomes a real operational problem rather than a hypothetical one, this is the first thing to revisit, and it should be revisited as an explicit trade rather than added quietly.

**State the limitation rather than letting it be inferred:** a honeypot and a dwell timer are noise filters, not security. They stop opportunistic form-spam bots and stop nothing that has been aimed at this specific form by a person. Every guarantee that actually matters here (the token is unguessable, the URL is re-verified, a human approves before anything is public) lives on the server side and does not depend on either of them.

There is one real tension this creates with `submission-form-spec.md` section 5 step 9, which says nothing about a rejected submission is retained past its rejection: rate limiting and duplicate detection need memory, by definition. Resolved by retaining only a salted hash of `source_url` and a timestamp, which is enough to recognize a repeat and not enough to reconstruct who submitted what.

## LOCKED: `/update` previews the rate limit before the form, not after it

Reported 2026-08-31: a visitor could fill out the entire change-request form, generate a verification token, place it, pass Turnstile, and only then be told at final submit — via `rate_status` (formerly a plain "please wait" message with no further information) — to come back later. Everything up to that point was wasted.

**What shipped:** `Webring - Intake v2` gained a `rate_status` action (`docs/n8n-workflow-runbook.md` §2.2) — a read-only lookup of the exact same `rate_limits` bucket the real gate checks, called from `/update`'s identify step the moment `updateStore.svelte.js`'s `select()` finds a node, before the visitor has done anything a bot-gate or Turnstile would apply to. It returns `{ blocked, retry_after_seconds }` and nothing else: no timestamps, no row contents, no indication of _what_ was submitted, only whether a fresh submission for this URL would currently be limited. `submissionApi.js`'s `checkRateStatus` never throws — a network failure or closed backend just means the note doesn't render, exactly the "not a security boundary" posture this module's own top comment already gives the node lookup itself.

**Accepted trade: a small new oracle.** Before this, learning "has this source_url submitted recently" required actually attempting the flow yourself. Now it is one unauthenticated request away, for anyone who already knows (or guesses) the exact canonical URL. This was accepted rather than gated behind ownership proof, for two reasons: the check requires knowing a public URL, not a secret, to begin with, and the response is minimal enough (a boolean and a countdown, never a timestamp or row identity) that it discloses less than a working knowledge of when someone last touched their own listing would. If this ever needs tightening, the fix is Turnstile-gating this action too — deliberately not done here, because that would defeat the point: the whole value of asking early is asking _before_ a challenge, not after.

**Rejected: folding the check into `updateStore`'s existing lookup being a security boundary.** It stays exactly as advisory as the lookup already was — the real gate, with its full `resume`/`is_removal` exemptions this pre-check does not have, still runs server-side at actual submit time. A visitor who is told "you can retry in 8 minutes" and takes 20 minutes filling out the form will simply not be blocked when they get there; the reverse (told clear, blocked at submit) is also possible if they submit within the same minute the check ran. Both are acceptable because the note only ever changes when a "Continue" button is enabled, never whether one is.

## LOCKED: A creator with no site of their own gets one generated, and third-party-profile-token verification is retired in its favor

The submission form always assumed a submitter already had a `source_url` they controlled. That assumption was never actually true for every creator this project wants to reach, and the form's own third-party-profile-token fallback (pasting a token into a Bandcamp bio, a SoundCloud description) existed specifically to cover the gap: someone with a platform presence but nowhere self-owned to prove control over.

**Decided: give that creator somewhere self-owned instead of asking them to prove control over somewhere they do not own.** `/join`'s `entry` step now asks directly ("Do you already have a site you control?"), and answering no branches into a client-side site generator: up to three uploaded works, an optional icon, optional social links, a choice between multiple hand-designed templates per creator type with a live preview, and a downloadable zip the creator uploads wherever they like (Neocities is the suggested default, nothing hardcodes it).

**Rejected: keeping third-party-profile-token verification as a permanent fallback alongside the generator.** It was tempting to keep both paths live indefinitely, but the entire reason that fallback existed was the absence of an easy way to get self-owned space, and the generator removes that absence for exactly the population who needed it. Keeping a second, weaker verification path alive after that would mean maintaining two ownership proofs of different strength for no remaining reason: a token in a bio proves someone can edit a bio, not that they own an origin, which was always the weaker claim of the two. **Deprecated as of `submission-form-spec.md` v0.5.**

**The templates are deliberately not IndieNodes' own glassmorphic design.** These are the creator's own external pages, not IndieNodes-branded surfaces, and dressing them in this project's own visual language would misrepresent whose page a visitor has landed on. Each template (`src/lib/generator/templates/`) is a plain function returning `{html, css, js}` strings, system-fonts only, no framework runtime shipped in the export — the generator tool itself is SvelteKit, but nothing it produces requires a browser to run Svelte to render.

**The verification token's timing had to change, not just its delivery mechanism.** Every other path issues a token against a `source_url` that already exists. The generator branch has no URL at the point a token would normally be issued: the token has to be baked into the exported HTML _before_ the creator uploads it anywhere. `issue_token`'s `source_url` became nullable to allow this, and a new action, `bind_source_url`, attaches the real URL once the creator has one, as its own explicit step rather than a second call to `issue_token` — allowing that call to be repeated with a different URL each time would let a submitter mint a token against one page and quietly retarget it to another, the exact hole the rest of this verification design exists to close.

**Rejected: storing the works' actual files inside the same draft `localStorage` already used for the rest of the form.** `localStorage` only holds strings; the generator draft holds real image and audio `Blob`s (an icon, page images, a screenshot, track files), and base64-encoding them into a text store would inflate each by roughly a third and hold the inflated copy in memory on every read. The generator keeps its own draft in IndexedDB instead (`src/lib/generator/draftDb.js`), which stores `Blob`s natively, with the same 30-day-since-last-edit expiry and resume-or-restart shape the rest of the form already established for its own draft.

**A generated site answers ownership, not necessarily in-ring playback.** An audio `media_url` still needs a host that sends CORS headers, and a static host a creator picks for hosting a generated page will not necessarily send them by default. The generator flow surfaces the same hosting guidance the `prep` step already gives audio creators, rather than implying "host anywhere" is sufficient for a track to actually play inside the ring.

## LOCKED: A node represents a creator, not a single work — `title` is removed, `why` absorbs it, `creator_id` links a creator's own nodes

Sourced from a standalone addendum (`tmp/IndieNode_v2_Addendum_CreatorNodes_and_Maintenance.md`), reframing what a `ring.json` entry actually is. The three submitted works (tracks, pages, excerpt) were never a preview of one project; they are curated evidence of why a creator is worth a visitor's attention, pulled from across whatever that creator has made. The old `title` field tried to serve both a creator-level introduction and a work-level name at once, which is the ambiguity this closes: there is no more work-level naming to do at the entry level (tracks already have `label`, pages already have `caption`), so `title` is dropped from the schema and the form entirely, and `why` absorbs its introduction role, becoming the one field where a creator makes their case.

**`why` gets a hard cap of 75 characters**, enforced client-side only (`submissionValidation.js`'s `WHY_MAX_LENGTH`), not in `schema/ring.schema.json` — consistent with how this file already treats `why`'s length as a product decision rather than a data-integrity one (see `submissionValidation.test.js`'s `formOnly` cases). This supersedes the initial 160-character limit: 75 keeps the one-line pitch compact on a node while still leaving enough room for a clear creator introduction.

**Every reader-side surface that showed `title` now shows `creator` as the heading instead, with `why` as the subline beneath it**: `FieldNode`'s card (`.title` renamed `.creator-name`), `AudioPlayer`'s now-playing/preview/queue text (which fall back to a track's own `label` where one exists, rather than a work-level name that no longer does), `ComicViewer`'s reader header, the Members list, and the Favorites unlike-confirmation modal. None of these had a field that was a true drop-in substitute — `creator` and `why` were always shown _alongside_ `title`, never instead of it — so this was a real display decision in each place, not a mechanical rename, resolved the same way everywhere: creator is identity, why is pitch.

**`id` generation drops `title` from its slug composition** (`src/lib/slug.js`'s `entrySlug`): now `type`-`creator` only, truncated, with the existing numeric-suffix collision handling doing double duty as the disambiguator for two nodes from the same creator and type — which is also exactly the case the addendum's two-linked-nodes cap exists to keep bounded.

**`creator_id` is added to the schema as an optional, backend-assigned field**, mirroring `id`: never a form field, added by the submission workflow, a data-only link with no ranking or weighting logic reading it. What it enables (reusing ownership verification across a creator's linked nodes, a reader-facing "also by this creator" surface) is described in the addendum but not built this round — only the schema field itself landed, so the workflow has somewhere to write the link when that logic exists.

**Not built this round: the addendum's Section C (node maintenance and updates)** — a creator-initiated edit flow, keyed to an existing node id, re-running the same ownership verification used at submission, with a narrower review checklist than a first-time submission. This is a genuinely new form/workflow, not a schema change, and is scoped separately from the display and data-model work above.

**Not decided this round: how the backend actually determines two submissions share a `creator_id`.** The addendum locks the field and its cap, not the matching mechanism (verified `source_url` overlap, an explicit form question, something else) — left for whoever builds the linking logic in the submission workflow.

## LOCKED: Arrange and Theme move out of the desktop drawer into their own floating cluster; the drawer gains its own brand header

`NavDrawer` originally held Arrange and `ThemeToggle` (`drawer` variant) at the bottom of its own link list, alongside the destinations above them, reachable only while the drawer was open. Moved out to a new bottom-right floating pair (`+layout.svelte`'s `.desktop-tools`), the desktop counterpart to `.mobile-tools` (top-right) which already carried the same two controls on mobile for the same reason: neither is a destination the way every item in the drawer's nav list is, and pinning them on screen means reaching either no longer requires opening the drawer first. Theme sits closest to the corner; Arrange sits to its left, gated to the Field route exactly as it already was inside the drawer and in `.mobile-tools`.

Both floating clusters now share one `{#snippet arrangeButton()}` in `+layout.svelte` rather than two copies of the same markup, and `.tool-button`'s styling moved out of the mobile-only `@media` block that used to be its only consumer, since `.desktop-tools` needs the identical button above that breakpoint now too.

**The drawer's own top gained a brand header** (logo plus "IndieNodes", linking home): with the floating top-left brand mark (`.brand-float`) sitting underneath the drawer's own backdrop once open, the drawer had no branding of its own visible while it was the thing on screen. `ThemeToggle`'s `drawer` variant is now unused (the `pill` and `icon` variants both still are) but was left in place rather than deleted — a presentation an existing prop already describes, costs nothing to keep, and removing it would be exactly the kind of speculative cleanup this codebase otherwise avoids doing preemptively.

**First pass used `Logo.svelte`, the wrong one, and had to be corrected — twice.** That component was the abstract four-square chrome mark — deliberately simple, tied to the type-color tokens, built for the favicon and `.brand-float` (see "LOCKED: Logo is four rounded nodes" above) — not the actual logo. The drawer header was corrected first, to use the real logo the same way `AboutModal` and `RingLoading` already do: `static/images/IndieNodes_Logo.webp` by its served path, `border-radius: var(--radius-sm)` at the drawer's small size rather than `AboutModal`'s larger `--radius-md`. `.brand-float` (the floating top-left pill, `+layout.svelte`) was still using `Logo.svelte` at that point and got the same correction in a follow-up round, at which point the component had no remaining callers anywhere in the app and was deleted outright rather than left as dead code. Favicon.svg is a separate, hand-built SVG file and is untouched by any of this — the LOCKED decision above still describes it accurately, it just no longer describes anything else. Worth naming because it was an easy mistake to repeat _twice_: both assets are called "the logo," both were already in use somewhere in the app, and the abstract mark being the nearer, simpler one made it the wrong default to reach for without checking, in two separate places.

## LOCKED: Every generator template embeds a real, working ring widget in its footer by default

The `/join` form's success screen used to only ever _tell_ a creator to paste the widget snippet in themselves ("One last thing: the widget... Paste this wherever you would like it on your site"). For the no-site branch specifically, that instruction was solvable the same way the rest of that page already is: the generator already builds and owns the whole file, so it can just include the working widget rather than asking the creator to add one more thing by hand.

**`widgetEmbedHtml` (`templates/shared.js`) wraps the real embed markup** (`src/routes/widget/embed-snippet.js`'s own `<script type="module">` + `<indienode-widget>` pair — the exact thing a creator with their own existing site is still told to paste manually) in a centered `<div class="ring-widget">`, filled into a new `{{WIDGET_EMBED}}` token in all four templates' footers. `text/marginalia` had no `<footer>` at all before this — it gained a minimal one, since embedding the widget bare inside `<main>` would have read as part of the excerpt rather than as site chrome the way the other three templates' footers already do.

**The embedded `site-id` is `provisionalId`** (`+page.svelte`'s own best-guess slug, the same one the review step already shows labeled "may change"), not the generic `your-ring-entry-id` placeholder the manual instructions still use — it is very likely the real id, since the backend only diverges from it on a genuine collision at approval time. `README.txt` in the exported zip now says as much, and how to fix it by hand if it does not match: the same "editable directly" posture the rest of the export already has, not a promise that it is guaranteed correct.

**The success screen's own widget instructions now branch on `has_own_site`.** A creator who used the generator sees a short "already in your footer, nothing to paste" note instead of the snippet block and manual instructions, which stay unchanged for a creator who brought their own existing site and genuinely does still need to add it by hand.

## FIXED: A no-site creator's page name looked filled in, but "Continue" stayed disabled

`site` step's "Name to show" field shows the entry step's creator name as its `placeholder` ("Defaults to your name or studio from the entry step"), not its `value` — the visible ghost text made the field read as already answered, but the underlying `generator.displayName` stayed empty until someone actually typed into it. `submissionStore.svelte.js`'s `isStepComplete('site')` required `displayName` truthy on its own, so Continue stayed disabled behind what looked like a completed field, for anyone who read the placeholder as the answer and moved on (which is exactly what "Defaults to..." tells them to do).

The real export was never affected — `generator/data.js`'s `buildGeneratorData` already falls back to `entry.creator` when `displayName` is empty, so an exported site always got a name either way. Only the completeness _check_ had drifted out of sync with that fallback. Fixed by mirroring it: `isStepComplete('site')` now accepts either `displayName` or `entry.creator`, matching what the field's own hint text already promises rather than requiring a redundant retype of a name already given one step earlier.

## Arrange mode's dot grid ripples once when it turns on

A one-shot flourish, not a persistent effect: `FieldGrid.svelte` watches `editMode`'s own false-to-true edge and, for that moment only, layers a transient `.dot-wave` overlay — one absolutely-positioned column per grid column, each repeating the exact same radial-gradient dot pattern as the resting `.grid-stack.edit-mode` background (just clipped to one cell's width), animating a rise-and-settle (`translateY`/`scaleY`) with a per-column stagger (`animation-delay: calc(var(--i) * 30ms)`). A `setTimeout` sized to the animation's own total duration (last column's delay plus its own length) then clears the overlay, leaving the plain background-image dot grid underneath exactly as it already was — this is layered on top of that background, not a replacement for it, since a `background-image` cannot itself animate per-column.

**Why an overlay rather than converting the resting dot grid to real per-column elements outright:** the existing single-`background-image` grid is already the simpler, cheaper implementation for something that sits static for the entire rest of an arrange session, and this animation is only ever needed for under half a second right at the start of one. Paying the overlay's DOM cost (one element per column) only while it is actually animating, rather than for the whole time arrange mode is on, keeps the common case unchanged.

**Skipped entirely under `prefers-reduced-motion`** (`$lib/motion.svelte.js`'s shared `reducedMotion` reader), rather than played at zero duration: this flourish carries no state of its own for a visitor to lose track of by not seeing it, unlike this project's page transitions or modal enters, so there is nothing this one needs to communicate that skipping it silently loses.

## FIXED: A short `/join` step left dead space below its own buttons instead of shrinking to fit

`.panel` and `.step-body` (above the 60.01rem breakpoint that makes this page a fixed-height single screen — see "LOCKED: The main nav collapsed into a drawer..." and the `.join-page` comment near the top of `+page.svelte`'s styles) both used `height: 100%`, unconditionally stretching to the full space `.join-page`'s `calc(100dvh - ...)` reserves, regardless of how much the current step's own content actually needed. A long step (consent, or the generator's "Your page" step) genuinely fills that space and scrolls internally as intended; a short one (Start, Ownership) does not, and the leftover reserved height showed up as unbordered blank space below that step's own action buttons — worse the taller the viewport, since more of `.join-page`'s fixed budget went unclaimed.

Changed both to `max-height: 100%`: still clamps a long step at exactly the same cap (confirmed a full generator-step run still measures the same height and still reports `scrollHeight > clientHeight`, i.e. still internally scrollable, unchanged), but a short step's `.panel` now sizes to its own content and stops there — its buttons sit right after what precedes them, the same way `.panel`'s natural (non-flex-forced) sizing would work anywhere else in this file. Verified directly: the "Start" step's `.panel` now measures ~692px tall against the ~844px the fixed-height budget makes available on a 1281px-tall viewport, versus stretching to the full 844px before.

**Follow-up: `.join-layout` also needed `overflow: hidden`, which let the preview iframe grow back up.** `max-height: 100%` on `.panel`/`.step-body` alone was not quite the full story — `.join-layout` itself (their flex ancestor, `flex: 1; min-height: 0;`) could still be pushed taller than its own flex-constrained allotment by a tall enough child, `min-height: 0` alone being not quite a hard guarantee against that in every case. Adding `overflow: hidden` to `.join-layout` closes that gap directly: nothing rendered inside it, regardless of how tall, can grow the fixed-height screen itself past what `.join-page`'s `calc(100dvh - ...)` budget allows — belt and suspenders with the `max-height` clamp one level in. With that hard cap actually holding, `.preview-frame`'s height (shrunk in stages, 32rem → 22rem → 15rem, while chasing this same "step reads too long" symptom directly) no longer needed to be that small just to keep the step contained — restored to 31rem, short only of the original 32rem, since a genuinely useful preview was never actually in tension with the fix; the earlier shrinking was compensating for a containment gap, not a size the preview needed to give up on its own merits.

## LOCKED: "Not for Me" is a hard-hide personalization control, mutually exclusive with liking, built to the addendum that amended brief section 8 (and sections 3, 7c, 11) to v0.5

This was built twice in one session. The first pass shipped independent like/hide stores, an instant card swap on dismissal, and no reader/player surfaces beyond the field and Lists — before the actual amendment (`tmp/not-for-me-claude-code-prompt.md`, encoded into `IndieNode_v2_Brief.md` v0.5) was found and reviewed against it. Several of that first pass's own LOCKED decisions were wrong against the real spec and are corrected here rather than left standing; this entry describes what's actually built.

**Two node-level controls, mutually exclusive (brief section 8).** `hiddenStore` (`src/lib/hiddenStore.svelte.js`) is the same shape and storage tier as `favoritesStore` (a `SvelteSet` of ids in localStorage, nothing sent to a server), but the two are not independent: `FieldNode`'s `handleLike` clears a hide before liking, and `handleHide` clears a like before hiding, so an entry is never marked both at once. `AudioPlayer` and `ComicViewer` each carry their own copy of the same pair of handlers (mirroring how `AudioPlayer`'s like handler already mirrored `FieldNode`'s, before this), so acting from the player, the reader, a field card, or Lists is the same action everywhere rather than four that can drift apart.

**Storage keys stay neutral, and `favoritesStore`'s existing key is deliberately not renamed to match.** The brief says storage keys must not follow UI copy, precisely so a later label change never forces a migration. `hiddenStore` uses `indienode:hidden:v1`, which already satisfies that. `favoritesStore` predates this brief and uses `indienode:favorites:v1`, not the brief's own example name `likes` — left alone on purpose. Renaming it now, to bring it in line with a document that names it only as an illustration of the _principle_, would be exactly the kind of migration the principle exists to avoid, for a visitor with an existing local `favorites` key.

**"Goes quiet in place," not an instant swap (brief section 11).** This reverses the first pass's own explicit design. `src/routes/+page.svelte`'s `entries` (ring-visibility and tag filtered, feeding `byId`) deliberately does **not** filter out hidden ids, so a currently-assigned entry that gets hidden stays resolvable and `reconcile()`'s "is my current pick still valid" check keeps calling it valid — nothing forces it off screen. A new `eligibleEntries` (`entries` minus hidden) is what `poolsByType`/`takeNext` actually draw from, so a hidden entry stops being _offered_ to any slot immediately, while whatever's already showing it stays until that slot's own scheduled rotation. `FieldNode` gets a new `ambient` prop (true only from `FieldSlot`, never from Lists) that drives a `.quiet` class on exactly this case: the backdrop, stage, scrim, and content band dim and desaturate, `.content`'s controls go inert, and only the top-row like/hide toggles stay reachable, so the visitor can undo a mis-click without the card also staying fully inviting.

**Field controls reveal on hover/focus only, in the field specifically (brief section 8).** Same `ambient` prop: `.curate-controls` sits at `opacity: 0` until `.node:hover` or `.node:focus-within`, so a resting field doesn't read as a rating grid. Lists never sets `ambient`, so its controls stay permanently visible there, which is the point of a page meant for reviewing what's been marked either way.

**Pool exhaustion messaging distinguishes "the ring is small" from "your Not for Me list did this" (brief section 7c).** `shortageCause(type)` in `+page.svelte` compares a type's count in `entries` (ignoring hidden) against its count in `eligibleEntries`: zero in the former means the ring itself doesn't have enough, and zero in the latter with something hidden means the visitor's own list emptied it. `EmptyNode` branches its message on this per slot, and the page's own top-level "nothing assigned anywhere" state (`visibleCount === 0`, previously only ever "the ring is empty right now") got the identical branch, since hiding literally everything on a small ring hits that path instead of any single `EmptyNode`, and saying "the ring is empty" there would have been false in exactly the case this section exists to describe correctly.

**Lists, not Favorites, with two tabs.** `src/routes/favorites/+page.svelte` keeps its route (nothing outside this app should have to know the URL moved) but its heading, `<title>`, and nav labels (`NavDrawer`, `+layout.svelte`'s mobile bar) all now read "Lists." Two tabs, reusing Settings' own tab pattern rather than a new one: Liked and Not for Me, each a plain filtered read of `ringStore.entries` against `favoritesStore`/`hiddenStore`, each independently restorable by pressing the other control on any card there. The un-like confirm dialog stays scoped to a bare un-like (leaving Lists' Liked tab with no trace); marking a liked entry Not for Me from that tab does **not** go through it, because mutual exclusion moves the entry to the other tab rather than off the page entirely, so there's nothing there to lose.

**Static reader and audio player both carry the pair too (brief section 8).** `ComicViewer` (the one built reader surface) gained `entryId` (passed down from `comicViewerStore.entry?.id` in `+layout.svelte`) and its own like/hide buttons in the top bar, next to "All pages." `AudioPlayer` gained a `hide-toggle` beside its existing `fav-toggle`. The embeddable widget gets neither, unchanged, since it was never built from `FieldNode` in the first place.

**Marking the currently-queued node Not for Me drops its remaining tracks and advances (brief section 8's "Play my Liked" clause).** `audioPlayerStore.removeEntry(entryId)` filters every queued item belonging to that entry out of the queue and, if the removed item was playing, advances to the next surviving item (a different node's first track) or raises the same end-of-queue state `next()` already does if nothing survives. Called from `FieldNode`'s and `AudioPlayer`'s own hide handlers. "Play my Liked" itself is still unbuilt (`docs/roadmap.md`), but this piece doesn't depend on it: the same reasoning (don't keep playing what was just dismissed) applies to a queue built any way at all.

**`indienode:hidden:v1` is in `localData.js`'s `LOCAL_KEYS`**, labeled "Not for Me entries," so it exports and imports alongside favorites, matching the brief's "both lists in one file" requirement. A pre-existing single-list export (no hidden key present) already imports cleanly under the existing generic key-by-key logic: nothing to write for the missing key, and `hiddenStore.load()` already defaults an absent key to `[]`, which is exactly "treat it as an empty hidden array" without any envelope-specific handling.

**The journal gained a fourth action, `'hidden'`**, recorded once on the way in only (mirroring `'liked'`): un-hiding is a correction, not a new event in the visitor's own history, same rule liking already follows.

**Not built as part of this pass:** the reader-direct-link-to-a-hidden-entry question (brief section 12, explicitly left PENDING, not defaulted) and "Play my Liked" itself (unbuilt, tracked separately in `docs/roadmap.md`).

## LOCKED: Three independent embed tiers (full widget, badge, text link), built to `tmp/IndieNode_Section7a_Widget_Tiers_Addendum.md`

Section 7a used to offer one embeddable artifact. A creator now picks one of three, at submission (both branches of `/join`) and nowhere else yet — see the maintenance-gap note below. `ring.json` is untouched: tier is purely which markup this app hands a creator, never anything the backend or the ring's own data model knows about (addendum section 3, mirroring brief section 3's "money never changes what surfaces").

**`src/lib/widgetTiers.js` is the one place all three artifacts are built.** `embedHtmlFor({ tier, badgeStyle, origin, siteId, entryType })` returns the exact copy-paste string for whichever tier: the `widget` case is a pass-through to the existing `embedSnippet` (`src/routes/widget/embed-snippet.js`), unchanged, so a tier switch back to "full widget" is never a second, slightly-different implementation of what that already did. `badge` and `text-link` are plain strings this module builds itself — an `<a>`+`<img>` and a bare `<a>`, respectively — with no shared runtime with the widget or with each other (addendum section 1, "every client is disposable").

**Both lighter tiers point at a real page, `/go/random` (`src/routes/go/random/+page.svelte`), not an inline script.** The text-link tier's own markup is explicitly not allowed a script at all (addendum section 2.3: "no script beyond the link target itself"), which rules out a per-tier inline-redirect approach for at least one of the two, so both share the one mechanism that works for both rather than the badge getting a script the text link structurally cannot have. The page itself loads the ring the same way every other client-side surface in this app already does (`ringStore.ensureLoaded()`), filters to `isVisibleTo(entry, preferencesStore.showExplicit)` (the one gate that's never optional anywhere else in this app either), and picks uniformly at random — deliberately **not** filtered by this visitor's own likes or Not for Me list, even though this page runs on this site's own origin and could read that local storage. The full widget's own Random (running inside a third-party page, with no access to this site's storage at all) has never been personalized, and giving one tier a personalized pick while the other two stayed uniform would make "Random" mean three different things depending on which embed a visitor happened to click.

**Badge assets are seven generated static SVGs in `static/badges/`**, not generated per-request (addendum section 4): `classic.svg`, `minimal.svg`, `mono.svg`, and four `type-coded-{audio,comic,game,text}.svg` variants. `scripts/generate-icons.js` derives every badge from the official `static/images/IndieNodes_Logo.png` master, then embeds a small palette PNG of that logo directly inside each SVG. The result remains one scalable, self-contained 88×31 request on a member's site—no second cross-origin logo fetch—while showing the same official mark as the app and full widget instead of a hand-drawn circle approximation. Re-running the icon generator after changing the master keeps all seven badge files synchronized.

**Type-coded ships for all four types, not just audio and games.** The addendum's own section 5 only resolves it for audio (blue) and games (green), deferring comic/text "until Section 9 resolves" — but Section 9 already had (see "LOCKED: All four type colors" above): `src/app.css`'s comic (`#a855f7`) and text (`#f59e0b`) tokens are locked values from a real trial, not the placeholders the addendum's own framing assumed. Worth naming plainly, the same way the "Not for Me" pass above hit an analogous case: an addendum can describe the state of the brief at the moment it was written, and that moment can predate a decision this repo already made. Deferring comic/text here anyway, on the addendum's authority alone, would have shipped two colors as "pending" that had already shipped as real. `badgeStylesFor` and the `typesOnly` filtering mechanism it reads from `BADGE_STYLES` stay in place regardless (no current style sets it, but it costs nothing to keep and a future style-specific restriction is exactly what it already exists to express — same reasoning `ThemeToggle`'s unused `drawer` variant was kept for, see "LOCKED: Arrange and Theme move..." above).

**Mono adapts its frame and wordmark to the host page's color scheme via `prefers-color-scheme` inside the SVG's own `<style>` block**, black on transparent by default, flipping to white under a dark preference; the official multicolor logo remains unchanged. This works when the SVG loads as a plain `<img>` because an image reference gets its own document context for media-query evaluation, independent of the host page's own CSS—as close as a single static file can get to the addendum's "avoids a badge that clashes with the creator's own palette" without knowing the actual host background color, which no static asset can.

**The site step (`/join`, no-own-site branch) gained a "Ring embed" field** right after the existing accent-color picker, backed by two new free-form keys on the generator draft (`generator.widgetTier`, `generator.badgeStyle`) rather than a schema change to `generatorDraftStore` itself — that store already patches an untyped object per field, the same way `accentColor` and `bio` do. Left unset (the default), `generatorWidgetEmbed` resolves to the full widget exactly as it always did, so a creator who never touches this field gets unchanged behavior. This has to live on the site step and not the success screen: the generated zip is downloaded during `onExportSite`, before submission, so a tier choice offered any later would be too late to affect what's actually in the file already on the creator's machine.

**The success screen (`/join`, has-a-site branch) gained its own tier picker**, local view state (`successTier`/`successBadgeStyle`) rather than anything persisted: this choice only ever decides which snippet gets shown to copy, with no export or backend step downstream of it the way the generator branch has, so there's nothing here that needs to outlive the page.

**Not built: "changeable at any time from the creator's node settings."** The addendum names this and says a tier swap should reuse "the existing lighter-weight re-verification path" from Section 6/maintenance. That path does not exist — `docs/decisions.md`'s Creator Nodes entry above already states plainly that a creator-initiated maintenance/edit flow was "not built this round," and this pass does not build one just to serve tier-switching. Tier is chosen once, at submission, same as everything else about a `/join` submission is today; changing it later is scoped out with the same maintenance flow it was always going to need, not worked around with a narrower one-off flow.

## LOCKED: Member files are the editorial source; ring.json is the generated public artifact

Each member now lives in `members/<id>.json`. The filename must match the entry id. `npm run
ring:build` sorts those filenames and generates the committed root `ring.json`, while `npm run
validate` checks every member, collection-wide duplicate ids, and byte-for-byte agreement with the
aggregate. Browsers and widgets still make one request for `ring.json`; individual source files are
never fetched at runtime. Publishing automation must commit a member file and the regenerated
aggregate together.

JSON stays the source format because the schema, AJV validator, browser contract, and n8n payloads
already use it. YAML would add parsing behavior without improving the review or merge-conflict
benefits provided by one file per member.

## LOCKED: Text nodes accept one to three explicit samples

The singular `excerpt` field is replaced by `excerpts`, an array with one to three nonempty strings.
Join, update, generated sites, fixtures, and publishing use the same array. This avoids treating blank
line paragraph breaks as separate works and gives text creators the same curated multi-work shape as
audio and comic creators.

## LOCKED: The skin laboratory is development-only infrastructure

`/dev/skins` is served by a Vite `serve`-only middleware entry, not the SvelteKit route tree. Settings
links to it only when `$app/environment` reports development mode. The production build runs a final
invariant check that fails if a dev path, laboratory route string, or laboratory copy appears in output.

## FIXED: Keep Going preserves the playlist panel state

Explicit queue additions still open the playlist as feedback. Automatic additions after the visitor
has enabled Keep Going call the same store operation with `openQueue: false`, so a closed playlist
stays closed and a playlist the visitor deliberately opened stays open.

## LOCKED: The deployed artifact is the GHCR image, so build-time config lives in GitHub repo variables

Settled 2026-08-24, matching how the sibling repos already deploy.

`adapter-static` compiles every `VITE_` value into the client bundle at build time. There is no
server process in the runtime image to read an environment variable later, so `docker run -e`
does nothing and no deploy-time mechanism — Semaphore, Ansible, a vault, a compose file — can
inject one. **Whichever system runs `docker build` is the only place these values can enter.**

That system is GitHub Actions (`docker-publish.yml`, publishing to
`ghcr.io/xtreemmak/indienodes-app`, since the repo was later renamed from `indienodes`), and Semaphore pulls the published image. Therefore the five
build args come from **repository variables** (Settings → Secrets and variables → Actions →
Variables), not from anything on the infra side:

| Variable                      | Unset behaviour                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_SITE_ORIGIN`            | Dockerfile default `https://indienodes.us`                                                                                                                   |
| `VITE_SUBMISSION_WEBHOOK_URL` | `/join` and `/update` report submissions closed                                                                                                              |
| `VITE_CONTACT_WEBHOOK_URL`    | `/contact` reports itself closed                                                                                                                             |
| `VITE_TURNSTILE_SITE_KEY`     | No widget rendered — was the live state through 2026-08-30; Turnstile is on as of 2026-08-31, so this row is now the fallback rather than the deployed state |
| `VITE_KOFI_URL`               | About modal drops its Support tab                                                                                                                            |

Only the first three need setting. The other two are documented valid-unset states, not
oversights.

The failure mode this records is quiet rather than loud: with the variables unset the build
still succeeds and the image still serves, but every form in it reports itself closed. Nothing
errors, so it looks like a working deploy. Checked 2026-08-24 — `gh variable list` was empty,
meaning every image published to that point had exactly this defect.

**Corollary: a secret cannot be used here.** A repository _secret_ is masked in logs and would
be baked into a publicly downloadable bundle anyway, so it would provide no protection while
making the value harder to audit. None of these five are sensitive: webhook URLs are called
from the visitor's own browser and a Turnstile _site_ key is designed to be public. The
Turnstile _secret_ key never appears in this repo or its images at all — it lives only as an
n8n credential.

## FIXED: A standalone `{#snippet}` cannot call a component-local function from inside an `{#each}`, under this project's current build

Found while building the no-site audio hosting UI (`JoinMediaStep.svelte`), while trying to
de-duplicate the label+direct-link row markup shared between the has-own-site audio branch and
the new "host it separately" branch — both needed the exact same repeatable rows, and a
top-level `{#snippet trackUrlRows(tracks)}...{/snippet}` invoked twice via `{@render}` was the
obvious way to do that.

**It does not build.** `npm run build` fails with an opaque `[PARSE_ERROR] Unexpected token`
pointing at an unrelated line — in every case observed, a plain comment line elsewhere in the
`<script>` block, nowhere near the actual snippet. `svelte-check` reports zero errors on the
exact same file; only the real production build (`vite build`, on this project's Vite 8 /
rolldown-vite pipeline) fails. That divergence is not new to this project — the static-markup/
`{#if dev}` DCE issue that motivated `scripts/verify-production-build.js` was the same shape of
problem — but this is a different underlying cause.

**Isolated by elimination**, bisecting a minimal reproduction down from the full component:

- A standalone top-level snippet containing an `{#each}` over anything other than a literal
  array (a member expression, a plain local `const`, even a snippet parameter in some
  combinations) fails, while the identical `{#each}` at the component's top level, outside any
  snippet, builds fine.
- A snippet passed as a component's slotted `children` (e.g. `<FormField>{#snippet
children(describedBy)}...{/snippet}</FormField>`, used throughout this same file) is
  unaffected — only a standalone snippet invoked via `{@render}` hits this.
- Passing the each-source as an explicit snippet **parameter** rather than closing over an
  outer-scope identifier fixes the each-loop itself, confirmed with realistic content.
- But then the snippet's per-row **event handler** breaks it again: `onclick={() =>
removeTrack(track.uid)}` fails, isolated down to a bare `onclick={removeTrack}` with no
  wrapper and no arguments. Calling a method on an imported/external object from the same
  position (`oninput={() => form.touch()}`) is fine. The actual trigger is a reference, from
  inside a standalone snippet's `{#each}`, to a **sibling top-level function declared in this
  component's own `<script>` block** — not the each-loop, not the closure, specifically that.

**Fix shipped: duplicate the markup rather than share it via a snippet.** Both call sites in
`JoinMediaStep.svelte` carry the identical rows verbatim, with a comment at the duplication
explaining why, so a future "clean this up into a shared snippet" pass does not walk back into
the same wall having to rediscover all of the above. This is recorded here as well, not only at
the point of use, because the underlying constraint is about the _toolchain_, not about this one
feature — it will bite the next standalone snippet that needs to call a local function from a
loop, wherever in the codebase that happens.

**Not investigated further:** whether this is a Svelte 5.56 issue, a rolldown-vite 8.2/1.2.4
issue, or specifically their interaction; whether it is already a filed upstream issue; or
whether a narrower workaround exists (e.g. an inline arrow that closures over the function by a
different name). Reproducing it standalone outside this project, to file it upstream precisely,
is worth doing separately from this feature.

## LOCKED: Inclusion requires proof of creation, not proof of success — and EULA §8 was amended to allow it

Sourced from `tmp/indienodes_product_curation_decisions.md` sections 3–7. The standard
itself now lives in [`indienodes-ring`'s `docs/curation-policy.md`](https://github.com/XTREEMMAK/indienodes-ring/blob/main/docs/curation-policy.md)
(it moved there in the ring split, and the local link this entry used to carry no longer
resolves); this records why
it was adopted and the two things that had to be reconciled before it could be.

**The standard:** a Node qualifies when a visitor can experience something now — hear
it, read it, look at it, play it. Popularity, polish, commercial release, professional
credits, audience size, and finishedness are all explicitly _not_ requirements, and
none may be used to decline a submission. The point is to keep the ring open to very
small creators while stopping it becoming a directory of announced intentions, because
"open a random node" only works as a promise if there is reliably something behind it.

**This required amending the EULA, which was not obvious.** §8 "Moderation Standard"
enumerated the review checklist as exactly three items — a valid URL, a working
verification token, a declared type matching the content — and then stated the Licensor
"does not otherwise exercise discretionary editorial control over accepted content."
An eligibility bar is a _fourth_ rejection ground that binding text did not authorize.
Adopting the standard without touching §8 would have meant rejecting submissions on a
basis the agreement told submitters would not be used.

**Resolved by amending §8 rather than by stretching its existing wording.** The
tempting alternative was to lean on "a declared type matching the submitted content" —
arguing a `game` entry with no playable game already fails it. That reading holds at
the centre and falls apart at the edges, and it would have left reviewers applying a
rule the EULA words differently. §8 now carries the criterion explicitly, bounded in
the same sentence: it tests _existence, not merit_, and says so, which is what keeps
§8's own "not an editorial quality judgment" framing honest. EULA bumped 1.0 → 1.1 per
§19.2, which requires amendments be version-tracked in the document's own header.

**Link-out-only Nodes remain eligible, and the policy says so in the audio section.**
EULA §5.1 already binds this — "A Node with no directly playable media (an audio entry
that is a link-out only, for instance) is a supported shape, not a rejected one" — and
`/join` offers that path in as many words ("No direct file? Skip this"). The source
proposal's "music visitors can actually hear" reads, without care, as requiring media
this project can play. It does not: the test is satisfied at the Node's `source_url`.
Written the other way it would have contradicted §5.1 and silently invalidated a
shipped product decision.

**Games cannot be enforced in schema, and the policy states that rather than implying
otherwise.** `schema/ring.schema.json` requires a `thumb_url` for a game; nothing can
verify a playable build exists behind a `source_url`, and nothing ever will. The same
is true of every criterion here. This is a human judgment made once in the review
queue, which is why the policy is written as reviewer guidance instead of as rules a
validator could run. Precedent for the distinction is already in the EULA at §11.3,
where PRO disclosure is stated to be "not a gate on submission eligibility."

**The `tmp/` document is superseded** as the canonical source by `curation-policy.md`
and this entry.

## LOCKED: The root route stays the app. The project homepage is a separate repo, not `/explore`

Reverses the entry this replaces (below, in full, for the record — see the git
history of this file for the version that stood between those two commits). The
one-build `/explore` split was built, verified working, then rejected in the same
session on reflection: **a separate repo makes the intent more obvious and the two
surfaces easier to manage independently**, which one build serving two concerns
inside a single SvelteKit app does not give you as cleanly. The landing page's
content and design were carried over rather than discarded — they became the seed
of `indienodes_web`, a standalone static site.

**Also reversed: `app.indienodes.us` is now the preferred production home for this
app, not a secondary alias.** The original plan treated `app.` as an optional future
proxy target for the same build; the corrected preference is `app.indienodes.us`
serving this app directly at its own root, with `indienodes.us` pointed at the
separate homepage repo. Neither is code in this repository — both are infra
(DNS/proxy) decisions to make when that repo is ready to deploy.

**What actually changed back in this codebase:** `/` is the field view again, exactly
as it was before the split — both `isField` definitions (`+layout.svelte`,
`NavDrawer.svelte`), the mobile Field tab, the drawer Field item, `+error.svelte`'s
"Back to the field", `manifest.webmanifest`'s `start_url`, and every e2e `goto`
touched by the split were all reverted to `/`. The route-aware Drifty Stars gate
(`isLanding || preference`) is gone; the background is governed by the stored
preference alone again, as it always was outside of the reverted landing page.

**The widget-origin constraint that motivated "one build" in the first place still
holds**, and still matters whenever a domain change is next considered: `SITE_ORIGIN`
is one build-time variable feeding six consumers, one of which — the embeddable
widget — runs on members' own sites with the origin baked in at the time they pasted
it. Nothing rewrites an already-pasted embed. This doesn't change which repo the
homepage lives in, but it does mean this app's own `VITE_SITE_ORIGIN` should be built
as `https://app.indienodes.us` once that domain is live, not left pointing at the
root the homepage now owns.

<details>
<summary>Superseded entry, kept for the reasoning it recorded</summary>

## LOCKED: The root route is the project's front door; the field view moved to `/explore`

`/` was the field view. It is now a landing page, and the field lives at `/explore`.

**Why:** the root domain should represent IndieNodes the project rather than one
client of it — which is this repo's own stated thesis (`ring.json` is the product;
the field view, the widget and the static reader are replaceable clients). It also
makes room for `app.indienodes.us`, a PWA, or a native client to each be _a_ way in
rather than _the_ way in. Sourced from `tmp/indienodes_product_curation_decisions.md`
§1, adopted in a narrower form than proposed: **one build, one codebase.**

**Not a codebase split, and specifically not an extraction of `/join` and
`/update`.** That proposal conflates _which URL_ something lives at with _which
codebase it ships from_; for a static site those are independent. The coupling is
also real and bidirectional — `/update` resolves node ids from live ring data,
`/join` reads the ring for slug collisions and tag autocomplete, `/members`
deep-links into `/update`, and `submissionStore` and the generator import each
other. Serving one build at both hostnames gets the proposed information
architecture by URL alone.

**The constraint that decided it:** `SITE_ORIGIN` is a single build-time variable
feeding six consumers, and one of them — the embeddable widget — runs on _members'
own sites_ with `https://indienodes.us` baked in, fetching `/ring.json` absolutely,
linking `/go/random`, and loading `/badges/*.svg`. Nothing rewrites an embed already
pasted into someone else's HTML. The root therefore has to keep serving those paths
permanently and can never become a pure marketing host. One build at both origins
makes that a non-issue instead of a migration.

**This does not reverse the phase-0 decision that collapsed `/about` into
`AboutModal`.** The modal is reference for someone already inside — release history,
licence, the full principles list. The landing is the short form for someone who has
not come in yet, and links to the modal rather than restating it. The brief frames
this project as closer to an app than a marketing site, so the page is a door, not a
pitch deck.

**Drifty Stars is route-aware rather than a changed default.** `preferences.js`
defaults `background` to `'none'`, so a first-time visitor would otherwise meet a
flat landing page at the one moment atmosphere is doing real work. The layout gate is
now `isLanding || preferencesStore.background === 'drifty-stars'`: the landing carries
it as part of its own design, everywhere else the stored preference still decides,
and the default is untouched. Reduced motion is unaffected — `AmbientBackground`
paints a single static frame and never starts its loop under that setting.

**What the move actually touched, since most of it fails silently.** `resolve('/')`
still compiles after the move (the root still exists), so nothing errors — it just
retargets. The two `isField` definitions (`+layout.svelte`, `NavDrawer.svelte`) gate
eight pieces of chrome including the ambient trigger, and were the largest risk. Also
repointed: the mobile Field tab, the drawer Field item, `+error.svelte`'s "Back to
the field", `manifest.webmanifest`'s `start_url` (so an installed PWA opens the ring,
not marketing), and 16 e2e `goto('/')` calls. **Both logo links deliberately still
point at `/`** — conventional, and not redundant with the dedicated Field nav item.

**The landing is its own chunk.** SvelteKit code-splits per route, so `/explore`
loads the shared layout plus the field chunk and never fetches the landing's 3.8 KB.
There is no service worker in this project, so nothing precaches route HTML either —
an app-context visitor genuinely does not pay for the landing. Verified against the
built output rather than assumed.

**Still infra work, not done here:** pointing `app.indienodes.us` at the same build
and redirecting its `/` to `/explore`. Prefer a redirect over a rewrite — a rewrite
serves `explore.html` at path `/` and leaves SvelteKit's router disagreeing with
`location`. The n8n CORS allowlist in `scripts/n8n/build_workflows.py` needs the new
origin added when that happens.

</details>

## LOCKED: Nodes represent creators; works are the evidence inside them

The canonical definition is: **A Node is a representation of an independent creator,
collective, or studio, expressed through a small selection of their work.** In the
short form used during implementation: **Node = creator. Hero = work.**

This makes explicit what the current identifiers, schema descriptions, submission
flow, and `creator_id` relationship already imply. It does not require a migration and
does not turn tracks, pages, excerpts, artworks, or games into separately discoverable
members. A creator may select a small number of works to make their Node legible, but
the Node continues to link back to the creator's own space and rotates as one ring
entry.

The distinction matters for the Art addition approved on 2026-08-28. Art is a new
first-class content type, but an `artworks` array is a compact gallery inside one
creator Node, not a collection of independent Art Nodes. The same interpretation
applies to every existing media array.

The cross-cutting implementation decisions, compatibility boundaries, and delivery
gates for Art, Text TTS, and Game trailers are recorded in
`creator-first-art-architecture-audit-2026-08-28.md`. The official four-shape logo is
preserved as brand geometry rather than treated as an exhaustive legend of schema
types.

## LOCKED: Game previews and trailers are separate; third-party embeds are lazy

`preview_url` remains the backward-compatible direct-video field used for the muted,
automatic visual preview. The optional `trailer_url` is a separate, additive field for
supported YouTube URLs. A trailer is never created or loaded until the visitor presses
the Trailer button; the resulting embed uses YouTube's privacy-enhanced
`youtube-nocookie.com` origin.

The join and update flows validate and explain that boundary, and the About disclosure
states that activating a trailer can allow YouTube to collect data or show ads. While
a requested trailer is open, the application host—not the skin—temporarily owns audio
coordination: it pauses the active music track and resumes that same track when the
trailer closes. This keeps third-party behavior explicit and preserves the skin-system
boundary.

This supersedes the 2026-08-27 decision's “no new schema” and `preview_url`-as-trailer
details. It preserves that decision's audio-focus reasoning and does not change the
existing direct preview behavior.

## LOCKED: Text samples carry optional creator narration, and both excerpt shapes stay valid

`excerpts` items may now be either a bare string or a `{ text, audio_url? }` object.
The object form is what the join and update forms produce: `text` holds sanitized
rich-text HTML, and the optional `audio_url` points at the creator reading that
specific sample aloud. When a sample has no `audio_url`, the reader falls back to the
existing browser-native speech service rather than to silence, so narration is an
enhancement and never a requirement.

Both shapes are permitted by `schema/ring.schema.json` on purpose, and this is the
compatibility boundary the change is built around. Text entries published before
samples could carry audio are stored as plain strings; accepting only the object form
would have retroactively invalidated every one of them and forced a data migration,
which the creator-first architecture audit explicitly rules out. `normalizeEntry` in
`src/lib/ring.js` lifts the string form to the object form at read time, so the two
shapes exist only at the storage boundary and nothing downstream of that function ever
sees more than one. Legacy files are never rewritten in place; they simply stay valid.
`submissionValidation.test.js` asserts both forms validate, including a file
mid-migration with one of each, so this cannot regress silently.

Rich-text authoring uses `@friendofsvelte/tipex` (MIT, Tiptap/ProseMirror). It is
route-split to `/join` and `/update` only: measured against the production build, an
ordinary visitor loads none of it, and those two form routes load 558 KB raw /
177 KB gzipped. That cost was accepted for the two creator-facing authoring routes and
explicitly not for the reading surfaces, which is why the field, Ambient, and Lists
views render sanitized HTML with no editor present. Author-supplied HTML is sanitized
with DOMPurify both before persisting and again at render. The authoring surface uses a
shared, non-floating toolbar limited to H1-H3, paragraph, bold, italic, underline,
strikethrough, undo, redo, and plain-text paste. Those safe structural and inline tags
survive into ring data and every generated Text template; images, scripts, arbitrary
styles, task lists, code, and the rest of Tipex's default toolbar remain unavailable.

## LOCKED: One entry-id rule, inlined by the workflow, and the submitted id is honoured when it is free

`src/lib/slug.js` is the only definition of how an entry id is derived. It was
already written to be shared — its own header says the rule "has to be applied in
two places and disagreeing about it would be worse than duplicating it" — but the
workflow did not import it, it restated it, and the two drifted three ways at
once:

|            | `slug.js`                      | the workflow's copy |
| ---------- | ------------------------------ | ------------------- |
| Unicode    | NFKD, combining marks stripped | none                |
| Length cap | 48                             | 40                  |
| Truncation | cut at a hyphen near the limit | hard slice          |

Every one produced the same silent failure. The form shows a creator their id and
a generated site bakes it into the footer embed at download time; approval then
assigned a different one, and the member's `site-id` matched no entry in the ring
for as long as that entry existed. `Sigur Rós` became `audio-sigur-ros` in the
browser and `audio-sigur-r-s` at approval — so this hit ordinary accented names,
not just long ones, and it hit sites built from our own templates exactly as hard
as hand-built ones.

`build_workflows.py` now reads `slug.js` and strips its ESM keywords into the
Code node. Restating a rule in a second language is what created this, so the fix
is structural rather than a corrected transcription: there is no second copy left
to drift. `scripts/n8n/test_code_nodes.mjs` runs the generated node and the module
against one corpus — accented, long, punctuation-only, and non-Latin names — and
asserts the node inlines the module rather than paraphrasing it.

**The id the form displayed is now sent as `requested_id` and honoured when free.**
`submission-form-spec.md` had reasoned that uniqueness is a property of `ring.json`
at merge time, so the id must be assigned at approval. That is true of _uniqueness_
and does not follow for _derivation_: by approval the creator may already have
published the id, and re-deriving discards work they have done. Approval takes
`requested_id` when nothing has claimed it and derives otherwise, so the authority
over uniqueness is unchanged and the common case stops renaming a published embed.

It travels as a sibling of `entry`, never a field on it: `toRingEntry` output is
validated against a schema with `additionalProperties: false`, so an extra key
there would fail the entry it exists to help. Intake copies it onto the stored
entry blob — internal, and governed by the finalize allowlist, which excludes it —
so it never reaches `ring.json`. It is pattern-validated at both intake and
approval because it flows into a file path and a branch name. It is deliberately
**not** `node_id`: that column is the update/removal discriminator, and setting it
on a new submission would make every join look like an update.

A collision between download and approval is still possible and no longer silent:
the member's embed goes stale, and the health checker reports that as
`ring_widget_site_id_unmatched` rather than as a missing embed, with `/update` as
the repair path.

## LOCKED: n8n stays a hard requirement for submissions, and the seam is the resilience

The submission pipeline runs on n8n, so a fork cannot accept submissions through the form
without standing up their own instance. The question was whether to start decoupling now,
while the project is young enough that it would be cheap.

**No, and the reason is drift.** A second intake path is not one more backend: it is a
second implementation of the whole submission contract — the schema, the field
validation, the token lifecycle, the review decisions — kept in step with the first by
hand. This project has already paid for that mistake once. `src/lib/slug.js` and
`build_workflows.py` each implemented the entry-id rule separately and diverged three
ways, and every divergence produced the same silent failure for the creator. Building a
parallel submission path before the first one has met real traffic is choosing that
outcome deliberately, on a far larger surface.

**The decoupling that matters is already done.** The n8n dependency is three runtime
files (`submissionApi.js`, `contactApi.js`, `config.js`) and nothing else. Every call
goes through seven functions — `issueToken`, `bindSourceUrl`, `verify`, `submit`,
`requestUpdateToken`, `submitUpdate`, `requestRemoval` — behind `hasBackend`/`useMock`,
and that module already ships a working mock of all seven for development. The mock is
what proves the boundary is real rather than notional: something already implements this
contract without n8n. A replacement implements the same seven and nothing else in the app
changes. That is the pivot, and it stays cheap whether it is taken now or in two years.

**Everything except submissions already works with no backend.** The field and ambient
views, the widget, the directory, personalization, the generator and `ring.json` are
static. What a fork loses is the form, not the ring — and members can be curated by pull
request against `members/*.json`, which `build-ring.yml` and `validate-ring.yml` have
handled all along. That path was simply never named as supported.

So the work was documentation and one correction, not architecture. `/join` had been
telling a fork's visitors that submissions were "closed right now" and to "check back" —
copy written for an outage, on a flag that is false only when no webhook was configured at
_build_ time. It described a permanent, deliberate state as a temporary one and never
mentioned the route that does work. It now says what it means, and points at the
pull-request path when `VITE_RING_REPO_URL` names a repository to point at.

Revisit when there is evidence a fork exists and is blocked, or when n8n itself becomes
the problem. Neither is true yet, and the ring has two members.

## LOCKED: ring.json is a versioned envelope, and the ring is being split into its own repository

Two related changes, made together because the second cannot safely follow the first without unwinding it.

**The envelope.** `ring.json` was a bare top-level array for this project's whole life. It is now `{ version, entries }`, validated by a new `schema/ring-document.schema.json` that `$ref`s the existing per-entry `schema/ring.schema.json`. The motivation is the ring becoming something other than one client's own build output: once a canonical endpoint exists for packaged and third-party clients, its shape is a public contract, and a bare array has no way to signal a future breaking change short of a client guessing from whatever fields happen to be present.

Reader-first, not data-first, and the ordering was load-bearing rather than cosmetic. `src/lib/ring.js`'s `loadRing`/`ringEntries` read either shape and shipped in the same commit as the flip -- the constraint was that they had to be _capable_ of shipping first, because every already-pasted `<script src=".../embed.v1.js">` on a member's own site calls `.map()` on whatever it fetches, and a page holding a stale cached copy of that script would throw on the new shape otherwise. No `generated_at` in the committed file: `validate-ring.js`'s freshness check compares `serializeRing`'s output byte-for-byte against `ring.json`, and a timestamp would fail that check against a fresh run of itself.

**The rename.** This repository is `indienodes-app`, not `indienodes` -- renamed on GitHub, not just relabeled in prose -- because the target architecture has three repositories (`indienodes-ring`, `indienodes-app`, `indienodes-site`, the last already decided above in "The root route stays the app"), and a repo still named after the whole project while owning only the client half of it says the opposite of what is true.

**The ring repository.** `members/`, both schemas, and the build/validate/health scripts now also live in `github.com/XTREEMMAK/indienodes-ring`, with their own CI (mirroring this repo's own push-triggered "Ring data" check, which the copied PR-only workflows did not by themselves reproduce) and pre-push hook. When this was written the move was additive only: `indienodes-app` still owned its own copy of everything moved, and remained the thing every client actually read from, pending a canonical publish endpoint this repo could be repointed at.

**Update, 6c21307 ("cut this repo over to consuming the ring instead of owning it"):** that endpoint now exists. `ringStore` and the widget read `VITE_RING_URL` (`ring.indienodes.us` in production) as the primary source, with this repo's own `/ring.json` as an automatic fallback rather than the thing read by default. `members/`, both schemas as source, and the build/validate/health scripts were removed from this repo outright -- `indienodes-app` now keeps a byte-for-byte mirror (`scripts/sync-ring-mirror.mjs`, refreshed by `.github/workflows/sync-ring.yml` on `repository_dispatch` from the ring repo's publish, with a twice-daily schedule as the fallback for a missed dispatch -- as of 2026-08-31 only the schedule has ever fired; the dispatch path needs `APP_DISPATCH_PAT` provisioned before it does anything), not a second copy of the source of truth. The n8n re-scoping this entry called "unstarted on purpose" is also done: `1851111` ("feat(n8n): redirect approval writes to indienodes-ring") repointed `GITHUB_REPO` and paused/verified/reactivated the live workflows rather than trusting the push. Two unit tests (`publishedRing.test.js`, `memberHealth.test.js`) were dropped with the files they tested; `indienodes-ring` does not yet have equivalent coverage, most notably for `memberHealth.test.js`'s SSRF-safety assertions -- a real, tracked gap, not an oversight.

## LOCKED: the widget's default embed is a sandboxed iframe, on this app's own origin

A security review (`indienodes-ring`'s `docs/webring-security-research-2026-08-31.md`, finding F-01/F-02) found the recommended "full widget" integration -- `<script type="module" src=".../embed.v1.js">` plus `<indienode-widget>` -- runs with the full authority of whatever page it's pasted into: it can read that page's cookies, DOM, storage, and same-origin APIs. Shadow DOM isolates _styling_, not _authority_. The current widget source does none of that today, deliberately (no `postMessage`, no host-DOM access, no `eval`), but that is a property of this build, not a guarantee the architecture enforces -- a future compromise of this app's origin, build pipeline, or dependency graph would propagate to every member site carrying the script, with nothing in the browser stopping it.

**The fix is a sandboxed cross-origin iframe, made the new default `widget` tier.** `src/routes/embed-frame/+page.svelte` is a minimal page whose only job is to mount `<indienode-widget>`; a member embeds it via `<iframe src=".../embed-frame?site-id=..." sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox">`, deliberately omitting `allow-same-origin`. That omission _is_ the isolation property: a sandboxed frame without it gets a forced opaque origin regardless of which URL served it, unable to touch cookies, storage, or the DOM even if this app's own origin is fully compromised. `allow-popups`/`allow-popups-to-escape-sandbox` are what let Prev/Next/Random still open a member's site in a real, unsandboxed tab.

**Same-origin route, not a new subdomain.** The review's own recommendation was a dedicated origin (e.g. `widget.indienodes.us`) with no cookies or service-worker scope, mirroring how `ring.indienodes.us` is a genuinely separate repo and deploy. That precedent does not transfer here: the isolation comes from the sandbox attribute, not from which origin serves the frame -- an opaque-origin sandboxed frame cannot reach its serving origin's storage or cookies regardless of whether that origin is `indienodes.us` or a dedicated subdomain, and this app has neither cookies nor a service worker today for there to be anything to isolate from. A separate origin buys insurance against two things that are not true yet: someone later adding `allow-same-origin` by mistake, or this app someday gaining real sessions. **Revisit this decision if either happens** -- add the dedicated origin at that point, not before. Until then, `Caddyfile` carries a per-path override (`-X-Frame-Options` plus a strict `Content-Security-Policy` with `frame-ancestors *`) for exactly `/embed-frame`, the same per-path pattern already used for `/embed.v1.js`'s CORS carve-out.

**The script tag survives as `widget-script`, an explicitly weaker-trust "advanced" tier**, not retired: `WIDGET_TIERS` now has four entries, `embedHtmlFor`'s `widget` case returns `embedFrameSnippet()` and `widget-script` returns the original `embedSnippet()`. Nobody's already-pasted script embed breaks, and `/widget`'s reference page documents both with real, working live previews -- the iframe's preview is a genuine `<iframe src="/embed-frame">` (a real navigation, not `srcdoc`, so it actually works), unlike the join-flow generator/success-screen previews, which keep using the existing static `widgetPreviewHtml()` stand-in for both tiers rather than nesting a real frame inside their own already-sandboxed `srcdoc` preview.

**SRI was deliberately not added to the script tier in this pass.** The review's own F-02 finding calls for immutable, content-addressed URLs (`embed.v1.<sha256>.js`) with an SRI hash in the snippet -- but `embed.v1.js` stays genuinely mutable (a new build overwrites the same URL; "v1" pins a behavioral contract, not content). Adding an `integrity` hash against a URL that keeps changing bytes underneath it would mean every already-pasted advanced-tier snippet's browser refuses to execute the very next time the widget is rebuilt for any reason -- worse than no SRI, not better. Real SRI needs the content-addressed versioning project the review itself calls "distinct, non-trivial," not a one-line addition; tracked as separate future work in `roadmap.md`, not done here.

**A pre-existing e2e gap surfaced while testing this:** the widget's own ring fetch (`RING_JSON_URL`, built from `SITE_ORIGIN`) had never been exercised by an e2e test before `testing/embed-frame.e2e.js`, and it turned out `SITE_ORIGIN` defaulting to the real `https://indienodes.us` in an unconfigured build meant every e2e run's widget was silently trying to fetch the real production ring across a network the test runner cannot reach -- previously invisible because no test loaded the real widget, only its static preview stand-in. Fixed by setting `VITE_SITE_ORIGIN=http://localhost:4173` for the e2e "production" project's build in `playwright.config.js`, making that build a genuinely self-contained deployment instead of one that happens to serve from a different port while still identifying as the real site.

## Found live: `/_app/immutable/*` never carried the CORS header the sandboxed iframe needs, and Cloudflare's own cache outlived the fix

The iframe `widget` tier (previous entry) went dead on every member site that had it embedded, reported first from real third-party pages (`nekoweb.org`, a `pages.kjnet.us` member page) as `Access to script at '.../_app/immutable/...' from origin 'null' has been blocked by CORS policy`.

**Root cause.** The sandboxed iframe's opaque origin (deliberate, previous entry) means every fetch it makes -- including the browser loading `/embed-frame`'s own SvelteKit hydration chunks under `/_app/immutable/*` -- runs in CORS mode: module scripts and dynamic `import()` always do, regardless of physical same-hostness. `Caddyfile`'s `@immutable` matcher set `Cache-Control` on that path but never `Access-Control-Allow-Origin`, unlike the carve-out `/embed.v1.js`/`ring.json` already had (see the widget-versioning entries above). This also broke this app's own `/widget` live preview, a same-origin `<iframe src="/embed-frame">` that hits the identical opaque-origin fetch path. Fixed by adding `Access-Control-Allow-Origin "*"` to the `@immutable` block, the same safety reasoning as the existing carve-out: public, content-hashed, credential-free build assets, no cookies or session anywhere in this app for `*` to be unsafe with.

**Fixing the Caddyfile was necessary but not sufficient to make the symptom go away, and that gap is the part worth remembering.** After the fix was live at origin -- confirmed directly with `curl -sI` against the exact chunk URLs from the bug report, `access-control-allow-origin: *` present, `cf-cache-status: MISS`, `last-modified` matching the fresh deploy -- the same CORS error kept reproducing in a real browser, survived a hard refresh, survived cache-cleared reloads, and survived incognito. All three rule out the browser's own cache. What did not get ruled out, and turned out to be it: `/_app/immutable/*` is served `Cache-Control: public, max-age=31536000, immutable`, so any Cloudflare edge POP that had already cached the pre-fix (no-ACAO) response -- and by the time this was found, the widget had been live and embedded on real member sites for days, so most POPs worldwide had -- keeps serving that cached copy for up to a year regardless of what origin now returns, because `immutable` tells Cloudflare (like the browser) never to revalidate within max-age. The `curl` check above only proved the fix was correct at origin and at whichever one POP that particular request happened to land on; it proved nothing about any other POP, including whichever one a given visitor's request actually resolves to.

**The fix for the fix: a Cloudflare cache purge for the zone** (dashboard → Caching → Configuration → Purge Everything; a scoped custom purge on `/_app/immutable/*` needs an Enterprise plan, so "Purge Everything" is the reliable option on lower tiers). Confirmed the purge, not the Caddyfile change alone, was what made the symptom actually disappear in a real browser.

**The general troubleshooting lesson, for next time this shape of bug shows up:** if a header/CORS/CSP fix is verified correct at the origin (`curl` against production directly) but a real browser still reproduces the original symptom after every form of _browser_-side cache-busting has been exhausted (hard refresh, cache-cleared reload, incognito), suspect the CDN's edge cache next, especially for any path served with a long `max-age` and/or `immutable` -- and especially if that path had already been live and publicly hit before the fix shipped, since that is exactly what gives stale copies time to spread across edge POPs. A purge is the fix in that case, not another look at the origin config.

## LOCKED: a real Content-Security-Policy, with `'unsafe-inline'` on script-src and style-src

The security review's other major recommendation (the `Caddyfile`'s own comment had already flagged this as pending "a separate nonce/hash migration"). What shipped is not the strict, nonce/hash-only script-src that phrase implies, and the reason is worth recording precisely so nobody re-attempts the stricter version without re-learning why it failed.

**The plan going in** was one exact SHA-256 hash for `app.html`'s own inline theme/skin bootstrap script -- stable, since `app.html` is copied through verbatim and that script's bytes never change on their own -- plus `'unsafe-inline'` on style-src for the ~40 components that compute `style:`/`style="..."` from live state (positions, timings, aspect ratios), which no nonce or hash can cover. `scripts/verify-production-build.js` grew a check comparing that hash against the Caddyfile so the two could never drift silently.

**That plan did not survive contact with what SvelteKit itself ships.** Every prerendered page carries its own additional inline script beyond app.html's: a `kit.start(...)` hydration bootstrap embedding that page's own serialized load data (the layout's changelog-derived `releases` list on every page; page-specific data on some), and on any route whose load fetches during prerendering (several, via `ring.json`), a `data-sveltekit-fetched` script caching that response. Both are generated per page and per build -- there is no single stable hash for either, only a different one on every route and every time the underlying data changes. A hash-only script-src blocked its own hydration outright on every single page, caught only because `testing/csp.e2e.js` applies the real header string in a real browser (via Playwright route interception, since `vite preview` sends no CSP of its own to test against) rather than trusting the Caddyfile on inspection -- the same discipline `testing/embed-frame.e2e.js` had already paid for once this same day. Silently blocking your own app's hydration is a strictly worse outcome than the inline-script risk CSP exists to reduce, so `'unsafe-inline'` replaced the hash on script-src too, for both the main policy and `/embed-frame`'s own (whose page is an ordinary SvelteKit route with the identical hydration script, plus `<indienode-widget>`'s own shadow-root `<style>` needing the same style-src exception -- CSP governs a shadow root's `<style>` element same as any other, with no nonce/hash mechanism reaching into a custom element's own template).

**Verified against a real Caddy instance, not just the Playwright simulation**, given nothing in this repo's toolchain (no `caddy` binary in CI or in the environment this was built in) can validate Caddyfile syntax or runtime header behavior otherwise: a minimal `caddy:2-alpine` container run directly against this exact `Caddyfile` and fake content confirmed the config parses, `/` and `/embed-frame` each receive exactly one `Content-Security-Policy` header (the path-specific block correctly _replaces_ the global one for matching requests, not appends alongside it -- the one Caddy-specific behavior this session had no way to verify short of running it for real), `-X-Frame-Options` correctly removes that header only for `/embed-frame`, and the pre-existing `Access-Control-Allow-Origin` CORS carve-out for `/embed.v1.js`/`ring.json` is untouched.

**What the policy still does, despite both exceptions:** `object-src 'none'`, `base-uri 'self'`/`'none'`, and `form-action` lock down three whole attack classes outright; `connect-src` and `frame-src` are real allowlists, not wildcards (`img-src`/`media-src` are the one deliberately open exception, since creator media is genuinely arbitrary-host by design); and `frame-ancestors 'none'` restates `X-Frame-Options: DENY` as CSP, which takes precedence in every current browser.

**Real fix, not done here:** a build step that hashes each built page's own inline scripts and injects a matching per-page policy (a `<meta>` tag can carry script-src's hash list, though not `frame-ancestors`/`sandbox`, which would still need the header) -- genuinely separate, non-trivial work, tracked in `roadmap.md` alongside the script tier's own SRI gap, not attempted in the same pass as shipping a working baseline.

## LOCKED: the widget exposes exactly two CSS custom properties for member theming

A member asked, reasonably, why an embed that is otherwise deliberately closed to host-page styling (see the widget-iframe-isolation entry above) can't at least match their site's accent color or font -- the two things most likely to make an otherwise-good embed look bolted-on.

**Checked against OWASP first, not assumed safe.** The Cross-Site Scripting Prevention Cheat Sheet's own rule is specific: untrusted data belongs only in a CSS _property value_, never a selector, a property name, or raw stylesheet text -- everything else is a listed dangerous context. A CSS custom property is exactly the safe case: `var(--x)` substitutes into the single specific property it's used in (`color`, `font-family`) and nothing else. A hostile or malformed value doesn't inject a new rule, a new property, or a `url()` the widget doesn't already declare -- it just fails that one substitution and falls back to the default, per the CSS spec itself. Verified this holds in a real browser, not just reasoned about: `testing/embed-frame.e2e.js`'s theming tests include a value shaped exactly like a real-world CSS-injection payload (`red; background: url(https://evil.example/track.png)`) and confirm it resolves to the widget's own default rather than partially applying or erroring.

**What's exposed, and why only these two.** `Widget.svelte`'s `:host` rule now reads `--accent: var(--indienode-accent, #b5502f)` (and the dark-mode equivalent), and `font-family` reads `var(--indienode-font-family, ui-sans-serif, ...)`. `--bg`/`--text`/`--border`/`--control-bg` stay fixed, not exposed: those are the pair this widget already tuned for contrast in both color schemes, and letting a member set background and text independently is exactly how a well-intentioned customization breaks legibility for their own visitors. Accent is low-stakes by construction -- it only reaches a focus-visible outline, never body text or the background it sits on.

**Two different mechanisms, one per tier, because the platforms genuinely differ:**

- **`widget-script`** (open shadow root, same document): CSS custom properties already inherit across a shadow boundary by the platform's own design. A member sets `indienode-widget { --indienode-accent: ...; }` in their own site's stylesheet -- no code here has to do anything for this to work; it already did, once the widget itself stopped hardcoding the value.
- **`widget`** (sandboxed cross-origin iframe): custom properties don't cross a cross-origin frame boundary at all, isolation aside -- inheritance only works within one document tree. `/embed-frame` reads `accent`/`font` from its own URL query string (`src/lib/widgetTheme.js`'s `sanitizeAccentColor`/`sanitizeFontFamily`, a narrow character allowlist per value, applied via Svelte's `style:` directive -- the same "Safe Sink" pattern the OWASP cheat sheet names for `style.property = x`) and sets them on `<indienode-widget>` itself before it mounts. The allowlist is hygiene, not the security boundary -- the boundary is that `var()` substitution can't be escaped regardless of what string reaches it -- but it's free to keep, and it gives a predictable, testable failure mode instead of relying solely on the platform.

**Deliberately not built:** a generator UI (color picker, font picker) to set these when exporting a site. Both mechanisms are opt-in and hand-edited today -- a member appends `&accent=...&font=...` to their copied iframe `src`, or adds one CSS rule to their own stylesheet for the script tier. Building a picker is a separate product decision with its own scope (does it validate live, does it preview, does it need to persist per-entry in `ring.json` or stay purely cosmetic and client-side), not implied by making the underlying mechanism safe to expose.

## LOCKED: connect-src's real gap, and why the e2e suite didn't catch it either

The CSP shipped this week broke `/join`, `/update`, and `/contact` outright: `connect-src` never included `n8n.kjnet.us`, the host behind `VITE_SUBMISSION_WEBHOOK_URL`/`VITE_CONTACT_WEBHOOK_URL`, so every real call `webhookClient.js` makes was blocked by the browser before any network activity happened. Found live, testing `/update`, not by anything in this repo's own verification.

**Why the audit missed it.** The pass that wrote `connect-src` checked what the widget needs (`ring.indienodes.us`) and what Turnstile needs (`challenges.cloudflare.com`) and stopped there -- it never inventoried the submission/contact webhook path at all, despite that being the single most-used interactive feature in the app.

**Why `testing/csp.e2e.js` didn't catch it either, which is the more important gap.** That suite's join-flow test already existed and ran clean, but it uses a pre-seeded generator draft that goes straight to the site-building editor -- it never calls `issueToken`. No test in the whole e2e suite did: the `"production"` project (what that suite runs against) built with no webhook URL configured at all, so `hasBackend` was false and the join/update/contact flows rendered their "not configured" closed state without ever reaching `fetch()`; `"join-mock-dev"` exists specifically to test those flows, but deliberately mocks around the real call so it can run reliably without a live backend. A CSP suite that never exercises the code path that broke cannot be trusted to catch a regression in it -- passing tests were not evidence of a working feature here.

**Fixed at the config level, not just the policy.** `playwright.config.js`'s `"production"` project now builds with `VITE_SUBMISSION_WEBHOOK_URL`/`VITE_CONTACT_WEBHOOK_URL` pointed at the real host on a path that doesn't exist (`https://n8n.kjnet.us/webhook/e2e-csp-probe`) -- real enough to make `hasBackend` true and force the genuine `fetch()` path (`useMock` also requires `import.meta.env.DEV`, which a built-and-previewed project never has), fake enough that n8n answers with its own 404 for an unregistered path and no workflow ever runs, so this can't create real submission rows or send real notifications. `testing/csp.e2e.js` gained two tests that click through to "Generate my token" and "Send message" and assert zero CSP violations -- confirmed these actually catch the original bug by reverting `connect-src` and watching both fail with exactly `n8n.kjnet.us` named as the blocked URI, then confirmed they pass again restored. Not asserting the request succeeds anywhere in either test; CSP evaluates and blocks (or doesn't) before the network layer is involved at all, so whether the far end answers is irrelevant to what these check.

## LOCKED: the pre-launch gate is enforced by Caddy, not by a PIN screen in the app

Widget validation is a public-release blocker that cannot be done locally -- it needs real
third-party host pages loading the widget cross-origin from the real production origin. So
production has to be live before the app is ready to be public, and something has to keep
the public out in the meantime.

**The first shape considered was an in-app PIN screen, compiled in by a build-time
variable. It was rejected because it would have protected nothing here**, and the reason
is specific to this architecture rather than a matter of degree: `adapter-static` means
Caddy hands every prerendered `.html` and `.json` to any unauthenticated request. A PIN
checked in client JS gates what the browser _renders_ and nothing else -- `curl
.../join.html` still returns the whole page, and `/ring.json` still returns the whole ring.
OWASP A01:2021 states the general form of this directly ("access control is only effective
in trusted server-side code... where the attacker cannot modify the access control check"),
and the Authorization Cheat Sheet is explicit that client-side checks "should never be the
decisive factor in granting or denying access." The gate has to live where the files are
served, which here means Caddy.

**The mechanism is public and that is fine; the credential is what stays out of band.**
`Caddyfile` and `gate/gate.caddy` are both in this repo, so anyone can read exactly how the
gate works. That is not the weakness it first looks like -- it is the same Authorization
Cheat Sheet point about not relying on obscurity, met by making the enforcement real
instead. What never appears in the repo or in client JS is the credential: a bcrypt hash
passed as `--build-arg GATE_PASSWORD_HASH`, generated by `caddy hash-password`. A long
passphrase rather than a short PIN, because Caddy's standard build has no rate limiter (that
needs a third-party module and an `xcaddy` custom build) and bcrypt's per-attempt cost is
therefore the only brute-force defense there is.

**Compiling the gate out when it is off is hardening, not the mechanism.** An ungated image
never creates `/etc/caddy/conf.d/` and never copies `maintenance.html`, so there is nothing
in it to find or switch back on -- verified by inspecting both images, not assumed. This
satisfies A05:2021's "unnecessary features enabled or installed", but it is a bonus on top
of real enforcement rather than a substitute for it, which is the distinction the in-app
version got wrong.

**Three Caddy mechanics decided the implementation, each of which fails silently.** All
were verified against a real `caddy:2-alpine`, not read off the docs and trusted:

- **`try_files` (directive order 15) runs before `basic_auth` (16).** The URI is already
  rewritten to `/embed-frame.html` by the time the gate's matcher sees it, while `header`
  (9) still sees `/embed-frame` -- so one named matcher gives two different answers at two
  points in the chain. Both forms are listed in the matcher for that reason. A `route` block
  does not fix this; it is order 26, later still.
- **Matchers in a set are AND-ed while arguments within one are OR-ed**, so the public list
  is several `not path` lines and must never be collapsed into several `path` lines, which
  could not all match at once.
- **The site's unfiltered `handle_errors` would otherwise swallow the 401** and answer the
  credential challenge with the 404 page. A status-filtered `handle_errors 401` inside the
  gate snippet wins over that fallback, which is also what keeps the whole feature contained
  in one file.

**A glob import rather than a named one**, because `import` of a missing named file is a
hard config error that would stop an ungated image booting. Measured against the two
alternatives: a glob matching nothing warns once at startup and carries on, an existing
empty file warns the same way, and only the glob needs no file on disk at all. A `sed`
marker in `Caddyfile` was rejected outright -- `sed` exits 0 when its pattern does not
match, so a typo or a `caddy fmt` reflow would silently ship an _ungated_ production image,
which is the one failure mode a gate must never have.

**What the gate deliberately does not hide.** The widget surface stays open with no auth,
because member host pages load it cross-origin in ordinary visitors' browsers -- that is
the thing being tested. `/embed-frame`, `/embed.v1.js`, `/ring.json`, `/badges/*`, and the
`/_app/*` chunks `/embed-frame` hydrates from are all public while the gate is up, so the
ring's content is publicly reachable during the window. That costs nothing real: `ring.json`
is already public data mirrored from `indienodes-ring`. What the gate buys is that the app
UI is not browsable, not linkable, and not indexable (`X-Robots-Tag: noindex, nofollow`,
applied unmatched so it covers the public carve-outs too; `robots.txt` stays allow-all on
purpose, since `Disallow: /` would stop crawlers ever fetching the pages that carry that
header).

**Two things that would have broken production had they not been caught.** The
`HEALTHCHECK` probed `/`, which answers 401 under the gate, and BusyBox `wget` exits
non-zero on any error status -- every gated container would have been permanently unhealthy
and restart-looped. It now probes `/ring.json`, which is on the public list in both modes,
so one probe is correct gated and ungated alike. And `caddy adapt` runs during the image
build in _both_ branches, so a malformed gate fails the build rather than the container's
first start.

## LOCKED: EULA 1.3 authorizes the rules /join was already stating

`decisions.md`'s own inclusion entry above establishes that an eligibility criterion which
binding text does not name is "a _fourth_ rejection ground that binding text did not
authorize," and that stretching existing wording to cover one is not acceptable. Auditing
`/join` against that standard found two rules being told to creators that no document
backed: purely-generative-AI content was not accepted, and the destination site must not
host discriminatory material. Both were real policy, stated in the one place a creator
actually reads, and enforceable nowhere.

**They are now creator representations under §5.4 rather than §8 checklist items, and the
split is the substantive decision here.** A reviewer cannot verify how a work was made and
cannot read an entire site; asking §8 to carry either would have written a criterion no
one can apply. §5.4 is the clause that already reaches the destination site ("The
Contribution and destination site comply with applicable law") and already collects facts
only the Creator can attest. §8's existing "violates §5.4" clause is what makes them
declinable, so nothing needed to be invented to enforce them.

**§8 gained three sentences, and only one of them is a new rejection ground.**

- _Presentable, not finished._ Works in progress, ongoing serials, and unfinished releases
  qualify wherever released work is already there; concepts, pitches, placeholders, and
  announced projects alone do not. This is a limit and a ground at once, bounded to the
  Creator's act of releasing rather than to the state of the artifact.
- _Authenticity._ A Node naming a creator it was not submitted by or for, or built from
  scraped, republished, or bulk-produced material, fails the checklist. Genuinely new, and
  the same existence test applied to the creator rather than the work.
- _The non-grounds sentence._ Rough production, small scope, niche style, an unpolished
  site, a small audience, and commercial failure are never grounds to decline. Not a
  ground but a bar on grounds; it carries the inclusion entry's "none may be used to
  decline" into binding text for the first time, where before it lived only here.

**Three words from the source brief were deliberately not used.** "Readiness" and "fit"
both invite exactly the merit judgment the inclusion entry forbids, and neither appears in
§8 — the text says _released or shared for others to experience_, a fact about what the
Creator did, not a verdict on the result. The brief's "enough real work for discovery to
be meaningful" was dropped outright: it is a volume test, and volume is not a criterion
this project has ever authorized.

**Version 1.2 to 1.3, per §19.2.** The version lives only in the EULA's own header table;
nothing else in this repository records it, verified rather than assumed. §5.1 also
regained the sentence "A Node with no directly playable media... is a supported shape, not
a rejected one," which the inclusion entry above quotes as binding and which had quietly
disappeared from the EULA — the entry's claim is true again rather than merely intended.

**The Terms of Use were deliberately not touched.** Their conduct sections govern what a
visitor does on the Service; creator-site content is EULA territory, and extending §6 to
reach a creator's own website would put the same rule in two documents with two scopes.
Recorded here because it looks like an omission and is not.

The reviewer's own surface gained a static "Review criteria" block on the private review
page — no checkbox and no new field, because a criterion posted with the decision would
create precisely the stored rejection rationale the runbook says is not retained. Existence
and authenticity were, until now, the only criteria a reviewer was never actually shown.

## LOCKED: the rating prompt is a third dialog, and the bar it crosses was argued rather than ignored

A one-time 1–5 star rating of the app, offered after ten visits, then a single optional
Ko-fi link. It collides with three things this project had already written down, and
pretending otherwise would have been the wrong way to ship it.

**The dialog-count bar, from the ambient-consent entry above:** "The bar for a third dialog
anywhere in this app should stay high; two is already more than the rest of the app
needed." This is the third, and — counting the support step — arguably the fourth. The bar
was not lowered by accident. What clears it is that this is the only dialog in the app that
can appear exactly once in the lifetime of a browser's storage and then never again, which
is a different kind of cost from a confirmation a visitor meets every time they use a
feature. The two existing dialogs are recurring interruptions in exchange for a guarantee;
this is a single interruption in exchange for the only signal this project has about
whether the thing is any good.

**Section 11's "no return-prompting mechanics"** is the harder one, and the distinction is
narrow enough to state precisely. A return-prompting mechanic is built to make someone come
back: a streak that breaks, a count that resets, a notification that pulls. This asks a
question of someone who came back on their own and then stops asking forever. It cannot
influence whether anyone returns, because it appears only after they already have, only
once, and rewards nothing. The count is never shown, there is no target, nothing accrues
past the threshold, and reaching it produces one question rather than a status. If any of
those stopped being true — a visible counter, a repeat ask, a reward — it would become the
thing section 11 forbids, and this entry should be read as forbidding that change.

**"Never surfaces unprompted"**, the rule the discovery trail is held to, is genuinely
crossed. It appears without being asked for. The trail's rule exists so that a passive
record of behaviour cannot become a nudge; this is not a record of behaviour and does not
describe the visitor to themselves. It is one question about the app, and there is no way
to ask it of repeat visitors without it arriving unrequested. Accepted knowingly, once,
for this.

**The boundaries that are not negotiable, and are enforced in code rather than promised.**
The rating is about the app, never a creator, a Node, or a work. It is never attached to
one, never ranks or recommends anything, and never returns to the app as a number anyone
can see. `feedbackStore.svelte.js` states the same write-only-with-respect-to-selection
rule `journalStore` does, and for the same reason. No identifier of any kind is sent — not
an anonymous id, which was considered and rejected as unnecessary: localStorage already
prevents the second prompt, which is the only job an id would have done.

**The prompt is marked answered before the request is sent**, so a network failure loses
the rating rather than earning a second ask. That ordering is the whole guarantee of "once"
and should not be inverted for the sake of retrying a number nobody is waiting on.

**A third webhook rather than an action on an existing one**, matching why Contact is
separate from intake: unrelated concerns with unrelated failure modes, and switching rating
collection off should not require touching the submission pipeline.

**Ratings are stored, which reverses this entry's own first answer, and the reversal is
the interesting part.** It shipped keeping nothing, on the reasoning that anything
aggregating ratings over time is an analytics store and that is on the project's
out-of-scope list. That was too broad a reading. What the out-of-scope list is protecting
against is a system that accumulates behaviour about people; a tally of anonymous integers
is not that, and the practical cost of the original position was real — a rating not
written down is gone, so "we can add storage later" silently means "we can start over
later." The table is `{ rating, created_at, app_version }` and there is no identifier in
the payload to store, so nothing about it can become personal data.

Three things bound it. **`created_at` is a date, not a timestamp**, because day-level
precision is all a trend needs and a per-second time is the one field that could be weakly
correlated against a web server's access log. **Storage is off unless `TABLE_RATINGS`
names a table**, so the workflow's shipped behaviour is unchanged until that is a
deliberate act. And **execution history stays off either way**, so the row is the only copy
rather than one of two.

This is also why the privacy notice went to 1.2 the same day it went to 1.1. Version 1.1
said ratings were "not stored in a database", which was true when written and would have
become false the moment the table existed. A privacy notice that describes the system as
it was last week is worse than one that changes twice in a day.

**It is also the first thing this app sends off-device on its own**, which is why the
privacy notice moved to 1.1 rather than being left alone. Every form before this was
something a person deliberately filled in and submitted; this is the app asking. The notice
now describes what is sent, states that no identifier travels with it, and says the rating
is not stored, profiled, or fed back into anything.
