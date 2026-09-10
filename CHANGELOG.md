# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **A note on the entries below 0.7.0.** This project was built in a continuous run before its first commit, so the releases here are a retrospective grouping of that work rather than a record of tagged, published releases. `0.0.1` is the phase-0 scaffold and carries its real date; the dates through `0.6.0` are approximate placements within the same build window, not release days, and the versions from `0.4.0` through `0.6.0` are grouped by theme rather than by the exact order any individual line landed in. Nothing before `0.7.0` was ever deployed. `0.8.0` was tagged without a changelog entry at the time; the one below was written after the fact, from that release's own commits, for the same reason the entries below 0.7.0 exist.

## [Unreleased]

## [1.5.1] - 2026-09-09

A fix-only release for multi-select in Arrange mode. The feature shipped in 1.5.0 moved and
scaled a group correctly, but almost everything _around_ the gesture was wrong — what the
drag previewed, whether the drop committed at all, and whether the selection survived it.

### Changed

- **The Capacitor and Wails hosts are pinned at 0.0.1, and no longer track the web app's
  version.** Nothing was ever decided here: the hosts were scaffolded at 1.1.0 because that
  was the web app's version that day, `scripts/platforms/verify-versions.mjs` then required
  them to match it, and every release since dragged two untouched scaffolds along behind it
  — as far as 1.5.x, with Android's `versionCode` up at 7, implying six store submissions
  that never happened. A version is a claim about maturity and theirs was overstating it by
  four minor releases. `versionCode` goes back to 1 for the same reason, which costs nothing
  because nothing has ever been uploaded. The check now requires only that the three native
  version strings agree with each other, so they move on their own schedule once native
  development actually begins.

### Fixed

- **A multi-select drag in Arrange mode now previews and commits the whole group.** Three
  things were wrong at once while a selection was in flight, all of them in what the
  gesture showed rather than in the selection itself. The drop target under the group was
  gridstack's own placeholder for the single grabbed node, so a group move previewed one
  card and left the rest unaccounted for; every selected node now gets a ghost, drawn from
  the same clamped pointer delta the drop itself uses. A selected node that the engine's
  live collision handling shoved aside mid-drag carried that shove into its preview and
  visibly popped out of the group; each follower is now drawn from where it stood when the
  drag began, so the selection holds its shape whatever the engine does underneath. And
  the group appeared to snap back to its old position and slide into the new one on
  release, because gridstack's position transition ran over the settling frame; that
  transition is now held off for exactly as long as the drop takes to settle.
- **A drop is no longer silently discarded when the engine refuses the move.** gridstack
  emits no `change` event at all when its own idea of the dragged node's position is
  unchanged, and it refuses to move a node onto occupied cells — so an ordinary drop onto
  a neighbour produced no event, the drag was never resolved, and the whole group sprang
  back to where it started. (Nudging past the target and back appeared to fix it only
  because any engine movement at all produces the event.) The drop is now settled from the
  release itself when no event arrives, from the same snapshot and pointer position it
  always used, so what the drop commits no longer depends on the engine having an opinion
  about it.
- **A selection survives the gesture that moved it, as long as shift is still held.** A
  drag or resize begins on a card and ends somewhere else, so the browser picks the two
  targets' common ancestor as the trailing click's target — the grid itself, which the
  background handler reads as "clear the selection". Every group move therefore threw away
  the group it had just moved. Holding shift through the release now keeps it, so the same
  group can be moved again without being rebuilt; releasing without shift still clears, as
  the way to let a selection go.
- **A follower no longer pops out of the group for a frame during a slow drag.** gridstack
  listens for `mousemove` on the document; this component listens for `pointermove` on the
  grid, and the browser fires the pointer event first — so a preview computed only when a
  pointer event arrived was always exactly one event behind the engine, painting every
  shove before undoing it. A pointer that then stopped moving left that broken frame on
  screen until the next move came. The preview is now redrawn before every paint for the
  length of the gesture, which also covers the movement no pointer event announces at all:
  gridstack's throttled cell-height re-measure, its auto-scroll at the edge of the window,
  and the page shifting under a grid that grows as a node is carried down it.
- **A dropped group lands where it was let go.** Positions were written one at a time into
  an engine that evaluates collision live on every write, so members of a group — which
  overlap each other's start and target cells by construction — pushed each other on the
  way in: two stacked nodes dropped two rows down committed a twelve-row move. Every node
  is staged clear of the arrangement first, the same way the layout-restoring paths
  already do it, so the only collision left to resolve is a member landing on a neighbour
  that stayed put.

## [1.5.0] - 2026-09-08

The widget-and-ring validation release. Both required pre-release passes named in the
roadmap — validating the widget contract against real host pages and an explicit
responsive sweep — are complete, closing the last gate on the public-release path.
Published first as rc.1 and rc.2 while that validation was in progress; this entry
squashes both into the real release.

### Added

- **Shift-click or shift-drag select multiple nodes in Arrange mode.** Dragging or
  corner-resizing one member of the selection moves or scales the whole group together,
  with a live preview that tracks the pointer during the gesture instead of only the
  grabbed node updating until drop. A mixed-type group snaps each member back to its own
  type's allowed shape after a proportional resize.
- **Undo and redo for arrange-mode placement and resizing**, from a pair of buttons next to
  the arrange toggle.
- **A "Get Widget Code" nav entry**, so a visitor who has already been to `/widget` can find
  it again without re-discovering the URL.

### Changed

- **The widget page is now four tabs** — Full widget, Badges, Text only, Advanced — each
  with its own live preview and copy-paste snippet, replacing the previous two-section
  layout.
- **Play and pause fade the audio in and out** instead of snapping straight to full or zero
  gain.
- **The default first-visit arrangement scales with the actual viewport** instead of
  assuming exactly the authored column count, so a wide first load gets a centered,
  appropriately sized starting layout instead of one that reads as small and off-center.
- **The rating stars** carry a gold gradient fill, a hover particle burst, and a Ko-fi mark
  on the support step.

### Fixed

- **`/embed-frame`'s CSP no longer blocks its own ring fetch** under the production
  configuration, where it was silently falling back to the same-origin ring mirror instead
  of the configured origin.
- **The sandboxed iframe widget tier loads on member sites again.** `/embed-frame`'s
  deliberately opaque-origin iframe fetches its own SvelteKit hydration chunks under
  `/_app/immutable/*` in CORS mode, and that path never carried
  `Access-Control-Allow-Origin` — every third-party embed (and this app's own `/widget`
  preview) failed with `Access to script ... from origin 'null' has been blocked by CORS
policy`, found live on real member sites.
- **The node preview card on `/update`** renders once a node is verified, instead of
  collapsing to a 2×2px box.
- **The sound dock stays centered** independent of its own fly transition.
- **Claiming a different node from `/update` replaces a stale in-progress draft** instead of
  the old draft's fields winning because the id field was already non-empty.
- **The PNG favicon fallback** is generated from the small mark rather than the full logo.
- **An arrangement authored wider than the canvas's authored column count no longer
  cascades on overflow.** Whether the field renders the authored layout or a derived one
  now checks real fit, not just column count, and derived layouts are packed rather than
  left to gridstack's own collision resolution, which previously clamped one overflowing
  node and shoved its neighbours out from under it.
- **Batch-restoring several nodes to their saved positions on load no longer risks a later
  restoration colliding with an earlier one's just-corrected spot** (gridstack evaluates
  collisions live even inside a batched update).
- **A hover flicker on the rating stars**, caused by the lift transform moving each star's
  own hit-box out from under a stationary pointer.

## [1.4.0] - 2026-09-03

The arranging release. The field stopped being a canvas that shrank to fit and
became one that keeps its nodes at a readable size and gives them more room as
the screen allows, and the drag that arranges them now commits what the visitor
actually did rather than whatever the pointer passed over on the way. Mobile got
the audio player it needed rather than a sheet stacked above the nav.

### Changed

- **The mobile audio player takes over the primary nav instead of stacking above it.** Its
  own Hide control restores the nav; the × still owns the hard close that stops playback and
  clears the queue. The queue reorders by touch through a Pointer Events drag on the visible
  grip, since native HTML drag does not reliably fire for touch, and rows animate into their
  new order rather than jumping.

- **Members' cover art fills the card on a phone**, with the entry's text over it, falling
  back to the plain card when an image fails to load. The `/join`, `/update`, and modal type
  scale steps up below 40rem, where the desktop scale had become hard to read.

- **A gated build is now an explicit action rather than a repo setting.** Ordinary pushes
  baked the pre-launch gate into the image whenever the gate credentials happened to be set
  in repo config, with nothing to catch a testing round left armed before the next release —
  a real risk when tags go out every few days. Push-triggered builds now always resolve
  those to empty, producing a gated image requires a manual run with the gate input checked,
  and every run's summary states plainly which it was.

- **Nodes hold their size; the canvas gains columns instead.** Cards used to scale with the
  window, which meant they inflated on a large display and shrank on a small one until a
  card's own container query dropped the `why` line under the title and clipped the Visit
  button. The cell is a fixed size now and the _column count_ follows the viewport, so a
  card is about the same card at 2560px as at 600px and a wider screen buys more room to
  arrange into rather than bigger cards. The one exception is the narrowest layout, where
  four columns fill whatever width there is, because below about 250px a card cannot hold
  its size and still fit.

  There is no upper limit on the count. Past the authored 24 the extra columns are simply
  more canvas, which is what keeps a large display from rendering as a centred column with
  dead margins either side. Below 24, the arrangement is re-derived from reading order to
  fit the room that is left.

- **Fit-to-view caps the column count instead of pinning it.** It used to scale the cell
  down until the whole arrangement fitted the window's _height_, then pin the grid to that
  width — on a 1608px screen with a tall arrangement that left a 1165px column with 391px
  of dead margin either side, none of it draggable, and cards at 194px instead of 243px.

  It now does one thing: stop the canvas growing past the authored width, so the
  composition fills a wide screen rather than sitting in the left of one. That cap applies
  upward only. Downward it collapses like the default, because holding 24 columns onto
  smaller screens rendered cards at 119px and then 45px, never reaching a single column —
  a composition preserved in name only.

- **Arrangement drops preserve intentional empty canvas space** instead of packing a moved
  node upward toward its neighbours. Each mode keeps the collision model its drop needs:
  the canvas floats, so a node stays in the gap it was placed in; the mobile stack keeps
  top gravity, which is what turns a downward drag there into a reorder rather than
  sliding every card below the pointer down by the same amount.

- **The orbiting background blobs hold still while a node is being dragged.** They are the
  most expensive thing on the page to rasterize, and arranging is the one moment the
  browser is already busy laying out the field under the pointer; with them running, about
  a quarter of frames during a drag came in at half rate. A full orbit takes 22 to 45
  seconds, so pausing one for the length of a drag is invisible.

- **Every node shows its type while being arranged.** The row carrying the type chip was
  hidden in arrange mode, on the reasoning that a node's own menu states its type — which
  meant opening a menu per node to read something a chip already says, exactly when
  resizing makes you want to know. The chip stays now, on empty nodes too, where it matters
  most: an empty node has no artwork to identify it and is otherwise a blank rectangle. The
  like and hide toggles still go, since those were the controls that covered Remove.

### Fixed

- **A creator's `source_url` is no longer fetched twice on verify-then-submit.** Finalize
  re-ran the SSRF-hardened ownership check even when the verify step had confirmed it
  seconds earlier. A successful verify is stamped and the redundant fetch skipped when
  finalize follows within 90s — never on the notification-failed resume path, which can be
  arbitrarily old, and every other finalize gate still runs regardless.

- **Build assets and `ring.json` carry cache headers**, which neither had. `embed.js` and
  `embed.v1.js` are deliberately left uncached: they are mutable at a fixed URL by design.

- **A drag that pushes nodes aside and is then abandoned no longer commits their displaced
  positions.** Neighbours are shoved continuously as the pointer moves, and the only
  mechanism for putting one back walks it _upward_ toward where it started — so anything
  shoved upward had no route home, and the node that shoved it could not reclaim its own
  cell either once that cell was occupied. Dragging a node up and back down left the whole
  column permanently shifted. A completed drag is now resolved from the arrangement it
  started in, with the drop cell taken from where the pointer was released, so the result
  depends only on where the node was let go and never on the path it took.

- **Resizing the window back and forth while arranging no longer runs the update depth
  out.** The responsive layout effect wrote node positions, gridstack announced them as a
  change, the change listener re-measured the grid, and that measurement was state the
  effect reads — so it ran again. It only terminated when the engine happened to land
  exactly where the effect asked, and top gravity in the re-arranging tier did not always
  allow that: the shelf packer leaves a gap under a short node sharing a row with a tall
  one, and gravity pulled the next row up into it. The measurement no longer re-enters on
  the effect's own writes, and gravity is now off only at the narrowest layout, where it is
  what turns a downward drag into a reorder.

- **Dragging a node no longer shakes the whole view.** This was a loop rather than a
  jitter: the field's cell pitch comes from its container's width, the drag margin beneath
  it was four cells deep, and so the document's _height_ depended on its _width_. With
  classic space-taking scrollbars — overlay scrollbars hide it completely, which is why it
  never showed in testing — dragging a node down grew the page, summoned the scrollbar,
  narrowed the container, shrank the cell, shrank the page, dismissed the scrollbar, and
  went round again. The scrollbar gutter is reserved whether or not one is showing, and the
  drag margin is a fixed length, so neither edge of that loop is left to close.

- **The arrange-mode dot grid fills the viewport, and adds no scroll doing it.** It was
  sized to the field's own box, so it began below the header, stopped at the lowest node,
  and left bare page above and below as soon as anything scrolled; giving it a min-height
  instead only made an absolutely positioned box overflow its parent and lengthen the page.
  It is now fixed to the viewport, so it can neither fall short of the screen nor add a
  pixel of scroll to it, with only the lattice tracking the grid so the dots stay on real
  cell boundaries as the field scrolls beneath.

- **The arrange-mode intro sweep hands over to the resting grid without a jump.** The sweep
  draws the same dot pattern the canvas behind it does, but the canvas offsets its lattice
  by the grid's own position and the sweep's columns did not — so they sat about a third of
  a cell out vertically, and the whole grid appeared to shift into place the moment the
  animation ended. Measured at 22.5px on a 65px cell; nothing now.

- **The arrange-mode intro sweep covers the whole screen.** The dot canvas is the full
  viewport, but the sweep was generated one column per _grid_ column starting at the grid's
  own left edge, so it rippled across the arrangement and left the page gutters bare until
  it finished and the resting grid appeared behind it.

- **The ambient background refills the viewport when the window grows.** Its particles only
  wrapped at the edges, so enlarging the window left the new area bare until they happened
  to drift into it — at roughly half a pixel per frame, tens of seconds of visibly empty
  screen down one side. Positions are now rescaled into the new bounds, and the particle
  count is re-derived so crossing the mobile breakpoint changes the density rather than
  leaving whichever one applied when the page loaded.

- **Dragging a node below the authored width now works, and no longer disarranges the
  field when it does not.** The responsive layout pass reads the measured cell pitch, and
  gridstack resizes the grid container continuously while a node is in flight, so that pass
  ran mid-drag and repositioned the node under the pointer — which both snapped it back and
  left gridstack refusing every later move of that drag, while the neighbours it had already
  pushed aside kept their pushed positions. Geometry now belongs to the engine for the length
  of a gesture, and a drag that ends where it began writes nothing at all.

- **Arrange-mode resize handles are offered wherever the arrangement is the authored one.**
  They used to appear only at the full 24-column layout, which before the column ladder was
  removed meant windows above 1400px; every narrower width could drag a node but never
  resize it. Now that the authored count holds at every width with room for it, so do the
  handles — the full set of horizontal, vertical, and corner grips. They stay off only
  where the layout is re-derived rather than stored, since there is no arrangement to
  preserve there to resize.

## [1.3.0] - 2026-09-02

The custody and hardening release. Member data moved out to `indienodes-ring` and this
repository became a consumer of the ring rather than its owner, a security pass closed
the gaps that move made visible, and the visitor finally has terms of their own rather
than only the creator-facing EULA.

### Added

- **Visitor Terms of Use and a Privacy Notice**, published at `/terms`. Both live in one
  Markdown document rendered at build time through the same path the EULA already used,
  so the file stays the single source of truth and only rendered HTML reaches the
  browser. `/join`'s consent step links both, so a creator agrees to the EULA and the
  Terms in one place. This closes the last of the three public-release blockers that was
  not about testing.
- **A pre-launch access gate**, off by default and compiled in at image build time. It
  puts the application behind an HTTP credential while leaving the widget surface a
  member's own site loads cross-origin fully open, so the public widget contract can be
  validated against real host pages before the app itself is public. Enforced in Caddy
  rather than in the app, because a static site hands every prerendered file to any
  request and a browser-side check would gate nothing. See `docs/pre-launch-gate.md`.
- **Embedders can theme the widget's accent color and font** through two CSS custom
  properties, validated before they are applied.
- **`ring.json` carries an envelope with its own version**, so a consumer can tell which
  contract it is reading instead of inferring it.
- **Turnstile on `submit_update` and `request_removal`**, matching the protection the
  first-submission path already had.
- **`VITE_DEV_ALLOWED_HOSTS`** for reaching a development server from another device on
  the network without editing the config.
- **Ring data is validated in CI on `main`**, and a pre-push hook refuses a push that
  would carry a stale mirror.

### Changed

- **This repository consumes the ring instead of owning it.** Member records, curation
  policy, and their operational docs live in `indienodes-ring`; what ships here is a
  committed mirror plus the client that reads it. Approval writes were redirected
  accordingly.
- **Drifty Stars is the default background.** It caps at 30fps, pauses in a background
  tab, and paints a single static frame under `prefers-reduced-motion`, so it is a
  reasonable default rather than something to opt into. Settings' copy follows.
- **The submission rate limit is shorter, and is stated before the form** rather than
  discovered by hitting it.
- **Animated GIF and WebP uploads keep their animation** in the site generator instead of
  being flattened to a still frame.
- **`/contact` says what actually happens to an address.** It claimed the address was
  "used once, to reply, then deleted", which could not be true of a message delivered
  into a mail system. Disabling execution retention keeps a second full copy from being
  stored, which is real, but it is not what the page had promised.

### Security

- **A real Content-Security-Policy**, applied at the edge, with the widget's iframe target
  carved out because being framed by any member site is its entire purpose.
- **The widget's default embed is a sandboxed iframe, not a script tag.** A script runs
  with the full authority of the page it is pasted into; an iframe without
  `allow-same-origin` gets a forced opaque origin. The script tier remains available as
  the advanced option.
- **`verification_token` is no longer published.** The ownership token proved control at
  submission time and was then copied into public ring data for every approved member. It
  is now cleared at review and at approval. The schema keeps the property, deprecated and
  no longer required, so entries already carrying one stay valid.
- **The ring is validated at runtime instead of trusted**, so a malformed or hostile
  document cannot reach rendering unchecked.
- **A DNS-level SSRF gap closed**, with referrer and sandbox leaks tightened and Turnstile
  responses actually verified.
- **GitHub Actions pinned to commit SHAs** rather than mutable tags.

### Fixed

- The Content-Security-Policy blocked the submission and contact webhooks outright,
  breaking `/join`, `/update`, and `/contact`. Found live rather than by the suite, which
  never exercised the call; the e2e configuration now forces the real fetch path.
- The image build failed on the new terms import, because `.dockerignore` excludes `docs/`
  wholesale — the same trap already documented there for `CHANGELOG.md`.
- The container healthcheck probed a path the access gate answers with a 401, which would
  have marked every gated container permanently unhealthy.
- Comic pages are capped at three on both `/join` and `/update`.
- The field grid stays hidden until gridstack's layout has actually settled, instead of
  flashing an unpositioned grid.
- The embed script and ring are served with CORS, without which the widget worked only on
  this origin.
- The site generator shows uploaded files in the editor preview, and commits typed fields
  when you finish rather than while you type.
- `blob:` cover-art previews and the credentialed manifest fetch are allowed.
- The join page-editor's social-link preview refreshes on blur instead of mid-typing.
- The join and update nav bar has horizontal padding again.
- The fixture server honors `X-Forwarded-Proto` when rewriting asset URLs.
- `prepare` no longer breaks `npm ci` inside the image.

## [1.2.0] - 2026-08-29

The creator-first media release. Art becomes a fifth first-class type, text entries can
be read aloud, games separate their two preview paths, and a field node becomes a channel
rather than a typed slot. The ring contract grew to carry all of it without invalidating
a single member file already published.

### Added

- **Art is a first-class ring type.** A top-level `artworks` array of one to three
  objects, each requiring an image and creator-supplied alt text, with optional title,
  year, medium, and outbound link. The change is additive: existing member files remain
  valid and need no migration. Art nodes get their own field stage and reuse the tuned
  pan/zoom/swipe viewer in an art mode that shows works contained rather than cropped,
  preserving the semantic difference from comics — pages are sequential, artworks are
  independent.
- **Text entries can be narrated.** `excerpts` items are now either the
  `{ text, audio_url? }` object the forms produce or the bare string used before samples
  could carry audio, and both are deliberately valid; accepting only the new form would
  retroactively invalidate every text entry already published. `normalizeEntry` lifts the
  string form at read time, so the two shapes exist only at the storage boundary. The
  read-aloud control follows whichever sample is showing and plays the creator's own
  recording when there is one, falling back to the browser's on-device speech service.
- **Text nodes surface the entry's own words.** A sample is laid over the cover behind a
  deeper scrim than any other type, because prose is read rather than glanced at, and a
  Read control opens the full set in a reader with per-sample tabs and arrow-key
  navigation.
- **Games carry `trailer_url` alongside `preview_url`** rather than overloading one field,
  so the muted automatic preview and the click-to-load third-party embed stay separately
  described and separately validated. Trailers load only after an explicit press, and the
  application host pauses and resumes the music queue around them.
- **Five Art site templates** — quiet gallery, open studio, art edition, collection wall,
  and slow light — genuinely different compositions over one normalized artwork shape,
  with Art export writing stable local asset paths that map back into a valid Art ring
  entry. Fixtures deliberately mix portrait, landscape, and square work, because a gallery
  template that only ever sees one aspect ratio hides the cropping bugs these templates
  exist to avoid.
- **Join and Update collect the new contract**: a repeatable artwork row with required
  alt text, a trailer field validated against supported YouTube forms, and rich-text
  samples each with an optional URL for the creator's own recording. Author HTML is
  sanitized against a prose-only allowlist before it is persisted and again wherever it is
  rendered. The editor is route-split to these two authoring routes, so an ordinary
  visitor loads none of it.
- **Per-node tag channels.** A field node now narrows by tag as well as by type, so "a
  lo-fi audio node beside a VGM audio node" is expressible, with the picker offering only
  tags entries of that node's type actually carry. The global tag preference stays as the
  broad layer and the two compose: an empty selection at either adds no restriction. A
  node left empty says which layer emptied it and links to the control responsible.
- **Per-template generated-site customization.** Each template maps shared roles — main
  color, page background, card surface, text — onto its own CSS variables, so all
  twenty-one offer real color control instead of one offering four and three silently
  offering none. A role is omitted where it cannot be served well.
- **Templates can declare editable copy.** Static Ticker's scrolling banner is the first:
  it shipped with placeholder tour dates baked into it and is now the creator's own line,
  with a speed control alongside it.
- **An About page for text templates.** The portrait and bio move to `about.html` and the
  index keeps the writing, with a Home/About switch in the editor — without it those pages
  would be invisible until download, since a `srcdoc` iframe has nowhere to navigate.
- **A graph view for the dev-only audio tuning panel**, at `?debug=audio-graph` or one
  click from the existing `?debug=audio` sliders. It draws the beat detector's low-pass
  filter as a frequency-response curve whose cutoff and Q can be dragged directly, and
  plots the last few seconds of bass against the beat threshold, the big-hit threshold,
  the floor, and the refractory window each counted beat opens. Threshold lines redraw
  through recorded history as the sliders move, so a proposed value can be judged against
  bass that already played.
- **Thin Capacitor/Android and Wails desktop hosts** consuming the same canonical SvelteKit
  static build, with root commands for synchronization, launching, and release builds.
- **A protected emergency member removal workflow**, narrowly scoped and separate from the
  voluntary self-service removal a creator performs from `/update`.
- **Tag search inside a node's own menu**, with the tag list boxed off as its own control.
  Selected tags stay visible whatever the query says, so a filter can always be undone.
- **Animated no-cover icons**, and type icons on the arrange menu's content types.
- **A full-screen preview button** beside the editor's collapse toggle, using the
  Fullscreen API with the fixed-overlay fallback Ambient view already needed for iOS.

- A scheduled whole-ring member health run (`member-health-scheduled.yml`), weekly and
  on demand. The existing pull-request check only ever looks at the member files a PR
  touches, so nothing revisited an entry after merge — the gap that matters most for
  link rot, which is the expected failure when members host their own media. It reports
  every result to the job summary and fails only on a definite 404/410.

### Changed

- **The generated-page builder is now one editor.** Settings and the live preview share a
  near-fullscreen dialog, and the settings sidebar collapses so the preview can have the
  whole surface; the step itself is just the way in. Split side by side, neither half had
  the room to be much use — the preview was too small to judge a page by and the settings
  column too narrow to lay a form out in. The step now leads with what the editor is and a
  wireframe of what it makes, rather than a single line and a button.
- **The bio is written in its own dialog** with inline formatting — bold, italic, links —
  instead of a five-row textarea in a narrow column. It is inline only by design: every
  template renders the bio inside a paragraph, so offering block formatting the sanitizer
  would throw away is worse than not offering it.
- **Browse nodes act on one tap.** Field nodes mirror their primary labelled control across
  the passive card surface for Audio, Art, Comic, and Text. Game stays out of it, since
  loading a third-party trailer or leaving the site is a larger choice than an incidental
  card tap should make. Activation is gated so neither page scrolling nor the fitted
  field's horizontal scroll can trigger it by accident.
- **Text stages alternate** between introducing the creator and reading the work rather
  than showing both at once in the same small card, and Art stages cycle their works and
  report their own countdown, so a single creator with several pieces still shows progress.
- **The audio queue is reordered by drag**, with Alt+Arrow keyboard and touch equivalents,
  instead of per-row up/down buttons.
- **The ring widget centres itself in every generated site.** Four templates had written
  the identical centring rule and seventeen had quietly left the widget against the left
  edge; the wrapper is emitted by shared code, so it now carries its own layout.
- **Typing and colour drags settle before the preview re-renders.** Colour, name, and bio
  changes commit on a short idle, so dragging a picker no longer re-renders the page
  continuously while the control itself stays immediate.
- **Every generated shell and stylesheet carries a header** explaining the design, what the
  double-brace placeholders are, what not to touch, and where the palette lives. These
  files are the only documentation a creator gets for the site they just downloaded.
- **Modals sit above the floating page chrome.** The backdrop moved to 200; the brand mark
  and menu trigger had been painting on top of every dialog. A modal is modal.
- **Join and Update step navigation is pinned** to the bottom of the scrolling step, with a
  hairline and short fade that appear only while there is more content below.
- **Each Elsewhere link can show or hide its own label** on the generated page, moving the
  text to an `aria-label` so the link still says what it is.
- **The first-visit field gained an Art slot.** It shipped with comic, text, audio, and game
  only, so a first-time visitor never saw an Art member without opening Arrange first. A
  type that never appears is one nobody discovers. Stored visitor layouts are untouched.
- **CI and the ring workflows run on Node 24**, and an empty member ring is supported
  throughout them.

### Fixed

- **Node fallback marks drew the wrong thing.** The gamepad paths had been left inside the
  `art` branch and there was no `game` branch at all, so Art drew a picture frame with a
  controller through it and Game drew nothing. The test passed throughout because it asked
  only whether _something_ on the icon was animated; it now names the shapes each mark owns
  and asserts no mark contains another's.
- **Static Ticker's banner repeats seamlessly at any message length.** It was translating
  each copy by half its own width, which is a nudge rather than a scroll, and left gaps once
  the message was shorter than the banner.
- **About pages wear their own template.** Loading the right stylesheet was never enough: a
  template styles its wrapper and link lists by class, so a page built from generic
  `about-*` names inherited the background and body font and nothing else. The page now
  takes the caller's own class names, and each template styles its About link in its own
  voice rather than leaving it a bare browser-default anchor.
- **No template rendered the bio** after it became HTML. The fixtures supplied `bio` but not
  `bioHtml`, so the reference screenshots agreed that showing nothing was fine. Pinned with
  a test that every template shows the bio it is handed — or, for the two poster layouts
  with nowhere to put one, that it deliberately does not.
- **Arrange-mode resize grips sit on the card** at every node size, as one stroke of one
  thickness whose centreline lies on the card's outline. Two offsets had been compounding
  (`height: 100%` and `aspect-ratio` disagree inside the grid, and gridstack positions
  handles against the grid item while the card is inset by the grid margin), and gridstack
  additionally rotates the south-east handle 45° for its own diagonal icon — harmless for a
  dot, fatal for an arc, which it swung off the corner it was meant to trace.
- **A session no longer gets slower the longer it runs.** Every rendered field slot kept its
  120ms rotation interval alive while scrolled out of view, so live timers grew with the
  field rather than with what was visible; slots now tear the interval down when they leave
  the viewport. The audio analysis loop allocated two `Uint8Array`s per animation frame
  while a cross-origin track played, and now reuses buffers and is capped at 30fps.
- **The field's "nothing to show" state requires the eligible set to be empty**, not merely
  every node to be — otherwise it replaced several accurate per-node explanations with one
  wrong global one.
- **Removal and review automation** is unblocked, the verification token displays correctly
  on `/update`, and `/join` renders generated media and official badges.
- **A `$props()` destructure with no defaults broke `npm run build`.** It leaves the JSDoc
  above it with no declaration to attach to, so the comment lands on a generated template
  variable as a JSDoc cast that rolldown will not parse — passing check, lint, and the dev
  server while failing only the production build. One explicit `= undefined` fixes it.
- **The entry id a creator is shown is now the entry id they get.** `src/lib/slug.js`
  and the n8n workflow had each implemented the id rule separately and drifted three
  ways: the workflow did no Unicode normalisation, capped at 40 characters against the
  browser's 48, and truncated mid-word where the browser cuts at a hyphen. Every
  divergence produced the same silent failure — the form displays an id, a generated
  site bakes it into its footer embed, approval assigns a different one, and the
  member's `site-id` matches no entry in the ring for as long as that entry exists.
  `Sigur Rós` became `audio-sigur-ros` in the browser and `audio-sigur-r-s` at
  approval, so this hit ordinary accented names as well as long ones, and sites built
  from our own templates as hard as hand-built ones. The workflow now inlines
  `slug.js` itself rather than restating it, and the two are tested against one corpus.
- **The id the form displayed is honoured at approval when nothing has claimed it.**
  Sent as `requested_id` beside the entry — never on it, since `toRingEntry` output is
  schema-validated with `additionalProperties: false` — validated at intake and again
  at approval, and excluded from the publish allowlist so it never reaches `ring.json`.
  Uniqueness is still settled at merge time against the real file; what changed is that
  the ordinary case stops renaming an id the creator has already published.

## [1.1.0] - 2026-08-27

### Added

- An opt-in Audio playlist setting randomizes the tracks within each audio node whenever Play
  or + Queue adds it. Existing playlist items stay in place, nodes remain grouped, and previews
  keep their listed first track until they are added.
- The Join entry step now renders a live node preview and lets creators upload a node cover even
  when IndieNodes is generating their site. Audio and game covers support normalized focal-point
  controls that remain stable across responsive card sizes and Update requests.
- Member health checks now confirm that source pages still carry either the matching full widget
  or the canonical badge/text participation link. Missing participation is reported for human
  review and never removes a member automatically.
- The first real member submission was added, while empty-ring builds and every client route are
  now explicitly supported and covered by browser tests.

### Changed

- Generated audio sites gained per-track players and template-specific color controls. No-site
  musicians can also keep externally hosted tracks instead of having to bundle audio files.
- The generated-page builder keeps template selection beside its sticky live preview, reuses the
  entry cover instead of asking for a second avatar upload, and sandboxes every `srcdoc` preview
  without same-origin authority.
- Administrator review presents signed Approve and Reject POST actions directly on the private
  review page. Approval still creates a pull request that must be reviewed and merged manually.
- Join and Update review screens now keep “See the exact data” inside one rounded,
  overflow-safe disclosure, with wide JSON scrolling horizontally inside the container.
- The submission and update forms now cap “Why is this worth someone’s time?” at 75
  characters, down from 160, with the browser input and validation sharing the same limit.
- The curation policy now defines the narrow eligibility checklist and the EULA permits removal
  under that policy without turning review into a subjective quality judgment.

### Fixed

- Generated social links now allow only HTTPS and `mailto:` destinations, preview frames are
  sandboxed, and Caddy adds baseline content-type, referrer, permissions, and framing headers.
- Verification continuation requests once again reach n8n, failure reasons are shown on Join and
  Update, review decisions generate valid pull requests, and every result path renders a useful
  response instead of a blank page.
- Native arm64 Docker builds no longer run through QEMU, and build-time public configuration is
  wired consistently into published images.

## [1.0.0] - 2026-08-25

First tagged release. The version number is the point: everything below was built
against a brief, and 1.0.0 says the shape it describes is now real rather than still
being discovered. Nothing here changes what the project is — `ring.json` is still the
product, and every client is still optional.

### Added

- **Ambient view**, the brief's surface (c) as a mode rather than a page: a full-bleed
  visual canvas with audio in a compact dock. Entry selects a track but leaves it
  paused, so launching the mode is never itself permission to make sound. A square
  discovery card offers a second audio lane with audition-once and replace actions; a
  single tap pauses visual rotation and reveals per-medium creator actions.
- **Ambient adopts a queue it finds already playing** rather than dealing over it. The
  dock speaks for that queue directly, so entering the mode no longer discards the
  playlist someone built.
- **An unobstructed mode** that hides every ambient control so only the rotating visual
  remains, with a single tap to bring them back, and a brief "Now playing" announcement
  covering the track changes that mode would otherwise hide.
- **Game trailers** in ambient view, played from the developer-hosted `preview_url` with
  sound on an explicit tap. No YouTube embed, so the app's "no third-party trackers"
  statement stays true as written.
- **A text reader** using the browser's own `speechSynthesis`. Chosen over a bundled
  neural model on size — several megabytes to read three capped excerpts is the wrong
  trade — and local-only is _enforced_ through each voice's `localService` flag rather
  than promised: a device offering only network voices gets no control at all.
- **A full n8n submission pipeline**, rebuilt as seven workflows: intake, token
  lifecycle, re-verification with SSRF guards, review actions with atomic claiming,
  finalisation, a signature helper, and an error workflow. Notifications moved from
  Discord to Gotify push and SMTP. Data Table schemas and live workflow definitions are
  backed up in-repo so recovery does not depend on one machine.
- **Voluntary removal.** A creator can withdraw their own entry from `/update`, offered
  only once they have proved control of the page their node points at — the same claim a
  correction makes, so it appears at the moment that claim is accepted rather than as a
  cold link. A reason is invited and never required. Approval opens a pull request that
  deletes the member file; nothing leaves the ring until a human merges it. There is no
  stored address to notify, which is why this is self-service rather than a request sent
  somewhere: the proof of control _is_ the authorisation.
- **Finding your own node without knowing its id.** `/update` used to demand an exact node
  id that appears nowhere in the interface — a member who joined two years ago remembers
  their site and their name, not `audio-ashzone-xeno`. The identify step now matches on
  site URL or creator name as well, listing the candidates when more than one fits, and
  `/members` links each entry straight through to `/update?node=<id>`.
- **A contact workflow.** `/contact` had no backend at all — in any production
  build it reported itself closed. Messages now reach a maintainer via push with
  mail as a fallback. Nothing is stored: the sender's address is carried in the
  message and set as the reply-to, and n8n's own execution retention is disabled
  for this workflow, because the form promises the address is used once and then
  deleted and retained execution data would have made that untrue. If neither
  channel delivers, the sender is told so and asked to retry — with nothing kept
  anywhere, reporting success would be a claim nobody could check.
- **The published ring no longer carries test data.** Four fictional members
  lived in `members/` so the end-to-end suite had one entry of every type to act
  on. Every deploy shipped them, and the ring could not be cleared without
  turning twelve tests red. The suite now seeds its own ring after the build, so
  `members/` holds only real members and the two stop constraining each other. A
  guard test fails if a placeholder is ever added back.
- **An empty ring is a supported state.** It is where a fork of this project
  starts and where this one returns if every member withdraws, so it had to be
  something the app grows out of rather than a wall it hits. Every route serves,
  the field view says so plainly, `/members` drops its search box rather than
  offering a control with nothing to search, and ambient opens to a silent
  session instead of failing.
- **Member link health checking** (`npm run members:health`), probing every public URL in
  the canonical member files, escalating only after repeated failures rather than on one
  transient error, and optionally re-confirming each site still carries its verification
  meta tag.
- **`VITE_KOFI_URL`**, making the donation link build-time config like the webhook URLs.
  Unset drops the About modal's Support tab entirely rather than linking nowhere.
- **CI** (`.github/workflows/ci.yml`): type check, lint, unit and end-to-end tests on
  every push and pull request. Image publishing now depends on it.

### Changed

- **`/update` no longer keeps an email address between visits.** Typing an address into
  the change form and closing the tab used to leave it in the browser; the join form was
  already built not to, and the change form's own header claimed it matched. Now neither
  keeps it. Everything else in the draft still survives a reload — that is the part that
  protects someone's work, and the address was never it.
- **Mobile navigation** consolidates secondary destinations under More, and active audio
  became a single control that calls up and dismisses the player rather than two adjacent
  controls that read as one confusing play button.
- **Output volume moved into a store**, so every element that makes sound honours the
  same level. Ambient's discovery previews previously played at full volume regardless of
  the slider, and kept sounding while the player was muted.
- **Entry curation, deck rotation, storage keys, field geometry and viewer gestures each
  became one shared module.** They had been duplicated across surfaces, and had begun to
  drift: two of three copies dropped a dismissed node's queued tracks and the third did
  not.
- **`AmbientView`, `AudioPlayer` and `/join` were split** into their constituent surfaces
  and testable modules, roughly halving the largest of them.
- Unit tests went from 134 to 276; end-to-end coverage from 2 files to 9.

### Fixed

- **Storage writes are guarded everywhere.** Five stores wrote to `localStorage`
  unguarded, so in a private window or at quota, liking something _threw out of the click
  handler_ — the interaction failed, not merely its persistence.
- **Restored submission-draft rows are actually re-keyed.** The function meant to do so
  was a no-op, leaving colliding `{#each}` keys that smear values across rows when one is
  removed — the precise failure the uid system exists to prevent.
- **`npm run check` passes on a clean checkout.** It had been failing for everyone but
  the machine holding two untracked empty directories that masked an invalid route
  reference.
- **Published images carry every build argument.** Images built by CI had been missing
  the contact webhook, the Turnstile key and the Ko-fi URL, so they shipped with the
  contact form reporting no backend and no anti-bot control on either form.
- The reactive background keeps its analysis signal across volume changes, the player
  restores its full state when reopened, and automatic queue additions no longer expand
  the queue panel.

## [0.11.0] - 2026-08-18

### Added

- `/update`, a 4-step change-request form for correcting an existing node (a dead link, a swapped track, a rewritten pitch), reusing the submission form's own token-issue/re-verify contract and validation rather than a new mechanism. Linked from `/join` and the desktop nav drawer.
- `/contact`, a single-page contact form on its own webhook (`VITE_CONTACT_WEBHOOK_URL`), independent of the submission pipeline so either can be paused without affecting the other. Linked from the nav drawer and mobile tab bar.
- A dev-only `?debug=audio` tuning panel for the ambient background's beat detector: live sliders for the low-pass filter and every beat/big-hit threshold, a bar meter showing the current signal against both thresholds, and a copy-values button for locking in a tuning pass. See `docs/audio-reactivity.md`.
- `docs/audio-reactivity.md`, documenting the full audio signal path, the detector/reaction tuning split, and how to reuse the reaction math for a future second background variant.

### Changed

- Beat and big-hit detection now reads RMS off a real `BiquadFilterNode` low-pass branch instead of picking raw FFT bins — the same detector, fed a cleaner signal. Every threshold that used to be a hardcoded constant now lives in a shared, live-tunable store instead.
- Settings > Appearance is restructured into the same vertical-tabs layout Content already uses, with two new placeholder sections (UI Skin, Node Skin) naming what's planned without pretending there's a real picker yet.
- `docs/roadmap.md`'s theme section is rewritten as "Skins": two independent axes (UI Skin, Node Skin) replacing the old single-theme framing, naming Glassmorphic and the planned Retro Love bundle explicitly. Added two further entries: generated-template refinement, and `tiny-tts` as an optional Text-node reader.

### Fixed

- The big-hit reaction on the ambient background was a full-screen radial flash — a real photosensitive-seizure risk, given it was a rapid, large-area luminance change timed to music. Replaced with a particle radius pulse plus a brief burst of extra particles, which reacts through many small, localized changes instead.
- A generated site's `README.txt` now states the provisional entry id plainly. It previously only appeared (if at all) inside the "Full widget" embed tier's own markup, and not at all for the badge or text-link tiers, which carry no id by design.

## [0.10.0] - 2026-08-18

### Added

- **Not for Me**, a second node-level control alongside Like: a hard hide, mutually exclusive with liking, stored locally the same way. A dismissed node goes quiet in place in the field rather than being replaced instantly — the pool stops offering it to new slots right away, but whatever is already on screen holds until its own scheduled rotation. The like/hide pair now reveals on hover or focus in the field specifically, stays always visible on Lists, and reached the audio player and the comic reader, not just the field card. Pool exhaustion messaging now distinguishes a genuinely small ring from a visitor's own Not for Me list having caused the shortfall, both per node and at the whole-field level.
- Three embeddable ring-link tiers a creator can choose from: the original Prev/Next/Random widget, an 88×31 badge (four styles, including a mono variant that adapts to the host page's light/dark preference), and a plain text link. The two new tiers share one random-redirect destination (`/go/random`) rather than each carrying their own script. Tier is picked once at submission, on both the generator path and the existing-site path.
- Lists, renamed from Favorites: two tabs (Liked, Not for Me), a wider three-column grid, and bulk actions — a Select mode with per-card checkboxes, Shift-click range selection, and a confirm dialog only on the one bulk action that's actually destructive.
- A content-rules panel on `/join`'s Start step, and a highlighted, worked-example explicit-content panel on the Entry step.

### Changed

- Settings' Content tab is a vertical tab list now (one setting per tab, its content sliding and fading in on the right) instead of every section stacked two columns deep.
- The audio player's Like/Not for Me buttons are bigger and carry their own resting border, rather than reading as bare icons at the same weight as Prev/Next. Hovering Like raises and glows with a "Yah!" bubble; hovering Not for Me shakes with a "Nah.." bubble. "Keep going" at the end of a queue now only asks once per session — accepting starts a standing auto-continue instead of re-prompting after every track.
- `/join`'s Musicians hosting-compatibility help now only shows once "audio" is picked as the entry type, rather than unconditionally on the Start step.

### Fixed

- The generator's live preview embedded its badge/widget against the real production origin, which a local dev environment has no reason to be able to reach — neither rendered, with no visible error. The preview now points at wherever the app itself is running; the real downloaded export is unaffected and still uses the production origin, which is what a stranger's site actually needs.
- Switching tabs on Lists (and, before that fix informed this one, on Settings) could make a card visibly "pop" to the wrong size mid-transition — the outgoing panel's own exit transition needed a positioned ancestor to anchor against and didn't have one.

## [0.9.0] - 2026-08-17

### Added

- Every generator template (`Late Signal`, `Panel Room`, `Marginalia`, `Cartridge`) embeds a real, working ring widget in its footer by default, centered, using the best-guess ring id the review step already shows a creator (`provisionalId`) — a no-site creator no longer has to come back and paste the snippet in by hand. The success screen's "paste this wherever you like" instructions now only appear for a creator who brought their own existing site; a generator creator instead sees a note that it is already there. `README.txt` in the exported zip explains how to correct the id by hand if the one assigned at approval ends up different.
- A one-shot dot-grid ripple across the field's arrange-mode snap-grid the moment it switches on, and a matching outward burst (radiating from the middle column) the moment it switches back off, both skipped under `prefers-reduced-motion`.
- "Join the Ring" in the slide-out menu glows.

### Changed

- The general EULA, not the type-specific rights warranty, is now the one consent that gates submission: `rights_confirmation`'s wording is necessarily written toward one kind of work (audio's "recording and composition") and reads oddly for the others, so it stays collected but no longer blocks Continue or Submit. The EULA itself is reworded off audio-only language and now renders as a short statement next to its checkbox with the full text a click away in a modal, rather than the whole paragraph always inline.
- `pro_membership_name` is asked only when "Other" is picked — every named option (ASCAP, BMI, SESAC, GMR) already names itself by being chosen, so asking again was pure redundancy.
- Arrange and Theme moved out of the desktop nav drawer into a floating bottom-right cluster, mirroring the mobile top-right one that already carried both; reachable without opening the drawer at all now. The drawer's own top gained a logo-and-title header, since the floating top-left brand mark sits under the drawer's own backdrop once it is open.
- The success screen's reference code is its own centered, bordered block instead of sitting inline mid-sentence, and "Submit another entry" is a centered primary button instead of a small text link.

### Fixed

- `/join`'s export button intermittently failed with "Outdated Optimize Dep" / "Failed to fetch dynamically imported module." `jszip` is only ever dynamic-imported, which is exactly the shape that trips up Vite dev's dependency optimizer: discovering it mid-session (the first time a route actually reaches the `import()`) forces a re-optimize and a new hash, orphaning any tab that already loaded the previous one. Listing it in `optimizeDeps.include` makes it part of the eager pre-bundle at server startup instead, so there is no mid-session rediscovery left to race against.
- The inline site-generator preview hijacked page scroll while hovered, since a wheel gesture over an iframe goes to its own document rather than bubbling to the page. A click-to-activate overlay (paired with `pointer-events: none` on the iframe itself, belt-and-suspenders once a merely-visual overlay was confirmed not to be enough on its own) now keeps scroll on the outer page until a visitor explicitly opts in to interacting with what's inside it.
- The generator's "Your page" step, and short steps generally, read longer than their content needed on a tall viewport. Two causes: the preview panel's own "View full size" button was sized like a primary action (padding/font-size meant for the step's own Back/Continue row) rather than a small toolbar control, and `.panel`/`.step-body` used `height: 100%` rather than `max-height: 100%`, forcing every step to stretch to the full fixed-height budget even when its content was much shorter, which left dead space below a short step's own buttons. `.join-layout` also gained `overflow: hidden`, since `max-height` alone did not fully guarantee content could never push the fixed-height screen taller.
- The site generator's "Name to show" field showed the entry step's creator name as its `placeholder`, which reads as already answered, but the underlying value stayed empty until someone actually typed into it — `isStepComplete('site')` required that value directly, so Continue stayed disabled behind a field that looked complete. Now mirrors the same `displayName || entry.creator` fallback the real export already used, so the field's own "Defaults to..." hint and what actually lets the step advance agree.
- Two places used the wrong logo: the nav drawer's new header and the floating top-left brand pill both drew `Logo.svelte`, an abstract four-square chrome mark meant only for the favicon and small chrome spots, instead of the real logo image `AboutModal` and the field's own loading state already use. `Logo.svelte`, left with no remaining callers once both were corrected, was deleted rather than kept as unused code.
- The arrange-mode dot-grid ripple: the real static grid was visible underneath the animated overlay instead of only the overlay showing, entering arrange mode also grew the grid's own real, draggable container instantly (a `min-height` meant to make the canvas read as full-viewport had been applied directly to the functional grid rather than a decorative layer), and columns jittered noticeably near the top of a tall viewport. That last one was scaling, not translating, a repeating background pattern across a very tall element, forcing the browser to resample it every frame — worse the farther a dot sat from the transform's own anchor point. The decorative canvas is now a layer fully independent of the real grid's own box (so nothing about arrange mode can pop its container taller), and the ripple uses a plain `translateY` with no scale at all. It also eased out too abruptly into its resting state; now uses `ease-out` instead of `ease-in-out`.

## [0.8.0] - 2026-08-16

### Added

- The submission form itself, replacing the pull-request/issue path for joining the ring: an in-app multi-step flow at `/join` with a horizontal progress bar (click-to-jump, gated to steps already reachable), token-verified ownership against a submitter-controlled URL, a mock backend for local development, and a real n8n webhook contract for production.
- A client-side site generator for a creator with no site of their own: up to three uploaded works, an icon, social links, a choice of hand-designed templates per creator type with a live preview, and a downloadable zip ready to upload anywhere. Runs entirely in the browser — IndexedDB holds the draft's `Blob`s, `jszip` (dynamic-imported, so it never lands in any other route's bundle) packages the final archive. Templates are real, directly-openable `shell.html`/`styles.css`/`decorative.js` files per creator type, loaded via Vite's `?raw` suffix and filled with a small token engine, so the live preview and the real export share the exact same render path by construction.
- `scripts/preview-generator-template.js`, rendering every generator template against fixture data and serving it for direct viewing and editing, watching `templates/` via Vite's own file watcher.
- A Docker image (`Dockerfile`) serving the static build with Caddy, and a GitHub Actions workflow publishing it to GHCR on push to `main` and on version tags.

### Changed

- A `ring.json` entry now represents a creator, not a single work: the `title` field is removed entirely (it tried to serve both a creator-level introduction and a work-level name at once), `why` absorbs the introduction role and is capped at 160 characters as a form-only product rule, and a new backend-assigned `creator_id` links a creator's own nodes together. Every reader-side surface that showed `title` (FieldNode's card, the audio player, the comic reader, Members, Favorites) shows `creator` as the heading with `why` as the subline instead.
- Shared form-control styles (`.option`, `.chip`, `.control`, `.btn`) moved from Settings' own stylesheet into `app.css`, so `/join` and Settings draw from one definition instead of two that could drift.

## [0.7.0] - 2026-08-16

### Changed

- The icon set (favicons, the PWA icons, the maskable icon, the Apple touch icon, the social preview image, and the widget's inlined mark) is regenerated from the master logo, twice this round as the source artwork itself was revised in between.
- The project brief and the original build-instructions prompt are no longer part of this repository. Both were internal-only from the start; they're kept outside the working tree now instead of just being treated as such by convention. Every doc that linked directly to either points at a real, public alternative instead where one covers the same ground (`ring.json`'s field notes, previously only in the brief, are now also in `docs/submission-form-spec.md`), or drops the link in favor of a plain mention.
- Local test fixtures (`testing/fixtures/`, `testing/sites/`) are no longer committed. The tooling that builds and serves them (`testing/scripts/`, `testing/README.md`) still is, so the capability is documented and reproducible; the generated and hand-authored data itself is local-only, since the fixture embedded real, identifying third-party content (including the project owner's own site, used as one of its "real-source" stand-ins) that had no reason to sit in a public repo. `README.md`'s Test data section documents how to regenerate what's regeneratable.

## [0.6.0] - 2026-08-15

### Added

- `VITE_SITE_ORIGIN` sets the deployed origin at build time, with `.env.example` documenting the Docker consequence: the app is a static build with no server process, so this belongs to `docker build --build-arg` and setting it on `docker run` does nothing.
- Removing a like from Favorites now asks first, using the app's own dialog rather than the browser's. On that page the card is the only thing showing that entry, so it vanishes with no route back; everywhere else un-liking stays immediate, because the card is still in front of you.
- Export and import of all local data (`src/lib/localData.js`, Settings > Content). One versioned JSON file carrying likes, the discovery journal, the field arrangement, preferences, filters, and volume, so moving devices actually works. The panel lists exactly what is in the file before you download it, since the journal is a fuller record of browsing than a like list is. Import validates the envelope and skips keys it does not recognise rather than writing them.
- `npm run validate:publish`, a publish-readiness check that hard-rejects `_placeholder: true` entries. The default `npm run validate` still accepts them (seed data is what gives the field content today) and now reports how many there are.
- The widget builds to `/embed.v1.js` as well as `/embed.js`, and the versioned URL is what the join page and README hand out. Identical files today; the point is that a member who pastes the snippet is pinned to a contract, so a future breaking change can ship as v2 without editing anyone else's site.
- `/join`'s steps are a two-column layout: a numbered sidebar on the left, one panel of content on the right, rather than one long scrolling page. Collapses to a single column with the steps as a horizontal strip below 60rem.
- The Members list is paginated, 12 per page, with a "Showing X to Y of Z" readout and page numbers that collapse to an ellipsis past 7 pages. Turning the explicit-content filter off or on mid-browse clamps your current page instead of resetting it to page 1, so a change made elsewhere doesn't lose your place.

### Changed

- The production domain is `https://indienodes.us`, replacing the `indienode.example` placeholder in the widget's ring URL, the Open Graph and Twitter tags, the schema's `$id`, and the embed snippet in `README.md`.
- The About modal's principles are a list with icons rather than disc bullets, and the Ko-fi button is centered in its panel.
- Headings are set in Space Grotesk instead of Newsreader. The serif read editorial, closer to a magazine than to a webring; a geometric sans carries the register this is actually going for. Karla still sets body text, and the change is a dependency swap rather than an addition.
- The nav drawer is translucent glass with a blur instead of a solid panel, so an enabled ambient background stays visible behind the menu. Deliberately more opaque than the app's other glass surfaces: contrast has to hold against a drifting particle field at its worst moment, not its average one (measured at roughly 16:1 in both themes).
- Theme and Arrange moved off the mobile bottom bar into a floating cluster at the top right, mirroring where the hamburger sits on desktop. Neither is a destination, and having them in the bar made its item count depend on the route, so every navigation shifted the remaining icons sideways under the thumb that had just tapped one.
- The right-click field menu has icons on every row.
- `/join` leads with reference tables (every field, and where audio has to be hosted to be playable) instead of the same information as prose.
- The embeddable widget shows the real IndieNodes mark. It was drawing a different one: four type-colored nodes, three large and one small, which is not the brand logo. Inlined as a data URI so it still carries no image request onto a host page, and generated from the master by `scripts/generate-icons.js`.
- Settings > Content is two columns (filtering on the left, behavior and data on the right), not one long stack. It had grown to six panels as explicit content, rotation pace, and data export landed; the page also widened slightly to give both columns room. Collapses to one column below 56rem. Appearance is unaffected, since two panels never needed it.
- `/join` now opens with a notice that the submission form is not built yet and that the page will be rewritten around it once it exists, rather than presenting the pull-request and issue instructions as the settled design. The "Send it in" panel is worded the same way ("For now, everything above goes in one pull request...").

### Fixed

- `/members` showed the ring as of the last deploy rather than the ring the rest of the app had loaded. Its server load fetched `/ring.json` directly while every other surface reads the shared client-side store, so the two could disagree: against the 50-entry test fixture the field showed 50 and this page showed 5.
- `RING_JSON_URL` was left pointing at `http://localhost:4174/ring.test.json` from a local testing session. The widget bakes that in at build time, so an embed built from it would have asked every visitor's own machine for the ring.

## [0.5.0] - 2026-08-15

### Added

- A local discovery journal (`indienode:journal:v1`): a record of the entries you have opened, liked, and listened through, kept in this browser and nowhere else. It is capped at 500 events, clearable from Settings, and deliberately **write-only with respect to what you are shown**. Nothing in the selection path reads it, which is the line between keeping a record and inferring from behavior. There is no score, no total, and nothing surfaces unprompted.
- A full-screen comic reader, opened from a Read control on a comic card (Visit is unchanged and still goes to the creator's own site). Zoom by click, wheel, double-tap, or pinch; drag to pan with momentum; swipe or arrow keys to page; a grid of every page; full screen; and chrome that gets out of the way while reading on a phone. Adapted from KeyJayOnline_v2's own viewer, which resolves a question open since phase 0: the interaction model carried over, none of its five dependencies did.
- Comic cards cycle through the entry's pages on their own timer instead of showing page one forever, pausing while hovered or focused and stopping entirely under `prefers-reduced-motion`. A comic that submitted three pages previously had two of them invisible.
- An explicit-content filter, on by default. Creators self-declare with a new optional `explicit` field; entries marked so are hidden from the field, Members, and Favorites until a visitor turns the filter off in Settings.
- A "No AI artists" line in the About modal's principles.

### Fixed

- The comic reader entered a loading state that never finished when zooming back out. Resetting zoom cleared the "image loaded" flag, but resetting zoom does not change the image source, so no load event ever followed and the spinner sat over a perfectly good page. Reachable from the reset button, the `0` key, and Escape while zoomed.

## [0.4.0] - 2026-08-15

### Added

- Preview playback. With a queue already running, a node's play control auditions the entry instead of replacing what you are listening to: the music ducks out over a quarter second, the preview plays, and the queue is left exactly as it was. Reaching the end (or pressing Stop) fades the music back and resumes it from where it was. The duck is deliberately not reflected in the volume slider, which continues to show the level you chose. "+ Queue" is how a preview becomes a real queue member; until then it is not in the queue at all.
- "Fit to view", a right-click option on the field. Renders the whole arrangement scaled to the viewport with every node's size and position relative to the others held exactly, rather than letting the responsive column ladder repack it into new rows. Implemented by changing the grid's cell pitch, so nothing is written to the saved layout and returning the window to its original size reproduces the original field precisely. It works while arranging too, since there is no transform to throw off dragging.
- `src/lib/audioRamp.js`, a requestAnimationFrame volume ramp. It moves `HTMLMediaElement.volume` rather than a Web Audio gain node, because gain requires the audio's host to allow cross-origin reads and a fade must work for every source unconditionally.
- A like control in the player itself. Rotation keeps running while audio plays and navigating away drops the card entirely, so the node that started a track is often gone by the time you decide you like it.
- Per-type rotation pace, with a slider for each content type in Settings. Audio holds for 10s, game and mixed nodes 14s, text 16s, comic 22s, adjustable from 5s to 60s. One interval could never serve both a track you decide about in seconds and a comic page you have to read. This is pacing only: every entry still appears and you still never choose what comes next.

### Changed

- The Queue button on a node is a solid chip matching the play control beside it, instead of a transparent outline. As an outline it borrowed `--bg-elevated` for both its border and its icon, which is near-black in dark mode, so on a card with cover art it was a dark ring on a dark scrim and could not be seen. An outline is only ever as legible as whatever is behind it, and behind it here is an arbitrary photograph; a solid chip brings its own ground, which is what every other control on a node already did.
- Adding a previewed entry to the queue now queues all of its tracks, not just the one that happened to be sounding. Auditioning stays per-track; adding is per-entry everywhere else in the app, and a three-track EP added by way of a preview should not quietly give you a third of it.

### Fixed

- A volume ramp could overshoot for a single frame, ending up fractionally louder than the level the visitor had set (measured at 0.604 against a chosen 0.6). A requestAnimationFrame callback's timestamp can precede the moment the frame was requested, which made the easing run with a negative progress value.

## [0.3.0] - 2026-08-14

### Changed

- Audio nodes can now be played. A queue-based player mounts at the layout (so it keeps playing across Field, Favorites, and Members), with play/pause, previous/next, seek, a reorderable queue, and per-node controls: Play replaces the queue, "+ Queue" appends without interrupting what is already playing. Reaching the end of a queue stops and offers one tag-matched suggestion behind an explicit prompt rather than continuing on its own.
- The player gained a volume slider and mute (persisted per browser), a gradient ground behind the now-playing metadata, and a queue panel that slides open and closed rather than appearing instantly.
- The metadata gradient moved from the audio player, where it was added by mistake, onto the node cards it was meant for. It matters most on cards with no cover art, which previously had nothing behind their text at all.
- Audio is playable only from a direct file the artist hosts at a host allowing cross-origin requests; platform players were evaluated and dropped. YouTube's terms prohibit audio-only playback outright, and its permitted visible embed carries ads and trackers this project promises not to serve. Self-hosting was rejected on strict liability, the narrow scope of DMCA safe harbor, and composition/PRO/MLC licensing that an artist often cannot grant. See `docs/decisions.md`.
- `tracks` is now optional for audio entries. An audio entry with no playable file is a supported shape: a link-only member, listed with its cover art and a link out but with no play control. The XENO entry is now one, so nothing in the repo expires any more.
- The ambient background's drifting particles now react to what is playing, speeding up with sustained loudness and kicking on transients. Only active where the audio's host allows CORS: attaching an analyser to audio that has not opted in silences playback outright, so the player leaves the audio path untouched wherever that is the case (which includes Bandcamp).
- The reactive background now reacts to the beat rather than to overall loudness, which is why it previously looked inert. Measured on real music, full-spectrum energy sits near 0.47 and barely moves, so it drove particle speed at a flat 1.9x. Beats are now found in the bass relative to its own recent average, and the analyser's own smoothing was lowered from 0.7 to 0.2 because it was flattening the very transients being looked for. Particles now rest at 1x and surge past 5x on a hit.
- Entry selection is now random per visitor (a shuffled deck per type) instead of a cursor walking `ring.json` in order. Previously every visitor with the default layout opened on the same entries in the same slots, and members near the top of the file were shown far more than those near the bottom.
- The rotation hot path no longer re-filters the whole ring per node: pools are bucketed once per change and `canRotate` compares counts. Per-rotation cost is now independent of ring size.
- The ring is fetched once client-side and shared, instead of being serialized into eight places across the build. `index.html` dropped from 18,142 to 10,747 bytes with zero inlined ring data, and a new member now appears without a rebuild. `/members` keeps server rendering so it stays crawlable.
- `package.json` is no longer bundled whole into the client. It was imported as a default for one version string, which shipped every script name and dependency version to visitors; a named import tree-shakes it to the string.
- `CHANGELOG.md` is no longer bundled into the client. Parsing it for the About modal's release list moved to a server load, so the full 22 KB of changelog text (9.4 KB gzipped, growing every release) stopped shipping to visitors to render ~45 bytes of version numbers. The layout chunk dropped from 59 KB to 37 KB.
- `npm run dev:fixture` runs the app against the 50-entry test fixture (`VITE_RING_URL`), alongside `fixture:serve`, `fixture:generate`, and `fixture:audio`. Normal `npm run dev` and production builds are unaffected.
- `npm run dev:fixture -- --host` now works, and the fixture adapts to the network automatically: the ring URL is port-only and resolves against the page's own host, and the fixture server rewrites its 99 embedded asset URLs to match the `Host` each request arrives on. Testing from a phone needs no reconfiguration and no regenerating.
- The Queue control is an icon rather than the word, in the player (with its count) and on nodes, where it is now a circular button matching the play control beside it. Every icon-only control on a node and in the player also carries a hover tooltip, since an icon alone does not say what it does.
- The field's loading state is now the logo materialising from oversized and transparent into place, rather than a line of text, and a ring that fails to load says so instead of claiming to be empty.
- Cards with cover art no longer sit on a flat near-black plate; it is tinted to the node's own type color and the backdrop over it is more opaque.
- The rotation progress bar is a lit, drifting gradient in the node's type color instead of a flat block, and a rotation now crossfades the card's _contents_ with a slide-fade while the card itself stays put.
- `ring.json` now carries a fifth entry, AshZone's real _XENO_ EP (audio), alongside the four placeholders, so the audio node's pool has real content to rotate in rather than only a placeholder. Not marked `_placeholder`, since it is real, but not genuinely verified either (no ownership-verification flow exists yet to check it against), so its `verification_token` says `unverified-seed-entry` rather than either the placeholder token or a fabricated real one.

### Fixed

- The play button flapped between play and pause on local audio (measured at over 10,000 play/pause pairs in six seconds). Two causes: the playback effect issued a command on every run while its own media events wrote back to the state it read, and the analyser reloaded the element mid-playback to apply `crossOrigin`. The effect is now idempotent, and analysis never interrupts a track that is already playing.
- The reactive background never engaged. Setting `crossOrigin` after a resource had loaded could not enable analysis for the track already playing, and invalidated it besides. CORS mode is now chosen before `src` is assigned, learned per origin by trying: hosts that refuse are reloaded once without it and simply do not drive the background. This also removed the `HEAD` probe, which delayed the first track from every host and logged a console error for any host that had not opted in.
- Dragging the playhead restarted the track instead of seeking, and cover art was re-downloaded every time it reappeared. Both were the test fixture server: it answered Range requests with the whole file (so the browser could not seek) and sent no cache headers at all. It now supports Range/206, `ETag` with 304 revalidation, and streams rather than buffering whole files.
- Nav-drawer links caused full page reloads. The panel called `stopPropagation`, so clicks never reached the document where SvelteKit's router listens, and every drawer link fell back to a native navigation. That tore down the app on each one, restarting the ring fetch and, most visibly, stopping any audio that was playing. The backdrop now closes on self-clicks instead. `Modal` had the same pattern and got the same fix.

## [0.2.0] - 2026-08-14

### Changed

- The field view is now an arrangeable grid of persistent nodes rather than a fixed two-column layout of interchangeable positions. Nodes are placed, resized, and pinned to a content type, and the arrangement persists in local storage (`indienode:layout:v1`). Powered by gridstack (MIT, no runtime dependencies), lazy-loaded so only the field view pays for it.
- Edit mode ("Arrange"), off by default so the resting field stays an idle surface. It reveals drag handles, resize grips, a per-node type picker, add and remove controls, a reset, and a dot grid showing the snap targets. Rotation pauses while it is open.
- Per-type aspect ratios: audio and game lock to square, comic and text may also be wide. Resizing snaps to the nearest shape the type allows, and changing a node's type re-snaps it.
- Keyboard placement: arrow keys move a focused node, shift and arrow keys resize it, through the same snapping and persistence as dragging.
- Nodes with nothing to show render a placeholder instead of vanishing, so a node is always selectable and removable.
- The field is now full-bleed rather than capped to a centred column, since node size comes from cell spans.
- Node cards are layered: a blurred backdrop made from the card's own cover image, the type's own presentation over it, then a legibility scrim. Audio contains its album art over that blur, comics show their page uncropped and unedited, text fills with its header image, and games play a muted preview when one exists.
- All four entry type colors are now locked. Comic (`#a855f7`) and text (`#f59e0b`) carried PENDING placeholder values since phase 0 and are confirmed unchanged, having held up as full-card backgrounds in both themes. This closes one of the brief's own section 12 open questions.
- Cover art (`thumb_url`) is now an explicit submission expectation for every entry type, not just games, documented in `README.md`.
- The narrow-viewport "flow mode" (a plain CSS column below 640px, with gridstack torn down entirely) is gone. gridstack now runs continuously from the authored 24 columns down to 4, and dragging is offered at every width rather than only at the authored one.
- Add-node, reset, and exit controls moved out of a bar that sat permanently above the grid while arranging, into `ArrangeMenu`, a popup summoned on demand: right-click anywhere on the field on desktop, or a new `+` button in place of most of the mobile bottom bar while arranging. The resting field now carries no arrange-mode chrome of its own at all, matching the header's own toggle.
- Right-clicking the field opens the arrange menu in either mode: the full add/reset/done set while arranging, and a single "Arrange field" entry outside it, so the mode is one click away in both directions. Right-clicking a link still gets the browser's own menu.
- "Move up" / "Move down" node-menu buttons are gone, replaced by dragging, which now works at every column count including on a phone.
- The main nav collapsed into a right-side slide-out drawer on desktop (a floating logo mark and hamburger trigger replace the old full-width header bar), so the field view's node canvas now gets the full viewport height instead of "viewport minus the nav." Mobile keeps its bottom tab bar as the only nav there, now also carrying Arrange and the theme control.
- The nav drawer now slides back out on close instead of disappearing instantly, and the header's hamburger trigger morphs into an X (and back) instead of swapping between two unrelated icons; it also gives a brief press response on tap.
- The top-left brand mark now glows on hover and keyboard focus, a soft pulsing halo rather than a static hover state.
- The field's first-visit arrangement (before anything is saved locally) is now a centered column with deliberately varied node sizes, replacing an arrangement that spread edge to edge across the full 24-column canvas. A returning visitor's own saved arrangement is unaffected either way.
- The field's default arrangement is smaller and genuinely masonry now: every node starts at the smallest width its shape rules allow, comic and text default to a portrait shape instead of a wide one, and two nodes stack in each of two columns, landing at different heights the way a Pinterest-style layout does.
- A PWA icon set (192, 512, a separate maskable 512, an Apple touch icon, and small PNG favicons), a social preview image, and `static/manifest.webmanifest` are now generated from the real logo (`static/images/IndieNodes_Logo.png`) via a new `scripts/generate-icons.js` (uses `sharp`, a new devDependency). `app.html` gained a description, Open Graph, and Twitter Card meta tags, plus per-theme `theme-color` and the manifest/icon links; the existing hand-built `favicon.svg` stays the primary favicon.
- Renamed from IndieNode to IndieNodes everywhere a visitor reads it: page titles, the header brand mark, the About modal, `README.md`, the manifest, and the Open Graph/Twitter tags. Technical identifiers (the `<indienode-widget>` custom element, `indienode:*` localStorage keys) are unchanged.
- The About modal now opens with the real logo and current version above its tabs, lists release history (parsed from `CHANGELOG.md`, each entry linking to its GitHub anchor) under Source & License, and uses Ko-fi's actual logo on the Support tab's donate button instead of a generic cup icon. Modeled on GG Requestz's own About modal.
- The About modal's header is now centered (logo, "IndieNodes," and the version number stacked, the logo doubled in size) with no separate repeated title text, and the dialog is a fixed size instead of resizing itself on every tab switch. `Modal.svelte` gained a `showTitle` prop for this (default on, so every other modal is unaffected).
- `/members` lists every entry in the ring, and `/join` documents how to get into it (the `ring.json` entry shape, the `<meta name="indienode-verification">` ownership check, and the widget snippet). Both are in the desktop drawer; the mobile bar gains Members, with Join reachable from that page.
- The embeddable widget is now a two-line badge (the mark and wordmark above Previous / Random / Next) instead of a card previewing the current entry, and its buttons travel to a member's site rather than cycling a preview in place. A new optional `site-id` attribute makes Previous and Next resolve to that member's real neighbours. The mark is inline SVG with a slow idle animation.

### Fixed

- Nodes could not be dragged at all after toggling arrange mode, on any device: an effect gating drag/resize only read its own `editMode` prop on runs that got past its `grid`/`ready` guard, and the run that first cleared that guard happened to run before `editMode` was ever read, so it never became a tracked dependency and later toggles of arrange mode were silently ignored. Fixed by reading `editMode` unconditionally instead of after the guard. This is the fix for the reported "can't tap and drag nodes on mobile" bug; it affected mouse dragging identically, not only touch.
- Nodes leaned toward one side of the viewport between roughly 640px and 1400px wide, with no consistent direction: gridstack's own response to a column-count change produced inconsistent gaps row to row. That reflow is now replaced with a deterministic packer that centers each row, corrected to the pixel rather than the nearest grid cell.
- Nodes were too small between roughly 640px and 1200px wide, sitting at a fixed 32% of the viewport at every size. The grid's column count now steps down on smaller screens so nodes keep a usable size across the range.
- Node positions were scrambled by a responsive resize and never restored on the way back to a desktop width. Both position and size are now re-applied from the saved layout in a single batch when the grid returns to its authored column count.
- Resizing a window down past a breakpoint and back up permanently shrank wide nodes, because a clamped width was being saved. Geometry is now only persisted at the column count the layout was authored against.
- Every node became enormously tall below 640px wide. gridstack's one-column mode rescales width but never height, and its square-cell sizing made each cell the full container width, so a 9-cell-tall node rendered over 5000px high on a phone.
- The header nav was squeezed between roughly 640px and 1024px, where it carried a brand, four links, and two toggles. The mobile tab bar now takes over at 1024px rather than 640px.
- Comic and text nodes could not be made tall. The shape ladder ran from square to wide with nothing above 1:1, so dragging one taller snapped it back to a square. Portrait ratios (9:16, 2:3, 3:4) are now available to the two types most often portrait.
- Resizing comic and text nodes snapped back instead of committing. Shapes were a menu of six fixed sizes whose gaps were larger than a normal drag, so most resize gestures landed back where they started. Shapes are now ratio families with continuous width, and every drag produces a change.
- The like toggle sat on top of a node's Remove control while arranging and took its clicks. A node's badge and like toggle are now hidden during arrange, and its configuration moved behind a three-dot menu so the mode stops covering cards in form controls.

## [0.1.0] - 2026-08-13

### Added

- Embeddable webring widget (Previous / Next / Random), built as a standalone `<indienode-widget>` custom element with its own shadow root, so it carries no chrome, theme, or tracking onto a host page. Built separately from the main app via `vite.widget.config.js` into `static/embed.js`. `/widget` is a demo page and embed-snippet reference, not the widget itself.
- Field view (home page): a grid of up to 6 ring entries loaded from `ring.json`, with per-type touches (a pulsing bar visualization for audio, a slow image zoom for comic), a heart toggle per node, and a "Visit" link out (the reader doesn't exist yet, so this stands in for the brief's tap-to-open-reader behavior). A first pass, not the full ambient field: see `docs/open-questions.md`.
- Favorites: a `/favorites` page listing liked nodes, backed by a new `favoritesStore` (local storage only, mirrors how theme/background preferences already work).
- A fixed bottom tab bar (Field / Favorites / About / Settings) below a 40rem viewport width, replacing the top nav there; the top nav's text links remain above that width.
- Content cycling, with a sequential stagger-in for incoming nodes. Pauses, without losing progress, while the pointer is over a node, while keyboard focus is inside the field, or while the tab is hidden, so it never carries a node away from someone actually looking at it.
- Filters: a new `filtersStore` (local storage) narrows the field view's pool by entry type and by tag, controlled from a new "Content" tab in Settings, not from the field view itself (kept out of that view on purpose, per the brief's "no filter control in the ambient field" rule).
- Per-type stage components (`src/components/stages/`), splitting `FieldNode` into a shell plus a per-type ornament, so future node treatments are one new file each rather than a rewrite.
- `src/lib/imagePreloader.js`: warms a slot's next cover image (fetch plus decode) while the current one is still on screen, deduped by URL and capped at three concurrent loads.
- `docs/roadmap.md`: intended-but-unbuilt work, kept separate from `docs/open-questions.md` (which stays for genuinely undecided things).

### Changed

- Rotation is per-node on independent, jittered timers instead of one global timer swapping every visible node at once. This is what the brief described (section 7c), it reads as calmer, and it removes a network burst where every card requested its cover image in the same instant. Pausing is per-node too: hovering or focusing one card holds only that card while the rest keep going. The shared bottom progress bar was replaced by a thin per-card fill, since one bar cannot represent several independent countdowns.
- The field view is two columns of up to 6 nodes (was four columns of up to 16). Card size is set by the grid's container width, which dropped from 120rem to 52rem so cards stay near 400px rather than inflating to fill the wider container.
- FieldNode cards are square (was a wider rectangle), colored by the entry's own type across the whole card (not just the badge), with a cover image (comic page, game thumbnail) in place of the color wash when the entry has one, and a real Visit button instead of a bare link.
- About is now a modal (`AboutModal`, opened from the nav or the home page), not its own route. `/about` no longer exists. It has four tabs (Overview, Principles, Source & License, Support) with icons.
- Support is no longer a standalone route; its content is the About modal's fourth tab. `/support` no longer exists.
- Settings is now a tabbed page (Appearance, Content), reusing the same tab-pop fix as the About modal.

### Fixed

- Cover art supplied by ring entries was being discarded for every type except games. `thumb_url` is declared at the schema's top level and its rules only make it _required_ for games, never forbidden elsewhere, but the field view read it only for game entries, so an audio entry's album art or a text entry's header image rendered as a flat color wash instead. Cover images now come from `coverImageUrl()` in `src/lib/ring.js` for all types, falling back to a comic's first page. The schema's `thumb_url` description, which had said "Game only." and was what the original code was written against, was corrected to match what the schema actually enforces.
- FieldNode content (title, creator, why text, Visit button) could overflow the card's square boundary and get clipped whenever a title wrapped to its full 2 lines. Fixed with tighter, fixed-size (not page-scale) text sizing tuned to the smallest card width the grid actually produces.
- Switching tabs in the About modal popped the old panel's content before the new one appeared, the same layout-jump bug class as an earlier page-transition fix; fixed the same way (the outgoing panel goes `position: absolute` during its own exit).

## [0.0.1] - 2026-08-13

### Added

- Project scaffold: SvelteKit with Svelte 5 runes, Tailwind CSS, `@sveltejs/adapter-static`, Vitest, Playwright, ESLint, and Prettier.
- Design tokens and a Light / Dark / System theme system, stored in versioned local storage, with a no-flash inline script in `app.html`.
- Ambient background (`Drifty Stars`), ported from GG Requestz's `AmbientBackground.svelte`, repaletted for both themes and off by default.
- Settings, About, and Support pages.
- `ring.json` data model: `schema/ring.schema.json` (JSON Schema), `scripts/validate-ring.js`, and four fictional placeholder entries covering all four entry types.
- `LICENSE` (GPL-3.0-or-later) and this changelog.
- Route transitions: a short fade-and-slide between pages, off under `prefers-reduced-motion`.
- A generic `Modal` component (backdrop, Escape to close, click-outside to close, scroll lock).
- `testing/`: a separate `ring.test.json` fixture with one extra entry per type over the production seed data, three pulled from real live sources (a real Bandcamp release, the project owner's real site, a real demo game-directory listing) and four served from locally-hosted fictional creator pages with working ownership-verification tokens. Not read by the app; see `testing/README.md`.
- A type scale (`--text-xs` through `--text-2xl`) and consistent spacing values across every page, replacing ad-hoc font sizes.
- A small logo (`Logo.svelte`), four rounded nodes in the four entry-type colors, used in the header and as the favicon.

### Changed

- Dark mode palette reworked from a warm brown/amber base to a cooler blue-slate one: background, borders, muted text, the accent color, and the ambient background's gradient, blobs, and particles all shifted. Light mode is unchanged.
- Ambient background (`Drifty Stars`) sped up: faster particle drift and shorter blob rotation periods, so the effect reads as clearly moving rather than needing several seconds of staring to notice.
- Scrollbars (the document, any modal's scrollable body) are themed instead of left at the browser default.

### Fixed

- The `--type-games` CSS token (plural, matching the brief's "Games" label) didn't match the schema's singular `"game"` type value, so any `--type-${entry.type}` lookup for a game entry silently resolved to nothing. Renamed to `--type-game`.
- A narrow-viewport layout bug: the header's nav didn't fit below about 560px wide and forced the whole page to overflow horizontally.
