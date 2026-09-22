import { cloudflare } from '@cloudflare/vite-plugin'
import solidPlugin from '@solidjs/vite-plugin'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/solid-start/plugin/vite'
import { defineConfig } from 'vite'

export default defineConfig({
	build: {
		// Keep light-dark() native: Vite 8's default css minifier downlevels it into a
		// var polyfill at default targets, which ignores runtime color-scheme flips.
		cssTarget: ['chrome130', 'safari18', 'firefox133'],
	},
	resolve: {
		tsconfigPaths: true,
		// TanStack's solid packages still import `solid-js/web`, which in Solid 2 lives
		// in `@solidjs/web`.
		alias: {
			'solid-js/web': '@solidjs/web',
			'solid-js/h': '@solidjs/h',
		},
	},
	plugins: [
		devtools(),
		// The Worker entry (src/worker.ts) lives in the 'ssr' environment, where
		// TanStack Start handles requests. The auth worker is spawned in the same dev
		// server and wired to the AUTH service binding by name; its BETTER_AUTH_URL is
		// overridden to this app's port so cookies bind to the origin the app runs on.
		cloudflare({
			viteEnvironment: { name: 'ssr' },
			auxiliaryWorkers: [
				{
					configPath: '../auth/wrangler.jsonc',
					config: { vars: { BETTER_AUTH_URL: 'http://localhost:3100' } },
				},
			],
		}),
		tanstackStart(),
		// MUST come after tanstackStart() so the generated route files are compiled too.
		solidPlugin({ ssr: true }),
	],
})
