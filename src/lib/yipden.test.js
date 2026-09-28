import { describe, expect, it } from 'vitest';
import { yipdenFollowUrl } from './yipden.js';

describe('yipdenFollowUrl', () => {
	it('is null when YipDen is not configured, the expected state until it is published', () => {
		expect(yipdenFollowUrl('', 'https://creator.example/')).toBeNull();
	});

	it('is null when the member has no source url to follow', () => {
		expect(yipdenFollowUrl('https://yipden.example', '')).toBeNull();
	});

	it('appends the member site as a single encoded follow parameter', () => {
		expect(yipdenFollowUrl('https://yipden.example', 'https://creator.example/a b?x=1&y=2')).toBe(
			'https://yipden.example/?follow=https%3A%2F%2Fcreator.example%2Fa+b%3Fx%3D1%26y%3D2'
		);
	});

	it('cannot be made to add a second parameter or a fragment by the member url', () => {
		const href = new URL(
			/** @type {string} */ (
				yipdenFollowUrl('https://yipden.example', 'https://c.example/?a=1&follow=evil#frag')
			)
		);
		expect([...href.searchParams.keys()]).toEqual(['follow']);
		expect(href.searchParams.get('follow')).toBe('https://c.example/?a=1&follow=evil#frag');
		expect(href.hash).toBe('');
	});

	it('replaces a follow parameter already on the configured base', () => {
		const href = new URL(
			/** @type {string} */ (
				yipdenFollowUrl('https://yipden.example/?follow=stale', 'https://c.example/')
			)
		);
		expect(href.searchParams.getAll('follow')).toEqual(['https://c.example/']);
	});

	it('refuses a base that is not https or not a url at all', () => {
		expect(yipdenFollowUrl('http://yipden.example', 'https://c.example/')).toBeNull();
		expect(yipdenFollowUrl('javascript:alert(1)', 'https://c.example/')).toBeNull();
		expect(yipdenFollowUrl('not a url', 'https://c.example/')).toBeNull();
	});
});
