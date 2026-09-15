import { browser } from '$app/environment';
import { STORAGE_KEYS, safeReadJson, safeWriteJson } from './storageKeys.js';

/**
 * The mobile "add to home screen" offer: whether this browser can install the
 * app, how, and whether it has already been asked.
 *
 * Two ways in, because the platforms differ. Chromium browsers fire
 * `beforeinstallprompt`, which can be held and replayed later to open the
 * browser's own install dialog. iOS has no install API at all; the only route
 * is Share, then Add to Home Screen, so there the offer is instructions.
 *
 * The automatic banner asks ONCE per browser and never again, whichever way
 * it ends. Brief section 11 forbids return-prompting mechanics, and an ask that
 * came back on a timer would be one; docs/decisions.md has the argument, which
 * is the same one the rating prompt's entry makes. The More menu's Install
 * item is the deliberate route afterwards, and it asks nothing on its own.
 */
const KEY = STORAGE_KEYS.installPrompt.key;
const VERSION = 1;

/** Visits before the banner may appear: the second, never the first. */
export const INSTALL_AFTER_VISITS = 2;

/**
 * @typedef {Event & {
 *   prompt: () => Promise<void>,
 *   userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
 * }} BeforeInstallPromptEvent
 */

/** @returns {boolean} */
function detectIos() {
	if (!browser) return false;
	const ua = navigator.userAgent;
	// iPadOS reports itself as a Mac; touch points are what give it away.
	return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Already running as an installed app, from the home screen or otherwise. */
function detectStandalone() {
	if (!browser) return false;
	const nav = /** @type {Navigator & { standalone?: boolean }} */ (navigator);
	return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

/**
 * Inside one of the native shells (platforms/capacitor, platforms/wails),
 * where there is nothing to install: the visitor is already in the app.
 *
 * Exported for anything else that needs "is this actually a browser tab or
 * PWA, as opposed to a native shell" -- Ambient's manual fullscreen toggle
 * being the first (see AmbientView.svelte): a Capacitor Android build is
 * already full-bleed by the OS, so the toggle would be a no-op control
 * offering nothing there. `window.Capacitor` is what Capacitor's own native
 * runtime injects before any page script runs; this project has not wired
 * Capacitor in yet, so today that global is simply absent everywhere this
 * runs, which correctly reads as "not native" (browser and installed PWA
 * alike) until it actually exists to detect.
 */
export function detectNativeShell() {
	if (!browser) return false;
	const w = /** @type {Window & { Capacitor?: unknown, wails?: unknown, go?: unknown }} */ (window);
	return Boolean(w.Capacitor || w.wails || w.go);
}

function createInstallPromptStore() {
	/** @type {BeforeInstallPromptEvent | null} */
	let deferred = $state(null);
	let answered = $state(
		browser && safeReadJson(KEY, /** @type {{ answered?: unknown }} */ ({}))?.answered === true
	);
	let installed = $state(false);
	// The iOS steps, opened from either the banner or the More menu.
	let stepsOpen = $state(false);
	const ios = detectIos();
	const nativeShell = detectNativeShell();
	let standalone = $state(detectStandalone());
	let started = false;

	function markAnswered() {
		answered = true;
		safeWriteJson(KEY, { version: VERSION, answered: true });
	}

	return {
		/**
		 * Starts listening. Called once from the root layout. The event may
		 * already have fired before hydration, so app.html holds on to it in
		 * `window.__indienodesInstallEvent` and this picks it up from there.
		 */
		start() {
			if (!browser || started) return;
			started = true;
			const w = /** @type {Window & { __indienodesInstallEvent?: BeforeInstallPromptEvent }} */ (
				window
			);
			if (w.__indienodesInstallEvent) deferred = w.__indienodesInstallEvent;
			window.addEventListener('beforeinstallprompt', (event) => {
				// Stops Chromium's own mini-infobar: the offer is made once, here.
				event.preventDefault();
				deferred = /** @type {BeforeInstallPromptEvent} */ (event);
			});
			window.addEventListener('appinstalled', () => {
				installed = true;
				deferred = null;
				markAnswered();
			});
			window
				.matchMedia('(display-mode: standalone)')
				.addEventListener('change', (event) => (standalone = event.matches));
		},

		/** 'native' opens the browser's dialog; 'ios' means show the steps. */
		get method() {
			if (deferred) return 'native';
			if (ios) return 'ios';
			return null;
		},

		/** Whether installing is possible at all from here, right now. */
		get available() {
			return browser && !installed && !standalone && !nativeShell && this.method !== null;
		},

		get answered() {
			return answered;
		},

		/**
		 * Whether the one-time banner may show. Phones and tablets only: the
		 * ask is about a home screen, and a desktop browser surfaces its own.
		 * @param {number} visits
		 */
		bannerEligible(visits) {
			return (
				this.available &&
				!answered &&
				visits >= INSTALL_AFTER_VISITS &&
				window.matchMedia('(pointer: coarse)').matches
			);
		},

		markAnswered,

		get stepsOpen() {
			return stepsOpen;
		},

		/** @param {boolean} value */
		setStepsOpen(value) {
			stepsOpen = value;
		},

		/**
		 * Opens the browser's install dialog when there is one. Resolves to
		 * what happened; 'ios' tells the caller to show the manual steps.
		 * @returns {Promise<'accepted' | 'dismissed' | 'ios' | 'unavailable'>}
		 */
		async install() {
			if (!deferred) return ios ? 'ios' : 'unavailable';
			const event = deferred;
			// A held event can be replayed once; the browser fires a fresh one
			// later if installing is still possible.
			deferred = null;
			await event.prompt();
			const { outcome } = await event.userChoice;
			if (outcome === 'accepted') installed = true;
			return outcome;
		}
	};
}

export const installPromptStore = createInstallPromptStore();
