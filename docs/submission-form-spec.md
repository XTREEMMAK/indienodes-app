# IndieNodes — Submission Form Spec

**Version:** v1.1
**Status:** Implemented
**Scope:** Submission form fields, validation, EULA copy, and data model mapping for the ring.json publishing pipeline. This is an implementation spec, not a legal reasoning document. Safe for the public repo.
**Changelog (v1.1):** Per the audio-form addendum (`tmp/IndieNode_v2_Addendum_Audio_Form.md`): audio entries now require a `form` field (`music` | `spoken`), since spoken content (narration, audio drama, voice work) is now submitted under the existing `audio` type rather than a new one. The form displays the internal `audio` type as **Audio**, not **Music** — the music/spoken split is what `form` is for. The PRO-disclosure sentence in Section 3 is now shown only when `form` is `music`, since PRO membership means nothing for spoken-word audio.
**Changelog (v1.0):** Adds Art as a first-class creator type with one to three works and accessible metadata, plus the additive game `trailer_url` used only for click-to-load YouTube embeds. Create, Update, and voluntary Remove are production-verified.
**Changelog (v0.9):** The `why` input's product cap is reduced from 160 to 75 characters, enforced by both the browser input and `submissionValidation.js` while remaining outside the public ring schema's integrity constraints.
**Changelog (v0.8):** Section 7's two open items (PR bot authentication, whether the merge click stays separate) are resolved: a fine-grained PAT scoped to this repo, and yes, the merge click stays manual. See `decisions.md`'s "LOCKED: PR authentication..." entry and the new `docs/n8n-workflow-runbook.md`.
**Changelog (v0.7):** `pro_membership_name` now shown only for "Other" — every named PRO option already names itself by being picked, so re-asking for a name was pure redundancy. Sections 3 and 4 reworded off audio-only language ("recording and composition", "streaming" alone) onto wording any type of work can equally agree to, and Section 4 is now the one consent that actually gates submission: `rights_confirmation` is collected but no longer blocks Continue or Submit, since its wording is necessarily written toward one kind of work and reads oddly for the others. Section 4's full text now lives behind a "Read the full EULA" modal, with a short statement rendered inline next to the checkbox instead of the full paragraph always in view.
**Changelog (v0.6):** Per the Creator Nodes addendum (`tmp/IndieNode_v2_Addendum_CreatorNodes_and_Maintenance.md`): a node represents a creator, not a single work, so the `title` field is removed from `ring.json` and the form entirely — `why` absorbs its creator-introduction role, and is now the one place a creator makes their case, capped at 160 characters (a form-only product rule, not a schema constraint; see `submissionValidation.js`'s `WHY_MAX_LENGTH`). `creator_id` is added to the schema as an optional, backend-assigned field (like `id`) linking a creator's own nodes together, capped at two per creator as a moderation-checklist rule. The maintenance/update flow (a creator editing an existing node after submission) is described in the addendum's Section C but not yet built; it is not reflected in this spec's sections below.
**Changelog (v0.5):** Section 5 rewritten for the site generator branch (`tmp/site-generator-claude-code-prompt.md`): a creator with no site of their own can now have one built and downloaded from inside the form, with the verification token generated and embedded _before_ upload rather than placed on an existing page after the fact. Third-party-profile-token verification (a token pasted into a Bandcamp bio, a SoundCloud description) is **deprecated**: self-owned space, existing or generated, is now the only ownership path. Section 2.1 gains `has_own_site`, the branching field. Section 7's action table gains `bind_source_url` and marks `issue_token`'s `source_url` nullable, for the branch where a token is minted before any URL exists to bind it to.
**Changelog (v0.3):** Section 5 rewritten: a submission now lands in a private review queue before anything is public, and the pull request that used to be the review mechanism itself is demoted to a final, post-approval, email-stripped artifact. Added `email` to Section 2.2, scoped to this submission's own back-and-forth only. Section 7 rewritten for the queue's own storage and admin surface, which is a real new question this introduces rather than a detail of the earlier design.
**Changelog (v0.2):** Added Section 7 (Architecture), deciding where Section 5's token generation and reachability check actually run, since this project's own architecture (a static build with no required backend) does not obviously have a place for either. Also records that this form replaces the pull-request and issue paths outright rather than sitting alongside them.

---

## 1. Purpose

Defines the fields, validation rules, and required consent copy for the entry submission flow. This is the source of truth for building the submission form. It maps directly onto the `ring.json` schema in the main project brief and adds the fields needed for ownership verification and consent.

## 2. Form Fields

### 2.1 Core entry data (maps to ring.json)

| Field        | Type                           | Required    | Notes                                                                                                                   |
| ------------ | ------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| id           | system-generated               | n/a         | Not asked for. See below.                                                                                               |
| creator      | text                           | yes         | Display name                                                                                                            |
| creator_id   | system-generated               | n/a         | Not asked for. Links this creator's own nodes. See below.                                                               |
| type         | enum                           | yes         | audio, comic, text, game, art                                                                                           |
| form         | enum                           | conditional | Required if type is audio: music or spoken. Must not appear for any other type.                                         |
| why          | text                           | yes         | One line, capped at 75 characters. Introduction and pitch combined; no separate title field.                            |
| has_own_site | yes/no radio                   | yes         | Not a ring.json field. See below.                                                                                       |
| source_url   | url                            | conditional | Required if has_own_site is yes. See below for the no branch.                                                           |
| tags         | multi-select or free tag input | yes         | At least one tag                                                                                                        |
| tracks       | repeatable group               | optional    | Audio only. Max 3. Each has label + media_url                                                                           |
| pages        | repeatable group               | conditional | Required if type is comic. Each has image_url + caption                                                                 |
| artworks     | repeatable group               | conditional | Art only. 1–3 works; image_url and alt required, metadata optional                                                      |
| excerpts     | repeatable rich text           | conditional | Text only. Between 1 and 3 nonempty samples; headings and restrained inline formatting survive into generated templates |
| thumb_url    | url                            | conditional | Required if type is game. Optional and encouraged otherwise                                                             |
| preview_url  | url                            | conditional | Optional if type is game. Muted preview only                                                                            |
| trailer_url  | url                            | conditional | Optional if type is game. YouTube only; loaded after explicit play                                                      |

The form displays the internal `audio` type as **Audio**. The stored value names the playback
and media implementation, not a genre: an audio entry now also declares `form` (`music` or
`spoken`), so voice actors, narrators, and audio-drama creators are supported directly through
the existing `audio` type rather than as a hypothetical later category expansion. Queues never
mix the two forms — see `src/lib/audioSuggest.js` — since tags alone can't separate a spoken
piece from a soundtrack that happens to share every tag.

**`has_own_site` is form-only, never written to `ring.json`, and it gates the rest of this table.** Answering "yes" keeps the flow exactly as it already was: `source_url` is asked for immediately, and the fields above map straight onto the creator's own already-hosted media. Answering "no" branches into the site generator (see `tmp/site-generator-claude-code-prompt.md`): the creator uploads actual files (a track, page images, artwork, or a screenshot) rather than typing URLs, the form builds a small static site from them, and `source_url` is asked for only afterward, once the creator has somewhere real to point it at. `tracks`/`pages`/`artworks`/`excerpts`/`thumb_url` end up populated either way, just derived from the generator's own output instead of typed in directly for the no-site branch.

**`id` is generated by the backend at approval time and is never a form field.** The schema has always required it; this table simply never listed it, because there was no backend to generate one when the table was written. It is a slug derived from `type` and `creator`, truncated, with a numeric suffix on collision — there is no work-level `title` left to fold in, so two nodes from the same creator and type collide on the base slug and rely on that same numeric suffix to disambiguate, which is also what the two-linked-nodes cap on `creator_id` below keeps bounded. It is assigned at approval rather than at submission specifically because uniqueness is a property of `ring.json` as it exists _at merge time_, and the file can gain entries between someone starting a draft and a maintainer approving it. Approval is the only moment that holds both the authoritative file and the intent to write to it.

**Amended: the submitted id is honoured when it is still free.** The paragraph above is right that only approval holds the authoritative file, and wrong that this means the id must be re-derived there. By approval the creator may already have published the id: a generated site embeds it in the footer at download time, and the success screen shows an own-site creator the same value to paste. Re-deriving discards that. The form now sends the id it displayed as `requested_id`, a sibling of `entry` — never a field on it, because `toRingEntry` output is validated against a schema with `additionalProperties: false`. Approval uses it when nothing in the ring has taken it, and otherwise derives one exactly as before. Uniqueness is still decided at merge time against the real file; what changed is that the common case no longer renames something the creator has already published. `requested_id` is validated against the schema's id pattern at intake and again at approval, and is not on the finalize allowlist, so it never reaches `ring.json`.

**The derivation rule itself lives in `src/lib/slug.js` and the workflow inlines that file.** It had been restated in `build_workflows.py` and the two drifted three ways — no Unicode normalisation in the workflow copy, a 40-character cap against the browser's 48, and a hard truncation against the browser's cut-at-a-hyphen — so every accented creator name and every long one produced an id the creator's published embed did not match. Inlining the real module is what makes that class of drift impossible rather than fixed once; `scripts/n8n/test_code_nodes.mjs` runs both against the same corpus.

**`creator_id` is also generated by the backend, never a form field.** It links a creator's own nodes together (at most two, a moderation-checklist rule rather than an enforced one) without merging them into a single entry: a data-only link that lets ownership verification be reused across a creator's linked nodes and lets the reader surface "also by this creator." How the backend decides two submissions share a creator (matching on verified `source_url`, an explicit form question, or something else) is not yet decided.

**`tracks` is optional even for audio**, corrected from v0.3, which called it required-if-audio. The schema is the authority here and says otherwise, deliberately: an audio entry with no playable file is a supported shape, a link-only member listed with its cover and a link out. Playback needs a direct file the browser can fetch cross-origin, which not every creator can supply, and refusing those creators would serve the ring worse than listing them. The form should ask for tracks and offer an explicit way past the step, not treat skipping as an error.

### 2.2 Verification and consent fields (not in ring.json, used at review stage only)

| Field               | Type             | Required    | Notes                                                                                                                                    |
| ------------------- | ---------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| email               | email            | yes         | See below. Never written to ring.json, never stored as an account.                                                                       |
| verification_token  | system-generated | yes         | Opaque string, issued by the backend. Placed at source_url directly, or embedded in the generated site's export. Expires 24h after issue |
| rights_confirmation | checkbox         | yes         | See Section 3 warranty text                                                                                                              |
| pro_membership      | select           | yes         | Options: Not a member / ASCAP / BMI / SESAC / GMR / Other / Not sure                                                                     |
| pro_membership_name | text             | conditional | Shown only if pro_membership is "Other" — every named option (ASCAP, BMI, ...) already names itself by being picked                      |
| eula_agreement      | checkbox         | yes         | See Section 4                                                                                                                            |

The `pro_membership` field is data collection only. It does not block or approve submissions. It exists to give the project accurate visibility into PRO exposure across the live ring. Do not build any rejection logic against this field without a separate decision to do so.

**`email` is scoped narrowly, and the scope is the whole point of it.** It exists only for this one submission's own back-and-forth: telling a submitter their reachability check failed if they've already navigated away, or that their entry was approved or rejected. It is not an account (nothing is gated behind it, nothing persists it as an identity), and it is not a mailing list (it is never used to reach a submitter about anything other than the specific submission that collected it). It is retained only until that submission is resolved, approved or rejected, and deleted after. It is visible to maintainers during review (Section 5) and is never written to `ring.json` and never appears in the pull request Section 5 eventually opens.

## 3. Rights Warranty (checkbox label text)

Shown as a single checkbox. Collected for every type, but does not gate Continue or Submit — see Section 6. Worded for any type of work, not just audio's "recording and composition"; the PRO sentence is shown only when `type` is `audio` and `form` is `music`, since PRO membership only means something for music, not for spoken-word audio:

> "I confirm that I hold full rights to what I am submitting, including that no third party such as a co-writer, sample owner, publisher, collaborator, or label holds a claim that would require separate compensation for its use on IndieNodes. [music only:] I understand that PRO membership does not prevent me from submitting, but I am disclosing it accurately above."

## 4. General EULA (shown at submission, required checkbox)

The one consent that actually gates submission (Section 6). Worded for any type of work — "display, distribution, or streaming" rather than audio-only "streaming" — and rendered as a short inline statement next to the checkbox, with the full text available in a modal ("Read the full EULA") rather than always rendered in full. The short and full versions must not disagree about what is being agreed to; the full version is the short one made complete, not a different document.

**Short (inline, next to the checkbox):**

> "By submitting, you affirm you hold full rights to what you're submitting, and you agree that IndieNodes operates on a donation-only basis: it collects no revenue from your work, and you waive any claim to compensation from IndieNodes on that basis."

**Full (in the modal):**

> "By submitting your work, you affirm that you hold full rights to what you are submitting, including that no third party, including any performing rights organization, publisher, co-writer, sample owner, or collaborator, holds a claim requiring separate compensation for its use on IndieNodes. IndieNodes does not collect revenue on the basis of any individual creator's work and operates on a donation only basis. You waive any claim to royalties or compensation from IndieNodes arising from the display, distribution, or streaming of your submitted work on this basis. This waiver applies to the relationship between you and IndieNodes and does not, and cannot, affect obligations IndieNodes may independently hold to third-party rights organizations."

## 5. Ownership Verification Flow

**Self-owned space, existing or generated, is the only ownership path.** Third-party-profile-token verification (placing a token in a Bandcamp bio, a SoundCloud description, an itch.io profile) is **deprecated as of v0.5**. It existed to cover a creator with a platform presence but no space of their own to prove control over; the site generator (Section 2.1's `has_own_site`, and `tmp/site-generator-claude-code-prompt.md`) removes the reason for that fallback by giving that exact creator somewhere self-owned in a couple of form steps. Two sequences follow, branching on `has_own_site`.

**If `has_own_site` is "yes":**

1. Submitter fills out core entry fields, plus `email`.
2. System generates a `verification_token`, bound server-side to the `source_url` just given.
3. Submitter places the token at that URL: a meta tag or well-known path if they control the page's HTML.
4. Submitter presses **Verify**, an explicit step inside the form itself. The automated check confirms token presence at the destination in real time and reports pass or fail right there. This is a pass/fail checklist item, not a content judgment, and it is synchronous on purpose: this project collects no account, so there is no channel to reach a submitter after they leave the page. The submitter is still looking at the screen when this runs, so retry is just pressing the button again, not a separate flow.

**If `has_own_site` is "no":**

1. Submitter fills out core entry fields (without `source_url`, which does not exist yet), plus `email`, and uploads the generator's own fields: a display name, up to 3 works, an optional icon, optional social links.
2. System generates a `verification_token` at this point, bound to `submission_id` only — there is no URL yet to bind it to. This is the sequencing change the generator required: the token has to exist and be embedded in the exported HTML _before_ the creator uploads it anywhere, not placed on a page after the fact.
3. The form builds the site from a chosen template, embeds the token as a meta tag in `index.html`, and offers the export as a downloadable zip. The creator uploads its contents to a static host of their choice.
4. Submitter returns to the form and types in the address their page is now live at. This calls `bind_source_url` (Section 7), attaching it to the same `submission_id`.
5. Submitter presses **Verify**, same mechanism as the yes-branch: an automated, synchronous, pass/fail check against the now-known `source_url`.

**From here the two branches rejoin:**

5. **On pass, the submission (every field, including `email`) enters a private review queue.** Nothing about the submission is visible outside the queue at this point, which is what keeps `email` from ever landing somewhere public. See Section 7 for what the queue actually is.
6. A maintainer reviews the submission from inside the queue against EULA §8's moderation checklist and approves or rejects it. The checklist is deliberately not restated here — §8 is the binding text and this line went stale once already by paraphrasing it — but it covers a valid URL, working ownership proof, a declared type matching the content (and, for audio, a declared `form` matching the content), rights confirmations, and work that is publicly reachable and authentically the submitter's. `indienodes-ring`'s `docs/curation-policy.md` is the reviewer-facing detail behind that clause. Because this is a private surface, the maintainer sees `email` and every other field, not just the `ring.json`-shaped ones.
7. **On approval, a pull request is opened carrying only the public `ring.json`-shaped fields** from Section 2.1. The temporary `verification_token` is cleared when the request enters review and is not published. `email`, `rights_confirmation`, `pro_membership`, and every other Section 2.2 field are stripped before the PR exists; none of them were ever meant to be public, and this is the point where that stops being merely a policy and becomes something the data flow enforces. `email` is deleted from wherever the queue held it once the submission reaches this step.
8. The PR goes through the existing pipeline (Semaphore/Ansible) to rebuild and deploy, unchanged from before this version. Whether that PR still needs its own human merge click, given a maintainer already approved the submission one step earlier, is noted as open in Section 7.
9. On rejection, the submitter is told so at `email`, and nothing about their submission is retained past that point. **On approval they are told too**, immediately before the queue row's `email` is scrubbed — the address is used once, for the one outcome the submitter is actually waiting on, and then deleted. That mail says the entry was approved and that it joins the ring when the pull request is merged, rather than that it is already live, because the merge is a separate manual step. It also carries the assigned entry id, which is the value the widget's `site-id` must match and the handle needed at `/update` later. Delivery is attempted, not required: a bounced notification cannot undo an approval whose pull request is already open, which is the opposite of the rejection path, where delivery gates the delete because it is the last chance to say anything at all.

## 6. Validation Rules

- `source_url` must be a valid, reachable URL at submission time.
- `tags`: at least one. Now enforced by the schema (`minItems: 1`) rather than by this sentence alone. An untagged entry is invisible to the tag filters and to the tag list in Settings, so it would join the ring already unfindable by every route except scrolling past it.
- `tracks` array: max length 3 for type audio. Reject or truncate with a clear message if exceeded, do not silently drop entries.
- `artworks`: one to three for Art. Every work requires an external `image_url` and meaningful `alt`; `title`, `year`, `medium`, and a work-level `external_url` are optional.
- `media_url`, `image_url`, `preview_url`, `thumb_url`: must not point at IndieNodes's own domain. This enforces the no-rehosting principle at the data layer, not just as a policy statement. Now encoded in the JSON schema as a shared `$defs/externalMediaUrl`, which means `npm run validate:publish` rejects a violation on every entry, including ones added by hand, rather than the rule depending on the form being the only way in. The form and the backend check it too; the schema is the backstop, not the only line.
- `trailer_url`: optional for games, HTTPS YouTube URLs only. It remains separate from `preview_url` so old direct clips stay compatible and third-party embeds remain explicit.
- `eula_agreement` must be checked before the submit action is enabled. Disable the submit button rather than validating on click, so the requirement is visible before the attempt. `rights_confirmation` is also collected but does not gate Continue or Submit — its wording is necessarily written toward one kind of work and reads oddly for the others (Section 3), so the general EULA (Section 4), which every type can equally agree to, is the one actual gate.
- `pro_membership_name` is required only if `pro_membership` is "Other."

## 7. Architecture: Where This Runs

Section 5 asks the system to generate a `verification_token`, run an automated reachability check against `source_url`, hold a submission privately (including `email`) until a human reviews it, and only then open a pull request carrying the public subset of the data. None of this has an obvious home: the brief's tech stack (Section 4 of `IndieNode_v2_Brief.md`) locks static site generation with "no required backend for the reader or widget," and the only server named anywhere is the Docker/Semaphore/Ansible pipeline that builds and deploys `ring.json` once an entry is already approved.

**Decided: an n8n workflow, separate from the publishing pipeline, handles intake, the check, and the review queue.** The browser posts to one webhook. It writes nothing to `ring.json` directly, and it is not where the PR gets merged either; see below.

This keeps the reader-and-widget promise intact on its own terms: the workflow serves only the submission funnel, which nobody needs to have running to browse the ring, play its audio, or embed the widget. Extending the publishing webserver itself was the alternative and was rejected, specifically because that would make a service that currently only handles deploys load-bearing for intake too, which is a bigger claim on "no required backend" than the brief currently makes.

**The site's half of this is one build-time variable, `VITE_SUBMISSION_WEBHOOK_URL`, and one `fetch`.** The name is deliberately vendor-neutral: the contract is "POST JSON, read JSON back," and nothing in the client knows or cares that n8n is on the other end. Because the site is `adapter-static` with `prerender = true` set globally, this call goes from the browser to n8n directly; there is no server in this repo to proxy it through, and adding one would break the static build outright. The consequence to hold onto is that the URL is public, in the client bundle, by design. It is not a credential. Every abuse control lives on the n8n side.

**Actions are multiplexed over the one webhook**, discriminated by an `action` field rather than split across separate URLs, so there is one CORS configuration to get right and one variable to rotate. The four below are the ones this spec covers; node maintenance and the rating prompt have since added four more, and **`docs/n8n-workflow-runbook.md` §2.2 is the authoritative list** — this table is the original submission contract, not the current full surface:

| Action            | Sent                                                                 | Returned                                            |
| ----------------- | -------------------------------------------------------------------- | --------------------------------------------------- |
| `issue_token`     | `source_url` (nullable), `type`, honeypot, dwell                     | `submission_id`, `verification_token`, `expires_at` |
| `bind_source_url` | `submission_id`, `source_url`                                        | `bound`                                             |
| `verify`          | `submission_id` only                                                 | `verified`, and a `reason` when false               |
| `submit`          | `submission_id`, the Section 2.1 entry, the Section 2.2 review block | a reference for the submitter                       |

**`issue_token`'s `source_url` is nullable as of v0.5**, for the site-generator branch: the token has to exist and be embedded in the export before the creator has anywhere to point `source_url` at. **`bind_source_url` is new as of v0.5** and is that branch's second half, attaching a real `source_url` to a submission whose token was issued without one. It is its own action rather than a second call to `issue_token` with a URL this time, so the backend can enforce "accepted once" server-side: allowing `issue_token` to be called twice for one submission would let a submitter mint a token against one URL and then quietly retarget it, which is exactly the hole the paragraph below closes for `verify`.

`verify` sends only the `submission_id` on purpose. n8n holds the token _and the `source_url` it was issued against (via `issue_token` directly, or `bind_source_url` for the no-site branch)_, and checks that stored URL rather than one the client supplies at check time. If it trusted a URL sent alongside the request, a submitter could verify a page they control and submit a different one, and the whole step would be decorative. For the same reason the check is re-run server-side at `submit`, not merely looked up.

**Decided: the pull request is the last step, not the review mechanism.** The earlier version of this section had a passing submission become a PR immediately, with a human reviewing it there. That is no longer the design, specifically because of `email`: a PR is public the moment it opens, and `email` must never be. So a passing submission instead lands in a private review queue, a human reviews everything (including `email`) from inside that queue, and only _approval_ causes a PR to be opened, at which point it is built from just the `ring.json`-shaped fields (Section 5, steps 5-7). The PR survives in this design because it is still the right tool for what it is now used for: a human looking over one JSON object before it joins a public, versioned file, which is exactly what a PR review is for. It just no longer needs to be the surface where `email` also happens to sit.

**Decided: the review queue lives inside n8n, and the maintainer's surface is a notification, not a page.** This was flagged in v0.3 as a real second surface that should not be assumed to come for free. It was decided on its own terms and it does come for free, because the platform chosen for intake already has both halves. n8n holds the pending submission; approval and rejection arrive as signed one-time links in a Discord message or email. There is no database and no protected admin page. A datastore plus a browsable admin table was the alternative and was rejected as disproportionate: this is a ring reviewing entries one at a time, not a queue deep enough to need filtering.

That choice also makes Section 5 step 7 enforceable rather than merely stated. The same workflow run that opens the PR strips and deletes the whole Section 2.2 block, so no window exists in which the queue still holds an email for a submission that has already gone public, and no separate cleanup job has to be trusted to run later.

**One tension to record rather than paper over.** Section 5 step 9 says nothing about a rejected submission is retained past rejection, while rate limiting and duplicate detection need memory by definition. Resolved by keeping only a salted hash of `source_url` plus a timestamp: enough to recognize a repeat, not enough to reconstruct who submitted what.

**Resolved, see `decisions.md`:** how the workflow authenticates to open a PR, and whether the resulting PR still needs a second, separate merge click from a maintainer given one already approved the submission a step earlier in the queue — a fine-grained PAT scoped to this repo, and yes, the merge click stays manual. See `decisions.md`'s "LOCKED: PR authentication..." entry and `docs/n8n-workflow-runbook.md` for the mechanics.

## 8. Out of Scope for This Spec

The reasoning behind why PRO licensing is deferred at POC stage, session thresholds that would change that, and the internal risk position are documented separately and intentionally kept out of this file and out of the repo. This spec exists to build the form, not to explain the legal posture behind it.
