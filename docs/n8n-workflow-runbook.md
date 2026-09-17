# IndieNodes v2 — n8n Workflow Runbook

**Version:** v2.0
**Status:** Reference for the system as built. Not a build guide — the workflows exist.
**Scope:** How the deployed n8n workflows behind `VITE_SUBMISSION_WEBHOOK_URL` and `VITE_CONTACT_WEBHOOK_URL` actually work. Companion to `docs/submission-form-spec.md` (what and why) and `docs/decisions.md` (locked decisions).

**The workflows are generated, not hand-built.** `scripts/n8n/build_workflows.py` emits every
one of them and pushes them through the n8n API. Editing a workflow in the n8n UI works until
the next push, which silently reverts it — change the generator instead. `scripts/n8n/README.md`
covers running it. v1.0 of this document described building them by hand in the UI; that is no
longer how any of this is maintained.

Two decisions from `decisions.md` remain fixed constraints:

- The GitHub calls authenticate with a **fine-grained Personal Access Token scoped to this repository only** (`Contents: Read & Write`, `Pull requests: Read & Write`), stored as an n8n credential.
- Opening the PR is n8n's job. **Merging it is not** — that stays a manual human click, gated by `indienodes-ring`'s `validate-ring.yml` CI check.

---

## 0. Instance constraints that shape every workflow

These were measured against the live instance on 2026-08-22, not assumed. Each one caused a
real bug before it was known; the workflows are built around them.

**The Code-node sandbox is narrower than Node.** Available: `Buffer`, `TextEncoder`, `RegExp`,
`JSON`, `Date`, `Intl`. **Not** available: `URL`, `URLSearchParams`, `crypto`, `fetch`,
`process`.

This is not a style preference. A `new URL()` inside a `try/catch` does not fail loudly — it
throws `ReferenceError` and the catch swallows it. The v1 Review Action did exactly that, so
`creator_id` was never once assigned to any approved node, invisibly, for the life of the
system. All URL parsing is now done by hand. `scripts/n8n/test_code_nodes.mjs` runs every
generated Code node with those globals denied so the class of bug fails locally in a second.

**Data Table filters OR their conditions.** Two conditions on one filter match rows satisfying
_either_, in either order; `matchType: "allFilters"` does not change it.

| Filter                        | Rows matched  |
| ----------------------------- | ------------- |
| `sid=AAA` + `status=verified` | AAA, BBB, CCC |
| `status=verified` + `sid=AAA` | AAA, BBB, CCC |
| `sid=BBB` alone               | BBB           |

So a conditional update of the form "`submission_id` = X **and** `status` = verified" is **not
expressible** — written that way it is a table-wide write wearing the costume of a conditional
one, and it will overwrite every row matching either term. **Every Data Table filter in this
system uses exactly one condition.** Atomic claims use the marker pattern in §5 instead. Prove
any new destructive Data Table pattern against a scratch table before pointing it at
`submissions`.

**Crypto node defaults.** `action` defaults to `hash` and `type` to `SHA256` on this instance.
Both are set explicitly everywhere regardless — a security check must not rest on a default
that can move across an upgrade.

**Sub-workflows must be published before their callers can activate.** n8n refuses to publish
a workflow whose Execute Workflow node targets an unpublished sub-workflow, so helpers activate
first. Safe: a helper has only an Execute Workflow trigger and no webhook.

**`callerPolicy: workflowsFromAList` with an empty `callerIds` blocks every caller.** The
generator omits the policy entirely until at least one named caller exists.

**`neverError: true` only suppresses HTTP status errors.** DNS and TCP failures still throw, so
every outbound HTTP node also sets `onError: continueErrorOutput`.

---

## 1. Changing any of this

```bash
python3 scripts/n8n/build_workflows.py --list
python3 scripts/n8n/build_workflows.py --dry-run --only token-lifecycle
python3 scripts/n8n/build_workflows.py --push
node scripts/n8n/test_code_nodes.mjs      # run before every push
python3 scripts/n8n/build_workflows.py --export         # after every push
python3 scripts/n8n/build_workflows.py --check-drift    # did the last change ship?
```

`--check-drift` compares the generator's code nodes against `backups/`, and `.githooks/pre-push`
runs it on every push. Red means the generator has moved and n8n has not — the live workflows are
still running the previous version of that code, and `--push` + `--export` is the fix. It is
network-free: it never asks n8n anything, it only checks that the two committed halves agree.

This check exists because the suite above cannot catch that case. `test_code_nodes.mjs` runs the
code nodes straight out of `build_workflows.py`, so it passes on a rule that has never been
pushed. That is how the relaxed consent gate committed on 2026-09-09 stayed unpushed until
2026-09-12 with 307/307 green, rejecting every submission from a creator who is not a PRO member
with "That submission was not valid." Tests prove the generator is right; only the export proves
it shipped.

Raw backups of the eight live workflows live in `scripts/n8n/backups/` (checked in, not
gitignored) — see that directory's own README for what they're for and how to restore from one.
The Data Table schemas live in `scripts/n8n/data-tables-schema.json`; if a table is ever deleted,
`python3 scripts/n8n/build_workflows.py --create-tables` recreates any missing one from it. Both
exist because of the same incident: `submissions` was deleted by accident on 2026-08-23 and had
to be manually reconstructed before production came back.

The API key is read from `~/.n8n-api-key` (mode 600, never committed). Write it with `printf`,
not `echo` — a trailing newline lands inside the auth header and produces a 401 that looks
exactly like a wrong key.

`--push` runs two passes. A caller allowlist can only name workflows that already exist, so a
helper pushed before its caller ends up refusing it; the second pass re-resolves every
allowlist once all IDs are known. `N8N_EXTRA_CALLERS=<id>` temporarily admits a test harness.

v1.0 of this document was a build guide for assembling these by hand in the n8n UI. That is no
longer accurate and following it would produce a different system.

---

## 2. Contract reference — what the client actually sends

This is the ground truth the workflow must match exactly. It's pulled from the shipped client code (`src/lib/submissionApi.js`, `src/lib/contactApi.js`, `src/lib/webhookClient.js`), not restated from the spec, because the spec's own action table (`submission-form-spec.md` §7) predates the `/update` flow and `rate_status`, and only lists four of the seven submission actions.

### 2.1 Response envelope (applies to every webhook below)

Every "Respond to Webhook" node, on every branch including failures, must return a body matching this shape (`webhookClient.js`):

- **Success:** any 2xx status, JSON body, not `{ ok: false }`. The specific success fields differ per action (below).
- **Failure:** either a non-2xx status, or a 2xx body containing `{ ok: false }`. Either way, include `{ error: { message, code, retryable } }`. `message` is shown to the user; `code` is a short machine string (e.g. `rate_limited`, `invalid_token`, `already_bound`); `retryable` is a boolean the client uses to decide whether to offer a retry button.
- A non-JSON body is treated as failure regardless of status code, so every branch must return JSON, never a bare 4xx/5xx with no body.
- The client times out at 15 seconds — nodes doing external HTTP calls (the reachability check, GitHub API calls) should fail fast rather than let the whole request hang.

### 2.2 Submission webhook — eight actions, one URL, discriminated by `action`

Points at `VITE_SUBMISSION_WEBHOOK_URL`. Actions entered directly from a form carry `website`
(honeypot — a hidden field a real submitter never fills; non-empty means drop silently) and
`elapsed_ms` (dwell time since the form was first rendered; too low means drop silently), as the
table shows. The two continuation actions, `bind_source_url` and `verify`, deliberately carry
neither: they are tied to the server-side row created by `issue_token`. `rate_status` carries
neither either, for a different reason — it is asked before the visitor has spent any dwell time
at all (see its own row below). The intake bot gate must therefore run only for actions whose
table row includes those fields; treating an absent dwell value as suspicious on every action
silently drops every legitimate continuation request.

| Action                 | Sends                                                                             | Returns                                                     |
| ---------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `issue_token`          | `{ source_url: string \| null, type, website, elapsed_ms }`                       | `{ submission_id, verification_token, expires_at }`         |
| `bind_source_url`      | `{ submission_id, source_url }`                                                   | `{ bound: boolean }`                                        |
| `verify`               | `{ submission_id }` — **never a URL**                                             | `{ verified: boolean, reason?: string }`                    |
| `submit`               | `{ submission_id, entry, review, website, elapsed_ms }`                           | `{ reference: string }`                                     |
| `request_update_token` | `{ node_id, website, elapsed_ms }`                                                | `{ submission_id, verification_token, expires_at }`         |
| `submit_update`        | `{ submission_id, node_id, entry, email, website, elapsed_ms, turnstile_token? }` | `{ reference: string }`                                     |
| `request_removal`      | `{ submission_id, node_id, reason?, website, elapsed_ms, turnstile_token? }`      | `{ reference: string }`                                     |
| `rate_status`          | `{ source_url }`                                                                  | `{ blocked: boolean, retry_after_seconds: number \| null }` |
| `check_media_url`      | `{ url, kind?: 'image' \| 'preview', website, elapsed_ms }`                       | `{ accepted: boolean, verdict: string }`                    |

Notes that change how you build this:

- `issue_token`'s `source_url` is nullable — the site-generator branch (a creator with no site yet) mints a token before any URL exists to embed it at. `bind_source_url` is that branch's second half, attaching a real URL to the same `submission_id` afterward. It must reject (not silently overwrite) a second bind attempt on an already-bound submission — see §4's `bind_source_url` branch.
- `verify` sends only `submission_id`. **The workflow must resolve `source_url` from its own stored state, never from the request.** If the workflow trusted a client-supplied URL here, a submitter could verify a page they control and then submit a different one — the whole check becomes decorative. This is the single most load-bearing rule in this entire document; every branch that touches a URL (`verify`, `submit`'s re-check, `request_update_token`) must resolve it server-side.
- `entry` (in `submit` and `submit_update`) is the full `ring.json`-shaped object per `schema/ring.schema.json` (§2.3 below), with `id`/`creator_id` excluded (the workflow assigns those at approval, §9). `review` (in `submit`) is the Section 2.2 block: `email`, `rights_confirmation`, `pro_membership`, `pro_membership_name`, `eula_agreement`, plus the content-rule attestations `ai_attestation`, `adult_content` (`'yes' | 'no'`) and `adult_content_confirmation`. `submit_update` carries its own `review` with the four attestation fields (`ai_attestation`, `rights_confirmation`, `adult_content`, `adult_content_confirmation`) beside its top-level `email`, so an update cannot skip them. `request_removal` has none. Whether they are required is `CONTENT_ATTESTATIONS_REQUIRED` (§12).
- `request_update_token`/`submit_update`/`request_removal` are keyed by an existing `node_id`, not a new submission. The workflow must fetch the node's **current** `source_url` from the live `ring.json` itself (not from anything the client sends) to check the token against — same reasoning as `verify`.
- `turnstile_token` is optional and appears **only** on `submit_update`, `request_removal`, and the Contact webhook — `issue_token`/`verify`/`submit` on `/join` are not Turnstile-guarded at all. Don't add a Turnstile check to those three actions; the client never sends a token for them.
- `rate_status` (added 2026-08-31) is a **read-only** pre-check: whether a fresh `submit`/`submit_update`/`request_removal` for this `source_url` would be rate-limited right now, asked from `/update`'s identify step as soon as a node is found — before the visitor has invested time in the form or a Turnstile challenge only to be told to come back later. It reads the same `rate_limits` bucket §5's rate limiting describes but never writes to it, and it has none of `resume`/`is_removal`'s exemptions (it doesn't yet know which the visitor will end up doing), so it can occasionally say "blocked" a beat before the real gate at actual submit time would exempt it. That's intentional — it's advisory, never the gate; the client treats a failure to reach it as "nothing to show," not an error.
- `check_media_url` (added 2026-09-12) asks whether a typed media URL is really an image — the check that would have stopped ring PR #30's `?pg=29#showComic` reader-page URLs. Bot-gated like `issue_token`, because it makes an outbound request on the caller's behalf. `verdict` is one of `ok | html | not_image | redirect | unreachable | unsafe_url` and nothing else is ever returned (no status, content type or body). Like `rate_status` it is a courtesy: `submit`/`submit_update` and approval run the same check again (§6a), and the form treats no answer as "nothing to show". A `submit` refused this way carries `error.field` (e.g. `pages.0.image_url`) and a specific `error.message`.

### 2.3 Contact webhook — one action, no envelope discriminator

Points at `VITE_CONTACT_WEBHOOK_URL`, a **separate URL** from the submission webhook (so it can be paused/rotated independently). No `action` field — this webhook does exactly one thing.

Sends `{ name, email, message, website, elapsed_ms, turnstile_token? }`. Returns `{ reference: string }` on success, same failure envelope as §2.1 otherwise.

### 2.4 Rating webhook — one action, no envelope discriminator

Points at `VITE_RATING_WEBHOOK_URL`, a **third separate URL** from the other two, for the same reason Contact is separate from the submission one: unrelated concern, unrelated failure mode, and switching rating collection off should not touch either of the others. No `action` field — this webhook does exactly one thing.

Sends `{ rating, submitted_at, app_version, website, elapsed_ms }`. **No identifier of any kind**, and no Turnstile: the honeypot/dwell pair plus a once-per-device local flag is the whole abuse story for a single integer.

Returns `{ ok: true }`. The client ignores the response entirely and never surfaces a failure — nobody is waiting on an answer, and a rating that fails to send is simply lost by design.

### 2.5 `ring.json` entry shape (for `entry`, and for the PR content built in §10)

**`schema/ring.schema.json` is the authority for this, and this section deliberately no longer restates its `required` list** — the copy that used to sit here had already drifted, omitting `joined_at` and referring to `verification_token` only as "a legacy optional schema property" without naming it. What matters here is the two properties the workflow depends on rather than the field inventory:

`type` is `audio|comic|text|game|art`, and the conditionally-required media array follows from it (`pages` for comic, `excerpts` for text, `artworks` for art, `thumb_url` for game). And `additionalProperties: false` rejects anything not in the schema, which is what makes the allowlist approach in §9 safe: an accidental leak of a review-only field fails `npm run validate:publish` in the ring repo's CI, not just a policy.

`verification_token` is **required** by the canonical schema and **is published**: approval copies the row's token — the one `verify` checked — into the member file, and refuses to open a PR without one. It is the same value already public in the creator's `<meta name="indienode-verification">` tag, and `indienodes-ring`'s `member-health.js` reads it to confirm that tag is still there. It was dropped from approvals on 2026-09-02 (`830395f`) without the schema changing, so every PR since failed `validate:publish` until ring PR #30 was repaired by hand; restored 2026-09-12.

Media URLs (`media_url` inside `tracks`, `image_url` inside `pages`, `thumb_url`, `preview_url`) must be `https://` and must not resolve to the `indienodes.us` domain — the schema's `externalMediaUrl` `$def` enforces this. Nothing in the workflow needs to duplicate that check; it's the CI gate's job to catch a violation, not the workflow's. What the schema **cannot** check is whether an image URL serves an image; that is §6a's job.

---

## 3. Workflow inventory

Nine workflows. The v1 system had eleven; four token actions merged into one workflow and
two submit actions into another, because in each case they were one state machine split across
several graphs. Contact is the eighth and stands apart from the submission pipeline entirely —
its own webhook, no storage, no shared state (§11).

| Workflow                                    | ID                 | Nodes | Owns                                                                                       |
| ------------------------------------------- | ------------------ | ----: | ------------------------------------------------------------------------------------------ |
| Webring - Intake v2                         | `lUd8H2AQLwHgpx3z` |    14 | The public webhook. Validation, bot gate, routing, `rate_status` read, one response shape. |
| Webring - Token Lifecycle v2                | `FGJT1bkhNBjNUjdV` |    27 | `issue_token`, `request_update_token`, `bind_source_url`, `verify`                         |
| Webring - Action - Finalize Submission v2   | `WjimdnD3ATuotLGX` |    30 | `submit`, `submit_update`, `request_removal`                                               |
| Webring - Helper - Re-verify Token v2       | `FtLH2sf84rtyiEz4` |     6 | The SSRF boundary for the creator's page (`source_url`)                                    |
| Webring - Helper - Check Media URL v2       | _not yet pushed_   |    13 | The SSRF boundary for typed media URLs: HEAD / ranged GET, `image/*` required (§6a)        |
| Webring - Helper - Review Link Signature v2 | `7wu0t1GVk6zurL2x` |     4 | HMAC-SHA256 sign **and** verify                                                            |
| Webring - Review Action v2                  | `ZEWLoY146ecZDENP` |    58 | Signed approve/reject links → GitHub PR (incl. removal)                                    |
| Webring - Error Workflow                    | `YNJ5lpAUJnLH70Ko` |     2 | Failure metadata, allowlisted                                                              |
| Webring - Contact v2                        | `8VYg8aZ7owilxxgb` |    15 | `/contact` messages. Own webhook, no storage, Gotify with mail fallback                    |
| Webring - Rating v1                         | `w7GHL1sei1QNKiCf` |    10 | One-time app rating. Own webhook, Gotify only, `ratings` table                             |

IDs are instance-specific. Confirm them before pushing the generator anywhere else.

**Why the four token actions share a workflow.** They are four unauthenticated public actions
operating on one `submissions` row while it sits in `pending_verify`, sharing an expiry rule,
an error vocabulary and a response envelope. Split across four workflows, the
`pending_verify`-only precondition lived in none of them — which is how v1's `verify` came to
re-mark an already-approved row as `verified`, letting a submission be replayed into a second
PR.

**Why signing and verifying share a workflow.** v1 had the signer in one workflow and the
verifier inlined in another: two copies of one algorithm, free to drift. They did — the
verifier relied on a default `type` the signer set explicitly. One helper with a
`mode: sign | verify` input makes that class of drift impossible.

**Boundaries that stay isolated:** SSRF egress (Re-verify, Check Media URL), secret handling (Signature), and
the GitHub PAT (Review Action, entirely off the public router).

---

## 4. Request path

```
POST /webhook/indienodes-submit
  → validate + classify        one Code node: body shape, action, honeypot, dwell
  → Switch  token | final | dropped | status | error
      token   → Token Lifecycle v2
      final   → Finalize Submission v2
      dropped → fake success, shape-correct per action, nothing allocated
      status  → rate status: prep → hash → get rows → decide (read-only, no bot gate)
      error   → unsupported_action / invalid_request
  → Respond (shared)
```

**Every failure path returns JSON, fast.** v1 could hang: its honeypot compared
`body.elapsed_ms` numerically under strict type validation, so a missing or wrong-typed field
threw, and with no node anywhere setting `onError` the throw aborted the run before any Respond
node fired. The browser then sat until `webhookClient.js`'s 15-second timeout and reported a
permanently malformed request as a _retryable_ timeout. All validation now happens in one Code
node that cannot throw on a missing field, the Switch has a fallback output, and both Execute
Workflow nodes route errors to a responder. Measured: every failure path under 0.5s.

An unparseable JSON body is rejected by n8n's webhook layer with a 422 before the workflow
runs. That is fine — the body is JSON, so `webhookClient.js` produces a non-retryable
`http_422` rather than hanging.

**CORS** is set on the Webhook node's `allowedOrigins`, scoped to `https://app.indienodes.us`
(matching `SITE_ORIGIN` in `src/lib/config.js`) plus `http://localhost:5173`. The node defaults
to `*`; the production origin is known, so it is named. The browser deliberately sends
preflighted JSON, so OPTIONS must be answered — verified from both an allowed and a disallowed
origin.

---

## 5. Storage and the status model

Two n8n Data Tables: `submissions` and `rate_limits`. Columns are unchanged from v1.0; the
authoritative record of them is now `scripts/n8n/data-tables-schema.json`, not this document —
see §1 for what that file is and how to recreate a table from it if one is ever lost. What
changed since v1.0 is the status model and how rows are written.

**There is no longer a `config` table.** Every value it held moved somewhere that suits it
better: secrets to credentials (where they are encrypted at rest and never enter the item
stream), non-secrets to generator constants (where they are version-controlled and reviewable in
a diff, like `GITHUB_REPO` and `INTAKE_ALLOWED_ORIGINS` always were). The table was a v1 habit
nothing else in the system followed, and it was actively harmful: reading a secret out of it
necessarily copied that secret into an item, which is how the rate-limit salt came to appear in
every execution record.

### Status transitions

```
pending_verify ──verify──> verified ──submit──> pending_review ──approve──> approved
      │                                              │
      │                                              ├──reject──> (row deleted)
      │                                              └──notify fails──> notification_failed
      │                                                                      │
      └──expired (24h, enforced)                                    (resumable: retry submit)

transient, held only inside one execution:
  claiming-<execution id>    Finalize Submission's claim
  reviewing-<execution id>   Review Action's claim
  approval_failed            GitHub step failed; nothing published; resumable
```

### Preconditions — enforced, not documented

| Action                     | Required current status                         |
| -------------------------- | ----------------------------------------------- |
| `bind_source_url`          | `pending_verify`, and `source_url` still empty  |
| `verify`                   | `pending_verify` **only**                       |
| `submit` / `submit_update` | `verified`, or `notification_failed` (resume)   |
| `request_removal`          | `verified`, or `notification_failed` (resume)   |
| approve / reject           | `pending_review`, or `approval_failed` (resume) |

`verify` having no precondition in v1 is the replay hole: a `pending_review` or `approved` row
could be reset to `verified` and finalised again — a second reviewer notification, and for an
approved node a second PR against the same member file.

### Atomic claims

Data Table filters cannot express a conditional update (§0), so both claims use an optimistic
marker, filtered on the unique key alone:

1. Stamp `status = claiming-<execution id>` (or `reviewing-`) filtered on `submission_id`.
2. Read the row back.
3. Proceed only if the marker still reads as this execution's.

Last write wins, so exactly one concurrent run sees its own marker; the others fall through to
`already_submitted` / "already resolved". A previous read is not a lock, and neither is a
multi-condition filter.

### Rate limiting

Inlined into Finalize Submission — after the submit merge it had one caller. **HMAC-SHA256** of a canonicalised `source_url` (lowercased host, default port, trailing slash
and fragment stripped), keyed by a `crypto` credential, ten-minute window (`RATE_LIMIT_WINDOW_SECONDS`
in the generator — shortened 2026-08-31 from sixty minutes now that Turnstile carries the
bot-defense job this window used to carry alone; its remaining job is bounding how often one
source can add a fresh row to the human review queue). It was previously
`SHA256(salt + "|" + url)` with the salt read from the config table — which put the salt into
`hash_input` on every submission, and therefore into every execution record. The key now
resolves inside the Crypto node and never becomes data.

`Webring - Intake v2`'s `rate_status` action (§2.2) reads this same bucket, read-only, from
`/update`'s identify step — so a visitor learns they're inside the window before filling out the
form, not after.

v1 read the **oldest** matching row, so once that aged past the window every later check passed
and the limiter silently stopped working an hour after the first submission. It now evaluates
the newest. A resume from `notification_failed` bypasses the limiter — a submitter should not
be charged for a failure that was ours.

Fails closed if `rate_limit_salt` is missing rather than hashing the raw URL unsalted, which
would make every stored hash a reversible lookup.

---

## 6. Ownership verification and the SSRF boundary

`Webring - Helper - Re-verify Token v2` is the only workflow that fetches an address a stranger
chose. Called by Token Lifecycle (`verify`) and Finalize Submission (re-check at submit time),
`callerPolicy` restricted to exactly those two.

Input: `source_url`, `verification_token`, `expires_at`.
Output: `matched: yes|no` plus
`reason: matched | expired | unsafe_url | unreachable | redirect | token_not_found | unresolvable | unsafe_resolved_ip`.

Order matters: **expiry is checked before any outbound request**, so an expired row never
causes a fetch.

Rejected before the fetch: non-`http(s)` schemes; embedded credentials; whitespace, control
characters and backslashes (parser-confusion input); loopback, `0.0.0.0/8`, `10/8`,
`172.16/12`, `192.168/16`, CGNAT `100.64/10`, link-local `169.254/16` including cloud metadata,
multicast and reserved; IPv6 loopback, unique-local `fc00::/7`, link-local `fe80::/10` and
mapped forms; `localhost`, `.local`, `.internal`, `.home.arpa`, `metadata.google.internal`;
obfuscated numeric IPs (`2130706433`, `0x7f000001`, `0177.0.0.1`); non-ASCII hosts, which must
arrive already punycoded. This range-check logic (`isUnsafeIPv4`/`isUnsafeIPv6`) is written once
in Python (`IP_RANGE_CHECK_JS`) and interpolated into both `validate url + expiry` and
`classify resolved ips` below, so the two never restate the ranges and drift apart the way
`slug.js` and this file's own id-derivation copy once did (see `decisions.md`).

**A hostname is resolved before it is trusted.** Only a literal IP can be range-checked directly
— a name has nothing to check until it resolves to one. `validate url + expiry` routes any
`source_url` whose host is a name (not a literal IPv4/IPv6 address) to `proceed: 'check_dns'`
instead of deciding it there. Three new nodes handle that path: `resolve A` and `resolve AAAA`
query `dns.google`'s DNS-over-HTTPS JSON API (a fixed, non-attacker-controlled destination — no
new SSRF surface), and `classify resolved ips` rejects the host if any returned A/AAAA record
falls in a private, loopback, link-local, CGNAT, multicast, or metadata range, or if neither
query resolves at all (`unresolvable`). This closes the gap a security review found: previously
a hostname's own DNS answer was never checked, so `attacker-domain.example` with an A record
pointed at `169.254.169.254` passed validation untouched — no rebinding timing needed, a single
DNS record was enough. **Residual, accepted risk:** a small window still exists between this
DNS-over-HTTPS lookup and `fetch source_url`'s own independent resolution (classic TOCTOU/DNS
rebinding) — true IP-pinning (fetching the literal resolved address with a `Host` header
override) is not realistically achievable through n8n's stock `httpRequest` node for HTTPS
targets without breaking TLS SNI/certificate-hostname validation. The value of this fix is
closing the zero-timing-required bypass via a plain DNS name, not eliminating rebinding
outright.

**Redirects are not followed.** This is the single most important line in the workflow:
following them lets an attacker bypass every check above by serving a 302 to
`169.254.169.254` from a domain that validates cleanly. The cost is that a creator must supply
the canonical URL — which is what belongs in `ring.json` anyway. A 3xx returns
`reason: redirect` so they are told to use the final URL, not that their tag is missing.

The meta tag is located with the **`html` node** (`extractHtmlContent`, selector
`meta[name="indienode-verification"]`, returning the `content` attribute) rather than a regex.
The regex it replaced required quoted attribute values, so HTML5-legal `content=abc` failed
verification and the creator was told their tag was missing. The node **replaces** the item with
its extraction, so `statusCode` is read from the fetch node by reference.

Reachability failure is reported distinctly from a reachable page without the token. v1 scanned
a 404 error page's body for the meta tag and reported `token_not_found`, telling creators to
check their tag when their site was down.

**Still required at the infrastructure layer:** the egress proxy in §6b. The DNS-over-HTTPS
resolution above closes the untimed, single-DNS-record bypass, but `fetch source_url` resolves the
name again on its own. No timing is needed to exploit that: an attacker's authoritative server
can simply answer Google's resolver with a public address and n8n's resolver with a private one.
Only a proxy that resolves the name itself and applies the range check to _that_ answer closes
it.

The IP-literal check itself parses IPv6 into its eight groups (since 2026-09-17). The earlier
text-prefix test passed `[0:0:0:0:0:0:0:1]`, `[0::1]` and the IPv4-mapped
`[0:0:0:0:0:ffff:a9fe:a9fe]` (169.254.169.254) straight through, because the fetch normalises
those spellings to loopback and metadata addresses.

---

## 6a. Media URL check

`Webring - Helper - Check Media URL v2` answers one question about one URL: is it really an
image? Ring PR #30 is why: a comic went out with reader-page URLs
(`https://frammyjammy.com/suzu-and-jack/?pg=29#showComic`) in `pages[].image_url`, which pass
every schema rule because nothing about their shape is wrong. Called by Intake
(`check_media_url`), Finalize Submission (every media field, before re-verify and before the
claim) and Review Action (again, before any GitHub call); `callerPolicy` restricted to those three.

Input: `url`, `kind` (`image`, or `preview` for a game preview, which may also be `video/*`),
`field`, `label`. Output: `ok: yes|no`, `verdict: ok | none | html | not_image | redirect |
unreachable | unsafe_url`, and the `field`/`label`/`kind` it was given.

- **The same SSRF guard as §6, tightened.** `SAFE_URL_JS` and `DOH_VERDICT_JS` are the §6 checks,
  written once and interpolated into both helpers. On top: `https` only, and no port other than
  443, so the public action cannot be used to probe services on a host. Redirects are not followed.
- **A web-page extension (`.html`, `.htm`, `.xhtml`) is refused without a request.** An image
  extension is never trusted: those URLs are always fetched.
- **HEAD first**; a `GET` with `Range: bytes=0-1023` only when HEAD is refused
  (400/403/405/406/501) or answers without a content type. A transport failure is `unreachable`
  without a second attempt, to keep finalize inside the form's 45s submit timeout.
- **`image/*` is required** (`video/*` also for a preview). `text/html` and
  `application/xhtml+xml` are `html`; anything else, `application/octet-stream` included, is
  `not_image`.
- **Only a verdict word leaves the helper**, and Intake returns only `{ accepted, verdict }`.
  Status codes, content types and bodies are never reflected to a caller.

In Finalize and Review Action the helper runs once per media field (Execute Workflow
`mode: each`, at most `MAX_MEDIA_URLS` of them) with `onError: continueRegularOutput`, so a helper
failure is an item on the one output that `MEDIA_VERDICT_JS` refuses; an error _output_ would split
the items and run the verdict node twice. A refusal at finalize returns a `media_*` error code with
the field and a specific message; at approval it marks `approval_failed` and tells the maintainer
which field failed, before any branch or PR exists.

**Residual, accepted risk.** The same DNS-rebinding window as §6. The `check_media_url` action
lets an anonymous caller (past the honeypot/dwell gate) have n8n request a public https URL and
learn a one-word verdict. The ranged GET has no response-size ceiling in the HTTP node, so a server
that ignores `Range` can send a whole file. `MEDIA_FETCH_TIMEOUT_MS` does **not** bound that: the
HTTP node's timeout covers only the wait for response headers. The egress proxy in §6b closes the
rebinding window and bounds the body by time.

---

## 6b. Egress proxy (infrastructure)

**Status: on hold (2026-09-17).** The Squid design below is not deployed; the approach is under
review, and a different mechanism may replace it. Until something is deployed, the rebinding
window described in §6 is open. `EGRESS_PROXY_URL` stays `""`, and it works with any HTTP
forward proxy that applies the range check to its own resolution, not only this one.

This n8n instance is shared with LAN automations (Gotify, its database, local AI, Home Assistant,
Nextcloud), so private ranges cannot be firewalled off the whole container. Instead, the three
requests to a stranger-chosen address go through a dedicated forward proxy whose ACL refuses
private destinations after resolving the name itself: `fetch source_url` (§6), and `HEAD media`
and `GET media (ranged)` (§6a). Everything else in n8n keeps its direct network access.

The routing is one constant, `EGRESS_PROXY_URL` in `build_workflows.py`. While it is `""`, the
generated workflows are unchanged. `test_code_nodes.mjs` pins that exactly those three nodes, and
no others, pick it up once it is set. **Set it only after the proxy passes the checks below:** with
a proxy n8n cannot reach, every verification answers `unreachable`.

### Compose

Squid (`ubuntu/squid`, maintained by Canonical), attached to two networks:

- **`egress-client`** is `internal: true`: no route anywhere, shared with n8n only.
- **`egress`** is the proxy's only way out.

Because the client network has no gateway, n8n cannot bypass the proxy on that network, and the
proxy's default route is the egress network.

```yaml
services:
  n8n:
    # ...existing definition...
    networks:
      - default # list every network n8n already uses; adding `networks:` drops the implicit default
      - egress-client

  n8n-egress:
    image: ubuntu/squid:6.6-24.04_beta
    restart: unless-stopped
    volumes:
      - ./egress/squid.conf:/etc/squid/squid.conf:ro
    networks:
      - egress-client
      - egress
    mem_limit: 256m

networks:
  egress-client:
    internal: true
    ipam:
      config:
        - subnet: 172.31.251.0/24 # pick unused ranges: docker network inspect $(docker network ls -q)
  egress:
    ipam:
      config:
        - subnet: 172.31.250.0/24
```

### `egress/squid.conf`

```
http_port 3128

acl egress_clients src 172.31.251.0/24
acl web_ports port 80 443
acl SSL_ports port 443
acl CONNECT method CONNECT

# Evaluated against the addresses Squid itself resolved, which are the
# addresses it then connects to. Mirrors isUnsafeIPv4/isUnsafeIPv6.
acl blocked_dst dst 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8
acl blocked_dst dst 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.168.0.0/16
acl blocked_dst dst 198.18.0.0/15 224.0.0.0/3
acl blocked_dst dst ::/8 64:ff9b::/96 2001::/32 2001:db8::/32 2002::/16
acl blocked_dst dst fc00::/7 fe80::/10 fec0::/10 ff00::/8

http_access deny !egress_clients
http_access deny !web_ports
http_access deny CONNECT !SSL_ports
http_access deny blocked_dst
http_access allow egress_clients
http_access deny all

# Public resolvers, so a LAN-only name never resolves to an internal host.
dns_nameservers 1.1.1.1 9.9.9.9

# Time bounds. The HTTP node's own timeout stops at the headers; these do not.
connect_timeout 5 seconds
read_timeout 10 seconds
request_timeout 10 seconds
client_lifetime 30 seconds
# Plain http only: an https body inside CONNECT is opaque to the proxy.
reply_body_max_size 2 MB

cache deny all
via off
forwarded_for delete
httpd_suppress_version_string on
access_log stdio:/dev/stdout
cache_log /dev/stderr
logfile_rotate 0
```

Ports are limited to 80 and 443. A creator site served on another port will fail verification
with `unreachable`; widen `web_ports` only deliberately.

**What this does not do:** cap the size of an https body. That would need TLS interception,
which is not worth it here. An https response is bounded by `client_lifetime` (time), not bytes;
the edge rate limits in §6c bound how often anyone can ask for one.

### Checks, before setting `EGRESS_PROXY_URL`

Run from a throwaway container on the client network (compose prefixes the network name with
the project name, so find it with `docker network ls | grep egress-client`):

```bash
NET=<project>_egress-client
# Prints: <http status> <proxy CONNECT status> <args>. For an https URL a refusal
# shows in the second column; for plain http, in the first.
t() { docker run --rm --network "$NET" curlimages/curl -s -o /dev/null -w "%{http_code} %{http_connect}  $*\n" "$@"; }

t -x http://n8n-egress:3128 https://example.com/          # 200 200  allowed
t -x http://n8n-egress:3128 http://example.com/           # 200 000  allowed
t -x http://n8n-egress:3128 http://localtest.me/          # 403 000  public name resolving to 127.0.0.1
t -x http://n8n-egress:3128 http://169.254.169.254/       # 403 000  metadata
t -x http://n8n-egress:3128 'http://[::1]/'               # 403 000
t -x http://n8n-egress:3128 http://192.168.1.1/           # 403 000  substitute a real LAN address
t -x http://n8n-egress:3128 https://localtest.me/         # 000 403  same check through CONNECT
t -x http://n8n-egress:3128 https://example.com:8443/     # 000 403  port
t --max-time 5 https://example.com/                       # 000 000  no route without the proxy
```

Any `200` on a blocked line, or anything but `000 000` on the last, means stop and fix before going on.
Then set `EGRESS_PROXY_URL = "http://n8n-egress:3128"`, run `test_code_nodes.mjs`, push
`reverify-token` and `media-check`, `--export`, and run one real `/join` Verify plus one media
check end to end. Each should appear in `docker compose logs n8n-egress`.

**Optional second layer.** A host firewall rule dropping new connections from the `egress`
subnet to private ranges (`DOCKER-USER`, for example) catches a Squid misconfiguration too. Rules
added there do not survive a reboot on their own; persist them with whatever the host already
uses (`iptables-persistent`, a systemd unit). If the host runs `ufw`, check how it interacts with
Docker's chains first.

## 6c. Edge rate limits (Nginx Proxy Manager)

n8n has no per-caller rate limit on its public webhooks, and Turnstile does not cover issue_token,
check_media_url or rating. Limits live in Nginx Proxy Manager in front of `n8n.kjnet.us`.

**`/data/nginx/custom/http_top.conf`** (inside NPM's data volume; zones and maps must be defined
in the `http` block):

```
# CORS preflights are never counted. A preflight answered 429 fails in the
# browser outright, and nginx skips any request whose limit key is empty.
map $request_method $n8n_limit_key {
    OPTIONS "";
    default $binary_remote_addr;
}

# The origins the webhooks already allow (INTAKE_ALLOWED_ORIGINS in
# build_workflows.py), so a 429 from nginx is readable by the app.
map $http_origin $n8n_cors_origin {
    default "";
    "https://app.indienodes.us" $http_origin;
    "https://test.indienodes.us" $http_origin;
    "http://localhost:5173" $http_origin;
}

limit_req_zone $n8n_limit_key zone=n8n_webhook:10m rate=30r/m;
limit_req_zone $n8n_limit_key zone=n8n_contact:10m rate=3r/m;
limit_req_status 429;
```

**Proxy host `n8n.kjnet.us` → Advanced → Custom Nginx Configuration:**

```
# n8n.kjnet.us is orange-clouded, so the connecting address is a Cloudflare
# edge. Server level on purpose: NPM already sets `real_ip_header X-Real-IP`
# in the http block, so repeating it in http_top.conf is a duplicate-directive
# error. NPM's generated ip_ranges.conf supplies Cloudflare's set_real_ip_from
# lines, so the header is only trusted from Cloudflare.
real_ip_header CF-Connecting-IP;

location /webhook/ {
    limit_req zone=n8n_webhook burst=20 nodelay;
    client_max_body_size 1m;
    error_page 429 = @n8n_rate_limited;
    include conf.d/include/proxy.conf;
}

location ~ ^/webhook/indienodes-(contact|rating)$ {
    limit_req zone=n8n_contact burst=3 nodelay;
    client_max_body_size 128k;
    error_page 429 = @n8n_rate_limited;
    include conf.d/include/proxy.conf;
}

# Same envelope the workflows answer with, so webhookClient.js shows the message
# and treats it as retryable. Without the CORS header, the browser hides the 429
# and the page can only say "Could not reach the service."
location @n8n_rate_limited {
    default_type application/json;
    add_header Access-Control-Allow-Origin $n8n_cors_origin always;
    add_header Vary Origin always;
    return 429 '{"ok":false,"error":{"message":"Too many requests. Please wait a minute and try again.","code":"rate_limited","retryable":true}}';
}
```

Only the POSTs count, since preflights are excluded. One `/join` session makes several calls in
quick succession (issue token, media checks, verify, submit), so the general budget allows a
burst of 20. Contact and rating allow 3 in a burst, then one every 20 seconds per address. The
editor UI and the n8n API are outside `/webhook/` and are unaffected.
If `INTAKE_ALLOWED_ORIGINS` changes, update the origin map to match.

**Apply it in this order on NPM 2.15.** NPM runs `nginx -t` when a proxy host is saved, and when
the test fails it deletes that host's generated file (`/data/nginx/proxy_host/83.conf` for
n8n) without logging why. The UI can still say Online, but Cloudflare answers `525` for the
whole hostname. That happened on 2026-09-17, 15:17 to 15:25: `http_top.conf` was not actually in
place, NPM's `http_top[.]conf` include silently matched nothing, and the Advanced block's
`$n8n_cors_origin` was an unknown variable.

1. Write `http_top.conf` from inside the container, so the path cannot be wrong, and read it back:
   `docker exec -i <npm> sh -c 'cat > /data/nginx/custom/http_top.conf' < http_top.conf`, then
   `docker exec <npm> cat /data/nginx/custom/http_top.conf`. `nginx -t` passing proves nothing
   here, because a missing file is not an error.
2. Test the Advanced block offline before pasting it. Build a copy of the host file with the block
   after `server_name`, and a copy of `nginx.conf` whose `include /data/nginx/proxy_host/*.conf;`
   points at that copy only. Put the copy of `nginx.conf` in `/etc/nginx/` so relative includes
   resolve. Run `nginx -t -c` against it, then delete both copies. The running config is not
   touched.
3. Paste and save only after that test passes. Immediately check that
   `/data/nginx/proxy_host/83.conf` still exists and `https://n8n.kjnet.us/healthz` returns `200`.
   If either fails, remove the block and save again.

Before relying on it, confirm three things:

1. **`proxy.conf` carries the `proxy_pass`.** Run `docker compose exec <npm> cat /etc/nginx/conf.d/include/proxy.conf`.
   If it has no `proxy_pass` line, add `proxy_pass $forward_scheme://$server:$port;` to both
   webhook locations above.
2. **The config is valid.** Run `docker compose exec <npm> nginx -t`.
3. **The limit sees real client addresses.** NPM must have fetched Cloudflare's ranges
   (`grep -c set_real_ip_from /etc/nginx/conf.d/include/ip_ranges.conf` is well above zero;
   `IP_RANGES_FETCH_ENABLED` must not be `false`). After one request from a known address, the
   host's access log (`/data/logs/proxy-host-<id>_access.log`) should show that address, not a
   Cloudflare one. If it still shows Cloudflare, every visitor shares one bucket; do not rely on
   the limit until that is fixed.

To test (these requests are refused before anything is sent, because they carry no Turnstile
token):

```bash
for i in $(seq 1 6); do
  curl -s -o /dev/null -w "%{http_code} " -X POST https://n8n.kjnet.us/webhook/indienodes-contact \
    -H 'Origin: https://test.indienodes.us' -H 'Content-Type: application/json' -d '{}'
done; echo
# expect: 200 200 200 200 429 429 (the first four are n8n's own JSON refusal)

curl -si -X POST https://n8n.kjnet.us/webhook/indienodes-contact \
  -H 'Origin: https://test.indienodes.us' -H 'Content-Type: application/json' -d '{}' \
  | grep -iE '^HTTP|access-control-allow-origin|rate_limited'
# expect: HTTP/2 429, access-control-allow-origin: https://test.indienodes.us, and the JSON body

curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS https://n8n.kjnet.us/webhook/indienodes-contact \
  -H 'Origin: https://test.indienodes.us' -H 'Access-Control-Request-Method: POST'
# expect: 204 or 200 even while limited, because preflights are never counted
```

Re-verified live 2026-09-17 against the deployed config above: 200 200 200 200 429 429, exactly as
expected.

**A client-side cooldown on `/contact`'s "Send another message" is not part of this defense.**
It exists (`src/routes/(app)/contact/+page.svelte`, `RESEND_COOLDOWN_SECONDS`) purely so a real
visitor sending a few quick messages doesn't burn through their own IP's budget above and land on
the generic 429 with no warning — a script posting straight to the webhook never runs that page's
JS at all, so it has no effect on the threat this section actually defends against. That threat
(a burst of requests, however fast) is what the curl test above already covers.

---

## 7. Private review notification

Built from the **stored, normalised** row, never from unvalidated request fields. Deliberately
short — mode (new/update), type, creator, and one link:

```
NEW SUBMISSION
type: audio
creator: …
Review: https://…/webhook/indienodes-review-action?submission_id=…&decision=view&exp=…&sig=…
```

Everything else — why, tags, media, source URL, email, rights confirmation, EULA, professional
membership, and the Approve/Reject actions themselves — lives on the review page the link opens
(§9), not in the push. This replaced an earlier version that put every field into the
notification text; the link-only form is what makes the push readable on a phone and is what
lets the source URL render as a real clickable link instead of a line of plain text.

### Delivery: Gotify, falling back to SMTP

```
build notification (title + body, channel-neutral)
  → Gotify  native node, URL + token from the gotifyApi credential
      2xx → done
      unset, down, or non-2xx → SMTP to reviewer_email
          sent    → done
          failed  → notification_failed (resumable)
```

Gotify uses n8n's **native node** (`n8n-nodes-base.gotify`) with a `gotifyApi` credential that
carries the server URL _and_ the app token, so neither is ever workflow data. An earlier build
hand-rolled an HTTP node after a wrong guess at the credential type name — `gotify` 404s, the
type is `gotifyApi` — while seven other workflows on this instance already used the real one.

A Gotify failure at runtime falls through to mail. A _missing_ credential cannot occur at
runtime at all: n8n refuses to publish a node whose required credential is absent, so that
guarantee is deploy-time rather than a string check.

The message-building node emits `title` and `body` only. Each delivery branch shapes its own
payload, so adding a channel later does not touch it. Signal would slot in as another delivery
branch, but it needs a self-hosted `signal-cli-rest-api`; there is no official API and having
the Signal app is not sufficient.

Nothing is interpolated into markup or a mention-parsing context any more, so the Discord-era
`allowed_mentions` guard is gone with the Discord payload. Delivery is still verified — a
non-2xx is not success. v1 never looked, so a rejected call was reported to the submitter as a
completed submission.

v1 routed an empty webhook URL straight to a success response, returning a reference the
maintainer would never see. A submission that silently reaches nobody is worse than one rejected
with a retryable error, so both channels are now credential-bound and neither can be silently
absent.

If the row reaches `pending_review` but notification fails, the row is preserved at
`notification_failed` and the client gets a retryable error. Retrying resumes rather than
creating a second submission.

---

## 8. Signed approve/reject links

One helper, two callers, one implementation.

```
message = submission_id|decision|exp
sig     = HMAC-SHA256(secret, message)      hex, lowercase
link    = {base}?submission_id=…&decision=…&exp=…&sig=…      every parameter URL-encoded
```

Seven-day expiry. Approve and reject are signed independently — sign mode emits one item per
decision through a single Crypto node, so both signatures come from one node rather than two.

**The secret lives in an n8n `crypto` credential** (`IndieNodes - Review Link HMAC`,
`9VIejqScJ05LM6X7`), field `hmacSecret`. The Crypto node's `hmac` action requires one;
activating without it fails with `Missing required credential: crypto`.

This is what v1.0 of this document specified, and it was right. An intermediate revision of
the v2 refactor plan (deleted 2026-09-04 once its work shipped; in git history) claimed no
such credential existed and routed the secret to an environment variable — that was wrong,
and it is the reason this paragraph is explicit. Properties that matter: created and rotated through the API or UI with **no container
change and no restart**; never returned by `GET /api/v1/credentials/{id}`; never present in a
workflow export; and never in the item stream, which a `config` Data Table row cannot avoid,
since a Data Table `get` necessarily emits the value as data.

Rotate in the UI: Credentials → the credential → HMAC Secret → Save. No workflow edit needed.
Rotation invalidates every outstanding link.

Verification: shape-check `decision` (exactly `approve` or `reject`), `exp` (base-10 integer)
and `sig` (64 hex chars) first; recompute; compare **constant-time** (length first, then
XOR-accumulate); classify expiry **only after** the signature is trusted, so an unsigned link
cannot learn whether an id was real.

Defence in depth on the helper, all set through the API:
`saveDataSuccessExecution: none`, `saveDataErrorExecution: none`, `saveManualExecutions: false`,
`callerPolicy: workflowsFromAList`.

---

## 9. Review Action

### Handling a click

```
Webhook → validate query → Signature helper (verify) → Switch invalid | expired | valid
  valid → get row → Switch view | approve/reject
    view          → view: gate → sign fresh links → render page
    approve/reject → precheck → marker claim → Switch approve | reject
```

Invalid and expired stay visibly distinct. `decision` is validated explicitly: in v1 any value
that was not `approve` fell through to the reject branch and deleted the row.

### The review page (`decision=view`)

The link the notification actually sends (§7). Signed the same way as approve/reject —
`view` is a third value the signature helper accepts, sharing one HMAC implementation with the
other two rather than a separate scheme — but it **never claims the row**: `view: gate` branches
off before `precheck`'s marker-claim logic runs at all, because a view is read-only and must be
safe to load any number of times (a maintainer re-opening the notification, or the link sitting
in a phone's browser history, must not race an actual approve/reject click).

Actionable (renders the full page with buttons) when the row is `pending_review` or
`approval_failed`; otherwise a short status message with no buttons — already approved, being
processed, or no longer exists.

When actionable, the page calls the signature helper a **second** time, in `sign` mode, to mint
fresh Approve/Reject links with a new 7-day window from the moment the page is opened — the
original links signed at submit time may be close to expiring by the time anyone clicks through,
and re-signing means they never are. The page itself renders the stored `entry`/`review` fields:
creator, why, tags, media (tracks/pages/excerpts per type, not just a count), and `source_url` as
a real `<a target="_blank">` — this is what lets a reviewer actually open the submitted page
before deciding, rather than reading a URL as plain text.

**Every submitter-controlled string is HTML-escaped before it reaches this page** — creator, why,
tags, `thumb_url`, track labels, page captions, excerpts, email, professional-membership fields.
This is a materially different trust boundary from the Gotify/email notification, which never
executes markup: a browser renders this page, so an unescaped field is a stored-XSS path into the
reviewer's own session on this n8n instance. One `escapeHtml()` helper, applied everywhere,
covers it. Verified live: a submission with `creator` set to `<script>alert(1)</script>` and a
tag set to `"><img src=x onerror=alert(2)>` rendered both as inert escaped text, not as markup.

The **Review criteria** list is the reviewer checklist. Every item is a yes/no check, not a quality
judgment. Besides the §8 items, it carries the content-rule checks (added 2026-09-17):

- the AI attestation is checked;
- the rights attestation is checked, and no featured work is obviously a cover, fan work, or client
  work;
- the adult-content disclosure is answered, and any adult featured work is marked explicit;
- no sexual content involving minors, or characters depicted as minors, is visible on the site.

It ends with the standing note that AI attestations are trusted at submission, and a Node is
removed only on credible evidence that featured work is generated, never on suspicion or detector
output.

The **Submission checks** table shows each attestation answer, plus whether the entry is marked
explicit. A row recorded before the attestations existed shows "Not recorded" rather than a "No"
the submitter was never asked for.

Reject on the page carries a `confirm()` prompt before navigating — it deletes the row
permanently, so a lightweight guard against a misclick is worth the one line. Approve stays a
plain link; `approval_failed` is already a recoverable state if clicked by mistake.

### Reject

**Sends SMTP mail, and requires `notify_from_email` plus a working
`IndieNodes - SMTP` credential.** Push channels reach the maintainer; the only address a
submitter ever gives is an email address, so this one cannot be Gotify or Signal.

`docs/submission-form-spec.md` §5 step 9 promises the submitter is told before anything is
deleted. v1 deleted the row and served a page admitting nobody had been notified — the promise
was simply not kept. With the sender address unset, a reject click leaves the row untouched and
tells the maintainer why. Otherwise: send → confirm the send did not throw → delete the row →
confirm. If delivery fails, nothing is deleted and the link still works.

The mail gives no reason and none is stored. The row is deleted immediately after, and a
rejection rationale is exactly the kind of record §5 step 9 says is not retained.

### Approve

Separate nodes per GitHub operation, deliberately — their individual execution records are what
make a partial failure diagnosable. Fetch ring → parse → generate id + `creator_id` → strip to
the public allowlist → **refuse if the row has no verification token** → **re-check every media
URL (§6a)** → resolve existing member-file SHA → get main ref → create branch → commit
`members/<id>.json` → open PR → verify → mark approved and scrub.

Rather than an IF after each call, all six set `onError: continueErrorOutput` into one shared
failure path: mark `approval_failed`, publish nothing, and serve a **generic** page. v1
interpolated the raw GitHub response into the browser.

Corrections against v1:

- The existing-member-file request is **authenticated** like the others. Unauthenticated it
  shared the 60/hour anonymous pool; exhausting it yields a null SHA, and committing without one
  when the file exists fails with a 409.
- An unparseable `ring.json` aborts instead of defaulting to `[]`, which silently disabled both
  the id-collision check and `creator_id` matching.
- Branch names are collision-resistant on **both** paths (`<prefix>/<id>-<timestamp>-<execution id>`);
  v1 used a bare `submission/<id>`, colliding on any retry.
- A creator name of only punctuation can no longer produce an id of `""` or `"-2"`, both of
  which fail `schema/ring.schema.json`'s `^[a-z0-9]+(-[a-z0-9]+)*$`.
- `creator_id` matching works at all — see §0.
- Read-only GitHub lookups retry transient transport failures up to three times. Writes are never
  retried blindly: if GitHub accepts a branch, file change, or PR and its response is lost, an
  automatic replay would make the resulting state ambiguous.
- The approval-success page is rendered in a Code node and handed to the response node as one
  value. Embedding the full styled page inside an n8n expression caused successful approvals to
  end on an `invalid syntax` response after the PR had already been created.

Both refusals (no token, a media URL that is not an image) stop before the first GitHub call,
mark `approval_failed`, and show the maintainer why. A PR that `validate:publish` is certain to
fail is worse than none: it looks done.

`approval_failed` is resumable. The residual risk: if a run died _after_ opening the PR but
_before_ marking approved, a retry can open a second one. Prior-artifact detection is not
implemented.

### Approving a removal

A `request_removal` row takes its own branch off `approve: is removal?`, ten nodes running
parallel to the chain above rather than woven through it. That separation is the point: an
approval that _adds_ a file and an approval that _deletes_ one share only their beginning and
their end, and threading both through the same nodes would mean every node carrying an "unless
this is a removal" condition. The two converge again at `approve: PR verdict`, so failure
handling, status marking, and the rendered page stay single-copy.

Removal prep → id known? → resolve member-file SHA → SHA verdict → file present? → get main ref
→ create branch → **DELETE** `members/<id>.json` → open PR → (shared) verdict.

- **It opens a PR; it does not remove anyone.** The delete lands on a branch. `ring.json` is
  regenerated from `members/*.json` by the auto-build workflow, so nothing leaves the ring until
  a human merges. An approval click is the second gate, not the last one.
- **A missing file is success, not failure.** `file present?` routes a 404 to the same `gone`
  terminal state as a completed delete, because the desired end state is already true. A
  maintainer clicking an old link twice gets "already gone", not `approval_failed`.
- **A verified removal bypasses the source rate limit window.** A recent join or update must
  never force a member to remain published for another ten minutes after they have proved control
  and asked to leave. The successful removal still writes the normal salted source hash and timestamp,
  so this is a one-way exemption for the removal being requested—not a way to disable limiting on
  subsequent submissions.
- **No entry and no email** — a removal retains only the existing row's node type and verified
  source plus a small operational review block (`mode: remove`, node ID, and optional `reason`,
  capped at 2000 characters). The notification and private review page identify the node, type,
  verified source, and optional reason without inventing creator fields or storing contact data.
  The member proves control of the page the node points at, exactly as a change request does.
- Rejecting a removal deletes the pending request directly. It does not enter the submitter-email
  branch because voluntary removals deliberately collect no address.
- The `reason` is echoed into the PR body when given, and its absence is stated explicitly
  rather than left blank — a removal needs no justification and the PR should not imply one was
  withheld.

### The public allowlist

`creator, type, form, why, tags, tracks, pages, artworks, excerpts, thumb_url, thumb_position, preview_url, trailer_url, explicit`, plus
backend-assigned `id`, `source_url`, `verification_token`, and optional `creator_id`. This
matches `toRingEntry` in `src/lib/submissionValidation.js` field for field. It is an allowlist,
never a denylist: a field added to the form later must be deliberately published, not published
by default.

`verification_token` is **required** by the canonical schema and is the row's own token — the one
`verify` checked and finalize re-checked. It stays on the row through review (a
`notification_failed` resume re-verifies against it) and is scrubbed from the row only after the
PR carrying it exists. A row without a well-formed one is refused before any GitHub call. See §2.5
for why it is published at all.

Only `members/<id>.json` is written. The repository regenerates `ring.json` from `members/*.json`
in a separate auto-build workflow (commit `2c8ce07`); `validate:publish` runs on the PR via CI,
and merging stays a manual click.

---

## 10. Error workflow

Set as `settings.errorWorkflow` on every workflow. Records workflow name and ID, execution ID,
failed node, a safe error class, and a timestamp — by **allowlist**, never by passing the error
payload through, because that payload carries the failed run's data, which here means submitter
PII and verification tokens. The error `message` is deliberately omitted: it can embed a
response body. n8n's own execution record holds the detail for a human to open.

No notification step: the Gotify credential is the reviewer channel, and a node that pretends to
notify when it cannot is the failure mode this rebuild removed. Adding an ops channel is a
one-node change.

---

## 11. Contact workflow

`Webring - Contact v2` (`8VYg8aZ7owilxxgb`), 19 nodes, path `indienodes-contact`. A separate
webhook from the submission one so either can be paused or rotated without touching the other.

Much simpler — no queue, no PR, no token contract. Webhook receives `{ name, email, message, website, elapsed_ms, turnstile_token }`
(`turnstile_token` is required while `TURNSTILE_ENABLED` is on):

```
Webhook → validate → Switch  send | dropped | error
  send    → verify turnstile → turnstile verdict → passed?
              no  → shape turnstile failure (retryable `turnstile_failed`)
              yes → build notification → notify: gotify → delivered?
                                    ok  → shape sent
                                    no  → notify: email fallback → delivered?
                                                ok → shape sent
                                                no → shape undelivered
  dropped → fake success, shaped exactly like a real send
  error   → client error envelope
→ Respond (shared)
```

**No storage, and that inverts the failure handling.** Finalize can answer "received" and retry
a notification later because the submission is safely in a Data Table. This workflow has no row
anywhere, so a message that fails both channels is _gone_. It therefore returns a retryable
`not_delivered` error and **never a reference** — answering `{ reference }` for a message nobody
will read is a lie the sender cannot detect. This is the one place in the system where a
delivery failure has to reach the browser.

The bot gate runs **before** field validation, so a dropped bot cannot learn which field it got
wrong; the fake success carries a reference shaped like a real one. Validation is deliberately
permissive on the address (one `@`, something either side, no whitespace) — a stricter pattern
rejects real addresses and the only cost of a bad one is a bounced reply, since there is no
account to protect.

The sender's address travels in the notification body and is set as the mail fallback's
`replyTo`. It is written to no table: this workflow has no storage at all, which is what keeps
`/contact` inside the project's no-stored-personal-data stance while still being repliable.

**Execution retention is off** (`no_persist`), and that is load-bearing rather than tidiness.
n8n would otherwise retain the full item stream — name, address, and message body — as a second
copy after delivery. Measured before the fix, a test execution contained both the address and
message text. Turning retention off keeps contact data out of the intake workflow's history;
the delivered Gotify or email notification may remain long enough for the Operator to review
and reply under the Privacy Notice. The cost is that a failed delivery leaves nothing to inspect;
acceptable, because the sender is told plainly that it failed and a Gotify or SMTP outage is
diagnosable from those services rather than from a retained workflow copy.

Unlike Data Table rows (§13), executions **can** be deleted through the public API
(`DELETE /executions/<id>`), which is how the pre-fix test records were purged.

**Turnstile is server-verified here** (since 2026-09-17), with the same `turnstile_nodes`
Siteverify pair Finalize uses. Before that, the page rendered the widget and sent a token that
nothing checked, so a script posting the honeypot and dwell values directly could send
notifications at will. `validate` refuses a missing token before anything else runs, and only a
`success === true` answer reaches `build notification` — which reads the message from `validate`
by name, since the item arriving there is the verdict. A failure is retryable: the page resets the
widget on any error, and after a successful send, because Siteverify accepts a token once.

**Not modelled on `KJO Contact Flow`,** despite that being the nearest existing workflow. It
formats its mail with a GPT-4.1-mini agent, which puts a third-party dependency and a
per-message cost between a person and a maintainer to produce an email whose shape is known in
advance. It also authenticates its webhook with a header credential — fine there, where n8n is
the only caller, but here the caller is a browser and a header secret would ship in the client
bundle. Turnstile does that job instead; the honeypot and dwell gate are only a cheap first
filter, since both values come from the client.

---

## 11a. Rating workflow

`Webring - Rating v1`, 10 nodes, path `indienodes-rating`. **Live since 2026-09-02**
(`w7GHL1sei1QNKiCf`, active), with storage on. To redeploy it after a generator change, push it
over the API with `python3 scripts/n8n/build_workflows.py --push --only rating`, or emit the JSON
and import it through the UI:

```bash
python3 scripts/n8n/build_workflows.py --emit --only rating > rating.json
```

It references the existing `IndieNodes Notifications` Gotify credential and sets no
`errorWorkflow` (there is no API key to resolve one with when emitting), so point it at the
shared error workflow in the UI if you import rather than push. Then set
`VITE_RATING_WEBHOOK_URL` at image build time. Until both are done the app simply never asks for a rating, which is the
intended unset behaviour rather than an error state.

The smallest workflow here, and deliberately so:

```
Webhook → validate → Switch  send | dropped | error
  send    → build notification → notify: gotify → shape ok
  dropped → fake success, shaped exactly like a real send
  error   → client error envelope
→ Respond (shared)
```

**No email fallback and no undelivered shape**, which is the one real difference from Contact.
A contact message has a person waiting for a reply, so a delivery failure has to reach them. A
rating has nobody waiting, so Gotify failing means the rating is lost and the visitor is still
told it worked. That is not a lie worth avoiding here: there is nothing they could do about it
and nothing they are owed.

**Storage is optional in the generator, and is on for this instance** —
`build_workflows.py`'s `TABLE_RATINGS` names a real table (`WBVmTx5OWBKCfRJs`). Left unset the
workflow notifies and keeps nothing; set, each rating also becomes one row of
`{ rating, created_at, app_version }` in the `ratings` Data Table, written _before_ the
notification so a Gotify outage costs the notification rather than the rating. The store node
uses `continueRegularOutput`, so the reverse is also true: a failed write still notifies.

This instance is already through that setup. The sequence is kept for a fresh instance, or if
the table is ever recreated:

```bash
python3 scripts/n8n/build_workflows.py --create-tables   # creates `ratings`, prints its id
# paste that id into build_workflows.py as TABLE_RATINGS, then:
python3 scripts/n8n/build_workflows.py --push --only rating
```

`created_at` is a **date, not a timestamp** — day-level precision is what a trend needs, and a
per-second time is the one field weakly correlatable against a web server's access log. There
is no identifier in the payload to store and none is derived, so the row is not personal data.
Execution history stays off (`no_persist`) either way, so the row is the only copy.

## 12. Credentials and configuration checklist

**n8n credentials** (never touch this repo):

| Credential                                      | ID                 | Used by                                   |
| ----------------------------------------------- | ------------------ | ----------------------------------------- |
| `Github PAT - Indienodes` (HTTP Header Auth)    | `1YWJOqz5zCx2hm2o` | Review Action, Token Lifecycle ring fetch |
| `IndieNodes - Review Link HMAC` (type `crypto`) | `9VIejqScJ05LM6X7` | Signature helper, sign and verify         |

**No config table.** Notification targets are generator constants in
`scripts/n8n/build_workflows.py`:

| Constant                        | Notes                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `REVIEWER_EMAIL`                | Mail fallback recipient                                                                               |
| `NOTIFY_FROM_EMAIL`             | From address; also gates the reject path                                                              |
| `TURNSTILE_ENABLED`             | `False`. When off, the Turnstile nodes are left out of the graph entirely rather than sitting dormant |
| `CONTENT_ATTESTATIONS_REQUIRED` | See below. Whether Finalize refuses a submission or update without the content-rule attestations      |

Both addresses default to `@invalid`, a reserved TLD that can never resolve, so an unfilled
placeholder cannot quietly deliver somewhere wrong. `EMAIL_CONFIGURED` derives from that, and
the reject path treats an `@invalid` sender as unconfigured — holding the submission rather than
deleting it with no notice. n8n rejects an empty `fromEmail` at publish time, which is why a
placeholder exists rather than a blank.

**Content-rule attestations (`CONTENT_ATTESTATIONS_REQUIRED`).** Finalize always records
`ai_attestation`, `rights_confirmation`, `adult_content` and `adult_content_confirmation` for new
submissions and updates, and the review page always shows them. The flag only decides refusal,
and it moves in two phases because staging and production share this instance:

1. **`False`** (shipped 2026-09-17): record and display only. The older rule still applies:
   rights are required only alongside a stated PRO. A production app released before the
   attestations keeps working.
2. **`True`**: every new submission and update must carry all of them (a "yes" to adult content
   also needs its confirmation); removals never do. Flip it, `--push`, and `--export` **only after
   the production release that carries the client change**. Pushing it earlier refuses every
   join and update from the older production app.

**Enabling Turnstile:** create an `httpCustomAuth` credential whose `json` is
`{"body": {"secret": "<cloudflare secret>"}}` — verified 2026-08-22 to inject into the request
body, which is where siteverify expects it — then set `TURNSTILE_CREDENTIAL` and flip
`TURNSTILE_ENABLED`.

**Generator constants** in `scripts/n8n/build_workflows.py`, all instance-specific: `N8N_BASE`,
the three Data Table IDs, `CRYPTO_CREDENTIAL`, `GITHUB_REPO`, `REVIEW_WEBHOOK_BASE`,
`INTAKE_ALLOWED_ORIGINS`, `MIN_DWELL_MS`, `TOKEN_TTL_SECONDS`, `REVIEW_LINK_TTL_SECONDS`,
`RATE_LIMIT_WINDOW_SECONDS`, `REVERIFY_SKIP_TTL_SECONDS`, `REVIEWER_EMAIL`, `NOTIFY_FROM_EMAIL`,
`TURNSTILE_ENABLED`.

---

## 13. Known limitations

Carried deliberately, each with its reason:

- **SSRF egress control depends on §6b being deployed.** Workflow validation alone cannot stop
  DNS rebinding. Even with the proxy, an https response body is bounded by time, not size.
- **Duplicate PR window.** A retry from `approval_failed` can open a second PR if the first run
  died between opening one and marking approved. Needs prior-artifact detection.
- **Approve paths now have live proof.** The add/update path opened PRs #1–#8 on 2026-08-22 and
  08-23. The removal path completed execution 45454 on 2026-08-27: it created a branch, deleted
  `members/audio-key-jay.json` on that branch, opened PR #11, and returned the success page.
  PR #11 remains subject to normal CI and manual merge; the test did not remove the live member.
- **Expired `pending_verify` rows are never swept.** Expiry is enforced on every read, so they
  are inert, but a scheduled cleanup workflow does not exist.
- **The public API cannot delete Data Table rows** (405 on every shape). Row cleanup is a UI
  task.

---

## 14. What this repo has to configure for the workflows

**Superseded in part, 2026-09-04.** This section originally read "This repo needs no new
configuration," which was true when written and stopped being true once the rating workflow
(§2.4, §11a) shipped: that one _does_ need a new repo variable,
`VITE_RATING_WEBHOOK_URL`, set at image build time like every other `VITE_` value. The
bullets below are otherwise unchanged and still hold.

The GitHub PAT, the Turnstile secret key, and the review-action webhook remain genuinely
outside this repo's configuration, for the reasons given below.

- The GitHub PAT is an **n8n credential only**. It never touches this repo, this repo's GitHub Actions secrets, or `.env` — there is no server here, at build or runtime, that could use it (`adapter-static`). `.github/workflows/docker-publish.yml` already uses a completely different, unrelated credential (the auto-provided `GITHUB_TOKEN`, scoped only to pushing the Docker image to GHCR).
- `VITE_SUBMISSION_WEBHOOK_URL`, `VITE_CONTACT_WEBHOOK_URL` and `VITE_RATING_WEBHOOK_URL` cover everything the browser needs to know. The review-action webhook (§8) is hit only by a maintainer's browser clicking a link from the review notification — never by this app's client code — so it needs no `VITE_` variable and no repo variable at all.
- `VITE_TURNSTILE_SITE_KEY` already exists; `.env.example` already correctly notes the matching secret key "belongs" in the external n8n workflow. This runbook is what fulfills that note (§1, §4, §11) — it doesn't change anything about this repo's own configuration.
