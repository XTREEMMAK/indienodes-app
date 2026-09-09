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
```

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

Notes that change how you build this:

- `issue_token`'s `source_url` is nullable — the site-generator branch (a creator with no site yet) mints a token before any URL exists to embed it at. `bind_source_url` is that branch's second half, attaching a real URL to the same `submission_id` afterward. It must reject (not silently overwrite) a second bind attempt on an already-bound submission — see §4's `bind_source_url` branch.
- `verify` sends only `submission_id`. **The workflow must resolve `source_url` from its own stored state, never from the request.** If the workflow trusted a client-supplied URL here, a submitter could verify a page they control and then submit a different one — the whole check becomes decorative. This is the single most load-bearing rule in this entire document; every branch that touches a URL (`verify`, `submit`'s re-check, `request_update_token`) must resolve it server-side.
- `entry` (in `submit` and `submit_update`) is the full `ring.json`-shaped object per `schema/ring.schema.json` (§2.3 below) — `id`/`creator_id` excluded (the workflow assigns those at approval, §9). `review` (in `submit` only) is the Section 2.2 block: `email`, `rights_confirmation`, `pro_membership`, `pro_membership_name`, `eula_agreement`.
- `request_update_token`/`submit_update`/`request_removal` are keyed by an existing `node_id`, not a new submission. The workflow must fetch the node's **current** `source_url` from the live `ring.json` itself (not from anything the client sends) to check the token against — same reasoning as `verify`.
- `turnstile_token` is optional and appears **only** on `submit_update`, `request_removal`, and the Contact webhook — `issue_token`/`verify`/`submit` on `/join` are not Turnstile-guarded at all. Don't add a Turnstile check to those three actions; the client never sends a token for them.
- `rate_status` (added 2026-08-31) is a **read-only** pre-check: whether a fresh `submit`/`submit_update`/`request_removal` for this `source_url` would be rate-limited right now, asked from `/update`'s identify step as soon as a node is found — before the visitor has invested time in the form or a Turnstile challenge only to be told to come back later. It reads the same `rate_limits` bucket §5's rate limiting describes but never writes to it, and it has none of `resume`/`is_removal`'s exemptions (it doesn't yet know which the visitor will end up doing), so it can occasionally say "blocked" a beat before the real gate at actual submit time would exempt it. That's intentional — it's advisory, never the gate; the client treats a failure to reach it as "nothing to show," not an error.

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

The temporary `verification_token` is private workflow state, cleared when a row enters review and never published. Note the schema still lists it as `required` — a cross-repo lag tracked in `ring-audit-2026-09-04.md`, resolved in `indienodes-ring`, not here.

Media URLs (`media_url` inside `tracks`, `image_url` inside `pages`, `thumb_url`, `preview_url`) must be `https://` and must not resolve to the `indienodes.us` domain — the schema's `externalMediaUrl` `$def` enforces this. Nothing in the workflow needs to duplicate that check; it's the CI gate's job to catch a violation, not the workflow's.

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
| Webring - Helper - Re-verify Token v2       | `FtLH2sf84rtyiEz4` |     6 | The SSRF boundary — the only outbound fetch to a submitter-chosen address                  |
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

**Boundaries that stay isolated:** SSRF egress (Re-verify), secret handling (Signature), and
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

**Still required at the infrastructure layer:** network-level egress controls remain the complete
fix. The DNS-over-HTTPS resolution above closes the untimed, single-DNS-record bypass, but a
true rebinding race (the DNS answer changing between that lookup and `fetch source_url`'s own
resolution, moments later) is not addressed — that needs an egress proxy that resolves once,
pins the connection to the validated address, and enforces a response-size ceiling, none of
which the HTTP node offers directly.

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
the public allowlist → resolve existing member-file SHA → get main ref → create branch → commit
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

`creator, type, why, tags, tracks, pages, artworks, excerpts, thumb_url, thumb_position, preview_url, trailer_url, explicit`, plus
backend-assigned `id`, `source_url`, and optional `creator_id`. This
matches `toRingEntry` in `src/lib/submissionValidation.js` field for field. It is an allowlist,
never a denylist: a field added to the form later must be deliberately published, not published
by default.

`verification_token` is temporary private workflow state. It is cleared when a verified request enters the private review queue and is never copied into a newly generated member file. The schema accepts the property only for legacy published entries while the canonical ring repository is migrated.

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

`Webring - Contact v2` (`8VYg8aZ7owilxxgb`), 15 nodes, path `indienodes-contact`. A separate
webhook from the submission one so either can be paused or rotated without touching the other.

Much simpler — no queue, no PR, no token contract. Webhook receives `{ name, email, message, website, elapsed_ms, turnstile_token? }`:

```
Webhook → validate → Switch  send | dropped | error
  send    → build notification → notify: gotify → delivered?
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

Turnstile is not wired here. `TURNSTILE_ENABLED` is `False` system-wide (§12), and the
convention in this generator is that Turnstile nodes are left out of the graph entirely rather
than sitting dormant. Enabling it means adding the siteverify node here at the same time as the
others.

**Not modelled on `KJO Contact Flow`,** despite that being the nearest existing workflow. It
formats its mail with a GPT-4.1-mini agent, which puts a third-party dependency and a
per-message cost between a person and a maintainer to produce an email whose shape is known in
advance. It also authenticates its webhook with a header credential — fine there, where n8n is
the only caller, but here the caller is a browser and a header secret would ship in the client
bundle. The honeypot, dwell gate, and CORS allowlist do that job instead.

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

| Constant            | Notes                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `REVIEWER_EMAIL`    | Mail fallback recipient                                                                               |
| `NOTIFY_FROM_EMAIL` | From address; also gates the reject path                                                              |
| `TURNSTILE_ENABLED` | `False`. When off, the Turnstile nodes are left out of the graph entirely rather than sitting dormant |

Both addresses default to `@invalid`, a reserved TLD that can never resolve, so an unfilled
placeholder cannot quietly deliver somewhere wrong. `EMAIL_CONFIGURED` derives from that, and
the reject path treats an `@invalid` sender as unconfigured — holding the submission rather than
deleting it with no notice. n8n rejects an empty `fromEmail` at publish time, which is why a
placeholder exists rather than a blank.

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

- **No network-level SSRF egress control.** Workflow validation cannot stop DNS rebinding, and
  the HTTP node offers no response-size cap. Infrastructure work.
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
