import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$lib/config.js', () => ({ TURNSTILE_SITE_KEY: 'test-site-key' }));

const { default: Turnstile } = await import('./Turnstile.svelte');

/**
 * Cloudflare renders `.cf-turnstile` containers only when its script first
 * loads. A widget mounted later — the contact form returning for "Send
 * another message" — used to be an empty container, so the next submit had
 * no token and was refused server-side until the page was reloaded.
 */

afterEach(() => {
	document.querySelectorAll('script[data-turnstile-api]').forEach((s) => s.remove());
	delete (/** @type {any} */ (window).turnstile);
	vi.restoreAllMocks();
});

describe('Turnstile', () => {
	it('loads the API script on first use and leaves rendering to it', () => {
		render(Turnstile, { token: '' });
		const script = document.querySelector('script[data-turnstile-api]');
		expect(script?.getAttribute('src')).toContain('challenges.cloudflare.com/turnstile');
		expect(document.querySelector('.cf-turnstile')?.getAttribute('data-sitekey')).toBe(
			'test-site-key'
		);
	});

	it('renders explicitly when mounted after the API has already loaded', () => {
		const api = {
			render: vi.fn(() => 'widget-1'),
			reset: vi.fn(),
			remove: vi.fn()
		};
		/** @type {any} */ (window).turnstile = api;
		const script = document.createElement('script');
		script.dataset.turnstileApi = 'true';
		document.head.appendChild(script);

		const screen = render(Turnstile, { token: '' });

		expect(api.render).toHaveBeenCalledTimes(1);
		const [container, options] = /** @type {any[]} */ (api.render.mock.calls[0]);
		expect(container).toBe(document.querySelector('.cf-turnstile'));
		expect(options).toMatchObject({ sitekey: 'test-site-key', theme: 'auto' });
		expect(typeof options.callback).toBe('function');
		expect(document.querySelectorAll('script[data-turnstile-api]')).toHaveLength(1);

		screen.component.reset();
		expect(api.reset).toHaveBeenCalledWith('widget-1');

		screen.unmount();
		expect(api.remove).toHaveBeenCalledWith('widget-1');
	});

	it('hands the solved token to the bound prop through the explicit callback', async () => {
		const api = { render: vi.fn(() => 'widget-2'), reset: vi.fn(), remove: vi.fn() };
		/** @type {any} */ (window).turnstile = api;

		let token = '';
		render(Turnstile, {
			get token() {
				return token;
			},
			set token(value) {
				token = value;
			}
		});
		const options = /** @type {any} */ (api.render.mock.calls[0])[1];
		options.callback('solved-token');
		await vi.waitFor(() => expect(token).toBe('solved-token'));
		options['expired-callback']();
		await vi.waitFor(() => expect(token).toBe(''));
	});
});
