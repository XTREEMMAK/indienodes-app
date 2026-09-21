// Renders the PWA icon set and the social-preview image from the master
// logo (static/images/IndieNodes_Logo.png, 1920x1920 with alpha) into
// static/icons/. Re-run this after the master logo changes; nothing else
// in the build pipeline regenerates these automatically.
//
// Every icon/favicon surface (icon-192/512, the maskable icon, and the Apple
// touch icon) is sourced from ICON_SOURCE (static/images/IndieNodes_Logo_Icon.png)
// instead: a separate master asset that is already a self-contained circular
// badge, rather than the plain logo composited onto a backing color. The
// plain logo (SOURCE) stays the source for everything else -- the OG/social
// image, the widget's inline mark, and the embeddable badges -- app and
// documentation surfaces rather than app/OS iconography.
//
// The 32px favicon and the primary SVG favicon (which itself embeds a small
// raster, typically shown at tab size) instead read from SMALL_ICON_SOURCE
// (static/images/IndieNodes_Logo_Icon_16-32.webp): a third master with
// bolder strokes than ICON_SOURCE, because ICON_SOURCE's thin strokes and
// transparent corners alias badly once scaled down that far.
//
// The 16px favicon goes even smaller, to a fourth master, SIXTEEN_ICON_SOURCE
// (static/images/IndieNodes_Logo_Icon_16.webp): SMALL_ICON_SOURCE's own detail
// still doesn't hold up at exactly 16px, so this one drops detail further
// (bigger, fewer glyphs) specifically for that one size.
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

const SOURCE = 'static/images/IndieNodes_Logo.png';
const ICON_SOURCE = 'static/images/IndieNodes_Logo_Icon.png';
const SMALL_ICON_SOURCE = 'static/images/IndieNodes_Logo_Icon_16-32.webp';
const SIXTEEN_ICON_SOURCE = 'static/images/IndieNodes_Logo_Icon_16.webp';
const FAVICON_SVG_OUT = 'src/lib/assets/favicon.svg';
const OUT_DIR = 'static/icons';
const BADGE_OUT_DIR = 'static/badges';
const BADGE_LOGO_SIZE = 64;

/**
 * The widget's copy of the mark, emitted as a base64 data URI in a small JS
 * module rather than as a file in static/.
 *
 * The widget runs inside someone else's page on a different origin, so it
 * cannot reference an image by URL without adding a request that their CSP,
 * an ad blocker, or a flaky network can fail independently of the script
 * itself. Inlining keeps the "the mark cannot fail to load" property the
 * hand-drawn SVG had, while actually being the real logo rather than an
 * approximation of it.
 *
 * 96px for a mark rendered at 22 CSS px: covers 4x device pixel ratios, and
 * costs ~4.5 KB of the bundle, which is the price of it being exact.
 */
const WIDGET_MARK_SIZE = 96;
const WIDGET_MARK_OUT = 'src/widget/mark.js';

// The app's own dark-theme background (src/app.css --bg), used wherever an
// icon needs an opaque backing: maskable icons are clipped to arbitrary
// shapes by the OS and cannot rely on transparency showing anything
// sensible, and iOS ignores alpha on home-screen icons entirely and
// renders transparent areas black instead.
const BRAND_BG = '#0f1420';

async function squareIcon(size, { background, source = SOURCE } = {}) {
	const image = sharp(source).resize(size, size, { fit: 'contain' });
	// `resize`'s own `background` option only fills letterboxing from a
	// fit mismatch; the source is already square, so it never applies and
	// the logo's transparent diagonal would pass straight through into a
	// "transparent" PNG regardless of what was asked for. `flatten` is what
	// actually composites the alpha away onto an opaque color.
	if (background) image.flatten({ background });
	return image.png().toBuffer();
}

/**
 * A maskable icon needs its content inside the safe zone (the inner 80% of
 * the canvas): Android and other launchers crop the outer 10% on every side
 * to whatever shape the device theme uses, and content outside that circle
 * can be clipped. Padding the logo down to 70% of the canvas before
 * compositing onto an opaque background keeps it inside that zone with
 * margin to spare.
 */
async function maskableIcon(size, source = SOURCE) {
	const logoSize = Math.round(size * 0.7);
	const logo = await sharp(source).resize(logoSize, logoSize).png().toBuffer();
	const offset = Math.round((size - logoSize) / 2);
	return sharp({
		create: { width: size, height: size, channels: 4, background: BRAND_BG }
	})
		.composite([{ input: logo, left: offset, top: offset }])
		.png()
		.toBuffer();
}

/** 1200x630, the widely-supported OG/Twitter card size: logo centered on the brand background, not stretched to a non-square canvas. */
async function ogImage() {
	const width = 1200;
	const height = 630;
	const logoSize = 460;
	const logo = await sharp(SOURCE)
		.resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toBuffer();
	return sharp({
		create: { width, height, channels: 4, background: BRAND_BG }
	})
		.composite([
			{
				input: logo,
				left: Math.round((width - logoSize) / 2),
				top: Math.round((height - logoSize) / 2)
			}
		])
		.png()
		.toBuffer();
}

async function main() {
	await mkdir(OUT_DIR, { recursive: true });
	await mkdir(BADGE_OUT_DIR, { recursive: true });

	const jobs = [
		['icon-192.png', squareIcon(192, { source: ICON_SOURCE })],
		['icon-512.png', squareIcon(512, { source: ICON_SOURCE })],
		['icon-maskable-512.png', maskableIcon(512, ICON_SOURCE)],
		// iOS: no transparency, no rounded corners (the OS applies its own mask).
		['apple-touch-icon.png', squareIcon(180, { background: BRAND_BG, source: ICON_SOURCE })],
		['favicon-32.png', squareIcon(32, { source: SMALL_ICON_SOURCE })],
		['favicon-16.png', squareIcon(16, { source: SIXTEEN_ICON_SOURCE })],
		['og-image.png', ogImage()]
	];

	for (const [name, job] of jobs) {
		const buffer = await job;
		await sharp(buffer).toFile(`${OUT_DIR}/${name}`);
		console.log(`wrote ${OUT_DIR}/${name}`);
	}

	await writeFaviconSvg();
	await writeWidgetMark();
	await writeBadges();
}

/**
 * The primary favicon for browsers with SVG-favicon support (favicon-16/32
 * above exist only as the PNG fallback for browsers without it). There is no
 * vector master for the icon, so this wraps a modestly-sized raster of it in
 * an SVG shell rather than leaving the browser to downscale a 1920x1920 PNG.
 * Sourced from SMALL_ICON_SOURCE, not ICON_SOURCE: browsers render this at
 * tab-favicon size (16-32 CSS px) regardless of the embedded raster's own
 * dimensions, so it needs the same thick-stroke treatment as the PNG
 * fallbacks above.
 */
async function writeFaviconSvg() {
	const SIZE = 128;
	const png = await sharp(SMALL_ICON_SOURCE)
		.resize(SIZE, SIZE, { fit: 'contain' })
		.png({ compressionLevel: 9 })
		.toBuffer();
	const uri = `data:image/png;base64,${png.toString('base64')}`;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  <title>IndieNodes</title>
  <image href="${uri}" width="${SIZE}" height="${SIZE}" />
</svg>
`;
	await writeFile(FAVICON_SVG_OUT, svg);
	console.log(`wrote ${FAVICON_SVG_OUT} (${png.length} B raw PNG, inlined as base64)`);
}

async function writeWidgetMark() {
	const png = await sharp(SOURCE)
		.resize(WIDGET_MARK_SIZE, WIDGET_MARK_SIZE, {
			fit: 'contain',
			background: { r: 0, g: 0, b: 0, alpha: 0 }
		})
		// Palette-quantized: the mark is four flat-ish gradients, so an indexed
		// PNG is materially smaller than truecolor with no visible difference
		// at this size, and every byte here ships to every host page.
		.png({ compressionLevel: 9, palette: true })
		.toBuffer();

	const module = `// GENERATED by scripts/generate-icons.js. Do not edit by hand.
// The IndieNodes mark, inlined so the widget carries no image request onto a
// host page. Re-run \`node scripts/generate-icons.js\` after changing
// static/images/IndieNodes_Logo.png.
export const MARK_DATA_URI =
\t'data:image/png;base64,${png.toString('base64')}';
`;
	await writeFile(WIDGET_MARK_OUT, module);
	console.log(`wrote ${WIDGET_MARK_OUT} (${png.length} B raw, inlined as base64)`);
}

/**
 * The badges remain single self-contained SVG requests even though they use
 * the official raster logo. Embedding a small palette PNG avoids making a
 * badge on someone else's site fetch a second cross-origin asset, and keeps
 * every style tied to the same master artwork as the app and full widget.
 */
async function writeBadges() {
	const logo = await sharp(SOURCE)
		.resize(BADGE_LOGO_SIZE, BADGE_LOGO_SIZE, {
			fit: 'contain',
			background: { r: 0, g: 0, b: 0, alpha: 0 }
		})
		.png({ compressionLevel: 9, palette: true })
		.toBuffer();
	const logoUri = `data:image/png;base64,${logo.toString('base64')}`;
	const shell = (content) =>
		`<svg xmlns="http://www.w3.org/2000/svg" width="88" height="31" viewBox="0 0 88 31" role="img" aria-label="Member of IndieNodes">\n${content}\n</svg>\n`;
	const mark = (x = 3.5, size = 24) =>
		`\t<image href="${logoUri}" x="${x}" y="${(31 - size) / 2}" width="${size}" height="${size}" />`;
	const wordmark = (fill, className = '') =>
		`\t<text x="31" y="19" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="9" font-weight="700"${className ? ` class="${className}"` : ''}${fill ? ` fill="${fill}"` : ''}>IndieNodes</text>`;

	const badges = {
		'classic.svg': shell(
			['\t<rect width="88" height="31" rx="4" fill="#171d2c" />', mark(), wordmark('#eef1f6')].join(
				'\n'
			)
		),
		'minimal.svg': shell(
			['\t<rect width="88" height="31" rx="4" fill="#171d2c" />', mark(31.5, 25)].join('\n')
		),
		'mono.svg': shell(
			[
				`\t<style>
\t\t.mono-frame { stroke: #000; }
\t\t.mono-text { fill: #000; }
\t\t@media (prefers-color-scheme: dark) {
\t\t\t.mono-frame { stroke: #fff; }
\t\t\t.mono-text { fill: #fff; }
\t\t}
\t</style>`,
				'\t<rect x="1" y="1" width="86" height="29" rx="4" fill="none" class="mono-frame" stroke-width="1.4" />',
				mark(),
				wordmark('', 'mono-text')
			].join('\n')
		)
	};

	const typeColors = {
		audio: ['#3b82f6', '#ffffff'],
		comic: ['#a855f7', '#ffffff'],
		game: ['#22c55e', '#0f1420'],
		text: ['#f59e0b', '#0f1420']
	};
	for (const [type, [background, foreground]] of Object.entries(typeColors)) {
		badges[`type-coded-${type}.svg`] = shell(
			[
				`\t<rect width="88" height="31" rx="4" fill="${background}" />`,
				mark(),
				wordmark(foreground)
			].join('\n')
		);
	}

	for (const [name, svg] of Object.entries(badges)) {
		await writeFile(`${BADGE_OUT_DIR}/${name}`, svg);
		console.log(`wrote ${BADGE_OUT_DIR}/${name}`);
	}
}

main();
