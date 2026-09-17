#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../build', import.meta.url));
const builtRing = join(root, 'ring.json');
const sourceRing = fileURLToPath(new URL('../ring.json', import.meta.url));
const textExtensions = new Set(['.css', '.html', '.js', '.json']);
const forbiddenContent = ['/dev/skins', 'Skin Laboratory', 'Developer surface'];
const failures = [];

function visit(directory) {
	for (const item of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, item.name);
		const outputPath = relative(root, path);
		if (outputPath === 'dev' || outputPath.startsWith(`dev/`)) failures.push(outputPath);
		if (item.isDirectory()) {
			visit(path);
		} else if (textExtensions.has(extname(item.name))) {
			const content = readFileSync(path, 'utf8');
			if (forbiddenContent.some((value) => content.includes(value))) failures.push(outputPath);
		}
	}
}

visit(root);

// The built ring must be the repo's ring, byte for byte.
//
// `testing/scripts/seed-e2e-ring.mjs` deliberately overwrites build/ring.json
// with the five-entry e2e fixture rather than setting VITE_RING_URL, so that
// the artifact under test stays byte-identical to production in every other
// respect. The cost is that `build/` is left holding test data afterwards, and
// nothing downstream could tell: `npm run preview` serves it, and
// `desktop:assets` and the Capacitor sync copy it into a shipped client. Both
// of those run `npm run build` first, which lands here and overwrites the
// seed — so this check is what makes that ordering load-bearing instead of
// merely usual.
//
// Bytes, not parsed content: static/ring.json is a symlink to the file this
// compares against, so anything other than an exact match means something
// rewrote it, and which entries differ is not the interesting part.
try {
	if (readFileSync(builtRing, 'utf8') !== readFileSync(sourceRing, 'utf8')) {
		console.error(
			'Built ring.json does not match the repository ring.json. The build directory is ' +
				'holding data from somewhere else — most likely the e2e fixture left by ' +
				'testing/scripts/seed-e2e-ring.mjs. Re-run `npm run build`.'
		);
		process.exit(1);
	}
} catch (error) {
	console.error(`Could not compare built ring.json against the repository copy: ${error.message}`);
	process.exit(1);
}

if (failures.length) {
	console.error(
		`Development skin laboratory leaked into production: ${[...new Set(failures)].join(', ')}`
	);
	process.exit(1);
}

// What each page preloads. Two regressions here are silent: nothing breaks,
// pages just get heavier, and one of them lands on every member site.
//
// - /embed-frame lives outside the `(app)` layout group so a member's iframe
//   never downloads the app's chrome or stylesheet. Moving it back under that
//   layout, or importing app code into the root layout, took it from about
//   110 kB to about 490 kB.
// - The text editor (Tiptap/ProseMirror, over 500 kB) and Ambient View are
//   loaded on first use. A static import anywhere pulls them into first load.
/** @param {string} page */
function preloads(page) {
	const html = readFileSync(join(root, page), 'utf8');
	return [...new Set(html.match(/_app\/immutable\/[^"]+\.(?:js|css)/g) ?? [])];
}

/** @param {string} asset */
function assetText(asset) {
	return readFileSync(join(root, asset), 'utf8');
}

const EMBED_FRAME_BUDGET = 150 * 1024;
const embedAssets = preloads('embed-frame.html');
const embedBytes = embedAssets.reduce((sum, asset) => sum + statSync(join(root, asset)).size, 0);
const bundleFailures = [];
if (embedBytes > EMBED_FRAME_BUDGET) {
	bundleFailures.push(
		`embed-frame.html preloads ${embedBytes} bytes (budget ${EMBED_FRAME_BUDGET}); is it back under the app layout?`
	);
}
if (
	embedAssets.some((asset) => asset.endsWith('.css') && statSync(join(root, asset)).size > 8192)
) {
	bundleFailures.push(
		'embed-frame.html preloads a large stylesheet; the app CSS should not reach it'
	);
}

for (const page of readdirSync(root).filter((name) => name.endsWith('.html'))) {
	for (const asset of preloads(page)) {
		if (!asset.endsWith('.js')) continue;
		const text = assetText(asset);
		if (/prosemirror/i.test(text)) {
			bundleFailures.push(
				`${page} preloads the text editor (${asset}); it should load on first use`
			);
		}
		// AmbientOptionsSheet's exit label; only Ambient View renders that sheet.
		if (text.includes('Exit ambient view')) {
			bundleFailures.push(`${page} preloads Ambient View (${asset}); it should load on first use`);
		}
	}
}

if (bundleFailures.length) {
	console.error(`Bundle checks failed:\n  ${bundleFailures.join('\n  ')}`);
	process.exit(1);
}

console.log(
	'Production output excludes the development skin laboratory and carries the real ring.'
);
console.log(`Bundle checks passed (embed-frame preloads ${embedBytes} bytes).`);
