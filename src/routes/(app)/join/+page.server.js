import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';
import eulaMarkdown from '../../../../docs/legal/EULA.md?raw';

/**
 * The "Read the full EULA" modal renders the parsed output of
 * `docs/legal/EULA.md` — that markdown file is the single source of truth
 * for the EULA's text; editing it is the entire way to change what's shown,
 * no second copy to keep in sync.
 *
 * Parsed server-side and prerendered at build time, same reasoning as the
 * changelog release list in `+layout.server.js`: a server load's return
 * value reaches the browser, its imports don't, so the markdown source and
 * the remark/unified toolchain never ship to the client, only the resulting
 * HTML string does.
 */
export async function load() {
	const file = await remark().use(remarkGfm).use(remarkHtml).process(eulaMarkdown);
	return { eulaHtml: String(file) };
}
