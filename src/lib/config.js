// Single source for external links, so they are not scattered through
// components.

export const GITHUB_URL = 'https://github.com/XTREEMMAK/indienodes-app';
export const GITHUB_ISSUES_URL = `${GITHUB_URL}/issues`;

/**
 * Suggested hosts for a no-site audio creator who chooses to host their track
 * separately (`JoinMediaStep.svelte`'s `audioHosting === 'external'` branch).
 * Plain constants, not `VITE_*` env vars, matching `GITHUB_URL` above rather
 * than `KOFI_URL` below: these are the same signup pages for every
 * deployment of this codebase, not something a particular instance would
 * point somewhere else.
 */
export const NEOCITIES_URL = 'https://neocities.org';
export const FILE_GARDEN_URL = 'https://filegarden.com';
export const NEKOWEB_URL = 'https://nekoweb.org';

/**
 * Ko-fi donation link, shown as the About modal's "Support" tab.
 *
 * Was a hardcoded `ko-fi.com/TODO` placeholder; now build-time config for the
 * same reason `SUBMISSION_WEBHOOK_URL` below is — a personal donation link is
 * deployment-specific in a way `GITHUB_URL` above is not (this codebase has
 * one real upstream repo; it does not have one universal Ko-fi page), so it
 * belongs to infra to supply, not to this file to guess at.
 *
 * Empty is a supported state, not a placeholder to fill in later: the About
 * modal drops the Support tab entirely when this is unset, the same "unset
 * means off, not broken" posture `TURNSTILE_SITE_KEY` below already has,
 * rather than showing a tab whose one link goes nowhere real.
 */
export const KOFI_URL = import.meta.env.VITE_KOFI_URL || '';

/**
 * The repository holding this ring's own `members/*.json`.
 *
 * Deliberately not `GITHUB_URL` above. That one is the codebase's upstream —
 * source, issues, changelog — and is the same for every deployment, which is
 * why it is a constant. This is the repository a *particular* ring curates its
 * members in, and a fork's is not this one.
 *
 * It exists for the deployment that runs no submission backend. `/join`'s form
 * needs n8n; curating by pull request against `members/*.json` does not, and
 * `build-ring.yml` and `validate-ring.yml` already handle that path. Without a
 * repository to point at, the join page can only say submissions are not open
 * here; with one, it can say how to get in anyway.
 *
 * Unset means the pointer is simply absent, the same "unset means off, not
 * broken" posture as `KOFI_URL` — a wrong repository link would be worse than
 * none, since it would send a would-be member to somebody else's ring.
 */
export const RING_REPO_URL = import.meta.env.VITE_RING_REPO_URL || '';

/**
 * The deployed origin.
 *
 * Overridable with `VITE_SITE_ORIGIN`, matching how `VITE_RING_URL` already
 * works in `ringStore`, so there is one convention for "point this build
 * somewhere else" rather than two.
 *
 * **This is baked in at build time, not read at run time**, and that is not
 * an implementation detail to work around: `adapter-static` emits plain HTML
 * and JS with no server process, so there is nothing running that could read
 * an environment variable when a visitor arrives. In Docker terms that means
 * it belongs to `docker build` (an `ARG`/`ENV` before `npm run build`) and
 * setting it on `docker run` does nothing at all. See `.env.example`.
 *
 * The widget needs it most: it is embedded on third-party sites, so it cannot
 * fetch ring.json with a relative path (that would resolve against the host
 * page's origin, not this one).
 */
export const SITE_ORIGIN = import.meta.env.VITE_SITE_ORIGIN || 'https://app.indienodes.us';
export const RING_JSON_URL = `${SITE_ORIGIN}/ring.json`;

/**
 * The canonical ring endpoint this deployment reads from first, if one is
 * configured — `RING_JSON_URL` (this origin's own mirror) otherwise.
 *
 * The widget uses this as its primary URL and `RING_JSON_URL` as its
 * fallback (see `Widget.svelte`), the same "canonical endpoint first,
 * same-origin mirror as automatic fallback" shape `ringStore` already uses
 * for the main app. Falling back to `RING_JSON_URL` when unset, rather than
 * leaving this empty, means an unconfigured deployment's widget behaves
 * exactly as it always has: one fetch, this origin, no second attempt --
 * `loadRing` does not retry when the fallback URL is identical to the one
 * that just failed.
 */
export const RING_ENDPOINT_URL = import.meta.env.VITE_RING_URL || RING_JSON_URL;

/**
 * Where the submission form posts.
 *
 * **Named for the shape, not the vendor.** It is an n8n workflow today (see
 * `docs/decisions.md`), and the site's entire half of that contract is "POST
 * JSON to a URL, read JSON back." Encoding "n8n" into the variable name would
 * make replacing it a rename across the code, `.env.example`, the Dockerfile,
 * and the publish workflow, in exchange for nothing at the call site.
 *
 * Build-time, for the same reason as `SITE_ORIGIN` above, with the same Docker
 * consequence: `--build-arg`, not `docker run -e`.
 *
 * **Unset is a supported state and means two different things.** In dev it
 * selects the mock backend, so the form is workable without running n8n. In a
 * production build it means submissions are closed, and the form says so
 * rather than pretending to accept anything. `submissionApi.js` owns that
 * distinction; the difference matters enough that it is not left to a falsy
 * check at the call site.
 *
 * The URL is public: it ships inside the client bundle, because a static site
 * has no server to proxy through. It is not a credential and must not be
 * treated as one. Every abuse control lives on the receiving end.
 */
export const SUBMISSION_WEBHOOK_URL = import.meta.env.VITE_SUBMISSION_WEBHOOK_URL || '';

/**
 * Where `/contact` posts. A **separate** variable from
 * `SUBMISSION_WEBHOOK_URL` rather than one more `action` on that same
 * webhook, on purpose: Contact and the review pipeline are independent
 * concerns that should be pausable independently (a maintainer closing
 * intake for a while has no reason to also go silent on Contact), and a
 * stateless fire-and-forget message has no business sharing a URL with
 * `issue_token`/`verify`'s stateful multi-step contract.
 *
 * Same posture as `SUBMISSION_WEBHOOK_URL` in every other respect: public,
 * build-time only, unset means dev mocks and prod says the form is closed.
 */
export const CONTACT_WEBHOOK_URL = import.meta.env.VITE_CONTACT_WEBHOOK_URL || '';

/**
 * Where the one-time app rating posts. A THIRD webhook, separate from both
 * above, for the reason Contact is separate from submissions: these are
 * unrelated concerns with unrelated failure modes, and a maintainer who wants
 * to stop collecting ratings should not have to touch intake or Contact to do
 * it.
 *
 * It also carries the least of the three and should be the easiest to switch
 * off: a single integer and a timestamp, with no identifier, no reply address,
 * and nothing to follow up on. See `ratingApi.js`.
 *
 * Same posture as the other two: public, build-time only, and unset means dev
 * mocks while a production build simply never asks for a rating at all — which
 * is a quieter failure than the forms have, and the right one, since nobody is
 * waiting on an answer.
 */
export const RATING_WEBHOOK_URL = import.meta.env.VITE_RATING_WEBHOOK_URL || '';

/**
 * Cloudflare Turnstile site key, read by `Turnstile.svelte` and rendered on
 * `/update` and `/contact` — the two forms this was added ahead of.
 *
 * Only the site key lives here, and only the site key ever will: it is
 * public by design (Turnstile's own widget ships it to the browser to
 * render the challenge). The matching secret key is what actually calls
 * Cloudflare's siteverify API to check a token, which is a server-side
 * call this static site has nowhere to make — same reasoning as
 * `SUBMISSION_WEBHOOK_URL` above. That verification belongs in the
 * external n8n workflow(s) this app hands submissions to, not in this
 * codebase.
 *
 * Empty is a supported state: `Turnstile.svelte` renders nothing when this
 * is empty rather than rendering a widget pointed at nothing, the same
 * "unset means off, not broken" posture `SUBMISSION_WEBHOOK_URL` already
 * has.
 */
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
