import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';
import termsMarkdown from '../../../docs/legal/TERMS-AND-PRIVACY.md?raw';

/**
 * The published Terms of Use and Privacy Notice are authored in Markdown and
 * converted at build time. Only the rendered HTML reaches the browser.
 */
export async function load() {
	const file = await remark().use(remarkGfm).use(remarkHtml).process(termsMarkdown);
	const termsHtml = String(file)
		// The two Part headings get explicit ids so `/terms#terms-of-use` and
		// `/terms#privacy-notice` (used by the join consent step's links) land
		// on the actual section rather than the top of the combined document.
		// A targeted string replace rather than a markdown heading-id plugin
		// or `sanitize: false`: the headings' exact text is known and stable,
		// and this only touches these two specific headings, not the general
		// question of whether raw HTML in this document renders.
		.replace('<h1>Part I — Terms of Use</h1>', '<h1 id="terms-of-use">Part I — Terms of Use</h1>')
		.replace(
			'<h1>Part II — Privacy Notice</h1>',
			'<h1 id="privacy-notice">Part II — Privacy Notice</h1>'
		);
	return { termsHtml };
}
