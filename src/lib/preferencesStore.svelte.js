import {
	loadPreferences,
	savePreferences,
	DEFAULT_ROTATION_MS,
	ROTATION_MIN_MS,
	ROTATION_MAX_MS
} from './preferences.js';
import { applyTheme, watchSystemTheme } from './theme.js';

/**
 * Shared reactive preferences state, so the header toggle, the settings
 * page, and the layout's background mount all read and write the same
 * values instead of drifting out of sync.
 */
function createPreferencesStore() {
	let preferences = $state(loadPreferences());

	return {
		get theme() {
			return preferences.theme;
		},
		get background() {
			return preferences.background;
		},
		/** @param {'light' | 'dark' | 'system'} theme */
		setTheme(theme) {
			preferences.theme = theme;
			savePreferences(preferences);
			applyTheme(theme);
		},
		get fitToView() {
			return preferences.fitToView;
		},
		get showExplicit() {
			return preferences.showExplicit;
		},
		get randomizeAudioTracks() {
			return preferences.randomizeAudioTracks;
		},
		get rotationMs() {
			return preferences.rotationMs;
		},
		/**
		 * How long a node of this type holds an entry. Falls back to `any` and
		 * then to a sane number, so a node type this build does not know about
		 * still rotates rather than sitting on NaN.
		 * @param {string} type
		 */
		rotationFor(type) {
			return preferences.rotationMs?.[type] ?? preferences.rotationMs?.any ?? 14000;
		},
		/**
		 * @param {string} type
		 * @param {number} ms
		 */
		setRotation(type, ms) {
			const clamped = Math.min(ROTATION_MAX_MS, Math.max(ROTATION_MIN_MS, Math.round(ms)));
			preferences.rotationMs = { ...preferences.rotationMs, [type]: clamped };
			savePreferences(preferences);
		},
		resetRotation() {
			preferences.rotationMs = { ...DEFAULT_ROTATION_MS };
			savePreferences(preferences);
		},
		get ambientTypes() {
			return preferences.ambientTypes;
		},
		/**
		 * Whether entries of this type are eligible to appear in Ambient View.
		 * Defaults to visible, so a type this build does not yet know about
		 * (or a preferences file saved before it existed) still shows up.
		 * @param {string} type
		 */
		isAmbientTypeVisible(type) {
			return preferences.ambientTypes?.[type] ?? true;
		},
		/**
		 * @param {string} type
		 * @param {boolean} value
		 */
		setAmbientTypeVisible(type, value) {
			preferences.ambientTypes = { ...preferences.ambientTypes, [type]: value };
			savePreferences(preferences);
		},
		/** @param {boolean} value */
		setShowExplicit(value) {
			preferences.showExplicit = value;
			savePreferences(preferences);
		},
		/** @param {boolean} value */
		setRandomizeAudioTracks(value) {
			preferences.randomizeAudioTracks = value;
			savePreferences(preferences);
		},
		/** @param {'none' | 'drifty-stars'} background */
		setBackground(background) {
			preferences.background = background;
			savePreferences(preferences);
		},
		/** @param {boolean} value */
		setFitToView(value) {
			preferences.fitToView = value;
			savePreferences(preferences);
		},
		toggleFitToView() {
			this.setFitToView(!preferences.fitToView);
		},
		get startupMode() {
			return preferences.startupMode;
		},
		/** @param {'field' | 'ambient'} mode */
		setStartupMode(mode) {
			preferences.startupMode = mode === 'ambient' ? 'ambient' : 'field';
			savePreferences(preferences);
		},
		/** Applies the current theme and starts tracking `prefers-color-scheme`. */
		init() {
			applyTheme(preferences.theme);
			return watchSystemTheme(() => preferences.theme);
		}
	};
}

export const preferencesStore = createPreferencesStore();
