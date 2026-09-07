import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

/**
 * Every component has to compile to JavaScript that actually parses.
 *
 * That sounds like something the rest of the toolchain must already cover,
 * and it isn't: `svelte-check`, `eslint` and `prettier` all read the
 * *source*, which can be perfectly valid while the compiler's own printer
 * emits something that is not. `npm run build` does not catch it either --
 * its client and server passes are configured differently enough from the
 * dev server's that a construct can survive the production build and still
 * break `vite dev`. Neither do the e2e suites, which run against the built
 * output rather than the dev server.
 *
 * The gap is not hypothetical. Writing an inline JSDoc type annotation on an
 * arrow function's parameter -- the annotation comment sitting inside the
 * parameter list, immediately before the parameter name -- makes Svelte's
 * printer emit that parameter *parenthesised*, as `((n)) =>`, which is a
 * syntax error. Every route importing that component 500'd on SSR while the
 * whole toolchain above stayed green, because nothing in it ever parsed the
 * generated output. This does. Annotate such a parameter with a `@param` tag
 * above the function instead.
 */

const root = fileURLToPath(new URL('../..', import.meta.url));

/** @param {string} dir @returns {string[]} */
function svelteFiles(dir) {
	/** @type {string[]} */
	const found = [];
	for (const entry of readdirSync(`${root}/${dir}`, { withFileTypes: true })) {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) found.push(...svelteFiles(path));
		else if (entry.name.endsWith('.svelte')) found.push(path);
	}
	return found;
}

const components = svelteFiles('src');

describe('every component compiles to parseable JavaScript', () => {
	it('finds components to check', () => {
		// Guards the guard: a walk that silently returned nothing would make
		// every case below vacuously pass.
		expect(components.length).toBeGreaterThan(10);
	});

	// Both modes, because they are separate code paths in the printer and
	// the failure this exists for hit them independently.
	it.each(
		components.flatMap((file) => [
			{ file, generate: /** @type {const} */ ('server') },
			{ file, generate: /** @type {const} */ ('client') }
		])
	)('$file ($generate)', ({ file, generate }) => {
		const source = readFileSync(`${root}/${file}`, 'utf8');
		// `runes: true` matches what vite.config.js forces for everything
		// outside node_modules, so this compiles each file the same way the
		// real build and dev server do.
		const { js } = compile(source, { generate, filename: file, runes: true });
		expect(() => parse(js.code, { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow();
	});
});
