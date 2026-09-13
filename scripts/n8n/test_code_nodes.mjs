/**
 * Runs the generated Code-node JS in a sandbox that mimics n8n's.
 *
 * n8n's Code sandbox is narrower than Node: URL, URLSearchParams, crypto,
 * fetch and process are all absent (measured 2026-08-22). A `new URL()` buried
 * in a try/catch therefore fails silently rather than loudly, which is exactly
 * how the live Review Action has been dropping creator_id on every approval.
 * These tests deny those globals so that class of bug fails here, in a second,
 * rather than after a push and a round-trip through a webhook.
 *
 *   node scripts/n8n/test_code_nodes.mjs
 */
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { format } from 'prettier';

const DENIED = ['URL', 'URLSearchParams', 'crypto', 'fetch', 'process', 'require', 'globalThis'];

function extract(builder, nodeName) {
	const out = execFileSync(
		'python3',
		[
			'-c',
			`
import json, importlib.util, pathlib
spec = importlib.util.spec_from_file_location("g", "scripts/n8n/build_workflows.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
wf = dict(m.BUILDERS)["${builder}"]({})
print(json.dumps([n["parameters"]["jsCode"] for n in wf["nodes"] if n["name"] == "${nodeName}"][0]))
`
		],
		{ encoding: 'utf8' }
	);
	return JSON.parse(out);
}

function run(js, json, helpers = {}) {
	const $input = { first: () => ({ json }), all: () => [{ json }] };
	// Real n8n exposes both accessors on `$(name)`; nodes here use each.
	const $ = (name) => ({
		item: { json: helpers[name] ?? {} },
		first: () => ({ json: helpers[name] ?? {} }),
		all: () => [{ json: helpers[name] ?? {} }]
	});
	// Shadow the denied globals with throwing getters so any use is a hard error.
	const shadow = DENIED.map(
		(g) =>
			`const ${g} = new Proxy({}, { get(){ throw new ReferenceError("${g} is not defined"); }, apply(){ throw new ReferenceError("${g} is not defined"); } });`
	).join('\n');
	return new Function('$input', '$json', '$', `${shadow}\n${js}`)($input, json, $);
}

let pass = 0,
	fail = 0;
const check = (label, got, want) => {
	const ok = got === want;
	ok ? pass++ : fail++;
	if (!ok)
		console.log(`  FAIL ${label}\n       got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

// --- Every Code node must at least parse ------------------------------------
// A generated node with a JS syntax error is accepted by the n8n API, saved,
// activated, and only fails when someone triggers it -- and because a Code node
// has no error output wired, the run aborts before any Respond node, so the
// caller gets a blank page with no clue. That is exactly how a literal newline
// inside a string literal reached production here: Python expanded \n in a
// non-raw builder string, and the node was never in this file's test list.
// Checking all of them costs milliseconds and catches the whole class.
function allCodeNodes() {
	const out = execFileSync(
		'python3',
		[
			'-c',
			`
import json, importlib.util
spec = importlib.util.spec_from_file_location("g", "scripts/n8n/build_workflows.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
rows = []
for name, b in m.BUILDERS:
    wf = b({})
    for n in wf["nodes"]:
        if n["type"] == "n8n-nodes-base.code":
            rows.append([name, n["name"], n["parameters"]["jsCode"]])
print(json.dumps(rows))
`
		],
		{ encoding: 'utf8', maxBuffer: 1 << 24 }
	);
	return JSON.parse(out);
}

for (const [wfName, nodeName, js] of allCodeNodes()) {
	let err = null;
	try {
		new Function(js);
	} catch (e) {
		err = e.message;
	}
	check(`parses: ${wfName} / ${nodeName}`, err, null);
}

// --- Intake: bot gate follows each action's real request contract ----------
//
// issue_token and the final actions come directly from filled forms and carry
// the honeypot/dwell pair. bind_source_url and verify are continuations tied
// to an already-issued submission id and deliberately carry neither. Applying
// the gate to those absent fields used to drop every real Verify request and
// return a not_ready result, which the UI displayed as nothing at all.
const intakeValidate = extract('intake', 'validate + classify');
const intake = (body) => run(intakeValidate, { body })[0].json;

check(
	'intake: issue_token with valid bot fields reaches token lifecycle',
	intake({
		action: 'issue_token',
		source_url: 'https://example.com',
		type: 'audio',
		website: '',
		elapsed_ms: 30000
	}).route,
	'token'
);
check(
	'intake: issue_token without dwell is dropped',
	intake({ action: 'issue_token', source_url: 'https://example.com', type: 'audio' }).route,
	'dropped'
);
check(
	'intake: verify needs only its documented submission id',
	intake({ action: 'verify', submission_id: 'sub1' }).route,
	'token'
);
check(
	'intake: bind_source_url needs only its documented continuation fields',
	intake({ action: 'bind_source_url', submission_id: 'sub1', source_url: 'https://example.com' })
		.route,
	'token'
);
check(
	'intake: a final action without bot fields is still dropped',
	intake({ action: 'submit', submission_id: 'sub1', entry: {}, review: {} }).route,
	'dropped'
);

// --- Re-verify: URL validation ---------------------------------------------
const validate = extract('reverify-token', 'validate url + expiry');
const FUT = new Date(Date.now() + 12 * 3600e3).toISOString();
const PAST = new Date(Date.now() - 3600e3).toISOString();

const reason = (url, exp = FUT) => {
	const r = run(validate, { source_url: url, verification_token: 'tok', expires_at: exp });
	if (r[0].json.proceed === 'yes') return 'ok';
	if (r[0].json.proceed === 'check_dns') return 'check_dns';
	return r[0].json.reason;
};

// A hostname is never range-checked here anymore -- it can't be, until it's
// resolved -- so every name-form case that used to clear validation outright
// now stops at 'check_dns' and waits for the DNS-over-HTTPS lookup further
// down the workflow (see the 'classify resolved ips' block below). Only a
// literal IP (172.15.1.1 is a public address, deliberately distinct from the
// private 172.16-172.31 block below it) can still resolve to 'ok' here.
const cases = [
	['https://example.com/', 'check_dns'],
	['http://example.com/x?y=1', 'check_dns'],
	['https://sub.example.co.uk:8443/p', 'check_dns'],
	['https://n8n.kjnet.us/webhook/abc?tok=x', 'check_dns'],
	['https://localhost/', 'unsafe_url'],
	['https://foo.localhost/', 'unsafe_url'],
	['https://x.internal/', 'unsafe_url'],
	['http://127.0.0.1/', 'unsafe_url'],
	['http://127.1.2.3/', 'unsafe_url'],
	['http://10.0.0.1/', 'unsafe_url'],
	['http://172.20.1.1/', 'unsafe_url'],
	['http://172.15.1.1/', 'ok'],
	['http://192.168.0.1/', 'unsafe_url'],
	['http://169.254.169.254/latest/', 'unsafe_url'],
	['http://100.64.0.1/', 'unsafe_url'],
	['http://0.0.0.0/', 'unsafe_url'],
	['http://224.0.0.1/', 'unsafe_url'],
	['http://[::1]/', 'unsafe_url'],
	['http://[fe80::1]/', 'unsafe_url'],
	['http://[fc00::1]/', 'unsafe_url'],
	['http://[::ffff:127.0.0.1]/', 'unsafe_url'],
	['http://2130706433/', 'unsafe_url'],
	['http://0x7f000001/', 'unsafe_url'],
	['http://0177.0.0.1/', 'unsafe_url'],
	['file:///etc/passwd', 'unsafe_url'],
	['gopher://evil/', 'unsafe_url'],
	['javascript:alert(1)', 'unsafe_url'],
	['https://user:pw@example.com/', 'unsafe_url'],
	['https://evil.com\\@good.com/', 'unsafe_url'],
	['https://exa mple.com/', 'unsafe_url'],
	['https://éxample.com/', 'unsafe_url'],
	['', 'unsafe_url'],
	['not-a-url', 'unsafe_url'],
	['https://metadata.google.internal/', 'unsafe_url']
];
for (const [url, want] of cases) check(`validate ${JSON.stringify(url)}`, reason(url), want);
check('validate expired', reason('https://example.com/', PAST), 'expired');
check('validate missing expires_at', reason('https://example.com/', ''), 'expired');
check('validate garbage expires_at', reason('https://example.com/', 'nope'), 'expired');

// --- Re-verify: response classification ------------------------------------
const classify = extract('reverify-token', 'check meta tag');
// statusCode now comes from the fetch node by reference, because the html node
// replaces the item with its extraction.
const cl = (j, status = j.statusCode) =>
	run(classify, j, {
		'validate url + expiry': { token: 'TOK1' },
		'fetch source_url': status === undefined ? {} : { statusCode: status }
	})[0].json;

check(
	'classify passthrough',
	cl({ proceed: 'no', matched: 'no', reason: 'expired' }).reason,
	'expired'
);
check('classify 302', cl({ statusCode: 302, body: '' }).reason, 'redirect');
check('classify 404', cl({ statusCode: 404, body: '' }).reason, 'unreachable');
check('classify 500', cl({ statusCode: 500, body: '' }).reason, 'unreachable');
// The html node extracts upstream now, so the classifier sees token_values.
check('classify match', cl({ statusCode: 200, token_values: ['TOK1'] }).matched, 'yes');
check(
	'classify match among several meta tags',
	cl({ statusCode: 200, token_values: ['NOPE', 'TOK1'] }).matched,
	'yes'
);
check('classify wrong token', cl({ statusCode: 200, token_values: ['NOPE'] }).matched, 'no');
check('classify no tag', cl({ statusCode: 200, token_values: [] }).reason, 'token_not_found');
check('classify extraction absent', cl({ statusCode: 200 }).reason, 'token_not_found');
check('classify scalar extraction', cl({ statusCode: 200, token_values: 'TOK1' }).matched, 'yes');
// DNS/TCP failure arrives on the error output with no statusCode.
check('classify transport error', cl({ error: 'getaddrinfo ENOTFOUND' }).reason, 'unreachable');

// --- Re-verify: resolved-IP classification (the DNS-rebinding-gap fix) -----
// A hostname's own SSRF exposure isn't in `validate url + expiry` anymore --
// it never resolves the name at all -- so this is the boundary that actually
// closes it: reject if any resolved A/AAAA record lands in a private,
// loopback, link-local, or metadata range.
const classifyDns = extract('reverify-token', 'classify resolved ips');
const cd = (aResp, aaaaResp) =>
	run(
		classifyDns,
		{},
		{
			'validate url + expiry': {
				host: 'attacker-domain.example',
				url: 'https://attacker-domain.example/',
				token: 'TOK1'
			},
			'resolve A': aResp,
			'resolve AAAA': aaaaResp
		}
	)[0].json;

const ok = (data, type) => ({ statusCode: 200, body: { Status: 0, Answer: [{ type, data }] } });
const nx = { statusCode: 200, body: { Status: 3 } }; // NXDOMAIN, no records
const err = { error: 'getaddrinfo ENOTFOUND' }; // transport failure, not a DNS answer

check('dns: public A, no AAAA record', cd(ok('93.184.216.34', 1), nx).proceed, 'yes');
check(
	'dns: metadata-range A is rejected',
	cd(ok('169.254.169.254', 1), nx).reason,
	'unsafe_resolved_ip'
);
check('dns: private-range A is rejected', cd(ok('10.0.0.5', 1), nx).reason, 'unsafe_resolved_ip');
check(
	'dns: safe A but unsafe AAAA is still rejected',
	cd(ok('93.184.216.34', 1), ok('fe80::1', 28)).reason,
	'unsafe_resolved_ip'
);
check('dns: both queries transport-failed', cd(err, err).reason, 'unresolvable');
check('dns: both queries NXDOMAIN', cd(nx, nx).reason, 'unresolvable');

// --- Signature helper -------------------------------------------------------
const build = extract('signature-helper', 'build canonical message');
const signed = run(build, { mode: 'sign', submission_id: 'sub1' });
check('sign emits 3 items (approve, reject, view)', signed.length, 3);
check(
	'sign approve message',
	signed[0].json.message.split('|').slice(0, 2).join('|'),
	'sub1|approve'
);
check('sign view message', signed[2].json.message.split('|').slice(0, 2).join('|'), 'sub1|view');
check('all three share one exp', new Set(signed.map((i) => i.json.exp)).size, 1);
const ver = run(build, {
	mode: 'verify',
	submission_id: 'sub1',
	decision: 'approve',
	exp: '1800000000',
	sig: 'a'.repeat(64)
});
check('verify shape ok', ver[0].json.shape_ok, true);
check(
	'verify rejects short sig',
	run(build, {
		mode: 'verify',
		submission_id: 'sub1',
		decision: 'approve',
		exp: '1800000000',
		sig: 'abc'
	})[0].json.shape_ok,
	false
);
check(
	'verify rejects bad decision',
	run(build, {
		mode: 'verify',
		submission_id: 'sub1',
		decision: 'delete',
		exp: '1800000000',
		sig: 'a'.repeat(64)
	})[0].json.shape_ok,
	false
);
check(
	'verify accepts view as a decision',
	run(build, {
		mode: 'verify',
		submission_id: 'sub1',
		decision: 'view',
		exp: '1800000000',
		sig: 'a'.repeat(64)
	})[0].json.shape_ok,
	true
);

// The link base and the webhook path are one fact. They were two literals once,
// and drifted: links addressed the production path while the workflow listened
// on the test one, so nothing the system signed could ever validate. Nothing
// about that failure is visible until someone clicks a link, which is why it is
// asserted here rather than left to the smoke test.
const paths = JSON.parse(
	execFileSync(
		'python3',
		[
			'-c',
			`
import importlib.util, json
spec = importlib.util.spec_from_file_location("g", "scripts/n8n/build_workflows.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps({"review": m.REVIEW_WEBHOOK_PATH, "base": m.REVIEW_WEBHOOK_BASE,
                  "confirm": m.REVIEW_CONFIRM_WEBHOOK_PATH,
                  "confirm_base": m.REVIEW_CONFIRM_WEBHOOK_BASE,
                  "intake": m.INTAKE_WEBHOOK_PATH}))
`
		],
		{ encoding: 'utf8' }
	)
);
const emit = extract('signature-helper', 'emit links or verdict');
const links = new Function('$input', `${emit}`)({
	all: () =>
		['approve', 'reject', 'view'].map((d) => ({
			json: {
				mode: 'sign',
				submission_id: 'sub1',
				decision: d,
				exp: 1800000000,
				data: 'a'.repeat(64)
			}
		}))
})[0].json;
check(
	'signed link targets the listening path',
	new URL(links.approve_link).pathname.endsWith(paths.review),
	true
);
check('link base derives from the path', paths.base.endsWith(paths.review), true);
check('intake and review paths differ', paths.intake !== paths.review, true);
check('confirmation POST uses its own webhook path', paths.confirm !== paths.review, true);
check(
	'confirmation base derives from its listening path',
	paths.confirm_base.endsWith(paths.confirm),
	true
);
check(
	'sign mode also emits a distinct view_link',
	Boolean(links.view_link) && links.view_link !== links.approve_link,
	true
);

// --- Finalize Submission: validation, now with no config reads ------------
const finValidate = extract('finalize-submission', 'validate + normalize');
const ROW = {
	submission_id: 's1',
	status: 'verified',
	node_id: '',
	type: 'audio',
	source_url: 'https://example.com/',
	verification_token: 't',
	expires_at: new Date(Date.now() + 3600e3).toISOString()
};
const BODY = {
	action: 'submit',
	entry: { creator: 'C', type: 'audio', why: 'w', tags: ['t'], form: 'music' },
	review: { email: 'a@b.co', rights_confirmation: true, eula_agreement: true }
};
const vrun = (row = ROW, body = BODY) => {
	const $ = (name) => ({
		first: () => ({ json: name === 'Trigger' ? { body } : {} }),
		all: () => []
	});
	const shadow = DENIED.map(
		(g) => `const ${g} = new Proxy({}, { get(){ throw new ReferenceError("${g}"); } });`
	).join('\n');
	return new Function('$input', '$json', '$', `${shadow}\n${finValidate}`)(
		{ first: () => ({ json: row }), all: () => [{ json: row }] },
		row,
		$
	);
};
const v = vrun()[0].json;
check('validate passes with no config at all', v.ok, 'yes');
// The whole point of this change: the salt used to be concatenated into
// hash_input here, putting a secret into every execution record.
check('emits rate_key, not a salted hash_input', v.rate_key, 'https://example.com');
check('no hash_input field survives', 'hash_input' in v, false);
check(
	'no item field carries a salt',
	Object.values(v).some((x) => typeof x === 'string' && /salt/i.test(x)),
	false
);
check('turnstile off by default', v.needsTurnstile, 'no');

// --- Finalize Submission: the audio form field ------------------------------
// Mirrors the schema's allOf: required for audio, forbidden everywhere else.
// Both halves matter because both are what validate:publish demands, and it
// demands them only after a reviewer has already read the submission.
check(
	'form: audio without one is rejected',
	vrun(ROW, { ...BODY, entry: { ...BODY.entry, form: undefined } })[0].json.error_code,
	'invalid_request'
);
check('form: audio with "music" passes', vrun()[0].json.ok, 'yes');
check(
	'form: audio with "spoken" passes',
	vrun(ROW, { ...BODY, entry: { ...BODY.entry, form: 'spoken' } })[0].json.ok,
	'yes'
);
check(
	'form: a value outside the enum is rejected',
	vrun(ROW, { ...BODY, entry: { ...BODY.entry, form: 'podcast' } })[0].json.error_code,
	'invalid_request'
);
// /update seeds '' for a pre-migration audio member with no form yet, so that
// the creator is made to choose rather than have one assumed. The form's own
// validation stops it there; this is the same rule behind it.
check(
	'form: the empty pre-migration seed is rejected',
	vrun(ROW, { ...BODY, entry: { ...BODY.entry, form: '' } })[0].json.error_code,
	'invalid_request'
);
// `includes` compares by SameValueZero, so a non-string cannot match its way
// past the enum the way a loose `indexOf` on a coerced value might.
check(
	'form: a non-string does not slip through the enum check',
	vrun(ROW, { ...BODY, entry: { ...BODY.entry, form: { toString: () => 'music' } } })[0].json
		.error_code,
	'invalid_request'
);
check(
	'form: a non-audio type carrying one is rejected',
	vrun(
		{ ...ROW, type: 'comic' },
		{ ...BODY, entry: { ...BODY.entry, type: 'comic', form: 'music' } }
	)[0].json.error_code,
	'invalid_request'
);
check(
	'form: a non-audio type without one passes',
	vrun(
		{ ...ROW, type: 'comic' },
		{ ...BODY, entry: { ...BODY.entry, type: 'comic', form: undefined } }
	)[0].json.ok,
	'yes'
);

// --- Finalize Submission: consent gate --------------------------------------
// Mirrors rightsSectionApplies/consentGiven in src/lib/submissionValidation.js,
// which is what actually gates the /join form's own Continue and Submit
// buttons: Rights only has to be confirmed alongside a stated PRO
// relationship, so this server-side check must accept the same shapes the
// form can produce or a real "Not a member" submitter (the common case) gets
// silently rejected here even though the form told them they were done.
check(
	'consent: eula_agreement missing is always rejected, PRO or not',
	vrun(ROW, { ...BODY, review: { ...BODY.review, eula_agreement: false } })[0].json.error_code,
	'invalid_request'
);
check(
	'consent: rights_confirmation is not required for "Not a member"',
	vrun(ROW, {
		...BODY,
		review: { ...BODY.review, pro_membership: 'Not a member', rights_confirmation: false }
	})[0].json.ok,
	'yes'
);
check(
	'consent: rights_confirmation is not required with no PRO answer at all',
	vrun(ROW, { ...BODY, review: { ...BODY.review, rights_confirmation: false } })[0].json.ok,
	'yes'
);
check(
	'consent: rights_confirmation is required once a real PRO is named',
	vrun(ROW, {
		...BODY,
		review: { ...BODY.review, pro_membership: 'BMI', rights_confirmation: false }
	})[0].json.error_code,
	'invalid_request'
);
check(
	'consent: a real PRO plus rights_confirmation passes',
	vrun(ROW, {
		...BODY,
		review: { ...BODY.review, pro_membership: 'BMI', rights_confirmation: true }
	})[0].json.ok,
	'yes'
);

// --- Finalize Submission: skip a redundant re-verify fetch ------------------
// The second fetch to the creator's source_url is redundant when `verify`
// just succeeded moments ago -- see REVERIFY_SKIP_TTL_SECONDS in
// build_workflows.py. These pin the boundary conditions of that decision.
const FRESH_ROW = { ...ROW, verified_at: new Date().toISOString() };
check('skip_reverify: yes when verified_at is fresh', vrun(FRESH_ROW)[0].json.skip_reverify, 'yes');

const STALE_ROW = { ...ROW, verified_at: new Date(Date.now() - 91_000).toISOString() };
check('skip_reverify: no when verified_at is stale', vrun(STALE_ROW)[0].json.skip_reverify, 'no');

check('skip_reverify: no when verified_at is missing (pre-migration row)', v.skip_reverify, 'no');

const RESUME_ROW = { ...ROW, status: 'notification_failed', verified_at: new Date().toISOString() };
check(
	'skip_reverify: no on resume from notification_failed even if fresh',
	vrun(RESUME_ROW)[0].json.skip_reverify,
	'no'
);

const ART_ROW = { ...ROW, type: 'art' };
const ART_BODY = {
	...BODY,
	entry: {
		creator: 'Studio North',
		type: 'art',
		why: 'Small works in large weather.',
		tags: ['painting'],
		artworks: [
			{
				image_url: 'https://example.com/work.webp',
				alt: 'A blue figure standing beneath a red moon.',
				title: 'Night Signal'
			}
		]
	}
};
check('finalize accepts a schema-shaped Art entry', vrun(ART_ROW, ART_BODY)[0].json.ok, 'yes');
const badArt = structuredClone(ART_BODY);
delete badArt.entry.artworks[0].alt;
check(
	'finalize rejects Art without required alt text',
	vrun(ART_ROW, badArt)[0].json.error_code,
	'invalid_request'
);

const GAME_ROW = { ...ROW, type: 'game' };
const GAME_BODY = {
	...BODY,
	entry: {
		creator: 'Pocket Arcade',
		type: 'game',
		why: 'Small games for late trains.',
		tags: ['game'],
		thumb_url: 'https://example.com/shot.webp',
		preview_url: 'https://example.com/teaser.mp4',
		trailer_url: 'https://youtu.be/dQw4w9WgXcQ'
	}
};
check(
	'finalize accepts separate game preview and YouTube trailer URLs',
	vrun(GAME_ROW, GAME_BODY)[0].json.ok,
	'yes'
);
const badGameTrailer = structuredClone(GAME_BODY);
badGameTrailer.entry.trailer_url = 'https://video.example/trailer';
check(
	'finalize rejects a non-YouTube game trailer',
	vrun(GAME_ROW, badGameTrailer)[0].json.error_code,
	'invalid_request'
);

// --- Finalize Submission: withdrawal ---------------------------------------
// A removal reaches this node through the same token-and-verify path a change
// does, so what is worth pinning is only where it legitimately differs: no
// entry, no email, and a mode the review side can branch on.
const NODE_ROW = { ...ROW, node_id: 'audio-someone-thing' };
// Turnstile guards request_removal (and submit_update) once TURNSTILE_ENABLED
// is true, enforced right here in "validate + normalize" -- not by the
// downstream siteverify call, which this harness never reaches. A present,
// non-empty token is all this node itself checks; the real cryptographic
// verification is "verify turnstile"/"turnstile verdict", further down the
// graph and out of scope for a single-node unit test.
const REMOVE_BODY = {
	action: 'request_removal',
	node_id: 'audio-someone-thing',
	turnstile_token: 'test-turnstile-token'
};

check(
	'a removal with no turnstile token is rejected once Turnstile is enabled',
	vrun(NODE_ROW, { action: 'request_removal', node_id: 'audio-someone-thing' })[0].json.error_code,
	'turnstile_failed'
);

const rem = vrun(NODE_ROW, REMOVE_BODY)[0].json;
check('removal validates with no entry and no email', rem.ok, 'yes');
check('removal is flagged for the review side', rem.is_removal, 'yes');
check('removal is not mistaken for an update', rem.is_update, 'no');
check('removal carries the stored node id', rem.node_id, 'audio-someone-thing');
check('review mode says remove', rem.review.mode, 'remove');
check('removal stores no address', rem.review.email, '');

// The reason is optional in both directions.
check('absent reason is still a complete request', rem.review.reason, '');
const withReason = vrun(NODE_ROW, { ...REMOVE_BODY, reason: 'The project ended.' })[0].json;
check('a given reason is carried through', withReason.review.reason, 'The project ended.');
check(
	'an overlong reason is truncated, not rejected',
	vrun(NODE_ROW, { ...REMOVE_BODY, reason: 'x'.repeat(5000) })[0].json.review.reason.length,
	2000
);

const rateDecide = extract('finalize-submission', 'rate: decide');
const recentRateRows = [{ id: 'rate1', created_at: new Date().toISOString() }];
const rateRun = (normalized) => {
	const $ = () => ({ first: () => ({ json: normalized }) });
	return new Function('$input', '$json', '$', rateDecide)(
		{ all: () => recentRateRows.map((json) => ({ json })) },
		{},
		$
	)[0].json.blocked;
};
check(
	'a recent ordinary submission remains rate limited',
	rateRun({ resume: 'no', is_removal: 'no' }),
	'yes'
);
check(
	'a notification retry remains exempt from the rate limit',
	rateRun({ resume: 'yes', is_removal: 'no' }),
	'no'
);
check(
	'a verified voluntary removal is never delayed by a recent submission',
	rateRun({ resume: 'no', is_removal: 'yes' }),
	'no'
);

// --- Intake: rate_status (the pre-submit "will I be blocked?" check) -------
check(
	'intake: rate_status needs no bot fields and reaches the status route',
	intake({ action: 'rate_status', source_url: 'https://example.com' }).route,
	'status'
);

const rateStatusPrep = extract('intake', 'rate status: prep');
const prepRateStatus = (source_url) => run(rateStatusPrep, { body: { source_url } })[0].json;

check(
	'rate status prep: canonicalizes the same way the write path does',
	prepRateStatus('HTTPS://Example.com:443/foo#bar').rate_key,
	'https://example.com/foo'
);
check(
	'rate status prep: a valid url is ready to hash',
	prepRateStatus('https://example.com/').route,
	'ready'
);
check('rate status prep: an empty source_url is rejected', prepRateStatus('').route, 'error');
check(
	'rate status prep: an overlong source_url is rejected',
	prepRateStatus('https://example.com/' + 'x'.repeat(3000)).route,
	'error'
);

const rateStatusDecide = extract('intake', 'rate status: decide');
const decideRateStatus = (rows) =>
	new Function('$input', '$json', '$', rateStatusDecide)(
		{ all: () => rows.map((json) => ({ json })) },
		{},
		() => ({})
	)[0].json;

check(
	'rate status decide: no matching rows means not blocked',
	decideRateStatus([]).blocked,
	false
);
check(
	'rate status decide: a row inside the window is blocked',
	decideRateStatus([{ created_at: new Date().toISOString() }]).blocked,
	true
);
check(
	'rate status decide: a row well outside the window is not blocked',
	decideRateStatus([{ created_at: new Date(Date.now() - 3600e3).toISOString() }]).blocked,
	false
);
check(
	'rate status decide: an unblocked bucket reports no retry_after_seconds',
	decideRateStatus([]).retry_after_seconds,
	null
);
{
	const retry = decideRateStatus([{ created_at: new Date().toISOString() }]).retry_after_seconds;
	check(
		'rate status decide: a blocked bucket reports a small positive retry_after_seconds',
		Number.isInteger(retry) && retry > 0 && retry < 3600,
		true
	);
}

// Guards. A removal must have been issued against an existing node, and must
// not be able to act on a different one than the token was minted for.
check(
	'removal on a row with no node id is rejected',
	vrun(ROW, REMOVE_BODY)[0].json.error_code,
	'invalid_state'
);
check(
	'removal naming a different node than the row is rejected',
	vrun(NODE_ROW, { ...REMOVE_BODY, node_id: 'audio-someone-else' })[0].json.error_code,
	'invalid_state'
);
// And the reverse: a plain submission must not reach a node-bound row.
check(
	'submit against a node-bound row is still rejected',
	vrun(NODE_ROW, BODY)[0].json.error_code,
	'invalid_state'
);

// --- delivery verdicts ------------------------------------------------------
const gv = extract('finalize-submission', 'gotify delivered?');
const grun = (j) =>
	new Function('$input', '$json', '$', gv)({ first: () => ({ json: j }) }, j, () => ({}))[0].json
		.ok;
check('gotify delivered', grun({ id: 12, appid: 3 }), 'yes');
check('gotify error output falls through to mail', grun({ error: 'ECONNREFUSED' }), 'no');

const ev = extract('finalize-submission', 'email delivered?');
const erun = (j) =>
	new Function('$input', '$json', '$', ev)({ first: () => ({ json: j }) }, j, () => ({}))[0].json
		.ok;
check('email success item', erun({ accepted: ['a@b.co'] }), 'yes');
check('email error item', erun({ error: 'ECONNREFUSED' }), 'no');

const rv = extract('review-action', 'reject: delivered?');
const rrun = (j) =>
	new Function('$input', '$json', '$', rv)({ first: () => ({ json: j }) }, j, () => ({}))[0].json
		.ok;
check('reject mail sent', rrun({ accepted: ['x@y.z'] }), 'yes');
check('reject mail failed -> row survives', rrun({ error: 'auth failed' }), 'no');

// --- notify_js: notification is short, everything else moved to the page ---
const notify = extract('finalize-submission', 'build reviewer notification');
const nrun = (row, body) => {
	const $ = (name) => ({
		first: () =>
			name === 'validate + normalize'
				? {
						json: {
							entry: body.entry,
							review: body.review,
							node_id: row.node_id,
							submission_id: row.submission_id,
							source_url: row.source_url,
							type: row.type
						}
					}
				: {
						json: {
							approve_link: 'https://x/a',
							reject_link: 'https://x/r',
							view_link: 'https://x/v?submission_id=1'
						}
					}
	});
	const shadow = DENIED.map(
		(g) => `const ${g} = new Proxy({}, { get(){ throw new ReferenceError("${g}"); } });`
	).join('\n');
	return new Function('$input', '$json', '$', `${shadow}\n${notify}`)({}, {}, $)[0].json;
};
const NROW = { node_id: '', submission_id: 's1', source_url: 'https://example.com/' };
const NBODY = {
	entry: { type: 'audio', creator: 'C', why: 'w', tags: ['t'] },
	review: { mode: 'new', email: 'a@b.co', rights_confirmation: true, eula_agreement: true }
};
const nbody = nrun(NROW, NBODY).body;
check('notification carries the view link', nbody.includes('https://x/v?submission_id=1'), true);
for (const gone of ['tags:', 'email:', 'Approve:', 'Reject:', 'rights confirmed', 'EULA'])
	check(`notification no longer contains "${gone}"`, nbody.includes(gone), false);

const removalNotice = nrun(
	{
		node_id: 'audio-key-jay',
		submission_id: 'remove1',
		source_url: 'https://keyjay.neocities.org/',
		type: 'audio'
	},
	{ entry: {}, review: { mode: 'remove', reason: 'Project is leaving the ring.' } }
);
check(
	'removal notification has a removal title',
	removalNotice.title,
	'Removal request: audio-key-jay'
);
check('removal notification names the node', removalNotice.body.includes('audio-key-jay'), true);
check(
	'removal notification carries the current type',
	removalNotice.body.includes('type: audio'),
	true
);
check(
	'removal notification carries the verified source',
	removalNotice.body.includes('https://keyjay.neocities.org/'),
	true
);
check(
	'removal notification never renders undefined',
	removalNotice.body.includes('undefined'),
	false
);

// --- review decision links are read-only until a confirmation POST ----------
const reviewRequest = extract('review-action', 'validate query');
const reviewParams = (request) => run(reviewRequest, request)[0].json;
const signedFields = {
	submission_id: 's1',
	decision: 'approve',
	exp: '1800000000',
	sig: 'a'.repeat(64)
};
check(
	'a crafted confirmed query on the GET link stays read-only',
	reviewParams({
		_review_request: 'link',
		query: { ...signedFields, confirmed: 'yes' }
	}).confirmed,
	'no'
);
check(
	'the marked confirmation POST can proceed',
	reviewParams({
		_review_request: 'confirm',
		body: { ...signedFields, confirmed: 'yes' }
	}).confirmed,
	'yes'
);
check(
	'a confirmation POST without the explicit field stays read-only',
	reviewParams({ _review_request: 'confirm', body: signedFields }).confirmed,
	'no'
);

// --- view: gate --------------------------------------------------------------
const gate = extract('review-action', 'view: gate');
const gr = (row) =>
	new Function('$input', '$json', '$', gate)({ first: () => ({ json: row }) }, row, () => ({}))[0]
		.json;
check(
	'view: pending_review is actionable',
	gr({ submission_id: 's1', status: 'pending_review' }).ok,
	'yes'
);
check(
	'view: approval_failed is actionable',
	gr({ submission_id: 's1', status: 'approval_failed' }).ok,
	'yes'
);
check('view: approved is not actionable', gr({ submission_id: 's1', status: 'approved' }).ok, 'no');
check(
	'view: an active claim is not actionable',
	gr({ submission_id: 's1', status: 'reviewing-1-999999999999' }).ok,
	'no'
);
check('view: missing row is not actionable', gr({}).ok, 'no');

// --- view: build page — XSS -------------------------------------------------
// The page renders submitter-controlled strings in a browser. Every one of
// these must come back escaped, never as live markup.
// Generated member JSON must match the repository formatter exactly.
const stripMember = extract('review-action', 'approve: strip fields (allowlist)');
const generatedMember = (entry) => {
	const row = {
		submission_id: 's-format',
		node_id: '',
		source_url: 'https://example.com/',
		verification_token: 'token',
		entry: JSON.stringify(entry)
	};
	const generated = { id: `${entry.type}-format-test`, creator_id: null };
	const $ = (name) =>
		name === 'get submission row'
			? { first: () => ({ json: row }) }
			: { first: () => ({ json: generated }) };
	const result = new Function('$input', '$json', '$', '$execution', stripMember)({}, generated, $, {
		id: '99'
	})[0].json;
	return Buffer.from(result.memberContentB64, 'base64').toString('utf8');
};
const memberFormatCases = [
	{
		creator: 'Key Jay',
		type: 'audio',
		form: 'music',
		why: 'A submission with enough short tags to reproduce PR #9.',
		tags: ['vgm', 'orchestra', 'hip-hop', 'r&b', 'edm', 'house'],
		tracks: [
			{ label: 'Should I Stay', media_url: 'https://example.com/should-i-stay.mp3' },
			{ label: 'Other Promise', media_url: 'https://example.com/other-promise.mp3' }
		]
	},
	{
		creator: 'Short Text',
		type: 'text',
		why: 'Exercises excerpt objects, including one with audio_url omitted.',
		tags: ['essay'],
		excerpts: [
			{ text: 'One short sample.' },
			{ text: 'Another short sample.', audio_url: 'https://example.com/reading.mp3' }
		]
	},
	{
		creator: 'Long Text',
		type: 'text',
		why: 'Exercises a long string value nested in an object that must wrap at the repository width.',
		tags: ['writing'],
		excerpts: [{ text: 'x'.repeat(120) }, { text: 'y'.repeat(120) }]
	},
	{
		creator: 'Panel Maker',
		type: 'comic',
		why: 'Exercises arrays containing objects.',
		tags: ['comic'],
		pages: [{ image_url: 'https://example.com/page-one.png', caption: 'Page one' }]
	},
	{
		creator: 'Studio North',
		type: 'art',
		why: 'Exercises artwork objects and optional metadata.',
		tags: ['painting'],
		artworks: [{ image_url: 'https://example.com/work.webp', alt: 'A blue figure.', year: '2026' }]
	},
	{
		creator: 'Pocket Arcade',
		type: 'game',
		why: 'Exercises distinct preview and trailer fields.',
		tags: ['game'],
		thumb_url: 'https://example.com/shot.webp',
		preview_url: 'https://example.com/teaser.mp4',
		trailer_url: 'https://youtu.be/dQw4w9WgXcQ'
	}
];
for (const entry of memberFormatCases) {
	const member = generatedMember(entry);
	const formatted = await format(member, { parser: 'json', useTabs: true, printWidth: 100 });
	check(`generated ${entry.type} member is canonical Prettier JSON`, member, formatted);
}
// The canonical ring.schema.json requires verification_token. Omitting it
// (830395f) made every approval a PR that failed validate:publish -- ring PR #30.
check(
	'generated member carries the row verification_token',
	JSON.parse(generatedMember(memberFormatCases[0])).verification_token,
	'token'
);
check(
	'generated audio member keeps its declared form -- the allowlist must not silently drop it',
	generatedMember(memberFormatCases[0]).includes('"form": "music"'),
	true
);
check(
	'generated short tags use the compact form that PR #9 requires',
	generatedMember(memberFormatCases[0]).includes(
		'"tags": ["vgm", "orchestra", "hip-hop", "r&b", "edm", "house"]'
	),
	true
);

const page = extract('review-action', 'view: build page');
const prun = (row) => {
	const $ = (name) =>
		name === 'get submission row'
			? { first: () => ({ json: row }) }
			: {
					first: () => ({
						json: {
							approve_sig: 'a'.repeat(64),
							reject_sig: 'b'.repeat(64),
							exp: 1800000000
						}
					})
				};
	const shadow = DENIED.map(
		(g) => `const ${g} = new Proxy({}, { get(){ throw new ReferenceError("${g}"); } });`
	).join('\n');
	return new Function('$input', '$json', '$', `${shadow}\n${page}`)({}, {}, $)[0].json.html;
};
const evil = {
	submission_id: 's1',
	node_id: '',
	source_url: 'https://example.com/',
	entry: JSON.stringify({
		type: 'audio',
		form: '<script>alert(4)</script>',
		creator: '<script>alert(1)</script>',
		why: 'w',
		tags: ['"><img src=x onerror=alert(2)>'],
		thumb_url: '"><script>alert(3)</script>',
		tracks: [{ label: '<b>x</b>', media_url: 'https://example.invalid/a.mp3' }]
	}),
	review: JSON.stringify({ email: 'a@b.co', rights_confirmation: true, eula_agreement: true })
};
const html = prun(evil);
check(
	'XSS: raw <script> from creator does not appear',
	html.includes('<script>alert(1)</script>'),
	false
);
check('XSS: creator is present in escaped form', html.includes('&lt;script&gt;'), true);
check(
	'XSS: raw onerror payload from tag does not appear',
	html.includes('onerror=alert(2)>'),
	false
);
check(
	'XSS: raw payload from thumb_url does not appear',
	html.includes('"><script>alert(3)</script>'),
	false
);
check(
	'XSS: an out-of-enum form value is dropped entirely, not just escaped',
	html.includes('alert(4)'),
	false
);
check(
	'A form outside the enum reads as "not set" in the checklist',
	html.includes('not set'),
	true
);

const artHtml = prun({
	submission_id: 'art1',
	node_id: '',
	source_url: 'https://example.com/',
	type: 'art',
	entry: JSON.stringify({
		type: 'art',
		creator: 'Studio North',
		why: 'Small works in large weather.',
		tags: ['painting'],
		artworks: [
			{
				image_url: 'https://example.com/work.webp',
				alt: '<b>A blue figure.</b>',
				title: '<script>Night Signal</script>',
				year: '2026',
				medium: 'Digital painting'
			}
		]
	}),
	review: JSON.stringify({ email: 'a@b.co', rights_confirmation: true, eula_agreement: true })
});
check('Art review renders the artwork section', artHtml.includes('Artworks'), true);
check(
	'Art review escapes artwork alt text',
	artHtml.includes('&lt;b&gt;A blue figure.&lt;/b&gt;'),
	true
);
check('Art review escapes artwork title', artHtml.includes('<script>Night Signal</script>'), false);
check('XSS: track label is escaped, not live markup', html.includes('<b>x</b>'), false);

const removalHtml = prun({
	submission_id: 'remove1',
	node_id: 'audio-key-jay',
	source_url: 'https://keyjay.neocities.org/',
	type: 'audio',
	entry: '{}',
	review: JSON.stringify({ mode: 'remove', reason: '<b>Leaving the ring</b>' })
});
check(
	'removal review identifies the request kind',
	removalHtml.includes('Voluntary removal request'),
	true
);
check('removal review identifies the node', removalHtml.includes('audio-key-jay'), true);
check('removal review shows the stored member type', removalHtml.includes('Current type'), true);
check(
	'removal review shows the verified source',
	removalHtml.includes('https://keyjay.neocities.org/'),
	true
);
check(
	'removal review uses the explicit approval label',
	removalHtml.includes('Approve removal'),
	true
);
check(
	'removal review does not claim an email exists',
	removalHtml.includes('There is no submitter email'),
	true
);
check(
	'removal reason is escaped',
	removalHtml.includes('&lt;b&gt;Leaving the ring&lt;/b&gt;'),
	true
);
check(
	'removal reason is never rendered as markup',
	removalHtml.includes('<b>Leaving the ring</b>'),
	false
);
check(
	'view page puts both signed actions directly in POST forms',
	(html.match(/method="post"/g) || []).length === 2 &&
		html.includes(`action="${paths.confirm_base}"`) &&
		html.includes('name="decision" value="approve"') &&
		html.includes('name="decision" value="reject"') &&
		html.includes('name="confirmed" value="yes"'),
	true
);
check('review page declares a mobile viewport', html.includes('name="viewport"'), true);
check(
	'review page carries the IndieNodes private-review shell',
	html.includes('brand-mark') && html.includes('Private review') && html.includes('class="panel"'),
	true
);
check(
	'review page supports the app-aligned dark palette',
	html.includes('@media(prefers-color-scheme:dark)') && html.includes('--bg:#0f1420'),
	true
);
check(
	'review actions use explicit labels and retain the destructive warning',
	html.includes('Approve request') &&
		html.includes('Reject request') &&
		html.includes('permanently removes this pending submission'),
	true
);
check(
	'direct review actions carry separate signed decisions',
	html.includes(`name="sig" value="${'a'.repeat(64)}"`) &&
		html.includes(`name="sig" value="${'b'.repeat(64)}"`) &&
		html.includes('name="exp" value="1800000000"'),
	true
);
check('review stylesheet placeholder is fully resolved', html.includes('__REVIEW_STYLE_'), false);
check('review action placeholder is fully resolved', html.includes('__CONFIRM_ACTION_'), false);
check(
	'the review page has no browser confirmation action',
	html.includes('return confirm('),
	false
);

const reviewWebhookShape = JSON.parse(
	execFileSync(
		'python3',
		[
			'-c',
			`
import importlib.util, json
spec = importlib.util.spec_from_file_location("g", "scripts/n8n/build_workflows.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
wf = dict(m.BUILDERS)["review-action"]({})
n = next(n for n in wf["nodes"] if n["name"] == "Webhook Confirm")
print(json.dumps(n["parameters"]))
`
		],
		{ encoding: 'utf8' }
	)
);
check('confirmation webhook only accepts POST', reviewWebhookShape.httpMethod, 'POST');
check('confirmation webhook listens on the declared path', reviewWebhookShape.path, paths.confirm);

const reviewGraph = JSON.parse(
	execFileSync(
		'python3',
		[
			'-c',
			`
import importlib.util, json
spec = importlib.util.spec_from_file_location("g", "scripts/n8n/build_workflows.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
wf = dict(m.BUILDERS)["review-action"]({})
github = [{
    "name": n["name"],
    "method": n["parameters"]["method"],
    "retryOnFail": n.get("retryOnFail"),
    "maxTries": n.get("maxTries"),
    "waitBetweenTries": n.get("waitBetweenTries")
} for n in wf["nodes"] if n["name"].startswith("approve:") and n["type"] == "n8n-nodes-base.httpRequest"]
print(json.dumps({"github": github, "connections": wf["connections"]}))
`
		],
		{ encoding: 'utf8', maxBuffer: 1 << 24 }
	)
);
check('review approval has GitHub calls to exercise', reviewGraph.github.length > 0, true);
check(
	'every read-only review GitHub call retries transient transport failures',
	reviewGraph.github
		.filter((node) => node.method === 'GET')
		.every(
			(node) => node.retryOnFail === true && node.maxTries === 3 && node.waitBetweenTries === 1000
		),
	true
);
check(
	'review GitHub writes are never retried blindly',
	reviewGraph.github
		.filter((node) => node.method !== 'GET')
		.every((node) => node.retryOnFail !== true),
	true
);
check(
	'removal rejection bypasses submitter email and deletes the pending row',
	reviewGraph.connections['decision route'].main[1][0].node === 'reject: is removal?' &&
		reviewGraph.connections['reject: is removal?'].main[0][0].node ===
			'reject: removal delete row' &&
		reviewGraph.connections['reject: is removal?'].main[1][0].node === 'reject: notify submitter',
	true
);
check(
	'approval renders its success page before responding',
	reviewGraph.connections['approve: mark approved + scrub'].main[0][0].node ===
		'approve: build success page' &&
		reviewGraph.connections['approve: build success page'].main[0][0].node === 'respond approved',
	true
);

const styledResponseBodies = JSON.parse(
	execFileSync(
		'python3',
		[
			'-c',
			`
import importlib.util, json
spec = importlib.util.spec_from_file_location("g", "scripts/n8n/build_workflows.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
wf = dict(m.BUILDERS)["review-action"]({})
names = {
    "respond invalid", "respond expired", "respond view unavailable",
    "respond not actionable", "respond rejected", "respond reject failed",
    "respond removal rejected", "respond approved", "respond approval failed"
}
print(json.dumps({n["name"]: n["parameters"]["responseBody"] for n in wf["nodes"] if n["name"] in names}))
`
		],
		{ encoding: 'utf8', maxBuffer: 1 << 24 }
	)
);
for (const [name, body] of Object.entries(styledResponseBodies)) {
	if (name === 'respond approved') continue;
	check(
		`${name} shares the app-aligned review shell`,
		body.includes('--bg:#f7f4ee') && body.includes('Private review'),
		true
	);
}
check(
	'approval response reads pre-rendered HTML instead of parsing the full page as an expression',
	styledResponseBodies['respond approved'],
	'={{ $json.html }}'
);

const successPage = extract('review-action', 'approve: build success page');
const successHtml = new Function('$input', '$json', '$', successPage)({}, {}, () => ({
	first: () => ({ json: { pr_url: 'https://github.com/XTREEMMAK/indienodes/pull/99' } })
}))[0].json.html;
check(
	'approval success page carries the app-aligned shell',
	successHtml.includes('--bg:#f7f4ee'),
	true
);
check('approval success page carries the PR URL', successHtml.includes('/pull/99'), true);
check(
	'approval success page has no unresolved placeholders',
	successHtml.includes('__REVIEW_'),
	false
);

// --- Contact ----------------------------------------------------------------
//
// /contact has no storage, so its failure handling is the inverse of the
// submission pipeline's: there is no row to retry from, and a message that
// does not deliver is gone. These pin the two places that matters -- the bot
// gate must be indistinguishable from a send, and a delivery failure must
// never come back carrying a reference.

const contactValidate = extract('contact', 'validate');
const contactNotify = extract('contact', 'build notification');
const contactFake = extract('contact', 'shape fake success');

const good = {
	name: 'Ada',
	email: 'ada@example.com',
	message: 'Hello there.',
	website: '',
	elapsed_ms: 30000
};
const vc = (over = {}) => run(contactValidate, { body: { ...good, ...over } })[0].json;

check('contact: a valid message routes to send', vc().route, 'send');
check('contact: name survives', vc().name, 'Ada');
check('contact: fields are trimmed', vc({ name: '  Ada  ' }).name, 'Ada');

check('contact: a filled honeypot is dropped', vc({ website: 'bot' }).route, 'dropped');
check('contact: too fast is dropped', vc({ elapsed_ms: 10 }).route, 'dropped');
check(
	'contact: a missing dwell is dropped, not thrown',
	vc({ elapsed_ms: undefined }).route,
	'dropped'
);
// A dropped bot must not learn which field it got wrong.
check(
	'contact: the bot gate runs before validation',
	vc({ website: 'bot', email: '' }).route,
	'dropped'
);

check('contact: a missing message is rejected', vc({ message: '' }).route, 'error');
check('contact: a missing name is rejected', vc({ name: '' }).route, 'error');
check('contact: a malformed address is rejected', vc({ email: 'nope' }).route, 'error');
check('contact: an address with spaces is rejected', vc({ email: 'a b@c.com' }).route, 'error');
check('contact: a plus-addressed email is accepted', vc({ email: 'a+b@c.co.uk' }).route, 'send');
check(
	'contact: an absurd message is rejected rather than truncated',
	vc({ message: 'x'.repeat(20001) }).route,
	'error'
);
check(
	'contact: a long-but-real message is capped, not rejected',
	vc({ message: 'x'.repeat(6000) }).message.length,
	5000
);
check(
	'contact: a non-object body is a client error',
	run(contactValidate, { body: null })[0].json.route,
	'error'
);
check(
	'contact: an array body is a client error',
	run(contactValidate, { body: [] })[0].json.route,
	'error'
);

const note = run(contactNotify, vc())[0].json;
check('contact: the notification carries a reply-to', note.replyTo, 'ada@example.com');
check('contact: the sender is in the body', note.body.includes('ada@example.com'), true);
check('contact: the message is in the body', note.body.includes('Hello there.'), true);
check(
	'contact: a reference is minted',
	typeof note.reference === 'string' && note.reference.length > 6,
	true
);
check('contact: the title names the sender', note.title.includes('Ada'), true);

// The dropped path must be shaped exactly like a real success.
const fakeOut = run(contactFake, {})[0].json;
check('contact: a dropped message still answers ok', fakeOut.ok, true);
check('contact: a dropped message still carries a reference', typeof fakeOut.reference, 'string');

// The one that matters most: nothing was stored, so an undelivered message
// must not be reported as sent.
const contactUndelivered = extract('contact', 'shape undelivered');
const undel = run(contactUndelivered, {})[0].json;
check('contact: an undelivered message is not ok', undel.ok, false);
check('contact: an undelivered message carries no reference', undel.reference, undefined);
check('contact: an undelivered message is retryable', undel.error.retryable, true);

check(
	'sign mode exposes each signed decision for direct POST forms',
	links.approve_sig === 'a'.repeat(64) && links.reject_sig === 'a'.repeat(64),
	true
);

// --- Entry id: the workflow and the browser must agree ----------------------
// These had drifted three ways at once (no Unicode normalisation here, a
// 40-char cap against the browser's 48, and a hard slice against its
// cut-at-a-hyphen), and every divergence produced the same silent failure: the
// creator publishes the embed the form showed them, approval assigns a
// different id, and their site-id matches no member for as long as the entry
// exists. The node now inlines `src/lib/slug.js` itself; this pins that.
const genId = extract('review-action', 'approve: generate id + creator_id');
const idFor = (entry, ring = [], nodeId = '') =>
	run(
		genId,
		{ ring, sha: 'sha' },
		{
			'get submission row': {
				entry: JSON.stringify(entry),
				source_url: 'https://creator.example/',
				node_id: nodeId
			}
		}
	)[0].json.id;

const { entrySlug, uniqueEntryId } = await import('../../src/lib/slug.js');

for (const creator of [
	'Xeno',
	'Sigur Rós',
	'Café Tacvba',
	'Motörhead',
	'The Hollow Moon Recording Collective',
	'Association of Independent Bedroom Producers',
	'A Name With  Odd   Spacing',
	'!!!',
	'日本のバンド'
]) {
	const entry = { type: 'audio', creator };
	check(`id parity with slug.js: ${creator}`, idFor(entry), uniqueEntryId(entry, []));
}

check(
	'id parity holds through a collision suffix',
	idFor({ type: 'audio', creator: 'Xeno' }, [{ id: 'audio-xeno' }]),
	uniqueEntryId({ type: 'audio', creator: 'Xeno' }, ['audio-xeno'])
);
check(
	'the slug rule is inlined, not restated',
	genId.includes(entrySlug.toString().slice(0, 40)),
	true
);

// requested_id pins the id a creator's published embed already carries.
check(
	'a free requested_id is honoured',
	idFor({ type: 'audio', creator: 'Whoever', requested_id: 'audio-already-embedded' }),
	'audio-already-embedded'
);
check(
	'a taken requested_id falls back to deriving one',
	idFor({ type: 'audio', creator: 'Xeno', requested_id: 'audio-taken' }, [{ id: 'audio-taken' }]),
	'audio-xeno'
);
check(
	'a malformed requested_id is refused, not written into a path',
	idFor({ type: 'audio', creator: 'Xeno', requested_id: '../../etc/passwd' }),
	'audio-xeno'
);
check(
	'an update still acts on its stored node_id',
	idFor({ type: 'audio', creator: 'Xeno' }, [], 'audio-existing'),
	'audio-existing'
);

// --- The whole generated workflow, for graph and node-parameter checks --------
function workflow(builder) {
	return JSON.parse(
		execFileSync(
			'python3',
			[
				'-c',
				`
import json, importlib.util
spec = importlib.util.spec_from_file_location("g", "scripts/n8n/build_workflows.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps(dict(m.BUILDERS)["${builder}"]({})))
`
			],
			{ encoding: 'utf8' }
		)
	);
}
const nodeNamed = (wf, name) => wf.nodes.find((n) => n.name === name);
/** Every node reachable from `from`, following only output `index` of `from` itself. */
function reachable(wf, from, index) {
	const seen = new Set();
	const first = (wf.connections[from]?.main?.[index] ?? []).map((t) => t.node);
	const stack = [...first];
	while (stack.length) {
		const n = stack.pop();
		if (seen.has(n)) continue;
		seen.add(n);
		for (const out of wf.connections[n]?.main ?? []) for (const t of out) stack.push(t.node);
	}
	return seen;
}
/** Runs a Code node with several input items and named-node lookups. */
function runItems(js, items, helpers = {}, execution = { id: '1' }) {
	const $input = { first: () => ({ json: items[0] }), all: () => items.map((json) => ({ json })) };
	const $ = (name) => ({
		item: { json: helpers[name] ?? {} },
		first: () => ({ json: helpers[name] ?? {} }),
		all: () => [{ json: helpers[name] ?? {} }]
	});
	const shadow = DENIED.map(
		(g) =>
			`const ${g} = new Proxy({}, { get(){ throw new ReferenceError("${g} is not defined"); } });`
	).join('\n');
	return new Function('$input', '$json', '$', '$execution', `${shadow}\n${js}`)(
		$input,
		items[0],
		$,
		execution
	);
}

const finalizeWf = workflow('finalize-submission');
const reviewWf = workflow('review-action');
const intakeWf = workflow('intake');
const mediaWf = workflow('media-check');

// --- Verification survives the continue path, all the way into the PR --------
// Ring PR #30 (comic-nori-jammy) reached the ring with no verification_token,
// although the creator's page carried a valid tag and verify had passed. Two
// writes caused it: finalize blanked the token as the row entered review, and
// the approval allowlist dropped it. The same blanking also broke the one path
// that continues an already-finalised submission -- a notification_failed
// resume re-verifies against the stored token, which was by then empty.
//
// This walks one row through every Data Table write on that path, applying each
// node's real column values, and checks the member file carries the token that
// `verify` checked.
{
	const CHECKED_TOKEN = '79ca089920914acf2e0b242d93238419';
	const applyUpdate = (row, wf, nodeName) => {
		const values = nodeNamed(wf, nodeName).parameters.columns.value;
		const next = { ...row };
		for (const [k, v] of Object.entries(values))
			next[k] = typeof v === 'string' && v.startsWith('=') ? `<expr:${k}>` : v;
		return next;
	};
	const comicEntry = {
		creator: 'Nori Jammy',
		type: 'comic',
		why: 'Horror cartoonist, musician, and writer from Appalachia.',
		tags: ['horror'],
		pages: [
			{ image_url: 'https://frammyjammy.com/suzu-and-jack/img/comics/pg29.png', caption: 'One' }
		]
	};
	let row = {
		submission_id: 's-continue',
		status: 'verified',
		node_id: '',
		type: 'comic',
		source_url: 'https://frammyjammy.com/suzu-and-jack/',
		verification_token: CHECKED_TOKEN,
		verified_at: new Date().toISOString(),
		expires_at: new Date(Date.now() + 3600e3).toISOString()
	};
	const body = { ...BODY, entry: comicEntry };

	check('continue: finalize accepts the comic', vrun(row, body)[0].json.ok, 'yes');
	row = applyUpdate(row, finalizeWf, 'claim: set pending_review');
	check('continue: entering review keeps the token', row.verification_token, CHECKED_TOKEN);

	// Reviewer notification failed; the submitter presses Submit again.
	row = applyUpdate(row, finalizeWf, 'mark notification_failed');
	const resumed = vrun(row, body)[0].json;
	check('continue: a notification_failed resume is eligible', resumed.ok, 'yes');
	check('continue: the resume re-verifies (never skips)', resumed.skip_reverify, 'no');
	check(
		'continue: the resume re-verifies against the checked token, not an empty one',
		resumed.verification_token,
		CHECKED_TOKEN
	);
	check(
		'continue: re-verify is handed the validated token, not whatever $json holds after the media check',
		nodeNamed(finalizeWf, 'call Re-verify Token v2').parameters.workflowInputs.value
			.verification_token,
		"={{ $('validate + normalize').first().json.verification_token }}"
	);
	row = applyUpdate(row, finalizeWf, 'claim: set pending_review');
	row = { ...row, entry: JSON.stringify(comicEntry) };

	// Approval.
	const generated = { id: 'comic-nori-jammy', creator_id: null };
	const approve = (r) =>
		new Function('$input', '$json', '$', '$execution', stripMember)(
			{},
			generated,
			(name) => ({ first: () => ({ json: name === 'get submission row' ? r : generated }) }),
			{ id: '7' }
		)[0].json;
	const approved = approve(row);
	check('continue: approval builds the member file', approved.ok, 'yes');
	const member = JSON.parse(Buffer.from(approved.memberContentB64, 'base64').toString('utf8'));
	check(
		'continue: the PR member file carries the checked token',
		member.verification_token,
		CHECKED_TOKEN
	);
	check(
		'continue: the token sits beside source_url',
		Object.keys(member).indexOf('verification_token') - Object.keys(member).indexOf('source_url'),
		1
	);

	// A row that lost its token (every row finalised under 830395f) is refused.
	for (const [label, token] of [
		['blank', ''],
		['missing', undefined],
		['not token-shaped', 'abc"def'],
		['over the schema maxLength', 'a'.repeat(201)]
	]) {
		const r = approve({ ...row, verification_token: token });
		check(`approval refuses a ${label} token`, r.ok, 'no');
		check(`approval refusal (${label}) builds no member file`, 'memberContentB64' in r, false);
	}

	// ...and the refusal cannot reach GitHub.
	const refusedPath = reachable(reviewWf, 'approve: verification present?', 1);
	for (const gh of [
		'approve: check existing member file',
		'approve: get main ref',
		'approve: create branch',
		'approve: commit member file',
		'approve: open PR'
	]) {
		check(`missing-token branch never reaches ${gh}`, refusedPath.has(gh), false);
	}
	check(
		'missing-token branch answers the maintainer',
		refusedPath.has('respond approval refused'),
		true
	);
	check(
		'the allowlist feeds the token gate first',
		reviewWf.connections['approve: strip fields (allowlist)'].main[0][0].node,
		'approve: verification present?'
	);

	// The only write that clears the token runs after the PR exists.
	const blanking = [...finalizeWf.nodes, ...reviewWf.nodes]
		.filter((n) => n.parameters?.columns?.value?.verification_token === '')
		.map((n) => n.name);
	check(
		'only the post-PR scrub blanks the token',
		JSON.stringify(blanking),
		'["approve: mark approved + scrub"]'
	);
	check(
		'the scrub is only reachable once the PR was created',
		reachable(reviewWf, 'approve: PR created?', 0).has('approve: mark approved + scrub') &&
			!reachable(reviewWf, 'approve: verification present?', 1).has(
				'approve: mark approved + scrub'
			),
		true
	);
}

// --- Check Media URL: address validation ---------------------------------------
{
	const mediaValidate = extract('media-check', 'validate url');
	const mv = (url, kind = 'image') => {
		const j = run(mediaValidate, { url, kind })[0].json;
		return j.proceed === 'no' ? j.verdict : j.proceed;
	};
	for (const [url, want] of [
		['https://frammyjammy.com/suzu-and-jack/img/comics/pg29.png', 'check_dns'],
		['https://frammyjammy.com/suzu-and-jack/?pg=29#showComic', 'check_dns'],
		['https://cdn.example.com:443/a.webp', 'check_dns'],
		['', 'none'],
		['http://example.com/a.png', 'unsafe_url'],
		['https://example.com:8080/a.png', 'unsafe_url'],
		['https://127.0.0.1/a.png', 'unsafe_url'],
		['https://169.254.169.254/latest/meta-data', 'unsafe_url'],
		['https://localhost/a.png', 'unsafe_url'],
		['https://user@example.com/a.png', 'unsafe_url'],
		['javascript:alert(1)', 'unsafe_url'],
		// The quick first check, one direction only.
		['https://example.com/comic/page-29.html', 'html'],
		['https://example.com/comic/page-29.htm?x=1', 'html']
	]) {
		check(`media validate ${JSON.stringify(url)}`, mv(url), want);
	}
	check('media validate: a literal public IP skips DNS', mv('https://93.184.216.34/a.png'), 'yes');
}

// --- Check Media URL: response classification ---------------------------------
const classifyHead = extract('media-check', 'classify HEAD');
const classifyGet = extract('media-check', 'classify GET');
const mediaResult = extract('media-check', 'result');
const headVerdict = (res, kind = 'image') =>
	run(classifyHead, res, { 'validate url': { kind } })[0].json;
const getVerdict = (res, kind = 'image') =>
	run(classifyGet, res, { 'validate url': { kind } })[0].json.verdict;
{
	const ct = (t) => ({ statusCode: 200, headers: { 'content-type': t } });
	for (const t of [
		'image/png',
		'image/jpeg',
		'image/webp',
		'image/gif',
		'image/avif',
		'IMAGE/PNG; charset=binary'
	]) {
		check(`HEAD ${t} is an image`, headVerdict(ct(t)).verdict, 'ok');
	}
	check(
		'HEAD text/html is a web page',
		headVerdict(ct('text/html; charset=utf-8')).verdict,
		'html'
	);
	check('HEAD xhtml is a web page', headVerdict(ct('application/xhtml+xml')).verdict, 'html');
	check(
		'HEAD application/json is not an image',
		headVerdict(ct('application/json')).verdict,
		'not_image'
	);
	check(
		'HEAD octet-stream is not an image',
		headVerdict(ct('application/octet-stream')).verdict,
		'not_image'
	);
	check('HEAD video/mp4 is not an image field', headVerdict(ct('video/mp4')).verdict, 'not_image');
	check(
		'HEAD video/mp4 is fine for a preview',
		headVerdict(ct('video/mp4'), 'preview').verdict,
		'ok'
	);
	check(
		'HEAD header name is case-insensitive',
		headVerdict({ statusCode: 200, headers: { 'Content-Type': 'image/png' } }).verdict,
		'ok'
	);
	check(
		'HEAD 301 is a redirect',
		headVerdict({ statusCode: 301, headers: {} }).verdict,
		'redirect'
	);
	check(
		'HEAD 404 is unreachable',
		headVerdict({ statusCode: 404, headers: {} }).verdict,
		'unreachable'
	);
	check(
		'HEAD transport error is unreachable',
		headVerdict({ error: 'ETIMEDOUT' }).verdict,
		'unreachable'
	);
	check('HEAD 405 falls back to GET', headVerdict({ statusCode: 405, headers: {} }).decided, 'no');
	check(
		'HEAD 200 with no content type falls back to GET',
		headVerdict({ statusCode: 200, headers: {} }).decided,
		'no'
	);
	check(
		'GET 206 image/jpeg is an image',
		getVerdict({ statusCode: 206, headers: { 'content-type': 'image/jpeg' } }),
		'ok'
	);
	check(
		'GET 200 text/html is a web page',
		getVerdict({ statusCode: 200, headers: { 'content-type': 'text/html' } }),
		'html'
	);
	check(
		'GET 200 with no content type is not an image',
		getVerdict({ statusCode: 200, headers: {} }),
		'not_image'
	);
	check('GET 403 is unreachable', getVerdict({ statusCode: 403, headers: {} }), 'unreachable');
	check('GET transport error is unreachable', getVerdict({ error: 'ECONNRESET' }), 'unreachable');

	const res = (verdict, trigger = {}) =>
		runItems(mediaResult, [{ verdict }], { Trigger: trigger })[0].json;
	check('result: ok passes', res('ok').ok, 'yes');
	check('result: none passes', res('none').ok, 'yes');
	check('result: html is refused', res('html').ok, 'no');
	check(
		'result: a missing verdict fails closed',
		runItems(mediaResult, [{}], { Trigger: {} })[0].json.ok,
		'no'
	);
	check(
		'result: carries the field back',
		res('html', { field: 'pages.0.image_url' }).field,
		'pages.0.image_url'
	);
	check('result: never returns a content type', 'content_type' in res('ok'), false);
}

// --- Check Media URL against real HTTP responses --------------------------------
// The two URLs from ring PR #30, served for real: the reader page as HTML, the
// page image as a PNG. Their HEAD (and, for a host that refuses HEAD, ranged
// GET) responses are shaped the way n8n's HTTP Request node returns them and
// walked through the helper's own classifiers. The address guard is covered
// above; a loopback test server is exactly what it must refuse, so it is not
// in this path.
{
	const PNG = Buffer.from(
		'89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
			'1f15c4890000000d49444154789c6360000000000200015e27d1c20000000049454e44ae426082',
		'hex'
	);
	const server = http.createServer((req, res) => {
		const path = req.url.split('?')[0];
		if (path === '/suzu-and-jack/') {
			res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
			return res.end(
				req.method === 'HEAD'
					? undefined
					: '<!doctype html><title>Suzu and Jack</title><img src="img/comics/pg29.png">'
			);
		}
		if (path === '/suzu-and-jack/img/comics/pg29.png') {
			res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length });
			return res.end(req.method === 'HEAD' ? undefined : PNG);
		}
		if (path === '/no-head/pg30.webp') {
			if (req.method === 'HEAD') {
				res.writeHead(405);
				return res.end();
			}
			const ranged = req.headers.range === 'bytes=0-1023';
			res.writeHead(ranged ? 206 : 200, { 'content-type': 'image/webp' });
			return res.end(PNG.subarray(0, 8));
		}
		if (path === '/no-head/reader') {
			if (req.method === 'HEAD') {
				res.writeHead(405);
				return res.end();
			}
			res.writeHead(200, { 'content-type': 'text/html' });
			return res.end('<!doctype html>');
		}
		res.writeHead(404);
		res.end();
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const base = `http://127.0.0.1:${server.address().port}`;
	const envelope = async (method, url, headers = {}) => {
		try {
			const r = await fetch(url, { method, headers, redirect: 'manual' });
			await r.arrayBuffer();
			return { statusCode: r.status, headers: Object.fromEntries(r.headers) };
		} catch (e) {
			return { error: String(e) };
		}
	};
	// The helper's HEAD -> (fallback GET) -> result sequence.
	const probe = async (url, field = 'pages.0.image_url') => {
		const head = headVerdict(await envelope('HEAD', url));
		const verdict =
			head.decided === 'yes'
				? head.verdict
				: getVerdict(await envelope('GET', url, { Range: 'bytes=0-1023' }));
		return runItems(mediaResult, [{ verdict }], {
			Trigger: { field, label: 'Page 1 image', kind: 'image' }
		})[0].json;
	};

	const page = await probe(`${base}/suzu-and-jack/?pg=29#showComic`);
	check('real HTTP: the reader page URL is refused', page.ok, 'no');
	check('real HTTP: the reader page is identified as a web page', page.verdict, 'html');
	const image = await probe(`${base}/suzu-and-jack/img/comics/pg29.png`);
	check('real HTTP: the page image URL is accepted', image.ok, 'yes');
	check('real HTTP: the page image verdict', image.verdict, 'ok');
	check(
		'real HTTP: a HEAD-refusing image passes via ranged GET',
		(await probe(`${base}/no-head/pg30.webp`)).ok,
		'yes'
	);
	check(
		'real HTTP: a HEAD-refusing page is still a page',
		(await probe(`${base}/no-head/reader`)).verdict,
		'html'
	);
	check(
		'real HTTP: a missing image is unreachable',
		(await probe(`${base}/missing.png`)).verdict,
		'unreachable'
	);
	server.close();
}

// --- Finalize and approval: every media field is checked, and a page refuses ----
{
	const listJs = extract('finalize-submission', 'media: list urls');
	const verdictJs = extract('finalize-submission', 'media: verdict');
	const list = (entry) =>
		runItems(listJs, [{}], { 'validate + normalize': { entry } }).map((i) => i.json);

	// The payload ring PR #30 actually carried.
	const pr30 = {
		type: 'comic',
		pages: [29, 28, 27].map((n) => ({
			image_url: `https://frammyjammy.com/suzu-and-jack/?pg=${n}#showComic`
		})),
		thumb_url: 'https://frammyjammy.com/graphics/bg-art/rainbow-baby-blue.png'
	};
	const items = list(pr30);
	check(
		'list: every comic page and the cover are checked',
		items.map((i) => i.field).join(','),
		'pages.0.image_url,pages.1.image_url,pages.2.image_url,thumb_url'
	);
	check('list: pages are image fields', items[0].kind, 'image');
	check(
		'list: a game preview may be a video',
		list({ preview_url: 'https://e.com/p.mp4' })[0].kind,
		'preview'
	);
	check(
		'list: artworks are checked',
		list({ artworks: [{ image_url: 'https://e.com/a.png' }] })[0].field,
		'artworks.0.image_url'
	);
	check(
		'list: an entry with no media still yields one empty item',
		JSON.stringify(list({ type: 'audio' }).map((i) => i.url)),
		'[""]'
	);
	check(
		'list: an oversized payload is flagged, not fanned out',
		list({
			pages: Array.from({ length: 50 }, (_, i) => ({ image_url: `https://e.com/${i}.png` }))
		})[0].too_many,
		'yes'
	);

	const verdict = (results, tooMany = false) =>
		runItems(verdictJs, results, { 'media: list urls': tooMany ? { too_many: 'yes' } : {} })[0]
			.json;
	const refused = verdict([
		{ ok: 'no', verdict: 'html', field: 'pages.0.image_url', label: 'Page 1 image', kind: 'image' },
		{ ok: 'yes', verdict: 'ok', field: 'thumb_url', label: 'Cover image', kind: 'image' }
	]);
	check('verdict: a web page refuses the submission', refused.ok, 'no');
	check('verdict: the refusal code names a web page', refused.error_code, 'media_web_page');
	check('verdict: the refusal names the field', refused.field, 'pages.0.image_url');
	check(
		'verdict: the message says it is a web page',
		/Page 1 image looks like a web page, not an image/.test(refused.error_message),
		true
	);
	check(
		'verdict: the message says how to fix it',
		refused.error_message.includes('"Copy image address"'),
		true
	);
	check(
		'verdict: all images pass',
		verdict([
			{ ok: 'yes', verdict: 'ok' },
			{ ok: 'yes', verdict: 'none' }
		]).ok,
		'yes'
	);
	check(
		'verdict: a helper error item fails closed',
		verdict([{ error: 'sub-workflow failed' }]).error_code,
		'media_unreachable'
	);
	check('verdict: no results fails closed', verdict([]).ok, 'no');
	check(
		'verdict: too many urls is invalid',
		verdict([{ ok: 'yes', verdict: 'none' }], true).error_code,
		'invalid_request'
	);

	// shape error forwards the specific message and field to the form.
	const shapeError = nodeNamed(finalizeWf, 'shape error').parameters.jsCode;
	const shaped = runItems(shapeError, [refused])[0].json.error;
	check('shape error: forwards the media message', shaped.message, refused.error_message);
	check('shape error: forwards the field', shaped.field, 'pages.0.image_url');
	check('shape error: a page is not retryable as-is', shaped.retryable, false);
	check(
		'shape error: other codes keep their fixed message',
		runItems(shapeError, [{ error_code: 'rate_limited' }])[0].json.error.message,
		'Please wait before submitting again.'
	);

	// Graph: finalize cannot skip the check, and a refusal claims nothing.
	check(
		'finalize: eligibility leads straight to the media check',
		finalizeWf.connections['eligible?'].main[0][0].node,
		'media: list urls'
	);
	check(
		'finalize: the check runs once per media field',
		nodeNamed(finalizeWf, 'media: check each').parameters.mode,
		'each'
	);
	check(
		'finalize: a helper failure stays on the one output',
		nodeNamed(finalizeWf, 'media: check each').onError,
		'continueRegularOutput'
	);
	const finRefused = reachable(finalizeWf, 'media: all images?', 1);
	check('finalize: a media refusal claims no row', finRefused.has('claim: stamp marker'), false);
	check(
		'finalize: a media refusal re-verifies nothing',
		finRefused.has('call Re-verify Token v2'),
		false
	);
	check('finalize: a media refusal answers', finRefused.has('shape error'), true);
	check(
		'finalize: passing media continues to re-verify',
		finalizeWf.connections['media: all images?'].main[0][0].node,
		'skip re-verify?'
	);

	// Approval re-runs the same check before any GitHub call.
	check(
		'approval: lists the same fields',
		extract('review-action', 'approve: list media urls').includes('function mediaUrls(entry)'),
		true
	);
	const apRefused = reachable(reviewWf, 'approve: media are images?', 1);
	check('approval: a media refusal never opens a PR', apRefused.has('approve: open PR'), false);
	check(
		'approval: a media refusal answers the maintainer',
		apRefused.has('respond approval refused'),
		true
	);
	check(
		'approval: passing media reaches GitHub',
		reviewWf.connections['approve: media are images?'].main[0][0].node,
		'approve: check existing member file'
	);
	const refusalMsg = extract('review-action', 'approve: refusal message');
	check(
		'approval: refusal message is escaped for the page',
		runItems(refusalMsg, [{ error_message: 'a "<b>"' }])[0].json.message,
		'a &quot;&lt;b&gt;&quot;'
	);
}

// --- Intake: check_media_url -----------------------------------------------------
{
	const route = (body) => run(intakeValidate, { body })[0].json.route;
	check(
		'intake: check_media_url routes to the media branch',
		route({
			action: 'check_media_url',
			url: 'https://e.com/a.png',
			website: '',
			elapsed_ms: 20000
		}),
		'media'
	);
	check(
		'intake: check_media_url is bot-gated',
		route({
			action: 'check_media_url',
			url: 'https://e.com/a.png',
			website: 'spam',
			elapsed_ms: 20000
		}),
		'dropped'
	);
	const prep = extract('intake', 'media: prep');
	const prepRoute = (b) => run(prep, { body: b })[0].json.route;
	check(
		'intake: media prep accepts an image url',
		prepRoute({ url: 'https://e.com/a.png' }),
		'ready'
	);
	check('intake: media prep refuses an empty url', prepRoute({ url: '' }), 'error');
	check(
		'intake: media prep refuses an unknown kind',
		prepRoute({ url: 'https://e.com/a.png', kind: 'audio' }),
		'error'
	);
	check(
		'intake: media prep refuses an oversized url',
		prepRoute({ url: 'https://e.com/' + 'a'.repeat(2100) }),
		'error'
	);
	const shape = extract('intake', 'media: shape');
	const shaped = run(shape, { ok: 'no', verdict: 'html', field: 'x', label: 'y' })[0].json;
	check('intake: media shape answers with the verdict', shaped.verdict, 'html');
	check('intake: media shape says not accepted', shaped.accepted, false);
	check(
		'intake: media shape leaks nothing else',
		JSON.stringify(Object.keys(shaped).sort()),
		'["accepted","ok","verdict"]'
	);
	const routeIdx = intakeWf.nodes
		.find((n) => n.name === 'route')
		.parameters.rules.values.findIndex((r) => r.conditions.conditions[0].rightValue === 'media');
	check(
		'intake: the media rule is wired to media prep',
		intakeWf.connections.route.main[routeIdx][0].node,
		'media: prep'
	);
	check(
		'media helper: every path ends at result',
		['HEAD decided?', 'safe to fetch?'].every(
			(n) => reachable(mediaWf, n, 0).has('result') && reachable(mediaWf, n, 1).has('result')
		),
		true
	);
	check(
		'media helper: redirects are never followed',
		mediaWf.nodes
			.filter((n) => n.type === 'n8n-nodes-base.httpRequest')
			.every((n) => n.parameters.options.redirect.redirect.followRedirects === false),
		true
	);
	check(
		'media helper: the fallback GET asks for one small range',
		nodeNamed(mediaWf, 'GET media (ranged)').parameters.headerParameters.parameters[0].value,
		'bytes=0-1023'
	);
}

// --- Email: no n8n attribution footer ---------------------------------------------
// n8n appends its own footer to every Send Email node unless told not to. Set
// only in the UI, it came back on every --push; --check-drift compares code
// nodes and cannot see it, so it is pinned here instead.
{
	const emailNodes = ['finalize-submission', 'review-action', 'contact'].flatMap((b) =>
		workflow(b)
			.nodes.filter((n) => n.type === 'n8n-nodes-base.emailSend')
			.map((n) => ({ b, n }))
	);
	check('email: all four Send Email nodes are covered', emailNodes.length, 4);
	for (const { b, n } of emailNodes) {
		check(
			`email: ${b} / ${n.name} has attribution off`,
			n.parameters.options?.appendAttribution,
			false
		);
	}
}

console.log(`\n  ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
