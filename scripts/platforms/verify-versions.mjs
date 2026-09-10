// Checks the native hosts' own metadata, from CI (.github/workflows/ci.yml)
// and `npm run platforms:check`.
//
// The three native version strings must agree with each other, and nothing
// more. They deliberately do *not* track the web app's version, which is what
// this script used to require.
//
// That rule came in by accident rather than by decision. The hosts were
// scaffolded at 1.1.0 because that was the web app's version that day, this
// check then pinned them there, and every release since has dragged them along
// -- so a pair of untouched scaffolds arrived at 1.5.x, and Android's
// versionCode climbed to 7, implying six store submissions that never
// happened. A version is a claim about maturity, and theirs was overstating it
// by four minor releases.
//
// So they sit at 0.0.1 until native development actually begins, and move on
// their own schedule once it does. Keeping the three in step with each other is
// still worth enforcing: they describe one product from a user's point of view,
// and a desktop build claiming a different version from the Android build of
// the same release is the kind of thing nobody notices until a bug report cites
// a version that never existed.
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const rootPackage = await readJson(join(repoRoot, 'package.json'));
const capacitorPackage = await readJson(join(repoRoot, 'platforms/capacitor/package.json'));
const wailsConfig = await readJson(join(repoRoot, 'platforms/wails/wails.json'));
const androidGradle = await readFile(
	join(repoRoot, 'platforms/capacitor/android/app/build.gradle'),
	'utf8'
);
const androidVersion = androidGradle.match(/\bversionName\s+["']([^"']+)["']/)?.[1];

const nativeVersions = {
	'Capacitor host package': capacitorPackage.version,
	'Android versionName': androidVersion,
	'Wails productVersion': wailsConfig.info?.productVersion
};

const failures = [];
const distinctNativeVersions = new Set(Object.values(nativeVersions));
if (distinctNativeVersions.size !== 1 || distinctNativeVersions.has(undefined)) {
	// `?? null` so a field that is missing outright is still named in the
	// message: JSON.stringify drops an undefined value's key entirely, which
	// would report the one broken host by saying nothing about it.
	const found = Object.fromEntries(
		Object.entries(nativeVersions).map(([label, value]) => [label, value ?? null])
	);
	failures.push(`The native hosts must carry one version between them: ${JSON.stringify(found)}.`);
}

const capacitorVersions = {
	'@capacitor/core': rootPackage.dependencies?.['@capacitor/core'],
	'@capacitor/android': rootPackage.dependencies?.['@capacitor/android'],
	'@capacitor/cli': rootPackage.devDependencies?.['@capacitor/cli']
};
const normalizedCapacitorVersions = new Set(
	Object.values(capacitorVersions).map((value) => value?.replace(/^[~^]/, ''))
);
if (normalizedCapacitorVersions.size !== 1 || normalizedCapacitorVersions.has(undefined)) {
	failures.push(`Capacitor packages must use one version: ${JSON.stringify(capacitorVersions)}.`);
}

if (failures.length) {
	for (const failure of failures) console.error(failure);
	process.exit(1);
}

console.log(
	`Native hosts are aligned at ${[...distinctNativeVersions][0]}, independently of the web app's ${rootPackage.version}; Capacitor packages are aligned at ${[...normalizedCapacitorVersions][0]}.`
);
