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
	entry: { creator: 'C', type: 'audio', why: 'w', tags: ['t'] },
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
check(
	'generated member omits the temporary verification token',
	generatedMember(memberFormatCases[0]).includes('verification_token'),
	false
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

console.log(`\n  ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
