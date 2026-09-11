import { defineConfig } from '@playwright/test';

export default defineConfig({
	snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{platform}{ext}',
	projects: [
		{
			name: 'production',
			use: { baseURL: 'http://localhost:4173' }
		},
		{
			name: 'skin-lab-dev',
			use: { baseURL: 'http://localhost:4176' },
			testMatch: '**/skin-lab.e2e.js'
		},
		{
			// The `?mock=` failure-mode walkthroughs (submissionApi.mock.js) only
			// exist in a dev build — useMock is `import.meta.env.DEV && !hasBackend`,
			// so the `production` project's built-and-preview server has the mock
			// tree-shaken out entirely, by design. It needs its own dev server
			// rather than reusing skin-lab-dev's 4176 one: that server inherits
			// whatever VITE_SUBMISSION_WEBHOOK_URL a developer's own .env sets for
			// manual testing against the live backend, which makes hasBackend true
			// and silences the mock the same way a production build does — just
			// less obviously, since the page looks identical until Verify is
			// clicked and the request goes to the real webhook (and fails CORS from
			// an unlisted dev port) instead of the mock. This server's own webhook
			// vars are forced empty so mock mode is guaranteed regardless of what
			// any individual developer's .env happens to contain.
			name: 'join-mock-dev',
			use: { baseURL: 'http://localhost:4177' },
			testMatch: [
				'**/join-verify.e2e.js',
				'**/join-success.e2e.js',
				'**/update-verify.e2e.js',
				'**/join-consent-gate.e2e.js'
			]
		}
	],
	webServer: [
		{
			// The seed step swaps in testing/ring.e2e.json after the build. The
			// suite needs one entry of every type; the published ring is not
			// obliged to contain any, and used to only because four placeholder
			// members were carried in members/ for the tests' benefit. Seeding
			// after the build rather than setting VITE_RING_URL keeps the artifact
			// under test byte-identical to the one that ships — only its data
			// differs. See testing/scripts/seed-e2e-ring.mjs.
			//
			// reuseExistingServer means a preview already running on 4173 is used
			// as-is and this command never runs, so a server started by hand is
			// serving the published ring, not the fixture. Run `npm run test:e2e`
			// (or stop that server) rather than wondering why entries are missing.
			//
			// VITE_SITE_ORIGIN=http://localhost:4173 makes this build a genuinely
			// standalone deployment rather than one that happens to serve from
			// this port while still identifying itself as https://app.indienodes.us
			// (`SITE_ORIGIN`'s own default). Without it, anything that builds an
			// absolute URL from `SITE_ORIGIN` -- the widget's own `RING_JSON_URL`
			// fallback, most notably -- reaches across the real internet for
			// production's ring.json instead of this run's seeded fixture,
			// which is a real request that can fail (CORS, no network in a
			// sandboxed runner) or silently succeed against the wrong data. This
			// surfaced by writing testing/embed-frame.e2e.js, which is the first
			// test to exercise the widget's real ring fetch rather than its
			// static preview stand-in.
			//
			// VITE_SUBMISSION_WEBHOOK_URL/VITE_CONTACT_WEBHOOK_URL point at the
			// real production host on a path that doesn't exist, deliberately:
			// this makes `hasBackend` true (see submissionApi.js), so this
			// project's join/update/contact flows attempt the real fetch()
			// call instead of either rendering the "not configured" closed
			// state (empty webhook, the previous default here) or silently
			// routing through the dev-only mock (useMock also requires
			// `import.meta.env.DEV`, which a built-and-previewed project never
			// has). The path doesn't need to resolve to anything -- n8n
			// answers an unregistered webhook path with its own 404 and no
			// workflow ever runs, so this can't create real submission rows or
			// send real notifications. What it's actually for is
			// testing/csp.e2e.js's own connect-src coverage: a blocked fetch
			// throws before any network activity happens, so CSP's
			// `securitypolicyviolation` event fires (or doesn't) regardless of
			// whether the far end is reachable from wherever this suite runs.
			// This is exactly the path that went unexercised when the CSP
			// first shipped, missing that connect-src had never been given
			// this host at all -- caught live on /update, not by this suite,
			// until now.
			command:
				'VITE_SITE_ORIGIN=http://localhost:4173 VITE_SUBMISSION_WEBHOOK_URL=https://n8n.kjnet.us/webhook/e2e-csp-probe VITE_CONTACT_WEBHOOK_URL=https://n8n.kjnet.us/webhook/e2e-csp-probe npm run build && node testing/scripts/seed-e2e-ring.mjs && npm run preview',
			port: 4173,
			reuseExistingServer: true
		},
		{
			command: 'npm run dev -- --host 127.0.0.1 --port 4176',
			port: 4176,
			reuseExistingServer: true
		},
		{
			// Empty webhook vars force useMock on regardless of what .env sets for
			// this machine — see the `join-mock-dev` project's own comment above.
			command:
				'VITE_SUBMISSION_WEBHOOK_URL= VITE_CONTACT_WEBHOOK_URL= npm run dev -- --host 127.0.0.1 --port 4177',
			port: 4177,
			reuseExistingServer: true
		},
		{
			command: 'npm run generator:preview -- --long',
			port: 4175,
			reuseExistingServer: true
		}
	],
	testMatch: '**/*.e2e.{ts,js}'
});
