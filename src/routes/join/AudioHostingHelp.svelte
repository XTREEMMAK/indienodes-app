<script>
	/**
	 * "Musicians: what makes a track actually playable here", moved out of
	 * JoinMediaStep.svelte when it grew the self-hosting setups below.
	 *
	 * The reactive background is the reason this section exists. A track only
	 * drives it when its host sends `Access-Control-Allow-Origin`, because a
	 * browser will not let one site analyse audio from another without it (see
	 * `$lib/audioCorsCheck.js`). File Garden, archive.org, Neocities and GitHub
	 * Pages were each confirmed to send it on 2026-09-14; a self-hosted server
	 * sends it only once someone adds it, which is what the setups are for.
	 *
	 * The config snippets live in strings rather than markup: nginx and Caddy
	 * braces would otherwise be read as Svelte expressions.
	 */

	/** @typedef {'yes' | 'setup' | 'no'} Level */

	/** @type {{ host: string, plays: string, playsLevel: Level, reactive: string, reactiveLevel: Level, why: string }[]} */
	const HOSTING = [
		{
			host: 'File Garden',
			plays: 'Yes',
			playsLevel: 'yes',
			reactive: 'Yes',
			reactiveLevel: 'yes',
			why: 'Recommended. Free direct file hosting that already sends the header, so there is nothing to set up, and it is well supported here.'
		},
		{
			host: 'archive.org',
			plays: 'Yes',
			playsLevel: 'yes',
			reactive: 'Yes',
			reactiveLevel: 'yes',
			why: 'Free, permanent, built for this, and sends the header.'
		},
		{
			host: 'Neocities',
			plays: 'Yes',
			playsLevel: 'yes',
			reactive: 'Yes',
			reactiveLevel: 'yes',
			why: 'Sends the header. Its free tier blocks audio files; the Supporter tier allows them.'
		},
		{
			host: 'GitHub Pages',
			plays: 'Yes',
			playsLevel: 'yes',
			reactive: 'Yes',
			reactiveLevel: 'yes',
			why: 'Sends the header on every file.'
		},
		{
			host: 'Your own site or server',
			plays: 'Yes',
			playsLevel: 'yes',
			reactive: 'With one setting',
			reactiveLevel: 'setup',
			why: 'Most servers do not send the header until you add it for your audio files. Copy-paste setups are below.'
		},
		{
			host: 'Bandcamp',
			plays: 'No',
			playsLevel: 'no',
			reactive: 'No',
			reactiveLevel: 'no',
			why: 'Its direct audio URLs expire within about a day. The embedded player never expires, but cannot tell this site when a track ends, so it cannot take part in a queue.'
		},
		{
			host: 'YouTube',
			plays: 'No',
			playsLevel: 'no',
			reactive: 'No',
			reactiveLevel: 'no',
			why: 'Its terms prohibit playing a video’s audio on its own, and its embed brings ads and tracking this project does not put on your visitors.'
		},
		{
			host: 'Spotify, Apple Music, SoundCloud',
			plays: 'No',
			playsLevel: 'no',
			reactive: 'No',
			reactiveLevel: 'no',
			why: 'Platform players cannot hand a file to this site. Link out with source_url instead.'
		}
	];

	const AUDIO_EXTENSIONS = 'mp3|ogg|oga|opus|m4a|aac|flac|wav';

	/** @type {{ id: string, name: string, where: string, code: string, note?: string }[]} */
	const SETUPS = [
		{
			id: 'apache',
			name: 'Apache (most shared hosting)',
			where: 'Add to the .htaccess file in the folder that holds your audio, or your site root:',
			code: `<FilesMatch "\\.(${AUDIO_EXTENSIONS})$">\n    Header set Access-Control-Allow-Origin "*"\n</FilesMatch>`,
			note: 'Needs mod_headers, which nearly every host has enabled.'
		},
		{
			id: 'nginx',
			name: 'nginx',
			where: 'Add inside your site’s server { } block, then reload nginx:',
			code: `location ~* \\.(${AUDIO_EXTENSIONS})$ {\n    root /path/to/your/site;   # the same root your site already uses\n    add_header Access-Control-Allow-Origin "*" always;\n}`,
			note: 'Keep the root line. nginx picks this block instead of your other location blocks for audio files, so without its own root it looks in the wrong folder and every track returns 404. If your site is served with proxy_pass rather than root, copy that proxy_pass line in instead.'
		},
		{
			id: 'caddy',
			name: 'Caddy',
			where: 'Add inside your site block in the Caddyfile:',
			code: `@audio path_regexp \\.(${AUDIO_EXTENSIONS})$\nheader @audio Access-Control-Allow-Origin "*"`
		},
		{
			id: 'headers-file',
			name: 'Netlify or Cloudflare Pages',
			where:
				'Keep your tracks in an /audio/ folder, and add a file named _headers to the root of what you publish:',
			code: `/audio/*\n  Access-Control-Allow-Origin: *`
		}
	];
</script>

<details class="help musician-help">
	<summary>Musicians: what makes a track actually playable here</summary>
	<p>
		A track plays here when its link points at a direct audio file. To also drive the
		<strong>reactive background</strong>, the animation that moves with your music, its host has to
		allow cross-origin playback by sending an <code>Access-Control-Allow-Origin</code> header.
		Browsers require it before one site can listen to audio from another. Use
		<strong>Check this track</strong> under each link to see where yours stands.
	</p>
	<div class="table-scroll">
		<table>
			<thead>
				<tr>
					<th scope="col">Where your audio lives</th>
					<th scope="col">Plays here</th>
					<th scope="col">Reactive background</th>
					<th scope="col">Why</th>
				</tr>
			</thead>
			<tbody>
				{#each HOSTING as row (row.host)}
					<tr>
						<th scope="row">{row.host}</th>
						<td><span class="req" data-req={row.playsLevel}>{row.plays}</span></td>
						<td><span class="req" data-req={row.reactiveLevel}>{row.reactive}</span></td>
						<td>{row.why}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<details class="self-host">
		<summary>Hosting on your own site? Add the header</summary>
		<p>
			The header only lets other sites read files that are already public. It exposes nothing else,
			and <code>*</code> is the right value for public audio. Pick the setup that matches your server:
		</p>
		{#each SETUPS as setup (setup.id)}
			<section class="setup" aria-labelledby="setup-{setup.id}">
				<h4 id="setup-{setup.id}">{setup.name}</h4>
				<p class="note">{setup.where}</p>
				<pre><code>{setup.code}</code></pre>
				{#if setup.note}
					<p class="note">{setup.note}</p>
				{/if}
			</section>
		{/each}
		<p class="note">
			<strong>Behind a CDN such as Cloudflare?</strong> Purge its cache for your audio files afterwards.
			Until then it keeps serving copies saved without the header, so nothing appears to change.
		</p>
		<p class="note">
			Then use <strong>Check this track</strong> again. Not sure what your server runs, or no way to change
			it? Upload the tracks to File Garden instead; they will work straight away.
		</p>
	</details>
</details>

<style>
	.req[data-req='setup'] {
		background: var(--type-text-soft);
		color: var(--text);
		border: 1px solid var(--type-text);
	}

	.self-host {
		margin-top: 0.5rem;
	}

	.self-host summary {
		cursor: pointer;
		font-weight: 600;
	}

	.setup h4 {
		margin: 1.2rem 0 0.3rem;
		font-size: var(--text-base);
	}

	pre {
		overflow-x: auto;
		margin: 0.4rem 0 0.6rem;
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
</style>
