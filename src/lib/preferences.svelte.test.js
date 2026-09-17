import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ROTATION_MS, loadPreferences } from './preferences.js';
import { STORAGE_KEYS } from './storageKeys.js';

const STORAGE_KEY = STORAGE_KEYS.preferences.key;

afterEach(() => {
	localStorage.removeItem(STORAGE_KEY);
});

describe('Stored flags are coerced, not trusted', () => {
	it.each(['false', 'true', 1, 'yes', {}, []])(
		'a non-boolean showExplicit (%j) keeps explicit content hidden',
		(value) => {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ showExplicit: value }));
			expect(loadPreferences().showExplicit).toBe(false);
		}
	);

	it('a real true still opts in', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ showExplicit: true }));
		expect(loadPreferences().showExplicit).toBe(true);
	});

	it('fitToView must be a real boolean too', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ fitToView: 'false' }));
		expect(loadPreferences().fitToView).toBe(false);
	});

	it('an unknown theme or background falls back to the default', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: 42, background: 'lava' }));
		const prefs = loadPreferences();
		expect(prefs.theme).toBe('system');
		expect(prefs.background).toBe('drifty-stars');
	});

	it('valid stored choices are kept', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: 'dark', background: 'none' }));
		const prefs = loadPreferences();
		expect(prefs.theme).toBe('dark');
		expect(prefs.background).toBe('none');
	});
});

describe('Art rotation preferences', () => {
	it('has its own default pace instead of borrowing the Any node pace', () => {
		expect(DEFAULT_ROTATION_MS.art).toBe(14000);
		expect(loadPreferences().rotationMs.art).toBe(14000);
	});

	it('keeps a saved Art pace when preferences are loaded again', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ rotationMs: { art: 5000, any: 14000 } }));

		expect(loadPreferences().rotationMs.art).toBe(5000);
	});
});
