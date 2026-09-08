<p align="center">
  <img src="static/images/IndieNodes_Logo.webp" alt="IndieNodes logo" width="220" />
</p>

<h1 align="center">IndieNodes</h1>

<p align="center">
  A creator-first webring for discovering independent audio, art, comics, writing, and games.
</p>

<p align="center">
  <a href="https://indienodes.us">Visit IndieNodes</a> ·
  <a href="#run-it-locally">Run locally</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="#embed-the-ring">Embed the ring</a>
</p>

## Overview

IndieNodes helps people stumble into work made by real independent creators. It is a
webring, not a publishing platform: each member keeps their work on infrastructure they
control, while IndieNodes supplies several ways to move through the ring.

There are no visitor accounts, no recommendation algorithm, and no paid placement.
Browsing preferences, likes, dismissals, and the discovery journal remain in the
visitor's browser and can be exported or cleared at any time. Submission data is handled
separately in a private review workflow and only approved public fields enter the ring.

A **Node** represents a creator, collective, or studio through a small sample of their
work. A track, page, excerpt, artwork, or game supports that creator's Node; it does not
replace them as the subject of the ring.

## What it includes

- **Five kinds of creative work:** audio, visual art, comics, writing, and games.
- **An ambient discovery field:** independently rotating, rearrangeable Nodes that can be
  tuned by medium and tags without choosing the next creator.
- **Media-native previews:** audio playback and queues, art and comic readers, game
  trailers, and browser-native text-to-speech where source data supports them.
- **A searchable member directory:** a deliberate companion to the low-choice discovery
  field, with direct links to creators' own sites.
- **Local-only personalization:** Like, Not for Me, content preferences, a discovery
  journal, rotation pacing, themes, skins, and data import/export.
- **A site builder for creators:** people without a site can build and download one in
  the browser from hand-designed templates for their medium.
- **Three ring links:** a Previous/Next/Random widget, an 88×31 badge, or a plain text
  link, all suitable for a member's own site.
- **One shared frontend:** the canonical static web app can also be packaged in thin
  Capacitor/Android and Wails desktop hosts.

## How it works

The canonical ring — one JSON file per creator, the schemas that define a valid entry and
a valid ring document, and the tooling that builds and validates it — lives in
[`indienodes-ring`](https://github.com/XTREEMMAK/indienodes-ring), not here. **This app is
a client of that ring, not its owner.** It reads from
[ring.indienodes.us](https://ring.indienodes.us), published independently of this app's
own release cycle: a creator joining does not require rebuilding or redeploying this app.

```text
indienodes-ring
  members/*.json ──> ring.json ──> ring.indienodes.us
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
              this app              member widget          other clients
        (+ same-origin
         fallback mirror)
```

This repo's own committed [`ring.json`](./ring.json) is a mirror, not a source: refreshed
automatically whenever `indienodes-ring` publishes a change (`npm run ring:sync`), it
exists so a production build never depends on the canonical endpoint being reachable at
build time, and so an already-pasted widget embed (either tier) has something to fall back
to if `ring.indienodes.us` is ever briefly unreachable.

This boundary is intentional: **the data is the API**, owned by neither this app nor any
other client. The web experience, widget, and future clients can change independently
without turning the ring into a hosted social network or making one interface the only
way to participate.

Media is not rehosted. A Node links to the creator's source page and may include a small
number of creator-hosted preview URLs. See `indienodes-ring`'s own
[curation policy](https://github.com/XTREEMMAK/indienodes-ring/blob/main/docs/curation-policy.md)
for how human reviewers decide what qualifies.

## Run it locally

You need Node.js 22 or newer and npm.

```bash
npm install
npm run dev -- --open
```

The default development build reads this repo's own committed `ring.json` mirror. For a
larger 50-entry development fixture covering every medium, generate it once and then run
the two servers in separate terminals:

```bash
npm run fixture:generate   # writes testing/fixtures/, which is not committed
npm run fixture:serve      # serves the fixture and its assets on :4174
npm run dev:fixture        # dev server, reading the fixture instead of ring.json
```

The fixture embeds real third-party content, so it is deliberately kept out of the
repository and rebuilt locally. See [`testing/README.md`](./testing/README.md) for its
contents, the hand-authored creator pages, local media, and testing from another device.

### Common commands

| Command                 | Purpose                                                |
| ----------------------- | ------------------------------------------------------ |
| `npm run build`         | Build the static production site and verify its output |
| `npm run preview`       | Preview the most recent production build               |
| `npm run check`         | Run Svelte and JavaScript type checks                  |
| `npm run lint`          | Check formatting and ESLint rules                      |
| `npm run test`          | Run unit and Playwright end-to-end tests               |
| `npm run ring:sync`     | Refresh the `ring.json` mirror from `indienodes-ring`  |
| `npm run ring:validate` | Check the committed mirror is well-formed (no network) |
| `npm run build:widget`  | Rebuild the standalone custom-element widget           |

Template authors can start with the
[generator template guide](./docs/generator-template-authoring.md). Android and desktop
prerequisites and commands live in the [platform build guide](./docs/platform-builds.md).

## Build and deploy

IndieNodes uses SvelteKit with `adapter-static`. `npm run build` prerenders the application
to `build/` as plain HTML, CSS, and JavaScript, so it can be served by any static host and
does not need an application server.

The included [`Dockerfile`](./Dockerfile) builds that same static output and serves it
with [`Caddy`](./Caddyfile):

```bash
docker build -t indienodes .
docker run -p 8080:8080 indienodes
```

All `VITE_` configuration is compiled into the client at **build time**. Copy
[`.env.example`](./.env.example) to `.env` for local overrides, or pass the matching
`--build-arg` values to Docker. Unset submission and contact webhooks fail closed in a
production build; unset `VITE_RING_URL` means the app reads its own committed mirror
instead of the canonical endpoint. The complete configuration contract is documented in
[`.env.example`](./.env.example).

A deployment that needs to be live before it is meant to be public — to test the embeddable
widget against real host pages, or any other staging round — can be built behind a
credential gate. It is compiled in at image build time and absent from any image built
without it; see [`docs/pre-launch-gate.md`](./docs/pre-launch-gate.md).

Images are published to GHCR on pushes to `main` and on version tags, gated on
[`ci.yml`](./.github/workflows/ci.yml) — which includes a structural check on the
committed ring mirror, run with no network access. Freshness (whether that mirror still
matches `indienodes-ring`'s canonical source) is a separate concern, handled by
[`sync-ring.yml`](./.github/workflows/sync-ring.yml) on `repository_dispatch`.

## Forking this

Forking this repo alone gets you a client with no ring of its own: the field and ambient
views, the widget, the member directory, local personalization, and the site generator all
work from a plain `npm run build`, but `VITE_RING_URL` defaults to this repo's own
committed mirror, which is `indienodes-ring`'s data, not yours to curate.

**Running your own ring means also standing up your own ring repository** — a fork of
[`indienodes-ring`](https://github.com/XTREEMMAK/indienodes-ring), or a new one built the
same way: `members/*.json`, the two schemas, and the build/validate scripts it documents.
Members can be curated there by pull request with no backend at all — that repo's own
`build-ring.yml` and `validate-ring.yml` handle the regenerate-and-validate cycle. Publish
it somewhere with CORS enabled (GitHub Pages with a custom domain is what this project
uses), then point this app at it:

```bash
VITE_RING_URL=https://your-ring-domain/ring.json
```

That is the one setting that matters. It flows to both the main app and the widget, each
with your own origin's `/ring.json` as an automatic fallback if your endpoint is ever
briefly unreachable.

What needs a backend is accepting submissions _through a form_ rather than by hand-written
pull request. `/join`, `/update` and `/contact` post to n8n workflows, which are generated
by [`scripts/n8n/build_workflows.py`](./scripts/n8n/build_workflows.py), documented in the
[n8n runbook](./docs/n8n-workflow-runbook.md), and backed up in
[`scripts/n8n/backups/`](./scripts/n8n/backups). Standing that up is real work, and
without it those three routes report that submissions are not open. Set
`VITE_RING_REPO_URL` to your ring repository and `/join` will point would-be members at
that path instead of simply saying it is closed.

**Replacing n8n** is a contained job rather than a rewrite. Every call goes through the
seven functions in [`src/lib/submissionApi.js`](./src/lib/submissionApi.js) —
`issueToken`, `bindSourceUrl`, `verify`, `submit`, `requestUpdateToken`, `submitUpdate`,
`requestRemoval` — and that module already ships a mock implementation of all seven for
development, which is the reference for what a replacement has to answer.

## Embed the ring

The recommended embed is a sandboxed iframe: no access to your page's cookies, storage,
or DOM, regardless of what runs inside it. Add it to any page with:

```html
<iframe
	src="https://indienodes.us/embed-frame?site-id=your-ring-entry-id"
	title="IndieNodes webring"
	width="260"
	height="150"
	style="border:0;"
	sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
	loading="lazy"
></iframe>
```

It provides Previous, Next, and Random navigation over the live ring with no tracking or
personalization. An advanced option runs the same widget as a standalone custom element
with an isolated shadow root instead — simpler DOM, but the script itself runs with your
page's own JavaScript privileges, unlike the sandboxed iframe above:

```html
<script type="module" src="https://indienodes.us/embed.v1.js"></script>
<indienode-widget site-id="your-ring-entry-id"></indienode-widget>
```

The running app's `/widget` page previews both versions alongside the 88×31 badge and
plain-link alternatives. See `docs/decisions.md`'s widget-iframe-isolation entry for why
the iframe is the default.

**Matching your site's look.** The widget exposes exactly two CSS custom properties —
`--indienode-accent` and `--indienode-font-family` — everything else (background, text,
borders) stays fixed so the widget keeps its own tuned contrast in both light and dark
mode. For the script tier, set them in your own stylesheet:

```css
indienode-widget {
	--indienode-accent: #2563eb;
	--indienode-font-family: 'Fira Code', monospace;
}
```

For the iframe tier, append `accent`/`font` to the `src` URL instead, since a cross-origin
iframe doesn't inherit CSS custom properties from the page embedding it:

```html
<iframe
	src="https://indienodes.us/embed-frame?site-id=your-ring-entry-id&accent=%232563eb"
></iframe>
```

See `docs/decisions.md`'s widget-theming entry for why only these two properties are
exposed, and why that's safe against a hostile value rather than merely inconvenient for
one.

## Documentation

Start with the [documentation index](./docs/README.md), which groups the repository's
guides by task:

- project decisions, open questions, and roadmap;
- submissions and review operations (member data itself lives in `indienodes-ring`);
- site-generator and skin authoring;
- web, Android, desktop, audio, and deployment internals;
- maintenance runbooks and dated engineering audits.

Release-by-release history is in [`CHANGELOG.md`](./CHANGELOG.md).

## Contributing

Issues and pull requests are welcome. Before opening a code change, run the checks that
match its scope; for most application changes that means:

```bash
npm run check
npm run lint
npm run test
```

Member data changes do not belong in this repo at all — open those against
[`indienodes-ring`](https://github.com/XTREEMMAK/indienodes-ring) instead, or use `/join`.

## Project status

IndieNodes is under active development and the ring is open but small. The
static app, the five-medium data model and its validation, the member widget, local
personalization, the creator site builder, the submission and update flows, Docker
publishing, and the optional native hosts are implemented, and the complete member
lifecycle — join, update, and voluntary removal — has been verified against production.

Remaining public-release work is narrow: validating the widget contract on real host
pages, an explicit responsive pass, and publishing visitor Terms of Use and a Privacy
Notice. That order and everything deferred past it are tracked in the
[roadmap](./docs/roadmap.md) and [open questions](./docs/open-questions.md).

## License and support

IndieNodes is licensed under GPL-3.0-or-later. See [`LICENSE`](./LICENSE).

The project is designed to run without ads or paid placement. A deployment can expose a
Ko-fi link through `VITE_KOFI_URL`; when it is unset, the Support tab is omitted.
