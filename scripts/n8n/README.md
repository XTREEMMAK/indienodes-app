# n8n workflow generator

The IndieNodes n8n workflows are generated from `build_workflows.py`, not
hand-edited. Editing a workflow in the n8n UI works until the next push, which
silently reverts it — change this script instead.

```bash
python3 scripts/n8n/build_workflows.py --list
python3 scripts/n8n/build_workflows.py --dry-run --only signature-helper
python3 scripts/n8n/build_workflows.py --push
python3 scripts/n8n/build_workflows.py --export         # after every push, see Backups below
```

## Credentials and secrets

Nothing here contains a secret. The review-link HMAC secret lives in the n8n
credential named in `CRYPTO_CREDENTIAL` and is resolved inside the Crypto node,
so it never reaches workflow data, an execution record, or an export. Rotate it
in the n8n UI (Credentials → the named credential → HMAC Secret); no workflow
change or restart is needed.

The API key is read from `~/.n8n-api-key` (mode 600, never committed). Write it
with `printf`, not `echo` — a trailing newline lands inside the auth header and
produces a 401 that looks like a wrong key.

## Instance-specific constants

`N8N_BASE`, the two Data Table IDs (`TABLE_SUBMISSIONS`, `TABLE_RATE_LIMITS`), and every
`*_CREDENTIAL` constant are IDs on one instance, not portable values. Confirm them before
pushing anywhere else.

## Data Tables: schema backup and recovery

`data-tables-schema.json` is the single source of truth for both tables' columns — names, order,
and n8n's own type strings (`string`/`date`; **not** `dateTime`, which is a different vocabulary
used only inside a workflow node's own column-mapper parameters, derived from this file rather
than duplicated). `build_workflows.py` loads it once and every workflow's Data Table nodes read
from it, so there is exactly one place these columns are defined.

If a table is ever deleted — as `submissions` was by accident on 2026-08-23, taking
`indienodes-submit` down until it was manually reconstructed — recreate it with:

```bash
python3 scripts/n8n/build_workflows.py --create-tables
```

Reports any table that already exists and makes no write to it; creates anything missing from
`data-tables-schema.json` and prints the constant line to paste into this file
(`TABLE_SUBMISSIONS = "..."` / `TABLE_RATE_LIMITS = "..."`). It never edits that constant itself —
which table a workflow points at should be a deliberate, reviewed edit, not a side effect of a
recovery script run under pressure. After pasting the new ID, `--push` every workflow that
references the recreated table.

**Adding a column to a table that already exists is not automated.** `--create-tables` only
creates whatever's missing; it never alters a table it finds already there. Add the column to
`data-tables-schema.json` first (so every workflow's Data Table nodes pick up the new field on
their next `--push`), then add it to the live table by hand — n8n UI → Data Tables → the table →
add column, matching the name and type — _before_ pushing any workflow that reads or writes it.
Pushing first would have nodes referencing a column the live table doesn't have yet.

## Backups

`backups/*.json` are raw exports of the seven live production workflows — see
`backups/README.md` for what they are, how to regenerate them, and how to restore from one. Not
the source of truth (this generator is); a safety net for what regenerating can't help with, like
n8n losing a workflow the way it lost `submissions`. **Re-export after every production
`--push`** or the snapshots are stale from the moment they're needed.

## Two constraints worth knowing

- **Sub-workflows must be published before their callers can activate.** n8n
  refuses to publish a workflow whose Execute Workflow node references an
  unpublished sub-workflow, so helpers activate first. This is safe: a helper
  has only an Execute Workflow trigger and no webhook, so activating it exposes
  nothing publicly. `--push` publishes a helper it has just created (saving an
  existing active workflow republishes it on its own); it never activates a
  workflow with a webhook. `--export` exits non-zero if any exported workflow
  is a draft n8n has not published, since `--check-drift` compares against
  those exports and would otherwise report a draft as shipped.
- **`callerPolicy: workflowsFromAList` with an empty `callerIds` blocks every
  caller.** The script omits the policy entirely until at least one named
  caller exists. Set `N8N_EXTRA_CALLERS=<id>,<id>` to temporarily admit a test
  harness.

See `docs/n8n-workflow-runbook.md` for the design and the contract each workflow
implements. (The separate v2 refactor plan that used to be cited here for the design was
deleted on 2026-09-04, once every phase in it had shipped and the runbook had absorbed it;
it remains in git history.)
