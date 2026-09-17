import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

function skinLab() {
	return {
		name: 'indienodes-skin-lab',
		apply: 'serve',
		/** @param {import('vite').ViteDevServer} server */
		configureServer(server) {
			server.middlewares.use('/dev/skins', async (request, response, next) => {
				if (request.url !== '/' && request.url !== '') return next();
				const source = `<!doctype html>
<html lang="en">
	<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
	<body><div id="skin-lab-app"></div><script type="module" src="/src/dev/skin-lab.js"></script></body>
</html>`;
				try {
					const html = await server.transformIndexHtml('/dev/skins', source);
					response.statusCode = 200;
					response.setHeader('Content-Type', 'text/html');
					response.end(html);
				} catch (error) {
					next(error);
				}
			});
		}
	};
}

export default defineConfig({
	server: {
		// Vite's dev server only answers requests whose Host header it
		// recognises (blocks DNS-rebinding against `npm run dev`). Left empty
		// by default; a comma-separated VITE_DEV_ALLOWED_HOSTS appends
		// whatever this run needs -- a demo tunnel's hostname, say -- without
		// committing a personal or temporary domain to this file. Same
		// reasoning as N8N_EXTRA_ORIGINS in scripts/n8n/build_workflows.py.
		allowedHosts: (process.env.VITE_DEV_ALLOWED_HOSTS ?? '')
			.split(',')
			.map((h) => h.trim())
			.filter(Boolean)
	},
	// `jszip` is only ever dynamic-imported (zipExport.js, so it never lands
	// in any route's bundle but /join's own) — which is also exactly the
	// shape that trips up Vite dev's dependency optimizer: a dependency
	// discovered mid-session, the first time some route actually reaches the
	// `import()`, forces Vite to re-optimize and hand out a new `?v=` hash,
	// which orphans any tab that already loaded the *previous* hash. That
	// shows up as "Outdated Optimize Dep" / "Failed to fetch dynamically
	// imported module" on a real user action (clicking Download), not on a
	// page load, so Vite's own HMR-driven auto-reload doesn't reliably catch
	// it. Listing it here makes it part of the *eager* pre-bundle at dev
	// server startup instead of something discovered lazily later — the
	// hash is stable for the server's whole lifetime, so there is no
	// mid-session rediscovery left to race against.
	optimizeDeps: { include: ['jszip'] },
	plugins: [
		skinLab(),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// `fallback` only supplies what an unmatched path gets; every real
			// route still prerenders its own .html because `prerender = true`
			// is set globally in src/routes/+layout.js. Without it there is no
			// 404.html at all for a static host to serve. The client resolves an
			// unmatched path to src/routes/(app)/[...missing], which renders
			// (app)/+error.svelte inside the app layout.
			adapter: adapter({ fallback: '404.html' })
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.js',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.js',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
