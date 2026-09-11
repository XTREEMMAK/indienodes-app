<script>
	/**
	 * How to get into the ring.
	 *
	 * This page used to document opening a pull request, behind a notice
	 * saying the real submission form was unbuilt. This is that form, and the
	 * cutover is deliberate and immediate: `open-questions.md` settled that
	 * the PR and issue paths are retired the moment the form ships rather than
	 * running alongside it, so there is one documented way in and nothing to
	 * keep in sync.
	 *
	 * The sidebar is a stepper, not a table of contents. The flow has a real
	 * sequence in it (a token has to be issued before it can be placed, and
	 * placed before it can be verified), so later steps stay visible and
	 * disabled rather than hidden: the shape of the whole thing is legible
	 * from the first screen, which is the part that makes a six-step form feel
	 * finite.
	 *
	 * The reference tables that used to be their own tabs are still here, as
	 * collapsed help beside the fields they explain. They were good reference
	 * and bad instructions; nobody reads a field table before filling in a
	 * form, but they do open one when a specific field confuses them.
	 */
	import { scrollAffordance } from '$lib/scrollAffordance.js';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import GlassPanel from '../../components/GlassPanel.svelte';
	import FormField from '../../components/FormField.svelte';
	import StepProgress from '../../components/StepProgress.svelte';
	import Modal from '../../components/Modal.svelte';
	import EulaContent from '../../components/legal/EulaContent.svelte';
	import Honeypot from '../../components/Honeypot.svelte';
	import ExactDataDisclosure from '../../components/ExactDataDisclosure.svelte';
	import { SITE_ORIGIN } from '$lib/config.js';
	import { ringStore } from '$lib/ringStore.svelte.js';
	import { hasBackend, useMock } from '$lib/submissionApi.js';
	import { RING_REPO_URL, EARLY_ACCESS } from '$lib/config.js';
	import { flyFade, outFade } from '$lib/transitions.js';
	import { submissionStore as form, STEPS } from '$lib/submissionStore.svelte.js';
	import { rightsSectionApplies } from '$lib/submissionValidation.js';
	import { PRO_OPTIONS } from '$lib/submissionValidation.js';
	import { uniqueEntryId } from '$lib/slug.js';
	import {
		WIDGET_TIERS,
		badgeStylesFor,
		embedHtmlFor,
		widgetPreviewHtml
	} from '$lib/widgetTiers.js';
	import { generatorDraftStore } from '$lib/generator/generatorDraftStore.svelte.js';
	import { TEMPLATES, loadTemplate } from '$lib/generator/registry.js';
	import { buildGeneratorData } from '$lib/generator/data.js';
	import { toDataUrl } from '$lib/generator/assets.js';
	import { resolveTemplateOptions } from '$lib/generator/templateOptions.js';
	import TextSampleEditor from '../../components/TextSampleEditor.svelte';
	import SiteBuildGraphic from '../../components/SiteBuildGraphic.svelte';
	import { stripHtml } from '$lib/ring.js';
	import { exportSite } from '$lib/generator/zipExport.js';
	import { uid } from '$lib/uid.js';
	import { socialIcon } from '$lib/generator/templates/shared.js';
	import { createNewRowFocus, focusHeading } from '$lib/formRowFocus.svelte.js';
	import JoinMediaStep from './JoinMediaStep.svelte';
	import JoinEntryStep from './JoinEntryStep.svelte';

	const { mark: markNewRow, scrollNewRowIntoView } = createNewRowFocus();

	// Tag suggestions and the provisional id both need the ring; neither is
	// required for the form to work, so a failed load degrades to "no
	// suggestions" rather than blocking anything.
	onMount(() => ringStore.ensureLoaded());

	// The generator draft is a second, independent store (see
	// generatorDraftStore.svelte.js) because IndexedDB is the only place in
	// this app that can hold the actual Blobs a no-site creator uploads; it
	// has to be loaded explicitly, unlike submissionStore's own localStorage
	// draft which is ready synchronously on mount.
	onMount(() => {
		generatorDraftStore.load();
	});

	const entry = $derived(form.entry);
	const review = $derived(form.review);
	const generator = $derived(generatorDraftStore.generator);

	/** Labelled as provisional in the UI: the real one is assigned at approval. */
	const provisionalId = $derived(
		entry.creator && entry.type
			? uniqueEntryId(
					entry,
					ringStore.entries.map((e) => e.id)
				)
			: ''
	);

	/**
	 * The generator's own templates embed a real, working ring link in their
	 * footer by default (see `widgetEmbedHtml` in `templates/shared.js`) —
	 * the /join form used to only ever *tell* a creator to paste this
	 * themselves; a generated export can just do it. `provisionalId` is the
	 * best id available at generation time, same as the review step already
	 * shows it: not final until approval, but right in the common case, and
	 * a creator can always edit the embedded `site-id` by hand afterward the
	 * same way they could paste a corrected snippet in by hand today.
	 *
	 * Tier defaults to the full widget (`generator.widgetTier` starts unset),
	 * matching the behaviour this had before tiers existed at all, so a
	 * creator who never touches the new "Ring embed" field on the site step
	 * gets exactly what they always got.
	 */
	const generatorWidgetEmbed = $derived(
		embedHtmlFor({
			tier: generator.widgetTier ?? 'widget',
			badgeStyle: generator.badgeStyle ?? 'classic',
			origin: SITE_ORIGIN,
			siteId: provisionalId || undefined,
			entryType: entry.type
		})
	);

	/**
	 * The same embed, pointed at wherever this page itself is actually
	 * running rather than the real `SITE_ORIGIN` — used only by the live
	 * preview below, never by the real export. The exported zip has to use
	 * the real origin (it is uploaded to someone else's host and has to
	 * reach back to the live site for the script or the badge image), but
	 * the preview is an iframe on this same page, and pointing it at
	 * production instead of `page.url.origin` meant every preview tried to
	 * fetch `/embed.v1.js` or `/badges/*.svg` from `indienodes.us` — a real
	 * network request a local dev server has no reason to depend on, and one
	 * that renders nothing at all, with no visible error, if that domain
	 * hasn't caught up with a change yet or isn't reachable from wherever
	 * this is being worked on.
	 */
	const previewWidgetEmbed = $derived.by(() => {
		const tier = generator.widgetTier ?? 'widget';
		// Both widget tiers (the sandboxed iframe and the advanced script) get
		// the same static stand-in here; see widgetPreviewHtml's own doc
		// comment for why neither's real embed is worth loading inside this
		// already-sandboxed preview. `generatorWidgetEmbed` above is what the
		// export actually writes, so the downloaded site still carries the
		// real, working embed either way. The badge and text tiers are an
		// <img> and an <a>, which the sandbox is happy with, so those preview
		// as themselves.
		if (tier === 'widget' || tier === 'widget-script') return widgetPreviewHtml();
		return embedHtmlFor({
			tier,
			badgeStyle: generator.badgeStyle ?? 'classic',
			origin: page.url.origin,
			siteId: provisionalId || undefined,
			entryType: entry.type
		});
	});

	/**
	 * The success screen's own tier picker, for a creator with an existing
	 * site (the `has_own_site !== 'no'` branch below): this choice only ever
	 * decides which snippet is shown to copy, so it lives as local view
	 * state rather than in `generatorDraftStore` (that store is scoped to
	 * the generator, which this creator never used).
	 */
	let successTier = $state(
		/** @type {'widget' | 'widget-script' | 'badge' | 'text-link'} */ ('widget')
	);
	let successBadgeStyle = $state('classic');
	const successSnippet = $derived(
		embedHtmlFor({
			tier: successTier,
			badgeStyle: successBadgeStyle,
			origin: SITE_ORIGIN,
			siteId: provisionalId || undefined,
			entryType: entry.type
		})
	);

	/**
	 * Renders the exact embed markup inside a small isolated document. The
	 * preview points at this deployment rather than production for the same
	 * reason the page-generator preview above does: local and test builds
	 * should exercise their own embed bundle and badge assets.
	 *
	 * Both widget tiers stand in for themselves the same way
	 * `previewWidgetEmbed` above already does, and for the same reason: the
	 * script tier always fetches in CORS mode, which a sandboxed opaque
	 * origin can never satisfy, and the iframe tier means nesting a real
	 * cross-origin frame inside this already-sandboxed preview, which is not
	 * a mechanism worth relying on just to preview an appearance. Skipping
	 * this here (as this function used to) only ever worked because these
	 * three iframes still carried `allow-same-origin`, restoring a real
	 * origin the module script's fetch could complete against — masking the
	 * gap rather than not having it.
	 * @param {'widget' | 'widget-script' | 'badge' | 'text-link'} tier
	 * @param {string} [badgeStyle]
	 */
	function successPreviewSrcdoc(tier, badgeStyle = 'classic') {
		const embed =
			tier === 'widget' || tier === 'widget-script'
				? widgetPreviewHtml()
				: embedHtmlFor({
						tier,
						badgeStyle,
						origin: page.url.origin,
						siteId: provisionalId || undefined,
						entryType: entry.type
					});
		return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; }
body {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 12px;
	background: #f7f4ee;
	color: #221f1a;
	font-family: ui-sans-serif, system-ui, sans-serif;
}
a { color: #b5502f; font-weight: 700; text-align: center; }
@media (prefers-color-scheme: dark) {
	body { background: #171411; color: #f1ede4; }
	a { color: #e08a5f; }
}
</style>
</head>
<body>${embed}</body>
</html>`;
	}

	/**
	 * The generated page's social links: repeatable rows on the `site` step.
	 *
	 * Read into an explicitly-typed local before `.map`/`.filter` rather than
	 * calling them on the loosely-typed store value directly — an inline
	 * `@type` cast on an arrow function's own parameter is an idiom Svelte's
	 * compiler mishandles in `.svelte` files.
	 * @typedef {{ uid: string, label: string, url: string, showLabel?: boolean }} SocialLinkRow
	 */

	function addSocialLink() {
		const row = { uid: uid(), label: '', url: '' };
		/** @type {SocialLinkRow[]} */
		const socialLinks = [...(generator.socialLinks ?? []), row];
		generatorDraftStore.save({ generator: { socialLinks } });
		markNewRow(row.uid);
	}

	/** @param {string} uid */
	function removeSocialLink(uid) {
		/** @type {SocialLinkRow[]} */
		const current = generator.socialLinks ?? [];
		generatorDraftStore.save({ generator: { socialLinks: current.filter((s) => s.uid !== uid) } });
	}

	/**
	 * @param {string} uid
	 * @param {Record<string, any>} patch
	 */
	function updateSocialLink(uid, patch) {
		/** @type {SocialLinkRow[]} */
		const current = generator.socialLinks ?? [];
		const socialLinks = current.map((s) => (s.uid === uid ? { ...s, ...patch } : s));
		generatorDraftStore.save({ generator: { socialLinks } });
	}

	/**
	 * A step change no longer moves the viewport: the panel is a fixed-height
	 * box now (see `.join-page`'s CSS), not something that can scroll into
	 * view. Focus takes over the job scrollIntoView used to do: it moves
	 * attention (and, for a screen reader, the reading position) to the new
	 * step's own heading. See `focusHeading` below for how.
	 * @param {string} id
	 */
	function goTo(id) {
		form.step = id;
	}

	/**
	 * A row an "Add a track" / "Add a page" / "Add a link" button just
	 * created. Every one of those buttons appends to an array that already
	 * has rows above it, inside `.step-body`'s own scroll region (see
	 * `.join-page`'s CSS): a new row lands wherever flow puts it, which on a
	 * step with a few existing rows is routinely below the fold. Nothing
	 * about clicking a plain `<button>` scrolls anything into view on its
	 * own — that is a Playwright convenience during automated testing, not
	 * real browser behavior — so without this, "Add" reads as doing nothing
	 * at all: a row was created, but the only feedback of that is invisible
	 * until the visitor scrolls down looking for it.
	 */

	/**
	 * The `site` step only applies to a no-site entry; filtering it out of
	 * both the sidebar's own list and next/back's step-to-step walk here is
	 * what keeps the two in agreement automatically, rather than the
	 * sidebar's numbering and the actual navigation order being two
	 * separately-maintained ideas of "which steps exist right now."
	 */
	const visibleSteps = $derived(STEPS.filter((s) => !s.applicable || s.applicable(entry)));

	const stepIndex = $derived(visibleSteps.findIndex((s) => s.id === form.step));

	function next() {
		const target = visibleSteps[stepIndex + 1];
		if (target) goTo(target.id);
	}

	function back() {
		const target = visibleSteps[stepIndex - 1];
		if (target) goTo(target.id);
	}

	/**
	 * Whether `visibleSteps[index]` is a step the submitter could actually
	 * have reached by clicking Continue that many times in a row from the
	 * start — every step strictly before it is complete. Reused for two
	 * things: gating the progress bar's own click-to-jump (`goToIndex`
	 * below), and building the `reachable` array the bar renders locked
	 * steps from, so what's clickable and what merely looks clickable never
	 * disagree.
	 * @param {number} index
	 */
	function stepReachable(index) {
		for (let i = 0; i < index; i++) {
			if (!form.isStepComplete(visibleSteps[i].id)) return false;
		}
		return true;
	}

	const reachableSteps = $derived(visibleSteps.map((_, i) => stepReachable(i)));

	/**
	 * The progress bar's own click handler. Going backward to an
	 * already-visited step is always allowed (nothing about revisiting
	 * filled-in fields needs gating); going forward is capped at
	 * `stepReachable`, the same bar Continue itself enforces one step at a
	 * time — so jumping via the bar can reach anywhere Continue could have
	 * gotten you, and nowhere Continue couldn't have.
	 * @param {number} index
	 */
	function goToIndex(index) {
		const target = visibleSteps[index];
		if (!target) return;
		if (index > stepIndex && !stepReachable(index)) return;
		goTo(target.id);
	}

	/** Whether the current step's own fields are satisfied. */
	const canAdvance = $derived(form.isStepComplete(form.step));

	/**
	 * Human text for a verification that ran and came back negative.
	 *
	 * Every reason the backend can actually send (`docs/n8n-workflow-runbook.md`
	 * §6) needs its own line here. This map used to cover three of the five —
	 * `expired` and `redirect` fell through to `''`, which this button renders
	 * as nothing at all, so a creator whose page redirected or whose token had
	 * timed out saw Verify silently reset with no explanation. `not_https` was
	 * dead code: the backend has never sent that string, only `unsafe_url`.
	 */
	const verifyMessage = $derived(
		{
			expired:
				'That token expired before we could check it. Generate a new one and try again — the window is short on purpose.',
			unsafe_url:
				'We could not safely check that address. Make sure it is a plain https:// link with no login or credentials baked in.',
			redirect:
				"That address redirects somewhere else, and we deliberately don't follow redirects. Use the final page it lands on instead — the exact URL your browser shows once it stops moving.",
			unreachable: 'We could not load that page at all. Check it is public and not behind a login.',
			token_not_found:
				'We reached the page, but the token was not on it yet. If you just added it, give your host a moment to publish and try again.'
		}[form.verifyFailure] ??
			(form.verifyFailure
				? 'We could not verify that page. Please try again; if this keeps happening, contact us.'
				: '')
	);

	// ---------------------------------------------------------- the `site` step, generator UI --

	const templateOptions = $derived(
		TEMPLATES[/** @type {keyof typeof TEMPLATES} */ (entry.type)] ?? []
	);

	/** Falls back to the first available template for the type, so a preview always has one selected. */
	const selectedTemplateId = $derived(generator.templateId || templateOptions[0]?.id || '');

	/** @param {string} id */
	function selectTemplate(id) {
		generatorDraftStore.save({ generator: { templateId: id } });
	}

	/**
	 * What the selected template lets a creator change, declared by the
	 * template rather than branched on here. This replaced a chain of
	 * `{#if selectedTemplateId === '...'}` blocks in the markup below, which
	 * is why one template had a page background and a card surface and the
	 * other twenty had neither.
	 *
	 * A picker's displayed value falls back to the template's own default,
	 * because a native `<input type="color">` always shows some color and
	 * cannot be genuinely empty. The draft stays unset until the creator
	 * actually touches the field, so an untouched picker means "no override,"
	 * not "override with this exact shade."
	 */
	const customization = $derived(resolveTemplateOptions(selectedTemplateId));
	const chosenColors = $derived(generator.colors ?? {});
	const chosenOptions = $derived(generator.options ?? {});

	/**
	 * Colour choices reach the draft — and so the live preview — on a short
	 * idle rather than on every `input` event.
	 *
	 * A native colour picker fires continuously while a swatch is dragged,
	 * and each event re-ran the whole template render into the preview
	 * iframe, so choosing a colour meant watching the page thrash. The
	 * control itself stays immediate: `pendingColors` holds what was just
	 * picked so the input never fights the drag by being re-rendered from a
	 * value that has not caught up yet.
	 */
	const COLOR_COMMIT_MS = 250;
	/** @type {Record<string, string>} */
	let pendingColors = $state({});
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let colorCommitTimer;

	/** What the pickers display: committed values, with anything mid-drag on top. */
	const displayColors = $derived({ ...chosenColors, ...pendingColors });

	/** @param {string} key @param {string} value */
	function setColor(key, value) {
		pendingColors = { ...pendingColors, [key]: value };
		clearTimeout(colorCommitTimer);
		colorCommitTimer = setTimeout(() => {
			generatorDraftStore.save({
				generator: { colors: { ...(generator.colors ?? {}), ...pendingColors } }
			});
			pendingColors = {};
		}, COLOR_COMMIT_MS);
	}

	// A tab closed mid-drag would otherwise leave the last pick uncommitted.
	$effect(() => () => clearTimeout(colorCommitTimer));

	/** @param {string} key @param {boolean | number} value */
	function setOption(key, value) {
		generatorDraftStore.saveNow({ generator: { options: { ...chosenOptions, [key]: value } } });
	}

	/**
	 * Typed copy, committed when the field is done being typed in.
	 *
	 * This used to commit on a short idle, the same as a colour drag. An idle
	 * is the wrong signal for typing: it fires in the pauses *within* writing,
	 * so a full template render into the preview iframe lands in the gaps
	 * between words and the field stutters under the person using it. Blur is
	 * the signal that actually means finished.
	 *
	 * Colours and the range controls keep the idle deliberately. A drag has no
	 * meaningful blur until it is over, and seeing the colour change as you
	 * move the picker is the point of it.
	 * @type {Record<string, string>}
	 */
	let pendingTexts = $state({});

	const displayTexts = $derived({ ...chosenOptions, ...pendingTexts });

	/** @param {string} key @param {string} value */
	function setTextOption(key, value) {
		pendingTexts = { ...pendingTexts, [key]: value };
	}

	function commitTextOptions() {
		if (!Object.keys(pendingTexts).length) return;
		generatorDraftStore.save({
			generator: { options: { ...(generator.options ?? {}), ...pendingTexts } }
		});
		pendingTexts = {};
	}

	/**
	 * Plain generator fields — the display name — committed on blur.
	 *
	 * Each feeds the preview, and the preview is a full template render into an
	 * iframe, so committing per keystroke rebuilt the page under someone
	 * mid-word. An idle timer only moved that into the pauses between words,
	 * which is why typing still felt like it was fighting back. The controls
	 * stay immediate through `displayFields`, which is what they read.
	 * @type {Record<string, string>}
	 */
	let pendingFields = $state({});

	/**
	 * The bio is staged, not debounced.
	 *
	 * Every other field here commits on a short idle, which is right for a
	 * colour drag or a display name: they are small edits whose result you want
	 * to see. A bio is a paragraph, and re-rendering the whole template into an
	 * iframe every time the writer pauses to think puts the page in motion
	 * underneath them for the entire time they are composing. So it holds until
	 * the dialog closes, and the preview redraws once, with the finished text.
	 *
	 * `null` means nothing is staged, which is distinct from a staged empty
	 * string — that is someone deleting their bio, and it has to commit.
	 * @type {string | null}
	 */
	let pendingBio = $state(null);

	/**
	 * The staged bio joins the other pending fields rather than being merged in
	 * separately, so `displayFields` keeps the one shape it always had.
	 * @type {Record<string, string>}
	 */
	const stagedFields = $derived(
		pendingBio === null ? pendingFields : { ...pendingFields, bio: pendingBio }
	);

	const displayFields = $derived({ ...generator, ...stagedFields });

	/**
	 * Commits on any close, not only on Done: Escape and a backdrop click both
	 * end the dialog too, and there is no Cancel here to mean "discard". Losing
	 * a paragraph to the wrong dismissal is far worse than committing one
	 * someone meant to abandon, which they can still delete.
	 */
	function commitBio() {
		if (pendingBio === null) return;
		generatorDraftStore.save({ generator: { bio: pendingBio } });
		pendingBio = null;
	}

	function closeBioEditor() {
		commitBio();
		bioEditorOpen = false;
	}

	/** @param {string} key @param {string} value */
	function setGeneratorField(key, value) {
		pendingFields = { ...pendingFields, [key]: value };
	}

	function commitGeneratorFields() {
		if (!Object.keys(pendingFields).length) return;
		generatorDraftStore.save({ generator: { ...pendingFields } });
		pendingFields = {};
	}

	/**
	 * Social-link rows, staged per uid the same way the other typed fields
	 * above are: `updateSocialLink` used to write straight to the store on
	 * every keystroke, which fed the same live preview effect as everything
	 * else here and re-rendered the whole template into the iframe mid-word.
	 * `displaySocialLinks` keeps typing feeling immediate without touching the
	 * store — and so without touching the preview — until blur.
	 * @type {Record<string, Partial<SocialLinkRow>>}
	 */
	let pendingSocialLinks = $state({});

	/**
	 * @param {SocialLinkRow[] | undefined} links
	 * @param {Record<string, Partial<SocialLinkRow>>} pending
	 */
	function mergeSocialLinks(links, pending) {
		/** @type {SocialLinkRow[]} */
		const current = links ?? [];
		return current.map((s) => (pending[s.uid] ? { ...s, ...pending[s.uid] } : s));
	}

	const displaySocialLinks = $derived(mergeSocialLinks(generator.socialLinks, pendingSocialLinks));

	/**
	 * @param {string} uid
	 * @param {Record<string, any>} patch
	 */
	function setSocialLinkField(uid, patch) {
		pendingSocialLinks = {
			...pendingSocialLinks,
			[uid]: { ...pendingSocialLinks[uid], ...patch }
		};
	}

	function commitSocialLinks() {
		if (!Object.keys(pendingSocialLinks).length) return;
		const socialLinks = mergeSocialLinks(generator.socialLinks, pendingSocialLinks);
		generatorDraftStore.save({ generator: { socialLinks } });
		pendingSocialLinks = {};
	}

	/**
	 * Nothing staged may be lost to a route change, a collapsed sidebar or a
	 * closed dialog, none of which blur a field first.
	 */
	$effect(() => () => {
		commitGeneratorFields();
		commitTextOptions();
		commitBio();
		commitSocialLinks();
	});

	/** The exact `{html,css,js}` the chosen template produces for the current draft, live. */
	let previewDoc = $state(
		/** @type {{ html: string, css: string, js: string, pages?: Record<string, string> } | null} */ (
			null
		)
	);
	let previewTemplateError = $state('');
	let previewTemplateLoading = $state(false);

	/**
	 * Preview assets are `data:` URIs, not object URLs.
	 *
	 * The preview iframe below is sandboxed without `allow-same-origin`, so it
	 * has an opaque origin and cannot fetch a blob URL minted by this document
	 * — every uploaded cover, page, artwork and screenshot came back blank,
	 * and an image that fails inside a sandboxed frame reports nothing the
	 * creator would ever see. See `toDataUrl` in generator/assets.js for why
	 * loosening the sandbox instead is the wrong repair.
	 *
	 * Encoding is async while `buildGeneratorData` resolves assets
	 * synchronously, so every blob is encoded up front and handed to it as a
	 * finished lookup. Keyed by Blob identity: two works can hold the same
	 * file, and encoding it twice would put two copies in the document.
	 */
	$effect(() => {
		const type = entry.type;
		const templateId = selectedTemplateId;
		const snapshot = {
			...generator,
			verificationToken: form.token || 'preview-token',
			widgetEmbed: previewWidgetEmbed
		};
		let active = true;
		previewDoc = null;
		previewTemplateError = '';
		previewTemplateLoading = true;

		const blobs = [
			generator.icon,
			...(generator.works ?? []).map((/** @type {{ file?: Blob }} */ w) => w?.file)
		].filter(/** @returns {file is Blob} */ (file) => file instanceof Blob);

		Promise.all([
			loadTemplate(type, templateId),
			Promise.all([...new Set(blobs)].map(async (blob) => [blob, await toDataUrl(blob)]))
		])
			.then(([template, encoded]) => {
				if (!active) return;
				if (!template) throw new Error(`No template available for type "${type}".`);
				const urls = new Map(/** @type {[Blob, string][]} */ (encoded));
				previewDoc = template.render(
					buildGeneratorData(entry, snapshot, (file) =>
						file instanceof Blob ? (urls.get(file) ?? null) : null
					)
				);
			})
			.catch((error) => {
				if (!active) return;
				previewTemplateError =
					error instanceof Error ? error.message : 'The template preview could not be loaded.';
			})
			.finally(() => {
				if (active) previewTemplateLoading = false;
			});
		return () => {
			active = false;
		};
	});

	// A literal opening or closing tag for this HTML element cannot appear
	// anywhere in this file's script block, including inside an ordinary
	// string argument or even a "//" comment: both Svelte's own compiler and
	// a browser's HTML parser scan for that exact substring to find where a
	// tag starts or ends, without knowing or caring that it is sitting
	// inside quotes. The tag name is assembled from separate character
	// pieces below for exactly that reason, everywhere it is needed.
	const TAG = 's' + 'cript';
	const SCRIPT_OPEN_TAG = `<${TAG}>`;
	const SCRIPT_CLOSE_TAG = `<${'/' + TAG}>`;
	const SCRIPT_SRC_TAG = `<${TAG} src="script.js">${SCRIPT_CLOSE_TAG}`;

	/**
	 * Which page of the export the preview is showing. A template can emit
	 * more than `index.html` — the text templates put the portrait and bio on
	 * an About page — and those would otherwise be invisible until download,
	 * since a `srcdoc` iframe has no other file to navigate to.
	 */
	let previewPage = $state('index.html');
	const previewPages = $derived(
		previewDoc
			? [{ name: 'index.html', label: 'Home', html: previewDoc.html }].concat(
					Object.entries(previewDoc.pages ?? {}).map(([name, html]) => ({
						name,
						label: name.replace(/\.html$/, '').replace(/^\w/, (c) => c.toUpperCase()),
						html
					}))
				)
			: []
	);

	// A template with no About page must not leave the preview pointed at one
	// that no longer exists.
	$effect(() => {
		if (!previewPages.some((page) => page.name === previewPage)) previewPage = 'index.html';
	});

	/** Inlines {html, css, js} into one document, the same way the template review used for this project was built. */
	const previewSrcdoc = $derived.by(() => {
		const page = previewPages.find((candidate) => candidate.name === previewPage);
		if (!previewDoc || !page) return '';
		return page.html
			.replace('<link rel="stylesheet" href="styles.css" />', `<style>${previewDoc.css}</style>`)
			.replace(
				SCRIPT_SRC_TAG,
				previewDoc.js ? `${SCRIPT_OPEN_TAG}${previewDoc.js}${SCRIPT_CLOSE_TAG}` : ''
			);
	});

	let exporting = $state(false);
	/** @type {string} */
	let exportMessage = $state('');
	let exportNeedsReload = $state(false);
	// The generator's editor: settings and live preview on one surface.
	// `editorSettingsOpen` collapses the sidebar so the preview can have the
	// whole dialog, which is the reason the two were brought together.
	let editorOpen = $state(false);
	let editorSettingsOpen = $state(true);
	let bioEditorOpen = $state(false);

	/** Plain text of the stored bio, for the sidebar's one-line summary. */
	const bioPlainText = $derived(stripHtml(displayFields.bio ?? '').trim());

	// --- full-screen preview -------------------------------------------------
	//
	// The Fullscreen API where it exists, and a fixed overlay where it does
	// not: iOS Safari refuses to fullscreen a non-video element, the same
	// constraint ambient view already works around. Either way the class does
	// the visual work, so the two paths cannot drift apart.
	/** @type {HTMLElement | undefined} */
	let stageEl = $state();
	let previewFullscreen = $state(false);

	function togglePreviewFullscreen() {
		if (previewFullscreen) {
			if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
			previewFullscreen = false;
			return;
		}
		previewFullscreen = true;
		stageEl?.requestFullscreen?.().catch(() => {
			// Left as the overlay fallback; nothing else to do.
		});
	}

	$effect(() => {
		function syncFullscreen() {
			// Only follow the browser *out* of fullscreen. Entering via the
			// fallback never sets `fullscreenElement`, so treating its absence
			// as "not fullscreen" unconditionally would close the overlay the
			// moment it opened.
			if (!document.fullscreenElement && previewFullscreen && stageEl?.requestFullscreen) {
				previewFullscreen = false;
			}
		}
		document.addEventListener('fullscreenchange', syncFullscreen);
		return () => document.removeEventListener('fullscreenchange', syncFullscreen);
	});
	let eulaModalOpen = $state(false);

	async function onExportSite() {
		if (exporting) return;
		exporting = true;
		exportMessage = '';
		exportNeedsReload = false;
		try {
			// The token has to exist and be embedded in the export before the
			// creator ever uploads it anywhere (submission-form-spec.md
			// section 4's sequence) — generate one now if this is the first
			// export attempt, rather than requiring a separate "get my token"
			// step the no-site branch has no other use for.
			if (!form.token) await form.requestToken();
			if (form.error) throw form.error;

			const result = await exportSite(entry, {
				...generator,
				verificationToken: form.token,
				widgetEmbed: generatorWidgetEmbed,
				provisionalId
			});
			form.recordExport(result.assetPaths);

			const url = URL.createObjectURL(result.zip);
			const link = document.createElement('a');
			link.href = url;
			link.download = result.filename;
			link.click();
			URL.revokeObjectURL(url);
			exportMessage =
				'Downloaded. Upload the contents of the zip to your chosen host, then continue.';
		} catch (e) {
			// A dynamically-imported module (jszip, loaded only on this page —
			// see zipExport.js's own doc comment for why) failing to fetch is
			// almost always a stale dev-server module-cache, not a real
			// problem with the export itself: worth naming plainly rather than
			// surfacing whatever raw wording the browser used for it.
			const message = e instanceof Error ? e.message : '';
			exportNeedsReload = /dynamically imported module|Outdated Optimize Dep/i.test(message);
			exportMessage = exportNeedsReload
				? 'Could not load the export tool. This is a one-time dev hiccup — reloading picks up correctly, and nothing you have filled in is lost.'
				: message || 'Could not build the export.';
		} finally {
			exporting = false;
		}
	}

	// -------------------------------------------------- `verify` step, no-site branch only --

	let sourceUrlDraft = $state('');

	async function onBindSourceUrl() {
		if (!sourceUrlDraft.trim()) return;
		await form.bindSourceUrl(sourceUrlDraft.trim());
		if (!form.error) await form.runVerify();
	}
</script>

<svelte:head>
	<title>Join the ring, IndieNodes</title>
</svelte:head>

<div
	class="join-page"
	class:builder-active={form.step === 'site'}
	class:entry-preview-active={form.step === 'entry'}
>
	<h1 class="page-title">Join the ring</h1>

	{#if !hasBackend && !useMock}
		<!-- A production build with no webhook configured. Saying so is the
		     whole point: a form that accepts input and drops it is worse than
		     no form, and this is the one state where that could happen.

		     It used to call the service "unavailable" and ask people to check
		     back, which described an outage. This flag is not an outage: it is
		     false only when VITE_SUBMISSION_WEBHOOK_URL was unset at *build*
		     time, so it means this deployment has no submission backend at all
		     — the ordinary state for a fork that has not stood up n8n. A
		     configured webhook that fails is a different path entirely, and
		     that one reports itself through WebhookError at request time.

		     Telling a fork's visitors to check back sent them waiting for
		     something that was never coming, and never mentioned the route
		     that does work here. -->
		<div class="interim-note">
			<p>
				<strong>This ring isn't taking submissions through this form.</strong> No submission service
				is configured for it, so nothing you type here would be sent anywhere.
				{#if RING_REPO_URL}
					Entries are curated directly instead: open a pull request adding your entry to
					<code>members/</code> in
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external repository from config.js, not an app route -->
					<a href={RING_REPO_URL} target="_blank" rel="noopener noreferrer"
						>this ring's repository</a
					>, and a maintainer reviews it there.
				{/if}
			</p>
		</div>
	{:else if useMock}
		<div class="interim-note">
			<p>
				<strong>Development mode.</strong> No submission backend is configured, so this form is
				running against canned responses and nothing is sent anywhere. Add
				<code>?mock=fail-verify</code>, <code>network</code>, <code>rate-limited</code>, or
				<code>slow</code> to the URL to exercise the failure states.
			</p>
		</div>
	{/if}

	{#if form.reference}
		<!-- Success is its own screen rather than a seventh step: the stepper
		     is for work still to do, and there is none left. -->
		<GlassPanel class="done-panel">
			<div class="success-heading" role="status">
				<span class="success-check" aria-hidden="true">
					<svg viewBox="0 0 48 48" width="48" height="48">
						<circle class="success-check-circle" cx="24" cy="24" r="22" />
						<path class="success-check-path" d="m14 24 7 7 14-15" />
					</svg>
				</span>
				<h2>Request Submitted!</h2>
			</div>
			<p>
				A person reviews every submission before it appears; we will email you either way. Nothing
				about your entry is public until then.
			</p>
			<p class="reference-block">
				<span class="reference-label">Your reference</span>
				<code class="reference-code">{form.reference}</code>
			</p>
			{#if entry.has_own_site === 'no'}
				{@const chosenTier =
					WIDGET_TIERS.find((t) => t.id === (generator.widgetTier ?? 'widget'))?.label ??
					'Full widget'}
				<h3>One last thing: the ring embed</h3>
				<p>
					Your {chosenTier.toLowerCase()} is already in your generated page's footer, site-id and all
					— nothing left to paste. It will link to your actual neighbours once your entry is live.
				</p>
				<div class="success-single-preview">
					<iframe
						class="success-preview-frame"
						title="{chosenTier} preview"
						tabindex="-1"
						sandbox="allow-scripts allow-popups allow-downloads"
						srcdoc={successPreviewSrcdoc(
							generator.widgetTier ?? 'widget',
							generator.badgeStyle ?? 'classic'
						)}
					></iframe>
				</div>
				<p class="note">
					{#if (generator.widgetTier ?? 'widget') === 'widget'}
						It runs in a sandboxed frame with no access to your page: it cannot read your page's
						content, cookies, or storage, and your stylesheet cannot restyle it.
					{:else if generator.widgetTier === 'widget-script'}
						It is a self-contained custom element in its own shadow root: it cannot restyle your
						page and your stylesheet cannot restyle it.
					{:else}
						It is a plain link{generator.widgetTier === 'badge' ? ' and a small image' : ''},
						nothing more.
					{/if}
					No tracking, no cookies, no analytics.
					<a href={resolve('/widget')}>See the full widget running</a>.
				</p>
			{:else}
				<h3>One last thing: the ring embed</h3>
				<p>
					Pick what you'd like to paste onto your site. All four link back to the ring the same way;
					this only changes how much room it takes.
				</p>
				<p class="note">
					It needs to go on <code>{entry.source_url || 'the page you gave us'}</code> — that's where visitors
					arrive, so that's where the link onward has to be. Anywhere else as well is up to you.
				</p>
				<div class="success-tier-grid" role="radiogroup" aria-label="Ring embed style">
					{#each WIDGET_TIERS as tier (tier.id)}
						<label class="success-tier-card" class:selected={successTier === tier.id}>
							<input
								class="success-card-radio"
								type="radio"
								name="success_widget_tier"
								value={tier.id}
								checked={successTier === tier.id}
								onchange={() => (successTier = tier.id)}
							/>
							<span class="success-tier-copy">
								<strong>{tier.label}</strong>
								<small>{tier.description}</small>
							</span>
							<span class="success-preview-shell" aria-hidden="true">
								<iframe
									class="success-preview-frame"
									title="{tier.label} preview"
									tabindex="-1"
									sandbox="allow-scripts allow-popups allow-downloads"
									srcdoc={successPreviewSrcdoc(tier.id, successBadgeStyle)}
								></iframe>
							</span>
						</label>
					{/each}
				</div>
				{#if successTier === 'badge'}
					<div class="success-badge-grid" role="radiogroup" aria-label="Badge design">
						{#each badgeStylesFor(entry.type) as style (style.id)}
							<label class="success-badge-card" class:selected={successBadgeStyle === style.id}>
								<input
									class="success-card-radio"
									type="radio"
									name="success_badge_style"
									value={style.id}
									checked={successBadgeStyle === style.id}
									onchange={() => (successBadgeStyle = style.id)}
								/>
								<span class="success-badge-copy">
									<strong>{style.label}</strong>
									<small>{style.description}</small>
								</span>
								<span class="success-preview-shell compact" aria-hidden="true">
									<iframe
										class="success-preview-frame"
										title="{style.label} badge preview"
										tabindex="-1"
										sandbox="allow-scripts allow-popups allow-downloads"
										srcdoc={successPreviewSrcdoc('badge', style.id)}
									></iframe>
								</span>
							</label>
						{/each}
					</div>
				{/if}
				<p>
					Paste this wherever you would like it on your site. It will link to your actual neighbours
					once your entry is live.
				</p>
				<pre><code>{successSnippet}</code></pre>
				<p class="note">
					{#if successTier === 'widget'}
						It runs in a sandboxed frame with no access to your page: it cannot read your page's
						content, cookies, or storage, and your stylesheet cannot restyle it.
					{:else if successTier === 'widget-script'}
						It is a self-contained custom element in its own shadow root: it cannot restyle your
						page and your stylesheet cannot restyle it.
					{:else}
						It is a plain link{successTier === 'badge' ? ' and a small image' : ''}, nothing more.
					{/if}
					No tracking, no cookies, no analytics.
					<a href={resolve('/widget')}>See the full widget running</a>.
				</p>
			{/if}
			<button
				type="button"
				class="btn btn-primary submit-again-button"
				onclick={() => form.reset()}
			>
				Submit another entry
			</button>
		</GlassPanel>
	{:else}
		<div class="join-layout">
			<!-- Horizontal, not the vertical sidebar this used to be: same
			     particle-progress mechanic as lbhq's own request form
			     (src/lib/components/StepProgress.svelte there), ported into
			     this project's own component with this app's own palette.
			     Click-to-jump, same as the original sidebar was, but gated
			     by stepReachable: a step ahead of what Continue would have
			     let through stays visible (the whole point of the bar is
			     showing the shape of what's left) but not an actual target,
			     so jumping via the bar can reach anywhere Continue could
			     have gotten you, and nowhere it couldn't. -->
			<StepProgress
				step={stepIndex}
				total={visibleSteps.length}
				labels={visibleSteps.map((s) => s.label)}
				reachable={reachableSteps}
				onStepClick={goToIndex}
			/>

			<div class="panel" id="join-panel">
				<!-- The step-switch itself, keyed on form.step, crossfades
				     rather than jump-cutting: same in/out pair and parameter
				     shape as the route transition in +layout.svelte and
				     FieldNode's card crossfade, so this reads as the same
				     motion language as the rest of the app rather than a
				     one-off. `.step-body` gets its own overflow-y: this is the
				     one mechanism that makes "steps shouldn't need to scroll"
				     and "consent is the deliberate exception" the same rule:
				     short steps never show a scrollbar, consent's legal text
				     is simply the one case expected to need it. -->
				{#key form.step}
					<div
						use:scrollAffordance
						class="step-body"
						in:flyFade={{ x: 20, duration: 280, delay: 90 }}
						out:outFade={{ duration: 180 }}
					>
						{#if form.step === 'prep'}
							<h2 tabindex="-1" use:focusHeading>Before you start</h2>
							<!-- Ahead of the practical "here is what this costs you"
							     paragraph, because someone who arrived from an
							     Early Access chip is deciding whether to join at all
							     before they care how long the form takes.

							     It states the two things the framing raises and
							     otherwise leaves ambiguous: that "founding" costs
							     nothing (the word is strongly associated with paid
							     membership tiers, and an unanswered "founding
							     member" reads as a pitch about to arrive), and that
							     a person reviews submissions -- which is already
							     true of the queue behind this form, and is the part
							     that makes a small curated ring worth being in. -->
							{#if EARLY_ACCESS}
								<p class="interim-note">
									<strong>IndieNodes is in Early Access.</strong> The ring is still being built, so you'd
									be joining as a founding creator. It's free, there's no membership tier, and a person
									reviews every submission before it joins the ring — which also means it isn't instant.
								</p>
							{/if}
							<p>
								This takes about five minutes. Nothing is saved on a server until you press submit
								at the end, and your progress is kept in this browser if you need to step away.
							</p>
							<h3>A few things you'll need:</h3>
							<ul class="checklist">
								<li>
									<svg
										class="checklist-icon"
										viewBox="0 0 24 24"
										width="22"
										height="22"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										aria-hidden="true"
									>
										<rect x="3" y="4" width="18" height="16" rx="2" />
										<path d="M3 9h18" stroke-linecap="round" />
									</svg>
									<span>
										<strong>A page you control.</strong> Your site, your Neocities, your itch.io page:
										anywhere you can edit the page's actual HTML, not just a bio field.
									</span>
								</li>
								<li>
									<svg
										class="checklist-icon"
										viewBox="0 0 24 24"
										width="22"
										height="22"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										aria-hidden="true"
									>
										<rect x="3" y="4" width="18" height="16" rx="2" />
										<circle cx="9" cy="10" r="1.5" />
										<path
											d="M21 16l-5.5-5.5a2 2 0 0 0-2.8 0L4 19"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
									<span>
										<strong>Somewhere your media already lives — or we'll build you a page.</strong> If
										you already have a site, you'll paste links to files you host. If not, say so on the
										next step, and you'll upload the actual files there instead.
									</span>
								</li>
								<li>
									<svg
										class="checklist-icon"
										viewBox="0 0 24 24"
										width="22"
										height="22"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										aria-hidden="true"
									>
										<rect x="3" y="5" width="18" height="14" rx="2" />
										<path d="M3 7l9 6 9-6" stroke-linecap="round" stroke-linejoin="round" />
									</svg>
									<span>
										<strong>An email address.</strong> Used once, to tell you what happened to this submission,
										then deleted. It is not an account and not a mailing list.
									</span>
								</li>
							</ul>

							<div class="note-panel rules-panel">
								<h3>Content rules</h3>
								<ul class="rules-list">
									<li>You must be the creator of your content and owner of your website.</li>
									<li>
										Your work needs to already exist somewhere a visitor can experience it;
										something to hear, read, look at, or play. It does not need to be popular,
										polished, or commercially released, and it does not need to be finished —
										ongoing comics, serials, and games all count. What does not count on its own is
										a concept, a pitch, a placeholder, or an announced project.
									</li>
									<li>
										Your Node has to be yours: your own practice, or a collective or studio you can
										speak for. Work scraped or republished from elsewhere, or pages produced in
										bulk, is not eligible.
									</li>
									<li>
										This discovery network features indies in the Music, Comics, Manga, Video Games,
										and Writing space. We may expand to other indie creators in the future.
									</li>
									<li>
										While we will accept NSFW content, such content must be clearly labeled on your
										application.
									</li>
									<li>
										No bigots allowed! Your website must not host anything discriminatory, including
										but not limited to: sexism, homophobia, transphobia + TERF ideology, xenophobia,
										ableism, or any other hatred towards minorities.
									</li>
									<li>
										While we do allow works made using AI-assisted tools such as Claude Code,
										content made purely through generative techniques that produce music, art,
										video, or games will not be accepted.
									</li>
									<li>
										While we will do our best to keep the webring functional, please make sure to
										maintain your website and links. If you need a change, please
										<a href={resolve('/update')}>submit an update request</a>. Not doing so risks
										your site being removed from the network.
									</li>
									<li>We reserve the right to remove sites at our discretion.</li>
								</ul>
							</div>

							<div class="actions">
								<button type="button" class="btn btn-primary" onclick={next}>Start</button>
							</div>
						{:else if form.step === 'ownership'}
							<h2 tabindex="-1" use:focusHeading>Do you have a site?</h2>
							<p>
								This changes a few of the steps ahead, so we ask before anything else: who you are,
								what you made, all of that comes next.
							</p>

							<FormField
								id="f-has-site"
								label="Do you already have a site you control?"
								hint="Your own domain, or a page on something like Neocities. If not, we can build you a small one to upload."
								required
								error={form.entryErrors.has_own_site}
							>
								{#snippet children(describedBy)}
									<div class="option-row" aria-describedby={describedBy}>
										<label class="option">
											<input
												type="radio"
												name="has_own_site"
												value="yes"
												checked={entry.has_own_site === 'yes'}
												onchange={() => {
													entry.has_own_site = 'yes';
													form.touch();
												}}
											/>
											<span class="option-label">Yes, I have a site</span>
										</label>
										<label class="option">
											<input
												type="radio"
												name="has_own_site"
												value="no"
												checked={entry.has_own_site === 'no'}
												onchange={() => {
													entry.has_own_site = 'no';
													form.touch();
												}}
											/>
											<span class="option-label">No, build me one</span>
										</label>
									</div>
								{/snippet}
							</FormField>

							{#if entry.has_own_site === 'no'}
								<div class="note-panel" in:flyFade={{ y: 8, duration: 220 }}>
									<p class="note">
										No problem: after the next couple of steps we will build you a small page with
										your work on it. You will upload it somewhere yourself, and link it here once it
										is live.
									</p>
								</div>
							{/if}

							<div class="actions">
								<button type="button" class="btn btn-ghost" onclick={back}>Back</button>
								<button type="button" class="btn btn-primary" disabled={!canAdvance} onclick={next}>
									Continue
								</button>
							</div>
						{:else if form.step === 'entry'}
							<JoinEntryStep {canAdvance} onBack={back} onNext={next} />
						{:else if form.step === 'media'}
							<JoinMediaStep {canAdvance} onBack={back} onNext={next} />
						{:else if form.step === 'site'}
							<h2 tabindex="-1" use:focusHeading>Build your page</h2>
							<p>
								A small page with your work on it, built from what you just uploaded. Pick a look,
								then download it and put it up wherever you like.
							</p>

							<div class="builder-launch">
								<div class="builder-launch-copy">
									<h3>One editor, one preview</h3>
									<p>
										Its look, your colours, your bio, your links — all of it is set in the editor,
										beside a live preview of the result. Collapse the settings when you want to see
										the page on its own.
									</p>
									<ul class="builder-launch-points">
										<li>Pick from {templateOptions.length} designs for your type of work</li>
										<li>Your uploads are already in it</li>
										<li>Download it as a folder and host it anywhere</li>
									</ul>
									<button type="button" class="btn btn-primary" onclick={() => (editorOpen = true)}>
										Open the editor
									</button>
								</div>
								<div class="builder-launch-art" aria-hidden="true">
									<SiteBuildGraphic />
								</div>
							</div>

							<!-- Settings and preview share one surface rather than sitting
							     side by side in the step. Split across a narrow column and
							     a narrow preview, neither half had the room to be much use:
							     the preview was too small to judge a page by, and the
							     settings column too cramped to lay a form out in. The modal
							     has the whole viewport, and the sidebar collapses when what
							     you want is the page itself. -->
							<Modal
								open={editorOpen}
								title="Edit your page"
								dialogClass="editor-modal-dialog"
								onClose={() => (editorOpen = false)}
							>
								<div class="editor" class:settings-hidden={!editorSettingsOpen}>
									<aside
										class="editor-settings"
										id="editor-settings"
										aria-label="Page settings"
										inert={!editorSettingsOpen}
									>
										{#if templateOptions.length}
											<div class="template-select-wrap">
												<FormField
													id="f-template"
													label="Page template"
													hint="Switching templates redraws the preview beside this."
												>
													{#snippet children(describedBy)}
														<select
															id="f-template"
															class="control template-select"
															value={selectedTemplateId}
															onchange={(event) => selectTemplate(event.currentTarget.value)}
															aria-describedby={describedBy}
														>
															{#each templateOptions as option (option.id)}
																<option value={option.id}>{option.label}</option>
															{/each}
														</select>
													{/snippet}
												</FormField>
											</div>
										{/if}
										<FormField
											id="f-display-name"
											label="Name to show"
											hint="Defaults to your name or studio from the entry step."
										>
											{#snippet children(describedBy)}
												<input
													id="f-display-name"
													class="control"
													type="text"
													placeholder={entry.creator}
													value={displayFields.displayName ?? ''}
													oninput={(e) =>
														setGeneratorField(
															'displayName',
															/** @type {HTMLInputElement} */ (e.currentTarget).value
														)}
													onblur={commitGeneratorFields}
													aria-describedby={describedBy}
												/>
											{/snippet}
										</FormField>

										<FormField
											id="f-bio"
											label="Bio (optional)"
											hint="A longer introduction for your page. Different from the one-line “why” on your ring card — this can actually breathe."
										>
											{#snippet children(describedBy)}
												<!-- Opened in its own dialog rather than typed into the
												     sidebar. The sidebar is a column of short controls and
												     the bio is the one field here that wants room to read
												     itself back; a five-row textarea in a 24rem column was
												     the worst place on the page to write a paragraph. -->
												<div class="bio-field" aria-describedby={describedBy}>
													{#if bioPlainText}
														<p class="bio-summary">{bioPlainText}</p>
													{:else}
														<p class="bio-summary empty">Nothing written yet.</p>
													{/if}
													<button
														type="button"
														id="f-bio"
														class="btn btn-ghost"
														onclick={() => (bioEditorOpen = true)}
													>
														{bioPlainText ? 'Edit bio' : 'Write a bio'}
													</button>
												</div>
											{/snippet}
										</FormField>

										<!-- One control per option the selected template declares.
									     See `templateOptions.js`: a template says which of its
									     own CSS variables plays each role, so this form never
									     names a variable or branches on a template id. -->
										{#each customization.colors as option (option.key)}
											<FormField
												id="f-color-{option.key}"
												label="{option.label} (optional)"
												hint={option.hint}
											>
												{#snippet children(describedBy)}
													<input
														id="f-color-{option.key}"
														class="control control-color"
														type="color"
														value={displayColors[option.key] ?? option.fallback}
														oninput={(e) =>
															setColor(
																option.key,
																/** @type {HTMLInputElement} */ (e.currentTarget).value
															)}
														aria-describedby={describedBy}
													/>
												{/snippet}
											</FormField>
										{/each}

										{#each customization.switches as option (option.key)}
											<label class="motion-toggle">
												<input
													type="checkbox"
													checked={chosenOptions[option.key] ?? option.fallback}
													onchange={(e) =>
														setOption(
															option.key,
															/** @type {HTMLInputElement} */ (e.currentTarget).checked
														)}
												/>
												<span>
													<strong>{option.label}</strong>
													<small>{option.hint}</small>
												</span>
											</label>
										{/each}

										{#each customization.ranges ?? [] as option (option.key)}
											<FormField id="f-range-{option.key}" label={option.label} hint={option.hint}>
												{#snippet children(describedBy)}
													<input
														id="f-range-{option.key}"
														class="control"
														type="range"
														min={option.min}
														max={option.max}
														step={option.step}
														value={chosenOptions[option.key] ?? option.fallback}
														oninput={(e) =>
															setOption(
																option.key,
																Number(/** @type {HTMLInputElement} */ (e.currentTarget).value)
															)}
														aria-describedby={describedBy}
													/>
												{/snippet}
											</FormField>
										{/each}

										{#each customization.texts ?? [] as option (option.key)}
											<FormField id="f-text-{option.key}" label={option.label} hint={option.hint}>
												{#snippet children(describedBy)}
													<input
														id="f-text-{option.key}"
														class="control"
														type="text"
														maxlength={option.maxLength}
														placeholder={option.fallback}
														value={displayTexts[option.key] ?? ''}
														oninput={(e) =>
															setTextOption(
																option.key,
																/** @type {HTMLInputElement} */ (e.currentTarget).value
															)}
														onblur={commitTextOptions}
														aria-describedby={describedBy}
													/>
												{/snippet}
											</FormField>
										{/each}

										<FormField
											id="f-widget-tier"
											label="Ring embed"
											hint="What gets embedded in your page's footer. All four link back to the ring the same way; this only changes how much room it takes."
										>
											{#snippet children(describedBy)}
												<div class="option-row" aria-describedby={describedBy}>
													{#each WIDGET_TIERS as tier (tier.id)}
														<label class="option">
															<input
																type="radio"
																name="widget_tier"
																value={tier.id}
																checked={(generator.widgetTier ?? 'widget') === tier.id}
																onchange={() =>
																	generatorDraftStore.saveNow({
																		generator: { widgetTier: tier.id }
																	})}
															/>
															<span class="option-label">{tier.label}</span>
														</label>
													{/each}
												</div>
											{/snippet}
										</FormField>

										{#if (generator.widgetTier ?? 'widget') === 'badge'}
											<FormField
												id="f-badge-style"
												label="Badge style"
												hint="Style is presentation only; every style links back to the ring the same way."
											>
												{#snippet children(describedBy)}
													<div class="option-row" aria-describedby={describedBy}>
														{#each badgeStylesFor(entry.type) as style (style.id)}
															<label class="option">
																<input
																	type="radio"
																	name="badge_style"
																	value={style.id}
																	checked={(generator.badgeStyle ?? 'classic') === style.id}
																	onchange={() =>
																		generatorDraftStore.saveNow({
																			generator: { badgeStyle: style.id }
																		})}
																/>
																<span class="option-label">{style.label}</span>
															</label>
														{/each}
													</div>
												{/snippet}
											</FormField>
										{/if}

										<h3>Elsewhere</h3>
										<p class="note">Optional links to anywhere else people can find you.</p>
										{#each displaySocialLinks as social (social.uid)}
											<div class="repeat-row" use:scrollNewRowIntoView={social.uid}>
												<FormField id="f-social-label-{social.uid}" label="Label">
													{#snippet children(describedBy)}
														<input
															id="f-social-label-{social.uid}"
															class="control"
															type="text"
															placeholder="Bandcamp"
															value={social.label}
															oninput={(e) =>
																setSocialLinkField(social.uid, {
																	label: /** @type {HTMLInputElement} */ (e.currentTarget).value
																})}
															onblur={commitSocialLinks}
															aria-describedby={describedBy}
														/>
													{/snippet}
												</FormField>
												<FormField id="f-social-url-{social.uid}" label="Link">
													{#snippet children(describedBy)}
														<input
															id="f-social-url-{social.uid}"
															class="control"
															type="url"
															placeholder="https://"
															value={social.url}
															oninput={(e) =>
																setSocialLinkField(social.uid, {
																	url: /** @type {HTMLInputElement} */ (e.currentTarget).value
																})}
															onblur={commitSocialLinks}
															aria-describedby={describedBy}
														/>
													{/snippet}
												</FormField>
												<label class="social-label-toggle">
													<input
														type="checkbox"
														checked={social.showLabel !== false}
														onchange={(e) =>
															updateSocialLink(social.uid, {
																showLabel: /** @type {HTMLInputElement} */ (e.currentTarget).checked
															})}
													/>
													<span>Show this label on the page</span>
												</label>
												{#if social.label || social.url}
													<p class="social-icon-preview">
														<!-- socialIcon returns only one of the module's static SVG constants. -->
														<!-- eslint-disable-next-line svelte/no-at-html-tags -->
														{@html socialIcon(social.label, social.url)}
														<span>Detected icon</span>
													</p>
												{/if}
												<button
													type="button"
													class="clear-button"
													onclick={() => removeSocialLink(social.uid)}
												>
													Remove
												</button>
											</div>
										{/each}
										<button type="button" class="btn btn-ghost" onclick={addSocialLink}
											>Add a link</button
										>
									</aside>

									<div
										class="editor-stage"
										class:fullscreen={previewFullscreen}
										bind:this={stageEl}
									>
										<div class="editor-toolbar">
											<button
												type="button"
												class="btn btn-ghost"
												aria-expanded={editorSettingsOpen}
												aria-controls="editor-settings"
												onclick={() => (editorSettingsOpen = !editorSettingsOpen)}
											>
												{editorSettingsOpen ? 'Hide settings' : 'Show settings'}
											</button>
											<button type="button" class="btn btn-ghost" onclick={togglePreviewFullscreen}>
												{previewFullscreen ? 'Exit full screen' : 'Full screen'}
											</button>
											{#if previewPages.length > 1}
												<div class="preview-pages" role="group" aria-label="Preview page">
													{#each previewPages as page (page.name)}
														<button
															type="button"
															class="page-tab"
															class:active={previewPage === page.name}
															aria-pressed={previewPage === page.name}
															onclick={() => (previewPage = page.name)}
														>
															{page.label}
														</button>
													{/each}
												</div>
											{/if}
											{#if previewTemplateLoading}
												<p class="note" aria-live="polite">Loading template preview...</p>
											{:else if previewTemplateError}
												<p class="error" role="alert">{previewTemplateError}</p>
											{/if}
										</div>
										<iframe
											class="preview-frame-large"
											title="Live preview of your page"
											sandbox="allow-scripts allow-popups allow-downloads"
											srcdoc={previewSrcdoc}
										></iframe>
									</div>
								</div>
							</Modal>

							<!-- Sibling of the editor dialog rather than nested inside it.
							     Both render at the same layer and the later one paints on
							     top, while nesting would let this dialog's Escape bubble to
							     the editor's own handler and dismiss both at once. -->
							<Modal
								open={bioEditorOpen}
								title="Your bio"
								dialogClass="bio-modal-dialog"
								onClose={closeBioEditor}
							>
								<p class="note">
									A paragraph or two about you and your work. Bold, italic and links are available;
									it appears as one block of prose on your page, so there are no headings.
								</p>
								<div class="bio-editor">
									<TextSampleEditor
										body={generator.bio ?? ''}
										headings={false}
										onUpdate={(html) => (pendingBio = html)}
									/>
								</div>
								<div class="bio-editor-actions">
									<button type="button" class="btn btn-primary" onclick={closeBioEditor}>
										Done
									</button>
								</div>
							</Modal>

							{#if exportMessage}
								<p class="note">{exportMessage}</p>
								{#if exportNeedsReload}
									<button
										type="button"
										class="btn btn-ghost"
										onclick={() => window.location.reload()}
									>
										Reload page
									</button>
								{/if}
							{/if}

							<div class="actions">
								<button type="button" class="btn btn-ghost" onclick={back}>Back</button>
								<button
									type="button"
									class="btn btn-primary"
									disabled={!hasBackend && !useMock}
									onclick={onExportSite}
								>
									{exporting ? 'Building…' : 'Download my page'}
								</button>
								<button type="button" class="btn btn-primary" disabled={!canAdvance} onclick={next}>
									Continue
								</button>
							</div>
						{:else if form.step === 'verify'}
							<h2 tabindex="-1" use:focusHeading>Prove the page is yours</h2>

							{#if entry.has_own_site === 'no'}
								<p>
									This confirms the page you just built and uploaded is really yours. Your token was
									already embedded in it when you downloaded it.
								</p>

								{#if !form.token}
									<p class="note">
										No token yet — go back to the previous step and download your page first.
									</p>
								{:else}
									<FormField
										id="f-source-derived"
										label="Where did you upload it?"
										hint="The address your page is live at now."
										required
									>
										{#snippet children(describedBy)}
											<input
												id="f-source-derived"
												class="control"
												type="url"
												inputmode="url"
												placeholder="https://"
												bind:value={sourceUrlDraft}
												aria-describedby={describedBy}
											/>
										{/snippet}
									</FormField>

									{#if form.verified}
										<p class="verified" role="status">✓ Verified. That page is yours.</p>
									{:else}
										<button
											type="button"
											class="btn btn-primary"
											disabled={form.pending !== 'idle' || !sourceUrlDraft.trim()}
											onclick={onBindSourceUrl}
										>
											{form.pending !== 'idle' ? 'Checking…' : 'Verify'}
										</button>
										{#if verifyMessage}
											<p class="inline-error" role="alert">{verifyMessage}</p>
										{/if}
									{/if}
								{/if}
							{:else}
								<p>
									This is the whole of the ownership check. It confirms that whoever submitted this
									entry can edit <code>{entry.source_url || 'the page you gave'}</code>.
								</p>

								{#if !form.token}
									<p>
										Press below and we will generate a token for you to place. It is tied to the URL
										above, so if you change that later you will need a new one.
									</p>
									<button
										type="button"
										class="btn btn-primary"
										disabled={form.pending !== 'idle'}
										onclick={() => form.requestToken()}
									>
										{form.pending === 'issuing' ? 'Generating…' : 'Generate my token'}
									</button>
								{:else}
									<p>Add this to the page's HTML:</p>
									<pre><code
											>&lt;meta name="indienode-verification" content="{form.token}" /&gt;</code
										></pre>
									<p class="note">
										You can remove it once you are verified. It expires on its own in 24 hours.
									</p>

									{#if form.verified}
										<p class="verified" role="status">✓ Verified. That page is yours.</p>
									{:else}
										<button
											type="button"
											class="btn btn-primary"
											disabled={form.pending !== 'idle'}
											onclick={() => form.runVerify()}
										>
											{form.pending === 'verifying' ? 'Checking…' : 'Verify'}
										</button>
										{#if verifyMessage}
											<p class="inline-error" role="alert">{verifyMessage}</p>
										{/if}
									{/if}
								{/if}
							{/if}

							{#if form.error}
								<p class="inline-error" role="alert">
									{form.error.message}
									{#if form.error.retryable}
										<button type="button" class="clear-button" onclick={() => form.clearError()}>
											Try again
										</button>
									{/if}
								</p>
							{/if}

							<div class="actions">
								<button type="button" class="btn btn-ghost" onclick={back}>Back</button>
								<button
									type="button"
									class="btn btn-primary"
									disabled={!form.verified}
									onclick={next}
								>
									Continue
								</button>
							</div>
						{:else if form.step === 'consent'}
							<h2 tabindex="-1" use:focusHeading>Rights and contact</h2>

							<FormField
								id="f-email"
								label="Your email"
								hint="Used once, to tell you whether this was accepted, then deleted. Not an account, not a mailing list, never published."
								required
								error={form.reviewErrors.email}
							>
								{#snippet children(describedBy)}
									<input
										id="f-email"
										class="control"
										type="email"
										autocomplete="email"
										bind:value={review.email}
										oninput={() => form.touch()}
										aria-describedby={describedBy}
										aria-invalid={Boolean(form.reviewErrors.email)}
									/>
								{/snippet}
							</FormField>

							<FormField
								id="f-pro"
								label="Are you a member of a performing rights organization?"
								hint="Asked for visibility only. It does not affect whether you are accepted."
								required
								error={form.reviewErrors.pro_membership}
							>
								{#snippet children(describedBy)}
									<select
										id="f-pro"
										class="control"
										bind:value={review.pro_membership}
										onchange={() => form.touch()}
										aria-describedby={describedBy}
										aria-invalid={Boolean(form.reviewErrors.pro_membership)}
									>
										<option value="" disabled>Choose one</option>
										{#each PRO_OPTIONS as option (option)}
											<option value={option}>{option}</option>
										{/each}
									</select>
								{/snippet}
							</FormField>

							<!-- Only "Other" leaves the actual organization unnamed; every
					     other option (ASCAP, BMI, ...) already named it by being
					     picked, and "Not a member"/"Not sure" have no name to give. -->
							{#if review.pro_membership === 'Other'}
								<FormField
									id="f-pro-name"
									label="Which organization?"
									required
									error={form.reviewErrors.pro_membership_name}
								>
									{#snippet children(describedBy)}
										<input
											id="f-pro-name"
											class="control"
											type="text"
											bind:value={review.pro_membership_name}
											oninput={() => form.touch()}
											aria-describedby={describedBy}
											aria-invalid={Boolean(form.reviewErrors.pro_membership_name)}
										/>
									{/snippet}
								</FormField>
							{/if}

							<!-- Rights renders in full rather than behind a link: a checkbox
					     next to a link to terms is not consent to the terms, a
					     checkbox under the text of them is closer. Worded for any
					     type of work, not just audio's "recording and composition";
					     the PRO sentence is scoped to music (not spoken audio) since
					     PRO membership itself only means something for music.
					     Shown only when a stated PRO relationship makes it apply
					     (see `rightsSectionApplies` in submissionValidation.js) --
					     "Not a member" has nothing here to disclose, and the general
					     EULA below already collects a blanket rights affirmation from
					     everyone. When shown, this box does gate Continue and
					     Submit, same as .eula-section below -- see `consentGiven`. -->
							{#if rightsSectionApplies(review)}
								<h3>Rights</h3>
								<label class="option consent">
									<input
										type="checkbox"
										bind:checked={review.rights_confirmation}
										onchange={() => form.touch()}
									/>
									<span class="option-description consent-text">
										I confirm that I hold full rights to what I am submitting, including that no
										third party such as a co-writer, sample owner, publisher, collaborator, or label
										holds a claim that would require separate compensation for its use on
										IndieNodes.
										{#if entry.type === 'audio' && entry.form === 'music'}
											I understand that PRO membership does not prevent me from submitting, but I am
											disclosing it accurately above.
										{/if}
									</span>
								</label>
							{/if}

							<!-- The one consent that actually gates submission (see
					     `consentGiven` in submissionValidation.js), so it stays short
					     enough to read in full inline rather than living only behind
					     the "Read the full EULA" link — the full legal text is still
					     one click away via the modal below, for anyone who wants it. -->
							<h3>General EULA</h3>
							<label class="option consent">
								<input
									type="checkbox"
									bind:checked={review.eula_agreement}
									onchange={() => form.touch()}
								/>
								<span class="option-description consent-text">
									By submitting, you affirm you hold full rights to what you're submitting, and you
									agree that IndieNodes operates on a donation-only basis: it collects no revenue
									from your work, and you waive any claim to compensation from IndieNodes on that
									basis.
									<button type="button" class="link-button" onclick={() => (eulaModalOpen = true)}>
										Read the full EULA
									</button>. By submitting, you also agree to the
									<!-- eslint-disable svelte/no-navigation-without-resolve -- resolved app route with an appended section anchor -->
									<a href={`${resolve('/terms')}#terms-of-use`} target="_blank" rel="noopener"
										>Terms of Use</a
									>
									and acknowledge the
									<a href={`${resolve('/terms')}#privacy-notice`} target="_blank" rel="noopener"
										>Privacy Notice</a
									><!-- eslint-enable svelte/no-navigation-without-resolve
									-->.
								</span>
							</label>

							<Modal
								open={eulaModalOpen}
								title="End User License Agreement"
								dialogClass="eula-modal-dialog"
								onClose={() => (eulaModalOpen = false)}
							>
								<EulaContent html={page.data.eulaHtml} />
							</Modal>

							<div class="actions">
								<button type="button" class="btn btn-ghost" onclick={back}>Back</button>
								<button type="button" class="btn btn-primary" disabled={!canAdvance} onclick={next}>
									Continue
								</button>
							</div>
						{:else}
							<h2 tabindex="-1" use:focusHeading>Review and send</h2>
							<p>This is exactly what will be added to the ring. Nothing else is published.</p>

							<dl class="review">
								<dt>Creator</dt>
								<dd>{entry.creator}</dd>
								<dt>Type</dt>
								<dd>{entry.type}</dd>
								<dt>Why</dt>
								<dd>{entry.why}</dd>
								<dt>Links to</dt>
								<dd class="wrap">{entry.source_url}</dd>
								<dt>Tags</dt>
								<dd>{entry.tags.join(', ')}</dd>
								{#if provisionalId}
									<dt>Entry id</dt>
									<dd><code>{provisionalId}</code> <span class="note-inline">may change</span></dd>
								{/if}
							</dl>

							<ExactDataDisclosure value={form.preview} />

							<p class="note">
								Your email and the answers above it are sent for review only. They are never written
								to the ring, never appear in public, and are deleted once this submission is
								resolved.
							</p>

							<Honeypot bind:value={form.honeypot} />

							{#if form.error}
								<p class="inline-error" role="alert">{form.error.message}</p>
							{/if}

							<div class="actions">
								<button type="button" class="btn btn-ghost" onclick={back}>Back</button>
								<button
									type="button"
									class="btn btn-primary"
									disabled={(!hasBackend && !useMock) ||
										form.pending !== 'idle' ||
										!form.verified ||
										!form.consentGiven}
									onclick={() => form.send()}
								>
									{form.pending === 'submitting' ? 'Sending…' : 'Submit my entry'}
								</button>
							</div>

							<p class="footnote">
								A person reviews every submission before it appears. What that review checks is thin
								on purpose: that the link works, that the token was there, and that the type matches
								the content.
							</p>
						{/if}
					</div>
				{/key}
			</div>
		</div>
	{/if}
</div>

<style>
	/* This page deliberately does not scroll as a whole above the 60rem
	   breakpoint (see .join-layout below): every other route in this app
	   just lets the document scroll, there is no viewport-height chain
	   anywhere in src/routes/+layout.svelte or app.css to hook into, and
	   adding one globally would be a much bigger change than this one page
	   needs. So the height budget is computed locally instead, against the
	   one number that actually matters here: .page-transition's own
	   `padding: 5.5rem 1.65rem 1.65rem` in +layout.svelte, which is what
	   reserves room for the fixed header above this page. This file already
	   hardcodes that same 5.5rem elsewhere (the mobile .toc breakpoint
	   below), so this isn't a new kind of magic number for it. */
	.join-page {
		width: 100%;
		max-width: 72rem;
		margin: 0 auto;
		padding: 0 2rem 2rem;
		display: flex;
		flex-direction: column;
		transition: max-width 320ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	@media (prefers-reduced-motion: reduce) {
		.join-page {
			transition: none;
		}
	}

	/* Deliberately smaller than this app's usual h1 (--text-2xl elsewhere):
	   on this page the heading is a title bar competing with the actual
	   stepper for the same fixed height budget (see .join-page above), not
	   a hero. --text-lg keeps it legible as a heading without being the
	   biggest thing that has to fit above the fold. */
	.page-title {
		flex-shrink: 0;
		margin: 1rem 0 0.9rem;
		font-size: var(--text-lg);
	}

	.interim-note {
		flex-shrink: 0;
		max-width: 60ch;
		margin-bottom: 0.9rem;
		padding: 0.7rem 1rem;
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
	}

	.interim-note p {
		margin: 0;
		font-size: var(--text-xs);
	}

	/* Tailwind's Preflight resets every anchor in the app to `color: inherit;
	   text-decoration: inherit`, so an inline link only looks like one where a
	   rule says so -- see the note on `.consent-text a` below. This note's own
	   link ("this ring's repository") is the route into the ring for any
	   deployment running without a submission backend, so it is the last link
	   in this file that can afford to read as plain text. */
	.interim-note a {
		color: var(--accent);
		text-decoration: underline;
		text-decoration-thickness: 0.1em;
		text-underline-offset: 0.16em;
	}

	.note-panel {
		max-width: 62ch;
		margin-bottom: 1.6rem;
		padding: 0.9rem 1.1rem;
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
	}

	.note-panel .note {
		max-width: none;
	}

	/* The no-site audio step's bundle-vs-external bubble picker, and the
	   Neocities/File Garden/Nekoweb suggestion rows shown once "external" is
	   picked. Live here rather than in JoinMediaStep.svelte because that
	   component has no <style> block of its own — every class it uses is
	   already defined on this page and shared, same as .option/.note-panel
	   above. Every selector is :global(): the elements they target live in
	   that child component's own markup, not this page's, so this page's
	   scoped-CSS analysis cannot prove any of them apply to anything and
	   marks the whole set unused otherwise. */
	:global(.hosting-bubble-row) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
	}

	/* Same rounded/selected-state language as .chip (app.css), scaled up:
	   these carry a full sentence each rather than a single tag word, so a
	   true 999px pill reads as a squashed oval once the text wraps. */
	:global(.hosting-bubble) {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.7rem 1.1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--bg-elevated);
		color: var(--text-muted);
		font-weight: 600;
		cursor: pointer;
	}

	:global(.hosting-bubble:hover) {
		color: var(--text);
	}

	:global(.hosting-bubble.checked) {
		border-color: var(--accent);
		color: var(--accent);
	}

	:global(.hosting-bubble input) {
		width: 1.1rem;
		height: 1.1rem;
		flex-shrink: 0;
		accent-color: var(--accent);
	}

	:global(.hosting-bubble:has(input:focus-visible)) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	:global(.hosting-rows) {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		margin: 0.9rem 0;
	}

	/* Full-width row: logo stack fixed on the left, description filling the
	   rest, rather than the side-by-side cards this replaced. */
	:global(.hosting-row) {
		display: grid;
		grid-template-columns: 44px minmax(0, 1fr) 3.2rem;
		align-items: stretch;
		gap: 1rem;
		padding-left: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg);
		overflow: hidden;
		transition:
			transform 180ms ease,
			border-color 180ms ease,
			background-color 180ms ease,
			box-shadow 180ms ease;
	}
	:global(.hosting-row:hover),
	:global(.hosting-row:focus-within) {
		transform: translateY(-2px);
		border-color: color-mix(in oklch, var(--accent) 72%, var(--border));
		background: color-mix(in oklch, var(--accent) 7%, var(--bg));
		box-shadow: 0 10px 24px color-mix(in oklch, var(--accent) 13%, transparent);
	}
	:global(.hosting-row > img) {
		align-self: center;
		border-radius: 6px;
	}
	:global(.hosting-row-body) {
		align-self: center;
		padding-block: 0.9rem;
	}
	:global(.hosting-row-link) {
		display: grid;
		place-items: center;
		min-height: 100%;
		border-left: 1px solid var(--border);
		background: var(--bg-elevated);
		color: var(--accent);
		font-size: 1.4rem;
		text-decoration: none;
		transition:
			background-color 150ms ease,
			color 150ms ease;
	}
	:global(.hosting-row-link:hover) {
		background: var(--accent);
		color: var(--bg);
	}
	:global(.hosting-divider.hosting-divider) {
		margin: 1.5rem 0 0.2rem;
		padding: 0.85rem 1rem;
		border: 1px solid color-mix(in oklch, var(--accent) 42%, var(--border));
		border-left: 4px solid var(--accent);
		border-radius: var(--radius-sm);
		background: color-mix(in oklch, var(--accent) 8%, var(--bg));
		color: var(--text);
		font-size: var(--text-base);
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	:global(.musician-help) {
		max-width: 68ch;
		margin: 2rem 0 0.25rem;
		padding: 1rem 1.15rem;
		border: 1px solid color-mix(in oklch, var(--type-audio) 55%, var(--border));
		border-left: 4px solid var(--type-audio);
		border-radius: var(--radius-sm);
		background: color-mix(in oklch, var(--type-audio) 10%, var(--bg-elevated));
	}
	:global(.musician-help summary) {
		cursor: pointer;
		font-weight: 700;
	}
	:global(.musician-help > *:not(summary)) {
		margin-top: 1rem;
	}

	:global(.hosting-logo-stack) {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
	}

	:global(.hosting-logo-stack img) {
		display: block;
		border-radius: 6px;
	}

	:global(.hosting-logo-plus) {
		color: var(--text-faint);
		font-size: var(--text-sm);
		font-weight: 700;
		line-height: 1;
	}

	:global(.hosting-row-body) {
		flex: 1;
		min-width: 0;
	}

	:global(.hosting-row-title) {
		margin: 0 0 0.3rem;
		font-weight: 600;
	}

	/* Wider than the generic .note-panel: this one's own content (the "no
	   bigots" rule especially) genuinely needs more than 62ch to read as
	   short paragraphs rather than a ladder of half-empty lines. */
	.rules-panel {
		max-width: 68ch;
	}

	.rules-panel h3 {
		margin: 0 0 0.7rem;
		font-size: var(--text-base);
	}

	.rules-list {
		/* The app's Tailwind preflight zeroes list-style globally; restored
		   explicitly here since this is meant to read as an actual list. */
		list-style: disc;
		margin: 0;
		padding-left: 1.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.rules-list li::marker {
		color: var(--accent);
	}

	.rules-list a {
		color: var(--accent);
		font-weight: 700;
		text-decoration: underline;
		text-decoration-thickness: 0.1em;
		text-underline-offset: 0.16em;
	}

	.rules-list a:hover {
		color: var(--text);
	}

	/* GlassPanel itself ships unpadded on purpose (chrome/containers only;
	   callers supply their own — see its doc comment), so the success
	   screen needs its own rule here rather than inheriting one. :global()
	   is required because GlassPanel renders `class` inside its own
	   component scope, which this page's scoped styles cannot otherwise
	   reach (same pattern src/routes/+error.svelte already uses for its own
	   GlassPanel child). */
	/* 60ch, not the previous 46rem: 46rem rendered noticeably narrower than
	   .interim-note directly above it (60ch, same as everywhere else prose
	   width is capped in this file — see .consent, .repeat-row), which read
	   as this panel not using the width the page otherwise offers. Matching
	   the sibling above it is the fix, not un-capping it outright: unlimited
	   width would just make the paragraphs here uncomfortably long to read. */
	:global(.done-panel) {
		max-width: 60ch;
		margin: 1.4rem 0;
		padding: 2.2rem 2rem;
	}

	/* Spacing between GlassPanel's children (h2/p/h3/pre/button, authored
	   directly in this component's own template, so they already carry this
	   file's scope hash and need no :global() of their own — only the
	   anchor, .done-panel itself, does; see the comment above). Every child
	   previously had `margin: 0` (this app's global reset) and nothing
	   restored it, so the panel read as one unbroken block of text with no
	   breathing room between the reference, the intro, and the widget
	   section.

	   Listed explicitly (h2 excluded, since it always leads and needs no
	   top margin of its own) rather than a lobotomized-owl `* + *`, and the
	   whole compound selector wrapped in one :global(...) rather than just
	   the anchor (contrast .done-panel above): a child combinator crossing
	   into GlassPanel's own rendered output is something Svelte's
	   unused-selector pruning cannot verify from this component's own
	   template tree alone, component boundaries are opaque to it, so
	   `:global(.done-panel) > p` compiled to *nothing* and silently dropped
	   the whole rule — every child kept rendering with zero spacing despite
	   this appearing to be in the stylesheet. Wrapping the full selector
	   opts it out of that check entirely instead of trying to satisfy it. */
	:global(.done-panel > p),
	:global(.done-panel > h3),
	:global(.done-panel > pre),
	:global(.done-panel > button) {
		margin-top: 1.2rem;
	}

	:global(.done-panel > h3) {
		margin-top: 2rem;
	}

	.success-heading {
		display: flex;
		align-items: center;
		gap: 0.9rem;
	}

	.success-heading h2 {
		margin: 0;
	}

	.success-check {
		display: grid;
		width: 3rem;
		height: 3rem;
		flex: 0 0 3rem;
		place-items: center;
		color: var(--type-game);
		animation: success-pop 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.success-check svg {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
	}

	.success-check-circle {
		fill: var(--type-game);
		opacity: 0.16;
		stroke: currentColor;
		stroke-width: 2;
	}

	.success-check-path {
		fill: none;
		stroke: currentColor;
		stroke-width: 4;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 32;
		stroke-dashoffset: 32;
		animation: success-draw 420ms 180ms ease-out forwards;
	}

	@keyframes success-pop {
		from {
			opacity: 0;
			transform: scale(0.45) rotate(-10deg);
		}
		to {
			opacity: 1;
			transform: scale(1) rotate(0);
		}
	}

	@keyframes success-draw {
		to {
			stroke-dashoffset: 0;
		}
	}

	.success-tier-grid,
	.success-badge-grid {
		display: grid;
		gap: 0.85rem;
		margin-top: 1rem;
	}

	.success-tier-grid {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.success-badge-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.success-tier-card,
	.success-badge-card {
		position: relative;
		display: flex;
		min-width: 0;
		padding: 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--bg-elevated) 86%, transparent);
		cursor: pointer;
		transition:
			border-color 160ms ease,
			box-shadow 160ms ease,
			transform 160ms ease;
	}

	.success-tier-card {
		flex-direction: column;
		gap: 0.7rem;
	}

	.success-badge-card {
		align-items: stretch;
		gap: 0.7rem;
	}

	.success-tier-card:hover,
	.success-badge-card:hover,
	.success-tier-card:focus-within,
	.success-badge-card:focus-within {
		border-color: var(--accent);
		transform: translateY(-1px);
	}

	.success-tier-card.selected,
	.success-badge-card.selected {
		border-color: var(--type-game);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--type-game) 24%, transparent);
	}

	.success-card-radio {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
	}

	.success-tier-copy,
	.success-badge-copy {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.15rem;
	}

	.success-tier-copy strong,
	.success-badge-copy strong {
		font-size: var(--text-sm);
	}

	.success-tier-copy small,
	.success-badge-copy small {
		color: var(--text-muted);
		font-size: 0.78rem;
		line-height: 1.3;
	}

	.success-badge-copy {
		flex: 1;
	}

	.success-preview-shell,
	.success-single-preview {
		display: grid;
		min-width: 0;
		overflow: hidden;
		place-items: center;
		border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
		border-radius: var(--radius-sm);
		background:
			linear-gradient(
				45deg,
				color-mix(in srgb, var(--border) 26%, transparent) 25%,
				transparent 25%
			),
			linear-gradient(
				-45deg,
				color-mix(in srgb, var(--border) 26%, transparent) 25%,
				transparent 25%
			),
			linear-gradient(
				45deg,
				transparent 75%,
				color-mix(in srgb, var(--border) 26%, transparent) 75%
			),
			linear-gradient(
				-45deg,
				transparent 75%,
				color-mix(in srgb, var(--border) 26%, transparent) 75%
			);
		background-position:
			0 0,
			0 0.4rem,
			0.4rem -0.4rem,
			-0.4rem 0;
		background-size: 0.8rem 0.8rem;
	}

	.success-preview-shell {
		height: 7.5rem;
	}

	.success-preview-shell.compact {
		width: 8rem;
		height: 4.8rem;
		flex: 0 0 8rem;
	}

	.success-single-preview {
		height: 9rem;
		margin-top: 1rem;
	}

	.success-preview-frame {
		width: 100%;
		height: 100%;
		border: 0;
		pointer-events: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.success-check,
		.success-check-path,
		.success-tier-card,
		.success-badge-card {
			animation: none;
			transition: none;
			transform: none;
		}

		.success-check-path {
			stroke-dashoffset: 0;
		}
	}

	@media (max-width: 44rem) {
		.success-tier-grid,
		.success-badge-grid {
			grid-template-columns: 1fr;
		}

		.success-badge-card {
			flex-direction: column;
		}

		.success-preview-shell.compact {
			width: 100%;
		}
	}

	/* Its own centered line rather than folded into the sentence above it:
	   a reference code is something a submitter comes back to copy or quote
	   later, not just read in passing, so it gets to stand out instead of
	   sitting mid-paragraph. */
	.reference-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
		text-align: center;
	}

	.reference-label {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}

	.reference-code {
		font-size: var(--text-lg);
		font-weight: 700;
		letter-spacing: 0.02em;
	}

	/* Centered rather than left-aligned like the rest of the panel's flow
	   content: this is the one action on the success screen, closing it out
	   rather than continuing to read alongside the text above it, so it
	   earns standing apart the way a dialog's own primary action would. */
	.submit-again-button {
		display: block;
		margin-inline: auto;
	}

	@media (max-width: 30rem) {
		:global(.done-panel) {
			padding: 1.6rem 1.4rem;
		}
	}

	/* A single column now: the horizontal StepProgress bar, then the panel
	   below it. The former two-column grid (a 15rem sidebar stepper beside
	   the panel) is gone along with the sidebar itself — see StepProgress.svelte
	   for what replaced it and why it is a plain progress indicator rather
	   than a click-to-jump tab list the sidebar was. */
	.join-layout {
		display: flex;
		flex-direction: column;
		gap: 1.75rem;
		/* Belt and suspenders with .panel/.step-body's own max-height clamp:
		   without this, content inside a step (the preview iframe in
		   particular) could still push .join-layout itself taller than the
		   flex-constrained space min-height: 0 makes available, growing the
		   whole fixed-height screen rather than staying capped and scrolling
		   internally. A hard clip here guarantees the reserved viewport
		   budget is never exceeded regardless of what a given step renders. */
		overflow: hidden;
	}

	/* Fixed-height only above the breakpoint where this still reads as a
	   single, self-contained screen (see the 60rem breakpoint further down,
	   which reverts this and everything under it to ordinary page flow on a
	   short or narrow viewport). `calc` subtracts .page-transition's own
	   reservation plus this element's own top margin from the viewport, so
	   .join-layout gets exactly the room left over rather than growing with
	   content and pushing the page into a scroll nobody asked for. */
	@media (min-width: 60.01rem) {
		.join-page {
			height: calc(100dvh - 5.5rem - 1.65rem);
			min-height: 0;
		}

		.join-layout {
			flex: 1;
			min-height: 0;
		}
	}

	.panel {
		min-width: 0;
		/* Required by out:outFade below, which takes the outgoing step
		   absolute so it overlays the incoming one instead of both occupying
		   flow at once (see transitions.js's own doc comment). */
		position: relative;
	}

	@media (min-width: 60.01rem) {
		.panel {
			/* max-height, not height: a short step (few fields, no preview)
			   used to still be stretched to the full reserved viewport height
			   regardless, leaving a dead gap below its own action buttons —
			   visible, unbordered empty space down to where a long step's
			   content would have reached. max-height keeps the same cap for a
			   step that actually needs it (internal scroll still takes over
			   exactly as before) while letting a shorter step's panel size to
			   its own content instead of stretching past it. */
			max-height: 100%;
			min-height: 0;
			display: flex;
			flex-direction: column;
		}
	}

	/* The one scroll region on this page above 60rem: short steps never fill
	   it, so no scrollbar appears; consent's legal text is the deliberate
	   exception that does. Below 60rem this is a no-op, since .panel isn't
	   height-constrained there and the page scrolls as a whole instead. */
	.step-body {
		overflow-y: auto;
		max-height: 100%;
		min-height: 0;
	}

	.step-body h2:focus-visible {
		outline-offset: 4px;
	}

	.panel h2 {
		margin-bottom: 0.8rem;
	}

	.panel h3 {
		margin: 2rem 0 0.6rem;
	}

	.panel p {
		max-width: 62ch;
		margin-bottom: 1.2rem;
	}

	.checklist {
		max-width: 62ch;
		margin: 0 0 2rem;
		padding-left: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.checklist li {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.checklist-icon {
		flex-shrink: 0;
		margin-top: 0.1rem;
		color: var(--accent);
	}

	/* .control's own width:100% + text-input padding reads as a giant,
	   oddly-padded swatch on a native color picker, which has no text
	   inside it to pad around. Keep the border/radius language, drop the
	   padding, and size it like the small square control it actually is. */
	.control-color {
		width: 3.5rem;
		height: 2.6rem;
		padding: 0.2rem;
		cursor: pointer;
	}

	.motion-toggle {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		margin: 0 0 1.6rem;
		padding: 0.85rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg);
		cursor: pointer;
	}
	.motion-toggle input {
		width: 1.1rem;
		height: 1.1rem;
		margin-top: 0.15rem;
		accent-color: var(--accent);
	}
	.motion-toggle span {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.motion-toggle small {
		color: var(--text-muted);
		font-size: var(--text-xs);
	}

	/* The "Musicians: what makes a track actually playable here" table, moved
	   here from JoinEntryStep.svelte's own <style> block when that section
	   moved to JoinMediaStep.svelte — same :global() reasoning as .hosting-*
	   above, since the markup using these now lives in a child component. */
	:global(.table-scroll) {
		overflow-x: auto;
		margin-bottom: 1.2rem;
	}

	:global(.table-scroll table) {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}

	:global(.table-scroll th),
	:global(.table-scroll td) {
		padding: 0.6rem 0.8rem;
		border-bottom: 1px solid var(--border);
		text-align: left;
		vertical-align: top;
	}

	:global(.table-scroll thead th) {
		color: var(--text-muted);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	:global(.table-scroll tbody th) {
		font-weight: 600;
		white-space: nowrap;
	}

	:global(.req) {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: var(--text-xs);
		font-weight: 600;
		white-space: nowrap;
	}

	:global(.req[data-req='yes']) {
		background: var(--type-game-soft);
		color: var(--type-game);
	}

	:global(.req[data-req='no']) {
		background: var(--bg-elevated);
		color: var(--text-faint);
		border: 1px solid var(--border);
	}

	pre {
		overflow-x: auto;
		margin-bottom: 1.2rem;
		padding: 0.9rem 1rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		font-size: var(--text-sm);
		line-height: 1.5;
	}

	.note {
		max-width: 62ch;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.note a {
		color: var(--accent);
	}

	.note-inline {
		color: var(--text-faint);
		font-size: var(--text-xs);
	}

	/* Its own highlighted container rather than one more plain checkbox in
	   the list above it: this is the one field on this step with real
	   consequences if it's wrong in either direction (mislabeled explicit
	   content reaching someone who opted out, or genuinely explicit work
	   left unlabeled), so it earns visually standing apart from "what kind
	   of work is this" and "tags." Amber rather than this page's usual
	   accent border, the same "pay attention here" register a caution color
	   carries everywhere else it's used. */
	.consent {
		max-width: 66ch;
		margin-bottom: 1.6rem;
		padding: 1rem 1.2rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-elevated);
	}

	.consent-text {
		font-size: var(--text-sm);
		line-height: 1.55;
	}

	/* The three inline links in the consent sentence are two <a>s and one
	   <button> -- the button opens the EULA modal, the anchors go to /terms --
	   and only the button used to carry link styling, so the two that actually
	   were links were the two that did not look like any. Which element each
	   one is comes down to whether it opens a URL or a dialog, and that is not
	   a distinction a reader is supposed to be able to see, so they are styled
	   together here.

	   An explicit rule is needed at all because Tailwind's Preflight (pulled in
	   by `@import 'tailwindcss'` in app.css) resets every anchor in the app to
	   `color: inherit; text-decoration: inherit`. There is no browser default
	   left to fall back on, which is why this file already styles `.rules-list
	   a` and `.note a` one scope at a time. The underline thickness and offset
	   match `.rules-list a`, the most considered link in this file; its
	   `font-weight: 700` deliberately does not come along, because three bold
	   spans inside one dense consent sentence read as emphasis rather than as
	   links. */
	.consent-text a,
	.link-button {
		color: var(--accent);
		text-decoration: underline;
		text-decoration-thickness: 0.1em;
		text-underline-offset: 0.16em;
	}

	.consent-text a:hover,
	.link-button:hover {
		color: var(--text);
	}

	/* The button half also has to shed its button-ness to sit inside the
	   sentence: a <button> brings padding, a border, a background and a font
	   of its own, none of which an inline link has. */
	.link-button {
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		font-size: inherit;
		cursor: pointer;
	}

	.repeat-row {
		max-width: 62ch;
		margin-bottom: 1.6rem;
		padding: 1.2rem 1.2rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.social-icon-preview {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.8rem;
		color: var(--text-muted);
		font-size: 0.85rem;
	}

	.social-icon-preview :global(svg) {
		flex-shrink: 0;
		width: 1.1rem;
		height: 1.1rem;
	}

	.option-row {
		display: flex;
		flex-wrap: wrap;
		gap: 1.4rem;
	}

	/* Full width of the builder column. Capped at 30rem before, which on a
	   narrow preview pane wrapped "Page template" and its hint onto three
	   lines for a control that had room to be one. */
	.template-select-wrap {
		margin: 0 0 0.75rem;
	}

	.social-label-toggle {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		color: var(--text-muted);
		font-size: var(--text-xs);
	}

	.template-select {
		appearance: none;
		padding-right: 3rem;
		background-color: var(--bg-elevated);
		background-image:
			linear-gradient(45deg, transparent 50%, var(--accent) 50%),
			linear-gradient(135deg, var(--accent) 50%, transparent 50%);
		background-position:
			calc(100% - 1.2rem) 50%,
			calc(100% - 0.85rem) 50%;
		background-size:
			0.4rem 0.4rem,
			0.4rem 0.4rem;
		background-repeat: no-repeat;
		color: var(--text);
		cursor: pointer;
	}

	.template-select:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.join-page.builder-active,
	.join-page.entry-preview-active {
		max-width: 96rem;
	}
	/* Two columns: what the editor is on the left, what it makes on the right.
	   The illustration is the half that can be dropped, so it is the one that
	   goes when there is no room for both. */
	.builder-launch {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr);
		align-items: center;
		gap: 2rem;
		width: 100%;
		margin-top: 1.25rem;
		padding: 1.6rem 1.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--bg-elevated);
	}

	.builder-launch-copy h3 {
		margin: 0 0 0.5rem;
		font-size: var(--text-lg);
	}

	.builder-launch-copy p {
		margin: 0 0 0.9rem;
		color: var(--text-muted);
	}

	.builder-launch-points {
		margin: 0 0 1.25rem;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.builder-launch-points li {
		display: flex;
		align-items: baseline;
		gap: 0.55rem;
	}

	.builder-launch-points li::before {
		content: '';
		flex: none;
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 999px;
		background: var(--accent);
	}

	.builder-launch-art {
		display: flex;
		justify-content: center;
	}

	@media (max-width: 52rem) {
		.builder-launch {
			grid-template-columns: minmax(0, 1fr);
		}

		.builder-launch-art {
			display: none;
		}
	}

	/* Two panes inside the dialog: a settings column that scrolls on its own
	   and a preview that takes whatever is left. Collapsing the column is a
	   grid-template change rather than a display toggle, so the preview grows
	   into the space instead of the pane reflowing underneath it. */
	.editor {
		display: grid;
		grid-template-columns: minmax(20rem, 24rem) minmax(0, 1fr);
		gap: 1rem;
		width: 100%;
		min-height: 0;
	}

	.editor.settings-hidden {
		grid-template-columns: 0 minmax(0, 1fr);
		gap: 0;
	}

	.editor-settings {
		min-width: 0;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding-right: 0.35rem;
	}

	/* Hidden by clipping rather than `display: none`, so the collapse is a
	   width change the grid can animate and the pane keeps its scroll
	   position across a collapse. `inert` in the markup is what actually
	   takes it out of the tab order and the accessibility tree; visibility
	   alone would leave its fields focusable at zero width. */
	.editor.settings-hidden .editor-settings {
		overflow: hidden;
		padding-right: 0;
	}

	.editor-stage {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: #0b0b0d;
	}

	.bio-field {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.6rem;
	}

	/* Clamped rather than scrolled: this is a reminder of what is written, not
	   a place to read it. The dialog is where it is read. */
	.bio-summary {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.bio-summary.empty {
		font-style: italic;
	}

	.bio-editor {
		margin: 1rem 0;
		min-height: 18rem;
		display: flex;
		flex-direction: column;
	}

	.bio-editor-actions {
		display: flex;
		justify-content: flex-end;
	}

	:global(.bio-modal-dialog) {
		width: min(92vw, 46rem) !important;
		max-width: min(92vw, 46rem) !important;
	}

	/* The fallback for browsers that refuse `requestFullscreen` on a non-video
	   element. Where the real API works this class is along for the ride and
	   the `:fullscreen` sizing below takes over. */
	.editor-stage.fullscreen {
		position: fixed;
		inset: 0;
		z-index: 300;
		border-radius: 0;
		border: 0;
	}

	.editor-stage:fullscreen {
		border-radius: 0;
		border: 0;
	}

	.editor-toolbar {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		flex-shrink: 0;
		padding: 0.5rem;
		border-bottom: 1px solid var(--border);
		background: var(--bg-elevated);
	}

	.preview-pages {
		display: flex;
		gap: 0.3rem;
		margin-left: auto;
	}

	.page-tab {
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-muted);
		font: inherit;
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.page-tab.active {
		border-color: var(--accent);
		color: var(--accent);
	}

	.editor-toolbar .note,
	.editor-toolbar .error {
		margin: 0;
	}

	@media (prefers-reduced-motion: no-preference) {
		.editor {
			transition: grid-template-columns 200ms ease;
		}
	}

	@media (max-width: 60rem) {
		/* No room for two panes: the sidebar takes the dialog and the preview
		   sits under it, which makes the collapse toggle the way you switch
		   between editing and looking rather than a space optimisation. */
		.editor {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr) minmax(12rem, 40%);
		}

		.editor.settings-hidden {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: 0 minmax(0, 1fr);
		}
	}
	@media (max-width: 62rem) {
	}

	/* Full width of the panel, not the 62ch text-measure the rest of this
	   form's fields use: a narrower iframe here doesn't shrink what it
	   renders, it just gives the generated page's own layout less room to
	   work with, which forced its wider sections (a template's own
	   full-bleed bands, say) into their own horizontal scroll *inside* the
	   iframe — on top of the panel's ordinary vertical scroll outside it,
	   which is what read as two scrollbars at once. */

	/* .btn's own padding/font-size (0.7rem 1.4rem, --text-base) is sized for
	   a primary action like the step's own Back/Continue buttons below —
	   applied here it made this small utility toolbar reserve nearly 80px of
	   height for one secondary control, a real, if easy-to-miss, contributor
	   to the step reading longer than it needed to. Shrunk to toolbar scale
	   instead. */

	/* Modal.svelte's own dialog is sized for text content (48rem, padded);
	   this is the one caller (see Modal's own doc comment on dialogClass)
	   that wants to fill most of the viewport instead, so the preview
	   actually gets room to be inspected rather than just repeating the
	   inline iframe's own cramped size inside a dialog frame.

	   !important on the sizing properties only: Svelte's own scoping adds
	   an attribute selector to `.dialog`'s rule inside Modal.svelte, which
	   outranks a same-specificity plain class here regardless of the two
	   stylesheets' relative bundling order — this is the one place in this
	   file overriding another component's internals by design (exactly
	   what `dialogClass` exists for), so it says so outright rather than
	   gambling on a selector/order trick to win the same fight indirectly. */
	/* The editor is the one dialog that wants the viewport rather than a
	   readable text column: it holds a form and a full-page preview side by
	   side, and both need the room. */
	:global(.editor-modal-dialog) {
		width: 94vw !important;
		max-width: 94vw !important;
		height: 92vh !important;
		max-height: 92vh !important;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
	}

	:global(.editor-modal-dialog .dialog-header) {
		flex-shrink: 0;
		margin-bottom: 1rem;
	}

	:global(.editor-modal-dialog .dialog-body) {
		flex: 1;
		min-height: 0;
		display: flex;
	}

	.preview-frame-large {
		display: block;
		flex: 1;
		width: 100%;
		height: 100%;
		border: none;
		border-radius: var(--radius-sm);
	}

	/* Second `dialogClass` caller (see the comment above
	   `.preview-modal-dialog`): the EULA's two-column metadata block and
	   definitions list read as cramped at Modal's default 48rem text width,
	   so this widens the dialog without touching its height/scroll behavior,
	   which the 48rem default already gets right for a long document. */
	:global(.eula-modal-dialog) {
		width: min(92vw, 64rem) !important;
		max-width: min(92vw, 64rem) !important;
	}

	.inline-error {
		max-width: 62ch;
		color: #e0455f;
		font-size: var(--text-sm);
	}

	.verified {
		color: var(--type-game);
		font-weight: 600;
	}

	.review {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.6rem 1.4rem;
		max-width: 62ch;
		margin-bottom: 2rem;
	}

	.review dt {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.review dd {
		margin: 0;
	}

	.review dd.wrap {
		overflow-wrap: anywhere;
	}

	/* Pinned to the bottom of the scrolling step so Back and Continue are
	   always reachable, rather than sitting at the end of content the reader
	   has to get to first. Sticky rather than fixed: it stays inside the
	   panel's own column, so it neither spans the viewport on desktop nor
	   needs to know about the mobile bottom bar.

	   The padding and background are load-bearing, not decoration — content
	   scrolls underneath this, and without an opaque ground the two would
	   overlap illegibly. */
	.actions {
		position: sticky;
		bottom: 0;
		z-index: 2;
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin-top: 2.4rem;
		padding: 0.9rem 1rem 0.9rem;
		background: var(--bg);
	}

	/* Only while something is actually hidden below (see scrollAffordance.js):
	   a hairline to say the bar is covering content rather than ending it,
	   and a short fade above it so the covered content visibly passes under
	   rather than being cut. On the last screenful both disappear, which is
	   how the bar stops claiming there is more. */
	.step-body:global(.has-overflow):not(:global(.at-bottom)) .actions {
		box-shadow: 0 -1px 0 var(--border);
	}

	.step-body:global(.has-overflow):not(:global(.at-bottom)) .actions::before {
		content: '';
		position: absolute;
		inset: auto 0 100% 0;
		height: 1.4rem;
		background: linear-gradient(to top, var(--bg), transparent);
		pointer-events: none;
	}

	@media (prefers-reduced-motion: no-preference) {
		.actions {
			transition: box-shadow 160ms ease;
		}
	}

	.footnote {
		margin-top: 2rem;
		padding-top: 1.2rem;
		border-top: 1px solid var(--border);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	@media (max-width: 60rem) {
		.join-page {
			padding: 2rem 1.2rem 4rem;
		}

		.join-layout {
			gap: 1.4rem;
		}

		/* .panel keeps position: relative at every width — out:outFade below
		   needs a positioned ancestor to anchor its overlay against
		   regardless of screen size, only the height-locking (desktop-only,
		   see the 60.01rem query above) is what's different per breakpoint.
		   StepProgress handles its own responsive label collapse internally
		   (see its own ~30rem breakpoint), so nothing here needs to react to
		   it — the vertical sidebar this replaced needed page-level
		   breakpoint overrides of its own; a horizontal bar that is already
		   full-width does not. */
		.step-body {
			overflow-y: visible;
			height: auto;
		}
	}

	@media (max-width: 40rem) {
		.join-page {
			--text-xs: 0.95rem;
			--text-sm: 1.15rem;
			--text-base: 1.4rem;
			--text-lg: 1.6rem;
			--text-xl: 1.8rem;
			--text-2xl: 2.2rem;
			padding-inline: 0.5rem;
			font-size: var(--text-base);
		}
	}
</style>
