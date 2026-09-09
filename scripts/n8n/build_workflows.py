#!/usr/bin/env python3
"""
Generator for the IndieNodes n8n workflows.

The workflows are *generated*, never hand-edited. Editing this file and
re-pushing is the supported way to change them; editing the JSON in the n8n UI
means the next push silently reverts your change. See
`docs/n8n-workflow-runbook.md` for the design and the contract each workflow
implements.

Usage:
    python3 scripts/n8n/build_workflows.py --list
    python3 scripts/n8n/build_workflows.py --dry-run [--only NAME]
    python3 scripts/n8n/build_workflows.py --push    [--only NAME]

The API key is read from ~/.n8n-api-key and is never written to disk or stdout
by this script. Nothing here contains a secret: the review-link HMAC secret
lives in the n8n `crypto` credential named below and is resolved inside the
Crypto node, so it never reaches workflow data or an export.
"""

import argparse
import json
import re
import os
import pathlib
import sys
import urllib.error
import urllib.request

# --- Environment-specific configuration -------------------------------------
# These are IDs on one n8n instance, not portable constants. Confirm them with
# --list before pushing to a different instance.

N8N_BASE = "https://n8n.kjnet.us"
API = f"{N8N_BASE}/api/v1"

# Recreated 2026-08-23 after the original table was deleted by accident.
TABLE_SUBMISSIONS = "qd3WA8AxNiXmIOhn"
TABLE_RATE_LIMITS = "7vIXsDBxw66XRhFt"

# Ratings are stored only when this names a real table. Empty is a supported
# state, not a half-finished one: the workflow then notifies and keeps nothing,
# which is what it did before storage existed at all.
#
# To turn it on: `python3 build_workflows.py --create-tables` creates any table
# in data-tables-schema.json that is missing and prints the id to paste here.
TABLE_RATINGS = "WBVmTx5OWBKCfRJs"

# The single source of truth for both Data Tables' columns -- names, order,
# and n8n's own type strings ("date", not "dateTime": confirmed against a
# live table, not assumed). Backs both the node-level column schemas below
# and --create-tables. Before this file, submissions' 11 columns were
# duplicated three times inline and rate_limits had no schema recorded in the
# repo at all -- an empty "schema": [] on its one write node -- which is
# exactly the gap that turned "a table got deleted" into a multi-step manual
# recovery instead of one command.
DATA_TABLES_SCHEMA = json.loads(
    (pathlib.Path(__file__).parent / "data-tables-schema.json").read_text()
)


# The entry-id rule, taken from the browser's own module rather than restated
# here. It had been restated, and the two drifted in three ways that all
# produced the same silent failure: a creator pastes the embed the form showed
# them, approval assigns a different id, and their site carries a site-id that
# matches no member for as long as the entry exists.
#
#   - No Unicode normalisation here, so every accented name diverged.
#     "Sigur Ros" became sigur-ros in the browser and sigur-r-s here.
#   - A 40-character cap against the browser's 48.
#   - A hard slice against the browser's cut-at-a-hyphen.
#
# Inlining the real source is what makes that class of drift impossible rather
# than merely fixed once. `slug.js` is self-contained (no imports, no platform
# globals), so stripping the ESM keywords is the whole adaptation; the sandbox
# in test_code_nodes.mjs and the parity test in slug.test.js both run this
# exact text.
def _shared_slug_js():
    src = (pathlib.Path(__file__).resolve().parents[2] / "src" / "lib" / "slug.js").read_text()
    return re.sub(r"^export ", "", src, flags=re.M).strip()


SLUG_JS = _shared_slug_js()


def dt_columns(table):
    """Column names, in order, for one Data Table -- from the schema file."""
    return [c["name"] for c in DATA_TABLES_SCHEMA[table]["columns"]]


def dt_node_schema(table):
    """The `columns.schema` shape n8n's Data Table node parameters expect.

    A different type vocabulary from the schema file's own `date`/`string`
    (that one is what POST /api/v1/data-tables wants when creating the table;
    this one is what a node's column-mapper UI wants inside workflow JSON) --
    mapped here rather than duplicated, so the two never have to be kept in
    sync by hand.
    """
    NODE_TYPE = {"date": "dateTime", "string": "string", "number": "number"}
    return [
        {
            "id": c["name"], "displayName": c["name"], "required": False,
            "defaultMatch": False, "display": True, "type": NODE_TYPE[c["type"]],
            "readOnly": False, "removed": False,
        }
        for c in DATA_TABLES_SCHEMA[table]["columns"]
    ]

# The HMAC secret lives here, not in this file and not in the workflow JSON.
CRYPTO_CREDENTIAL = {"id": "9VIejqScJ05LM6X7", "name": "IndieNodes - Review Link HMAC"}

GITHUB_CREDENTIAL = {"id": "1YWJOqz5zCx2hm2o", "name": "Github PAT - Indienodes"}
GITHUB_REPO = "XTREEMMAK/indienodes-ring"

# Reviewer notification: Gotify push, falling back to SMTP so a notification is
# never lost to one channel being down.
#
# The submitter-facing rejection notice is SMTP only. Push channels reach the
# maintainer; the only address a submitter ever gives is an email address.
SMTP_CREDENTIAL = {"id": "aSWA8xI8ZVsnL6wB", "name": "IndieNodes - SMTP"}

# Gotify has a first-class node and credential (type `gotifyApi`, not `gotify` --
# a wrong guess at that name is why an earlier build hand-rolled an HTTP node).
# The credential carries the server URL *and* the app token, so neither is ever
# workflow data, and a missing credential blocks publish rather than surfacing at
# runtime. Seven other workflows on this instance already use this node.
GOTIFY_CREDENTIAL = {"id": "vnUHtzt9acSvlAxx", "name": "IndieNodes Notifications"}

# The rate-limit salt is an HMAC key, not a value to concatenate. It used to be
# read from the config table into `hash_input`, which put a secret into every
# execution record -- the same mistake v1 made with the review-link secret.
RATE_LIMIT_CREDENTIAL = {"id": "0h2rO7wsu6dmkcbS", "name": "IndieNodes - Rate Limit Salt"}

# Reviewer mail fallback, and the From address for both notifications. The SMTP
# credential has no from-address field, so these are node parameters; they are
# not secrets, so they live here with GITHUB_REPO and INTAKE_ALLOWED_ORIGINS
# rather than in a table nothing else in this file consults.
# `.invalid` is reserved and can never resolve, so an unfilled placeholder cannot
# quietly deliver somewhere wrong -- same reasoning as smtp.invalid on the SMTP
# credential. n8n rejects an empty fromEmail at publish time, so a placeholder is
# needed rather than a blank.
REVIEWER_EMAIL = "get@jamaale.live"
NOTIFY_FROM_EMAIL = "indienodes@j2it.us"

# Treated as "not configured" wherever that distinction matters, so the reject
# path holds a submission rather than deleting it and failing to notify.
EMAIL_CONFIGURED = not NOTIFY_FROM_EMAIL.endswith("@invalid")

# Enabled 2026-08-31: VITE_TURNSTILE_SITE_KEY is now a real Cloudflare
# Turnstile site key (set as this repo's GitHub Actions variable), and the
# credential below holds the matching secret -- an `httpCustomAuth`
# credential whose json is {"body": {"secret": "<cloudflare turnstile
# secret>"}}, verified 2026-08-22 to inject into the request body, which is
# where Cloudflare's siteverify expects it. Guards only submit_update and
# request_removal (see this file's own comment further down, near
# tsToken) -- issue_token/bind_source_url/verify/submit stay unguarded by
# design. /contact has no Turnstile branch of its own yet; that is separate,
# unbuilt work, not something this flag reaches.
TURNSTILE_ENABLED = True
TURNSTILE_CREDENTIAL = {"id": "g0EFH2lm3bgbeea7", "name": "IndieNodes - Turnstile Secret"}

# Shortened 2026-08-31 from 60 * 60. Turnstile (see TURNSTILE_ENABLED above)
# now carries the bot-defense job this window used to carry alone -- when it
# was the only real anti-spam layer, a full hour made sense; now its remaining
# job is just bounding how often one source_url can add a fresh row to the
# human review queue, which ten minutes still does.
RATE_LIMIT_WINDOW_SECONDS = 10 * 60

# A claim marker older than this is treated as abandoned and may be reclaimed.
# Without it, a run that dies mid-claim -- a crash, a timeout, a Code node with a
# syntax error -- leaves the row permanently unactionable, because the marker is
# neither pending_review nor approval_failed. Comfortably longer than the approve
# branch's worst case (six GitHub calls at a 10s timeout each).
STALE_CLAIM_SECONDS = 5 * 60

# Token / submission lifetime.
TOKEN_TTL_SECONDS = 24 * 60 * 60

# How long a fresh `verify` is trusted without a second fetch to the same
# source_url at finalize time. Re-verify Token v2 (the SSRF-hardened helper)
# runs the same check both times; back-to-back verify-then-submit is the
# common path (a visitor clicks Verify, then Submit moments later), and
# hitting a creator's own server twice for that has no benefit. 90s comfortably
# covers that UI flow while staying short enough that it does not meaningfully
# weaken the TOCTOU protection: at Finalize Submission the row's `status`,
# `expires_at`, rate limit, Turnstile and claim marker are all still
# independently re-checked regardless of this constant -- only the redundant
# HTTP fetch to source_url is skipped. Never applies on `resume` from
# `notification_failed` (see validate_js in wf_finalize_submission) -- that
# path can be arbitrarily old, so it always re-fetches, same as before this.
REVERIFY_SKIP_TTL_SECONDS = 90

# Production path. Cut over 2026-08-23 after the full smoke test (issue, bind,
# verify, submit, Gotify delivery, approve -> real PR, reject -> SMTP -> delete)
# all passed against the -v2-test path.
REVIEW_WEBHOOK_PATH = "indienodes-review-action"

# Derived, never written twice. The base is baked into every signed approve and
# reject link; the path is what Review Action listens on. These were separate
# literals and had already drifted -- the base pointed at the production path
# while the workflow listened on the test one, so every link the system signed
# addressed the *old* workflow, which verifies with a different secret and a
# different construction and would answer "This link is invalid."
REVIEW_WEBHOOK_BASE = f"{N8N_BASE}/webhook/{REVIEW_WEBHOOK_PATH}"

# Decision links are read-only GETs. The confirmation form posts the same signed
# values to a separate webhook, so link previews, scanners, and an accidental
# first click can never approve or reject a submission.
REVIEW_CONFIRM_WEBHOOK_PATH = f"{REVIEW_WEBHOOK_PATH}-confirm"
REVIEW_CONFIRM_WEBHOOK_BASE = f"{N8N_BASE}/webhook/{REVIEW_CONFIRM_WEBHOOK_PATH}"

# Rejecting a submission promises the submitter is told (submission-form-spec
# section 5 step 9). With no channel configured that promise cannot be kept, so
# the row is held rather than deleted silently -- which is what the original
# workflow did behind a page admitting it had not notified anyone.
INTAKE_WEBHOOK_PATH = "indienodes-submit"

# A separate webhook from the submission one, deliberately: `/contact` is a
# different trust surface with a different failure mode, and keeping the URLs
# apart means either can be paused or rotated without touching the other.
# VITE_CONTACT_WEBHOOK_URL in the client points here.
CONTACT_WEBHOOK_PATH = "indienodes-contact"

# The one-time app rating. A third public webhook rather than an action on
# intake: unrelated concern, unrelated failure mode, and switching rating
# collection off should not touch the submission pipeline.
RATING_WEBHOOK_PATH = "indienodes-rating"

# CORS. The browser deliberately sends preflighted JSON (see the Content-Type
# comment in src/lib/webhookClient.js), so OPTIONS must be answered. The
# Webhook node's allowedOrigins defaults to "*"; the production origin is
# known, so it is named. SITE_ORIGIN in src/lib/config.js is the source.
#
# test.indienodes.us is committed rather than passed through the env var
# below, and the distinction is the point: it is a permanent staging host on
# the project's own domain, exercised repeatedly against this same production
# instance because there is no separate staging n8n. Left to N8N_EXTRA_ORIGINS
# it would be dropped by the next clean push -- silently, since a missing
# origin looks like a working deploy until someone submits a form -- and that
# push is a documented release step, so the breakage would be routine rather
# than rare.
#
# N8N_EXTRA_ORIGINS appends to that list for a push, without committing the
# addition. It is for the genuinely ephemeral case: testing a container build
# means loading the app from something like http://192.168.1.10:8099 -- a
# machine-specific address that belongs in nobody's repo, but that the
# preflight will reject until it is named:
#
#   N8N_EXTRA_ORIGINS=http://192.168.1.10:8099 python3 scripts/n8n/build_workflows.py --push
#
# Two things to be clear about before using it. The value lands on the *live*
# webhook and stays there until the next push without it, so re-push clean
# when the test is done (`--export` afterwards will show it if you forgot).
# And this list is not a security control: the endpoint is public and any
# client that is not a browser ignores CORS entirely -- curl reaches it
# regardless. It constrains one thing only, which is a *browser* on some other
# page making a credentialed request on a visitor's behalf. The honeypot,
# dwell time, Turnstile, rate limits and token verification are what actually
# guard this endpoint; widening this list does not weaken any of them.
INTAKE_ALLOWED_ORIGINS = (
    "https://app.indienodes.us,https://test.indienodes.us,http://localhost:5173"
)
_extra_origins = os.environ.get("N8N_EXTRA_ORIGINS", "").strip().strip(",")
if _extra_origins:
    INTAKE_ALLOWED_ORIGINS += "," + _extra_origins

# Bot gate: a filled honeypot or an implausibly fast form entry gets a fake
# success rather than an error, so a bot learns nothing from the response.
# Applied only to actions that actually carry these fields. Continuation
# actions (bind_source_url and verify) deliberately send neither one; they
# are already tied to server-side state through an issued submission id.
MIN_DWELL_MS = 1500

# Signed approve/reject links are valid for this long.
REVIEW_LINK_TTL_SECONDS = 7 * 24 * 60 * 60

# Set once the Error Workflow exists; every other workflow points at it.
ERROR_WORKFLOW_NAME = "Webring - Error Workflow"

# Workflows permitted to invoke the signature helper. Resolved to IDs at push
# time; names that do not exist yet are skipped rather than emitted as a
# blocking empty allowlist. Set N8N_EXTRA_CALLERS to a comma-separated list of
# workflow IDs to temporarily admit a test harness.
SIGNATURE_CALLER_NAMES = [
    "Webring - Action - Finalize Submission v2",
    "Webring - Review Action v2",
]

REVERIFY_CALLER_NAMES = [
    "Webring - Token Lifecycle v2",
    "Webring - Action - Finalize Submission v2",
]


# --- Node and workflow builders ---------------------------------------------

def node(name, type_, type_version, position, parameters=None, **extra):
    n = {
        "parameters": parameters or {},
        "name": name,
        "type": type_,
        "typeVersion": type_version,
        "position": list(position),
    }
    n.update(extra)
    return n


def code_node(name, position, js, **extra):
    return node(name, "n8n-nodes-base.code", 2, position, {"jsCode": js.strip() + "\n"}, **extra)


def chain(*names):
    """Linear main-output wiring for a straight-line graph."""
    out = {}
    for a, b in zip(names, names[1:]):
        out[a] = {"main": [[{"node": b, "type": "main", "index": 0}]]}
    return out


def settings(error_workflow_id=None, caller_ids=None, no_persist=False):
    s = {"executionOrder": "v1", "binaryMode": "separate"}
    if error_workflow_id:
        s["errorWorkflow"] = error_workflow_id
    # An empty allowlist blocks every caller, including the ones this refactor
    # is building. Until at least one caller exists, leave the policy unset so
    # the instance default applies -- which is what the existing helpers use.
    if caller_ids:
        s["callerPolicy"] = "workflowsFromAList"
        s["callerIds"] = ",".join(caller_ids)
    if no_persist:
        # The signature helper resolves a secret. Even though the credential
        # keeps the value out of the item stream, there is no reason to retain
        # this workflow's execution data at all.
        s["saveDataSuccessExecution"] = "none"
        s["saveDataErrorExecution"] = "none"
        s["saveManualExecutions"] = False
    return s


# --- Workflow: Error Workflow ------------------------------------------------

def wf_error_workflow(ctx):
    """Records operational metadata for an unexpected failure.

    Deliberately records *only* metadata. Submission payloads, verification
    tokens, email addresses, and credential data must never reach here; the
    shaping node below allowlists fields rather than passing the trigger
    payload through, so a future n8n version adding a field to the error
    payload cannot silently start leaking it.

    There is no notification step: `config.discord_webhook_url` is empty on
    this instance, and a node that pretends to notify when it cannot is the
    exact failure mode this refactor is removing. The record is the n8n
    execution entry. Adding an ops channel later is a one-node change.
    """
    js = """
// Allowlist. Never spread the trigger payload: it carries the failed run's
// data, which for this system means submitter PII and verification tokens.
const e = $json.execution || {};
const w = $json.workflow || {};
const err = e.error || {};

return [{ json: {
  workflow_name: w.name || '',
  workflow_id:   w.id || '',
  execution_id:  e.id || '',
  failed_node:   err.node?.name || e.lastNodeExecuted || '',
  error_class:   err.name || 'UnknownError',
  // `message` can embed a response body, so it is deliberately omitted.
  // n8n's own execution record holds the detail for a human to open.
  timestamp:     new Date().toISOString(),
  mode:          e.mode || ''
} }];
"""
    return {
        "name": ERROR_WORKFLOW_NAME,
        "settings": settings(),
        "nodes": [
            node("Error Trigger", "n8n-nodes-base.errorTrigger", 1, (0, 0)),
            code_node("shape safe metadata", (240, 0), js),
        ],
        "connections": chain("Error Trigger", "shape safe metadata"),
    }


# --- Workflow: Review Link Signature helper ----------------------------------

def wf_signature_helper(ctx):
    """HMAC-SHA256 sign and verify for the approve/reject links.

    One implementation, two callers. The previous design had the signer in
    `Webring - Helper - Build Signed Links` and the verifier inlined in
    `Webring - Review Action` -- two copies of one algorithm, which is how
    `compute signature` came to rely on a default `type` while the signer set
    SHA256 explicitly. Sharing the node makes that class of drift impossible.
    """
    build_js = f"""
const inp = $input.first().json;
const mode = (inp.mode || '').toString();
const subId = (inp.submission_id || '').toString();

if (!subId || subId.length > 128) {{
  throw new Error('signature helper: invalid submission_id');
}}

if (mode === 'sign') {{
  const exp = Math.floor(Date.now() / 1000) + {REVIEW_LINK_TTL_SECONDS};
  // One item per decision. The Crypto node runs per item, so all three
  // signatures come out of a single node rather than three parallel ones.
  // `view` is read-only -- it opens the review page rather than acting -- but
  // is signed the same way so an unsigned/tampered submission_id can't be
  // browsed either.
  return ['approve', 'reject', 'view'].map((d) => ({{
    json: {{ mode, submission_id: subId, decision: d, exp, message: `${{subId}}|${{d}}|${{exp}}` }}
  }}));
}}

if (mode === 'verify') {{
  const decision = (inp.decision || '').toString();
  const expRaw = (inp.exp === undefined || inp.exp === null) ? '' : inp.exp.toString();
  const sig = (inp.sig || '').toString().toLowerCase();

  // Shape-check everything before it reaches the comparison. An input that
  // fails here still flows on to the HMAC node and fails the compare, so
  // there is exactly one rejection path rather than two.
  const shape_ok =
    (decision === 'approve' || decision === 'reject' || decision === 'view') &&
    /^[0-9]{{1,12}}$/.test(expRaw) &&
    /^[0-9a-f]{{64}}$/.test(sig);

  const exp = shape_ok ? parseInt(expRaw, 10) : 0;
  return [{{ json: {{
    mode, submission_id: subId, decision, exp, sig, shape_ok,
    message: shape_ok ? `${{subId}}|${{decision}}|${{exp}}` : '\\u0000invalid'
  }} }}];
}}

throw new Error('signature helper: unknown mode ' + JSON.stringify(mode));
"""

    emit_js = f"""
const items = $input.all();
const mode = items[0].json.mode;

if (mode === 'sign') {{
  const out = {{ ok: true }};
  for (const it of items) {{
    const j = it.json;
    const sig = (j.data || '').toLowerCase();
    if (!/^[0-9a-f]{{64}}$/.test(sig)) {{
      throw new Error('signature helper: HMAC did not produce a sha256 hex digest');
    }}
    const qs = [
      'submission_id=' + encodeURIComponent(j.submission_id),
      'decision=' + encodeURIComponent(j.decision),
      'exp=' + encodeURIComponent(j.exp),
      'sig=' + encodeURIComponent(sig)
    ].join('&');
    out[j.decision + '_link'] = {json.dumps(REVIEW_WEBHOOK_BASE)} + '?' + qs;
    out[j.decision + '_sig'] = sig;
    out.exp = j.exp;
  }}
  return [{{ json: out }}];
}}

// verify
const j = items[0].json;
const expected = (j.data || '').toLowerCase();
const got = (j.sig || '').toLowerCase();

// Constant-time compare. Length is checked first because a length-dependent
// early exit is the leak this is guarding against.
let ok = j.shape_ok === true && expected.length === 64 && got.length === 64;
if (ok) {{
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  ok = diff === 0;
}}

// Expiry is only meaningful once the signature is trusted; `exp` is signed, so
// classifying an unsigned link as "expired" would leak that its id was real.
const now = Math.floor(Date.now() / 1000);
const expired = ok && now > j.exp;

return [{{ json: {{
  valid: ok ? 'yes' : 'no',
  expired: expired ? 'yes' : 'no',
  decision: ok ? j.decision : ''
}} }}];
"""

    return {
        "name": "Webring - Helper - Review Link Signature v2",
        "settings": settings(
            error_workflow_id=ctx.get("error_workflow_id"),
            caller_ids=ctx.get("signature_callers", []),
            no_persist=True,
        ),
        "nodes": [
            node("Trigger", "n8n-nodes-base.executeWorkflowTrigger", 1.2, (0, 0), {
                "workflowInputs": {"values": [
                    {"name": "mode", "type": "string"},
                    {"name": "submission_id", "type": "string"},
                    {"name": "decision", "type": "string"},
                    {"name": "exp", "type": "string"},
                    {"name": "sig", "type": "string"},
                ]}
            }),
            code_node("build canonical message", (240, 0), build_js),
            node("hmac sha256", "n8n-nodes-base.crypto", 2, (480, 0),
                 {"action": "hmac", "type": "SHA256",
                  "value": "={{ $json.message }}", "encoding": "hex"},
                 credentials={"crypto": CRYPTO_CREDENTIAL}),
            code_node("emit links or verdict", (720, 0), emit_js),
        ],
        "connections": chain("Trigger", "build canonical message", "hmac sha256",
                             "emit links or verdict"),
    }


# --- Workflow: Re-verify Token helper ----------------------------------------
#
# Sandbox note, measured on this instance 2026-08-22: n8n Code nodes expose
# Buffer, TextEncoder, RegExp, JSON, Date and Intl -- but NOT URL,
# URLSearchParams, crypto, fetch or process. Anything here parses URLs by hand.
# A `new URL()` inside a try/catch does not fail loudly, it silently takes the
# catch branch, which is how the existing Review Action has been dropping
# creator_id on every approval without anyone noticing.

# The private/reserved-range predicate, written once and interpolated (via
# %(range_check_js)s, plain %-substitution -- not an f-string, since this JS
# is full of literal { } that an f-string would need doubled) into both
# `validate url + expiry` (a literal IP the request supplied) and
# `classify resolved ips` below (an IP a hostname resolved to). Restating
# range checks in two Code nodes is the exact failure mode docs/decisions.md's
# entry-id LOCKED entry already paid for once -- slug.js and this file's own
# copy of that rule drifted three ways after being written twice. One
# function, interpolated twice, makes that impossible here instead of merely
# avoided by discipline.
IP_RANGE_CHECK_JS = """
function isUnsafeIPv4(raw) {
  const host = (raw || '').toString().toLowerCase();
  if (!/^[0-9]{1,3}(\\.[0-9]{1,3}){3}$/.test(host)) return true;
  const o = host.split('.').map(Number);
  if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const a = o[0], b = o[1];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;            // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;   // CGNAT
  if (a >= 224) return true;                           // multicast + reserved
  return false;
}

function isUnsafeIPv6(raw) {
  const host = (raw || '').toString().toLowerCase();
  if (host.indexOf(':') === -1) return true;           // not IPv6-shaped at all
  if (host === '::1' || host === '::') return true;
  if (/^f[cd]/.test(host)) return true;                // unique-local fc00::/7
  if (/^fe[89ab]/.test(host)) return true;             // link-local fe80::/10
  if (host.slice(0, 2) === '::') return true;          // mapped/compat (::ffff:x.x.x.x etc.)
  return false;
}
""".strip()

# Written once, interpolated wherever a rate-limit bucket key is derived from
# a source_url: `validate + normalize` below (the value actually stored
# alongside a submission) and `rate status: prep` (a pre-submit read of the
# same bucket). Two hand-written copies of "cheap canonicalisation" are
# exactly the kind of restatement IP_RANGE_CHECK_JS's own comment above
# already paid for once -- a bucket key computed slightly differently in the
# read path than the write path would make the two disagree silently.
CANONICAL_URL_JS = """
function canonical(u) {
  // Cheap canonicalisation so trivial variants share a rate-limit bucket.
  let s = (u || '').toString().trim().toLowerCase();
  s = s.replace(/#.*$/, '').replace(/\\/+$/, '');
  s = s.replace(/^(https?:\\/\\/[^\\/]+):(80|443)/, '$1');
  return s;
}
""".strip()


def wf_reverify_token(ctx):
    """Fetches a submitter-controlled URL and looks for the ownership token.

    This is the SSRF boundary: the only workflow that makes a request to an
    address a stranger chose. It is kept separate from its callers for exactly
    that reason -- one place to audit, one place to restrict.

    Redirects are NOT followed. That is the single most important line here:
    following them would let an attacker bypass every host check below by
    serving a 302 to 169.254.169.254 from a domain that validates cleanly. The
    cost is that a creator must supply the canonical URL rather than one that
    redirects -- which is what belongs in ring.json anyway.
    """
    validate_js = """
const inp = $input.first().json;
const token = (inp.verification_token || '').toString();
const raw = (inp.source_url || '').toString().trim();

const fail = (reason) => [{ json: { proceed: 'no', matched: 'no', reason } }];

// Expiry first: an expired row must never cause an outbound request at all.
const expRaw = (inp.expires_at || '').toString();
const expMs = Date.parse(expRaw);
if (!expRaw || Number.isNaN(expMs) || Date.now() > expMs) return fail('expired');

if (!token || !raw || raw.length > 2048) return fail('unsafe_url');

// Control characters, whitespace and backslashes are how parser-confusion
// tricks are built (https://evil.com\\@good.com and friends). Nothing
// legitimate needs them.
if (/[\\s\\\\]/.test(raw) || /[\\u0000-\\u001f\\u007f]/.test(raw)) return fail('unsafe_url');

// Hand-rolled because URL is not available in this sandbox.
const m = raw.match(/^([A-Za-z][A-Za-z0-9+.-]*):\\/\\/([^\\/?#]*)([\\/?#][\\s\\S]*)?$/);
if (!m) return fail('unsafe_url');

const scheme = m[1].toLowerCase();
if (scheme !== 'http' && scheme !== 'https') return fail('unsafe_url');

let authority = m[2];
if (authority.indexOf('@') !== -1) return fail('unsafe_url');  // userinfo

let host = authority;
let port = '';
if (host.charAt(0) === '[') {                                   // bracketed IPv6
  const close = host.indexOf(']');
  if (close < 0) return fail('unsafe_url');
  port = host.slice(close + 1);
  host = host.slice(1, close);
} else {
  const colon = host.indexOf(':');
  if (colon >= 0) { port = host.slice(colon); host = host.slice(0, colon); }
}
if (port && !/^:[0-9]{1,5}$/.test(port)) return fail('unsafe_url');

host = host.toLowerCase();
if (!host || host.length > 253) return fail('unsafe_url');
// Non-ASCII must arrive already punycoded; deciding homograph equivalence is
// not something to attempt at a security boundary.
if (/[^\\x21-\\x7e]/.test(host)) return fail('unsafe_url');

const isIPv4 = /^[0-9]{1,3}(\\.[0-9]{1,3}){3}$/.test(host);
const isIPv6 = host.indexOf(':') !== -1;
const isName = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host);
if (!isIPv4 && !isIPv6 && !isName) return fail('unsafe_url');

// Rejects the obfuscated numeric forms (2130706433, 0x7f000001, 0177.0.0.1):
// anything all-digits or 0x-prefixed that is not a well-formed dotted quad.
if (!isIPv4 && !isIPv6) {
  if (/^[0-9]+$/.test(host.replace(/\\./g, ''))) return fail('unsafe_url');
  if (/^0x/i.test(host)) return fail('unsafe_url');
}

const blockedNames = ['localhost', 'metadata.google.internal', 'instance-data'];
if (blockedNames.indexOf(host) !== -1) return fail('unsafe_url');
for (const suffix of ['.localhost', '.local', '.internal', '.home.arpa']) {
  if (host.slice(-suffix.length) === suffix) return fail('unsafe_url');
}

%(range_check_js)s

if (isIPv4 && isUnsafeIPv4(host)) return fail('unsafe_url');
if (isIPv6 && isUnsafeIPv6(host)) return fail('unsafe_url');

// A literal IP is now fully range-checked above. A name has not been
// resolved at all -- that gap (a hostname's A/AAAA record pointed at a
// private or metadata address sailed through here untouched, no rebinding
// timing required) was the SSRF a security review found. Hand it to the
// DNS-over-HTTPS lookup later in this workflow ("resolve A" / "resolve
// AAAA" / "classify resolved ips") instead of deciding here.
//
// A dotted-quad also matches `isName`'s generic label regex (digits are
// valid label characters), so this must exclude anything already decided as
// isIPv4/isIPv6 above -- without the guard, a safe literal IP like
// 172.15.1.1 would be misrouted into a DNS lookup for a "hostname" that is
// not one, and `resolve A`'s query would just be the string form of the IP.
if (isName && !isIPv4 && !isIPv6) return [{ json: { proceed: 'check_dns', host, url: raw, token } }];

return [{ json: { proceed: 'yes', url: raw, token } }];
""" % {"range_check_js": IP_RANGE_CHECK_JS}

    classify_js = """
// Both branches of the IF land here: the skip path already carries its verdict,
// so it passes straight through rather than needing a second shaping node.
if ($json.proceed === 'no') {
  return [{ json: { matched: $json.matched, reason: $json.reason } }];
}

const token = $('validate url + expiry').item.json.token;
// The html node REPLACES the item with its extraction, so statusCode is no
// longer on $json by the time this runs -- read it from the fetch directly.
const fetched = $('fetch source_url').item.json;
const status = Number(fetched.statusCode || 0);

// 3xx is not followed (see this workflow's docstring). Reported distinctly so
// the creator is told to use the final URL, not that their tag is missing.
if (status >= 300 && status < 400) return [{ json: { matched: 'no', reason: 'redirect' } }];
if (status < 200 || status >= 400) return [{ json: { matched: 'no', reason: 'unreachable' } }];

// Token values extracted upstream by the html node, which parses rather than
// pattern-matches. The regex this replaces required quoted attribute values, so
// a generator emitting HTML5-legal `content=abc` failed verification and the
// creator was told their tag was missing.
const found = $json.token_values;
const values = Array.isArray(found) ? found : (found === undefined || found === null ? [] : [found]);
for (const v of values) {
  if (v !== null && v !== undefined && v.toString() === token) {
    return [{ json: { matched: 'yes', reason: 'matched' } }];
  }
}
return [{ json: { matched: 'no', reason: 'token_not_found' } }];
"""

    classify_dns_js = """
%(range_check_js)s

const fail = (reason) => [{ json: { proceed: 'no', matched: 'no', reason } }];

const url   = $('validate url + expiry').item.json.url;
const token = $('validate url + expiry').item.json.token;

// Pull well-formed A/AAAA records out of one DoH JSON response. Anything
// that is not a clean 2xx carrying DNS Status 0 (NOERROR) is "no usable
// answer from this query" -- NXDOMAIN, SERVFAIL, a transport failure (the
// error output's `.error` string, same shape `fetch source_url` already
// produces on a DNS/TCP failure) and a malformed body all collapse the same
// way, deliberately: a resolver hiccup must never look identical to "no
// unsafe records found".
function records(resp, wantType) {
  if (!resp || resp.error !== undefined) return null;
  const status = Number(resp.statusCode || 0);
  const body = resp.body;
  if (status < 200 || status >= 300 || !body || body.Status !== 0) return null;
  const answers = Array.isArray(body.Answer) ? body.Answer : [];
  return answers.filter((a) => a && a.type === wantType).map((a) => (a.data || '').toString());
}

const aRecords    = records($('resolve A').item.json, 1);
const aaaaRecords = records($('resolve AAAA').item.json, 28);

// null means that query itself failed to answer at all. NXDOMAIN with an
// empty Answer array is Status 0 with zero records -- `[]`, not null -- and a
// domain with only an AAAA record (or only an A record) is normal, so it
// must not fail here just because the other query came back empty.
if (aRecords === null && aaaaRecords === null) return fail('unresolvable');

const all = [...(aRecords || []), ...(aaaaRecords || [])];
if (all.length === 0) return fail('unresolvable');

// Reject if ANY resolved address is unsafe, not just the first: `fetch
// source_url` does its own separate DNS resolution afterward and may land on
// any of the addresses this lookup saw, round-robin or not.
if (all.some((ip) => (ip.indexOf(':') !== -1 ? isUnsafeIPv6(ip) : isUnsafeIPv4(ip)))) {
  return fail('unsafe_resolved_ip');
}

return [{ json: { proceed: 'yes', url, token } }];
""" % {"range_check_js": IP_RANGE_CHECK_JS}

    return {
        "name": "Webring - Helper - Re-verify Token v2",
        "settings": settings(
            error_workflow_id=ctx.get("error_workflow_id"),
            caller_ids=ctx.get("reverify_callers", []),
        ),
        "nodes": [
            node("Trigger", "n8n-nodes-base.executeWorkflowTrigger", 1.2, (0, 0), {
                "workflowInputs": {"values": [
                    {"name": "source_url", "type": "string"},
                    {"name": "verification_token", "type": "string"},
                    {"name": "expires_at", "type": "string"},
                ]}
            }),
            code_node("validate url + expiry", (240, 0), validate_js),
            node("needs dns check?", "n8n-nodes-base.if", 2.3, (480, 0), {
                "conditions": {
                    "options": {"caseSensitive": True, "leftValue": "",
                                "typeValidation": "loose", "version": 3},
                    "conditions": [{
                        "id": "b1a1e2c3-0000-4000-8000-000000000002",
                        "leftValue": "={{ $json.proceed }}", "rightValue": "check_dns",
                        "operator": {"type": "string", "operation": "equals"},
                    }],
                    "combinator": "and",
                },
                "options": {},
            }),
            # dns.google's JSON API: a plain query-string GET, JSON by default,
            # no custom Accept header needed -- this repo has no existing
            # example of an httpRequest node's header-parameter shape to copy,
            # so a resolver that needs no headers avoids guessing at one.
            # `$json.host` is the current item here, passed through unchanged
            # by `needs dns check?`'s true branch.
            node("resolve A", "n8n-nodes-base.httpRequest", 4.5, (720, 160), {
                "method": "GET",
                "url": "={{ 'https://dns.google/resolve?type=A&name=' + $json.host }}",
                "options": {
                    "timeout": 4000,
                    "redirect": {"redirect": {"followRedirects": False}},
                    "response": {"response": {"neverError": True, "fullResponse": True,
                                              "responseFormat": "json"}},
                },
            }, onError="continueErrorOutput"),
            # Chained after `resolve A`, not parallel to it: this repo has no
            # existing Merge-node usage to copy the parameter shape from, and
            # a serial chain reuses only mechanisms already proven elsewhere in
            # this same workflow. `resolve A`'s own output REPLACES the item's
            # json with its response envelope (same behaviour `check meta
            # tag`'s comment already documents for the html node), so `host`
            # is read from `validate url + expiry` by name instead of `$json`.
            node("resolve AAAA", "n8n-nodes-base.httpRequest", 4.5, (960, 160), {
                "method": "GET",
                "url": "={{ 'https://dns.google/resolve?type=AAAA&name=' + $('validate url + expiry').item.json.host }}",
                "options": {
                    "timeout": 4000,
                    "redirect": {"redirect": {"followRedirects": False}},
                    "response": {"response": {"neverError": True, "fullResponse": True,
                                              "responseFormat": "json"}},
                },
            }, onError="continueErrorOutput"),
            code_node("classify resolved ips", (1200, 160), classify_dns_js),
            node("safe to fetch?", "n8n-nodes-base.if", 2.3, (1440, 0), {
                "conditions": {
                    "options": {"caseSensitive": True, "leftValue": "",
                                "typeValidation": "loose", "version": 3},
                    "conditions": [{
                        "id": "b1a1e2c3-0000-4000-8000-000000000001",
                        "leftValue": "={{ $json.proceed }}", "rightValue": "yes",
                        "operator": {"type": "string", "operation": "equals"},
                    }],
                    "combinator": "and",
                },
                "options": {},
            }),
            node("fetch source_url", "n8n-nodes-base.httpRequest", 4.5, (1680, -80), {
                "method": "GET",
                "url": "={{ $json.url }}",
                "options": {
                    "timeout": 8000,
                    "redirect": {"redirect": {"followRedirects": False}},
                    "response": {"response": {"neverError": True, "fullResponse": True,
                                              "responseFormat": "text"}},
                },
            },
                 # `neverError` only suppresses HTTP status errors. DNS and TCP
                 # failures still throw, which would abort the run and return
                 # nothing to the caller -- the hang this refactor exists to
                 # remove. Route them to the classifier as `unreachable`.
                 onError="continueErrorOutput"),
            # A parser, not a regex. Your instance already uses this node 19 times;
            # extractHtmlContent with returnValue "attribute" is exactly the shape
            # `<meta name=... content=...>` needs, and it handles unquoted values,
            # odd whitespace and attribute order without any of them being special
            # cases here.
            node("extract meta tag", "n8n-nodes-base.html", 1.2, (1920, -80), {
                "operation": "extractHtmlContent",
                "dataPropertyName": "data",
                "extractionValues": {"values": [{
                    "key": "token_values",
                    "cssSelector": 'meta[name="indienode-verification"]',
                    "returnValue": "attribute",
                    "attribute": "content",
                    "returnArray": True}]},
                "options": {}},
                 onError="continueRegularOutput"),
            code_node("check meta tag", (2160, 0), classify_js),
        ],
        "connections": {
            "Trigger": {"main": [[{"node": "validate url + expiry", "type": "main", "index": 0}]]},
            "validate url + expiry": {"main": [[{"node": "needs dns check?", "type": "main", "index": 0}]]},
            "needs dns check?": {"main": [
                [{"node": "resolve A", "type": "main", "index": 0}],
                [{"node": "safe to fetch?", "type": "main", "index": 0}],
            ]},
            "resolve A": {"main": [
                [{"node": "resolve AAAA", "type": "main", "index": 0}],
                [{"node": "resolve AAAA", "type": "main", "index": 0}],
            ]},
            "resolve AAAA": {"main": [
                [{"node": "classify resolved ips", "type": "main", "index": 0}],
                [{"node": "classify resolved ips", "type": "main", "index": 0}],
            ]},
            "classify resolved ips": {"main": [[{"node": "safe to fetch?", "type": "main", "index": 0}]]},
            # Both IF outputs converge on the classifier so neither branch can
            # dead-end and return nothing to the caller.
            "safe to fetch?": {"main": [
                [{"node": "fetch source_url", "type": "main", "index": 0}],
                [{"node": "check meta tag", "type": "main", "index": 0}],
            ]},
            "fetch source_url": {"main": [
                [{"node": "extract meta tag", "type": "main", "index": 0}],
                [{"node": "extract meta tag", "type": "main", "index": 0}],
            ]},
            "extract meta tag": {"main": [[{"node": "check meta tag", "type": "main", "index": 0}]]},
        },
    }



# --- Workflow: Token Lifecycle -----------------------------------------------

def wf_token_lifecycle(ctx):
    """issue_token, request_update_token, bind_source_url and verify.

    These four are one workflow because they are one state machine. All four are
    unauthenticated public actions operating on a single `submissions` row while
    it sits in `pending_verify`, and they share an expiry rule, an error
    vocabulary and a response envelope. Split across four workflows, the
    `pending_verify`-only precondition existed in none of them -- which is how
    `verify` came to re-mark an already-approved row as `verified`, letting a
    submission be replayed into a second PR.

    Precondition table, enforced once in the gate nodes below:

        bind_source_url  pending_verify, and source_url still empty
        verify           pending_verify only
        (submit)         verified only        -- enforced in Finalize Submission
    """
    classify_js = """
const b = $('Trigger').first().json.body || {};
const action = (b.action || '').toString();

const S = (v, max) => {
  const s = (v === undefined || v === null) ? '' : v.toString();
  return s.length > max ? null : s;
};

const err = (code) => [{ json: { route: 'error', error_code: code } }];

const sid = S(b.submission_id, 128);
const nodeId = S(b.node_id, 128);
const srcUrl = S(b.source_url, 2048);
const type = S(b.type, 32);

if (sid === null || nodeId === null || srcUrl === null || type === null) return err('invalid_request');

if (action === 'issue_token') {
  const TYPES = ['audio', 'comic', 'text', 'game', 'art'];
  if (!TYPES.includes(type)) return err('invalid_request');
  // A null/empty source_url is legitimate here and only here: the site
  // generator bakes the token into an export before the site exists anywhere.
  // bind_source_url is the second half of that flow.
  return [{ json: { route: 'issue', mode: srcUrl ? 'new' : 'generated',
                    node_id: '', source_url: srcUrl, type } }];
}

if (action === 'request_update_token') {
  if (!nodeId) return err('invalid_request');
  return [{ json: { route: 'update', mode: 'update', node_id: nodeId } }];
}

if (action === 'bind_source_url') {
  if (!sid || !srcUrl) return err('invalid_request');
  return [{ json: { route: 'bind', submission_id: sid, source_url: srcUrl } }];
}

if (action === 'verify') {
  if (!sid) return err('invalid_request');
  return [{ json: { route: 'verify', submission_id: sid } }];
}

return err('unsupported_action');
"""

    find_node_js = """
const res = $json;
const status = Number(res.statusCode || 0);
// A fetch failure is NOT "node not found". Reporting it as not_found tells a
// creator their node does not exist when in fact GitHub was unreachable.
if (status < 200 || status >= 300) {
  return [{ json: { route: 'error', error_code: 'ring_unavailable' } }];
}

let ring = [];
try {
  const payload = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  const decoded = Buffer.from(payload.content || '', 'base64').toString('utf-8');
  const doc = JSON.parse(decoded);
  // ring.json is a bare array historically and a { version, entries } envelope
  // going forward. Reading both means this workflow does not have to be
  // redeployed in the same breath as the data changing shape -- which it
  // cannot be, since one lives in n8n and the other in git. See src/lib/ring.js.
  ring = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.entries) ? doc.entries : null);
} catch (e) {
  return [{ json: { route: 'error', error_code: 'ring_unavailable' } }];
}
if (!Array.isArray(ring)) return [{ json: { route: 'error', error_code: 'ring_unavailable' } }];

const nodeId = $('classify + validate').first().json.node_id;
const entry = ring.find((e) => e && e.id === nodeId);
if (!entry) return [{ json: { route: 'error', error_code: 'not_found' } }];

// The URL to re-verify against always comes from the live ring, never the
// request body. If a caller could name it, ownership verification would be
// decorative -- see the header comment in src/lib/submissionApi.js.
const srcUrl = (entry.source_url || '').toString();
if (!srcUrl) return [{ json: { route: 'error', error_code: 'not_found' } }];

return [{ json: { route: 'update', mode: 'update', node_id: nodeId,
                  source_url: srcUrl, type: (entry.type || '').toString() } }];
"""

    build_row_js = """
const c = $json;
const now = new Date();
return [{ json: {
  submission_id: c.sid,
  verification_token: c.vtok,
  node_id: c.node_id || '',
  source_url: c.source_url || '',
  // Stored for updates too, so Finalize Submission can check the submitted
  // entry.type against the type committed at issuance.
  type: c.type || '',
  status: 'pending_verify',
  created_at: now.toISOString(),
  expires_at: new Date(now.getTime() + %(ttl)d * 1000).toISOString()
} }];
""" % {"ttl": TOKEN_TTL_SECONDS}

    bind_gate_js = """
const row = $json;
const req = $('classify + validate').first().json;
const bad = (code) => [{ json: { ok: 'no', error_code: code } }];

if (!row || !row.submission_id) return bad('not_found');
if (row.status !== 'pending_verify') return bad('invalid_state');

const expMs = Date.parse(row.expires_at || '');
if (Number.isNaN(expMs) || Date.now() > expMs) return bad('verification_expired');

// Bind is once-only. Allowing a rebind would let a submitter verify a page they
// control and then point the row at a different one.
if ((row.source_url || '').toString()) return bad('already_bound');

// Same scheme/host screening the SSRF helper applies, done here so an unusable
// URL fails at the point it is supplied rather than one step later.
const u = (req.source_url || '').toString();
if (!/^https?:\\/\\//i.test(u) || /[\\s\\\\]/.test(u) || u.length > 2048) return bad('invalid_request');
const host = (u.split('/')[2] || '').split('@').pop().split(':')[0].toLowerCase();
if (!host || host === 'localhost' || /^(127|10|0)\\./.test(host) ||
    /^169\\.254\\./.test(host) || /^192\\.168\\./.test(host) ||
    /^172\\.(1[6-9]|2[0-9]|3[01])\\./.test(host) ||
    host.endsWith('.local') || host.endsWith('.internal')) return bad('invalid_request');

return [{ json: { ok: 'yes', submission_id: row.submission_id, source_url: u } }];
"""

    verify_gate_js = """
const row = $json;
const bad = (code) => [{ json: { ok: 'no', error_code: code } }];

if (!row || !row.submission_id) return bad('not_found');

// The precondition that did not exist before. Without it, `verify` re-marks a
// pending_review or approved row as `verified`, and the submission can be
// finalised again -- a second reviewer notification, and for an approved node a
// second PR against the same member file.
if (row.status !== 'pending_verify') {
  return bad(row.status === 'verified' || row.status === 'pending_review' ||
             row.status === 'approved' ? 'already_verified' : 'invalid_state');
}
if (!(row.source_url || '').toString()) return bad('not_ready');

return [{ json: { ok: 'yes', submission_id: row.submission_id,
                  source_url: row.source_url, verification_token: row.verification_token,
                  expires_at: row.expires_at } }];
"""

    verify_map_js = """
// Helper reasons -> client reasons. `expired` and `unreachable` must stay
// distinct from `token_not_found`: telling someone to check their meta tag when
// their site is down sends them looking in the wrong place.
const r = ($json.reason || '').toString();
const matched = $json.matched === 'yes';
const MAP = {
  matched: 'matched', expired: 'expired', unsafe_url: 'unsafe_url',
  unreachable: 'unreachable', redirect: 'redirect', token_not_found: 'token_not_found',
  // Both DNS-resolution outcomes read to a creator exactly like a bad
  // address: reusing `unsafe_url` avoids inventing client-facing wording for
  // an internal helper's new failure vocabulary.
  unresolvable: 'unsafe_url', unsafe_resolved_ip: 'unsafe_url'
};
return [{ json: { matched: matched ? 'yes' : 'no', reason: MAP[r] || 'token_not_found' } }];
"""

    shape_ok_js = """
const r = $json.route || $json.kind;
if (r === 'token') {
  const row = $('build row').first().json;
  return [{ json: { ok: true, submission_id: row.submission_id,
                    verification_token: row.verification_token,
                    expires_at: row.expires_at } }];
}
return [{ json: $json.payload }];
"""

    shape_err_js = """
// One shaper for every failure path in this workflow. The codes are contract:
// src/lib/submissionError.js and the form's retry affordances read them.
const code = ($json.error_code || 'invalid_request').toString();
const M = {
  invalid_request:      ['That submission was not valid.', false],
  unsupported_action:   ['Unsupported submission action.', false],
  not_found:            ['Unknown node.', false],
  ring_unavailable:     ['Could not reach the ring right now - please try again.', true],
  already_bound:        ['This submission already has a source URL.', false],
  invalid_state:        ['This submission is not in a state that allows that.', false],
  verification_expired: ['This verification token has expired.', false]
};
const [message, retryable] = M[code] || M.invalid_request;
return [{ json: { ok: false, error: { message, code, retryable } } }];
"""

    def sw(val, out):
        return {"conditions": {"options": {"caseSensitive": True, "leftValue": "",
                                           "typeValidation": "loose", "version": 3},
                               "conditions": [{"id": "c0000000-0000-4000-8000-%012d" % out,
                                               "leftValue": "={{ $json.route }}", "rightValue": val,
                                               "operator": {"type": "string", "operation": "equals"}}],
                               "combinator": "and"}}

    def ifnode(name, pos, left, right, idx):
        return node(name, "n8n-nodes-base.if", 2.3, pos, {
            "conditions": {"options": {"caseSensitive": True, "leftValue": "",
                                       "typeValidation": "loose", "version": 3},
                           "conditions": [{"id": "i0000000-0000-4000-8000-%012d" % idx,
                                           "leftValue": left, "rightValue": right,
                                           "operator": {"type": "string", "operation": "equals"}}],
                           "combinator": "and"},
            "options": {}})

    SUB_COLS = dt_columns("submissions")

    def dt_schema():
        return dt_node_schema("submissions")

    return {
        "name": "Webring - Token Lifecycle v2",
        "settings": settings(error_workflow_id=ctx.get("error_workflow_id"),
                             caller_ids=ctx.get("lifecycle_callers", [])),
        "nodes": [
            node("Trigger", "n8n-nodes-base.executeWorkflowTrigger", 1.2, (-880, 0),
                 {"workflowInputs": {"values": [{"name": "body", "type": "object"}]}}),
            code_node("classify + validate", (-660, 0), classify_js),
            node("route", "n8n-nodes-base.switch", 3.4, (-440, 0), {
                "rules": {"values": [sw("issue", 0), sw("update", 1), sw("bind", 2), sw("verify", 3)]},
                # "extra" adds the fallback as an additional output; a bare index
                # that exceeds the rule count silently routes nowhere, which is
                # how every error path was returning an empty body.
                "options": {"fallbackOutput": "extra"}}),

            # issue + update converge here
            node("gen submission_id", "n8n-nodes-base.crypto", 2, (0, -260),
                 {"action": "generate", "dataPropertyName": "sid"}),
            node("gen verification_token", "n8n-nodes-base.crypto", 2, (220, -260),
                 {"action": "generate", "encodingType": "hex", "dataPropertyName": "vtok"}),
            code_node("build row", (440, -260), build_row_js),
            node("insert row", "n8n-nodes-base.dataTable", 1.1, (660, -260), {
                "dataTableId": {"__rl": True, "value": TABLE_SUBMISSIONS, "mode": "list",
                                "cachedResultName": "submissions"},
                "columns": {"mappingMode": "defineBelow",
                            "value": {c: "={{ $json.%s }}" % c for c in
                                      ["submission_id", "node_id", "source_url", "type",
                                       "verification_token", "expires_at", "status", "created_at"]},
                            "matchingColumns": [], "schema": dt_schema(),
                            "attemptToConvertTypes": False, "convertFieldsToString": False},
                "options": {}}),
            code_node("shape token response", (880, -260),
                      "const row = $('build row').first().json;\n"
                      "return [{ json: { ok: true, submission_id: row.submission_id,\n"
                      "  verification_token: row.verification_token, expires_at: row.expires_at } }];"),

            # update lookup
            node("fetch ring.json", "n8n-nodes-base.httpRequest", 4.5, (-220, -120), {
                "url": "https://api.github.com/repos/%s/contents/ring.json" % GITHUB_REPO,
                "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
                "options": {"timeout": 10000,
                            "response": {"response": {"neverError": True, "fullResponse": True,
                                                      "responseFormat": "text"}}}},
                 credentials={"httpHeaderAuth": GITHUB_CREDENTIAL},
                 onError="continueErrorOutput"),
            code_node("find node in ring", (0, -120), find_node_js),
            ifnode("node found?", (220, -120), "={{ $json.route }}", "update", 1),

            # bind
            node("bind: get row", "n8n-nodes-base.dataTable", 1.1, (-220, 60), {
                "operation": "get",
                "dataTableId": {"__rl": True, "value": TABLE_SUBMISSIONS, "mode": "list",
                                "cachedResultName": "submissions"},
                "filters": {"conditions": [{"keyName": "submission_id",
                                            "keyValue": "={{ $json.submission_id }}"}]}},
                 alwaysOutputData=True),
            code_node("bind: gate", (0, 60), bind_gate_js),
            ifnode("bind: ok?", (220, 60), "={{ $json.ok }}", "yes", 2),
            node("bind: update row", "n8n-nodes-base.dataTable", 1.1, (440, 20), {
                "operation": "update",
                "dataTableId": {"__rl": True, "value": TABLE_SUBMISSIONS, "mode": "list",
                                "cachedResultName": "submissions"},
                "filters": {"conditions": [{"keyName": "submission_id",
                                            "keyValue": "={{ $json.submission_id }}"}]},
                "columns": {"mappingMode": "defineBelow",
                            "value": {"source_url": "={{ $json.source_url }}"},
                            "matchingColumns": [], "schema": dt_schema(),
                            "attemptToConvertTypes": False, "convertFieldsToString": False},
                "options": {}}),
            code_node("bind: shape ok", (660, 20), "return [{ json: { ok: true, bound: true } }];"),

            # verify
            node("verify: get row", "n8n-nodes-base.dataTable", 1.1, (-220, 260), {
                "operation": "get",
                "dataTableId": {"__rl": True, "value": TABLE_SUBMISSIONS, "mode": "list",
                                "cachedResultName": "submissions"},
                "filters": {"conditions": [{"keyName": "submission_id",
                                            "keyValue": "={{ $json.submission_id }}"}]}},
                 alwaysOutputData=True),
            code_node("verify: gate", (0, 260), verify_gate_js),
            ifnode("verify: ok?", (220, 260), "={{ $json.ok }}", "yes", 3),
            node("verify: call Re-verify Token v2", "n8n-nodes-base.executeWorkflow", 1.3, (440, 220), {
                "workflowId": {"__rl": True, "value": ctx.get("reverify_id", ""), "mode": "list",
                               "cachedResultName": "Webring - Helper - Re-verify Token v2"},
                "workflowInputs": {"mappingMode": "defineBelow",
                                   "value": {"source_url": "={{ $json.source_url }}",
                                             "verification_token": "={{ $json.verification_token }}",
                                             "expires_at": "={{ $json.expires_at }}"},
                                   "matchingColumns": [""], "schema": [],
                                   "attemptToConvertTypes": False, "convertFieldsToString": True},
                "options": {}}),
            code_node("verify: map reason", (660, 220), verify_map_js),
            ifnode("verify: matched?", (880, 220), "={{ $json.matched }}", "yes", 4),
            node("verify: mark verified", "n8n-nodes-base.dataTable", 1.1, (1100, 180), {
                "operation": "update",
                "dataTableId": {"__rl": True, "value": TABLE_SUBMISSIONS, "mode": "list",
                                "cachedResultName": "submissions"},
                "filters": {"conditions": [{"keyName": "submission_id",
                                            "keyValue": "={{ $('verify: gate').first().json.submission_id }}"}]},
                "columns": {"mappingMode": "defineBelow",
                            "value": {"status": "verified",
                                      "verified_at": "={{ new Date().toISOString() }}"},
                            "matchingColumns": [], "schema": dt_schema(),
                            "attemptToConvertTypes": False, "convertFieldsToString": False},
                "options": {}}),
            code_node("verify: shape verified", (1320, 180),
                      "return [{ json: { ok: true, verified: true } }];"),
            code_node("verify: shape unverified", (1100, 300),
                      "const r = $('verify: map reason').first().json.reason;\n"
                      "return [{ json: { ok: true, verified: false, reason: r } }];"),
            code_node("verify: shape state", (440, 380),
                      "const c = $json.error_code;\n"
                      "if (c === 'already_verified') return [{ json: { ok: true, verified: true } }];\n"
                      "if (c === 'not_ready') return [{ json: { ok: true, verified: false, reason: 'not_ready' } }];\n"
                      "if (c === 'verification_expired') return [{ json: { ok: true, verified: false, reason: 'expired' } }];\n"
                      "return [{ json: { ok: false, error: { message: 'Unknown submission.', code: c || 'not_found', retryable: false } } }];"),

            code_node("shape error", (440, 520), shape_err_js),
        ],
        "connections": {
            "Trigger": {"main": [[{"node": "classify + validate", "type": "main", "index": 0}]]},
            "classify + validate": {"main": [[{"node": "route", "type": "main", "index": 0}]]},
            "route": {"main": [
                [{"node": "gen submission_id", "type": "main", "index": 0}],
                [{"node": "fetch ring.json", "type": "main", "index": 0}],
                [{"node": "bind: get row", "type": "main", "index": 0}],
                [{"node": "verify: get row", "type": "main", "index": 0}],
                [{"node": "shape error", "type": "main", "index": 0}],
            ]},
            "gen submission_id": {"main": [[{"node": "gen verification_token", "type": "main", "index": 0}]]},
            "gen verification_token": {"main": [[{"node": "build row", "type": "main", "index": 0}]]},
            "build row": {"main": [[{"node": "insert row", "type": "main", "index": 0}]]},
            "insert row": {"main": [[{"node": "shape token response", "type": "main", "index": 0}]]},
            "fetch ring.json": {"main": [
                [{"node": "find node in ring", "type": "main", "index": 0}],
                [{"node": "find node in ring", "type": "main", "index": 0}],
            ]},
            "find node in ring": {"main": [[{"node": "node found?", "type": "main", "index": 0}]]},
            "node found?": {"main": [
                [{"node": "gen submission_id", "type": "main", "index": 0}],
                [{"node": "shape error", "type": "main", "index": 0}],
            ]},
            "bind: get row": {"main": [[{"node": "bind: gate", "type": "main", "index": 0}]]},
            "bind: gate": {"main": [[{"node": "bind: ok?", "type": "main", "index": 0}]]},
            "bind: ok?": {"main": [
                [{"node": "bind: update row", "type": "main", "index": 0}],
                [{"node": "shape error", "type": "main", "index": 0}],
            ]},
            "bind: update row": {"main": [[{"node": "bind: shape ok", "type": "main", "index": 0}]]},
            "verify: get row": {"main": [[{"node": "verify: gate", "type": "main", "index": 0}]]},
            "verify: gate": {"main": [[{"node": "verify: ok?", "type": "main", "index": 0}]]},
            "verify: ok?": {"main": [
                [{"node": "verify: call Re-verify Token v2", "type": "main", "index": 0}],
                [{"node": "verify: shape state", "type": "main", "index": 0}],
            ]},
            "verify: call Re-verify Token v2": {"main": [[{"node": "verify: map reason", "type": "main", "index": 0}]]},
            "verify: map reason": {"main": [[{"node": "verify: matched?", "type": "main", "index": 0}]]},
            "verify: matched?": {"main": [
                [{"node": "verify: mark verified", "type": "main", "index": 0}],
                [{"node": "verify: shape unverified", "type": "main", "index": 0}],
            ]},
            "verify: mark verified": {"main": [[{"node": "verify: shape verified", "type": "main", "index": 0}]]},
        },
    }




# --- Workflow: Finalize Submission -------------------------------------------

def wf_finalize_submission(ctx):
    """submit and submit_update.

    The two source workflows were structurally identical apart from the
    Turnstile branch and the shape of the review block, so every node existed
    twice. Here the branches diverge only where policy actually differs.

    The rate-limit helper is inlined: after the merge it had exactly one caller.
    """
    validate_js = """
const row = $json;
const b = $('Trigger').first().json.body || {};
const bad = (code) => [{ json: { ok: 'no', error_code: code } }];

if (!row || !row.submission_id) return bad('not_found');

// Finalisation is legal from `verified`, and from `notification_failed` --
// the row is already persisted there and the only thing outstanding is the
// reviewer notification, so a retry must resume rather than be rejected.
// Anything else is a replay, a double-submit, or an out-of-order client.
const resume = row.status === 'notification_failed';
if (row.status !== 'verified' && !resume) {
  // A stale claiming- marker means the run that stamped it died; the row would
  // otherwise be stranded, finalisable by nobody. See STALE_CLAIM_SECONDS.
  const st = String(row.status || '');
  if (st.indexOf('claiming-') === 0) {
    const stamped = Number(st.split('-').pop());
    if (Number.isFinite(stamped) && (Date.now() - stamped) > %(stale)d) {
      // fall through and let this run reclaim it
    } else {
      return bad('already_submitted');
    }
  } else {
    const inflight = st === 'pending_review' || st === 'approved';
    return bad(inflight ? 'already_submitted' : 'not_verified');
  }
}

// A finalize that lands moments after a successful verify need not re-fetch
// the creator's source_url a second time -- see REVERIFY_SKIP_TTL_SECONDS.
// Never on a resume: that row can be arbitrarily old.
const verifiedAtMs = Date.parse(row.verified_at || '');
const skipReverify = !resume && !Number.isNaN(verifiedAtMs) &&
                     (Date.now() - verifiedAtMs) < %(skip_ttl)d;

const expMs = Date.parse(row.expires_at || '');
if (Number.isNaN(expMs) || Date.now() > expMs) return bad('verification_expired');

const action = (b.action || '').toString();
const isUpdate = action === 'submit_update';
// Withdrawal. Reaches here through exactly the same token-and-verify path a
// change does, because the claim is the same one: control of the page the
// node points at. What differs is only what happens after approval.
const isRemoval = action === 'request_removal';
const storedNode = (row.node_id || '').toString();

// Both update and removal act on a node that already exists, so both must have
// been issued against one; a plain submission must not have been.
if ((isUpdate || isRemoval) !== Boolean(storedNode)) return bad('invalid_state');

// A removal carries no entry: there is nothing to publish, only something to
// take away. Everything from here to the review block is about validating a
// payload that a removal does not have.
const entry = isRemoval ? {} : b.entry;
if (!isRemoval && (!entry || typeof entry !== 'object' || Array.isArray(entry))) {
  return bad('invalid_request');
}
if (!isRemoval) {

// Structural check against schema/ring.schema.json, so a reviewer never sees a
// submission that cannot pass validate:publish after approval.
const TYPES = ['audio', 'comic', 'text', 'game', 'art'];
const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
if (!str(entry.creator, 200)) return bad('invalid_request');
if (!TYPES.includes(entry.type)) return bad('invalid_request');
if (!str(entry.why, 400)) return bad('invalid_request');
if (!Array.isArray(entry.tags) || entry.tags.length < 1 ||
    !entry.tags.every((t) => str(t, 60))) return bad('invalid_request');
const https = (v, max = 2048) => str(v, max) && v.toLowerCase().startsWith('https://');
const externalMedia = (v) => {
  if (!https(v)) return false;
  const host = v.slice(8).split('/')[0].split('@').pop().split(':')[0].toLowerCase();
  return Boolean(host) && host !== 'indienodes.us' && !host.endsWith('.indienodes.us');
};
if (entry.type === 'art') {
  const fields = ['image_url', 'alt', 'title', 'year', 'medium', 'external_url'];
  if (!Array.isArray(entry.artworks) || entry.artworks.length < 1 ||
      entry.artworks.length > 3) return bad('invalid_request');
  if (!entry.artworks.every((artwork) => artwork && typeof artwork === 'object' &&
      !Array.isArray(artwork) && Object.keys(artwork).every((key) => fields.includes(key)) &&
      externalMedia(artwork.image_url) && str(artwork.alt, 2000) &&
      ['title', 'year', 'medium'].every((key) => artwork[key] === undefined || str(artwork[key], 2000)) &&
      (artwork.external_url === undefined || https(artwork.external_url)))) {
    return bad('invalid_request');
  }
}
if (entry.type === 'game') {
  if (entry.preview_url !== undefined && !externalMedia(entry.preview_url)) {
    return bad('invalid_request');
  }
  if (entry.trailer_url !== undefined) {
    const trailer = String(entry.trailer_url);
    const youtubeTrailer =
      /^https:\\/\\/(?:(?:(?:www|m|music)\\.)?youtube\\.com\\/(?:watch\\?(?:[^#]*&)?v=|embed\\/|shorts\\/|live\\/)|(?:www\\.)?youtu\\.be\\/)[A-Za-z0-9_-]{11}(?:[?&#/]|$)/.test(trailer);
    if (!youtubeTrailer) {
      return bad('invalid_request');
    }
  }
}

// The type was committed when the token was issued; it cannot change now.
if (row.type && entry.type !== row.type) return bad('invalid_request');

// The id the form previewed and a generated site already embeds. Carried on
// the stored entry blob rather than in its own Data Table column, because the
// blob is internal and the finalize allowlist decides what is published --
// `requested_id` is not on that list, so it never reaches ring.json.
//
// Advisory only: approval honours it if it is still free and re-derives
// otherwise. Validated to the schema's own id pattern here as well as at
// approval, since it travels through a file path and a branch name.
const reqId = (b.requested_id || '').toString();
if (reqId && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(reqId) && reqId.length <= 64) {
  entry.requested_id = reqId;
}

}   // end of the entry checks a removal has nothing to run

// For updates and removals the request's node_id is validated then discarded
// -- only the stored value is ever used downstream.
if (isUpdate || isRemoval) {
  const reqNode = (b.node_id || '').toString();
  if (reqNode && reqNode !== storedNode) return bad('invalid_state');
}

// Turnstile policy. submit (new) is deliberately unguarded -- see the
// submitUpdate doc comment in src/lib/submissionApi.js; submit_update is the
// one action Turnstile covers. Whether it runs at all is a deploy-time
// decision (TURNSTILE_ENABLED), not a value read at runtime.
const tsToken = (b.turnstile_token || '').toString();
let needsTurnstile = 'no';
// A removal is guarded too: it is at least as consequential as a change, and
// unlike a new submission there is a specific existing node being acted on.
if (%(ts_enabled)s && (isUpdate || isRemoval)) {
  if (!tsToken) return bad('turnstile_failed');   // required but not supplied
  needsTurnstile = 'yes';
}

// Review block: new submissions carry the full block, updates carry only an
// email. Both normalise to one internal shape so the reviewer notification and
// the reject path do not have to care which action created the row.
const hasEntryBlock = !isUpdate && !isRemoval;
const rv = hasEntryBlock ? (b.review && typeof b.review === 'object' ? b.review : null) : {};
if (hasEntryBlock && !rv) return bad('invalid_request');

// A removal collects no address at all. There is nothing to send afterwards:
// the person asked for this, and this project does not keep somewhere to write
// to. An update still carries one because its outcome is a decision the
// submitter has not already made.
const email = (isRemoval ? '' : (isUpdate ? (b.email || '') : (rv.email || ''))).toString();
if (!isRemoval && (!email || email.length > 320 || email.indexOf('@') < 1)) {
  return bad('invalid_request');
}

// Offered, never required -- someone withdrawing their own work owes no
// explanation, so an absent reason is a complete request, not a partial one.
const reason = isRemoval ? (b.reason || '').toString().slice(0, 2000) : '';

const review = {
  mode: isRemoval ? 'remove' : (isUpdate ? 'update' : 'new'),
  node_id: storedNode || null,
  email,
  reason: isRemoval ? reason : null,
  rights_confirmation: hasEntryBlock ? rv.rights_confirmation === true : null,
  eula_agreement: hasEntryBlock ? rv.eula_agreement === true : null,
  pro_membership: hasEntryBlock ? (rv.pro_membership || null) : null,
  pro_membership_name: hasEntryBlock ? (rv.pro_membership_name || null) : null
};
if (hasEntryBlock && (review.rights_confirmation !== true || review.eula_agreement !== true)) {
  return bad('invalid_request');
}

// The salt is an HMAC credential and the Gotify server is a credential, so
// neither can be "missing" at runtime -- n8n refuses to publish a node whose
// required credential is absent. That check moved from here to deploy time.

return [{ json: {
  ok: 'yes', needsTurnstile, resume: resume ? 'yes' : 'no',
  skip_reverify: skipReverify ? 'yes' : 'no',
  submission_id: row.submission_id, source_url: row.source_url,
  verification_token: row.verification_token, expires_at: row.expires_at,
  type: (row.type || '').toString(),
  node_id: storedNode, is_update: isUpdate ? 'yes' : 'no',
  is_removal: isRemoval ? 'yes' : 'no',
  entry, review, email,
  turnstile_token: tsToken,
  // Just the canonicalised URL. The salt is applied by the HMAC node from a
  // credential and never becomes an item field.
  rate_key: canonical(row.source_url)
} }];

%(canonical_js)s
""" % {"ts_enabled": "true" if TURNSTILE_ENABLED else "false",
       "stale": STALE_CLAIM_SECONDS * 1000,
       "skip_ttl": REVERIFY_SKIP_TTL_SECONDS * 1000,
       "canonical_js": CANONICAL_URL_JS}

    rate_js = """
const rows = $input.all().map((i) => i.json).filter((r) => r && r.created_at);
const WINDOW = %(win)d * 1000;
// The old helper read only the first row returned, which is the OLDEST. Once
// that aged past the window every later check passed, so the limiter silently
// stopped working an hour after the first submission. Take the newest.
let newest = 0;
for (const r of rows) {
  const t = Date.parse(r.created_at);
  if (!Number.isNaN(t) && t > newest) newest = t;
}
// A resume is retrying a notification for a submission that already passed the
// limiter. Charging it again would lock the submitter out of a failure that was
// ours, not theirs. A verified voluntary removal also bypasses the wait: the
// member is asking us to stop publishing their work, and a recent join/update
// must never force them to stay listed for an extra hour. The successful
// removal still records this source below, so repeated requests remain limited.
const normalized = $('validate + normalize').first().json;
const resume = normalized.resume === 'yes';
const isRemoval = normalized.is_removal === 'yes';
const blocked = !resume && !isRemoval && newest > 0 && (Date.now() - newest) < WINDOW;
return [{ json: { blocked: blocked ? 'yes' : 'no',
                  existing_row_id: rows.length ? ($input.all()[0].json.id ?? null) : null } }];
""" % {"win": RATE_LIMIT_WINDOW_SECONDS}

    notify_js = r"""
const c = $('validate + normalize').first().json;
const links = $('sign review links').first().json;
const e = c.entry, r = c.review;

// Short by design: every submitted field, the source link, and the
// approve/reject actions now live on the review page (view_link). Cramming
// them into a push notification was the thing this replaces.
const isRemoval = r.mode === 'remove';
const lines = isRemoval
  ? [
      `REMOVAL REQUEST for node ${c.node_id}`,
      `type: ${c.type || 'unknown'}`,
      `verified source: ${c.source_url}`,
      r.reason ? `reason: ${r.reason}` : 'reason: none provided',
      `Review: ${links.view_link}`
    ]
  : [
      r.mode === 'update' ? `UPDATE to node ${c.node_id}` : 'NEW SUBMISSION',
      `type: ${e.type}`,
      `creator: ${e.creator}`,
      `Review: ${links.view_link}`
    ];

// Channel-neutral. Each delivery branch shapes its own payload from these two
// fields, so adding a channel later does not touch this node. Nothing here is
// interpolated into markup or a mention-parsing context, which is why the
// Discord-era allowed_mentions guard is no longer needed.
return [{ json: {
  title: isRemoval
    ? `Removal request: ${c.node_id}`
    : (r.mode === 'update' ? 'Node update: ' : 'New submission: ') + e.type + ' by ' + e.creator,
  body: lines.join('\n').slice(0, 4000)
} }];
"""

    SUB_COLS = dt_columns("submissions")
    def dt_schema():
        return dt_node_schema("submissions")

    def ifn(name, pos, left, right, idx):
        return node(name, "n8n-nodes-base.if", 2.3, pos, {
            "conditions": {"options": {"caseSensitive": True, "leftValue": "",
                                       "typeValidation": "loose", "version": 3},
                           "conditions": [{"id": "f0000000-0000-4000-8000-%012d" % idx,
                                           "leftValue": left, "rightValue": right,
                                           "operator": {"type": "string", "operation": "equals"}}],
                           "combinator": "and"}, "options": {}})

    def subtable():
        return {"__rl": True, "value": TABLE_SUBMISSIONS, "mode": "list",
                "cachedResultName": "submissions"}

    return {
        "name": "Webring - Action - Finalize Submission v2",
        "settings": settings(error_workflow_id=ctx.get("error_workflow_id"),
                             caller_ids=ctx.get("finalize_callers", [])),
        "nodes": [
            node("Trigger", "n8n-nodes-base.executeWorkflowTrigger", 1.2, (-1100, 0),
                 {"workflowInputs": {"values": [{"name": "body", "type": "object"}]}}),
            # One unfiltered read replaces the three filtered per-key config
            # nodes the old workflows used.
            node("get submission row", "n8n-nodes-base.dataTable", 1.1, (-660, 0), {
                "operation": "get", "dataTableId": subtable(),
                "filters": {"conditions": [{"keyName": "submission_id",
                                            "keyValue": "={{ $('Trigger').first().json.body.submission_id }}"}]}},
                 alwaysOutputData=True),
            code_node("validate + normalize", (-440, 0), validate_js),
            ifn("eligible?", (-220, 0), "={{ $json.ok }}", "yes", 1),

            # Skips the second fetch to the creator's source_url when `verify`
            # already succeeded moments ago -- see REVERIFY_SKIP_TTL_SECONDS.
            ifn("skip re-verify?", (-110, -140),
                "={{ $('validate + normalize').first().json.skip_reverify }}", "yes", 9),
            code_node("skip re-verify: shape matched", (-110, -220),
                      "return [{ json: { matched: 'yes' } }];"),

            node("call Re-verify Token v2", "n8n-nodes-base.executeWorkflow", 1.3, (0, -60), {
                "workflowId": {"__rl": True, "value": ctx.get("reverify_id", ""), "mode": "list",
                               "cachedResultName": "Webring - Helper - Re-verify Token v2"},
                "workflowInputs": {"mappingMode": "defineBelow",
                                   "value": {"source_url": "={{ $json.source_url }}",
                                             "verification_token": "={{ $json.verification_token }}",
                                             "expires_at": "={{ $json.expires_at }}"},
                                   "matchingColumns": [""], "schema": [],
                                   "attemptToConvertTypes": False, "convertFieldsToString": True},
                "options": {}}),
            ifn("ownership still proven?", (220, -60), "={{ $json.matched }}", "yes", 2),
            # Turnstile nodes exist only when the feature is on. Leaving them in
            # the graph while disabled is not free: the siteverify node requires
            # an httpCustomAuth credential, and n8n refuses to publish a node
            # whose required credential is absent.
            *([
                ifn("needs turnstile?", (440, -60), "={{ $('validate + normalize').first().json.needsTurnstile }}", "yes", 3),
            node("verify turnstile", "n8n-nodes-base.httpRequest", 4.5, (660, -140), {
                "method": "POST", "url": "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                "sendBody": True, "specifyBody": "json",
                "authentication": "genericCredentialType", "genericAuthType": "httpCustomAuth",
                # `secret` is injected into the body by the credential -- verified
                # 2026-08-22 -- so it is never in the workflow JSON or an item.
                "jsonBody": "={{ JSON.stringify({ response: $('validate + normalize').first().json.turnstile_token }) }}",
                "options": {"timeout": 8000,
                            "response": {"response": {"neverError": True, "fullResponse": True,
                                                      "responseFormat": "json"}}}},
                 credentials={"httpCustomAuth": TURNSTILE_CREDENTIAL},
                 onError="continueErrorOutput"),
            code_node("turnstile verdict", (880, -140),
                      "const s = Number($json.statusCode || 0);\n"
                      "const b = $json.body || {};\n"
                      "// Timeouts, non-JSON and HTTP errors are all failures.\n"
                      "const passed = s >= 200 && s < 300 && b && b.success === true;\n"
                      "return [{ json: { ok: passed ? 'yes' : 'no', error_code: 'turnstile_failed' } }];"),
            ifn("turnstile passed?", (1100, -140), "={{ $json.ok }}", "yes", 4),
            ] if TURNSTILE_ENABLED else []),

            # HMAC, not hash-of-salt-plus-value: the key lives in a credential and
            # is resolved inside the node, so the salt never enters the item stream.
            node("rate: hash", "n8n-nodes-base.crypto", 2, (880, 60),
                 {"action": "hmac", "type": "SHA256",
                  "value": "={{ $('validate + normalize').first().json.rate_key }}",
                  "encoding": "hex", "dataPropertyName": "hash"},
                 credentials={"crypto": RATE_LIMIT_CREDENTIAL}),
            node("rate: get rows", "n8n-nodes-base.dataTable", 1.1, (1100, 60), {
                "operation": "get",
                "dataTableId": {"__rl": True, "value": TABLE_RATE_LIMITS, "mode": "list",
                                "cachedResultName": "rate_limits"},
                "filters": {"conditions": [{"keyName": "source_url_hash",
                                            "keyValue": "={{ $json.hash }}"}]}},
                 alwaysOutputData=True),
            code_node("rate: decide", (1320, 60), rate_js),
            ifn("rate limited?", (1540, 60), "={{ $json.blocked }}", "yes", 5),

            # Optimistic claim. n8n Data Table filters OR their conditions
            # (measured 2026-08-22), so "submission_id = X AND status =
            # verified" cannot be expressed -- attempting it updates every row
            # matching EITHER term. Instead: stamp a marker unique to this
            # execution filtered on the unique key alone, read it back, and
            # proceed only if the marker still says it is ours. Last write wins,
            # so exactly one concurrent run sees its own marker.
            node("claim: stamp marker", "n8n-nodes-base.dataTable", 1.1, (1760, 120), {
                "operation": "update", "dataTableId": subtable(),
                "filters": {"conditions": [
                    {"keyName": "submission_id",
                     "keyValue": "={{ $('validate + normalize').first().json.submission_id }}"}]},
                "columns": {"mappingMode": "defineBelow", "value": {
                    "status": "=claiming-{{ $execution.id }}-{{ Date.now() }}",
                    "entry": "={{ JSON.stringify($('validate + normalize').first().json.entry) }}",
                    "review": "={{ JSON.stringify($('validate + normalize').first().json.review) }}",
                    "email": "={{ $('validate + normalize').first().json.email }}"},
                    "matchingColumns": [], "schema": dt_schema(),
                    "attemptToConvertTypes": False, "convertFieldsToString": False},
                "options": {}}, alwaysOutputData=True),
            node("claim: read back", "n8n-nodes-base.dataTable", 1.1, (1980, 120), {
                "operation": "get", "dataTableId": subtable(),
                "filters": {"conditions": [
                    {"keyName": "submission_id",
                     "keyValue": "={{ $('validate + normalize').first().json.submission_id }}"}]}},
                 alwaysOutputData=True),
            code_node("claim: won?", (2200, 120),
                      "const mine = 'claiming-' + $execution.id + '-';\n"
                      "const status = ($json && $json.status) ? String($json.status) : '';\n"
                      "// A previous read is not a lock. Only the run whose marker survived\n"
                      "// the read-back may send a notification.\n"
                      "return [{ json: { ok: status.indexOf(mine) === 0 ? 'yes' : 'no',\n"
                      "                  error_code: 'already_submitted' } }];"),
            ifn("claimed?", (2420, 120), "={{ $json.ok }}", "yes", 6),
            node("claim: set pending_review", "n8n-nodes-base.dataTable", 1.1, (2420, 20), {
                "operation": "update", "dataTableId": subtable(),
                "filters": {"conditions": [
                    {"keyName": "submission_id",
                     "keyValue": "={{ $('validate + normalize').first().json.submission_id }}"}]},
                "columns": {"mappingMode": "defineBelow",
                            "value": {"status": "pending_review", "verification_token": ""},
                            "matchingColumns": [], "schema": dt_schema(),
                            "attemptToConvertTypes": False, "convertFieldsToString": False},
                "options": {}}),
            node("rate: record", "n8n-nodes-base.dataTable", 1.1, (2420, 60), {
                "dataTableId": {"__rl": True, "value": TABLE_RATE_LIMITS, "mode": "list",
                                "cachedResultName": "rate_limits"},
                "columns": {"mappingMode": "defineBelow",
                            "value": {"source_url_hash": "={{ $('rate: hash').first().json.hash }}",
                                      "created_at": "={{ new Date().toISOString() }}"},
                            "matchingColumns": [], "schema": dt_node_schema("rate_limits"),
                            "attemptToConvertTypes": False, "convertFieldsToString": False},
                "options": {}}),
            node("sign review links", "n8n-nodes-base.executeWorkflow", 1.3, (2640, 60), {
                "workflowId": {"__rl": True, "value": ctx.get("signature_id", ""), "mode": "list",
                               "cachedResultName": "Webring - Helper - Review Link Signature v2"},
                "workflowInputs": {"mappingMode": "defineBelow",
                                   "value": {"mode": "sign",
                                             "submission_id": "={{ $('validate + normalize').first().json.submission_id }}",
                                             "decision": "", "exp": "", "sig": ""},
                                   "matchingColumns": [""], "schema": [],
                                   "attemptToConvertTypes": False, "convertFieldsToString": True},
                "options": {}}),
            code_node("build reviewer notification", (2860, 60), notify_js),
            # Native Gotify node. The server URL and app token both live in the
            # credential, so neither is workflow data and neither can be absent at
            # runtime -- n8n refuses to publish a node missing a required
            # credential, which is a stronger guarantee than the runtime string
            # check this replaces.
            node("notify: gotify", "n8n-nodes-base.gotify", 1, (3080, 20), {
                "message": "={{ $json.body }}",
                # Plain text. The node has no markdown support: both `contentType`
                # and `extras` persist in n8n's own schema but Gotify receives
                # `extras: null`, verified against the message it returns. Markdown
                # would mean going back to a raw HTTP node and giving up the
                # credential handling, which is not worth bold text.
                "additionalFields": {"title": "={{ $json.title }}", "priority": 7}},
                 credentials={"gotifyApi": GOTIFY_CREDENTIAL},
                 onError="continueErrorOutput"),
            code_node("gotify delivered?", (3300, 20),
                      "// The node throws on transport or API failure and that lands on the\n"
                      "// error output, so an item arriving here having kept its id is a\n"
                      "// delivered message. Anything else falls through to mail.\n"
                      "const failed = Boolean($json.error) || $json.__error === true;\n"
                      "return [{ json: { ok: failed ? 'no' : 'yes' } }];"),
            ifn("gotify ok?", (3520, 20), "={{ $json.ok }}", "yes", 7),

            # Fallback. Reached when Gotify is unset, down, or rejects.
            node("notify: email fallback", "n8n-nodes-base.emailSend", 2.1, (3520, 180), {
                "fromEmail": NOTIFY_FROM_EMAIL,
                "toEmail": REVIEWER_EMAIL,
                "subject": "={{ $('build reviewer notification').first().json.title }}",
                "emailFormat": "text",
                "text": "={{ $('build reviewer notification').first().json.body }}",
                "options": {}},
                 credentials={"smtp": SMTP_CREDENTIAL},
                 onError="continueErrorOutput"),
            code_node("email delivered?", (3740, 180),
                      "// The Send Email node throws on failure rather than returning a\n"
                      "// status, so an item arriving on the success output is the signal.\n"
                      "const failed = Boolean($json.error) || $json.__error === true;\n"
                      "return [{ json: { ok: failed ? 'no' : 'yes' } }];"),
            ifn("notification delivered?", (3960, 180), "={{ $json.ok }}", "yes", 8),
            node("mark notification_failed", "n8n-nodes-base.dataTable", 1.1, (3740, 140), {
                "operation": "update", "dataTableId": subtable(),
                "filters": {"conditions": [{"keyName": "submission_id",
                                            "keyValue": "={{ $('validate + normalize').first().json.submission_id }}"}]},
                "columns": {"mappingMode": "defineBelow",
                            "value": {"status": "notification_failed"},
                            "matchingColumns": [], "schema": dt_schema(),
                            "attemptToConvertTypes": False, "convertFieldsToString": False},
                "options": {}}),
            code_node("shape notify_failed", (3960, 140),
                      "// The row is preserved at notification_failed so a retry resumes\n"
                      "// rather than creating a second submission.\n"
                      "return [{ json: { ok: false, error: { message: 'Saved, but the reviewer could not be notified. Please retry.', code: 'notification_failed', retryable: true } } }];"),
            code_node("shape success", (3740, -20),
                      "return [{ json: { ok: true, reference: $('validate + normalize').first().json.submission_id } }];"),
            code_node("shape error", (0, 320),
                      "const code = ($json.error_code || 'invalid_request').toString();\n"
                      "const M = {\n"
                      "  invalid_request:      ['That submission was not valid.', false],\n"
                      "  not_found:            ['Unknown submission.', false],\n"
                      "  not_verified:         ['Submission is not verified.', false],\n"
                      "  already_submitted:    ['This submission was already sent for review.', false],\n"
                      "  invalid_state:        ['This submission is not in a state that allows that.', false],\n"
                      "  verification_expired: ['This verification token has expired.', false],\n"
                      "  verification_lapsed:  ['Verification lapsed - please verify again.', true],\n"
                      "  turnstile_failed:     ['Spam check failed - please try again.', true],\n"
                      "  rate_limited:         ['Please wait before submitting again.', true],\n"
                      "  service_misconfigured:['Submissions are temporarily unavailable.', true]\n"
                      "};\n"
                      "const [message, retryable] = M[code] || M.invalid_request;\n"
                      "return [{ json: { ok: false, error: { message, code, retryable } } }];"),
            code_node("lapsed", (220, 200),
                      "const r = ($json.reason || '').toString();\n"
                      "return [{ json: { error_code: r === 'expired' ? 'verification_expired' : 'verification_lapsed' } }];"),
            code_node("rate limited", (1540, 240),
                      "return [{ json: { error_code: 'rate_limited' } }];"),
        ],
        "connections": {
            "Trigger": {"main": [[{"node": "get submission row", "type": "main", "index": 0}]]},
            "get submission row": {"main": [[{"node": "validate + normalize", "type": "main", "index": 0}]]},
            "validate + normalize": {"main": [[{"node": "eligible?", "type": "main", "index": 0}]]},
            "eligible?": {"main": [
                [{"node": "skip re-verify?", "type": "main", "index": 0}],
                [{"node": "shape error", "type": "main", "index": 0}]]},
            "skip re-verify?": {"main": [
                [{"node": "skip re-verify: shape matched", "type": "main", "index": 0}],
                [{"node": "call Re-verify Token v2", "type": "main", "index": 0}]]},
            "skip re-verify: shape matched": {"main": [[{"node": "ownership still proven?", "type": "main", "index": 0}]]},
            "call Re-verify Token v2": {"main": [[{"node": "ownership still proven?", "type": "main", "index": 0}]]},
            "ownership still proven?": {"main": [
                [{"node": "needs turnstile?" if TURNSTILE_ENABLED else "rate: hash",
                  "type": "main", "index": 0}],
                [{"node": "lapsed", "type": "main", "index": 0}]]},
            "lapsed": {"main": [[{"node": "shape error", "type": "main", "index": 0}]]},
            **({
                "needs turnstile?": {"main": [
                    [{"node": "verify turnstile", "type": "main", "index": 0}],
                    [{"node": "rate: hash", "type": "main", "index": 0}]]},
                "verify turnstile": {"main": [
                    [{"node": "turnstile verdict", "type": "main", "index": 0}],
                    [{"node": "turnstile verdict", "type": "main", "index": 0}]]},
                "turnstile verdict": {"main": [[{"node": "turnstile passed?", "type": "main", "index": 0}]]},
                "turnstile passed?": {"main": [
                    [{"node": "rate: hash", "type": "main", "index": 0}],
                    [{"node": "shape error", "type": "main", "index": 0}]]},
            } if TURNSTILE_ENABLED else {}),
            "rate: hash": {"main": [[{"node": "rate: get rows", "type": "main", "index": 0}]]},
            "rate: get rows": {"main": [[{"node": "rate: decide", "type": "main", "index": 0}]]},
            "rate: decide": {"main": [[{"node": "rate limited?", "type": "main", "index": 0}]]},
            "rate limited?": {"main": [
                [{"node": "rate limited", "type": "main", "index": 0}],
                [{"node": "claim: stamp marker", "type": "main", "index": 0}]]},
            "rate limited": {"main": [[{"node": "shape error", "type": "main", "index": 0}]]},
            "claim: stamp marker": {"main": [[{"node": "claim: read back", "type": "main", "index": 0}]]},
            "claim: read back": {"main": [[{"node": "claim: won?", "type": "main", "index": 0}]]},
            "claim: won?": {"main": [[{"node": "claimed?", "type": "main", "index": 0}]]},
            "claimed?": {"main": [
                [{"node": "claim: set pending_review", "type": "main", "index": 0}],
                [{"node": "shape error", "type": "main", "index": 0}]]},
            "claim: set pending_review": {"main": [[{"node": "rate: record", "type": "main", "index": 0}]]},
            "rate: record": {"main": [[{"node": "sign review links", "type": "main", "index": 0}]]},
            "sign review links": {"main": [[{"node": "build reviewer notification", "type": "main", "index": 0}]]},
            "build reviewer notification": {"main": [[{"node": "notify: gotify", "type": "main", "index": 0}]]},
            "notify: gotify": {"main": [
                [{"node": "gotify delivered?", "type": "main", "index": 0}],
                [{"node": "gotify delivered?", "type": "main", "index": 0}]]},
            "gotify delivered?": {"main": [[{"node": "gotify ok?", "type": "main", "index": 0}]]},
            "gotify ok?": {"main": [
                [{"node": "shape success", "type": "main", "index": 0}],
                [{"node": "notify: email fallback", "type": "main", "index": 0}]]},
            "notify: email fallback": {"main": [
                [{"node": "email delivered?", "type": "main", "index": 0}],
                [{"node": "email delivered?", "type": "main", "index": 0}]]},
            "email delivered?": {"main": [[{"node": "notification delivered?", "type": "main", "index": 0}]]},
            "notification delivered?": {"main": [
                [{"node": "shape success", "type": "main", "index": 0}],
                [{"node": "mark notification_failed", "type": "main", "index": 0}]]},
            "mark notification_failed": {"main": [[{"node": "shape notify_failed", "type": "main", "index": 0}]]},
        },
    }




# --- Workflow: Review Action -------------------------------------------------

def wf_review_action(ctx):
    """Signed approve/reject links -> GitHub PR against members/<id>.json.

    Kept entirely off the public Intake router: this is the only workflow
    holding the GitHub PAT, and the only one whose side effects are visible
    outside the system.
    """
    validate_q = """
const req = $input.first().json || {};
const isConfirm = req._review_request === 'confirm';
const q = isConfirm ? (req.body || {}) : (req.query || {});
const S = (v, max) => {
  const s = (v === undefined || v === null) ? '' : v.toString();
  return s.length > max ? '' : s;
};
return [{ json: {
  submission_id: S(q.submission_id, 128),
  decision: S(q.decision, 16),
  exp: S(q.exp, 12),
  sig: S(q.sig, 128),
  // Only the POST webhook's marker can set this. A crafted query string on the
  // signed GET route remains read-only even if it adds confirmed=yes.
  confirmed: isConfirm && S(q.confirmed, 3) === 'yes' ? 'yes' : 'no'
} }];
"""

    auth_verdict = """
const v = $json;
// Expiry is only classified once the signature is trusted; doing it the other
// way round would let an unsigned link learn whether an id was real.
if (v.valid !== 'yes') return [{ json: { route: 'invalid' } }];
if (v.expired === 'yes') return [{ json: { route: 'expired' } }];
return [{ json: { route: 'valid', decision: v.decision } }];
"""

    precheck = """
const row = $json;
const decision = $('auth verdict').first().json.decision;
const bad = (msg) => [{ json: { ok: 'no', message: msg } }];

if (!row || !row.submission_id) return bad('This submission no longer exists.');

// approval_failed is resumable: the run died partway and nothing was published,
// so the maintainer must be able to click the same link again. Being stuck
// forever is a worse outcome than the narrow duplicate-PR window noted below.
//
// A reviewing- marker means a run is mid-flight. If it is recent, another click
// must not race it. If it is older than STALE_CLAIM_SECONDS the run that stamped
// it is gone -- crashed, timed out -- and the row would otherwise be stranded
// permanently, actionable by nobody.
const st = String(row.status || '');
let reclaimable = st === 'pending_review' || st === 'approval_failed';
if (!reclaimable && st.indexOf('reviewing-') === 0) {
  const stamped = Number(st.split('-').pop());
  reclaimable = Number.isFinite(stamped) && (Date.now() - stamped) > %(stale)d;
  if (!reclaimable) {
    return bad('This submission is being processed right now. Try again shortly.');
  }
}
if (!reclaimable) return bad('This submission was already resolved.');

// The signature covers `decision`, so a forged value cannot get here -- but an
// explicit check keeps a non-approve value from falling through to the reject
// branch and deleting the row, which is how the original was wired.
if (decision !== 'approve' && decision !== 'reject') return bad('This link is invalid.');

let review = {};
try { review = JSON.parse(row.review || '{}'); } catch (e) { review = {}; }
const isRemoval = review.mode === 'remove';

if (decision === 'reject' && !isRemoval && !%(email_ok)s) {
  return bad('Cannot reject yet: no sender address is configured, and rejecting ' +
             'deletes the submission permanently. Set NOTIFY_FROM_EMAIL in ' +
             'scripts/n8n/build_workflows.py and fill in the IndieNodes - SMTP ' +
             'credential first. The submission has been left untouched.');
}

return [{ json: { ok: 'yes', submission_id: row.submission_id, decision,
                  email: (row.email || '').toString(),
                  is_removal: isRemoval ? 'yes' : 'no' } }];
""" % {"email_ok": "true" if EMAIL_CONFIGURED else "false",
       "stale": STALE_CLAIM_SECONDS * 1000}

    # `view` never claims anything -- it is read-only and safe to load any
    # number of times, so it deliberately does not run through `precheck`'s
    # claim-marker logic at all (see the connections below: this is a separate
    # branch off `get submission row`).
    view_gate = """
const row = $json;
const bad = (message) => [{ json: { ok: 'no', message } }];

if (!row || !row.submission_id) return bad('This submission no longer exists.');

// Same actionable set as precheck's reclaimable set, minus the stale-claim
// check -- nothing is being claimed here, so there is no marker age to weigh.
const st = String(row.status || '');
if (st === 'pending_review' || st === 'approval_failed') {
  return [{ json: { ok: 'yes' } }];
}
if (st.indexOf('reviewing-') === 0 || st.indexOf('claiming-') === 0) {
  return bad('This submission is currently being processed.');
}
if (st === 'approved') return bad('This submission has already been approved.');
return bad('This submission is not currently awaiting review.');
"""

    review_style = r"""
:root{
  color-scheme:light dark;
  --bg:#f7f4ee;--bg-elevated:rgba(255,255,255,.82);--text:#221f1a;
  --muted:#6b6558;--faint:#9a9384;--border:rgba(228,221,207,.9);
  --accent:#b5502f;--accent-hover:#963f24;--success:#168544;--danger:#bf3b45;
  --warning:#b7791f;--shadow:0 24px 80px rgba(70,52,31,.16);
  --audio:#3b82f6;--game:#22c55e;--comic:#a855f7;--text-type:#f59e0b;--art:#ec4899;
}
*{box-sizing:border-box}
html{min-height:100%;background:var(--bg)}
body{
  min-height:100vh;margin:0;padding:clamp(1rem,3vw,2.5rem);
  background:
    radial-gradient(circle at 10% 4%,rgba(181,80,47,.18),transparent 28rem),
    radial-gradient(circle at 92% 12%,rgba(45,90,130,.15),transparent 30rem),
    radial-gradient(circle at 52% 100%,rgba(202,138,4,.12),transparent 28rem),
    var(--bg);
  color:var(--text);font-family:Karla,Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;
  font-size:16px;line-height:1.55;
}
body::before{
  content:"";position:fixed;inset:0;pointer-events:none;opacity:.28;
  background-image:radial-gradient(circle,rgba(107,101,88,.28) 1px,transparent 1px);
  background-size:24px 24px;mask-image:linear-gradient(to bottom,black,transparent 72%);
}
a{color:var(--accent);text-underline-offset:.18em}
a:hover{color:var(--accent-hover)}
.shell{position:relative;width:min(920px,100%);margin:0 auto}
.shell.compact{width:min(620px,100%);padding-top:clamp(1rem,7vh,5rem)}
.brand{display:inline-flex;align-items:center;gap:.75rem;margin:0 0 1rem;color:var(--text);text-decoration:none}
.brand:hover{color:var(--text)}
.brand-mark{display:grid;grid-template-columns:repeat(2,8px);gap:4px;transform:rotate(45deg)}
.brand-mark i{display:block;width:8px;height:8px;border-radius:3px}
.brand-mark i:nth-child(1){background:var(--audio)}
.brand-mark i:nth-child(2){background:var(--game)}
.brand-mark i:nth-child(3){background:var(--comic)}
.brand-mark i:nth-child(4){background:var(--text-type)}
.brand-copy{display:flex;flex-direction:column;line-height:1.1}
.brand-copy strong{font-family:"Space Grotesk",Inter,ui-sans-serif,system-ui,sans-serif;font-size:1.05rem}
.brand-copy small{margin-top:.2rem;color:var(--muted);font-size:.72rem;font-weight:700;letter-spacing:.11em;text-transform:uppercase}
.panel{position:relative;overflow:hidden;border:1px solid var(--border);border-radius:24px;background:var(--bg-elevated);box-shadow:var(--shadow);backdrop-filter:blur(22px)}
.panel::before{content:"";position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,var(--audio),var(--game),var(--comic),var(--text-type))}
.review-header,.section,.actions{padding:clamp(1.25rem,3.5vw,2rem)}
.review-header{padding-bottom:1.35rem}
.eyebrow,.section-label{margin:0 0 .55rem;color:var(--muted);font-size:.73rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.review-kind{display:flex;align-items:center;flex-wrap:wrap;gap:.6rem;margin-bottom:.8rem}
.type-pill,.tag{display:inline-flex;align-items:center;width:max-content;border:1px solid var(--border);border-radius:999px;padding:.25rem .62rem;background:rgba(255,255,255,.46);font-size:.73rem;font-weight:800}
.type-pill::before{content:"";width:.5rem;height:.5rem;margin-right:.4rem;border-radius:50%;background:var(--faint)}
.type-pill.audio::before{background:var(--audio)}
.type-pill.game::before{background:var(--game)}
.type-pill.comic::before{background:var(--comic)}
.type-pill.text::before{background:var(--text-type)}
.type-pill.art::before{background:var(--art)}
h1,h2{font-family:"Space Grotesk",Inter,ui-sans-serif,system-ui,sans-serif;line-height:1.1}
h1{margin:0;font-size:clamp(1.65rem,4vw,2.55rem);letter-spacing:-.035em}
h2{margin:.1rem 0 .65rem;font-size:clamp(1.3rem,3vw,1.75rem);letter-spacing:-.02em}
.meta{margin:.75rem 0 0;color:var(--muted);font-size:.82rem}
code{border:1px solid var(--border);border-radius:6px;padding:.12rem .35rem;background:rgba(107,101,88,.08);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em;overflow-wrap:anywhere}
.section{border-top:1px solid var(--border)}
.why{max-width:68ch;margin:.25rem 0 1rem;font-size:1.03rem}
.source-card{display:flex;align-items:flex-start;gap:.75rem;padding:.85rem 1rem;border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,.38)}
.source-card span{flex:0 0 auto;color:var(--muted);font-size:.75rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.source-card a{min-width:0;overflow-wrap:anywhere;font-weight:700}
.tags{display:flex;flex-wrap:wrap;gap:.45rem;margin-top:1rem}
.tag{color:var(--muted);font-weight:700}
.cover{display:block;width:min(240px,100%);height:auto;margin-top:1rem;border:1px solid var(--border);border-radius:14px;box-shadow:0 10px 28px rgba(34,31,26,.13)}
.media-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.8rem}
.media-list{display:grid;gap:.6rem;margin:0;padding:0;list-style:none}
.media-list li,.media-card,blockquote{margin:0;padding:.85rem 1rem;border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,.34)}
.media-list li{display:flex;align-items:center;justify-content:space-between;gap:1rem}
.media-list a{flex:0 0 auto;font-size:.8rem;font-weight:800}
.media-card img{display:block;width:100%;height:auto;border-radius:9px}
.media-card figcaption{margin-top:.55rem;color:var(--muted);font-size:.85rem}
blockquote{border-left:4px solid var(--text-type);white-space:pre-wrap}
.details{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden;border:1px solid var(--border);border-radius:14px}
.criteria{margin:0;padding:0 0 0 1.1rem;color:var(--muted);font-size:.9rem;line-height:1.5}
.criteria li{margin:0 0 .35rem}
.criteria li:last-child{margin-bottom:0}
.details th,.details td{padding:.7rem .85rem;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
.details tr:last-child th,.details tr:last-child td{border-bottom:0}
.details th{width:34%;color:var(--muted);font-size:.75rem;letter-spacing:.06em;text-transform:uppercase}
.details td{overflow-wrap:anywhere;font-weight:650}
.actions{display:flex;align-items:center;flex-wrap:wrap;gap:.7rem;border-top:1px solid var(--border);background:rgba(255,255,255,.24)}
.actions form{margin:0}.actions button{font:inherit;cursor:pointer}
.btn{display:inline-flex;min-height:46px;align-items:center;justify-content:center;border:1px solid transparent;border-radius:999px;padding:.7rem 1.25rem;color:white;text-decoration:none;font-weight:850;box-shadow:0 8px 20px rgba(34,31,26,.12);transition:transform .15s ease,box-shadow .15s ease,background .15s ease}
.btn:hover{color:white;transform:translateY(-1px);box-shadow:0 11px 25px rgba(34,31,26,.17)}
.btn:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 35%,transparent);outline-offset:3px}
.approve{background:var(--success)}
.approve:hover{background:#116f38}
.reject{border-color:color-mix(in srgb,var(--danger) 50%,var(--border));background:transparent;color:var(--danger);box-shadow:none}
.reject:hover{background:var(--danger);color:white}
.action-note{flex:1 1 100%;margin:.15rem 0 0;color:var(--muted);font-size:.78rem}
.status-panel{padding:clamp(1.5rem,5vw,2.5rem)}
.status-panel h1{font-size:clamp(1.6rem,4vw,2.25rem)}
.status-panel p:not(.eyebrow){margin:.7rem 0 0;color:var(--muted)}
.status-icon{display:grid;width:3rem;height:3rem;margin-bottom:1rem;place-items:center;border-radius:50%;background:rgba(107,101,88,.1);color:var(--muted);font-size:1.45rem;font-weight:900}
.status-panel.success .status-icon{background:color-mix(in srgb,var(--success) 15%,transparent);color:var(--success)}
.status-panel.danger .status-icon{background:color-mix(in srgb,var(--danger) 14%,transparent);color:var(--danger)}
.status-panel.warning .status-icon{background:color-mix(in srgb,var(--warning) 16%,transparent);color:var(--warning)}
.status-actions{display:flex;flex-wrap:wrap;gap:.65rem;margin-top:1.25rem}
.pr-link{overflow-wrap:anywhere}
.confirm-copy{max-width:55ch}
.confirm-summary{margin:1.25rem 0;padding:1rem;border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,.32)}
.confirm-summary strong{display:block;font-size:1.05rem}
.confirm-summary span{display:block;margin-top:.2rem;color:var(--muted);font-size:.85rem;overflow-wrap:anywhere}
.confirm-form{margin-top:1.35rem}
.confirm-actions{display:flex;flex-wrap:wrap;align-items:center;gap:.65rem}
.confirm-form .btn{font:inherit;cursor:pointer}
.confirm-form .btn[disabled]{cursor:wait;opacity:.78;transform:none}
.back{border-color:var(--border);background:transparent;color:var(--text);box-shadow:none}
.back:hover{background:rgba(107,101,88,.1);color:var(--text)}
.busy,.processing{display:none}
.confirm-form[aria-busy="true"] .idle{display:none}
.confirm-form[aria-busy="true"] .busy{display:inline-flex;align-items:center;gap:.55rem}
.confirm-form[aria-busy="true"] .processing{display:block}
.processing{margin-top:1rem;padding:.85rem 1rem;border:1px solid color-mix(in srgb,var(--success) 35%,var(--border));border-radius:14px;background:color-mix(in srgb,var(--success) 9%,transparent)}
.processing strong{display:block}
.processing p{margin:.15rem 0 0!important;font-size:.85rem}
.spinner{width:1rem;height:1rem;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;border-radius:50%;animation:review-spin .7s linear infinite}
@keyframes review-spin{to{transform:rotate(360deg)}}
@media(prefers-color-scheme:dark){
  :root{--bg:#0f1420;--bg-elevated:rgba(23,29,44,.84);--text:#eef1f6;--muted:#9aa7bd;--faint:#5c667a;--border:rgba(58,71,95,.78);--accent:#6ea8f0;--accent-hover:#8bb9f5;--success:#35c76f;--danger:#ff7b84;--warning:#f0b54a;--shadow:0 28px 90px rgba(0,0,0,.38)}
  body{background:radial-gradient(circle at 10% 4%,rgba(224,138,95,.14),transparent 28rem),radial-gradient(circle at 92% 12%,rgba(70,130,210,.3),transparent 30rem),radial-gradient(circle at 52% 100%,rgba(168,85,247,.1),transparent 28rem),var(--bg)}
  .type-pill,.tag,.source-card,.media-list li,.media-card,blockquote{background:rgba(15,20,32,.38)}
  .actions{background:rgba(8,10,20,.22)}
  code{background:rgba(238,241,246,.07)}
  .reject:hover{color:#151019}
}
@media(max-width:600px){
  body{padding:.75rem}.panel{border-radius:18px}
  .source-card{flex-direction:column;gap:.25rem}
  .details th,.details td{display:block;width:100%;border-bottom:0;padding-bottom:.25rem}
  .details td{padding-top:0;padding-bottom:.75rem}
  .details tr:not(:last-child) td{border-bottom:1px solid var(--border)}
  .actions .btn{width:100%}
}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}.btn{transition:none}.btn:hover{transform:none}}
"""


    view_page = r"""
const row = $('get submission row').first().json;
const links = $('view: sign fresh links').first().json;
const actionUrl = __CONFIRM_ACTION_JSON__;
let entry = {}, review = {};
try { entry = JSON.parse(row.entry || '{}'); } catch (e) { entry = {}; }
try { review = JSON.parse(row.review || '{}'); } catch (e) { review = {}; }
const thumbX = Number.isFinite(Number(entry.thumb_position?.x)) ? Number(entry.thumb_position.x) : 50;
const thumbY = Number.isFinite(Number(entry.thumb_position?.y)) ? Number(entry.thumb_position.y) : 50;

// The one thing every interpolated value goes through. This page renders
// submitter-controlled strings in a browser, unlike the Gotify/email
// notification, which never executes markup -- skipping this anywhere is an
// XSS hole into the reviewer's own session on this n8n instance.
const esc = (v) => (v === undefined || v === null ? '' : v.toString())
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const isRemoval = review.mode === 'remove';
const isUpdate = Boolean(row.node_id) && !isRemoval;
const safeTypes = ['audio', 'game', 'comic', 'text', 'art'];
const submittedType = entry.type || row.type;
const type = safeTypes.indexOf(submittedType) === -1 ? 'unknown' : submittedType;
const tags = (Array.isArray(entry.tags) ? entry.tags : []).map(esc);

let mediaHtml = '';
if (entry.type === 'audio' && Array.isArray(entry.tracks) && entry.tracks.length) {
  mediaHtml = '<section class="section"><p class="section-label">Tracks</p><ul class="media-list">' +
    entry.tracks.map((t) =>
      '<li><span>' + esc(t.label) + '</span><a href="' + esc(t.media_url) +
      '" target="_blank" rel="noopener">Open track &nearr;</a></li>'
    ).join('') + '</ul></section>';
} else if (entry.type === 'comic' && Array.isArray(entry.pages) && entry.pages.length) {
  mediaHtml = '<section class="section"><p class="section-label">Pages</p><div class="media-grid">' +
    entry.pages.map((pg) =>
      '<figure class="media-card"><img src="' + esc(pg.image_url) + '" alt="" loading="lazy">' +
      (pg.caption ? '<figcaption>' + esc(pg.caption) + '</figcaption>' : '') + '</figure>'
    ).join('') + '</div></section>';
} else if (entry.type === 'art' && Array.isArray(entry.artworks) && entry.artworks.length) {
  mediaHtml = '<section class="section"><p class="section-label">Artworks</p><div class="media-grid">' +
    entry.artworks.map((artwork) => {
      const image = '<img src="' + esc(artwork.image_url) + '" alt="' + esc(artwork.alt) + '" loading="lazy">';
      const linkedImage = artwork.external_url
        ? '<a href="' + esc(artwork.external_url) + '" target="_blank" rel="noopener">' + image + '</a>'
        : image;
      const details = [artwork.title, artwork.year, artwork.medium].filter(Boolean).map(esc).join(' &middot; ');
      return '<figure class="media-card">' + linkedImage +
        (details ? '<figcaption>' + details + '</figcaption>' : '') + '</figure>';
    }).join('') + '</div></section>';
} else if (entry.type === 'text' && Array.isArray(entry.excerpts) && entry.excerpts.length) {
  mediaHtml = '<section class="section"><p class="section-label">Excerpts</p><div class="media-grid">' +
    entry.excerpts.map((x) => {
      const title = (typeof x === 'string' ? '' : (x.title || '')).trim();
      const body = esc(typeof x === 'string' ? x : (x.text || ''));
      return '<blockquote>' + (title ? '<strong>' + esc(title) + '</strong><br>' : '') + body + '</blockquote>';
    }).join('') +
    '</div></section>';
} else if (entry.type === 'game' && (entry.preview_url || entry.trailer_url)) {
  const gameLinks = [
    entry.preview_url ? ['Muted preview', entry.preview_url] : null,
    entry.trailer_url ? ['YouTube trailer', entry.trailer_url] : null,
  ].filter(Boolean);
  mediaHtml = '<section class="section"><p class="section-label">Game media</p><ul class="media-list">' +
    gameLinks.map(([label, url]) => '<li><span>' + label + '</span><a href="' + esc(url) +
      '" target="_blank" rel="noopener">Open &nearr;</a></li>').join('') + '</ul></section>';
}

const thumb = entry.thumb_url
  ? '<img class="cover" style="object-position:' + esc(thumbX) + '% ' + esc(thumbY) + '%" src="' + esc(entry.thumb_url) + '" alt="" loading="lazy">'
  : '';

const membership = review.pro_membership
  ? esc(review.pro_membership) +
    (review.pro_membership_name ? ' (' + esc(review.pro_membership_name) + ')' : '')
  : 'None';

const yn = (v) => v === null || v === undefined ? 'N/A (update)' : (v === true ? 'Yes' : 'No');
const tagHtml = tags.length
  ? '<div class="tags">' + tags.map((tag) => '<span class="tag">' + tag + '</span>').join('') + '</div>'
  : '<div class="tags"><span class="tag">No tags</span></div>';

const reviewContent = isRemoval
  ? `
    <section class="section">
      <p class="section-label">Member to remove</p>
      <h2><code>${esc(row.node_id)}</code></h2>
      <p class="why">This request was verified against the page currently assigned to this node. No personal contact data or replacement entry is collected for a voluntary removal.</p>
      <div class="source-card">
        <span>Verified source</span>
        <a href="${esc(row.source_url)}" target="_blank" rel="noopener">${esc(row.source_url)}</a>
      </div>
    </section>
    <section class="section">
      <p class="section-label">Request details</p>
      <table class="details"><tbody>
        <tr><th scope="row">Node ID</th><td><code>${esc(row.node_id)}</code></td></tr>
        <tr><th scope="row">Current type</th><td>${esc(type)}</td></tr>
        <tr><th scope="row">Reason</th><td>${review.reason ? esc(review.reason) : 'None provided (optional)'}</td></tr>
      </tbody></table>
    </section>`
  : `
    <section class="section">
      <p class="section-label">Creator</p>
      <h2>${esc(entry.creator)}</h2>
      <p class="why">${esc(entry.why)}</p>
      <div class="source-card">
        <span>Verified source</span>
        <a href="${esc(row.source_url)}" target="_blank" rel="noopener">${esc(row.source_url)}</a>
      </div>
      ${tagHtml}
      ${thumb}
    </section>
    ${mediaHtml}
    <section class="section">
      <p class="section-label">Review criteria (EULA &sect;8)</p>
      <ul class="criteria">
        <li>Declared type matches what is actually at the source URL.</li>
        <li>Work is publicly reachable and released, not announced &mdash; ongoing is fine, a concept alone is not.</li>
        <li>The Node is authentically this creator's, not scraped, republished, or bulk-produced.</li>
        <li>Rough production, small scope, niche style, a plain site, or a small audience are never grounds to decline.</li>
      </ul>
    </section>
    <section class="section">
      <p class="section-label">Submission checks</p>
      <table class="details">
        <tbody>
          <tr><th scope="row">Email</th><td>${esc(review.email)}</td></tr>
          <tr><th scope="row">Rights confirmed</th><td>${yn(review.rights_confirmation)}</td></tr>
          <tr><th scope="row">EULA agreed</th><td>${yn(review.eula_agreement)}</td></tr>
          <tr><th scope="row">PRO membership</th><td>${membership}</td></tr>
        </tbody>
      </table>
    </section>`;

const body = `
<main class="shell">
  <a class="brand" href="https://app.indienodes.us/" target="_blank" rel="noopener">
    <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <span class="brand-copy"><strong>IndieNodes</strong><small>Private review</small></span>
  </a>
  <article class="panel">
    <header class="review-header">
      <div class="review-kind">
        <p class="eyebrow">${isRemoval ? 'Voluntary removal request' : (isUpdate ? 'Existing node update' : 'New ring request')}</p>
        <span class="type-pill ${type}">${esc(type)}</span>
      </div>
      <h1>${isRemoval ? 'Review removal of <code>' + esc(row.node_id) + '</code>' : (isUpdate ? 'Review update to <code>' + esc(row.node_id) + '</code>' : 'Review submission')}</h1>
      <p class="meta">Submission <code>${esc(row.submission_id)}</code></p>
    </header>
    ${reviewContent}
    <footer class="actions">
      <form method="post" action="${esc(actionUrl)}">
        <input type="hidden" name="submission_id" value="${esc(row.submission_id)}">
        <input type="hidden" name="decision" value="approve">
        <input type="hidden" name="exp" value="${esc(links.exp)}">
        <input type="hidden" name="sig" value="${esc(links.approve_sig)}">
        <input type="hidden" name="confirmed" value="yes">
        <button class="btn approve" type="submit">${isRemoval ? 'Approve removal' : 'Approve request'}</button>
      </form>
      <form method="post" action="${esc(actionUrl)}">
        <input type="hidden" name="submission_id" value="${esc(row.submission_id)}">
        <input type="hidden" name="decision" value="reject">
        <input type="hidden" name="exp" value="${esc(links.exp)}">
        <input type="hidden" name="sig" value="${esc(links.reject_sig)}">
        <input type="hidden" name="confirmed" value="yes">
        <button class="btn reject" type="submit">Reject request</button>
      </form>
      <p class="action-note">${isRemoval
        ? 'Rejecting permanently deletes this pending request. There is no submitter email to notify or retain.'
        : 'Rejecting notifies the submitter, then permanently removes this pending submission.'}</p>
    </footer>
  </article>
</main>
`;

return [{ json: {
  html: '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="color-scheme" content="light dark"><title>IndieNodes review</title>' +
        '<style>' + __REVIEW_STYLE_JSON__ + '</style></head><body>' + body + '</body></html>'
} }];
""".replace("__REVIEW_STYLE_JSON__", json.dumps(review_style)).replace(
        "__CONFIRM_ACTION_JSON__", json.dumps(REVIEW_CONFIRM_WEBHOOK_BASE)
    )

    parse_ring = """
const res = $json;
const status = Number(res.statusCode || 0);
if (status < 200 || status >= 300) return [{ json: { ok: 'no' } }];
try {
  const payload = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  const doc = JSON.parse(Buffer.from(payload.content || '', 'base64').toString('utf-8'));
  // Bare array or { version, entries } envelope, as in find_node above.
  const ring = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.entries) ? doc.entries : null);
  if (!Array.isArray(ring)) return [{ json: { ok: 'no' } }];
  return [{ json: { ok: 'yes', ring, sha: payload.sha } }];
} catch (e) {
  // A swallowed failure here silently disables both the id-collision check and
  // creator_id matching, so it is reported rather than defaulted to [].
  return [{ json: { ok: 'no' } }];
}
"""

    gen_id = r"""
const row = $('get submission row').first().json;
const ring = $json.ring;
let entry = {};
try { entry = JSON.parse(row.entry || '{}'); } catch (e) { entry = {}; }

%(slug_js)s

let id;
if (row.node_id) {
  // An update or removal acts on an existing entry; its id is not re-derived.
  id = row.node_id;
} else {
  const taken = new Set(ring.map((e) => e && e.id));

  // The id the form showed the submitter, and the one their generated site
  // already carries in its footer. Honoured when it is still free, so the
  // embed a creator has already published keeps matching. It is read from the
  // stored entry rather than trusted from the request: the row was written at
  // submit time and cannot be edited afterwards.
  //
  // Validated against the schema's own pattern before use -- this arrives as
  // submitter-influenced data, and an id is written into a file path and a
  // branch name downstream.
  const requested = (entry.requested_id || '').toString();
  const valid = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(requested) && requested.length <= 64;

  if (valid && !taken.has(requested)) {
    id = requested;
  } else {
    // Free-standing collision, or no usable request: fall back to deriving it
    // the same way the browser would have. uniqueEntryId's suffix settles the
    // rest, and the creator's embed is then stale -- which the health check
    // now reports as ring_widget_site_id_unmatched rather than as a missing
    // embed, and /update is the repair path.
    id = uniqueEntryId({ type: entry.type, creator: entry.creator }, taken);
  }
}

// Host comparison, done by hand: `URL` is not defined in the n8n Code sandbox.
// The original used `new URL()` inside a try/catch, so it threw ReferenceError
// on every run and the catch swallowed it -- creator_id was never once
// assigned. A silent failure, invisible in the response and the execution log.
const hostOf = (u) => {
  const m = (u || '').toString().match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^\/?#]*)/);
  if (!m) return '';
  let h = m[1];
  if (h.indexOf('@') !== -1) h = h.split('@').pop();
  if (h.charAt(0) === '[') return h.slice(1, h.indexOf(']')).toLowerCase();
  return h.split(':')[0].toLowerCase();
};

let creator_id = null;
const host = hostOf(row.source_url);
if (host) {
  const match = ring.find((e) => e && hostOf(e.source_url) === host && e.creator_id);
  if (match) creator_id = match.creator_id;
}

return [{ json: { id, creator_id, ring: $json.ring, sha: $json.sha } }];
""" % {"slug_js": SLUG_JS}

    strip_fields = r"""
const row = $('get submission row').first().json;
let entry = {};
try { entry = JSON.parse(row.entry || '{}'); } catch (e) { entry = {}; }
const gen = $json;

// Explicit allowlist, matching toRingEntry in src/lib/submissionValidation.js
// field for field. Never a denylist: a field added to the form later must be
// deliberately published, not published by default.
const allowed = ['creator', 'type', 'why', 'tags', 'tracks', 'pages', 'artworks',
                 'excerpts', 'thumb_url', 'thumb_position', 'preview_url', 'trailer_url', 'explicit'];
const out = { id: gen.id };
for (const k of allowed) if (entry[k] !== undefined) out[k] = entry[k];

// Backend-assigned public routing fields. The temporary verification token
// proved control before this point and is deliberately not published.
out.source_url = row.source_url;
if (gen.creator_id) out.creator_id = gen.creator_id;

// n8n's Code sandbox cannot import the repository's Prettier dependency, but
// every generated member file is checked by `prettier --check .`. This small
// JSON-only renderer mirrors the relevant Prettier settings: tabs, a 100-column
// width, multiline objects/object arrays, and compact scalar arrays when they
// fit. Normalizing through JSON first preserves JSON.stringify's treatment of
// undefined values without teaching a formatter about non-JSON JavaScript.
const canonical = JSON.parse(JSON.stringify(out));
const WIDTH = 100;
const TAB_WIDTH = 2;
const tabs = (n) => '\t'.repeat(n);
const scalar = (v) => v === null || typeof v !== 'object';
const renderJson = (value, depth, column) => {
  if (scalar(value)) return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (value.every(scalar)) {
      const compact = '[' + value.map((v) => JSON.stringify(v)).join(', ') + ']';
      if (column + compact.length <= WIDTH) return compact;
    }
    return '[\n' + value.map((v) =>
      tabs(depth + 1) + renderJson(v, depth + 1, (depth + 1) * TAB_WIDTH)
    ).join(',\n') + '\n' + tabs(depth) + ']';
  }

  const keys = Object.keys(value);
  if (!keys.length) return '{}';
  return '{\n' + keys.map((key) => {
    const prefix = tabs(depth + 1) + JSON.stringify(key) + ': ';
    const columnAtValue = (depth + 1) * TAB_WIDTH + JSON.stringify(key).length + 2;
    return prefix + renderJson(value[key], depth + 1, columnAtValue);
  }).join(',\n') + '\n' + tabs(depth) + '}';
};
const memberContent = renderJson(canonical, 0, 0) + '\n';

const isUpdate = Boolean(row.node_id);
// Collision-resistant on both paths. The original used a bare
// `submission/<id>`, which collides on any retry.
const suffix = Date.now().toString(36) + '-' + $execution.id;
return [{ json: {
  newEntry: out, id: gen.id, node_id: row.node_id || null,
  branchName: (isUpdate ? 'update/' : 'submission/') + gen.id + '-' + suffix,
  commitMsg: (isUpdate ? 'Update ring entry: ' : 'Add ring entry: ') + gen.id,
  memberContentB64: Buffer.from(memberContent, 'utf-8').toString('base64'),
  type: out.type, why: out.why, source_url: out.source_url
} }];
"""

    build_member = """
const strip = $('approve: strip fields (allowlist)').first().json;
const existing = $json;
const status = Number(existing.statusCode || 0);
let existingSha = null;
if (status >= 200 && status < 300) {
  try {
    const payload = typeof existing.data === 'string' ? JSON.parse(existing.data) : existing.data;
    existingSha = payload.sha || null;
  } catch (e) { existingSha = null; }
} else if (status !== 404) {
  // Anything other than "found" or "definitely absent" is unknown. Committing
  // without a sha when the file does exist fails with a 409, so stop instead.
  return [{ json: { ok: 'no' } }];
}
return [{ json: Object.assign({ ok: 'yes', existingSha }, strip) }];
"""

    prep_removal = """
const row = $('get submission row').first().json;
let review = {};
try { review = JSON.parse(row.review || '{}'); } catch (e) { review = {}; }

// The id comes from the row, never from anything the requester sent: the token
// was minted against this node and no other.
const id = (row.node_id || '').toString();
const suffix = Date.now().toString(36) + '-' + $execution.id;
return [{ json: {
  ok: id ? 'yes' : 'no',
  id,
  branchName: 'removal/' + id + '-' + suffix,
  commitMsg: 'Remove ring entry: ' + id,
  reason: (review.reason || '').toString()
} }];
"""

    removal_sha = """
const res = $json;
const status = Number(res.statusCode || 0);
const prep = $('approve: removal prep').first().json;
if (status === 404) {
  // Already gone. Nothing to remove and nothing wrong: treat it as done rather
  // than failing a request whose desired end state already holds.
  return [{ json: Object.assign({ ok: 'gone' }, prep) }];
}
if (status < 200 || status >= 300) return [{ json: Object.assign({ ok: 'no' }, prep) }];
let sha = null;
try {
  const payload = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  sha = payload.sha || null;
} catch (e) { sha = null; }
return [{ json: Object.assign({ ok: sha ? 'yes' : 'no', existingSha: sha }, prep) }];
"""

    pr_verdict = """
const status = Number($json.statusCode || 0);
let url = '';
try {
  const payload = typeof $json.data === 'string' ? JSON.parse($json.data) : $json.data;
  url = (payload && payload.html_url) || '';
} catch (e) { url = ''; }
return [{ json: { ok: (status >= 200 && status < 300 && url) ? 'yes' : 'no', pr_url: url } }];
"""

    review_brand = (
        '<a class="brand" href="https://app.indienodes.us/" target="_blank" rel="noopener">'
        '<span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>'
        '<span class="brand-copy"><strong>IndieNodes</strong>'
        '<small>Private review</small></span></a>'
    )

    def html_parts(tone="neutral"):
        prefix = (
            '<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="color-scheme" content="light dark">'
            '<title>IndieNodes review</title><style>' + review_style +
            '</style></head><body><main class="shell compact">' + review_brand +
            '<article class="panel status-panel ' + tone + '">'
        )
        return prefix, '</article></main></body></html>'

    def html(body, tone="neutral"):
        prefix, suffix = html_parts(tone)
        return "=" + prefix + body + suffix

    def html_expr(body_expr, tone="neutral"):
        prefix, suffix = html_parts(tone)
        return "={{ " + json.dumps(prefix) + " + (" + body_expr + ") + " + json.dumps(suffix) + " }}"

    approved_page = r"""
const url = $('approve: PR verdict').first().json.pr_url || '';
const esc = (v) => (v === undefined || v === null ? '' : v.toString())
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const style = __REVIEW_STYLE_JSON__;
const brand = __REVIEW_BRAND_JSON__;
const body =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<meta name="color-scheme" content="light dark"><title>IndieNodes review</title>' +
  '<style>' + style + '</style></head><body><main class="shell compact">' + brand +
  '<article class="panel status-panel success">' +
  '<div class="status-icon" aria-hidden="true">&#10003;</div>' +
  '<p class="eyebrow">Decision complete</p><h1>Approval recorded</h1>' +
  '<p><strong>Next:</strong> open the pull request and confirm it by reviewing and merging it in GitHub. ' +
  'The node is not published until that PR is merged.</p>' +
  '<div class="status-actions"><a class="btn approve" target="_blank" rel="noopener" href="' +
  esc(url) + '">Open pull request</a></div></article></main></body></html>';
return [{ json: { html: body } }];
""".replace("__REVIEW_STYLE_JSON__", json.dumps(review_style)).replace(
        "__REVIEW_BRAND_JSON__", json.dumps(review_brand)
    )

    def respond(name, pos, body):
        return node(name, "n8n-nodes-base.respondToWebhook", 1.5, pos, {
            "respondWith": "text", "responseBody": body,
            "options": {"responseHeaders": {"entries": [
                {"name": "Content-Type", "value": "text/html; charset=utf-8"}]}}})

    def gh(name, pos, url, method="GET", body=None):
        params = {"method": method, "url": url,
                  "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
                  "options": {"timeout": 10000,
                              "response": {"response": {"neverError": True, "fullResponse": True,
                                                        "responseFormat": "text"}}}}
        if body:
            params.update({"sendBody": True, "specifyBody": "json", "jsonBody": body})
        request = node(name, "n8n-nodes-base.httpRequest", 4.5, pos, params,
                       credentials={"httpHeaderAuth": GITHUB_CREDENTIAL},
                       onError="continueErrorOutput")
        # Retry only read-only calls. This recovers a transient DNS/TCP failure
        # such as EAI_AGAIN without risking a duplicate/ambiguous write if
        # GitHub accepted a branch, commit, delete, or PR before its response
        # was lost.
        if method == "GET":
            request.update({"retryOnFail": True, "maxTries": 3, "waitBetweenTries": 1000})
        return request

    def ifn(name, pos, left, right, idx):
        return node(name, "n8n-nodes-base.if", 2.3, pos, {
            "conditions": {"options": {"caseSensitive": True, "leftValue": "",
                                       "typeValidation": "loose", "version": 3},
                           "conditions": [{"id": "r0000000-0000-4000-8000-%012d" % idx,
                                           "leftValue": left, "rightValue": right,
                                           "operator": {"type": "string", "operation": "equals"}}],
                           "combinator": "and"}, "options": {}})

    SUB_COLS = dt_columns("submissions")
    dt_schema = dt_node_schema("submissions")
    subtable = {"__rl": True, "value": TABLE_SUBMISSIONS, "mode": "list",
                "cachedResultName": "submissions"}
    # Every filter uses exactly ONE condition: n8n ORs multiple conditions.
    sid_filter = {"conditions": [{"keyName": "submission_id",
                                  "keyValue": "={{ $('validate query').first().json.submission_id }}"}]}
    REPO = "https://api.github.com/repos/" + GITHUB_REPO

    return {
        "name": "Webring - Review Action v2",
        "settings": settings(error_workflow_id=ctx.get("error_workflow_id")),
        "nodes": [
            node("Webhook", "n8n-nodes-base.webhook", 2.1, (-1520, -80),
                 {"path": REVIEW_WEBHOOK_PATH, "responseMode": "responseNode", "options": {}}),
            node("Webhook Confirm", "n8n-nodes-base.webhook", 2.1, (-1520, 80),
                 {"httpMethod": "POST", "path": REVIEW_CONFIRM_WEBHOOK_PATH,
                  "responseMode": "responseNode", "options": {}}),
            code_node("mark link request", (-1300, -80),
                      "return [{ json: Object.assign({}, $json, "
                      "{ _review_request: 'link' }) }];"),
            code_node("mark confirmed request", (-1300, 80),
                      "return [{ json: Object.assign({}, $json, "
                      "{ _review_request: 'confirm' }) }];"),
            code_node("validate query", (-1080, 0), validate_q),
            node("verify signature", "n8n-nodes-base.executeWorkflow", 1.3, (-860, 0), {
                "workflowId": {"__rl": True, "value": ctx.get("signature_id", ""), "mode": "list",
                               "cachedResultName": "Webring - Helper - Review Link Signature v2"},
                "workflowInputs": {"mappingMode": "defineBelow",
                                   "value": {"mode": "verify",
                                             "submission_id": "={{ $json.submission_id }}",
                                             "decision": "={{ $json.decision }}",
                                             "exp": "={{ $json.exp }}", "sig": "={{ $json.sig }}"},
                                   "matchingColumns": [""], "schema": [],
                                   "attemptToConvertTypes": False, "convertFieldsToString": True},
                "options": {}}),
            code_node("auth verdict", (-640, 0), auth_verdict),
            node("auth route", "n8n-nodes-base.switch", 3.4, (-420, 0), {
                "rules": {"values": [
                    {"conditions": {"options": {"caseSensitive": True, "leftValue": "",
                                                "typeValidation": "loose", "version": 3},
                                    "conditions": [{"id": "a1", "leftValue": "={{ $json.route }}",
                                                    "rightValue": "valid",
                                                    "operator": {"type": "string", "operation": "equals"}}],
                                    "combinator": "and"}},
                    {"conditions": {"options": {"caseSensitive": True, "leftValue": "",
                                                "typeValidation": "loose", "version": 3},
                                    "conditions": [{"id": "a2", "leftValue": "={{ $json.route }}",
                                                    "rightValue": "expired",
                                                    "operator": {"type": "string", "operation": "equals"}}],
                                    "combinator": "and"}}]},
                "options": {"fallbackOutput": "extra"}}),
            respond("respond invalid", (-200, 180),
                    html('<div class="status-icon" aria-hidden="true">!</div>'
                         '<p class="eyebrow">Review link</p>'
                         '<h1>This link is invalid.</h1>', "danger")),
            respond("respond expired", (-200, 60),
                    html('<div class="status-icon" aria-hidden="true">!</div>'
                         '<p class="eyebrow">Review link</p>'
                         '<h1>This link has expired.</h1>'
                         '<p>Ask for a fresh review link.</p>', "warning")),

            node("get submission row", "n8n-nodes-base.dataTable", 1.1, (20, -140), {
                "operation": "get", "dataTableId": subtable, "filters": sid_filter},
                 alwaysOutputData=True),
            # `view` branches off here, before precheck, because precheck's job
            # is claiming a row for approve/reject -- view must never claim.
            ifn("view route", (240, -320), "={{ $('auth verdict').first().json.decision }}", "view", 20),
            code_node("view: gate", (460, -420), view_gate),
            ifn("view: pending?", (680, -420), "={{ $json.ok }}", "yes", 21),
            node("view: sign fresh links", "n8n-nodes-base.executeWorkflow", 1.3, (900, -480), {
                "workflowId": {"__rl": True, "value": ctx.get("signature_id", ""), "mode": "list",
                               "cachedResultName": "Webring - Helper - Review Link Signature v2"},
                "workflowInputs": {"mappingMode": "defineBelow",
                                   "value": {"mode": "sign",
                                             "submission_id": "={{ $('validate query').first().json.submission_id }}",
                                             "decision": "", "exp": "", "sig": ""},
                                   "matchingColumns": [""], "schema": [],
                                   "attemptToConvertTypes": False, "convertFieldsToString": True},
                "options": {}}),
            code_node("view: build page", (1120, -480), view_page),
            respond("respond view", (1340, -480), "={{ $json.html }}"),
            respond("respond view unavailable", (900, -360),
                    html_expr("'<div class=\"status-icon\" aria-hidden=\"true\">i</div>' + "
                              "'<p class=\"eyebrow\">Review status</p><h1>' + "
                              "$json.message + '</h1>'", "warning")),

            # Only a signed POST from the buttons on the review page may reach
            # the side-effecting path. Signed GET action URLs remain read-only.
            ifn("confirmed request?", (240, -140),
                "={{ $('validate query').first().json.confirmed }}", "yes", 30),

            code_node("precheck", (460, -200), precheck),
            ifn("may proceed?", (460, -140), "={{ $json.ok }}", "yes", 1),
            respond("respond not actionable", (680, 40),
                    html_expr("'<div class=\"status-icon\" aria-hidden=\"true\">i</div>' + "
                              "'<p class=\"eyebrow\">Review status</p><h1>' + "
                              "$json.message + '</h1>'", "warning")),

            # Optimistic marker claim -- single-condition filters only (see P-1).
            node("claim: stamp marker", "n8n-nodes-base.dataTable", 1.1, (680, -220), {
                "operation": "update", "dataTableId": subtable, "filters": sid_filter,
                "columns": {"mappingMode": "defineBelow",
                            # Timestamped so an abandoned claim can be told from a
                            # live one -- see STALE_CLAIM_SECONDS.
                            "value": {"status": "=reviewing-{{ $execution.id }}-{{ Date.now() }}"},
                            "matchingColumns": [], "schema": dt_schema,
                            "attemptToConvertTypes": False, "convertFieldsToString": False},
                "options": {}}, alwaysOutputData=True),
            node("claim: read back", "n8n-nodes-base.dataTable", 1.1, (900, -220), {
                "operation": "get", "dataTableId": subtable, "filters": sid_filter},
                 alwaysOutputData=True),
            code_node("claim: won?", (1120, -220),
                      "const mine = 'reviewing-' + $execution.id + '-';\n"
                      "// Two simultaneous clicks both pass the status check above; only the\n"
                      "// run whose marker survives the read-back may cause side effects.\n"
                      "const status = ($json && $json.status) ? String($json.status) : '';\n"
                      "return [{ json: { ok: status.indexOf(mine) === 0 ? 'yes' : 'no',\n"
                      "                  message: 'This submission was already resolved.' } }];"),
            ifn("claimed?", (1340, -220), "={{ $json.ok }}", "yes", 2),
            node("decision route", "n8n-nodes-base.switch", 3.4, (1560, -220), {
                "rules": {"values": [
                    {"conditions": {"options": {"caseSensitive": True, "leftValue": "",
                                                "typeValidation": "loose", "version": 3},
                                    "conditions": [{"id": "d1",
                                                    "leftValue": "={{ $('precheck').first().json.decision }}",
                                                    "rightValue": "approve",
                                                    "operator": {"type": "string", "operation": "equals"}}],
                                    "combinator": "and"}}]},
                "options": {"fallbackOutput": "extra"}}),

            # --- reject ---
            ifn("reject: is removal?", (1780, 40),
                "={{ $('precheck').first().json.is_removal }}", "yes", 30),
            node("reject: removal delete row", "n8n-nodes-base.dataTable", 1.1, (2000, 180), {
                "operation": "deleteRows", "dataTableId": subtable, "filters": sid_filter,
                "options": {}}),
            respond("respond removal rejected", (2220, 180),
                    html('<div class="status-icon" aria-hidden="true">&#10003;</div>'
                         '<p class="eyebrow">Decision complete</p>'
                         '<h1>Removal request rejected</h1>'
                         '<p>No member was changed. The pending request was permanently deleted; '
                         'there was no submitter email to notify or retain.</p>', "success")),
            node("reject: notify submitter", "n8n-nodes-base.emailSend", 2.1, (2000, 40), {
                "fromEmail": NOTIFY_FROM_EMAIL,
                "toEmail": "={{ $('precheck').first().json.email }}",
                "subject": "About your IndieNodes submission",
                "emailFormat": "text",
                # No reason is given and none is stored: the row is deleted
                # immediately after, and a rejection rationale would be exactly
                # the kind of record spec section 5 step 9 says is not retained.
                "text": "=Thanks for submitting to IndieNodes.\n\nAfter review, your submission was not added to the ring this time. Nothing about it has been kept.\n\nYou're welcome to submit again.\n\n-- IndieNodes",
                "options": {}},
                 credentials={"smtp": SMTP_CREDENTIAL},
                 onError="continueErrorOutput"),
            code_node("reject: delivered?", (2000, 40),
                      "// Send Email throws rather than returning a status, so reaching the\n"
                      "// success output is the signal. Nothing is deleted unless it does.\n"
                      "const failed = Boolean($json.error) || $json.__error === true;\n"
                      "return [{ json: { ok: failed ? 'no' : 'yes' } }];"),
            ifn("reject: notified?", (2220, 40), "={{ $json.ok }}", "yes", 3),
            node("reject: delete row", "n8n-nodes-base.dataTable", 1.1, (2440, -20), {
                "operation": "deleteRows", "dataTableId": subtable, "filters": sid_filter,
                "options": {}}),
            respond("respond rejected", (2660, -20),
                    html('<div class="status-icon" aria-hidden="true">&#10003;</div>'
                         '<p class="eyebrow">Decision complete</p>'
                         '<h1>Rejection confirmed</h1>'
                         '<p>The submitter has been notified and the pending submission '
                         'has been permanently deleted.</p>', "success")),
            node("reject: restore status", "n8n-nodes-base.dataTable", 1.1, (2440, 140), {
                "operation": "update", "dataTableId": subtable, "filters": sid_filter,
                "columns": {"mappingMode": "defineBelow", "value": {"status": "pending_review"},
                            "matchingColumns": [], "schema": dt_schema,
                            "attemptToConvertTypes": False, "convertFieldsToString": False},
                "options": {}}),
            respond("respond reject failed", (2660, 140),
                    html('<div class="status-icon" aria-hidden="true">!</div>'
                         '<p class="eyebrow">Action not completed</p>'
                         '<h1>Could not reject</h1>'
                         '<p>The submitter could not be notified, so nothing was deleted. '
                         'The submission is still pending and this link still works.</p>',
                         "warning")),

            # --- approve ---
            # --- withdrawal branch -------------------------------------
            # Deliberately parallel to the approve chain rather than woven into
            # it: that chain is the working path for every submission this ring
            # has taken, and a removal shares none of its steps except opening
            # the PR. Fewer shared nodes, fewer ways to break something that
            # already works.
            ifn("approve: is removal?", (1780, -560),
                "={{ JSON.parse($('get submission row').first().json.review || '{}').mode }}",
                "remove", 20),
            code_node("approve: removal prep", (2000, -560), prep_removal),
            ifn("approve: removal id known?", (2220, -560), "={{ $json.ok }}", "yes", 21),
            gh("approve: removal get member sha", (2440, -560),
               "={{ '%s/contents/members/' + $json.id + '.json' }}" % REPO),
            code_node("approve: removal sha verdict", (2660, -560), removal_sha),
            ifn("approve: removal file present?", (2880, -560), "={{ $json.ok }}", "yes", 22),
            gh("approve: removal get main ref", (3100, -560), REPO + "/git/ref/heads/main"),
            gh("approve: removal create branch", (3320, -560), REPO + "/git/refs", "POST",
               "={{ JSON.stringify({ ref: 'refs/heads/' + $('approve: removal prep').first().json.branchName, sha: JSON.parse($json.data).object.sha }) }}"),
            gh("approve: removal delete member file", (3540, -560),
               "={{ '%s/contents/members/' + $('approve: removal prep').first().json.id + '.json' }}" % REPO,
               "DELETE",
               "={{ JSON.stringify({ message: $('approve: removal prep').first().json.commitMsg, sha: $('approve: removal sha verdict').first().json.existingSha, branch: $('approve: removal prep').first().json.branchName }) }}"),
            gh("approve: removal open PR", (3760, -560), REPO + "/pulls", "POST",
               "={{ JSON.stringify({ title: $('approve: removal prep').first().json.commitMsg, head: $('approve: removal prep').first().json.branchName, base: 'main', body: 'Removes the `' + $('approve: removal prep').first().json.id + '` entry at its own creator\\'s request.\\n\\n- They proved control of the page the node points at, the same check a change request passes.\\n' + ($('approve: removal prep').first().json.reason ? '- Reason given: ' + $('approve: removal prep').first().json.reason + '\\n' : '- No reason given, which is not required.\\n') + '\\nOpened automatically. ring.json is regenerated from members/*.json by the auto-build workflow; merging still requires a manual review.' }) }}"),

            gh("approve: fetch ring.json", (1780, -320), REPO + "/contents/ring.json"),
            code_node("approve: parse ring", (2000, -320), parse_ring),
            ifn("approve: ring ok?", (2220, -320), "={{ $json.ok }}", "yes", 4),
            code_node("approve: generate id + creator_id", (2440, -320), gen_id),
            code_node("approve: strip fields (allowlist)", (2660, -320), strip_fields),
            # Authenticated, unlike the original: an unauthenticated call shares
            # the 60/hour anonymous pool, and exhausting it yields a null sha,
            # which makes updating an existing member file fail with a 409.
            gh("approve: check existing member file", (2880, -320),
               "={{ '%s/contents/members/' + $json.id + '.json' }}" % REPO),
            code_node("approve: build member file", (3100, -320), build_member),
            ifn("approve: member sha known?", (3320, -320), "={{ $json.ok }}", "yes", 5),
            gh("approve: get main ref", (3540, -320), REPO + "/git/ref/heads/main"),
            gh("approve: create branch", (3760, -320), REPO + "/git/refs", "POST",
               "={{ JSON.stringify({ ref: 'refs/heads/' + $('approve: build member file').first().json.branchName, sha: JSON.parse($json.data).object.sha }) }}"),
            gh("approve: commit member file", (3980, -320),
               "={{ '%s/contents/members/' + $('approve: build member file').first().json.id + '.json' }}" % REPO,
               "PUT",
               "={{ JSON.stringify(Object.assign({ message: $('approve: build member file').first().json.commitMsg, content: $('approve: build member file').first().json.memberContentB64, branch: $('approve: build member file').first().json.branchName }, $('approve: build member file').first().json.existingSha ? { sha: $('approve: build member file').first().json.existingSha } : {})) }}"),
            gh("approve: open PR", (4200, -320), REPO + "/pulls", "POST",
               "={{ JSON.stringify({ title: $('approve: build member file').first().json.commitMsg, head: $('approve: build member file').first().json.branchName, base: 'main', body: 'Adds/updates a `' + $('approve: build member file').first().json.type + '` entry.\\n\\n- Source: ' + $('approve: build member file').first().json.source_url + '\\n- Passed automated ownership verification and private maintainer review.\\n\\nOpened automatically. `npm run validate:publish` runs on it via CI; ring.json is regenerated from members/*.json by a separate auto-build workflow. Merging still requires a manual review of that check.' }) }}"),
            code_node("approve: PR verdict", (4420, -320), pr_verdict),
            ifn("approve: PR created?", (4640, -320), "={{ $json.ok }}", "yes", 6),
            node("approve: mark approved + scrub", "n8n-nodes-base.dataTable", 1.1, (4860, -400), {
                "operation": "update", "dataTableId": subtable, "filters": sid_filter,
                "columns": {"mappingMode": "defineBelow",
                            "value": {"status": "approved", "email": "", "review": "",
                                      "verification_token": ""},
                            "matchingColumns": [], "schema": dt_schema,
                            "attemptToConvertTypes": False, "convertFieldsToString": False},
                "options": {}}),
            # The submitter is told their entry was approved, before the scrub
            # below clears the address it is sent to.
            #
            # /join promises "an email address, used once, to tell you what
            # happened to this submission", and the reject path has always kept
            # that promise. Approval never did: it deleted `email` at the scrub
            # without ever having sent anything, so the one outcome a creator is
            # actually waiting for was the one that arrived in silence.
            #
            # Careful about what it claims. Approval opens a pull request; the
            # entry is not in the ring until a human merges it, so this says
            # that rather than "you are live". It also carries the entry id,
            # which is the value their widget's `site-id` has to match and the
            # one they need at /update later.
            #
            # `continueErrorOutput` with both outputs rejoining: a bounced
            # notification must not undo an approval whose PR is already open.
            # That is the opposite of the reject path, where delivery gates the
            # delete because it is the last chance to say anything at all.
            node("approve: notify submitter", "n8n-nodes-base.emailSend", 2.1, (4860, -560), {
                "fromEmail": NOTIFY_FROM_EMAIL,
                "toEmail": "={{ $('precheck').first().json.email }}",
                "subject": "Your IndieNodes submission was approved",
                "emailFormat": "text",
                "text": "=Thanks for submitting to IndieNodes.\n\n"
                        "Your entry has been approved and a pull request has been opened for it. "
                        "It joins the ring once that is merged, which is a manual step, so give it a little time.\n\n"
                        "Your entry id is {{ $('approve: generate id + creator_id').first().json.id }}. "
                        "Two things use it: the site-id in the ring widget on your page, and finding your entry "
                        "at /update if you ever need to change or remove it.\n\n"
                        "This address is now deleted. Nothing else will be sent to it.\n\n"
                        "-- IndieNodes",
                "options": {}},
                 credentials={"smtp": SMTP_CREDENTIAL},
                 onError="continueErrorOutput"),
            code_node("approve: build success page", (5080, -400), approved_page),
            respond("respond approved", (5300, -400), "={{ $json.html }}"),
            node("approve: mark approval_failed", "n8n-nodes-base.dataTable", 1.1, (4860, -180), {
                "operation": "update", "dataTableId": subtable, "filters": sid_filter,
                "columns": {"mappingMode": "defineBelow", "value": {"status": "approval_failed"},
                            "matchingColumns": [], "schema": dt_schema,
                            "attemptToConvertTypes": False, "convertFieldsToString": False},
                "options": {}}),
            # Deliberately generic: the original interpolated the raw GitHub
            # response into this page.
            respond("respond approval failed", (5080, -180),
                    html('<div class="status-icon" aria-hidden="true">!</div>'
                         '<p class="eyebrow">Action not completed</p>'
                         '<h1>Something went wrong</h1>'
                         '<p>The submission was <strong>not</strong> marked approved and '
                         'nothing was published. Details are in the n8n execution log. '
                         'This link is safe to retry.</p>', "warning")),
        ],
        "connections": {
            "Webhook": {"main": [[{"node": "mark link request", "type": "main", "index": 0}]]},
            "Webhook Confirm": {"main": [[{"node": "mark confirmed request", "type": "main", "index": 0}]]},
            "mark link request": {"main": [[{"node": "validate query", "type": "main", "index": 0}]]},
            "mark confirmed request": {"main": [[{"node": "validate query", "type": "main", "index": 0}]]},
            "validate query": {"main": [[{"node": "verify signature", "type": "main", "index": 0}]]},
            "verify signature": {"main": [[{"node": "auth verdict", "type": "main", "index": 0}]]},
            "auth verdict": {"main": [[{"node": "auth route", "type": "main", "index": 0}]]},
            "auth route": {"main": [
                [{"node": "get submission row", "type": "main", "index": 0}],
                [{"node": "respond expired", "type": "main", "index": 0}],
                [{"node": "respond invalid", "type": "main", "index": 0}]]},
            "get submission row": {"main": [[{"node": "view route", "type": "main", "index": 0}]]},
            "view route": {"main": [
                [{"node": "view: gate", "type": "main", "index": 0}],
                [{"node": "confirmed request?", "type": "main", "index": 0}]]},
            "view: gate": {"main": [[{"node": "view: pending?", "type": "main", "index": 0}]]},
            "view: pending?": {"main": [
                [{"node": "view: sign fresh links", "type": "main", "index": 0}],
                [{"node": "respond view unavailable", "type": "main", "index": 0}]]},
            "view: sign fresh links": {"main": [[{"node": "view: build page", "type": "main", "index": 0}]]},
            "view: build page": {"main": [[{"node": "respond view", "type": "main", "index": 0}]]},
            "confirmed request?": {"main": [
                [{"node": "precheck", "type": "main", "index": 0}],
                [{"node": "respond invalid", "type": "main", "index": 0}]]},
            "precheck": {"main": [[{"node": "may proceed?", "type": "main", "index": 0}]]},
            "may proceed?": {"main": [
                [{"node": "claim: stamp marker", "type": "main", "index": 0}],
                [{"node": "respond not actionable", "type": "main", "index": 0}]]},
            "claim: stamp marker": {"main": [[{"node": "claim: read back", "type": "main", "index": 0}]]},
            "claim: read back": {"main": [[{"node": "claim: won?", "type": "main", "index": 0}]]},
            "claim: won?": {"main": [[{"node": "claimed?", "type": "main", "index": 0}]]},
            "claimed?": {"main": [
                [{"node": "decision route", "type": "main", "index": 0}],
                [{"node": "respond not actionable", "type": "main", "index": 0}]]},
            "decision route": {"main": [
                [{"node": "approve: is removal?", "type": "main", "index": 0}],
                [{"node": "reject: is removal?", "type": "main", "index": 0}]]},
            "reject: is removal?": {"main": [
                [{"node": "reject: removal delete row", "type": "main", "index": 0}],
                [{"node": "reject: notify submitter", "type": "main", "index": 0}]]},
            "reject: removal delete row": {"main": [[
                {"node": "respond removal rejected", "type": "main", "index": 0}]]},

            # A withdrawal takes the upper path; everything else falls through
            # to the chain that was already here, unchanged.
            "approve: is removal?": {"main": [
                [{"node": "approve: removal prep", "type": "main", "index": 0}],
                [{"node": "approve: fetch ring.json", "type": "main", "index": 0}]]},
            "approve: removal prep": {"main": [
                [{"node": "approve: removal id known?", "type": "main", "index": 0}]]},
            "approve: removal id known?": {"main": [
                [{"node": "approve: removal get member sha", "type": "main", "index": 0}],
                [{"node": "approve: mark approval_failed", "type": "main", "index": 0}]]},
            "approve: removal get member sha": {"main": [
                [{"node": "approve: removal sha verdict", "type": "main", "index": 0}],
                [{"node": "approve: removal sha verdict", "type": "main", "index": 0}]]},
            "approve: removal sha verdict": {"main": [
                [{"node": "approve: removal file present?", "type": "main", "index": 0}]]},
            # `gone` means the file is already absent, which is the desired end
            # state rather than a failure -- mark it approved and stop.
            "approve: removal file present?": {"main": [
                [{"node": "approve: removal get main ref", "type": "main", "index": 0}],
                [{"node": "approve: mark approved + scrub", "type": "main", "index": 0}]]},
            "approve: removal get main ref": {"main": [
                [{"node": "approve: removal create branch", "type": "main", "index": 0}],
                [{"node": "approve: mark approval_failed", "type": "main", "index": 0}]]},
            "approve: removal create branch": {"main": [
                [{"node": "approve: removal delete member file", "type": "main", "index": 0}],
                [{"node": "approve: mark approval_failed", "type": "main", "index": 0}]]},
            "approve: removal delete member file": {"main": [
                [{"node": "approve: removal open PR", "type": "main", "index": 0}],
                [{"node": "approve: mark approval_failed", "type": "main", "index": 0}]]},
            "approve: removal open PR": {"main": [
                [{"node": "approve: PR verdict", "type": "main", "index": 0}],
                [{"node": "approve: PR verdict", "type": "main", "index": 0}]]},

            "reject: notify submitter": {"main": [
                [{"node": "reject: delivered?", "type": "main", "index": 0}],
                [{"node": "reject: delivered?", "type": "main", "index": 0}]]},
            "reject: delivered?": {"main": [[{"node": "reject: notified?", "type": "main", "index": 0}]]},
            "reject: notified?": {"main": [
                [{"node": "reject: delete row", "type": "main", "index": 0}],
                [{"node": "reject: restore status", "type": "main", "index": 0}]]},
            "reject: delete row": {"main": [[{"node": "respond rejected", "type": "main", "index": 0}]]},
            "reject: restore status": {"main": [[{"node": "respond reject failed", "type": "main", "index": 0}]]},

            "approve: fetch ring.json": {"main": [
                [{"node": "approve: parse ring", "type": "main", "index": 0}],
                [{"node": "approve: parse ring", "type": "main", "index": 0}]]},
            "approve: parse ring": {"main": [[{"node": "approve: ring ok?", "type": "main", "index": 0}]]},
            "approve: ring ok?": {"main": [
                [{"node": "approve: generate id + creator_id", "type": "main", "index": 0}],
                [{"node": "approve: mark approval_failed", "type": "main", "index": 0}]]},
            "approve: generate id + creator_id": {"main": [[{"node": "approve: strip fields (allowlist)", "type": "main", "index": 0}]]},
            "approve: strip fields (allowlist)": {"main": [[{"node": "approve: check existing member file", "type": "main", "index": 0}]]},
            "approve: check existing member file": {"main": [
                [{"node": "approve: build member file", "type": "main", "index": 0}],
                [{"node": "approve: build member file", "type": "main", "index": 0}]]},
            "approve: build member file": {"main": [[{"node": "approve: member sha known?", "type": "main", "index": 0}]]},
            "approve: member sha known?": {"main": [
                [{"node": "approve: get main ref", "type": "main", "index": 0}],
                [{"node": "approve: mark approval_failed", "type": "main", "index": 0}]]},
            "approve: get main ref": {"main": [
                [{"node": "approve: create branch", "type": "main", "index": 0}],
                [{"node": "approve: mark approval_failed", "type": "main", "index": 0}]]},
            "approve: create branch": {"main": [
                [{"node": "approve: commit member file", "type": "main", "index": 0}],
                [{"node": "approve: mark approval_failed", "type": "main", "index": 0}]]},
            "approve: commit member file": {"main": [
                [{"node": "approve: open PR", "type": "main", "index": 0}],
                [{"node": "approve: mark approval_failed", "type": "main", "index": 0}]]},
            "approve: open PR": {"main": [
                [{"node": "approve: PR verdict", "type": "main", "index": 0}],
                [{"node": "approve: PR verdict", "type": "main", "index": 0}]]},
            "approve: PR verdict": {"main": [[{"node": "approve: PR created?", "type": "main", "index": 0}]]},
            "approve: PR created?": {"main": [
                [{"node": "approve: notify submitter", "type": "main", "index": 0}],
                [{"node": "approve: mark approval_failed", "type": "main", "index": 0}]]},
            # Both outputs go the same way: sent or bounced, the approval stands
            # and the address is scrubbed either way.
            "approve: notify submitter": {"main": [
                [{"node": "approve: mark approved + scrub", "type": "main", "index": 0}],
                [{"node": "approve: mark approved + scrub", "type": "main", "index": 0}]]},
            "approve: mark approved + scrub": {"main": [[
                {"node": "approve: build success page", "type": "main", "index": 0}]]},
            "approve: build success page": {"main": [[
                {"node": "respond approved", "type": "main", "index": 0}]]},
            "approve: mark approval_failed": {"main": [[{"node": "respond approval failed", "type": "main", "index": 0}]]},
        },
    }



# --- Workflow: Intake --------------------------------------------------------

def wf_intake(ctx):
    """The public HTTP boundary. One webhook, seven actions, one response shape.

    Every failure path returns JSON. The original could hang instead: its
    honeypot IF compared body.elapsed_ms numerically under strict type
    validation, so a missing or wrong-typed field threw; no node anywhere set
    onError, so the throw aborted the run before any Respond node executed and
    the browser sat until webhookClient.js's 15s timeout. All validation now
    happens in one Code node that cannot throw on a missing field, and every
    Execute Workflow node routes its errors to a responder.

    `rate_status` (added 2026-08-31) is the odd one out: a read of the same
    rate-limit bucket `finalize-submission`'s `rate: decide` checks, called
    from `/update`'s identify step -- before the visitor has done anything a
    bot-gate or honeypot would apply to -- so it answers *before* the form and
    Turnstile challenge someone would otherwise sit through only to be told to
    come back later. It is answered inline rather than by an Execute Workflow
    call to Finalize: the whole thing is a hash lookup and a date comparison,
    and standing up a fourth sub-workflow for three nodes would be the
    restatement this file's own comments elsewhere already argue against.
    Never writes to the table, only reads it -- recording a hit is still
    `rate: record`'s job, at actual submit time.
    """
    classify = """
const body = $json.body;
const err = (code, message, retryable) =>
  [{ json: { route: 'error', payload: { ok: false, error: { message, code, retryable } } } }];

// A non-object body (malformed JSON, form encoding, empty POST) is a client
// error, not a reason to stop responding.
if (!body || typeof body !== 'object' || Array.isArray(body)) {
  return err('invalid_request', 'That request was not valid.', false);
}

const action = typeof body.action === 'string' ? body.action : '';
const TOKEN_ACTIONS = ['issue_token', 'request_update_token', 'bind_source_url', 'verify'];
const FINAL_ACTIONS = ['submit', 'submit_update', 'request_removal'];
// A read-only status check, not a form submission -- see this workflow's own
// docstring on why it is neither token-shaped nor final-shaped.
const STATUS_ACTIONS = ['rate_status'];
if (!TOKEN_ACTIONS.includes(action) && !FINAL_ACTIONS.includes(action) && !STATUS_ACTIONS.includes(action)) {
  return err('unsupported_action', 'Unsupported submission action.', false);
}

// Only form-entry actions carry the honeypot and dwell fields. Continuation
// actions (bind_source_url and verify) deliberately send only the fields in
// their contract and are already bound to server-side submission state.
// Gating those continuations on absent form fields silently drops every real
// Verify request before Token Lifecycle can run. rate_status is asked before
// the visitor has spent any dwell time at all, for the same reason.
const BOT_GATED_ACTIONS = [
  'issue_token', 'request_update_token',
  'submit', 'submit_update', 'request_removal'
];
if (BOT_GATED_ACTIONS.includes(action)) {
  // Compared as strings/numbers here rather than in a strict-typed IF, so a
  // missing field is "suspicious", never an exception.
  const website = typeof body.website === 'string' ? body.website : '';
  const elapsed = Number(body.elapsed_ms);
  const tooFast = !Number.isFinite(elapsed) || elapsed < %(dwell)d;
  if (website !== '' || tooFast) {
    return [{ json: { route: 'dropped', action } }];
  }
}

return [{ json: {
  route: STATUS_ACTIONS.includes(action) ? 'status' : (TOKEN_ACTIONS.includes(action) ? 'token' : 'final'),
  action, body
} }];
""" % {"dwell": MIN_DWELL_MS}

    prep_rate_status = """
const raw = (($json.body && $json.body.source_url) || '').toString().trim();
if (!raw || raw.length > 2048) {
  return [{ json: { route: 'error', payload: { ok: false, error: {
    message: 'That request was not valid.', code: 'invalid_request', retryable: false } } } }];
}

%(canonical_js)s

return [{ json: { route: 'ready', rate_key: canonical(raw) } }];
""" % {"canonical_js": CANONICAL_URL_JS}

    decide_rate_status = """
// Same bucket, same read `rate: decide` (finalize-submission) does -- but
// this never writes, and it has no `resume`/`is_removal` context to exempt
// (this is asked before the visitor has chosen either), so it reports the
// bucket's raw state. That is a feature, not an imprecision: the real
// exemptions still apply at actual submit time, and this is advisory only,
// never a gate -- see updateStore.svelte.js's own note on why the identify
// step's lookup is not a security boundary either.
const rows = $input.all().map((i) => i.json).filter((r) => r && r.created_at);
const WINDOW = %(win)d * 1000;
let newest = 0;
for (const r of rows) {
  const t = Date.parse(r.created_at);
  if (!Number.isNaN(t) && t > newest) newest = t;
}
const elapsed = newest > 0 ? Date.now() - newest : Infinity;
const blocked = newest > 0 && elapsed < WINDOW;
return [{ json: { ok: true, blocked,
  retry_after_seconds: blocked ? Math.ceil((WINDOW - elapsed) / 1000) : null } }];
""" % {"win": RATE_LIMIT_WINDOW_SECONDS}

    fake = """
// Shapes match the real success envelope for the requested action, so a bot
// cannot tell it was dropped. Nothing is allocated and no row is written.
const a = $json.action;
const fakeId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const exp = new Date(Date.now() + 86400000).toISOString();
const shapes = {
  issue_token:          { submission_id: fakeId(), verification_token: fakeId(), expires_at: exp },
  request_update_token: { submission_id: fakeId(), verification_token: fakeId(), expires_at: exp },
  submit:               { reference: fakeId() },
  submit_update:        { reference: fakeId() },
  request_removal:      { reference: fakeId() }
};
return [{ json: Object.assign({ ok: true }, shapes[a] || {}) }];
"""

    def call(name, pos, wid, cached):
        return node(name, "n8n-nodes-base.executeWorkflow", 1.3, pos, {
            "workflowId": {"__rl": True, "value": wid, "mode": "list", "cachedResultName": cached},
            "workflowInputs": {"mappingMode": "defineBelow", "value": {"body": "={{ $json.body }}"},
                               "matchingColumns": [""],
                               "schema": [{"id": "body", "displayName": "body", "required": False,
                                           "defaultMatch": False, "display": True,
                                           "canBeUsedToMatch": True, "type": "object",
                                           "removed": False}],
                               "attemptToConvertTypes": False, "convertFieldsToString": False},
            "options": {}}, onError="continueErrorOutput")

    def rule(val, i):
        return {"conditions": {"options": {"caseSensitive": True, "leftValue": "",
                                           "typeValidation": "loose", "version": 3},
                               "conditions": [{"id": "n%d" % i, "leftValue": "={{ $json.route }}",
                                               "rightValue": val,
                                               "operator": {"type": "string", "operation": "equals"}}],
                               "combinator": "and"}}

    def ifn(name, pos, left, right, idx):
        return node(name, "n8n-nodes-base.if", 2.3, pos, {
            "conditions": {"options": {"caseSensitive": True, "leftValue": "",
                                       "typeValidation": "loose", "version": 3},
                           "conditions": [{"id": "s0000000-0000-4000-8000-%012d" % idx,
                                           "leftValue": left, "rightValue": right,
                                           "operator": {"type": "string", "operation": "equals"}}],
                           "combinator": "and"},
            "options": {}})

    return {
        "name": "Webring - Intake v2",
        "settings": settings(error_workflow_id=ctx.get("error_workflow_id")),
        "nodes": [
            node("Webhook", "n8n-nodes-base.webhook", 2.1, (-880, 0), {
                "httpMethod": "POST", "path": INTAKE_WEBHOOK_PATH,
                "responseMode": "responseNode",
                "options": {"allowedOrigins": INTAKE_ALLOWED_ORIGINS}}),
            code_node("validate + classify", (-660, 0), classify),
            node("route", "n8n-nodes-base.switch", 3.4, (-440, 0), {
                "rules": {"values": [rule("token", 1), rule("final", 2), rule("dropped", 3),
                                      rule("status", 4)]},
                "options": {"fallbackOutput": "extra"}}),
            call("call Token Lifecycle v2", (-200, -180), ctx.get("lifecycle_id", ""),
                 "Webring - Token Lifecycle v2"),
            call("call Finalize Submission v2", (-200, -20), ctx.get("finalize_id", ""),
                 "Webring - Action - Finalize Submission v2"),
            code_node("shape fake success", (-200, 140), fake),

            code_node("rate status: prep", (-200, 300), prep_rate_status),
            ifn("rate status: valid?", (20, 300), "={{ $json.route }}", "error", 1),
            node("rate status: hash", "n8n-nodes-base.crypto", 2, (240, 260), {
                "action": "hmac", "type": "SHA256",
                "value": "={{ $json.rate_key }}",
                "encoding": "hex", "dataPropertyName": "hash"},
                 credentials={"crypto": RATE_LIMIT_CREDENTIAL}),
            node("rate status: get rows", "n8n-nodes-base.dataTable", 1.1, (460, 260), {
                "operation": "get",
                "dataTableId": {"__rl": True, "value": TABLE_RATE_LIMITS, "mode": "list",
                                "cachedResultName": "rate_limits"},
                "filters": {"conditions": [{"keyName": "source_url_hash",
                                            "keyValue": "={{ $json.hash }}"}]}},
                 alwaysOutputData=True),
            code_node("rate status: decide", (680, 260), decide_rate_status),

            code_node("shape client error", (-200, 460), "return [{ json: $json.payload }];"),
            # A sub-workflow that throws must still produce JSON. Without this
            # the run aborts, Respond never fires, and the browser waits out its
            # own 15s timeout on what is really a server fault.
            code_node("shape operational error", (60, 580),
                      "return [{ json: { ok: false, error: {\n"
                      "  message: 'Something went wrong on our side. Please try again.',\n"
                      "  code: 'internal_error', retryable: true } } }];"),
            node("Respond", "n8n-nodes-base.respondToWebhook", 1.5, (900, 0),
                 {"respondWith": "json", "responseBody": "={{ $json }}", "options": {}}),
        ],
        "connections": {
            "Webhook": {"main": [[{"node": "validate + classify", "type": "main", "index": 0}]]},
            "validate + classify": {"main": [[{"node": "route", "type": "main", "index": 0}]]},
            "route": {"main": [
                [{"node": "call Token Lifecycle v2", "type": "main", "index": 0}],
                [{"node": "call Finalize Submission v2", "type": "main", "index": 0}],
                [{"node": "shape fake success", "type": "main", "index": 0}],
                [{"node": "rate status: prep", "type": "main", "index": 0}],
                [{"node": "shape client error", "type": "main", "index": 0}]]},
            "call Token Lifecycle v2": {"main": [
                [{"node": "Respond", "type": "main", "index": 0}],
                [{"node": "shape operational error", "type": "main", "index": 0}]]},
            "call Finalize Submission v2": {"main": [
                [{"node": "Respond", "type": "main", "index": 0}],
                [{"node": "shape operational error", "type": "main", "index": 0}]]},
            "shape fake success": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
            "rate status: prep": {"main": [[{"node": "rate status: valid?", "type": "main", "index": 0}]]},
            "rate status: valid?": {"main": [
                [{"node": "shape client error", "type": "main", "index": 0}],
                [{"node": "rate status: hash", "type": "main", "index": 0}]]},
            "rate status: hash": {"main": [[{"node": "rate status: get rows", "type": "main", "index": 0}]]},
            "rate status: get rows": {"main": [[{"node": "rate status: decide", "type": "main", "index": 0}]]},
            "rate status: decide": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
            "shape client error": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
            "shape operational error": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
        },
    }


# --- Workflow: Contact -------------------------------------------------------

def wf_contact(ctx):
    """`/contact`, which is a different shape of problem from a submission.

    No storage, no queue, no token, no review -- the runbook's section 11 is
    right that nothing here needs to be kept. But that has a consequence worth
    being explicit about, because it inverts the submission pipeline's
    failure handling: with no row written anywhere, a message that fails to
    deliver is *gone*. Finalize can afford to answer "received" and retry a
    notification later because the submission is safely in a Data Table. This
    workflow cannot. So delivery failure returns a retryable error and never a
    reference -- answering `{ reference }` for a message nobody will ever read
    would be a lie the sender has no way to detect.

    Deterministic Code nodes rather than the AI-agent formatting the KJO
    contact flow uses. That flow's model call is a third-party dependency and
    a per-message cost in the path between a person and a maintainer, to
    produce an email whose shape is known in advance. It also authenticates
    its webhook with a header credential, which works there because n8n is the
    only caller; here the caller is a browser, so a header secret would ship
    in the client bundle. The honeypot, dwell gate and CORS list do that job
    instead.
    """
    validate = """
const body = $json.body;
const err = (code, message, retryable) =>
  [{ json: { route: 'error', payload: { ok: false, error: { message, code, retryable } } } }];

if (!body || typeof body !== 'object' || Array.isArray(body)) {
  return err('invalid_request', 'That request was not valid.', false);
}

// Bot gate first, before any validation can tell a bot which field it got
// wrong. Compared loosely so a missing field is "suspicious", never a throw --
// the same reasoning as intake's, and the same fake success on the far side.
const website = typeof body.website === 'string' ? body.website : '';
const elapsed = Number(body.elapsed_ms);
const tooFast = !Number.isFinite(elapsed) || elapsed < %(dwell)d;
if (website !== '' || tooFast) {
  return [{ json: { route: 'dropped' } }];
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const name = str(body.name);
const email = str(body.email);
const message = str(body.message);

if (!name || !email || !message) {
  return err('invalid_request', 'Name, email, and message are all required.', false);
}

// Deliberately permissive: one @, something either side, no whitespace. A
// stricter regex rejects real addresses, and the only consequence of a bad one
// here is a reply that bounces -- there is no account to protect.
if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) {
  return err('invalid_request', 'That email address does not look right.', false);
}

// Caps, not rejections, except where a value is absurd. A long message is
// still a message worth reading; a 200KB one is a payload.
if (message.length > 20000 || name.length > 1000 || email.length > 320) {
  return err('invalid_request', 'That message is too long to send.', false);
}

return [{ json: { route: 'send',
  name: name.slice(0, 200),
  email: email.slice(0, 320),
  message: message.slice(0, 5000)
} }];
""" % {"dwell": MIN_DWELL_MS}

    # Same generator as intake's fake success, and for the same reason: it must
    # be indistinguishable from a real reference, and n8n's Code sandbox has no
    # crypto.randomUUID to make a better one with.
    reference = "Date.now().toString(36) + Math.random().toString(36).slice(2, 10)"

    build_notification = """
const d = $json;
const ref = %(ref)s;

// The sender's address travels in the body of a message going straight to a
// maintainer and is written to no table anywhere -- this workflow has no
// storage at all. That is what keeps /contact inside the project's
// no-stored-personal-data stance while still being repliable.
const title = 'IndieNodes contact: ' + d.name;
const lines = [
  'From: ' + d.name + ' <' + d.email + '>',
  'Reference: ' + ref,
  '',
  d.message
];

return [{ json: { reference: ref, replyTo: d.email, title, body: lines.join('\\n') } }];
""" % {"ref": reference}

    fake = """
// Shaped exactly like a delivered message, so a bot learns nothing from being
// dropped. Nothing is sent and nothing is allocated.
const fakeId = () => %s;
return [{ json: { ok: true, reference: fakeId() } }];
""" % reference

    delivered = (
        "// The node throws on transport or API failure and that lands on the error\n"
        "// output, so an item arriving here is a delivered message.\n"
        "const failed = Boolean($json.error) || $json.__error === true;\n"
        "return [{ json: { ok: failed ? 'no' : 'yes' } }];"
    )

    def ifn(name, pos, left, right, idx):
        return node(name, "n8n-nodes-base.if", 2.3, pos, {
            "conditions": {"options": {"caseSensitive": True, "leftValue": "",
                                       "typeValidation": "loose", "version": 3},
                           "conditions": [{"id": "c0000000-0000-4000-8000-%012d" % idx,
                                           "leftValue": left, "rightValue": right,
                                           "operator": {"type": "string", "operation": "equals"}}],
                           "combinator": "and"},
            "options": {}})

    def rule(val, i):
        return {"conditions": {"options": {"caseSensitive": True, "leftValue": "",
                                           "typeValidation": "loose", "version": 3},
                               "conditions": [{"id": "r%d" % i, "leftValue": "={{ $json.route }}",
                                               "rightValue": val,
                                               "operator": {"type": "string", "operation": "equals"}}],
                               "combinator": "and"}}

    nodes = [
        node("Webhook", "n8n-nodes-base.webhook", 2.1, (-880, 0), {
            "httpMethod": "POST", "path": CONTACT_WEBHOOK_PATH,
            "responseMode": "responseNode",
            "options": {"allowedOrigins": INTAKE_ALLOWED_ORIGINS}}),
        code_node("validate", (-660, 0), validate),
        node("route", "n8n-nodes-base.switch", 3.4, (-440, 0), {
            "rules": {"values": [rule("send", 1), rule("dropped", 2)]},
            "options": {"fallbackOutput": "extra"}}),

        code_node("build notification", (-200, -160), build_notification),
        node("notify: gotify", "n8n-nodes-base.gotify", 1, (20, -160), {
            "message": "={{ $json.body }}",
            "additionalFields": {"title": "={{ $json.title }}", "priority": 7}},
             credentials={"gotifyApi": GOTIFY_CREDENTIAL},
             onError="continueErrorOutput"),
        code_node("gotify delivered?", (240, -160), delivered),
        ifn("gotify ok?", (460, -160), "={{ $json.ok }}", "yes", 1),

        # Fallback, reached when Gotify is unset, down, or rejects. replyTo is
        # set so a maintainer can answer the sender directly from their mail
        # client rather than copying an address out of the body.
        node("notify: email fallback", "n8n-nodes-base.emailSend", 2.1, (460, 20), {
            "fromEmail": NOTIFY_FROM_EMAIL,
            "toEmail": REVIEWER_EMAIL,
            "subject": "={{ $('build notification').first().json.title }}",
            "emailFormat": "text",
            "text": "={{ $('build notification').first().json.body }}",
            "options": {"replyTo": "={{ $('build notification').first().json.replyTo }}"}},
             credentials={"smtp": SMTP_CREDENTIAL},
             onError="continueErrorOutput"),
        code_node("email delivered?", (680, 20), delivered),
        ifn("email ok?", (900, 20), "={{ $json.ok }}", "yes", 2),

        code_node("shape sent", (1120, -160),
                  "return [{ json: { ok: true,\n"
                  "  reference: $('build notification').first().json.reference } }];"),

        # Both channels failed and nothing was stored, so there is no copy of
        # this message anywhere. Retryable, because trying again is the only
        # thing that can still work -- and honest, because the alternative is
        # handing back a reference for a message that does not exist.
        code_node("shape undelivered", (1120, 180),
                  "return [{ json: { ok: false, error: {\n"
                  "  message: 'That message could not be delivered. Please try again.',\n"
                  "  code: 'not_delivered', retryable: true } } }];"),

        code_node("shape fake success", (-200, 60), fake),
        code_node("shape client error", (-200, 260), "return [{ json: $json.payload }];"),
        node("Respond", "n8n-nodes-base.respondToWebhook", 1.5, (1400, 0),
             {"respondWith": "json", "responseBody": "={{ $json }}", "options": {}}),
    ]

    return {
        "name": "Webring - Contact v2",
        # no_persist is not an optimisation. Contact correspondence may remain
        # in the notification or email system long enough to review and reply,
        # but n8n must not retain a second full copy of the name, address, and
        # message in execution history. Turning retention off enforces that
        # separation.
        #
        # The cost is real: a delivery that fails leaves nothing to inspect.
        # That is the right trade here because the sender is told plainly that
        # it failed and to try again, and a Gotify or SMTP outage is
        # diagnosable from those services rather than from a copy of someone's
        # message.
        "settings": settings(error_workflow_id=ctx.get("error_workflow_id"), no_persist=True),
        "nodes": nodes,
        "connections": {
            "Webhook": {"main": [[{"node": "validate", "type": "main", "index": 0}]]},
            "validate": {"main": [[{"node": "route", "type": "main", "index": 0}]]},
            "route": {"main": [
                [{"node": "build notification", "type": "main", "index": 0}],
                [{"node": "shape fake success", "type": "main", "index": 0}],
                [{"node": "shape client error", "type": "main", "index": 0}]]},
            "build notification": {"main": [[{"node": "notify: gotify", "type": "main", "index": 0}]]},
            "notify: gotify": {"main": [
                [{"node": "gotify delivered?", "type": "main", "index": 0}],
                [{"node": "gotify delivered?", "type": "main", "index": 0}]]},
            "gotify delivered?": {"main": [[{"node": "gotify ok?", "type": "main", "index": 0}]]},
            "gotify ok?": {"main": [
                [{"node": "shape sent", "type": "main", "index": 0}],
                [{"node": "notify: email fallback", "type": "main", "index": 0}]]},
            "notify: email fallback": {"main": [
                [{"node": "email delivered?", "type": "main", "index": 0}],
                [{"node": "email delivered?", "type": "main", "index": 0}]]},
            "email delivered?": {"main": [[{"node": "email ok?", "type": "main", "index": 0}]]},
            "email ok?": {"main": [
                [{"node": "shape sent", "type": "main", "index": 0}],
                [{"node": "shape undelivered", "type": "main", "index": 0}]]},
            "shape sent": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
            "shape undelivered": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
            "shape fake success": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
            "shape client error": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
        },
    }


def wf_rating(ctx):
    """The one-time app rating, which is the smallest workflow here on purpose.

    A rating is a single integer with no sender, no reply address, and nothing
    to follow up on. Nobody is waiting on the response, so unlike Contact this
    workflow owes no delivery guarantee: if Gotify is down the rating is lost
    and that is an acceptable outcome, which is why there is no email fallback
    and no "undelivered" shape. The client is told it succeeded either way and
    deliberately ignores the answer.

    **Storage is optional and off until `TABLE_RATINGS` names a table.** With
    it unset the workflow notifies and keeps nothing, which is how it first
    shipped. With it set, each rating also becomes one row of `{ rating,
    created_at, app_version }`, so an average or a trend can be read later
    instead of eyeballing notifications as they arrive.

    That row is not personal data and cannot become it: there is no identifier
    in the payload to store, and none is derived. `created_at` is deliberately
    a **date, not a timestamp** -- day-level precision is what a trend needs,
    and it removes the one thin correlation a per-second time would otherwise
    leave against a web server's own access log. Execution history stays off
    (`no_persist`) either way, so the row is the only copy that exists.
    """
    validate = """
const body = $json.body;
const err = (code, message, retryable) =>
  [{ json: { route: 'error', payload: { ok: false, error: { message, code, retryable } } } }];

if (!body || typeof body !== 'object' || Array.isArray(body)) {
  return err('invalid_request', 'That request was not valid.', false);
}

// Bot gate first, before validation can tell a bot which field it got wrong --
// same order and same fake success as intake and Contact.
const website = typeof body.website === 'string' ? body.website : '';
const elapsed = Number(body.elapsed_ms);
const tooFast = !Number.isFinite(elapsed) || elapsed < %(dwell)d;
if (website !== '' || tooFast) {
  return [{ json: { route: 'dropped' } }];
}

const rating = Number(body.rating);
if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
  return err('invalid_request', 'That rating was not valid.', false);
}

// Everything else is optional context, capped rather than required. A missing
// or absurd app_version costs nothing; refusing the rating over one would.
const version = typeof body.app_version === 'string' ? body.app_version.slice(0, 40) : '';
const submitted = typeof body.submitted_at === 'string' ? body.submitted_at.slice(0, 40) : '';

return [{ json: { route: 'send', rating, app_version: version, submitted_at: submitted } }];
""" % {"dwell": MIN_DWELL_MS}

    build_notification = """
const d = $json;
const stars = '*'.repeat(d.rating) + '.'.repeat(5 - d.rating);

// No sender, because there is no sender. This is the whole message.
return [{ json: {
  title: `IndieNodes rating: ${d.rating}/5`,
  body: [
    `${stars}  ${d.rating} of 5`,
    d.app_version ? `App version: ${d.app_version}` : '',
    d.submitted_at ? `Submitted: ${d.submitted_at}` : ''
  ].filter(Boolean).join('\\n')
} }];
"""

    # Shaped like a success, so a dropped bot learns nothing. There is no
    # reference to fake here because the real path does not issue one either.
    ok = "return [{ json: { ok: true } }];"

    def rule(val, i):
        return {"conditions": {"options": {"caseSensitive": True, "leftValue": "",
                                           "typeValidation": "loose", "version": 3},
                               "conditions": [{"id": "r%d" % i, "leftValue": "={{ $json.route }}",
                                               "rightValue": val,
                                               "operator": {"type": "string", "operation": "equals"}}],
                               "combinator": "and"}}

    nodes = [
        node("Webhook", "n8n-nodes-base.webhook", 2.1, (-880, 0), {
            "httpMethod": "POST", "path": RATING_WEBHOOK_PATH,
            "responseMode": "responseNode",
            "options": {"allowedOrigins": INTAKE_ALLOWED_ORIGINS}}),
        code_node("validate", (-660, 0), validate),
        node("route", "n8n-nodes-base.switch", 3.4, (-440, 0), {
            "rules": {"values": [rule("send", 0), rule("dropped", 1), rule("error", 2)]},
            "options": {"fallbackOutput": 2}}),
        code_node("build notification", (-200, -160), build_notification),
        node("notify: gotify", "n8n-nodes-base.gotify", 1, (240, -160), {
            "message": "={{ $json.body }}",
            "additionalFields": {"title": "={{ $json.title }}", "priority": 3}},
             credentials={"gotifyApi": GOTIFY_CREDENTIAL},
             onError="continueRegularOutput"),
        # One shape for both the delivered and the dropped path. A rating that
        # failed to send is not the visitor's problem and there is nothing for
        # them to do about it, so they are never told.
        code_node("shape ok", (460, -160), ok),
        code_node("shape fake success", (-200, 60), ok),
        code_node("shape client error", (-200, 260), "return [{ json: $json.payload }];"),
        node("Respond", "n8n-nodes-base.respondToWebhook", 1.5, (740, 0),
             {"respondWith": "json", "responseBody": "={{ $json }}", "options": {}}),
    ]

    # Written before the notification rather than after, so a Gotify outage
    # costs the notification and not the row. The reverse order would lose the
    # rating itself to a failure in the part that matters least.
    store = "store rating"
    if TABLE_RATINGS:
        nodes.insert(4, node(store, "n8n-nodes-base.dataTable", 1.1, (20, -160), {
            "dataTableId": {"__rl": True, "value": TABLE_RATINGS, "mode": "list",
                            "cachedResultName": "ratings"},
            "columns": {"mappingMode": "defineBelow",
                        "value": {"rating": "={{ $json.rating }}",
                                  "created_at": "={{ new Date().toISOString().slice(0, 10) }}",
                                  "app_version": "={{ $json.app_version }}"},
                        "matchingColumns": [], "schema": dt_node_schema("ratings"),
                        "attemptToConvertTypes": False, "convertFieldsToString": False},
            "options": {}},
            # A storage failure must not cost the notification: the maintainer
            # still hears the rating even if the row could not be written.
            onError="continueRegularOutput"))

    after_build = ([{"node": store, "type": "main", "index": 0}] if TABLE_RATINGS
                   else [{"node": "notify: gotify", "type": "main", "index": 0}])

    return {
        "name": "Webring - Rating v1",
        # Same reasoning as Contact's, with less to protect: there is no name,
        # address, or message here, but there is also no reason to keep a
        # per-execution copy of a number whose entire purpose is to be read once
        # in a notification.
        "settings": settings(error_workflow_id=ctx.get("error_workflow_id"), no_persist=True),
        "nodes": nodes,
        "connections": {
            "Webhook": {"main": [[{"node": "validate", "type": "main", "index": 0}]]},
            "validate": {"main": [[{"node": "route", "type": "main", "index": 0}]]},
            "route": {"main": [
                [{"node": "build notification", "type": "main", "index": 0}],
                [{"node": "shape fake success", "type": "main", "index": 0}],
                [{"node": "shape client error", "type": "main", "index": 0}]]},
            "build notification": {"main": [after_build]},
            **({store: {"main": [[{"node": "notify: gotify", "type": "main", "index": 0}]]}}
               if TABLE_RATINGS else {}),
            "notify: gotify": {"main": [[{"node": "shape ok", "type": "main", "index": 0}]]},
            "shape ok": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
            "shape fake success": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
            "shape client error": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
        },
    }


BUILDERS = [
    ("error-workflow", wf_error_workflow),
    ("signature-helper", wf_signature_helper),
    ("reverify-token", wf_reverify_token),
    ("token-lifecycle", wf_token_lifecycle),
    ("finalize-submission", wf_finalize_submission),
    ("review-action", wf_review_action),
    ("intake", wf_intake),
    ("contact", wf_contact),
    ("rating", wf_rating),
]


# --- n8n API ----------------------------------------------------------------

def api_key():
    path = os.path.expanduser("~/.n8n-api-key")
    if not os.path.exists(path):
        sys.exit(f"missing {path} -- see docs/n8n-workflow-runbook.md section 1")
    return open(path).read().strip()


def request(method, path, key, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, method=method,
                                 headers={"X-N8N-API-KEY": key,
                                          "Content-Type": "application/json",
                                          # Cloudflare fronts this host and 403s
                                          # (error 1010) on the default
                                          # Python-urllib agent.
                                          "User-Agent": "indienodes-workflow-generator/1"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or "{}")
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} -> HTTP {e.code}: {e.read().decode()[:400]}")


def existing_by_name(key):
    out = {}
    for w in request("GET", "/workflows?limit=250", key).get("data", []):
        out.setdefault(w["name"], w["id"])
    return out


def push(payload, key, existing):
    # An Execute Workflow node with an empty workflowId is accepted by the API
    # and only fails later, at activation, with a message that does not name the
    # cause. Catch it at the source.
    for n in payload["nodes"]:
        if n["type"] == "n8n-nodes-base.executeWorkflow":
            wid = (n["parameters"].get("workflowId") or {}).get("value")
            if not wid:
                sys.exit(f"{payload['name']}: node {n['name']!r} has no workflowId -- "
                         f"its target workflow does not exist yet")
    body = {k: payload[k] for k in ("name", "nodes", "connections", "settings")}
    wid = existing.get(payload["name"])
    if wid:
        request("PUT", f"/workflows/{wid}", key, body)
        return wid, "updated"
    return request("POST", "/workflows", key, body)["id"], "created"


def create_tables():
    """Recreate any Data Table in DATA_TABLES_SCHEMA that is currently missing.

    Scripts the exact recovery this generator's own tables needed by hand on
    2026-08-23, when `submissions` was deleted by accident and production was
    down until someone reconstructed its 11 columns from memory and a few API
    calls. This is that reconstruction, now one command -- and proof the
    schema file is actually sufficient to rebuild from, not just documentation
    that looks plausible until the day it's needed.

    Never edits TABLE_SUBMISSIONS / TABLE_RATE_LIMITS itself: which table a
    workflow points at is exactly the kind of thing that should be a
    deliberate, reviewed edit, not a side effect of running a recovery script
    under pressure.
    """
    key = api_key()
    live = {t["name"]: t["id"] for t in request("GET", "/data-tables", key).get("data", [])}
    for table, spec in DATA_TABLES_SCHEMA.items():
        if table in live:
            print(f"  exists   {live[table]}  {table}")
            continue
        body = {"name": table, "columns": spec["columns"]}
        new_id = request("POST", "/data-tables", key, body)["id"]
        const = "TABLE_" + table.upper()
        print(f"  created  {new_id}  {table}")
        print(f'           paste into build_workflows.py: {const} = "{new_id}"')


def slugify(name):
    return name.lower().replace(" - ", "-").replace(" ", "-")


def ctx_for_emit():
    """The build context `--emit` can offer without an API key.

    Empty, and every builder already treats it that way: `settings()` omits
    `errorWorkflow` when it resolves to nothing, and caller allowlists fall
    back to the instance default rather than an empty list that would block
    every caller. A workflow emitted this way is importable as-is; anything
    that genuinely needs a live id (the review-link signature helper's
    `workflowId`, for instance) is why `--push` exists and is the reason this
    is not a general substitute for it.
    """
    return {}


def export_workflows():
    """Snapshot every live production workflow's raw JSON into the repo.

    Not the source of truth -- `--push` regenerates every workflow from this
    file and always will be. This exists for the case that source can't help
    with: n8n itself loses a workflow (as it lost the submissions Data Table
    on 2026-08-23), or a generator bug ships and isn't caught before a push.
    Written byte-for-byte as the API returns it, not reparsed and reformatted,
    so a diff against a later export is a diff against what n8n actually
    stored, not against this script's opinion of it.
    """
    key = api_key()
    existing = existing_by_name(key)
    out_dir = pathlib.Path(__file__).parent / "backups"
    out_dir.mkdir(exist_ok=True)
    count = 0
    for _, builder in BUILDERS:
        name = builder({})["name"]
        wid = existing.get(name)
        if not wid:
            print(f"  SKIP     {name!r} -- not found live, nothing to export")
            continue
        req = urllib.request.Request(
            f"{API}/workflows/{wid}", method="GET",
            headers={"X-N8N-API-KEY": key, "User-Agent": "indienodes-workflow-generator/1"})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
        path = out_dir / f"{slugify(name)}.json"
        path.write_bytes(raw)
        # Relative to this file's own repo, not the caller's cwd -- avoids a
        # crash if this is ever run from somewhere other than the repo root.
        repo_root = pathlib.Path(__file__).resolve().parents[2]
        print(f"  exported {wid}  {name}  -> {path.resolve().relative_to(repo_root)}")
        count += 1
    print(f"\n  {count} workflow(s) exported to {out_dir}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--push", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--create-tables", action="store_true")
    ap.add_argument("--export", action="store_true")
    ap.add_argument("--emit", action="store_true")
    ap.add_argument("--only")
    args = ap.parse_args()

    if args.list:
        for name, _ in BUILDERS:
            print(" ", name)
        return

    if args.create_tables:
        create_tables()
        return

    if args.export:
        export_workflows()
        return

    # Full generator output to stdout, for importing a workflow through n8n's
    # UI instead of pushing it over the API -- the case `--dry-run` cannot
    # serve, since it truncates to 400 characters, and `--export` cannot
    # either, since that reads back from a live instance and a workflow that
    # has never been pushed is not there to read.
    #
    #   python3 build_workflows.py --emit --only rating > rating.json
    #
    # Deliberately stdout rather than a file in the repo. This output is
    # reproducible from this script at any time, so a committed copy would be
    # one more artifact to drift out of date -- which is exactly what
    # backups/README.md warns about for the snapshots that DO belong in git,
    # and those are raw API reads of live workflows rather than anything built
    # here.
    if args.emit:
        out = [builder(ctx_for_emit()) for name, builder in BUILDERS
               if not args.only or args.only == name]
        if not out:
            ap.error(f"no workflow named {args.only!r}; --list shows the names")
        print(json.dumps(out[0] if len(out) == 1 else out, indent=2, ensure_ascii=False))
        return

    if not (args.dry_run or args.push):
        ap.error("pass --dry-run, --push, --create-tables, or --export")

    key = api_key() if args.push else None
    existing = existing_by_name(key) if args.push else {}
    callers = [existing[n] for n in SIGNATURE_CALLER_NAMES if n in existing]
    callers += [c for c in os.environ.get("N8N_EXTRA_CALLERS", "").split(",") if c]
    extra = [c for c in os.environ.get("N8N_EXTRA_CALLERS", "").split(",") if c]
    ctx = {"error_workflow_id": existing.get(ERROR_WORKFLOW_NAME),
           "signature_callers": callers,
           "reverify_callers": [existing[n] for n in REVERIFY_CALLER_NAMES
                                if n in existing] + extra,
           "reverify_id": existing.get("Webring - Helper - Re-verify Token v2", ""),
           "lifecycle_callers": [existing[n] for n in ["Webring - Intake v2"]
                                 if n in existing] + extra,
           "signature_id": existing.get("Webring - Helper - Review Link Signature v2", ""),
           "finalize_callers": [existing[n] for n in ["Webring - Intake v2"]
                                if n in existing] + extra}

    def rebuild_ctx():
        callers = [existing[n] for n in SIGNATURE_CALLER_NAMES if n in existing] + extra
        ctx.update({
            "error_workflow_id": existing.get(ERROR_WORKFLOW_NAME),
            "signature_callers": callers,
            "signature_id": existing.get("Webring - Helper - Review Link Signature v2", ""),
            "reverify_id": existing.get("Webring - Helper - Re-verify Token v2", ""),
            "reverify_callers": [existing[n] for n in REVERIFY_CALLER_NAMES if n in existing] + extra,
            "lifecycle_callers": [existing[n] for n in ["Webring - Intake v2"] if n in existing] + extra,
            "finalize_callers": [existing[n] for n in ["Webring - Intake v2"] if n in existing] + extra,
            "lifecycle_id": existing.get("Webring - Token Lifecycle v2", ""),
            "finalize_id": existing.get("Webring - Action - Finalize Submission v2", ""),
        })

    targets = [(n, b) for n, b in BUILDERS if not args.only or args.only == n]

    if args.dry_run:
        for name, builder in targets:
            wf = builder(ctx)
            print(f"--- {name}: {wf['name']} ({len(wf['nodes'])} nodes)")
            print(json.dumps(wf, indent=2)[:400] + " ...")
        return

    # Two passes. A caller allowlist can only name workflows that already
    # exist, so a helper pushed before its caller is built ends up refusing it
    # ("cannot be called by this workflow"). The second pass re-resolves every
    # allowlist now that all the IDs are known.
    passes = 2 if len(targets) > 1 else 1
    for p in range(passes):
        rebuild_ctx()
        for name, builder in targets:
            wf = builder(ctx)
            wid, action = push(wf, key, existing)
            existing[wf["name"]] = wid
            if p == passes - 1:
                print(f"  {action:<8} {wid}  {wf['name']}  ({len(wf['nodes'])} nodes)")


if __name__ == "__main__":
    main()
