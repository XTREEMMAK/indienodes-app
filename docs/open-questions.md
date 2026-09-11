# Open questions

Nothing here should be closed silently. These are surfaced for a decision, not defaults waiting to be assumed.

For things where the direction _is_ settled and only the building is left, see `roadmap.md`.

## Found while reworking the field view (two columns, per-node timers)

- ~~**Does an arrangeable, type-pinned field view conflict with the brief's own guardrails?**~~ Resolved: it does not, on the principle that configuring a node defines a channel while choosing its content would be picking an item, and only the latter is what section 11 forbids. Explicit edit mode and per-node configuration are the mechanisms. See `decisions.md`.
- ~~**Should non-game entries be encouraged to supply `thumb_url`?**~~ Resolved: yes. Cover art is now an explicit submission expectation for every type, documented in `README.md` and in the schema's own field description.
- ~~**`ring.json` is fetched whole, in one request.**~~ Resolved as a **tripwire rather than a build**: nothing changes now, and a threshold is recorded so this is not rediscovered as an emergency. See `decisions.md` for the numbers and the trigger.

## Carried forward from the brief (section 12)

- ~~Comic and text color assignments.~~ Resolved: all four type colors are now locked, with comic and text confirmed at their original values after a real trial as full-card backgrounds in both themes. See `decisions.md`.
- ~~**Per-type rotation timing.**~~ Fully closed and built: per-type defaults (audio 10s, game 14s, any 14s, text 16s, comic 22s), bounds of 5s to 60s, and a slider per type in Settings > Content. The code no longer has a global `ROTATION_INTERVAL_MS`. See `decisions.md`.
- **Visible-node count at production scale** remains a first-pass pick, separate from timing. The field shows whatever the visitor has arranged, so this is really a question about the shipped default layout rather than a cap.
- Whether `pairs_with` (audio/visual ambient pairing) gets built, and if so, whether it is creator-submitted or community-suggested. Ambient view's first pass deals from two independent decks instead and is documented as a placeholder pending this; see `roadmap.md`. **A recommendation now exists** and narrows this rather than closing it: `creator_id` already links a creator's own nodes, so an artist/musician's two entries are a pairing the project can assert with no new submission field and no new judgment — which is precisely what the sequencing note below says has been blocking "creator-submitted." See `ring-audit-2026-09-04.md` part 3. Still a decision, not a default: the audit recommends pairing _sometimes_ and _labelled_, since pairing every time one creator has two nodes hands them both lanes for the length of the rotation.
- ~~Full submission and publishing flow: what triggers the Semaphore/Ansible pipeline.~~ Partly resolved: `submission-form-spec.md` section 7 now decides that a separate serverless function handles token generation and the reachability check, and a passing submission still becomes a pull request through the existing pipeline rather than writing to `ring.json` directly. What triggers rebuild/deploy on approval is unchanged and still undecided (manual approval vs. auto-merge on a passing checklist). See `roadmap.md`.
- ~~Game entry handling beyond the prototype: what "the game itself" links out to.~~ Resolved: `source_url`, same as every type, nothing game-specific. Trailer vs. screenshot-only is also decided (screenshot always shown, trailer is opt-in) — see `roadmap.md`'s Game entries section.

## Found during the phase 0 build

- ~~**Whether KeyJayOnline_v2's comic viewer is reusable.**~~ Resolved: yes, as an adaptation rather than a port. The interaction model carried over; all five of its dependencies were replaced or dropped. See `decisions.md`. Original note kept below for the record.
- **(historical)** Located at `../keyjayonline.com_v2/src/lib/components/ui/ContentViewerModal.svelte`. It is a full-screen modal with pinch-zoom, drag-to-pan, swipe navigation, a grid "all pages" view, fullscreen support, and expandable captions, considerably more capable than the brief's spec for the reader's comic view. It also carries dependencies specific to that project (an `@iconify/svelte` icon set, a `sanitizeHtml` util, a `modalHistory` util, an `imageCache` util, a `SkeletonImage` component) that would need to be ported or replaced. Reads as adaptable rather than a drop-in port: the interaction logic (zoom, pan, swipe, keyboard nav) is the valuable part and ports cleanly in shape; the modal chrome and its supporting utilities would need to be rebuilt against this project's own component set. Not ported yet, per the bootstrap prompt's instruction to report and wait for a call before committing to reuse. This becomes relevant when the static reader (client b) is built.
- ~~**`_placeholder` entries and the publishing pipeline.**~~ Resolved: a separate publish gate, not a change to the default validator. `npm run validate` still accepts placeholders (and now reports how many there are); `npm run validate:publish` hard-rejects them. See `decisions.md`.

## Found while building the field view (home page)

- ~~**Whether tapping a node should start its primary action.**~~ Resolved: in Field browse mode, the passive card surface mirrors the unambiguous in-app action—audio play/preview, Art gallery, Comic reader, or Text reader—while every labelled control remains. Game keeps explicit Trailer/Visit controls, Lists remains explicit-control-only, and Arrange mode disables the card-wide action. Pointer travel, pointer cancellation, ancestor scrolling, and text selection suppress activation so a swipe does not become a tap.
- ~~**Rotation swaps the whole visible window, not "one slot at a time."**~~ Resolved: rotation is now per-slot on independent, jittered timers, which is what the brief (section 7c) described in the first place. See `decisions.md`.
- ~~**Favorites has no export/import yet.**~~ Resolved and built, wider than the brief's wording: the export is every local key, not just likes. See `decisions.md`.
- ~~**Favorites has no "play my liked audio" or "keep going" expansion yet.**~~ No longer an open question: brief v0.2 LOCKED the specification (a dedicated "Play my Liked" control, an alternate "Play my Liked, Shuffled", both feeding the existing "Keep going" prompt unchanged). The direction is settled and only the building is left, so it belongs in `roadmap.md` rather than here. "Keep going" itself is already built in `AudioPlayer`; what is missing is the entry point and the shuffled variant. **Update:** the audio-form addendum (`tmp/IndieNode_v2_Addendum_Audio_Form.md`) adds a Music / Spoken / Everything choice in front of "Play my Liked" for a visitor whose liked audio spans both forms. That choice is deferred until "Play my Liked" itself is built — there is no entry point yet to attach it to. Only "Keep going", the one queue feature that exists today, has been made form-aware (`src/lib/audioSuggest.js`): it never crosses forms.

## Carried forward from the audio-form addendum (`tmp/IndieNode_v2_Addendum_Audio_Form.md`, section 7)

Three PENDING items, recorded here rather than decided, per the addendum's own framing:

- **Spoken rights checklist wording (needs attorney review).** Proposed wording would require every spoken track to be original or fully rights-cleared by the submitter, which would make a demo reel built from client-owned commercial work ineligible. Needs review alongside EULA §6 (contribution license scope) before it can be added to the checklist, since reel rights differ from music rights and the existing PRO-disclosure item is music-specific.
- **Spoken length guideline.** Audio drama episodes and narrations can run 30 minutes or more, which behaves very differently from a short music sample in both the reader and a queue. Whether to set a recommended or maximum track length for `spoken` is undecided.
- **Remembered queue choice.** Once "Play my Liked" exists, whether its Music / Spoken / Everything choice is asked every time or remembered locally (`localStorage`) between sessions is undecided. Either way it stays local only, never sent anywhere.

## Found while building the widget

- ~~**`RING_JSON_URL` and `SITE_ORIGIN` are placeholder domains.**~~ Resolved: the production domain is `https://indienodes.us`, applied to `src/lib/config.js`, `src/app.html`'s Open Graph and Twitter tags, `schema/ring.schema.json`'s `$id`, and the embed snippets in `README.md` and `src/widget/embed.js`.
- ~~**`GITHUB_URL` was a literal `TODO`.**~~ Resolved: `src/lib/config.js` now points at the real repo, `https://github.com/XTREEMMAK/indienodes-app`. The About modal's Source & License link and the release list's anchors are live.
- ~~**`KOFI_URL` is still a literal `TODO`.**~~ Resolved differently than this expected: not by filling in a real handle in `src/lib/config.js`, but by making it `VITE_KOFI_URL`, build-time config supplied by whoever deploys — a personal donation link is deployment-specific the way `GITHUB_URL` above genuinely isn't, so it belongs to infra, not this codebase, the same posture the submission and contact webhook URLs already have. Unset drops the Support tab from the About modal entirely rather than shipping a link to nowhere. See `.env.example`.
- ~~**`static/embed.js` versioning.**~~ Resolved: the widget now builds to both `/embed.v1.js` and `/embed.js`, and the versioned URL is what the snippet hands out. See `decisions.md`.
- ~~**No widget analytics of any kind.**~~ Confirmed rather than left implicit: there are none, deliberately, including aggregate embed counts, and none are planned. Recorded so the absence reads as a decision rather than an oversight.

## Found while planning ambient view, the journal, and publishing

- ~~**What pairs with what in ambient view.**~~ Not resolved as a real answer, but resolved as a sequencing decision: `pairs_with` needs the submission form to exist before "creator-submitted" is even meaningful, so it stays a placeholder (two independent decks) until the form does. See `roadmap.md`. **Update 2026-09-04:** the form now exists, and the audit's finding is that the cheapest first `pairs_with` needs nothing from it — `creator_id` is already the link, so the blocker named here is spent. What replaced it is a _data_ blocker rather than a design one: `creator_id` is never actually minted (see the entry below), so any pairing rule built on it evaluates against an empty set today.
- ~~**How ambient view announces that it will play sound.**~~ Resolved: a one-time confirmation on first launch, remembered locally (`indienode:ambient-consent:v1`), not a permanent label change. See `roadmap.md`.
- ~~**Whether the discovery journal is included in the favorites export/import.**~~ Resolved: yes, and so is everything else local. The export is a full "your data" file rather than a like list. The concern that raised this (the journal being a fuller record of browsing than likes are) is answered by saying so in the UI at the moment of export, not by leaving the journal trapped on one device. See `decisions.md`.
- **Where the visitor-facing terms live, and what they cover.** Partially resolved: the _submitter_ half now exists and is rendered — `docs/legal/EULA.md`, parsed server-side into `src/components/legal/EulaContent.svelte` and shown from `/join`'s consent step. What's still open is everything the EULA explicitly does not cover: a Terms of Use for visitors who only browse, and a privacy notice. The privacy notice is unusually easy here (no accounts, no server-side data, everything local), and the discovery journal makes it more necessary rather than less, even though nothing leaves the browser.
- ~~**There is no way to contact the project at all.**~~ Resolved: `/contact` exists and `VITE_TURNSTILE_SITE_KEY` is read there and by `/update` — both now render `Turnstile.svelte` when the key is set. What's still open is the challenge itself: see the Turnstile checklist immediately below.

### Turnstile — enabled 2026-08-31 for submit_update and request_removal

A real Cloudflare Turnstile widget was created, its site key set as this repo's
`VITE_TURNSTILE_SITE_KEY` GitHub Actions variable, and a rebuild deployed. Its secret lives in a
real n8n `httpCustomAuth` credential (`IndieNodes - Turnstile Secret`, id `g0EFH2lm3bgbeea7`) — the
secret itself was never pasted anywhere in this repo, this chat, or a shell command; it went
directly into n8n's own credential UI. `build_workflows.py`'s `TURNSTILE_CREDENTIAL`/
`TURNSTILE_ENABLED` point at it, and `Webring - Action - Finalize Submission v2` was pushed and
verified against its fetched-back live definition (34 nodes, credential wired, active).

`issue_token`/`bind_source_url`/`verify`/`submit` remain deliberately unguarded by design; only
`submit_update` and `request_removal` require a solved challenge (`build_workflows.py:1242-1245`).

**Still open:**

- **A real end-to-end smoke test hasn't been run yet.** Confirm on the live site: an `/update`
  submission with the challenge deliberately left unsolved is rejected with `turnstile_failed`,
  and a real solve succeeds. Everything up to this point is verified structurally (nodes,
  credential wiring, client rendering) but not by an actual browser round trip against Cloudflare's
  real siteverify endpoint.
- **`wf_contact` has no Turnstile plumbing at all** — not a dormant branch, an unbuilt one.
  `/contact` renders the widget, but the backend `validate` Code node only checks the honeypot and
  dwell time. `TURNSTILE_ENABLED` does nothing for contact-form spam; that needs new work in
  `wf_contact`, a separate decision from what shipped here.

7. Decide separately whether `/contact` gets its own server-verified branch built in `wf_contact`.

- ~~**Submission spec section 6 requires `source_url` to be "reachable at submission time."**~~ Resolved as part of the backend decision: the serverless function that generates the verification token also runs this check. See `submission-form-spec.md` section 7 and `roadmap.md`.
- **The submission form's own remaining unknowns.** ~~What happens to a submission that fails the reachability check on its first attempt~~ is resolved: the check is synchronous and inside the form (locked), so retry is just pressing Verify again. ~~Which serverless platform runs the intake function~~ is resolved: n8n, over a single webhook, with a deliberately vendor-neutral `VITE_SUBMISSION_WEBHOOK_URL` (see `decisions.md`). ~~Still genuinely open: how the workflow authenticates to open the final pull request, and whether that PR still needs its own separate merge click given a maintainer already approved the submission a step earlier in the review queue.~~ Resolved: a fine-grained PAT scoped to this one repo (Contents + Pull requests, read & write), stored as an n8n credential; and yes, the merge click stays manual. See `decisions.md`'s "LOCKED: PR authentication..." entry and `docs/n8n-workflow-runbook.md`.
- ~~**Where the private review queue itself is stored, and what a maintainer actually looks at to approve or reject a pending submission.**~~ Resolved by the same choice that settled the platform: the queue is n8n-native, and the maintainer's surface is a Discord or email notification carrying signed one-time Approve/Reject links. No database and no admin page, which is what made this stop being a second surface rather than a smaller one. See `decisions.md`.
- ~~**`GITHUB_URL` needed to be real before the submission workflow could open pull requests against it on a submitter's behalf.**~~ Resolved: it now points at the real repo (see above). `KOFI_URL` is the one placeholder from this pair still open.
- ~~**Whether the PR/issue path is deleted immediately when the form ships, or kept open briefly for submissions already in flight.**~~ Resolved: cut over immediately. The moment the form ships, `/join` stops documenting PR/issue and points only at the form; nothing runs the two paths alongside each other even briefly. Simplest, and there is nothing to keep in sync for the length of an overlap window.

## Music hosting: settled, with two threads left open

**Settled (see `decisions.md`):** audio is playable only from a direct `media_url` the artist hosts at a CORS-permitting host, `archive.org` being the standing recommendation. No platform players, no self-hosting. An audio entry with no playable file is a supported shape, a link-only member.

That closed three things that had been open here: Bandcamp's expiring URLs (no longer relevant, nothing in the repo depends on them), the scraper-and-refresh service (rejected: it needed a permanent headless-browser service against a site actively blocking automation, and inverted the project's own thesis), and YouTube (prohibited outright for audio-only by Developer Policy III.I.7, and its permitted visible embed carries ads and trackers the brief rejects by name).

Two threads genuinely remain.

**Whether hosting gets revisited if a backend ever exists.** The assessment against self-hosting was partly legal (strict liability, the narrow scope of §512(c), the composition/PRO/MLC gap) and partly architectural (no server, `ring.json` is the product). The legal part does not change with a backend; it would still need a PRO web license, an MLC blanket license with monthly reporting, a registered DMCA agent, and a repeat-infringer policy. The architectural part does. If a backend ever arrives for unrelated reasons, this is worth re-costing rather than assuming the earlier "no" still holds for the same reasons.

**SoundCloud, which is the one platform that could have worked.** Its [HTML5 Widget API](https://developers.soundcloud.com/docs/api/html5-widget) needs no API key and exposes real control and events over `postMessage` (play, pause, seek, next, plus load/play/finish/error), so a SoundCloud iframe could be a genuine queue member with finish detection, unlike Bandcamp's embed. It was not built because platform players were dropped as a category, not because SoundCloud failed on the merits. If platform support is ever reconsidered, start here. Note it would still not drive the reactive background, since a cross-origin iframe's audio cannot be analysed.

The thing to watch is the ratio: if most audio entries end up link-only, the queue, finish detection, and the reactive background become features almost nothing in the ring can use, and that is an argument for revisiting one of the two threads above.

The decision not to buffer the next track hangs off this same ratio, and states the second half of its own trigger (a measured boundary stall) alongside it. See `decisions.md`.

### ~~`/join` is written PR-first, but the intended process is form-first~~

Resolved on all three points that were open here.

- **The PR and issue paths are retired once the form exists**, not kept alongside it. One documented way in.
- **Ownership verification's place in the order is settled**: it runs inside the new serverless function (`submission-form-spec.md` section 7), between the submitter filling out core fields and a pull request being opened, matching section 5's original sequence.
- **What the page says in the meantime is fixed.** `/join` now opens with an explicit notice that the form is not built yet and that this page will be rewritten around it when it is, rather than presenting the pull-request flow as the settled design.

What is still genuinely open moved to `roadmap.md`'s "The submission form" entry and the two new lines above (platform, bot auth, retry behavior, and the cutover question for submissions already in flight when the form ships).

### The submission-guidance question

~~How hard to push `archive.org` is a judgement not yet settled.~~ **Settled: keep it neutral.** Playable is presented as a bonus and link-only as a normal kind of member, which is the current wording and is now the decision rather than a placeholder. Asking a Bandcamp-only artist to re-upload elsewhere is real friction for a webring whose whole pitch is that joining is cheap, and the benefit (queue membership, finish detection, the reactive background) serves this site more than it serves them.

The thing that would reopen this is evidence, not taste: if the ratio of playable to link-only entries turns out low enough that those three features are dead weight, that is a reason to revisit. See the note above about watching that ratio.

## Found while auditing verification, traversal, and multipotentiality (2026-09-04)

Full findings in `ring-audit-2026-09-04.md`. The widget/traversal half is threaded into
`roadmap.md`'s "Widget validation" section instead, since that pass was already
release-required.

- ~~**Does the site verification step earn its place, given a maintainer approves the member
  into the ring later anyway?**~~ Resolved: yes, and the framing that raised it conflated
  three things. Verification is a `<meta name="indienode-verification">` tag, _not_ the
  widget embed — nothing asks for a widget before approval, so "they add a widget and still
  aren't in the ring" is not a sequence this flow produces. Verification and approval also
  answer different questions (does this person control this URL, versus should this creator
  be in the ring), and approval cannot absorb verification because a maintainer reading a
  queue row has no independent way to check the first. The decisive point is that with no
  accounts anywhere in this project, ownership verification is the **only** mechanism the
  ring has for telling a member from a stranger — `/update` and `request_removal` already
  authenticate by re-running the same check against the live ring's `source_url`. Removing
  it from onboarding would not remove the mechanism, only move its first use later. Kept
  as-is. The one part worth attacking separately is the generator branch's
  export-upload-then-verify round trip, which is genuinely heavier than the own-site
  branch's single pasted tag.

- **`creator_id` is never assigned to anyone, so the multipotentiality model is inert.**
  Not a question so much as a blocker that has to be cleared before the `pairs_with`
  recommendation above can be assessed against anything real. The approval workflow only
  _propagates_ a `creator_id` from an existing ring entry that already carries one
  (`build_workflows.py`), and nothing mints the first — so the first node from a host gets
  `null`, the second finds no match to inherit from and also gets `null`, and the chain
  never starts. This is a different bug from the `ReferenceError` already fixed in the same
  block, and it survives that fix. No test asserts on `creator_id` at all. What stays open
  is only whether the minting rule should be host-match (what the propagation step already
  assumes) or something narrower — the two-node cap is already LOCKED, and the reader-side
  `type` badge that distinguishes a creator's two nodes is already built.
