/**
 * The auth worker's UI: two client-rendered pages (/sign-in, /consent) built
 * from the shared Solid components (`@aicolab/better-auth/solid`,
 * `@aicolab/ui-solid`) and served as Workers static assets next to the
 * better-auth API. No SSR, no router: each page is one HTML shell that mounts
 * one component. Output: dist/ui (wrangler.jsonc → assets.directory).
 */
import path from 'node:path'
import solidPlugin from '@solidjs/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
	root: path.join(import.meta.dirname, 'ui'),
	build: {
		outDir: path.join(import.meta.dirname, 'dist/ui'),
		emptyOutDir: true,
		// Keep light-dark() native (the repo's browser floor).
		cssTarget: ['chrome130', 'safari18', 'firefox133'],
		rollupOptions: {
			input: {
				index: path.join(import.meta.dirname, 'ui/index.html'),
				'sign-in': path.join(import.meta.dirname, 'ui/sign-in.html'),
				consent: path.join(import.meta.dirname, 'ui/consent.html'),
			},
		},
	},
	resolve: {
		alias: {
			'solid-js/web': '@solidjs/web',
			'solid-js/h': '@solidjs/h',
		},
	},
	plugins: [solidPlugin()],
})
