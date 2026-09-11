# Roadmap

Intended but unbuilt. Separate from `open-questions.md` on purpose: the things here have a direction agreed on, they just have not been built yet. Open questions are the ones where the direction itself is undecided.

Nothing here is a commitment to a date, and anything here can still be cut. What it does mean is that a design decision made today should try not to foreclose these.

## Public-release path

**The complete member lifecycle has been verified against production:** a new entrant
was created, updated, and voluntarily removed through the live browser and review flow.
That closes the operational lifecycle gate; automatic rot and malicious-member removal
remain separately deferred below.

The creator-first media pass is also built: Art is a first-class type with a contained
gallery and five generator templates, Text has local-device Read aloud in ordinary and
Ambient views, and Games have separate direct-preview and click-to-load trailer paths.

Visitor content customization and generated-site customization are both **built**.
Per-node tag channels narrow each node inside the visitor's global tag preference,
both layers local-only, with an empty node naming whichever layer emptied it. Every
generated template now declares its own customization surface, so a creator can set a
page background, a card surface, and a text color on all twenty-one rather than on one.

The remaining public-release work has a narrower order than the full roadmap:

1. ~~**Validate the public widget contract** on real host pages, including the versioned
   embed, navigation, participation detection, and generated-site embed.~~ **Done** —
   traversal between two real member sites was verified live, on a production install
   running the current preview image with the CORS fix. See "Widget validation" below for
   what's left as follow-up rather than a blocker.
2. ~~**Run an explicit responsive pass** across ordinary view and Ambient view on mobile,
   tablet, and desktop dimensions.~~ **Largely done.** A handful of elements still need
   tuning; not release-blocking, addressed through normal updates.
3. ~~**Publish visitor Terms of Use and a Privacy Notice** and expose both from the app.~~
   **Built** — see the visitor-facing terms section below.

The existing manifest and install icons are sufficient for this release. Offline caching,
a service worker, kiosk behavior, native distribution polish, Retro Love, the discovery
trail, automatic rot/malicious-member removal, Ambient pairing, and the global audio-focus
arbiter are post-release work unless explicitly brought back into scope.

## Per-node content channels and global preferences

The spatial half of the arrangeable field is **built**: nodes are persistent, placeable, resizable, type-pinned, and arranged with gridstack behind an explicit edit mode. See `decisions.md` for how it works.

The semantic half is **built** too, so a node is now a channel rather than a typed slot:

- **Per-node tag filters.** `layoutStore`'s node shape carries `tags`, and
  `nodeChannel.js` owns what a type-plus-tags channel means against a ring. "A hip-hop
  audio node beside a VGM audio node" is expressible.
- **The global tag filter stayed.** It remains the visitor's broad content preference;
  per-node tags narrow an individual channel inside that pool, and an empty selection at
  either layer adds no restriction. This reversed a LOCKED decision that had the global
  filter being removed at this point — see `decisions.md` for the reversal and for how
  the empty-node case that argued against two layers is answered.
- **A per-node tag picker** sits in `NodeConfig.svelte` beside the type select, offering
  only tags entries of that node's type actually carry.
- **Local-only persistence.** Global preferences remain in `filtersStore`; per-node tags
  live with the persisted layout. Neither becomes ring data or changes another visitor's
  view.

Still open, and separate from the tag work: **visible-node count at production scale**
(see `open-questions.md`) is a question about the shipped default layout, not about
channels.

## Field presets (saved workspaces)

Currently there is exactly one Field: `layoutStore` and `filtersStore` each hold a single, unnamed, local-only state. The idea is named presets — e.g. one workspace of only Audio nodes arranged one way, another of Comics with a single text node — switchable without rebuilding the arrangement by hand each time.

**Direction agreed: a fixed set of five slots, not an unlimited named list**, kept local-only like everything else in `STORAGE_KEYS` — there is no account/cloud layer in this app to justify more. Each slot snapshots both halves of a Field together, `layoutStore`'s node configs and `filtersStore`'s global tag toggles, since a workspace described only by node layout, without which global tags were active, would not reproduce what the person actually saw.

Not yet decided, and worth settling before building:
- Whether loading a preset pushes onto `layoutStore`'s in-memory undo stack (making "load preset" itself undoable) or simply resets history.
- Validating a stored preset against the live `nodeShape.js` type list on load, reusing the defensive pattern already in `nodeChannel.js` (`matchesType`, `pruneTagsForType`), rather than trusting an old snapshot outright.

Fits the existing patterns cleanly when built: one new catalogued, exportable `STORAGE_KEYS` entry (e.g. `indienode:field-presets:v1`), and a Save/Load/Rename/Clear UI extending `ArrangeMenu.svelte`.

## Skins (the ornamental direction, packaged)

**Decided:** two independent axes, not one. A **UI Skin** is the app's own chrome — panels, buttons, backgrounds. A **Node Skin** is how a ring-entry card looks, animates, and sounds. They are chosen separately, so "a Retro theme with the Drifty Stars background" is a real, expressible combination rather than a single bundled toggle.

The extension seam is now built, with exactly one registered skin in each category:

- **UI Skin: Glassmorphic.** Registered under `src/skins/ui/glassmorphic/` and selected independently through Settings. The shared host still owns structural component CSS; the skin owns the panel tokens applied through `data-ui-skin`.
- **Node Skin: Basic Nodes.** Registered under `src/skins/node/basic/`, with a stage for every entry type. The app-owned `FieldNode.svelte` shell retains controls, accessibility, playback, and navigation while the selected skin supplies the visual stage.

**Retro Love** is the first skin that is both a UI skin and a Node skin, offered as a bundle: per-type ornamentation, animation, and sound-of-its-own-machinery for the node half, and its own chrome treatment for the UI half.

| Type  | Retro Love's node direction                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------ |
| Audio | A cassette animating into a player, spindles turning while it plays, a clicking sound before playback starts |
| Comic | A comic book that opens into the viewer (no page-flip; pages come up in the KeyJayOnline_v2-style viewer)    |
| Game  | A console, with a cartridge or disc loading in                                                               |
| Text  | A book                                                                                                       |
| Art   | An easel, or a drawing tablet                                                                                |

Choosing "Retro Love" as a bundle sets both axes at once, but they stay independently selectable afterward — Retro Love's UI with Basic Nodes, or Glassmorphic with Retro Love's nodes, are both legitimate combinations, not just the bundle's own two halves glued together.

### Structure, so a third party can add one

Skins live in their own folders so someone else can write one. The implemented shape is:

- `src/skins/<category>/<skin-id>/` per skin, where `category` is `ui` or `node`.
- One manifest per folder. `import.meta.glob` discovers manifests and generates Settings options without editing the Settings route.
- A versioned `skinStore` with independent `uiSkin` and `nodeSkin` values, defensive loading, and fallback when a stored skin is removed.
- Per-type fallback to Basic Nodes, so partial node skins are legitimate.
- A controlled services object for preloading, user-triggered sound, and host actions. Skins do not import application stores.
- `/dev/skins`, which exercises real cards across types, aspect ratios, missing artwork, paused content, and reduced motion.

See `skin-authoring.md` for the complete contract and workflow.

### Constraints carried forward from the brief

- **Game must stay static by default** (section 7b). Whatever a node skin's console treatment becomes, the cartridge or disc loading is an explicit, user-initiated flourish, never idle motion, and `preview_url` stays untouched until there is a real tap-to-play interaction.
- **Nothing autoplays with sound** (section 11). A spinning cassette is motion, not audio; the spindles may turn before playback is requested, the tape may not make noise on its own.
- Ornamental motion has to answer `prefers-reduced-motion` the same way everything else here does, which for looping mechanical animation probably means "stopped," not "shortened."

### Prior scaffolding

`src/components/FieldNode.svelte` remains the host shell. The original per-type stages now form the Basic Nodes package under `src/skins/node/basic/`. This keeps behavioral policy in one app-owned place while letting future skins replace the ornamental layer and request approved actions through the host contract.

The "art" type this table assumes now exists. It was added to `schema/ring.schema.json` in 1.2.0 as a first-class type with its own `artworks` array, its own field stage, and five generator templates, so Retro Love's easel is a skin's own work rather than a schema change waiting on one.

## Kiosk mode

The installable baseline is built: `static/manifest.webmanifest` and the install icons
ship today. What does not exist is a service worker, offline cache, or field-locked kiosk
launch behavior.

**Public-release status: deferred.** Offline support is what turns this into a real
service-worker project. Caching `ring.json` and cover images is plausible; caching
creators' actual media is a much larger promise.

## Nodes as Android home screen widgets

The node concept maps neatly onto an Android home screen widget: a small, self-contained surface that rotates through ring content on its own timer. Appealing precisely because a node is already designed to be independent of its surroundings.

**This needs native code; a PWA cannot do it.** Android home screen widgets are built with `AppWidgetProvider` and `RemoteViews` (or Glance for Compose), and no web API exposes them. A plain PWA install or a Trusted Web Activity wrapper still cannot provide a widget from web code. The `widgets` manifest member that turns up in searches targets the **Windows 11** Widgets Board, not Android, which is an easy thing to be misled by.

So the shape would be a native wrapper (TWA or otherwise) for the app itself, plus a widget written natively that reads `ring.json` directly. The widget would not share rendering code with this project; it would share the data contract, which is the part that was always meant to be the product.

Two consequences worth weighing before starting:

- **The ornamental theme would need a second implementation** in native UI, or widgets accept Basic Nodes' plainer look.
- **It puts a native app in a project that is currently a static site with no build target beyond `build/`**, including store distribution and its review process. That is a materially different maintenance commitment, not just another client.

Re-verify the platform constraints when this is actually picked up; the above reflects the state of things as of this writing and Android's widget story has changed before.

## The discovery trail (the journal's mirror)

`journalStore` is **built** and recording (see `decisions.md`). What is missing is the only thing it exists for: showing a visitor their own history back to them.

**Decided:** a generative visualization, not a badge shelf. The framing that makes this compatible with the project rather than a smuggled-in achievement system is that it is **descriptive, not persuasive**. A badge shelf says "you have 7 of 12, go get the rest." A constellation of where you have been says nothing at all; there is no target state, so there is nothing to optimize toward, which is what sidesteps the engagement-optimization problem entirely.

- **Where:** a second tab on `/favorites`, not a new nav destination. That page is already the "your stuff" surface, and the mobile tab bar is at six items with seven measured as the point labels start truncating at 390px. Settings' own tabbed pattern is there to copy.
- **How:** 2D canvas or SVG, seeded deterministically from the journal's entry ids so the same history always draws the same picture, in the four locked type colors. Not Three.js; see `decisions.md` for why that is settled rather than open.
- **Type coverage as a quiet line, not a nudge.** "You have explored audio, comics, and text, but not games yet" belongs on this view as a passive sentence, visible only to someone who came looking. It never surfaces unprompted, never notifies, and never expires. Trivial to derive once the journal and the view both exist.
- **Nothing here reads back into selection.** That constraint belongs to the store, not to this view, but it is worth repeating at the surface that would be most tempted to violate it.

## Leaving the ring: removal, the missing third verb

**Voluntary removal is built and production-verified.** The live end-to-end pass used a
new entrant, started from `/update`, proved ownership, and completed the real review and
publishing flow. Create and Update were verified against production in the same test.

**Automatic rot and malicious-member removal are deferred.** `scripts/member-health.js`
(in `indienodes-ring` since the ring split; see `decisions.md`'s ring-split entry —
`docs/member-link-health.md` there is its write-up, and `scripts/check-member-links.js`
the runner that drives it)
already detects rot — it raises an `alert` once a URL fails
`DEFAULT_FAILURE_THRESHOLD` consecutive runs — but nothing consumes that flag: it
prints `BROKEN` and stops there. A member whose site has been gone for months therefore
stays in `ring.json` until a maintainer acts.

Three distinct triggers, which want three different behaviours rather than one:

1. **Rot.** Critical components stop resolving — `source_url` 404s, every `media_url`
   dies. Slow, reversible, and usually nobody's fault.
2. **Reported and verified malicious.** Fast, non-negotiable, no grace period. `/contact`
   already carries `?report=<id>` and prefills a report, so the intake half exists.
3. **Voluntary.** A member wants out. Should be self-service and should not require
   asking a maintainer.

### The constraint: no stored email, so no way to warn anyone

This is the real problem and it is a _consequence of a decision worth keeping_. Email is
collected at submission for the private review queue and deliberately never persisted
(`submissionStore` keeps it in memory only, and `storageKeys.js` catalogs both drafts as
non-exportable for the same reason). So when a link breaks there is no address to write
to.

Partial answers that already exist and cost nothing:

- **Voluntary removal is built**, and the notification problem never arose for it. The
  `indienode-verification` meta tag that proves ownership for `/update` proves it just as
  well for removal, so leaving needs no mechanism of its own and no stored address: it is
  a step inside `/update` (`intent === 'remove'`), offered only once control has actually
  been proven, and gated behind an explicit confirmation that disarms itself if the
  visitor changes their mind and comes back. The client half ships here; the
  `request_removal` action is stood up in n8n like every other action in this contract.
- **Neither the token nor the node id is something a member must have kept.** `/update`
  issues a fresh token on demand rather than expecting one to be retained, and since the
  node id is displayed nowhere in this app, the identify step matches on a site address
  or a creator name as well (`nodeLookup.js`), with a "This is mine" link on `/members`
  for anyone who recalls neither. A removal flow should reuse that same entry point
  rather than reintroducing an id to type.
- **For rot, the member's own site is the channel, and its absence is the message.** If
  `source_url` is 404ing, an email would not have helped — the site needs fixing either
  way. The genuinely hard case is narrower than it first looks: a member who _moved_
  their site and whose old URL now fails.

For that narrow case, three options, none obviously right:

- **(a) Publish the policy and accept it.** State the grace period in the EULA and on
  `/join` — "if your link stays broken for N weeks your node is removed; resubmit any
  time." No new data, no new surface, and resubmission is cheap because `/join` is short.
- **(b) An optional contact address, stored, for maintenance only.** Solves it properly
  and changes the privacy story materially: the ring would then hold personal data at
  rest for the first time, which the privacy notice would have to describe and which
  becomes a thing to protect, export and delete.
- **(c) A public "at risk" list.** A page naming entries pending removal and why. Zero
  personal data, and it uses the ring's own audience as the notification channel — a
  reader who notices a favourite creator listed can tell them. Fits the project's
  transparency posture, though it works only if anyone is looking.

**(a) plus (c) is the combination that keeps the no-stored-data promise intact**, and (b)
is ruled out: storing an address at rest is the one thing this project has consistently
declined to do, and the only place it exists today is transiently, during review, cleared
within about 24 hours.

### Decided: no registry of removed members

Considered and rejected — keeping a record of who was removed and why, so a returning
submitter could be told.

The value concentrates almost entirely in one rare case while the cost lands on every
case. It would be a list of people and reasons, which is personal data at rest; and since
`indienodes-ring`'s `members/` and `ring.json` are public, it would _publish_ that list — a permanent public
record of somebody's worst moment with this project. For rot, the common case, there is
nothing to tell them: their site was down, they know, and rejoining is the fix, so being
met with an explanation only adds friction to someone doing the right thing. For
voluntary removal, recording why someone left is hostile. Only verified-malicious has
real value, and every submission already passes a human review queue, which is exactly
where a repeat bad actor is most likely to be recognised. If that stops being true, it
belongs in the private review side, never in the public repo. Removal is already stated
to be at the maintainer's discretion, so there is no obligation to explain twice either.

**A tombstone is not a blocklist, and the two must not be conflated.** The tombstone
below records only that an id was used and retired, so that a later submission cannot
silently inherit a removed node's identity. No person, no reason, no history — it is a
uniqueness guard about strings, not a record about people.

### What it needs before building

- A grace period and what counts as fatal (is a dead `media_url` fatal, or only a dead
  `source_url`? An audio entry with no playable track is already a supported shape).
- Whether removal is deletion or a tombstone. Deletion frees the `id` for reuse; a
  tombstone prevents a future submission silently inheriting a removed node's identity
  and is the safer default.
- Who executes it: the same n8n review queue that approves submissions is the obvious
  home, so a removal is a PR against `indienodes-ring`'s `members/` exactly like an approval is.
- **The full journey has to settle before the privacy notice can be written**, since
  which of (a)/(b)/(c) is chosen is precisely what determines whether the notice has to
  describe stored personal data at all.

## Node maintenance and change requests

**Built.** The `/update` flow gives an existing member a creator-verified path to swap featured work, correct copy, or replace a dead link. Creator-hosted media means link rot is expected over time, so this is the repair path used after either a creator or the health checker finds a problem.

**LOCKED, from the addendum:**

- Update requests are creator-initiated, through a form keyed to the creator's existing node id, not a new submission. Covers: swapping which works are featured (within the existing 3-work cap), correcting tags/`why`/`source_url`, replacing a dead `media_url`/`image_url`/`preview_url`.
- An update request must pass the same ownership verification used at initial submission, re-checked against the current `source_url` or profile page. No new secret or credential.
- Review is narrower than a first submission: confirm the schema still validates, not a fresh quality or fit judgment, since ownership is already proven by the re-verification above.

**Resolved:** link-rot detection lives in `scripts/check-member-links.js` in `indienodes-ring` (moved there in the ring split; see `decisions.md`), with pull-request checks in GitHub Actions and recurring execution to be scheduled by Semaphore. It alerts maintainers only; the project does not retain a member email after approval, and the existing creator-initiated `/update` flow handles corrections.

**Implemented surface:** `/join` and the desktop navigation link to `/update`; both the form and its n8n actions are built.

**Visitor reports are built as a maintenance signal.** Every node carries a quiet Report action that opens the private `/contact` workflow with the node id, creator, and approved destination prefilled. It is aimed at post-approval drift — a creator-hosted page or media URL changing into something unsafe or materially different — and deliberately does not remove content automatically. A maintainer still compares the report with the versioned member record and decides what to do.

## Game entries: trailers and the viewer

**Built, with backward-compatible fields for two different jobs.** `preview_url` remains
a creator-hosted direct clip: muted, motion-aware, and used as the lightweight node
teaser. `trailer_url` is an optional YouTube URL. A game carrying one gets an explicit
Trailer control in the ordinary Field and Ambient view; the iframe is not created until
that control is pressed.

**What "the game itself" links out to needed no special answer: it is `source_url`, same as every other type.** A game entry does not get a distinct destination field; wherever the developer says their game lives (Steam page, itch.io, their own site) is what Visit already points at. This was raised as an open question and closed by noticing nothing game-specific was actually being asked for.

**The YouTube question is settled and its disclosure is shipped.** IndieNodes runs no
ad or tracking code of its own, but the About panel and both creator forms now state the
exception plainly: choosing to play a trailer loads YouTube, which may collect data or
show ads under its own policies. The implementation follows these terms:

- **Click to load.** Nothing from Google is requested until the visitor presses play. A poster frame stands in until then, so a game node costs no third-party request unless someone asks for one.
- **`youtube-nocookie.com`**, and a visible player with its own controls. This is the permitted embed, unlike the audio-only extraction III.I.7 prohibits.
- **One schema and workflow rule.** The browser, JSON Schema, n8n validation, PR
  allowlist, and member-health collector all recognize the same additive field.

**A trailer can never be the silent node background.** III.I.9 forbids a player not displayed in the page the user is viewing and III.I.6 forbids modifying player functionality; a chromeless muted background player is squarely both. The opt-in background video is therefore built against `preview_url`, a direct file the developer hosts, which is what `GameStage` already plays today.

**Still open:** making direct-preview autoplay an opt-in preference, off by default.
Today `preview_url` still autoplays muted for everyone (the recorded departure from brief
section 7b), while remaining disabled under reduced motion and outside the viewport.

## Ambient view

A way to actually enter the brief's surface (c) as a mode rather than as the home page, closest in spirit to its "idle, screensaver-like" framing. Overlaps heavily with **Screen saver mode** below; these two should probably merge when either is picked up.

**First usable pass built and mobile treatment revised.** The field route exposes the documented desktop pill and mobile bottom-bar action, the one-time audio-capability confirmation, and an element-fullscreen attempt with a fixed-overlay fallback. Ambient view gives the visual entry the full canvas and keeps the selected audio in a compact bottom dock with real play/pause and playlist controls. Entry selects audio but leaves it paused. A separate square discovery card rotates audio candidates or alternate tracks on the right, keeps the cover visually dominant, shows its time until rotation, slides between choices, and can be hidden. Preview plays its choice once while preserving the selected track's position; Play this explicitly replaces the selected ambient audio. A single visual tap flashes and dims the canvas, pauses visual rotation, and slides two larger full-width creator rows into the center: audio has Like, Not for Me, and Visit; visual adds Next and Report. Tapping the dimmed area dismisses them. Double-tapping the visual or the non-button area of the player remains a shortcut for the corresponding like. Audio advances only from the selected media element's real `ended` event, so every track receives its full runtime rather than sharing the visual rotation timer. Entering ambient mode preserves the visitor's ordinary queue and exiting restores that prior context; if a queue is already playing, the dock speaks for that queue directly rather than dealing over it. An unobstructed toggle hides every ambient control so only the rotating visual remains, with a single tap to bring them back, and a brief "Now playing" announcement covers the track changes that mode would otherwise hide. The tap menu can hand a paged visual to the full-screen reader, releasing element fullscreen so the shared reader mount is reachable. Output volume moved to `audioSettingsStore` so the discovery card's one-off preview honours the same level as the player. The general audio-focus arbiter and `pairs_with` data remain outstanding.

**Entry point:** a floating pill beside the hamburger trigger, which is already `position: fixed` in `+layout.svelte` alongside the brand mark, so this adds a third floating control rather than reintroducing a header bar. On mobile it gates to the field route the way Arrange already does and swaps into the bottom bar rather than becoming a seventh item.

**Full screen** via `requestFullscreen()` on the mode's container, with a `fullscreenchange` listener to keep state honest and a fixed full-viewport overlay as the fallback, since iOS Safari will not fullscreen a non-video element. Nothing in the app uses the Fullscreen API today, so this is greenfield.

**The guardrail argument, which has to be made explicitly rather than assumed:**

- Brief section 11 says nothing autoplays with sound. Ambient entry now obeys that literally: it selects a preview but playback begins only from the visible Play button.
- The launch confirmation remains useful expectation-setting because the mode can play audio, but it is no longer what authorizes immediate playback.
- Running an audio entry and a visual entry at once is the same exception, not a second one: the visitor asked for a mode whose whole premise is that music plays while you look at something else.

**Decided: a one-time confirmation on first use, not a permanent label change.** The first press explains that ambient view can play audio and that playback starts only from Play; accepting opens the silent mode and is remembered locally (`indienode:ambient-consent:v1`) so every later launch is immediate.

It is a deliberate, narrow exception to "no confirmation dialogs for first-party actions" elsewhere in this app (Favorites' un-like prompt is not a precedent for this; that one guards against losing data, not against a guardrail promise). Worth remembering if this is revisited: it is the second dialog in the whole app, and the bar for a third should stay high.

**Persistent reactions**, one rounded pod per medium, expose both Like and Not for Me without opening the options sheet. Audio's like mark combines a heart with a music note; visual's combines a heart with an artboard. Their full creator-specific meaning is carried in accessible labels, and double-tap gestures are redundant shortcuts rather than the only path.

**An audio focus arbiter** in `audioPlayerStore` (`requestAudioFocus(owner)` / `releaseAudioFocus(owner)`), so exactly one source is ever audible and a game trailer with sound pauses the music rather than playing over it. This is not speculative plumbing: the preview lane's duck-and-restore already does precisely this for one case, and `src/lib/audioRamp.js` exists to be its shared mechanism.

**The collision this was written to anticipate now exists**, and is handled locally rather than globally. Ambient view has three things that interrupt audio — the discovery audition, a game trailer with sound, and the text reader — and `borrowSilence`/`returnSilence` in `AmbientView.svelte` is a per-mode version of exactly this arbiter. It is the right shape but the wrong scope: anything outside ambient view that starts making noise still has nothing to coordinate with. Promoting it into `audioPlayerStore` is the outstanding work, and it now has a real caller to be designed against instead of a hypothetical one.

**Pairing** (which audio with which visual) is `pairs_with` from brief section 12 and is still undecided. Dealing from two independent decks is a usable first pass and should be understood as a placeholder.

## The submission form

**Built.** This was the largest single item on this list for most of this project's life. `docs/submission-form-spec.md` (v0.4) has the fields, validation, and copy fully specified, and `/join` is the real multi-step form described below, not a placeholder for it. What changed three times along the way was where its steps actually run, what order they run in, and finally what the backend actually _is_, since this project's architecture is a static build with no required backend for the reader or widget, and since the form collects an email address that changes what can safely be public and when.

**What "built" covers, precisely: the form's own half.** The multi-step UI (`src/routes/join/+page.svelte`), its state (`src/lib/submissionStore.svelte.js`), client-side validation cross-checked against the JSON schema (`src/lib/submissionValidation.js` and its test suite), and the webhook client (`src/lib/submissionApi.js`, with a mock backend for dev at `src/lib/submissionApi.mock.js`) are all in the repo and exercised end to end against the mock. **What is not in this repo, and cannot be:** the actual n8n workflow the form talks to. That is configuration inside a separate service, stood up and pointed at via `VITE_SUBMISSION_WEBHOOK_URL`; the contract it must implement is spelled out in `submission-form-spec.md` section 7. Without that variable set, a production build says submissions are closed rather than silently accepting them (`src/lib/submissionApi.js`'s `useMock`/`hasBackend` split) — this was verified directly, not just asserted, by building the site both ways.

**Section 5's token generation and reachability check run in an n8n workflow, reached over a single webhook and kept separate from the Docker/Semaphore/Ansible publishing pipeline.** It accepts the submission, generates the token, and checks it synchronously while the submitter is still on the page; it writes nothing to `ring.json` directly. This was chosen over extending the publishing webserver itself specifically to keep that server load-bearing for deploys only, not for intake too. Naming n8n also closed the review-queue question below, which is the main reason it won: one service covers intake, the check, the queue, and the PR, instead of a function plus a datastore plus an admin page.

The site's side is one build-time variable, `VITE_SUBMISSION_WEBHOOK_URL`, deliberately named for the shape rather than the vendor, and one `fetch` from the browser. There is no server in this repo to proxy through and adding one would break the static build, so the URL is public in the client bundle by design and every abuse control lives on the n8n side.

**A submission does not become a pull request until a human has already approved it.** Passing the automated check lands the submission in a private review queue instead, where a maintainer sees every field, including the visitor's email, and decides. Only approval opens a PR, and that PR carries just the public `ring.json`-shaped fields; email and every other review-only field are stripped before it exists. This replaced the earlier design, where a passing check opened the PR immediately and the PR itself was the review surface, for one reason: a PR is public the instant it opens, and email can never be. The PR did not go away. It moved to being the last step instead of the first one, which is still the right shape for what it does, a human looking over one JSON object before it joins a public file; it just no longer needs to be where the private parts of a submission sit while that happens. See `submission-form-spec.md` section 7 for the full reasoning.

**The form replaced the pull request and issue paths on `/join` outright, rather than joining them as a third option.** One documented way in. The interim notice and the PR/issue instructions this section used to describe are gone from `/join`; the page now shows the form's own steps, or, if `VITE_SUBMISSION_WEBHOOK_URL` is unset in a production build, a notice that submissions are closed. (This is the submitter-facing PR path that was retired, not the internal maintainer-facing PR described above, which survives in a different role.)

**The review queue lives inside n8n, and the maintainer's surface is a notification rather than a page.** Approval and rejection arrive as signed one-time links in a Discord message or email; there is no database and no admin page to build. This was the "real second surface" flagged in the previous version, and naming n8n is what collapsed it back into the intake decision instead of leaving it as a separate project.

The bot identity and merge behavior are settled: n8n uses a fine-grained PAT scoped to
this repository, and approval opens a pull request that still requires a separate manual
merge so `validate:publish` runs against the composed file. The operational proof is now
complete: Create, Update, and voluntary Remove were exercised for a new entrant through
the production browser and review workflow, closing the lifecycle item on the public-
release path.

## Production packaging and publishing

**Built.** Alongside the submission form, because the form was the first thing here that needed a real deploy target rather than a build directory someone copies by hand. `Dockerfile`, `Caddyfile`, `.dockerignore`, and `.github/workflows/docker-publish.yml` are all in the repo; a full build-run-request-teardown cycle was exercised directly (not just written and assumed), including confirming the container runs as a non-root user, both `VITE_` build args land correctly in the compiled client bundle, `/404.html` serves with a real 404 status through Caddy's `handle_errors`, and gzip encoding is active.

**The image is a static file server and nothing more.** `adapter-static` emits plain `.html` files, so production is Caddy serving `build/` — no Node process, no PM2, no database. That is the whole difference between this project's container and a conventional SvelteKit one, and it is worth stating because the reference implementation being copied from (GGRequestz) is `adapter-node` and carries a great deal of machinery that does not apply here.

**Every `VITE_` variable is baked at image build time, not read at run time.** This follows from `adapter-static` and was already true of `VITE_SITE_ORIGIN`; the webhook URLs and the Turnstile key simply joined it as each was added (the Dockerfile's own `ARG` list is the definitive current set — it drifted behind the app's actual `VITE_` surface for a while after Contact and Turnstile shipped in `0.11.0`, since only the original two variables had been wired through; fixed as part of v1.0 prep). `docker run -e` does nothing, `--build-arg` is the mechanism, and the practical consequence is that an image is specific to the values it was built with. Worth knowing before publishing one to a registry and assuming it is portable.

The webhook URLs belong in repository **variables**, not secrets. They are compiled into public JavaScript either way, and filing them as secrets would create a false impression that leaking them matters.

**This project takes no position on what runs the image.** The founding brief names Docker, Semaphore, and Ansible as candidate deployment tooling; nothing here assumes any one of them, or that the image is deployed via Docker at all rather than `npm run build`'s plain static output served some other way. The `--build-arg` list is the entire contract the image offers — which values to set, which registry, which orchestrator, how secrets for the n8n side get provisioned, is infra's decision to make, not something this repo should encode an opinion about.

## Visitor-facing terms (Terms of Use, privacy notice)

**The submitter half is built.** `docs/legal/EULA.md` is the real EULA a creator consents to on `/join`'s consent step, rendered server-side into `src/components/legal/EulaContent.svelte`. It is a **submitter** clause and, by its own preamble, nothing else — it does not cover a visitor who only browses the ring.

**The visitor half is now built too.** `docs/legal/TERMS-AND-PRIVACY.md` carries both the Terms of Use and the Privacy Notice as one document, rendered at `/terms` through the same build-time Markdown path the EULA already used — `remark` in a `+page.server.js`, into the shared `EulaContent.svelte` in a standalone mode. Only rendered HTML reaches the browser, and the Markdown file stays the single source of truth for both documents.

The privacy notice was the easiest and strongest document this project will ever write, and for the reason predicted here: no accounts, no server-side data, everything in the visitor's own browser. `/join`'s consent step now links to both, so a creator agrees to the EULA and the Terms in the same place.

Still open: whether the About modal or a footer should also link `/terms`, which is presentation rather than publication, and whether the discovery trail's own journal needs its own paragraph once that view exists.

## Screen saver mode

A visualizer that transitions through node types and whatever content the ring has, closest in spirit to the brief's original "idle, screensaver-like surface" framing of the field view.

The unresolved part is sound, and it is unresolved on purpose:

- **Audio entries:** the idea is playing a short section of a track before fading out and moving to the next node. That collides directly with the brief's "nothing autoplays with sound" guardrail unless the whole mode is something the visitor explicitly starts, which is probably the answer.
- **Text entries:** a possible TTS pass, which raises its own questions (which voice, whose synthesis, whether it is local-only like everything else here).

Both of those are why this is a roadmap entry with a caveat rather than a spec.

## Generated templates: refinement pass

Twenty-one generator templates across audio, comic, text, game, and Art are built and
exportable, including five distinct Art layouts. They are intended to keep improving
rather than being treated as finished. The authoring workflow, local fixtures,
long-content coverage, and visual reference suite are documented in `generator-template-authoring.md`.

- ~~More color-variation passes per template, so two creators using the same one do not end up looking as similar as they can today.~~ **Built**, structurally rather than as a
  one-off pass: `templateOptions.js` lets each template declare its own customizable
  surface, mapping shared roles (main color, page background, card surface, text) onto
  whichever CSS variables that design happens to use. Every template offers at least an
  accent and a page background; most offer four. Adding a control to a template is now a
  table entry, not a form edit, and three templates whose "Main color" control had never
  been wired to anything now work.
- Testing the live embedded ring link once a generated site is actually deployed, not only in the local preview (see `previewWidgetEmbed`'s own doc comment in `/join` for why the preview and the real export already point at different origins on purpose).
- Shipping each template with extra sections present in the HTML but commented out, so a creator who wants more can uncomment rather than needing to hand-build. The audio template's own candidates: a tour-date table, an album/release table, and possibly an additional main-nav entry.

## Text reader: TTS

**Built in ordinary and Ambient views.** An optional "Read aloud" control uses the
browser's own `speechSynthesis` rather than the [tiny-tts](https://github.com/tronghieuit/tiny-tts)
this entry originally named — see `decisions.md` for why the bundled-model option lost on
size for a payload the schema caps at three short excerpts. The three questions this entry
raised are answered there too: local-only is enforced via each voice's `localService`
flag rather than promised, and the voice is the platform default for the page language
rather than a setting.

Still open: whether long-form text, rather than the submitted excerpts, ever belongs here.
Also worth a fresh look eventually: whether tiny-tts's voice actually sounds more natural
than the local `speechSynthesis` voice picked today — the original comparison was decided
on size, not on a real listen test. See the revisit note on the LOCKED entry in
`decisions.md`.

## Widget validation

**Public-release status: core case done.** The thing this pass exists to prove —
traversal actually moving a visitor from one real member site to another — was verified
live: a production install running the current preview image (with the CSP and CORS
fixes below) round-tripped between two real member sites via the sandboxed iframe tier.
The remaining checklist items below are follow-up hardening and test-suite coverage, not
open blockers.

Run both widget tiers (the default sandboxed iframe, `/embed-frame`, and the advanced
`embed.v1.js` script tag -- see `decisions.md`'s widget-iframe-isolation entry) against
representative real host pages and confirm:

- Previous, Random, and Next use the published ring correctly, for both tiers.
- Theme and placement remain host-controlled without leaking widget styles.
- The iframe tier actually renders and is interactive on a real third-party host, not just
  same-origin as `testing/embed-frame.e2e.js` currently exercises -- that suite cannot
  test real cross-origin embedding by construction (it needs a second real origin) and is
  a narrower, same-origin regression check, not a substitute for this.
- The member participation validator recognizes both full-widget tiers and the supported
  badge/text alternatives without accepting lookalike links.
- A generated site uses its real production embed after export rather than the isolated
  preview substitute used inside the builder, for whichever tier was chosen.
- **An unedited `site-id` is included as an explicit case, and is the likeliest failure.**
  `/widget` hands out the snippet carrying the `your-ring-entry-id` placeholder, and a
  widget with an unknown id still renders — so a member who pastes it verbatim sees
  nothing wrong while the checker sees no matching embed. This now reports as
  `ring_widget_site_id_unmatched` rather than as a missing embed; confirm that on a real
  host page, and decide whether `/widget` should stop handing out a placeholder at all.
- **A client-rendered host page is included as an explicit case.** The validator matches
  the HTML as served and runs no JavaScript. Note the axis is server rendering rather
  than templating: SSR/SSG hosts put their footer in the served markup and pass, so this
  is a narrower case than it first appears. See `docs/member-link-health.md` in
  `indienodes-ring` (moved there in the ring split; see `decisions.md`).
- **A page longer than the 2 MB read limit is included as an explicit case**, since
  embeds sit in the footer and footers come last. This reports as
  `ring_participation_indeterminate` rather than as absence.

Across all three, the question this pass settles is not whether these warnings happen —
they do — but whether they are rare enough to stay human-reviewed. A warning class
people learn to ignore has stopped being a check.

**Three findings from the 2026-09-04 ring audit land in this section** (see
`ring-audit-2026-09-04.md` part 2). The first two defects are fixed and shipped in 1.5.0;
the third and the harness item below remain open as follow-up:

- ~~**`/embed-frame`'s CSP blocks its own ring fetch under the production configuration.**~~
  **Fixed in 1.5.0.** The per-path override set `connect-src 'self'` (`Caddyfile`), while
  production supplies `VITE_RING_URL=https://ring.indienodes.us`; the site-wide policy
  listed that origin but this override didn't. `loadRing`'s fallback to the same-origin
  mirror had kept the widget visibly working, so the symptom was a CSP violation on every
  load plus the default tier quietly serving the five-minute-cached mirror instead of the
  canonical endpoint, not a blank badge — see the CHANGELOG's 1.5.0 entry.
- **The cross-origin harness is nearer than "needs a second real origin" suggests.**
  `testing/scripts/serve.mjs` already serves `testing/sites/` on port 4174 with
  `Access-Control-Allow-Origin: *`, which is a second real origin. What is missing is embed
  markup in those fixture pages — they carry verification meta tags today but no widget of
  any tier — and a spec that drives a traversal across them. Until that exists, the ring's
  actual purpose, moving a visitor from one member's site to another, has never been
  exercised end to end.
- **`ring.indienodes.us`'s own CORS is asserted nowhere reachable from this repo.**
  `src/lib/widgetCors.test.js` parses the `Caddyfile` and covers `RING_JSON_URL`'s path,
  but the widget's _primary_ endpoint is `RING_ENDPOINT_URL`, whose origin lives in a
  different repository and deploy. A missing header there fails in the exact silent way the
  `@embeddable` block exists to prevent: badge and text tiers keep working while both full
  tiers die.

Also worth carrying into the pass: the badge and text-link tiers have no ring position at
all — both are a plain link to `/go/random`, with no Prev/Next to validate. Only the two
full-widget tiers resolve neighbours, and only from the `site-id` in their snippet.

## Content-addressed widget builds and real SRI for the advanced (script) tier

**Not started.** `embed.v1.js`/`embed.js` are mutable: "v1" pins a behavioral contract, not
content, and a new build silently overwrites the same URL. The advanced `widget-script`
tier (see `decisions.md`'s widget-iframe-isolation entry) therefore ships with no
Subresource Integrity hash, deliberately -- adding one against a URL whose bytes keep
changing underneath it would make every already-pasted snippet's browser refuse to execute
the next time the widget is rebuilt for any reason, which is worse than no SRI. Real SRI
needs immutable, content-addressed URLs (`embed.v1.<sha256>.js`), retaining every prior
version, a way to compute and thread the hash into `embed-snippet.js` at build time, and a
story for members re-pasting an updated snippet when the widget changes. Genuinely
separate, non-trivial work from the iframe tier itself, which does not need any of this
(its isolation comes from the sandbox, not from pinned content).

## A per-page hash-injection build step, for a stricter CSP script-src

**Not started.** The Content-Security-Policy shipped 2026-08-31 (see `decisions.md`) carries
`'unsafe-inline'` on `script-src` because SvelteKit's own hydration bootstrap embeds
per-page, per-build data (the layout's changelog-derived `releases` list on every page, a
`data-sveltekit-fetched` cache of `ring.json` on routes that fetch it during prerendering)
with no single stable hash the way `app.html`'s own inline script has. Closing this needs a
build step that, for each file under `build/`, extracts every inline `<script>`'s exact
content, computes its hash, and injects a matching `<meta http-equiv="Content-Security-
Policy" content="script-src 'self' 'sha256-...' 'sha256-...'">` into that page's own
`<head>` -- per-page, since the hashes differ page to page. `frame-ancestors` and `sandbox`
are not honored via `<meta>` at all (CSP spec), so the Caddy header would still need to carry
those directives (and would need to stop asserting `script-src` itself, since a header and a
meta tag both naming that directive are intersected, not merged, and the header's version
would win over the per-page hashes it doesn't know about). Real, separate engineering --
not attempted alongside shipping a working baseline policy.

## Responsive release pass

**Public-release status: largely done.** Exercised across the ordinary field and Ambient
view at representative phone, tablet, laptop, and wide-desktop sizes, including
portrait/landscape changes, reduced motion, touch and keyboard paths, safe-area insets,
overlays, the mini player, and the full-screen fallback -- in addition to the
component-level responsive behavior and browser coverage already in CI. A handful of
elements still need tuning; tracked as normal follow-up work rather than a release
blocker.
