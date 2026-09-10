# Pre-launch access gate

A temporary HTTP credential gate on the production deployment, so the site can be live and
the public widget testable from real third-party host pages before the app itself is meant
to be public.

**This started as a pre-launch-only feature and is now kept permanently.** It shipped
expecting to be deleted once 1.5.0 went live, but the same need — a gated image for
testing a preview build against real host pages, or for any other staging round where the
app should not be publicly reachable yet — recurs on an ongoing basis, so the feature
stays rather than being rebuilt from scratch next time. Nothing below changes: same
Caddy-enforced mechanism, same build-arg-only activation, same manual `workflow_dispatch`
step to actually get a gated image out of CI. This file just stops being scheduled for
deletion.

- **Why it is enforced in Caddy rather than as a PIN screen in the app** —
  [`decisions.md`](./decisions.md), "the pre-launch gate is enforced by Caddy".
- **What it is for** — [`roadmap.md`](./roadmap.md), "Widget validation".

## What it does

When enabled, every route is behind HTTP basic authentication **except** the surface a
member's own site loads cross-origin. Those must stay open or the thing being tested does
not work:

| Open, no credentials                                            | Why                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `/embed-frame`, `/embed-frame.html`, `/embed-frame/*`           | the sandboxed iframe tier's target                                              |
| `/go/random`, `/go/random.html`, `/go/random/*`                 | the badge and text tiers' destination                                           |
| `/embed.js`, `/embed.v1.js`, `/ring.json`                       | the widget loader and the data it fetches                                       |
| `/badges/*`                                                     | the `<img>` badge tier                                                          |
| `/_app/*`                                                       | hydration chunks; `/embed-frame` is a real SvelteKit route                      |
| `/images/*`, `/icons/*`, `/manifest.webmanifest`, `/robots.txt` | `embed-frame.html` renders a literal `<img src="/images/IndieNodes_Logo.webp">` |

Everything else — `/`, `/join`, `/update`, `/settings`, `/members`, `/widget`, `/contact`,
`/lists`, the 404 page — answers `401` with a `WWW-Authenticate` challenge. Dismissing the
browser's credential prompt renders a small branded "not open yet" page, still under a real 401. Every response carries `X-Robots-Tag: noindex, nofollow`, including the open paths
above, so nothing is indexed during the window.

**It does not hide the ring's content, and cannot.** `/ring.json` is deliberately open, so
the ring's data is publicly readable while the gate is up. That costs nothing: it is already
public data mirrored from `indienodes-ring`. What the gate buys is that the application is
not browsable, not linkable, and not indexable.

## Enabling it

The gate is compiled in at **image build time** and is absent from any image built without
it. There is no runtime switch: `docker run -e` cannot turn it on or off, the same way it
cannot change any `VITE_` value (see [`.env.example`](../.env.example)).

### 1. Choose a credential

Use a **long random passphrase**, not a short PIN. Caddy's standard build ships no rate
limiter, so bcrypt's per-attempt cost is the only brute-force defence there is — sufficient
for a passphrase, not for six digits. Generate one with a password manager; testers paste it
once and their browser remembers it.

### 2. Hash it

Never pass a plaintext password. Hash it with Caddy's own tool:

```bash
docker run --rm caddy:2-alpine caddy hash-password --algorithm bcrypt --plaintext 'your-passphrase-here'
```

That prints a bcrypt hash beginning `$2a$14$`. The plaintext is what you give testers; the
hash is what the build consumes.

### 3. Put the hash in `.env`

`.env` is gitignored and dockerignored. **Do not inline the hash in `docker-compose.yml`**:
Compose does not re-interpolate values it reads from `.env`, so a hash passes through
literally from there, whereas inlined in the YAML every `$` would have to be doubled
(`$$2a$$14$$...`) or Compose would try to expand it.

```bash
# .env  — never committed
GATE_USER=preview
GATE_PASSWORD_HASH=$2a$14$replace-with-the-hash-you-just-generated
```

```bash
docker compose up --build
```

Or without Compose, single-quoting the hash so the shell does not eat the `$` separators:

```bash
docker build \
  --build-arg GATE_USER=preview \
  --build-arg GATE_PASSWORD_HASH='$2a$14$replace-with-the-hash-you-just-generated' \
  -t indienodes:gated .
```

Both arguments must be non-empty. Setting only one builds an **ungated** image.

### Via the published GHCR image (CI)

The steps above are for a local build. The image [`docker-publish.yml`](../.github/workflows/docker-publish.yml)
actually publishes to GHCR follows a deliberately different rule: **an ordinary push never
reads the gate values, no matter what they're set to.** A plain `git push` to `main` and
pushing a version tag (`v*`) both always build and publish ungated.

Set the same two values once, as repo config rather than `.env`, under Settings → Secrets and
variables → Actions: `GATE_USER` as a **Variable**, `GATE_PASSWORD_HASH` (the bcrypt hash from
step 2 above) as a **Secret**. They can be left set indefinitely — sitting there arms nothing
by themselves.

To actually get a gated image out of GHCR: Actions tab → "Build and Push Docker Image" → "Run
workflow" → pick the ref you want gated (a tag, `main`, anything) → check **enable_gate** → Run.
That one run reads `GATE_USER`/`GATE_PASSWORD_HASH` and publishes a gated image for that ref;
every push-triggered build around it keeps publishing ungated regardless. The run's summary
states plainly whether the gate was enabled for that build.

This exists because the previous version of this rule — any push builds gated whenever the
repo values happen to be set — had no way to tell "still deliberately testing" from "forgot to
unset these before the next release," and tags have been going out every 1–3 days. Making a
gated publish always a manual, explicit action removes that ambiguity: the repo values can stay
set for as long as maintenance/widget-testing on production is wanted, without any risk of an
unrelated ordinary release inheriting that state by accident.

## The staging deploy loop

**A `git push` to `preview-gated` does not, by itself, produce anything Semaphore can pull.**
`docker-publish.yml` only builds on a push to `main`, a `v*` tag, a pull request into `main`,
or a manual dispatch — pushing commits to any other branch, `preview-gated` included, updates
GitHub and nothing else. Semaphore's Staging environment pulls the `:preview-gated` image
tag from GHCR, and that tag is only as fresh as the last dispatch that targeted it. The loop,
every time Staging needs to reflect new work:

1. Commit and push to `preview-gated`, as usual.
2. Actions tab → "Build and Push Docker Image" → "Run workflow" → ref `preview-gated` → check
   **enable_gate** → Run. (Or `gh workflow run "Build and Push Docker Image" --ref
preview-gated -f enable_gate=true`.) This is the step a plain push cannot do for you.
3. Confirm the run's job summary says "🔒 Pre-launch gate: ENABLED for this build" — a
   dispatch with the checkbox left unchecked still succeeds, silently publishing ungated.
4. Deploy from Semaphore's Staging environment. It re-pulls whatever `:preview-gated`
   currently points to, which after step 2 is this dispatch's build. The About modal's
   version string (`package.json`, bumped per release — see the changelog) is the fastest way
   to confirm which build actually landed, since Staging has no other visible marker of it.

**Do not merge `preview-gated` into `main` to get a preview build published.** It looks like
the obvious way to move the branch's work somewhere Semaphore can see it, but `main` is the
default branch: a push there always resolves the gate to `false` regardless of repo
config (see above), and its build is also tagged `:latest` — the tag reserved for the real,
ungated go-live. A merge here does not refresh the gated staging image at all; it publishes
an entirely different, ungated one under a different tag.

**Releasing is the exception, and the only one.** Cutting a release _is_ an intent to move
the work to `main`, and 1.5.1 went that way: merged locally rather than through a pull
request, because this repository has "automatically delete head branches" enabled and a PR
merge would take `preview-gated` with it. The two consequences above still apply and are
accepted rather than avoided — the resulting `:latest` is ungated, and a gated staging image
still has to come from its own dispatch afterwards. What the warning rules out is reaching
for a merge when all you wanted was a fresher preview; it does not rule out shipping.

(Until `bc8aa11` this section closed by saying `main` stays untouched until removing the
gate at launch is the intent of the push. The gate is now kept permanently as a staging
tool, so that is no longer the one thing `main` is waiting for.)

## Verifying it before you deploy

A gate that silently fails open is worse than none, and an incomplete open-path list breaks
the widget on every member site. Check both directions against a running container.

**Cover every group in [`gate/gate.caddy`](../gate/gate.caddy)'s `@gated` matcher, not a
subset that happens to include the two most obvious files.** An earlier version of this
loop checked six paths against the matcher's eight groups, silently skipping `/embed.js`
(the unversioned build, as opposed to `/embed.v1.js`) and the entire `/_app/*` prefix —
exactly the kind of incomplete-list gap this section exists to catch. `/_app/*` is
content-hashed per build, so no filename in it is stable to hardcode; `/_app/version.json`
is the one path under it SvelteKit always emits unhashed, which is enough to prove the
prefix is open without needing to know a build's actual chunk names:

```bash
docker run --rm -d --name gatecheck -p 8090:8080 indienodes:gated

# must all be 401
for p in / /join /settings /members /widget /404.html; do
  printf '%s %s\n' "$(curl -so /dev/null -w '%{http_code}' localhost:8090$p)" "$p"
done

# must all be 200 -- one representative path per @gated matcher group
for p in /embed-frame /go/random /embed.js /embed.v1.js /ring.json \
         /badges/classic.svg /_app/version.json /images/IndieNodes_Logo.webp; do
  printf '%s %s\n' "$(curl -so /dev/null -w '%{http_code}' localhost:8090$p)" "$p"
done

# the challenge and the noindex header
curl -sI localhost:8090/ | grep -iE 'www-authenticate|x-robots-tag'

docker rm -f gatecheck
```

**Then open `/embed-frame` in a browser and confirm no `401` appears in the network panel
for any subresource.** That is the check that catches a missing entry in the open-path list
with certainty — the curl loop above checks one representative path per group, so a gap
_inside_ a group (a second hashed chunk `/_app/*` happens to miss, say) would still pass it.
Nothing but the real browser load proves every subresource a page actually requests.

The container's health probe targets `/ring.json` precisely because it is open in both
modes — `docker inspect --format '{{.State.Health.Status}}'` should reach `healthy` either
way. Never add credentials to the healthcheck.

**If a header/CORS/CSP fix checks out against `curl -sI` on the real production URL but a
real browser still reproduces the original symptom after a hard refresh, a cache-cleared
reload, and incognito** — all of which rule out the browser's own cache — suspect
Cloudflare's edge cache next, not the Caddyfile again. `/_app/immutable/*` (and anything
else served `Cache-Control: ... immutable`) gets cached at the CDN layer for up to a year
and won't revalidate with origin in that window; a POP that cached the broken response
before the fix shipped keeps serving it regardless of what origin now returns.
`cf-cache-status: MISS` on your own `curl` only proves the one POP that request happened to
land on, not the one an actual visitor resolves to. The fix is a Cloudflare cache purge
(dashboard → Caching → Configuration → Purge Everything), not another look at the origin
config. Full incident writeup: `decisions.md`, "Found live: `/_app/immutable/*` never
carried the CORS header the sandboxed iframe needs, and Cloudflare's own cache outlived the
fix".

## Operating it

- **Failed attempts are logged.** Caddy writes JSON access logs to stderr, so `docker logs`
  shows each `401` with its path and IP. The attempted credential is **not** logged —
  `Authorization` is redacted (`"Authorization":["REDACTED"]`), and `log_credentials` must
  stay off, since that header is only base64 of `user:password`.
- **Client IPs will read as the fronting proxy's address** unless a `trusted_proxies` global
  option is configured. Accepted for a temporary gate rather than adding permanent config.
- **Distribute the passphrase out of band** — a password manager share, not the repo, not an
  issue, not a commit message.

## Security properties, stated plainly

- **The mechanism is public; the credential is not.** [`Caddyfile`](../Caddyfile) and
  [`gate/gate.caddy`](../gate/gate.caddy) are both in this repository, so anyone can read
  exactly how the gate works. That is not a weakness — enforcement is server-side, so
  knowing the design does not help past it. What never appears in the repo, in the client
  bundle, or in any served asset is the credential.
- **Basic auth credentials are base64, not encrypted.** This is only safe because TLS
  terminates in front of the container. **Never expose the container's `:8080` directly.**
- **The hash is visible in image metadata.** `docker history` on a gated image shows the
  `GATE_PASSWORD_HASH` build arg. A bcrypt hash is an acceptable thing to leak there for a
  temporary gate; a plaintext password would not be, which is the other reason this takes a
  hash. Use a BuildKit secret if even the hash must stay out of that metadata.
- **An ungated image contains no gate.** `/etc/caddy/conf.d/` is never created, the
  maintenance page is never copied, and no served asset mentions the feature — the only
  trace is one inert `import` line in a root-owned config file the non-root runtime user
  cannot write.

## Turning it off

Rebuild with the two arguments unset (or empty):

```bash
docker build -t indienodes .
```

## If this ever does need to be removed

Not planned as of 1.5.0 — the feature is being kept for future staging/dev use (see above).
If a later decision does retire it for good: delete [`gate/`](../gate/), the
`import /etc/caddy/conf.d/*.caddy` line in [`Caddyfile`](../Caddyfile), the two `ARG`s and
the install `RUN` in [`Dockerfile`](../Dockerfile), the two entries in `docker-compose.yml`,
and this file. Leave the healthcheck pointed at `/ring.json`; it is correct either way and
does not depend on the gate.
