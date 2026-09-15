import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_STORAGE_KEYS, EXPORTABLE_KEYS, KEY_LABELS, STORAGE_KEYS } from './storageKeys.js';

const SRC = new URL('..', import.meta.url).pathname;

/**
 * Scans `src/` once for two things: raw `indienode:*` literals (which should
 * no longer exist outside the catalog) and `STORAGE_KEYS.<name>` references.
 */
function scanSource() {
	/** @type {{ literals: Map<string, string>, refs: Set<string> }} */
	const found = { literals: new Map(), refs: new Set() };
	/** @param {string} dir */
	function walk(dir) {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) {
				walk(path);
				continue;
			}
			if (!/\.(js|ts|svelte)$/.test(name)) continue;
			// The catalog declares; its test scans. Neither is a usage.
			if (path.endsWith('storageKeys.js') || path.endsWith('storageKeys.test.js')) continue;
			// Tests are allowed to name a key literally: pinning the exact
			// string is how a test asserts against real stored data. The rule
			// being enforced is about production code paths.
			if (/\.(test|spec)\.(js|ts)$/.test(name)) continue;
			const source = readFileSync(path, 'utf8');
			for (const m of source.matchAll(/'(indienode:[a-z0-9:.-]+)'/g)) {
				found.literals.set(m[1], path);
			}
			for (const m of source.matchAll(/STORAGE_KEYS\.([A-Za-z0-9_]+)/g)) found.refs.add(m[1]);
		}
	}
	walk(SRC);
	return found;
}

describe('the catalog is the only place a key is written down', () => {
	it('has no raw storage-key literal anywhere else in src/', () => {
		const { literals } = scanSource();
		const offenders = [...literals].map(([key, path]) => `${key} in ${path}`);

		// A literal outside the catalog is a key that bypassed the portability
		// decision — exactly how the export registry drifted before. Import it
		// from STORAGE_KEYS instead.
		expect(offenders).toEqual([]);
	});

	it('has no catalogued entry that nothing references', () => {
		const { refs } = scanSource();
		const stale = Object.keys(STORAGE_KEYS).filter((name) => !refs.has(name));
		expect(stale).toEqual([]);
	});
});

describe('the literal keys are pinned', () => {
	it('names every key exactly, so a rename is a deliberate change', () => {
		// A key is where real visitors' data already lives. Changing one
		// silently orphans it, so the strings are asserted here rather than
		// only being whatever the catalog currently happens to say.
		expect(Object.fromEntries(ALL_STORAGE_KEYS.map((e) => [e.key, e.exportable]))).toEqual({
			'indienode:favorites:v1': true,
			'indienode:hidden:v1': true,
			'indienode:journal:v1': true,
			'indienode:layout:v1': true,
			'indienode:preferences:v1': true,
			'indienode:filters:v1': true,
			'indienode:volume:v1': true,
			'indienode:skins:v1': true,
			'indienode:ambient-consent:v1': true,
			'indienode:visit-count:v1': true,
			'indienode:feedback-prompt:v1': true,
			'indienode:install-prompt:v1': false,
			'indienode:player-position:v1': false,
			'indienode:submission-draft:v1': false,
			'indienode:update-draft:v1': false
		});
	});
});

describe('portability is always an explicit decision', () => {
	it('states exportable as a boolean for every key', () => {
		for (const entry of ALL_STORAGE_KEYS) {
			expect(typeof entry.exportable, `${entry.key} must declare exportable`).toBe('boolean');
		}
	});

	it('requires a stated reason for anything held back', () => {
		for (const entry of ALL_STORAGE_KEYS.filter((candidate) => !candidate.exportable)) {
			expect(entry.reason, `${entry.key} is not exportable and must say why`).toBeTruthy();
		}
	});

	it('gives every key a human label', () => {
		for (const entry of ALL_STORAGE_KEYS) {
			expect(entry.label, `${entry.key} needs a label`).toBeTruthy();
			expect(KEY_LABELS[entry.key]).toBe(entry.label);
		}
	});

	it('uses each literal key exactly once', () => {
		const keys = ALL_STORAGE_KEYS.map((entry) => entry.key);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe('what an export carries', () => {
	it('includes the keys a visitor would expect to move devices with', () => {
		for (const name of [
			'favorites',
			'hidden',
			'journal',
			'layout',
			'preferences',
			'filters',
			'volume',
			'skins'
		]) {
			expect(EXPORTABLE_KEYS, `${name} should be portable`).toContain(STORAGE_KEYS[name].key);
		}
	});

	it('holds back drafts and viewport-specific geometry', () => {
		for (const name of ['submissionDraft', 'updateDraft', 'playerPosition']) {
			expect(EXPORTABLE_KEYS).not.toContain(STORAGE_KEYS[name].key);
		}
	});
});
