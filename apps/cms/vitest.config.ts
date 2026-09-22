import fs from 'node:fs'
import path from 'node:path'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// The content database's migrations, read from ./drizzle and handed to the workerd
// pool as a binding; test/apply-migrations.ts applies them before each suite.
const migrationsDir = path.join(import.meta.dirname, 'drizzle')
const migrations = fs.existsSync(migrationsDir)
	? fs
			.readdirSync(migrationsDir)
			.filter((name) => fs.existsSync(path.join(migrationsDir, name, 'migration.sql')))
			.sort()
			.map((name) => ({
				name,
				queries: fs
					.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8')
					.split('--> statement-breakpoint')
					.map((q) => q.trim())
					.filter(Boolean),
			}))
	: []

// Three projects: `workerd` runs everything that deploys to the Workers runtime
// (Durable Objects, codecs, domain logic) in the real runtime via
// vitest-pool-workers with the wrangler.test.jsonc bindings; `dom` runs
// `*.dom.test.ts` under jsdom for editor code that needs a real DOM; `node` runs
// `*.node.test.ts` — the template seed over the multi-megabyte canonical files,
// which needs the filesystem and nothing from the runtime.
export default defineConfig({
	test: {
		passWithNoTests: true,
		projects: [
			{
				plugins: [
					cloudflareTest({
						wrangler: { configPath: './wrangler.test.jsonc' },
						miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
					}),
				],
				test: {
					name: 'workerd',
					include: ['src/**/*.test.ts'],
					exclude: ['src/**/*.dom.test.ts', 'src/**/*.node.test.ts'],
					setupFiles: ['./test/apply-migrations.ts'],
				},
			},
			{
				test: {
					name: 'dom',
					environment: 'jsdom',
					include: ['src/**/*.dom.test.ts'],
				},
			},
			{
				test: {
					name: 'node',
					environment: 'node',
					include: ['src/**/*.node.test.ts'],
				},
			},
		],
	},
})
