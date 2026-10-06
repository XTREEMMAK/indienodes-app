#!/usr/bin/env node
// Slopsquatting guard: flags dependencies that this change adds and whose
// registry name was created recently.
//
// `npm audit signatures` cannot catch this. A look-alike package registered
// last week is signed by the registry like any other, so the age of a name
// that is new to this repo is the only signal available.
//
//   BASE_REF=origin/main node scripts/check-new-dependencies.mjs
//
// Direct dependencies (package.json) that are new since BASE_REF fail the run
// if the name is younger than MIN_AGE_DAYS, cannot be looked up, or is not a
// plain registry version range (git/URL/file specs bypass the registry).
// Transitive packages (package-lock.json) that are new only warn: a routine
// bump legitimately introduces new platform-binary names, and failing on
// those would train people to bypass the check.
//
// A young package that has actually been reviewed goes in
// scripts/new-dependency-allowlist.json to let it through. Reviewing it means
// reading the upstream repo and checking that it is the package you meant.
//
// No dependencies of its own, no shell: git runs via execFileSync with fixed
// arguments, the ref is validated first, and the only host contacted is
// registry.npmjs.org, with redirects refused.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Overridable so the age path can be exercised; CI leaves it at the default.
const MIN_AGE_DAYS = Number.parseInt(process.env.MIN_AGE_DAYS ?? '', 10) || 90;
const REGISTRY = 'https://registry.npmjs.org/';
const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWLIST_PATH = new URL('./new-dependency-allowlist.json', import.meta.url);

const baseRef = process.env.BASE_REF;
if (!baseRef) {
	console.log('BASE_REF is not set; nothing to compare against, skipping.');
	process.exit(0);
}
// A branch name, remote ref or full SHA. Refusing anything else, including a
// leading "-", means the value can never be read by git as an option.
if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(baseRef)) {
	console.error(`BASE_REF ${JSON.stringify(baseRef)} is not a plain ref or SHA.`);
	process.exit(1);
}
// A first push has an all-zero "before" SHA and there is nothing to diff.
if (/^0+$/.test(baseRef)) {
	console.log('BASE_REF is the null SHA (new branch); skipping.');
	process.exit(0);
}

function baseFile(path) {
	try {
		return JSON.parse(
			execFileSync('git', ['show', `${baseRef}:${path}`], {
				encoding: 'utf8',
				maxBuffer: 64 * 1024 * 1024,
				stdio: ['ignore', 'pipe', 'ignore']
			})
		);
	} catch {
		return null;
	}
}

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));

function directDeps(pkg) {
	return {
		...pkg?.devDependencies,
		...pkg?.optionalDependencies,
		...pkg?.dependencies
	};
}

function lockNames(lock) {
	const names = new Set();
	for (const key of Object.keys(lock?.packages ?? {})) {
		if (key) names.add(key.replace(/^.*node_modules\//, ''));
	}
	return names;
}

// Only what npm would fetch by name from the registry: a semver range or a
// dist-tag. Anything with a scheme, path or shorthand is a different source.
const REGISTRY_SPEC = /^(?:[\^~<>=*xX\d][\w.\-+^~<>=|*xX ]*|latest|next)$/;

async function createdAt(name) {
	const res = await fetch(REGISTRY + encodeURIComponent(name), {
		headers: { accept: 'application/json' },
		redirect: 'error',
		signal: AbortSignal.timeout(20_000)
	});
	if (!res.ok) throw new Error(`registry returned ${res.status}`);
	const created = (await res.json())?.time?.created;
	if (!created || Number.isNaN(Date.parse(created))) throw new Error('no creation date');
	return new Date(created);
}

async function mapLimit(items, limit, fn) {
	const out = [];
	let i = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (i < items.length) {
				const item = items[i++];
				out.push(await fn(item));
			}
		})
	);
	return out;
}

const basePkg = baseFile('package.json');
const baseLock = baseFile('package-lock.json');
if (!basePkg) {
	console.log(`No package.json at ${baseRef}; skipping.`);
	process.exit(0);
}

const allow = new Set(readJson(ALLOWLIST_PATH).allow ?? []);
const nowDeps = directDeps(readJson(new URL('../package.json', import.meta.url)));
const beforeDeps = directDeps(basePkg);
const newDirect = Object.keys(nowDeps).filter((n) => !(n in beforeDeps));

const nowLock = lockNames(readJson(new URL('../package-lock.json', import.meta.url)));
const beforeLock = lockNames(baseLock);
const newTransitive = [...nowLock].filter(
	(n) => !beforeLock.has(n) && !(n in nowDeps) && !n.startsWith('@types/')
);

let failed = false;
const fail = (msg) => {
	failed = true;
	console.error(`::error::${msg}`);
};

const lookup = async (name) => {
	try {
		return { name, created: await createdAt(name) };
	} catch (err) {
		return { name, error: err.message };
	}
};

for (const name of newDirect) {
	if (!REGISTRY_SPEC.test(nowDeps[name])) {
		fail(
			`${name}: "${nowDeps[name]}" is not a registry version range; git, URL and file sources bypass the registry.`
		);
	}
}

const direct = await mapLimit(newDirect, 8, lookup);
for (const { name, created, error } of direct) {
	if (allow.has(name)) {
		console.log(`${name}: allowlisted`);
	} else if (error) {
		fail(`${name}: new dependency, registry lookup failed (${error}). Failing closed.`);
	} else {
		const age = Math.floor((Date.now() - created) / DAY_MS);
		if (age < MIN_AGE_DAYS) {
			fail(
				`${name}: new dependency whose registry name is only ${age} days old (created ${created.toISOString().slice(0, 10)}). Verify it is the package you meant, then add it to scripts/new-dependency-allowlist.json.`
			);
		} else {
			console.log(`${name}: new dependency, name is ${age} days old, ok`);
		}
	}
}

const transitive = await mapLimit(newTransitive, 8, lookup);
for (const { name, created, error } of transitive) {
	if (allow.has(name)) continue;
	if (error) {
		console.log(`::warning::${name}: new transitive package, lookup failed (${error})`);
	} else {
		const age = Math.floor((Date.now() - created) / DAY_MS);
		if (age < MIN_AGE_DAYS) {
			console.log(
				`::warning::${name}: new transitive package whose registry name is only ${age} days old`
			);
		}
	}
}

console.log(
	`Checked ${newDirect.length} new direct and ${newTransitive.length} new transitive package(s) against ${baseRef}.`
);
process.exit(failed ? 1 : 0);
