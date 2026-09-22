import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Two projects: `workerd` runs everything that deploys to the Workers runtime
// (Durable Objects, codecs, domain logic) in the real runtime via
// vitest-pool-workers with the wrangler.test.jsonc bindings; `dom` runs
// `*.dom.test.ts` under jsdom for editor code that needs a real DOM.
export default defineConfig({
	test: {
		passWithNoTests: true,
		projects: [
			{
				plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.test.jsonc' } })],
				test: {
					name: 'workerd',
					include: ['src/**/*.test.ts'],
					exclude: ['src/**/*.dom.test.ts'],
				},
			},
			{
				test: {
					name: 'dom',
					environment: 'jsdom',
					include: ['src/**/*.dom.test.ts'],
				},
			},
		],
	},
})
