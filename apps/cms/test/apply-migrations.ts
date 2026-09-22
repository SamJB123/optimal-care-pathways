// Vitest setup (workerd pool): bring the test D1 to the current schema before each
// suite. Migrations are read from ./drizzle by vitest.config.ts and injected as the
// TEST_MIGRATIONS miniflare binding; applyD1Migrations is idempotent per database.
// TEST_MIGRATIONS is plugin-injected, so it is typed here rather than in the generated Env.
// biome-ignore lint/correctness/noUnresolvedImports: provided by the vitest workers pool
import { applyD1Migrations, env } from 'cloudflare:test'

type TestMigrations = { name: string; queries: string[] }[]

const isMigrations = (value: unknown): value is TestMigrations =>
	Array.isArray(value) &&
	value.every(
		(item) =>
			typeof item === 'object' &&
			item !== null &&
			'name' in item &&
			'queries' in item &&
			Array.isArray(item.queries),
	)

const injected: unknown = 'TEST_MIGRATIONS' in env ? env.TEST_MIGRATIONS : undefined
await applyD1Migrations(env.DB, isMigrations(injected) ? injected : [])
